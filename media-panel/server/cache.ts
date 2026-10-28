import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameDetails, GameSummary } from "./s3.ts";

export const CACHE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", ".cache");
const CATALOG_FILE = join(CACHE_ROOT, "catalog.json");
const GAMES_DIR = join(CACHE_ROOT, "games");
const IMAGES_DIR = join(CACHE_ROOT, "images");

export interface CatalogCache {
  version: 1;
  updatedAt: string;
  games: GameSummary[];
}

export interface GameDetailsCache extends GameDetails {
  cachedAt: string;
}

const inflightAssets = new Map<string, Promise<Buffer | null>>();

function safeKey(key: string): string {
  const value = key.trim().replace(/^\/+/, "");
  if (!value || value.includes("..") || value.includes("\\") || value.includes("\0")) {
    throw new Error("Chave de mídia inválida.");
  }
  return value;
}

function gameMetaPath(name: string): string {
  return join(GAMES_DIR, `${safeKey(name)}.json`);
}

function assetPath(key: string): string {
  return join(IMAGES_DIR, ...safeKey(key).split("/"));
}

function missingPath(key: string): string {
  return `${assetPath(key)}.missing`;
}

export function mimeOfKey(key: string): string {
  switch (extname(key).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

async function ensureDirs() {
  await mkdir(GAMES_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });
}

export async function readCatalog(): Promise<CatalogCache | null> {
  try {
    const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as CatalogCache;
    if (raw?.version !== 1 || !Array.isArray(raw.games)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function writeCatalog(games: GameSummary[]): Promise<CatalogCache> {
  await ensureDirs();
  const catalog: CatalogCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    games,
  };
  await writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  return catalog;
}

export async function readGameDetails(name: string): Promise<GameDetailsCache | null> {
  try {
    return JSON.parse(await readFile(gameMetaPath(name), "utf8")) as GameDetailsCache;
  } catch {
    return null;
  }
}

export async function writeGameDetails(details: GameDetails): Promise<GameDetailsCache> {
  await ensureDirs();
  const cached: GameDetailsCache = { ...details, cachedAt: new Date().toISOString() };
  await writeFile(gameMetaPath(details.name), JSON.stringify(cached, null, 2));
  return cached;
}

export async function invalidateGame(name: string): Promise<void> {
  await unlink(gameMetaPath(name)).catch(() => undefined);
}

export async function readAsset(key: string): Promise<Buffer | null> {
  const normalized = safeKey(key);
  try {
    return await readFile(assetPath(normalized));
  } catch {
    return null;
  }
}

export async function isKnownMissing(key: string): Promise<boolean> {
  try {
    await readFile(missingPath(safeKey(key)));
    return true;
  } catch {
    return false;
  }
}

export async function writeAsset(key: string, body: Buffer): Promise<void> {
  const normalized = safeKey(key);
  await ensureDirs();
  const file = assetPath(normalized);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  await unlink(missingPath(normalized)).catch(() => undefined);
}

export async function markMissing(key: string): Promise<void> {
  const normalized = safeKey(key);
  await ensureDirs();
  const file = missingPath(normalized);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "");
  await unlink(assetPath(normalized)).catch(() => undefined);
}

export async function forgetAsset(key: string): Promise<void> {
  const normalized = safeKey(key);
  await unlink(assetPath(normalized)).catch(() => undefined);
  await unlink(missingPath(normalized)).catch(() => undefined);
}

export async function withAssetLock(key: string, factory: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const normalized = safeKey(key);
  const pending = inflightAssets.get(normalized);
  if (pending) return pending;
  const next = factory().finally(() => inflightAssets.delete(normalized));
  inflightAssets.set(normalized, next);
  return next;
}

export async function clearImageCache(): Promise<void> {
  await rm(IMAGES_DIR, { recursive: true, force: true });
  await mkdir(IMAGES_DIR, { recursive: true });
}

export function imageKeysForGame(details: GameDetails): string[] {
  const keys = [];
  if (details.hasCover) keys.push(`${details.name}/cover.jpg`);
  if (details.hasBanner) keys.push(`${details.name}/banner.jpg`);
  if (details.hasIcon) keys.push(`${details.name}/icon.png`);
  for (const image of details.images) keys.push(image.key);
  return keys;
}

export function coverKey(name: string): string {
  return `${name}/cover.jpg`;
}

export async function upsertCatalogGame(game: GameSummary): Promise<CatalogCache> {
  const catalog = await readCatalog();
  const games = (catalog?.games || []).filter((item) => item.name !== game.name);
  games.push(game);
  games.sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
  return writeCatalog(games);
}

export async function removeCatalogGame(name: string): Promise<void> {
  const catalog = await readCatalog();
  if (!catalog) return;
  await writeCatalog(catalog.games.filter((item) => item.name !== name));
}

export async function removeGameAssets(name: string): Promise<void> {
  await invalidateGame(name);
  await rm(join(IMAGES_DIR, safeKey(name)), { recursive: true, force: true });
}
