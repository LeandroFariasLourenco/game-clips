import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { clearImageCache, CACHE_ROOT } from "./cache.ts";
import { METADATA_FILE, prepareLocalMedia } from "./prepareMedia.ts";
import { getS3, HttpError, loadEnv } from "./s3.ts";

const PANEL_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const LOCAL_MEDIA_ROOT = join(PANEL_ROOT, "..", "media");

const COVER_FILE = "cover.jpg";
const BANNER_FILE = "banner.jpg";
const ICON_FILE = "icon.png";
const THUMB_FILE = "thumb.jpg";
const MANIFEST_FILE = "games.json";
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);
const VIDEO_EXT = new Set([".mp4"]);
const LOG_LIMIT = 200;

export interface LocalGameSummary {
  name: string;
  hasCover: boolean;
  hasBanner: boolean;
  hasIcon: boolean;
  images: number;
  videos: number;
  looseVideos: number;
  thumbs: number;
  missingThumbs: number;
  hasMetadata: boolean;
  other: number;
  bytes: number;
}

export interface LocalMediaDestination {
  bucket: string;
  region: string;
  uri: string;
}

export interface LocalMediaInventory {
  root: string;
  exists: boolean;
  hasManifest: boolean;
  scannedAt: string;
  destination: LocalMediaDestination | null;
  destinationError: string | null;
  totals: {
    games: number;
    files: number;
    bytes: number;
    covers: number;
    banners: number;
    icons: number;
    images: number;
    videos: number;
    looseVideos: number;
    thumbs: number;
    missingThumbs: number;
    metadata: number;
    other: number;
  };
  otherSamples: string[];
  games: LocalGameSummary[];
}

export interface LocalSyncStatus {
  status: "idle" | "running" | "success" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  command: string | null;
  log: string[];
}

interface SyncRuntime extends LocalSyncStatus {
  child: ChildProcess | null;
  pending: string;
}

function idleRuntime(): SyncRuntime {
  return {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    command: null,
    log: [],
    child: null,
    pending: "",
  };
}

function runtime(): SyncRuntime {
  const holder = globalThis as typeof globalThis & { __gameVaultLocalSync?: SyncRuntime };
  if (!holder.__gameVaultLocalSync) holder.__gameVaultLocalSync = idleRuntime();
  return holder.__gameVaultLocalSync;
}

function publicStatus(state: SyncRuntime): LocalSyncStatus {
  return {
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    exitCode: state.exitCode,
    error: state.error,
    command: state.command,
    log: state.log.slice(-LOG_LIMIT),
  };
}

function emptyGame(name: string): LocalGameSummary {
  return {
    name,
    hasCover: false,
    hasBanner: false,
    hasIcon: false,
    images: 0,
    videos: 0,
    looseVideos: 0,
    thumbs: 0,
    missingThumbs: 0,
    hasMetadata: false,
    other: 0,
    bytes: 0,
  };
}

function toPosix(relativePath: string): string {
  return relativePath.split(sep).join("/");
}

export function readLocalDestination(): { destination: LocalMediaDestination | null; error: string | null } {
  try {
    loadEnv();
  } catch (error) {
    return {
      destination: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  const raw = process.env.AWS_S3_BUCKET?.trim() || "";
  if (!raw) {
    return { destination: null, error: "Defina AWS_S3_BUCKET no .env do painel." };
  }

  const bucket = raw.replace(/^s3:\/\//, "").replace(/\/+$/, "");
  return { destination: { bucket, region, uri: `s3://${bucket}` }, error: null };
}

export function resolvePublicBaseUrl(): string {
  loadEnv();
  const explicit = process.env.AWS_S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const { destination, error } = readLocalDestination();
  if (!destination) {
    throw new HttpError(error || "Destino do bucket indisponível.", 400);
  }
  return `https://${destination.bucket}.s3.${destination.region}.amazonaws.com`;
}

async function collectFiles(dir: string, files: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectFiles(abs, files);
      continue;
    }
    if (entry.isFile()) files.push(abs);
  }
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  }
  const workers = Math.min(size, items.length);
  if (workers === 0) return;
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

export async function scanLocalMedia(): Promise<LocalMediaInventory> {
  const scannedAt = new Date().toISOString();
  const { destination, error: destinationError } = readLocalDestination();
  const emptyTotals = {
    games: 0,
    files: 0,
    bytes: 0,
    covers: 0,
    banners: 0,
    icons: 0,
    images: 0,
    videos: 0,
    looseVideos: 0,
    thumbs: 0,
    missingThumbs: 0,
    metadata: 0,
    other: 0,
  };

  if (!existsSync(LOCAL_MEDIA_ROOT)) {
    return {
      root: LOCAL_MEDIA_ROOT,
      exists: false,
      hasManifest: false,
      scannedAt,
      destination,
      destinationError,
      totals: emptyTotals,
      otherSamples: [],
      games: [],
    };
  }

  const games = new Map<string, LocalGameSummary>();
  const rootEntries = await readdir(LOCAL_MEDIA_ROOT, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) games.set(entry.name, emptyGame(entry.name));
  }

  const files: string[] = [];
  await collectFiles(LOCAL_MEDIA_ROOT, files);

  let hasManifest = false;
  let filesCount = 0;
  let bytes = 0;
  const otherSamples: string[] = [];
  const videoFolders = new Map<string, Set<string>>();
  const thumbFolders = new Map<string, Set<string>>();

  await mapPool(files, 32, async (abs) => {
    const info = await stat(abs);
    const rel = toPosix(relative(LOCAL_MEDIA_ROOT, abs));
    const parts = rel.split("/");
    filesCount += 1;
    bytes += info.size;

    if (parts.length === 1) {
      if (parts[0] === MANIFEST_FILE) {
        hasManifest = true;
        return;
      }
      if (otherSamples.length < 30) otherSamples.push(rel);
      emptyTotals.other += 1;
      return;
    }

    const gameName = parts[0];
    const game = games.get(gameName) ?? emptyGame(gameName);
    games.set(gameName, game);
    game.bytes += info.size;

    const nested = parts.slice(1);
    const fileName = nested[nested.length - 1] || "";
    const ext = extname(fileName).toLowerCase();

    if (nested.length === 1 && fileName === COVER_FILE) {
      game.hasCover = true;
      return;
    }
    if (nested.length === 1 && fileName === BANNER_FILE) {
      game.hasBanner = true;
      return;
    }
    if (nested.length === 1 && fileName === ICON_FILE) {
      game.hasIcon = true;
      return;
    }
    if (nested.length === 1 && fileName === METADATA_FILE) {
      game.hasMetadata = true;
      return;
    }
    if (nested[0] === "images" && nested.length >= 2 && IMAGE_EXT.has(ext)) {
      game.images += 1;
      return;
    }
    if (nested[0] === "videos" && nested.length === 3 && fileName === THUMB_FILE) {
      game.thumbs += 1;
      const folders = thumbFolders.get(gameName) ?? new Set<string>();
      folders.add(nested[1]);
      thumbFolders.set(gameName, folders);
      return;
    }
    if (nested[0] === "videos" && VIDEO_EXT.has(ext)) {
      game.videos += 1;
      if (nested.length === 2) game.looseVideos += 1;
      if (nested.length === 3) {
        const folders = videoFolders.get(gameName) ?? new Set<string>();
        folders.add(nested[1]);
        videoFolders.set(gameName, folders);
      }
      return;
    }

    game.other += 1;
    if (otherSamples.length < 30) otherSamples.push(rel);
  });

  for (const game of games.values()) {
    const folders = videoFolders.get(game.name) ?? new Set<string>();
    const thumbs = thumbFolders.get(game.name) ?? new Set<string>();
    game.missingThumbs = [...folders].filter((folder) => !thumbs.has(folder)).length + game.looseVideos;
  }

  const listed = [...games.values()].sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
  const totals = {
    games: listed.length,
    files: filesCount,
    bytes,
    covers: listed.filter((game) => game.hasCover).length,
    banners: listed.filter((game) => game.hasBanner).length,
    icons: listed.filter((game) => game.hasIcon).length,
    images: listed.reduce((sum, game) => sum + game.images, 0),
    videos: listed.reduce((sum, game) => sum + game.videos, 0),
    looseVideos: listed.reduce((sum, game) => sum + game.looseVideos, 0),
    thumbs: listed.reduce((sum, game) => sum + game.thumbs, 0),
    missingThumbs: listed.reduce((sum, game) => sum + game.missingThumbs, 0),
    metadata: listed.filter((game) => game.hasMetadata).length,
    other: emptyTotals.other + listed.reduce((sum, game) => sum + game.other, 0),
  };

  return {
    root: LOCAL_MEDIA_ROOT,
    exists: true,
    hasManifest,
    scannedAt,
    destination,
    destinationError,
    totals,
    otherSamples,
    games: listed,
  };
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnAws(args: string[]) {
  if (process.platform === "win32") {
    const quoted = ["aws", ...args].map(quoteCmd).join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${quoted}"`], {
      windowsVerbatimArguments: true,
      env: process.env,
      windowsHide: true,
    });
  }
  return spawn("aws", args, { env: process.env });
}

function pushLog(state: SyncRuntime, line: string) {
  const text = line.trim();
  if (!text) return;
  state.log.push(text);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function consumeOutput(state: SyncRuntime, chunk: Buffer | string) {
  state.pending += chunk.toString();
  const parts = state.pending.split(/\r\n|\n|\r/);
  state.pending = parts.pop() ?? "";
  for (const part of parts) pushLog(state, part);
}

async function dropPanelCache() {
  await rm(join(CACHE_ROOT, "catalog.json"), { force: true });
  await rm(join(CACHE_ROOT, "games"), { recursive: true, force: true });
  await clearImageCache();
}

export function getLocalSyncStatus(): LocalSyncStatus {
  return publicStatus(runtime());
}

export function beginLocalSync(): LocalSyncStatus {
  const state = runtime();
  if (state.status === "running") {
    throw new HttpError("Já existe um sync em andamento.", 409);
  }
  if (!existsSync(LOCAL_MEDIA_ROOT)) {
    throw new HttpError(`Pasta de mídia não encontrada: ${LOCAL_MEDIA_ROOT}`, 404);
  }

  const { bucket } = getS3();
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  const publicBaseUrl = resolvePublicBaseUrl();
  const args = ["s3", "sync", LOCAL_MEDIA_ROOT, `s3://${bucket}`, "--region", region, "--no-progress"];

  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.exitCode = null;
  state.error = null;
  state.log = [];
  state.pending = "";
  state.command = `aws ${args.join(" ")}`;
  pushLog(state, "1/2 Padronizando vídeos, gerando miniaturas e gravando metadata.json");

  void (async () => {
    try {
      const report = await prepareLocalMedia({
        root: LOCAL_MEDIA_ROOT,
        publicBaseUrl,
        log: (line) => pushLog(state, line),
      });
      pushLog(
        state,
        `Preparação: ${report.moved} movido(s), ${report.renamed} renomeado(s), ${report.thumbs} thumb(s), ${report.metadata} metadata.json`,
      );
      if (state.status !== "running") return;
      pushLog(state, "2/2 Enviando a pasta para o S3");
      pushLog(state, state.command || "");
      startAwsSync(state, args);
    } catch (error) {
      state.status = "error";
      state.child = null;
      state.finishedAt = new Date().toISOString();
      state.error = error instanceof Error ? error.message : String(error);
      pushLog(state, state.error);
    }
  })();

  return publicStatus(state);
}

function startAwsSync(state: SyncRuntime, args: string[]) {
  const child = spawnAws(args);
  state.child = child;

  child.stdout?.on("data", (chunk) => consumeOutput(state, chunk));
  child.stderr?.on("data", (chunk) => consumeOutput(state, chunk));
  child.on("error", (error) => {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    state.status = "error";
    state.child = null;
    state.finishedAt = new Date().toISOString();
    state.error = missing
      ? "AWS CLI não encontrada no PATH. Instale a AWS CLI para sincronizar."
      : error.message;
    pushLog(state, state.error);
  });
  child.on("close", (code) => {
    if (state.pending) pushLog(state, state.pending);
    state.pending = "";
    state.child = null;
    state.exitCode = code;
    state.finishedAt = new Date().toISOString();
    if (state.status !== "running") return;
    if (code === 0) {
      state.status = "success";
      pushLog(state, "Sync concluído.");
      void dropPanelCache().catch((error: unknown) => {
        pushLog(state, error instanceof Error ? error.message : String(error));
      });
      return;
    }
    state.status = "error";
    state.error = `aws s3 sync encerrou com código ${code ?? "?"}.`;
    pushLog(state, state.error);
  });

  return publicStatus(state);
}
