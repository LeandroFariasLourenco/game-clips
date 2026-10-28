import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { GameDetails, GamesCatalog, UploadKind } from "./types";

export type PickedSource = { path: string; name: string } | { file: File; name: string };

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

export async function deleteGame(name: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_game", { name });
    return;
  }
  const response = await fetch(`/api/games/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}

export async function uploadMedia(game: string, kind: UploadKind, source: PickedSource) {
  if ("path" in source) {
    return invoke("upload_media", { game, kind, path: source.path });
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
  return paths.map((path) => ({
    path,
    name: path.split(/[\\/]/).pop() || path,
  }));
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
