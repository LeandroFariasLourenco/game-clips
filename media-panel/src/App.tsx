import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent, type ReactNode } from "react";
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
  formatFileDate,
  getGame,
  getGameMetadata,
  isAcceptedDropFile,
  isTauri,
  listGames,
  pickFiles,
  refreshGameMetadata,
  sourceLastModified,
  uploadMedia,
  withFileMtimes,
  type PickedSource,
} from "./api";
import { fileBaseName, mediaDestination, standardizedMediaName, uniqueMediaNames } from "./mediaNames";
import { CreateGameModal } from "./CreateGameModal";
import { Icon } from "./icons";
import { LocalImport } from "./LocalImport";
import { SteamGridPicker } from "./SteamGridPicker";
import type { GameDetails, GameMetadata, GameSummary, MediaFile, SteamGridKind, UploadKind } from "./types";
import "./App.css";

type DropKind = "image" | "video";
type DropMode = "accept" | "reject";
type PendingDelete =
  | { type: "game"; name: string }
  | { type: "file"; kind: DropKind; game: string; name: string; key: string };
type FileMenu = { x: number; y: number; kind: DropKind; file: MediaFile };
type GameMenu = { x: number; y: number; name: string };
type PendingUpload = {
  kind: DropKind;
  skipped: number;
  items: Array<{ source: PickedSource; originalName: string; nextName: string }>;
};

const GAMES_PER_PAGE = 8;

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
  const [showMetadata, setShowMetadata] = useState(false);
  const [steamGridKind, setSteamGridKind] = useState<SteamGridKind | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [nativeDrop, setNativeDrop] = useState<{ kind: DropKind; mode: DropMode } | null>(null);
  const [fileMenu, setFileMenu] = useState<FileMenu | null>(null);
  const [gameMenu, setGameMenu] = useState<GameMenu | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [listPage, setListPage] = useState(0);
  const selectedRef = useRef<string | null>(null);
  const detailsRef = useRef<GameDetails | null>(null);
  const uploadLock = useRef(false);
  const pendingUploadRef = useRef(false);
  const handleDroppedRef = useRef<(kind: DropKind, sources: PickedSource[]) => Promise<void>>(
    async () => {},
  );
  selectedRef.current = selectedName;
  detailsRef.current = details;
  pendingUploadRef.current = pendingUpload !== null;

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
    setFileMenu(null);
    setGameMenu(null);
    setShowMetadata(false);
    void loadDetails(selectedName, false);
  }, [selectedName, loadDetails]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return games;
    return games.filter((game) => game.name.toLowerCase().includes(needle));
  }, [games, query]);
  const selectedIndex = filtered.findIndex((game) => game.name === selectedName);
  const pageCount = Math.ceil(filtered.length / GAMES_PER_PAGE);
  const currentPage = pageCount === 0 ? 0 : Math.min(listPage, pageCount - 1);
  const pagedGames = filtered.slice(
    currentPage * GAMES_PER_PAGE,
    (currentPage + 1) * GAMES_PER_PAGE,
  );

  useEffect(() => {
    setListPage(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    setListPage(Math.floor(selectedIndex / GAMES_PER_PAGE));
  }, [selectedName]);

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

  function queueMediaUpload(kind: DropKind, sources: PickedSource[], skipped = 0) {
    if (!selectedName || sources.length === 0 || uploadLock.current || pendingUploadRef.current) return;
    const listing = detailsRef.current;
    const reserved =
      kind === "image"
        ? listing?.images.map((file) => file.name) ?? []
        : listing?.videos.map((file) => file.name) ?? [];
    const nextNames = uniqueMediaNames(
      sources.map((source) =>
        standardizedMediaName(source.name, sourceLastModified(source), kind),
      ),
      reserved,
    );
    setPendingUpload({
      kind,
      skipped,
      items: sources.map((source, index) => ({
        source,
        originalName: fileBaseName(source.name),
        nextName: nextNames[index],
      })),
    });
  }

  async function handleUpload(kind: UploadKind) {
    if (!selectedName || uploadLock.current || pendingUploadRef.current) return;
    try {
      const sources = await pickFiles(kind);
      if (kind === "image" || kind === "video") {
        queueMediaUpload(kind, sources);
        return;
      }
      await sendUploads(kind, sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDropped(kind: DropKind, sources: PickedSource[]) {
    if (!selectedName || uploadLock.current || pendingUploadRef.current) return;
    try {
      const timed = await withFileMtimes(sources);
      const accepted = timed.filter((source) =>
        isAcceptedDropFile(kind, source.name, "file" in source ? source.file.type : ""),
      );
      if (accepted.length === 0) {
        setNotice(null);
        setError(dropRejectionMessage(kind));
        return;
      }
      queueMediaUpload(kind, accepted, timed.length - accepted.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

        if (!kind || uploadLock.current || pendingUploadRef.current) {
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

  const detailsReady = Boolean(details && details.name === selectedName);
  const showDetailsShimmer = Boolean(selectedName && !detailsReady && !error);
  function canRemoveGame(name: string): boolean {
    if (details?.name !== name) return true;
    return details.images.length === 0 && details.videos.length === 0;
  }

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
      await loadList(false);
      setSelectedName(created.name);
      await loadDetails(created.name, true);
      setNotice(`Jogo "${created.name}" criado no bucket.`);
    } finally {
      setCreating(false);
    }
  }

  function requestRemoveGame(name: string) {
    if (removing || !canRemoveGame(name)) return;
    setPendingDelete({ type: "game", name });
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

  async function handleRefreshMetadata(): Promise<GameMetadata | null> {
    if (!selectedName || updatingMetadata) return null;
    setUpdatingMetadata(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshGameMetadata(selectedName);
      const metadata = await getGameMetadata(selectedName);
      await loadDetails(selectedName, true);
      setNotice(
        `metadata.json atualizado em ${selectedName}: ${result.images} imagem(ns) e ${result.videos} vídeo(s).`,
      );
      return metadata;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
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
                cachedAt ? ` · cache · ${new Date(cachedAt).toLocaleString("pt-BR")}` : ""
              }`}
        </p>

        <ul
          className={pagedGames.length === GAMES_PER_PAGE ? "game-list is-filled" : "game-list"}
          onContextMenu={(event) => event.preventDefault()}
        >
          {pagedGames.map((game) => {
            const active = game.name === selectedName;
            return (
              <li key={game.name}>
                <button
                  type="button"
                  className={`${active ? "game-item active" : "game-item"}${gameMenu?.name === game.name ? " is-menu" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setShowLocal(false);
                    setSelectedName(game.name);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFileMenu(null);
                    setGameMenu({ x: event.clientX, y: event.clientY, name: game.name });
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
            disabled={pageCount <= 1 || currentPage === 0}
            title="Primeira página"
            aria-label="Primeira página"
            onClick={() => setListPage(0)}
          >
            <Icon name="chevrons-left" />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={pageCount <= 1 || currentPage === 0}
            title="Página anterior"
            aria-label="Página anterior"
            onClick={() => setListPage(Math.max(0, currentPage - 1))}
          >
            <Icon name="chevron-left" />
          </button>
          <span>
            {pageCount === 0 ? "0 / 0" : `${currentPage + 1} / ${pageCount}`}
          </span>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={pageCount <= 1 || currentPage >= pageCount - 1}
            title="Próxima página"
            aria-label="Próxima página"
            onClick={() => setListPage(Math.min(pageCount - 1, currentPage + 1))}
          >
            <Icon name="chevron-right" />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            disabled={pageCount <= 1 || currentPage >= pageCount - 1}
            title="Última página"
            aria-label="Última página"
            onClick={() => setListPage(Math.max(0, pageCount - 1))}
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
                <h2 key={selectedName}>{selectedName}</h2>
                {detailsReady ? (
                  <GameMetadataBadge present={details.hasMetadata === true} />
                ) : showDetailsShimmer ? (
                  <span className="shimmer shimmer-badge" aria-hidden="true" />
                ) : null}
              </div>
              <button
                className="ghost"
                disabled={loadingDetails || uploading !== null}
                title="Ver metadata.json do jogo."
                onClick={() => setShowMetadata(true)}
              >
                <Icon name="file" />
                Metadata
              </button>
            </div>

            {showDetailsShimmer && <DetailsShimmer />}

            {detailsReady && (
              <div className="details-enter">
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
                  hint="Arraste uma ou mais imagens .jpg ou .png para esta área."
                  busy={uploading !== null || removing || pendingUpload !== null}
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
                  {details.images.length > 0 && (
                    <MediaFilesTable
                      kind="image"
                      files={details.images}
                      hasMetadata={details.hasMetadata}
                      menuKey={fileMenu?.file.key}
                      onContextMenu={(event, file) => {
                        if (removing || uploading !== null) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setGameMenu(null);
                        setFileMenu({ x: event.clientX, y: event.clientY, kind: "image", file });
                      }}
                    />
                  )}
                </MediaDropSection>

                <MediaDropSection
                  key={`${selectedName}-video`}
                  kind="video"
                  title="Vídeos"
                  countLabel={metadataCountLabel("vídeo(s) em videos/", details.videos)}
                  hint="Arraste um ou mais vídeos .mp4 para esta área."
                  busy={uploading !== null || removing || pendingUpload !== null}
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
                  {details.videos.length > 0 && (
                    <MediaFilesTable
                      kind="video"
                      files={details.videos}
                      hasMetadata={details.hasMetadata}
                      menuKey={fileMenu?.file.key}
                      onContextMenu={(event, file) => {
                        if (removing || uploading !== null) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setGameMenu(null);
                        setFileMenu({ x: event.clientX, y: event.clientY, kind: "video", file });
                      }}
                    />
                  )}
                </MediaDropSection>
                </div>
              </div>
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

      {fileMenu && (
        <FileContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          disabled={removing || uploading !== null || pendingUpload !== null}
          label={fileMenu.kind === "image" ? `Remover imagem ${fileMenu.file.name}` : `Remover vídeo ${fileMenu.file.name}`}
          onClose={() => setFileMenu(null)}
          onDelete={() => {
            requestRemoveFile(fileMenu.kind, fileMenu.file);
            setFileMenu(null);
          }}
        />
      )}

      {gameMenu && (
        <FileContextMenu
          x={gameMenu.x}
          y={gameMenu.y}
          disabled={removing || uploading !== null || pendingUpload !== null || !canRemoveGame(gameMenu.name)}
          label={
            canRemoveGame(gameMenu.name)
              ? `Remover jogo ${gameMenu.name}`
              : "Remova screenshots e clips antes de excluir o jogo."
          }
          onClose={() => setGameMenu(null)}
          onDelete={() => {
            requestRemoveGame(gameMenu.name);
            setGameMenu(null);
          }}
        />
      )}

      {showMetadata && selectedName && (
        <MetadataViewerDialog
          gameName={selectedName}
          generating={updatingMetadata}
          onClose={() => {
            if (!updatingMetadata) setShowMetadata(false);
          }}
          onGenerate={() => handleRefreshMetadata()}
        />
      )}

      {pendingUpload && (
        <UploadConfirmDialog
          kind={pendingUpload.kind}
          items={pendingUpload.items}
          skipped={pendingUpload.skipped}
          onCancel={() => setPendingUpload(null)}
          onConfirm={() => {
            const { kind, items, skipped } = pendingUpload;
            setPendingUpload(null);
            void sendUploads(
              kind,
              items.map(({ source, nextName }) => ({ ...source, name: nextName })),
              skipped,
            );
          }}
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

function MediaFilesTable({
  kind,
  files,
  hasMetadata,
  menuKey,
  onContextMenu,
}: {
  kind: DropKind;
  files: MediaFile[];
  hasMetadata?: boolean;
  menuKey?: string;
  onContextMenu: (event: MouseEvent, file: MediaFile) => void;
}) {
  const images = kind === "image";
  return (
    <div
      className={images ? "files-table files-images" : "files-table files-videos"}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={images ? "files-head files-images-head" : "files-head files-videos-head"}>
        <span className="files-head-meta" />
        {images ? <span className="files-head-thumb" /> : null}
        <span className="files-head-name">Arquivo</span>
        <span>Inserção</span>
        <span className="files-head-size">Tamanho</span>
      </div>
      <ul className="files">
        {files.map((file, index) => (
          <li
            key={file.key}
            className={`${fileMetaRowClass(file.inMetadata, hasMetadata)}${menuKey === file.key ? " is-menu" : ""}`}
            style={{ "--i": index } as CSSProperties}
            onContextMenu={(event) => onContextMenu(event, file)}
          >
            <MetadataLink linked={file.inMetadata} hasMetadata={hasMetadata} />
            {images ? <CoverThumb src={assetUrl(file.key, file.url)} alt="" className="file-thumb" /> : null}
            <strong title={file.key}>{file.name}</strong>
            <time className="file-date" dateTime={file.insertedAt} title={file.insertedAt}>
              {formatFileDate(file.insertedAt)}
            </time>
            <span className="file-size">{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileContextMenu({
  x,
  y,
  disabled,
  label,
  onClose,
  onDelete,
}: {
  x: number;
  y: number;
  disabled: boolean;
  label: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const left = Math.max(8, Math.min(x, 1024 - 176));
  const top = Math.max(8, Math.min(y, 768 - 52));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer() {
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onPointer, true);
    };
  }, [onClose]);

  return (
    <div
      className="file-context-menu"
      role="menu"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="file-context-delete"
        disabled={disabled}
        title={label}
        aria-label={label}
        onClick={onDelete}
      >
        <Icon name="trash" size={14} />
        Remover
      </button>
    </div>
  );
}

function highlightJson(text: string) {
  const tokens = text.split(/("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g);
  return tokens.map((token, index) => {
    if (!token) return null;
    if (token.startsWith("\"") && tokens[index + 1]?.includes(":")) {
      return (
        <span key={index} className="json-key">
          {token}
        </span>
      );
    }
    if (token.startsWith("\"")) {
      return (
        <span key={index} className="json-string">
          {token}
        </span>
      );
    }
    if (token === "true" || token === "false" || token === "null") {
      return (
        <span key={index} className="json-literal">
          {token}
        </span>
      );
    }
    if (/^-?\d/.test(token)) {
      return (
        <span key={index} className="json-number">
          {token}
        </span>
      );
    }
    return <span key={index}>{token}</span>;
  });
}

function MetadataViewerDialog({
  gameName,
  generating,
  onClose,
  onGenerate,
}: {
  gameName: string;
  generating: boolean;
  onClose: () => void;
  onGenerate: () => Promise<GameMetadata | null>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<GameMetadata | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMetadata(await getGameMetadata(gameName));
    } catch (err) {
      setMetadata(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gameName]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !generating) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generating, onClose]);

  async function handleGenerate() {
    const next = await onGenerate();
    if (next) setMetadata(next);
    else await load();
  }

  const pretty = metadata ? JSON.stringify(metadata, null, 2) : "";

  return (
    <div className="modal-backdrop" role="presentation" onClick={generating ? undefined : onClose}>
      <div
        className="modal confirm-modal metadata-viewer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-viewer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">metadata.json</p>
            <h2 id="metadata-viewer-title">{gameName}</h2>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={onClose}
            disabled={generating}
            title="Fechar"
            aria-label="Fechar"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="confirm-body">
          {loading ? (
            <p className="muted">Carregando metadata.json…</p>
          ) : error ? (
            <p className="missing">{error}</p>
          ) : metadata ? (
            <pre className="json-viewer">{highlightJson(pretty)}</pre>
          ) : (
            <p className="muted">Este jogo não tem metadata.json no bucket.</p>
          )}
        </div>
        <footer>
          <button type="button" className="ghost" disabled={generating} onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="primary" disabled={generating || loading} onClick={() => void handleGenerate()}>
            <Icon name="file" className={generating ? "spin" : undefined} />
            {generating ? "Gerando…" : "Gerar metadata.json"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function UploadConfirmDialog({
  kind,
  items,
  skipped,
  onCancel,
  onConfirm,
}: {
  kind: DropKind;
  items: PendingUpload["items"];
  skipped: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const plural = items.length !== 1;
  const title = kind === "image" ? (plural ? "Enviar imagens" : "Enviar imagem") : plural ? "Enviar vídeos" : "Enviar vídeo";
  const confirmLabel = plural ? `Enviar ${items.length} arquivos` : "Enviar arquivo";
  const skipReason =
    kind === "image" ? "esta área aceita apenas imagens .jpg ou .png" : "esta área aceita apenas vídeos .mp4";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal confirm-modal upload-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Confirmação</p>
            <h2 id="upload-preview-title">{title}</h2>
          </div>
          <button type="button" className="ghost icon-btn" onClick={onCancel} title="Cancelar" aria-label="Cancelar">
            <Icon name="x" />
          </button>
        </header>
        <div className="confirm-body">
          <p>
            Os arquivos serão enviados com o padrão <code>dataehora-nomeoriginal.extensão</code>, usando a data de
            modificação do sistema.
          </p>
          <ul className="upload-preview-list">
            {items.map((item, index) => (
              <li key={`${item.originalName}-${index}`} className="upload-preview-item">
                <strong title={item.nextName}>{item.nextName}</strong>
                <small>
                  {item.originalName === item.nextName ? "Nome já padronizado" : `De ${item.originalName}`}
                </small>
                <code>{mediaDestination(kind, item.nextName)}</code>
              </li>
            ))}
          </ul>
          {skipped > 0 ? (
            <p className="muted">
              {skipped === 1 ? "1 arquivo ignorado" : `${skipped} arquivos ignorados`}: {skipReason}.
            </p>
          ) : null}
        </div>
        <footer>
          <button type="button" className="ghost" autoFocus onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            <Icon name="upload" />
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
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

function DetailsShimmer() {
  return (
    <div className="details-shimmer" role="status" aria-live="polite" aria-label="Carregando mídias">
      <ShimmerAccordion extra={false} />
      <div className="details-media">
        <ShimmerAccordion extra />
        <ShimmerAccordion extra />
      </div>
    </div>
  );
}

function ShimmerAccordion({ extra }: { extra: boolean }) {
  return (
    <section className="media-accordion details-shimmer-card" aria-hidden="true">
      <div className="details-shimmer-head">
        <div className="details-shimmer-copy">
          <span className="shimmer shimmer-line shimmer-line-sm" />
          <span className="shimmer shimmer-line shimmer-line-lg" />
          <span className="shimmer shimmer-line shimmer-line-md" />
        </div>
        {extra ? <span className="shimmer shimmer-icon" /> : null}
        <span className="shimmer shimmer-chevron" />
      </div>
    </section>
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
