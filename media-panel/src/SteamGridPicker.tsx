import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import {
  listSteamGridImages,
  searchSteamGridGames,
  uploadFromUrl,
  type SteamGridGameMatch,
  type SteamGridImage,
} from "./api";
import type { SteamGridKind } from "./types";

const KIND_LABEL: Record<SteamGridKind, string> = {
  cover: "capa",
  banner: "banner",
  icon: "ícone",
};

const KIND_SECTION: Record<SteamGridKind, string> = {
  cover: "grids",
  banner: "heroes",
  icon: "icons",
};

function storageKey(gameName: string): string {
  return `media-panel-sgdb-id:${gameName.trim().toLowerCase()}`;
}

function readStoredId(gameName: string): string {
  if (!gameName.trim()) return "";
  try {
    return localStorage.getItem(storageKey(gameName)) || "";
  } catch {
    return "";
  }
}

function storeId(gameName: string, id: string) {
  if (!gameName.trim() || !id) return;
  try {
    localStorage.setItem(storageKey(gameName), id);
  } catch {
    // ignore quota / private mode
  }
}

export function SteamGridPicker({
  gameName,
  kind,
  applyToGame,
  onClose,
  onPicked,
  onApplied,
}: {
  gameName: string;
  kind: SteamGridKind;
  applyToGame?: string;
  onClose: () => void;
  onPicked?: (source: { url: string; name: string; thumb: string }) => void;
  onApplied?: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState(gameName);
  const [gameId, setGameId] = useState(() => readStoredId(gameName));
  const [matches, setMatches] = useState<SteamGridGameMatch[]>([]);
  const [images, setImages] = useState<SteamGridImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const title = useMemo(
    () => `Sugestões SteamGridDB · ${KIND_LABEL[kind]}`,
    [kind],
  );

  async function loadImages(idValue: string, label?: string) {
    const id = Number(idValue);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Informe o ID numérico do jogo no SteamGridDB.");
      return;
    }
    setLoadingImages(true);
    setError(null);
    try {
      const results = await listSteamGridImages(id, kind);
      setImages(results);
      setGameId(String(id));
      if (label) setSelectedName(label);
      storeId(gameName, String(id));
      if (results.length === 0) {
        setError(`Nenhuma imagem na seção ${KIND_SECTION[kind]} para o ID ${id}.`);
      }
    } catch (err) {
      setImages([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingImages(false);
    }
  }

  async function handleSearch(event?: FormEvent) {
    event?.preventDefault();
    const needle = query.trim();
    if (!needle) {
      setError("Informe o nome ou o ID do jogo no SteamGridDB.");
      return;
    }
    if (/^\d+$/.test(needle)) {
      setGameId(needle);
      await loadImages(needle);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const results = await searchSteamGridGames(needle);
      setMatches(results);
      if (results.length === 0) {
        setError("Nenhum jogo encontrado no SteamGridDB.");
      }
    } catch (err) {
      setMatches([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    const stored = readStoredId(gameName);
    if (stored) {
      void loadImages(stored);
      return;
    }
    const needle = gameName.trim();
    if (needle && !needle.startsWith("__")) {
      void handleSearch();
    }
    // Search once when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelect(image: SteamGridImage) {
    const name = `${kind}-${image.id}`;
    if (!applyToGame) {
      onPicked?.({ url: image.url, name, thumb: image.thumb });
      onClose();
      return;
    }

    setApplyingId(image.id);
    setError(null);
    try {
      await uploadFromUrl(applyToGame, kind, image.url);
      await onApplied?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }

  const busy = searching || loadingImages || applyingId !== null;

  return (
    <div className="modal-backdrop steamgrid-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal steamgrid-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">SteamGridDB</p>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={onClose}
            disabled={busy}
            title="Fechar"
            aria-label="Fechar"
          >
            <Icon name="x" />
          </button>
        </header>

        <p className="muted">
          As imagens vêm da seção <strong>{KIND_SECTION[kind]}</strong>. Informe o ID do jogo no
          SteamGridDB ou busque pelo nome para pré-selecionar opções sem baixar arquivos no
          computador.
        </p>

        <form className="steamgrid-search" onSubmit={(event) => void handleSearch(event)}>
          <label className="field">
            Nome ou ID do jogo
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ex.: Hades II ou 5256510"
              disabled={busy}
            />
          </label>
          <label className="field steamgrid-id">
            ID SteamGridDB
            <input
              className="search"
              value={gameId}
              onChange={(event) => setGameId(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="Obrigatório para as imagens"
              inputMode="numeric"
              disabled={busy}
            />
          </label>
          <div className="steamgrid-search-actions">
            <button type="submit" className="ghost" disabled={busy}>
              <Icon name="search" />
              {searching ? "Buscando…" : "Buscar jogo"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !gameId}
              onClick={() => void loadImages(gameId)}
            >
              <Icon name="image" />
              {loadingImages ? "Carregando…" : "Buscar imagens"}
            </button>
          </div>
        </form>

        {matches.length > 0 && (
          <ul className="steamgrid-matches">
            {matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className={gameId === String(match.id) ? "active" : undefined}
                  disabled={busy}
                  onClick={() => {
                    setQuery(match.name);
                    void loadImages(String(match.id), match.name);
                  }}
                >
                  <strong>{match.name}</strong>
                  <span>ID {match.id}{match.verified ? " · verificado" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedName && (
          <p className="muted">
            Usando <strong>{selectedName}</strong> (ID {gameId}).
          </p>
        )}

        {error && <div className="banner error">{error}</div>}

        {images.length > 0 && (
          <div className={`steamgrid-grid kind-${kind}`}>
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                className="steamgrid-option"
                disabled={busy}
                onClick={() => void handleSelect(image)}
              >
                <img src={image.thumb} alt="" />
                <span>
                  {image.width}×{image.height}
                  {applyingId === image.id ? " · enviando…" : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
