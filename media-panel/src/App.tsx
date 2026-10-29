import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  assetUrl,
  classifyDragItems,
  coverAssetKey,
  createGame,
  deleteGame,
  dropRejectionMessage,
  formatBytes,
  getGame,
  isAcceptedDropFile,
  isTauri,
  listGames,
  pickFiles,
  uploadMedia,
  type PickedSource,
} from "./api";
import { CreateGameModal } from "./CreateGameModal";
import { LocalImport } from "./LocalImport";
import { SteamGridPicker } from "./SteamGridPicker";
import type { GameDetails, GameSummary, SteamGridKind, UploadKind } from "./types";
import "./App.css";

type DropKind = "image" | "video";
type DropMode = "accept" | "reject";

function App() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [steamGridKind, setSteamGridKind] = useState<SteamGridKind | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [nativeDrop, setNativeDrop] = useState<{ kind: DropKind; mode: DropMode } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const uploadLock = useRef(false);
  const handleDroppedRef = useRef<(kind: DropKind, sources: PickedSource[]) => Promise<void>>(
    async () => {},
  );
  selectedRef.current = selectedName;

  const loadDetails = useCallback(async (name: string, refresh = false) => {
    setLoadingDetails(true);
    setError(null);
    try {
      setDetails(await getGame(name, refresh));
    } catch (err) {
      setDetails(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const loadList = useCallback(async (refresh = false) => {
    setLoadingList(true);
    setError(null);
    try {
      const catalog = await listGames(refresh);
      setGames(catalog.games);
      setFromCache(catalog.fromCache);
      setCachedAt(catalog.cachedAt);
      setSelectedName((current) => current ?? catalog.games[0]?.name ?? null);
      if (refresh) {
        const selected = selectedRef.current ?? catalog.games[0]?.name ?? null;
        if (selected) await loadDetails(selected, true);
        setNotice("Catálogo e imagens atualizados a partir do bucket.");
      }
    } catch (err) {
      setGames([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, [loadDetails]);

  useEffect(() => {
    void loadList(false);
  }, [loadList]);

  useEffect(() => {
    if (!selectedName) {
      setDetails(null);
      return;
    }
    void loadDetails(selectedName, false);
  }, [selectedName, loadDetails]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return games;
    return games.filter((game) => game.name.toLowerCase().includes(needle));
  }, [games, query]);

  async function sendUploads(kind: UploadKind, sources: PickedSource[], skipped = 0) {
    if (!selectedName || sources.length === 0 || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(kind);
    setError(null);
    setNotice(null);
    try {
      for (const source of sources) {
        await uploadMedia(selectedName, kind, source);
      }
      await loadDetails(selectedName, true);
      const uploaded =
        sources.length > 1
          ? `${sources.length} arquivos enviados para ${selectedName}.`
          : `Upload concluído em ${selectedName}.`;
      const reason =
        kind === "image"
          ? "esta área aceita apenas imagens .jpg ou .png"
          : "esta área aceita apenas vídeos .mp4";
      const ignored =
        skipped > 0
          ? ` ${skipped === 1 ? "1 arquivo ignorado" : `${skipped} arquivos ignorados`}: ${reason}.`
          : "";
      setNotice(`${uploaded}${ignored}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      uploadLock.current = false;
      setUploading(null);
    }
  }

  async function handleUpload(kind: UploadKind) {
    if (!selectedName || uploadLock.current) return;
    const sources = await pickFiles(kind);
    await sendUploads(kind, sources);
  }

  async function handleDropped(kind: DropKind, sources: PickedSource[]) {
    if (!selectedName || uploadLock.current) return;
    const accepted = sources.filter((source) =>
      isAcceptedDropFile(kind, source.name, "file" in source ? source.file.type : ""),
    );
    if (accepted.length === 0) {
      setNotice(null);
      setError(dropRejectionMessage(kind));
      return;
    }
    await sendUploads(kind, accepted, sources.length - accepted.length);
  }
  handleDroppedRef.current = handleDropped;

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const draggedPaths: string[] = [];

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          draggedPaths.length = 0;
          setNativeDrop(null);
          return;
        }

        if (payload.type === "enter") {
          draggedPaths.splice(0, draggedPaths.length, ...payload.paths);
        }

        const kind = dropKindAt(payload.position);
        if (payload.type === "drop") {
          const paths = payload.paths;
          draggedPaths.length = 0;
          setNativeDrop(null);
          if (!kind) return;
          void handleDroppedRef.current(
            kind,
            paths.map((path) => ({
              path,
              name: path.split(/[\\/]/).pop() || path,
            })),
          );
          return;
        }

        if (!kind || uploadLock.current) {
          setNativeDrop((current) => (current === null ? current : null));
          return;
        }

        const paths = payload.type === "enter" ? payload.paths : draggedPaths;
        const mode: DropMode = paths.some((path) => isAcceptedDropFile(kind, path))
          ? "accept"
          : "reject";
        setNativeDrop((current) =>
          current?.kind === kind && current.mode === mode ? current : { kind, mode },
        );
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // O arraste pelo navegador continua disponível quando o webview não intercepta arquivos.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isTauri()) return;
    const preventNavigation = (event: DragEvent) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) {
        event.preventDefault();
      }
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);

  const canRemove =
    Boolean(details) &&
    details?.name === selectedName &&
    details.images.length === 0 &&
    details.videos.length === 0;

  async function handleCreate(input: {
    name: string;
    cover?: Parameters<typeof uploadMedia>[2];
    banner?: Parameters<typeof uploadMedia>[2];
    icon?: Parameters<typeof uploadMedia>[2];
  }) {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createGame(input.name);
      if (input.cover) await uploadMedia(created.name, "cover", input.cover);
      if (input.banner) await uploadMedia(created.name, "banner", input.banner);
      if (input.icon) await uploadMedia(created.name, "icon", input.icon);
      setShowCreate(false);
      setSelectedName(created.name);
      await loadList(false);
      await loadDetails(created.name, true);
      setNotice(`Jogo "${created.name}" criado no bucket.`);
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove() {
    if (!selectedName || !canRemove) return;
    const confirmed = window.confirm(
      `Remover a pasta "${selectedName}" do bucket? Só é permitido se não houver screenshots nem clips.`,
    );
    if (!confirmed) return;
    setRemoving(true);
    setError(null);
    setNotice(null);
    try {
      await deleteGame(selectedName);
      const removed = selectedName;
      setSelectedName(null);
      setDetails(null);
      await loadList(false);
      setNotice(`Jogo "${removed}" removido do bucket.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div>
            <p className="eyebrow">Game Vault</p>
            <h1>Painel de mídias</h1>
          </div>
          <div className="header-actions">
            <button className="ghost" onClick={() => void loadList(true)} disabled={loadingList}>
              {loadingList ? "Atualizando…" : "Atualizar"}
            </button>
            <button
              className={showLocal ? "ghost active" : "ghost"}
              onClick={() => setShowLocal((open) => !open)}
            >
              Pasta local
            </button>
            <button className="primary" onClick={() => setShowCreate(true)} disabled={creating}>
              Novo jogo
            </button>
          </div>
        </header>

        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar jogo"
        />

        <p className="count">
          {loadingList
            ? fromCache
              ? "Lendo cache local…"
              : "Lendo pastas da raiz do bucket…"
            : `${filtered.length} jogo${filtered.length === 1 ? "" : "s"}${
                fromCache ? " · cache local" : ""
              }`}
        </p>
        {cachedAt && !loadingList && (
          <p className="count">
            {fromCache ? "Consultas de imagem evitadas." : "Cache gravado agora."}{" "}
            {new Date(cachedAt).toLocaleString("pt-BR")}
          </p>
        )}

        <ul className="game-list">
          {filtered.map((game) => (
            <li key={game.name}>
              <button
                className={game.name === selectedName ? "game-item active" : "game-item"}
                onClick={() => {
                  setShowLocal(false);
                  setSelectedName(game.name);
                }}
              >
                <CoverThumb src={assetUrl(coverAssetKey(game.name), game.coverUrl)} alt="" />
                <span>{game.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner success">{notice}</div>}

        {showLocal && <LocalImport onImported={() => void loadList(true)} />}

        {!showLocal && !selectedName && <EmptyState />}

        {!showLocal && selectedName && (
          <>
            <section className="hero">
              <CoverThumb
                className="hero-cover"
                src={assetUrl(
                  coverAssetKey(selectedName),
                  details?.coverUrl ??
                    games.find((game) => game.name === selectedName)?.coverUrl ??
                    "",
                )}
                alt={selectedName}
              />
              <div>
                <p className="eyebrow">Pasta do bucket</p>
                <h2>{selectedName}</h2>
                <p className="muted">
                  Branding canônico: cover.jpg, banner.jpg e icon.png. Screenshots em images/ e
                  clips em videos/&lt;nome&gt;/&lt;nome&gt;.mp4.
                </p>
                <button
                  className="danger"
                  disabled={!canRemove || removing || loadingDetails}
                  title={
                    canRemove
                      ? "Remove a pasta se não houver images/ nem videos/"
                      : "Remova screenshots e clips antes de excluir o jogo."
                  }
                  onClick={() => void handleRemove()}
                >
                  {removing ? "Removendo…" : "Remover jogo"}
                </button>
              </div>
            </section>

            {loadingDetails && <p className="muted">Carregando mídias…</p>}

            {details && (
              <>
                <section className="cards">
                  <AssetCard
                    variant="cover"
                    title="Capa"
                    fileName="cover.jpg"
                    present={details.hasCover}
                    src={assetUrl(`${details.name}/cover.jpg`, details.coverUrl)}
                    busy={uploading === "cover"}
                    onUpload={() => void handleUpload("cover")}
                    onSteamGrid={() => setSteamGridKind("cover")}
                  />
                  <AssetCard
                    variant="banner"
                    title="Banner"
                    fileName="banner.jpg"
                    present={details.hasBanner}
                    src={assetUrl(`${details.name}/banner.jpg`, details.bannerUrl)}
                    busy={uploading === "banner"}
                    onUpload={() => void handleUpload("banner")}
                    onSteamGrid={() => setSteamGridKind("banner")}
                  />
                  <AssetCard
                    variant="icon"
                    title="Ícone"
                    fileName="icon.png"
                    present={details.hasIcon}
                    src={assetUrl(`${details.name}/icon.png`, details.iconUrl)}
                    busy={uploading === "icon"}
                    onUpload={() => void handleUpload("icon")}
                    onSteamGrid={() => setSteamGridKind("icon")}
                  />
                </section>

                <MediaDropSection
                  kind="image"
                  title="Screenshots"
                  countLabel={`${details.images.length} arquivo(s) em images/`}
                  hint="Arraste imagens .jpg ou .png para esta área."
                  busy={uploading !== null}
                  nativeMode={nativeDrop?.kind === "image" ? nativeDrop.mode : null}
                  actionLabel={uploading === "image" ? "Enviando…" : "Enviar imagens"}
                  onBrowse={() => void handleUpload("image")}
                  onDropFiles={(files) =>
                    void handleDropped(
                      "image",
                      files.map((file) => ({ file, name: file.name })),
                    )
                  }
                >
                  {details.images.length === 0 ? (
                    <p className="muted">Nenhuma screenshot neste jogo.</p>
                  ) : (
                    <div className="thumbs">
                      {details.images.map((file) => (
                        <figure key={file.key}>
                          <img src={assetUrl(file.key, file.url)} alt={file.name} />
                          <figcaption>
                            {file.name}
                            <span>{formatBytes(file.size)}</span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </MediaDropSection>

                <MediaDropSection
                  kind="video"
                  title="Clips"
                  countLabel={`${details.videos.length} vídeo(s) em videos/`}
                  hint="Arraste vídeos .mp4 para esta área."
                  busy={uploading !== null}
                  nativeMode={nativeDrop?.kind === "video" ? nativeDrop.mode : null}
                  actionLabel={uploading === "video" ? "Enviando…" : "Enviar vídeos"}
                  onBrowse={() => void handleUpload("video")}
                  onDropFiles={(files) =>
                    void handleDropped(
                      "video",
                      files.map((file) => ({ file, name: file.name })),
                    )
                  }
                >
                  {details.videos.length === 0 ? (
                    <p className="muted">Nenhum clip neste jogo.</p>
                  ) : (
                    <ul className="files">
                      {details.videos.map((file) => (
                        <li key={file.key}>
                          <strong>{file.name}</strong>
                          <span>{file.key}</span>
                          <span>{formatBytes(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </MediaDropSection>
              </>
            )}
          </>
        )}
      </main>

      {showCreate && (
        <CreateGameModal
          busy={creating}
          onClose={() => {
            if (!creating) setShowCreate(false);
          }}
          onSubmit={handleCreate}
        />
      )}

      {steamGridKind && selectedName && (
        <SteamGridPicker
          gameName={selectedName}
          kind={steamGridKind}
          applyToGame={selectedName}
          onClose={() => setSteamGridKind(null)}
          onApplied={async () => {
            await loadDetails(selectedName, true);
            setNotice(`Imagem do SteamGridDB aplicada em ${selectedName}.`);
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h2>Nenhum jogo selecionado</h2>
      <p className="muted">
        Os jogos são as pastas da raiz do bucket. Se a lista estiver vazia, confira as credenciais
        no .env.
      </p>
    </div>
  );
}

function CoverThumb({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <div className={className ? `${className} placeholder` : "placeholder"} />;
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}

function dropKindAt(position: { x: number; y: number }): DropKind | null {
  const scale = window.devicePixelRatio || 1;
  const element = document.elementFromPoint(position.x / scale, position.y / scale);
  const kind = element?.closest<HTMLElement>("[data-drop-kind]")?.dataset.dropKind;
  return kind === "image" || kind === "video" ? kind : null;
}

function MediaDropSection({
  kind,
  title,
  countLabel,
  hint,
  busy,
  nativeMode,
  actionLabel,
  onBrowse,
  onDropFiles,
  children,
}: {
  kind: DropKind;
  title: string;
  countLabel: string;
  hint: string;
  busy: boolean;
  nativeMode: DropMode | null;
  actionLabel: string;
  onBrowse: () => void;
  onDropFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const [htmlMode, setHtmlMode] = useState<DropMode | null>(null);
  const depth = useRef(0);
  const mode = nativeMode ?? htmlMode;
  const acceptLabel = kind === "image" ? "Solte para enviar as imagens" : "Solte para enviar os vídeos";
  const rejectLabel = kind === "image" ? "Apenas imagens .jpg ou .png" : "Apenas vídeos .mp4";

  function syncFromEvent(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer) return;
    if (busy) {
      event.dataTransfer.dropEffect = "none";
      setHtmlMode(null);
      return;
    }
    const verdict = classifyDragItems(kind, event.dataTransfer.items);
    setHtmlMode(verdict === "reject" ? "reject" : "accept");
    event.dataTransfer.dropEffect = "copy";
  }

  return (
    <section
      className={mode ? `panel dropzone dropzone-${mode}` : "panel dropzone"}
      data-drop-kind={kind}
      data-drop-mode={mode ?? "idle"}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        syncFromEvent(event);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        syncFromEvent(event);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setHtmlMode(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setHtmlMode(null);
        if (busy || isTauri() || !event.dataTransfer) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onDropFiles(files);
      }}
    >
      <header>
        <div>
          <h3>{title}</h3>
          <p className="muted">{countLabel}</p>
          <p className="drop-hint">{hint}</p>
        </div>
        <button className="primary" disabled={busy} onClick={onBrowse}>
          {actionLabel}
        </button>
      </header>
      {mode && (
        <div className={`dropzone-overlay ${mode}`} aria-hidden="true">
          {mode === "accept" ? acceptLabel : rejectLabel}
        </div>
      )}
      {children}
    </section>
  );
}

function AssetCard({
  variant,
  title,
  fileName,
  present,
  src,
  busy,
  onUpload,
  onSteamGrid,
}: {
  variant: "cover" | "banner" | "icon";
  title: string;
  fileName: string;
  present: boolean;
  src: string;
  busy: boolean;
  onUpload: () => void;
  onSteamGrid: () => void;
}) {
  return (
    <article className={`asset asset-${variant}`}>
      <CoverThumb
        className={`asset-preview asset-preview-${variant}`}
        src={present ? src : undefined}
        alt={title}
      />
      <div>
        <h3>{title}</h3>
        <p className="muted">{fileName}</p>
        <p className={present ? "ok" : "missing"}>{present ? "Presente no bucket" : "Ausente"}</p>
        <div className="asset-actions">
          <button className="primary" disabled={busy} onClick={onUpload}>
            {busy ? "Enviando…" : present ? "Substituir" : "Enviar"}
          </button>
          <button className="ghost" disabled={busy} onClick={onSteamGrid}>
            SteamGridDB
          </button>
        </div>
      </div>
    </article>
  );
}

export default App;
