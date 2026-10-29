import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  assetUrl,
  classifyDragItems,
  coverAssetKey,
  createGame,
  deleteGame,
  deleteMediaFile,
  dropRejectionMessage,
  formatBytes,
  getGame,
  isAcceptedDropFile,
  isTauri,
  listGames,
  pickFiles,
  refreshGameMetadata,
  uploadMedia,
  type PickedSource,
} from "./api";
import { CreateGameModal } from "./CreateGameModal";
import { Icon } from "./icons";
import { LocalImport } from "./LocalImport";
import { SteamGridPicker } from "./SteamGridPicker";
import type { GameDetails, GameSummary, SteamGridKind, UploadKind } from "./types";
import "./App.css";

type DropKind = "image" | "video";
type DropMode = "accept" | "reject";
type PendingDelete =
  | { type: "game"; name: string }
  | { type: "file"; kind: DropKind; game: string; name: string; key: string };

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
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [updatingMetadata, setUpdatingMetadata] = useState(false);
  const [steamGridKind, setSteamGridKind] = useState<SteamGridKind | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [nativeDrop, setNativeDrop] = useState<{ kind: DropKind; mode: DropMode } | null>(null);
  const gameListRef = useRef<HTMLUListElement>(null);
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
  const selectedIndex = filtered.findIndex((game) => game.name === selectedName);

  function selectAt(index: number) {
    const next = filtered[index];
    if (!next) return;
    setShowLocal(false);
    setSelectedName(next.name);
  }

  function selectAdjacent(step: -1 | 1) {
    selectAt(selectedIndex + step);
  }

  useEffect(() => {
    if (!selectedName) return;
    const list = gameListRef.current;
    const active = list?.querySelector<HTMLElement>(".game-item.active");
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const inView = itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom;
    if (inView) return;
    const nextTop =
      list.scrollTop + (itemRect.top - listRect.top) - listRect.height / 2 + itemRect.height / 2;
    const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTo({ top: Math.min(maxTop, Math.max(0, nextTop)), behavior: "smooth" });
  }, [selectedName, filtered]);

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

  function requestRemoveGame() {
    if (!selectedName || !canRemove || removing) return;
    setPendingDelete({ type: "game", name: selectedName });
  }

  function requestRemoveFile(kind: DropKind, file: { name: string; key: string }) {
    if (!selectedName || removing) return;
    setPendingDelete({ type: "file", kind, game: selectedName, name: file.name, key: file.key });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || removing) return;
    setRemoving(true);
    setError(null);
    setNotice(null);
    try {
      if (pendingDelete.type === "game") {
        await deleteGame(pendingDelete.name);
        setSelectedName(null);
        setDetails(null);
        await loadList(false);
        setNotice(`Jogo "${pendingDelete.name}" removido do bucket.`);
      } else {
        await deleteMediaFile(pendingDelete.game, pendingDelete.key);
        await loadDetails(pendingDelete.game, true);
        const label = pendingDelete.kind === "image" ? "Screenshot" : "Clip";
        setNotice(`${label} "${pendingDelete.name}" removido. metadata.json atualizado.`);
      }
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  }

  async function handleRefreshMetadata() {
    if (!selectedName || updatingMetadata) return;
    setUpdatingMetadata(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshGameMetadata(selectedName);
      await loadDetails(selectedName, true);
      setNotice(
        `metadata.json atualizado em ${selectedName}: ${result.images} imagem(ns) e ${result.videos} vídeo(s).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingMetadata(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="header-actions">
            <button
              className="ghost icon-btn"
              onClick={() => void loadList(true)}
              disabled={loadingList}
              title="Atualizar catálogo"
              aria-label="Atualizar catálogo"
            >
              <Icon name="refresh" className={loadingList ? "spin" : undefined} />
            </button>
            <button
              className={showLocal ? "ghost icon-btn active" : "ghost icon-btn"}
              onClick={() => setShowLocal((open) => !open)}
              title="Pasta local"
              aria-label="Pasta local"
            >
              <Icon name="folder" />
            </button>
            <button className="primary" onClick={() => setShowCreate(true)} disabled={creating}>
              <Icon name="plus" />
              Novo
            </button>
          </div>
        </header>

        <label className="search-field">
          <Icon name="search" />
          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar jogo"
          />
        </label>

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
          <p className="count cache-stamp">
            {fromCache ? "Cache local" : "Cache gravado"} ·{" "}
            {new Date(cachedAt).toLocaleString("pt-BR")}
          </p>
        )}

        <ul className="game-list" ref={gameListRef}>
          {filtered.map((game) => {
            const active = game.name === selectedName;
            return (
              <li key={game.name}>
                <button
                  type="button"
                  className={active ? "game-item active" : "game-item"}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setShowLocal(false);
                    setSelectedName(game.name);
                  }}
                >
                  <CoverThumb src={assetUrl(coverAssetKey(game.name), game.coverUrl)} alt="" />
                  <span>{game.name}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <nav className="list-nav" aria-label="Navegação da lista de jogos">
          <button
            type="button"
            className="ghost icon-btn"
            disabled={filtered.length === 0 || selectedIndex === 0}
            title="Primeira página"
            aria-label="Primeira página"
            onClick={() => selectAt(0)}
          >
            <Icon name="chevrons-left" />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={selectedIndex <= 0}
            title="Jogo anterior"
            aria-label="Jogo anterior"
            onClick={() => selectAdjacent(-1)}
          >
            <Icon name="chevron-left" />
          </button>
          <span>
            {selectedIndex >= 0 ? selectedIndex + 1 : 0} / {filtered.length}
          </span>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1}
            title="Próximo jogo"
            aria-label="Próximo jogo"
            onClick={() => selectAdjacent(1)}
          >
            <Icon name="chevron-right" />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={filtered.length === 0 || selectedIndex === filtered.length - 1}
            title="Última página"
            aria-label="Última página"
            onClick={() => selectAt(filtered.length - 1)}
          >
            <Icon name="chevrons-right" />
          </button>
        </nav>
      </aside>

      <main className="main">
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner success">{notice}</div>}

        {showLocal && <LocalImport onImported={() => void loadList(true)} />}

        {!showLocal && !selectedName && <EmptyState />}

        {!showLocal && selectedName && (
          <>
            <div className="details-toolbar">
              <div className="details-game">
                <h2>{selectedName}</h2>
                {details && details.name === selectedName && (
                  <GameMetadataBadge present={details.hasMetadata === true} />
                )}
              </div>
              <button
                className="ghost"
                disabled={updatingMetadata || loadingDetails || uploading !== null}
                title="Regera metadata.json a partir das imagens e clips atuais no bucket."
                onClick={() => void handleRefreshMetadata()}
              >
                <Icon name="file" className={updatingMetadata ? "spin" : undefined} />
                {updatingMetadata ? "Atualizando…" : "Metadata"}
              </button>
              <button
                className="danger"
                disabled={!canRemove || removing || loadingDetails}
                title={
                  canRemove
                    ? "Remove a pasta se não houver images/ nem videos/"
                    : "Remova screenshots e clips antes de excluir o jogo."
                }
                onClick={requestRemoveGame}
              >
                <Icon name="trash" />
                {removing ? "Removendo…" : "Remover"}
              </button>
            </div>

            {loadingDetails && <p className="muted">Carregando mídias…</p>}

            {details && (
              <>
                <BrandingAccordion
                  key={`${selectedName}-branding`}
                  coverPresent={details.hasCover}
                  bannerPresent={details.hasBanner}
                  iconPresent={details.hasIcon}
                >
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
                </BrandingAccordion>

                <div className="details-media">
                <MediaDropSection
                  key={`${selectedName}-image`}
                  kind="image"
                  title="Imagens"
                  countLabel={metadataCountLabel("arquivo(s) em images/", details.images)}
                  hint="Arraste imagens .jpg ou .png para esta área."
                  busy={uploading !== null || removing}
                  nativeMode={nativeDrop?.kind === "image" ? nativeDrop.mode : null}
                  sending={uploading === "image"}
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
                    <ul className="files files-images">
                      {details.images.map((file) => (
                        <li key={file.key} className={fileMetaRowClass(file.inMetadata, details.hasMetadata)}>
                          <CoverThumb src={assetUrl(file.key, file.url)} alt="" className="file-thumb" />
                          <strong title={file.name}>{file.name}</strong>
                          <MetadataLink linked={file.inMetadata} hasMetadata={details.hasMetadata} />
                          <span>{formatBytes(file.size)}</span>
                          <FileDeleteButton
                            disabled={removing || uploading !== null}
                            label={`Remover screenshot ${file.name}`}
                            onClick={() => requestRemoveFile("image", file)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </MediaDropSection>

                <MediaDropSection
                  key={`${selectedName}-video`}
                  kind="video"
                  title="Vídeos"
                  countLabel={metadataCountLabel("vídeo(s) em videos/", details.videos)}
                  hint="Arraste vídeos .mp4 para esta área."
                  busy={uploading !== null || removing}
                  nativeMode={nativeDrop?.kind === "video" ? nativeDrop.mode : null}
                  sending={uploading === "video"}
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
                    <ul className="files files-videos">
                      {details.videos.map((file) => (
                        <li key={file.key} className={fileMetaRowClass(file.inMetadata, details.hasMetadata)}>
                          <strong title={file.key}>{file.name}</strong>
                          <MetadataLink linked={file.inMetadata} hasMetadata={details.hasMetadata} />
                          <span>{formatBytes(file.size)}</span>
                          <FileDeleteButton
                            disabled={removing || uploading !== null}
                            label={`Remover clip ${file.name}`}
                            onClick={() => requestRemoveFile("video", file)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </MediaDropSection>
                </div>
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

      {pendingDelete && (
        <ConfirmDialog
          busy={removing}
          title={pendingDelete.type === "game" ? "Remover jogo" : pendingDelete.kind === "image" ? "Remover screenshot" : "Remover clip"}
          confirmLabel={removing ? "Removendo…" : pendingDelete.type === "game" ? "Remover pasta" : "Remover arquivo"}
          onCancel={() => {
            if (!removing) setPendingDelete(null);
          }}
          onConfirm={() => void confirmPendingDelete()}
        >
          {pendingDelete.type === "game" ? (
            <>
              <p>
                A pasta <strong>{pendingDelete.name}</strong> será apagada do bucket, incluindo capa,
                banner, ícone e metadata.json.
              </p>
              <p className="muted">Essa ação não pode ser desfeita.</p>
            </>
          ) : (
            <>
              <p>
                O {pendingDelete.kind === "image" ? "arquivo" : "clip"}{" "}
                <strong>{pendingDelete.name}</strong> será apagado de{" "}
                <strong>{pendingDelete.game}</strong>
                {pendingDelete.kind === "video" ? ", junto com a pasta e o thumb.jpg se existirem" : ""}.
              </p>
              <p className="muted">
                O metadata.json será atualizado depois da exclusão. Essa ação não pode ser desfeita.
              </p>
            </>
          )}
        </ConfirmDialog>
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

function FileDeleteButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ghost icon-btn file-delete"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon name="trash" size={14} />
    </button>
  );
}

function ConfirmDialog({
  title,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Confirmação</p>
            <h2 id="confirm-title">{title}</h2>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={onCancel}
            disabled={busy}
            title="Cancelar"
            aria-label="Cancelar"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="confirm-body">{children}</div>
        <footer>
          <button type="button" className="ghost" autoFocus disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
            <Icon name="trash" />
            {confirmLabel}
          </button>
        </footer>
      </div>
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

function AccordionShell({
  open,
  onToggle,
  trigger,
  actions,
  overlay,
  children,
  className,
  ...rest
}: {
  open: boolean;
  onToggle: () => void;
  trigger: ReactNode;
  actions?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"section">, "children" | "className">) {
  return (
    <section
      className={["media-accordion", open ? "is-open" : "", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {overlay}
      <div className="media-accordion-head">
        <button
          type="button"
          className="media-accordion-trigger"
          aria-expanded={open}
          onClick={onToggle}
        >
          {trigger}
          <span className="media-accordion-chevron" aria-hidden="true">
            <Icon name="chevron-down" />
          </span>
        </button>
        {actions}
      </div>
      <div className="media-accordion-panel" aria-hidden={!open}>
        <div className="media-accordion-inner" {...(!open ? { inert: true } : {})}>
          {children}
        </div>
      </div>
    </section>
  );
}

function metadataCountLabel(unit: string, files: { inMetadata?: boolean }[]) {
  return `${files.length} ${unit}`;
}

function fileMetaStatus(linked?: boolean, hasMetadata?: boolean): "linked" | "orphan" | "none" {
  if (hasMetadata === false) return "none";
  return linked ? "linked" : "orphan";
}

function fileMetaRowClass(linked?: boolean, hasMetadata?: boolean) {
  return `file-row file-row-${fileMetaStatus(linked, hasMetadata)}`;
}

function MetadataLink({ linked, hasMetadata }: { linked?: boolean; hasMetadata?: boolean }) {
  const status = fileMetaStatus(linked, hasMetadata);
  if (status === "none") {
    return (
      <span
        className="meta-flag meta-flag-icon meta-flag-none"
        title="Este jogo não tem metadata.json no bucket"
        aria-label="Sem metadata.json"
      >
        <Icon name="file" size={12} />
      </span>
    );
  }
  if (status === "linked") {
    return (
      <span
        className="meta-flag meta-flag-icon meta-flag-ok"
        title="Presente em metadata.json"
        aria-label="Presente em metadata.json"
      >
        <Icon name="check" size={12} />
      </span>
    );
  }
  return (
    <span
      className="meta-flag meta-flag-icon meta-flag-off"
      title="Arquivo no bucket, mas ausente de metadata.json"
      aria-label="Ausente de metadata.json"
    >
      <Icon name="x" size={12} />
    </span>
  );
}

function GameMetadataBadge({ present }: { present: boolean }) {
  return (
    <span
      className={`game-meta ${present ? "game-meta-ok" : "game-meta-off"}`}
      title={present ? "Este jogo tem metadata.json no bucket" : "Este jogo não tem metadata.json no bucket"}
    >
      <Icon name={present ? "check" : "file"} size={14} />
      {present ? "metadata.json" : "Sem metadata.json"}
    </span>
  );
}

function MediaDropSection({
  kind,
  title,
  countLabel,
  hint,
  busy,
  nativeMode,
  sending,
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
  sending: boolean;
  onBrowse: () => void;
  onDropFiles: (files: File[]) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
    <AccordionShell
      open={open}
      onToggle={() => setOpen((value) => !value)}
      className={mode ? `dropzone dropzone-${mode}` : "dropzone"}
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
      trigger={
        <span>
          <h3>{title}</h3>
          <p className="muted">{countLabel}</p>
          <p className="drop-hint">{hint}</p>
        </span>
      }
      actions={
        <button
          type="button"
          className="primary icon-btn"
          disabled={busy}
          onClick={onBrowse}
          title={kind === "image" ? "Enviar imagens" : "Enviar vídeos"}
          aria-label={kind === "image" ? "Enviar imagens" : "Enviar vídeos"}
        >
          <Icon name="upload" className={sending ? "spin" : undefined} />
        </button>
      }
      overlay={
        mode ? (
          <div className={`dropzone-overlay ${mode}`} aria-hidden="true">
            {mode === "accept" ? acceptLabel : rejectLabel}
          </div>
        ) : null
      }
    >
      {children}
    </AccordionShell>
  );
}

function BrandingAccordion({
  coverPresent,
  bannerPresent,
  iconPresent,
  children,
}: {
  coverPresent: boolean;
  bannerPresent: boolean;
  iconPresent: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const presentCount = Number(coverPresent) + Number(bannerPresent) + Number(iconPresent);

  return (
    <AccordionShell
      open={open}
      onToggle={() => setOpen((value) => !value)}
      trigger={
        <span>
          <p className="eyebrow">Branding</p>
          <h3>Capa, banner e ícone</h3>
          <p className="muted">
            {presentCount}/3 no bucket · cover.jpg, banner.jpg, icon.png
          </p>
        </span>
      }
    >
      {children}
    </AccordionShell>
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
            <Icon name="upload" />
            {busy ? "Enviando…" : present ? "Substituir" : "Enviar"}
          </button>
          <button className="ghost" disabled={busy} onClick={onSteamGrid}>
            <Icon name="grid" />
            SteamGridDB
          </button>
        </div>
      </div>
    </article>
  );
}

export default App;
