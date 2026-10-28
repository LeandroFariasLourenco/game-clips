import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assetUrl,
  coverAssetKey,
  createGame,
  deleteGame,
  formatBytes,
  getGame,
  listGames,
  pickFiles,
  uploadMedia,
} from "./api";
import { CreateGameModal } from "./CreateGameModal";
import type { GameDetails, GameSummary, UploadKind } from "./types";
import "./App.css";

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
  const selectedRef = useRef<string | null>(null);
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

  async function handleUpload(kind: UploadKind) {
    if (!selectedName) return;
    const paths = await pickFiles(kind);
    if (paths.length === 0) return;

    setUploading(kind);
    setError(null);
    setNotice(null);
    try {
      for (const source of paths) {
        await uploadMedia(selectedName, kind, source);
      }
      await loadDetails(selectedName, true);
      setNotice(
        paths.length > 1
          ? `${paths.length} arquivos enviados para ${selectedName}.`
          : `Upload concluído em ${selectedName}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  }

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
                onClick={() => setSelectedName(game.name)}
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

        {!selectedName && <EmptyState />}

        {selectedName && (
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
                    title="Capa"
                    fileName="cover.jpg"
                    present={details.hasCover}
                    src={assetUrl(`${details.name}/cover.jpg`, details.coverUrl)}
                    busy={uploading === "cover"}
                    onUpload={() => void handleUpload("cover")}
                  />
                  <AssetCard
                    title="Banner"
                    fileName="banner.jpg"
                    present={details.hasBanner}
                    src={assetUrl(`${details.name}/banner.jpg`, details.bannerUrl)}
                    busy={uploading === "banner"}
                    onUpload={() => void handleUpload("banner")}
                  />
                  <AssetCard
                    title="Ícone"
                    fileName="icon.png"
                    present={details.hasIcon}
                    src={assetUrl(`${details.name}/icon.png`, details.iconUrl)}
                    busy={uploading === "icon"}
                    onUpload={() => void handleUpload("icon")}
                  />
                </section>

                <section className="panel">
                  <header>
                    <div>
                      <h3>Screenshots</h3>
                      <p className="muted">{details.images.length} arquivo(s) em images/</p>
                    </div>
                    <button
                      className="primary"
                      disabled={uploading !== null}
                      onClick={() => void handleUpload("image")}
                    >
                      {uploading === "image" ? "Enviando…" : "Enviar imagens"}
                    </button>
                  </header>
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
                </section>

                <section className="panel">
                  <header>
                    <div>
                      <h3>Clips</h3>
                      <p className="muted">{details.videos.length} vídeo(s) em videos/</p>
                    </div>
                    <button
                      className="primary"
                      disabled={uploading !== null}
                      onClick={() => void handleUpload("video")}
                    >
                      {uploading === "video" ? "Enviando…" : "Enviar vídeos"}
                    </button>
                  </header>
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
                </section>
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

function AssetCard({
  title,
  fileName,
  present,
  src,
  busy,
  onUpload,
}: {
  title: string;
  fileName: string;
  present: boolean;
  src: string;
  busy: boolean;
  onUpload: () => void;
}) {
  return (
    <article className="asset">
      <CoverThumb className="asset-preview" src={present ? src : undefined} alt={title} />
      <div>
        <h3>{title}</h3>
        <p className="muted">{fileName}</p>
        <p className={present ? "ok" : "missing"}>{present ? "Presente no bucket" : "Ausente"}</p>
        <button className="primary" disabled={busy} onClick={onUpload}>
          {busy ? "Enviando…" : present ? "Substituir" : "Enviar"}
        </button>
      </div>
    </article>
  );
}

export default App;
