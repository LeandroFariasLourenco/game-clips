import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  GameDetails,
  GameMetadata,
  GameMetadataResult,
  GamesCatalog,
  LocalMediaInventory,
  LocalSyncStatus,
  SteamGridGameMatch,
  SteamGridImage,
  SteamGridKind,
  UploadKind,
} from "./types";

export type PickedSource =
  | { path: string; name: string; lastModified?: number }
  | { file: File; name: string }
  | { url: string; name: string; thumb?: string };

export type { SteamGridGameMatch, SteamGridImage, SteamGridKind };

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function assetUrl(key: string, remoteUrl: string): string {
  if (isTauri()) return remoteUrl;
  return `/api/asset?key=${encodeURIComponent(key)}`;
}

export function coverAssetKey(name: string): string {
  return `${name}/cover.jpg`;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) return payload.error;
  } catch {
    // ignore parse errors
  }
  return `Falha HTTP ${response.status}`;
}

export async function listGames(refresh = false): Promise<GamesCatalog> {
  if (isTauri()) return invoke("list_games", { refresh });
  const response = await fetch(`/api/games${refresh ? "?refresh=1" : ""}`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getGame(name: string, refresh = false): Promise<GameDetails> {
  if (isTauri()) return invoke("get_game", { name, refresh });
  const response = await fetch(
    `/api/games/${encodeURIComponent(name)}${refresh ? "?refresh=1" : ""}`,
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function createGame(name: string): Promise<GameDetails> {
  if (isTauri()) return invoke("create_game", { name });
  const response = await fetch("/api/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getGameMetadata(name: string): Promise<GameMetadata | null> {
  if (isTauri()) return invoke("get_game_metadata", { name });
  const response = await fetch(`/api/games/${encodeURIComponent(name)}/metadata`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function refreshGameMetadata(name: string): Promise<GameMetadataResult> {
  if (isTauri()) return invoke("refresh_game_metadata", { name });
  const response = await fetch(`/api/games/${encodeURIComponent(name)}/metadata`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function deleteGame(name: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_game", { name });
    return;
  }
  const response = await fetch(`/api/games/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}

export async function deleteMediaFile(name: string, key: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_media", { name, key });
    return;
  }
  const response = await fetch(
    `/api/games/${encodeURIComponent(name)}/file?key=${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(await readError(response));
}

export async function searchSteamGridGames(query: string): Promise<SteamGridGameMatch[]> {
  const response = await fetch(`/api/steamgrid/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { games: SteamGridGameMatch[] };
  return payload.games;
}

export async function listSteamGridImages(
  id: number,
  kind: SteamGridKind,
): Promise<SteamGridImage[]> {
  const response = await fetch(
    `/api/steamgrid/images?id=${encodeURIComponent(String(id))}&kind=${encodeURIComponent(kind)}`,
  );
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { images: SteamGridImage[] };
  return payload.images;
}

export async function uploadFromUrl(game: string, kind: SteamGridKind, url: string) {
  const response = await fetch("/api/upload-from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game, kind, url }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{ key: string; url: string }>;
}

export async function uploadMedia(game: string, kind: UploadKind, source: PickedSource) {
  if ("url" in source) {
    if (kind !== "cover" && kind !== "banner" && kind !== "icon") {
      throw new Error("SteamGridDB só cobre capa, banner e ícone.");
    }
    return uploadFromUrl(game, kind, source.url);
  }

  if ("path" in source) {
    return invoke("upload_media", { game, kind, path: source.path, fileName: source.name });
  }

  const response = await fetch(
    `/api/upload?game=${encodeURIComponent(game)}&kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(source.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": source.file.type || "application/octet-stream" },
      body: source.file,
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{ key: string; url: string }>;
}

const FILTERS: Record<UploadKind, { name: string; extensions: string[] }> = {
  cover: { name: "Capa JPEG", extensions: ["jpg", "jpeg"] },
  banner: { name: "Banner JPEG", extensions: ["jpg", "jpeg"] },
  icon: { name: "Ícone PNG", extensions: ["png"] },
  image: { name: "Imagens", extensions: ["jpg", "jpeg", "png"] },
  video: { name: "Vídeo MP4", extensions: ["mp4"] },
};

const ACCEPT: Record<UploadKind, string> = {
  cover: ".jpg,.jpeg,image/jpeg",
  banner: ".jpg,.jpeg,image/jpeg",
  icon: ".png,image/png",
  image: ".jpg,.jpeg,.png,image/jpeg,image/png",
  video: ".mp4,video/mp4",
};

const DROP_EXTENSIONS: Record<"image" | "video", readonly string[]> = {
  image: ["jpg", "jpeg", "png"],
  video: ["mp4"],
};

const DROP_MIME: Record<"image" | "video", readonly string[]> = {
  image: ["image/jpeg", "image/jpg", "image/png"],
  video: ["video/mp4"],
};

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() || name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isAcceptedDropFile(kind: "image" | "video", name: string, mime = ""): boolean {
  const ext = fileExtension(name);
  if (ext) return DROP_EXTENSIONS[kind].includes(ext);
  return DROP_MIME[kind].includes(mime.toLowerCase());
}

export function dropRejectionMessage(kind: "image" | "video"): string {
  return kind === "image"
    ? "Esta área aceita apenas imagens .jpg ou .png."
    : "Esta área aceita apenas vídeos .mp4.";
}

export function classifyDragItems(
  kind: "image" | "video",
  items: DataTransferItemList | undefined,
): "accept" | "reject" | "unknown" {
  if (!items) return "unknown";
  const files = Array.from(items).filter((item) => item.kind === "file");
  if (files.length === 0) return "reject";

  let sawAllowed = false;
  let sawBlocked = false;
  for (const item of files) {
    const type = item.type.toLowerCase();
    if (!type || type === "application/octet-stream") continue;
    if (DROP_MIME[kind].includes(type)) sawAllowed = true;
    else sawBlocked = true;
  }
  if (sawAllowed) return "accept";
  if (sawBlocked) return "reject";
  return "unknown";
}

function pickWithInput(kind: UploadKind): Promise<PickedSource[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT[kind];
    input.multiple = kind === "image" || kind === "video";
    input.onchange = () => {
      const files = [...(input.files || [])].map((file) => ({ file, name: file.name }));
      resolve(files);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function pickFiles(kind: UploadKind): Promise<PickedSource[]> {
  if (!isTauri()) return pickWithInput(kind);

  const selected = await open({
    multiple: kind === "image" || kind === "video",
    directory: false,
    filters: [FILTERS[kind]],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return withFileMtimes(
    paths.map((path) => ({
      path,
      name: path.split(/[\\/]/).pop() || path,
    })),
  );
}

export function sourceLastModified(source: PickedSource): number {
  if ("file" in source) return source.file.lastModified;
  if ("path" in source) return source.lastModified ?? Date.now();
  return Date.now();
}

export async function withFileMtimes(sources: PickedSource[]): Promise<PickedSource[]> {
  const pathIndexes: number[] = [];
  const paths: string[] = [];
  sources.forEach((source, index) => {
    if ("path" in source) {
      pathIndexes.push(index);
      paths.push(source.path);
    }
  });
  if (paths.length === 0) return sources;
  const times = await invoke<number[]>("file_mtimes", { paths });
  return sources.map((source, index) => {
    const timeIndex = pathIndexes.indexOf(index);
    if (timeIndex < 0 || !("path" in source)) return source;
    return { ...source, lastModified: times[timeIndex] };
  });
}

export async function getLocalMedia(): Promise<LocalMediaInventory> {
  const response = await fetch("/api/local-media");
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getLocalSync(): Promise<LocalSyncStatus> {
  const response = await fetch("/api/local-media/sync");
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function startLocalSync(): Promise<LocalSyncStatus> {
  const response = await fetch("/api/local-media/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "SYNC" }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export function formatFileDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
