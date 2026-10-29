import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import {
  coverKey,
  forgetAsset,
  imageKeysForGame,
  invalidateGame,
  isKnownMissing,
  markMissing,
  mimeOfKey,
  readAsset,
  readCatalog,
  readGameDetails,
  removeCatalogGame,
  removeGameAssets,
  upsertCatalogGame,
  withAssetLock,
  writeAsset,
  writeCatalog,
  writeGameDetails,
} from "./cache.ts";
import {
  buildGameMetadata,
  isLinkedInMetadata,
  kindUpdatesGameMetadata,
  listingFromObjectKeys,
  metadataMediaPaths,
  metadataObjectKey,
  parseGameMetadata,
  serializeGameMetadata,
  type GameMetadata,
  type GameMetadataWriteResult,
} from "./gameMetadata.ts";

export class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const COVER_FILE = "cover.jpg";
const BANNER_FILE = "banner.jpg";
const ICON_FILE = "icon.png";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export interface GameSummary {
  name: string;
  coverUrl: string;
}

export interface MediaFile {
  name: string;
  key: string;
  url: string;
  size: number;
  inMetadata?: boolean;
}

export interface GameDetails {
  name: string;
  coverUrl: string;
  bannerUrl: string;
  iconUrl: string;
  hasCover: boolean;
  hasBanner: boolean;
  hasIcon: boolean;
  hasMetadata?: boolean;
  images: MediaFile[];
  videos: MediaFile[];
  fromCache?: boolean;
  cachedAt?: string;
}

export interface GamesCatalog {
  games: GameSummary[];
  fromCache: boolean;
  cachedAt: string | null;
}

export function loadEnv() {
  const envPath = join(ROOT, ".env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // O painel ainda pode usar variáveis já exportadas no ambiente.
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Defina ${name} no arquivo .env do painel.`);
  }
  return value;
}

function encodePath(segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split("/"))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function publicUrl(base: string, segments: string[]): string {
  return `${base.replace(/\/+$/, "")}/${encodePath(segments)}`;
}

function mediaUrl(base: string, key: string): string {
  return publicUrl(base, key.split("/"));
}

const INVALID_NAME = /[\\/:*?"<>|\u0000]/;

function sanitizeGameName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (!value || value === "." || value === "..") {
    throw new HttpError("Informe um nome de jogo válido.", 400);
  }
  if (INVALID_NAME.test(value)) {
    throw new HttpError('O nome não pode conter \\ / : * ? " < > |', 400);
  }
  return value;
}

function mimeOf(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isVideoFile(fileName: string): boolean {
  return [".mp4", ".webm", ".mkv", ".mov", ".avi"].includes(extname(fileName).toLowerCase());
}

let cached: { client: S3Client; bucket: string; publicBaseUrl: string } | null = null;

export function getS3() {
  if (cached) return cached;
  loadEnv();
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  const bucket = required("AWS_S3_BUCKET").replace(/^s3:\/\//, "").replace(/\/+$/, "");
  const publicBaseUrl =
    process.env.AWS_S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    `https://${bucket}.s3.${region}.amazonaws.com`;

  cached = {
    bucket,
    publicBaseUrl,
    client: new S3Client({
      region,
      credentials: {
        accessKeyId: required("AWS_ACCESS_KEY_ID"),
        secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
      },
    }),
  };
  return cached;
}

async function objectExists(key: string): Promise<boolean> {
  const { client, bucket } = getS3();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw error;
  }
}

async function listAll(prefix: string): Promise<_Object[]> {
  const { client, bucket } = getS3();
  const objects: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents || []) {
      if (item.Key && !item.Key.endsWith("/")) objects.push(item);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function listGamesFromS3(): Promise<GameSummary[]> {
  const { client, bucket, publicBaseUrl } = getS3();
  const names: string[] = [];
  let token: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Delimiter: "/",
        ContinuationToken: token,
      }),
    );
    for (const prefix of page.CommonPrefixes || []) {
      const name = (prefix.Prefix || "").replace(/\/+$/, "").trim();
      if (name) names.push(name);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  names.sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));

  return [...new Set(names)].map((name) => ({
    name,
    coverUrl: publicUrl(publicBaseUrl, [name, COVER_FILE]),
  }));
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
  await Promise.all(Array.from({ length: Math.min(size, items.length) || 0 }, () => worker()));
}

export async function prefetchAssets(keys: string[], options?: { refresh?: boolean }): Promise<void> {
  await mapPool(keys, 6, async (key) => {
    await getAsset(key, options).catch(() => undefined);
  });
}

export async function listGames(options?: { refresh?: boolean }): Promise<GamesCatalog> {
  if (!options?.refresh) {
    const cached = await readCatalog();
    if (cached) {
      void prefetchAssets(cached.games.map((game) => coverKey(game.name)));
      return { games: cached.games, fromCache: true, cachedAt: cached.updatedAt };
    }
  }

  const games = await listGamesFromS3();
  const catalog = await writeCatalog(games);
  void prefetchAssets(
    games.map((game) => coverKey(game.name)),
    { refresh: options?.refresh },
  );
  return { games, fromCache: false, cachedAt: catalog.updatedAt };
}

function groupVideos(game: string, objects: _Object[]): MediaFile[] {
  const { publicBaseUrl } = getS3();
  const prefix = `${game}/videos/`;
  const folderVideos: MediaFile[] = [];
  const usedFolders = new Set<string>();
  const loose: _Object[] = [];

  for (const object of objects) {
    const key = object.Key || "";
    const relative = key.slice(prefix.length);
    if (!relative) continue;
    const slash = relative.indexOf("/");
    if (slash < 0) {
      if (isVideoFile(relative)) loose.push(object);
      continue;
    }
    const folder = relative.slice(0, slash);
    const fileName = relative.slice(slash + 1);
    if (!folder || !fileName || fileName.includes("/") || !isVideoFile(fileName)) continue;
    usedFolders.add(folder);
    folderVideos.push({
      name: folder,
      key,
      url: mediaUrl(publicBaseUrl, key),
      size: object.Size ?? 0,
    });
  }

  for (const object of loose) {
    const key = object.Key || "";
    const name = key.slice(prefix.length);
    const stem = name.replace(/\.[^.]+$/, "");
    if (usedFolders.has(stem)) continue;
    folderVideos.push({
      name,
      key,
      url: mediaUrl(publicBaseUrl, key),
      size: object.Size ?? 0,
    });
  }

  return folderVideos.sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
}

function markLinked(files: MediaFile[], paths: Set<string>): MediaFile[] {
  return files.map((file) => ({
    ...file,
    inMetadata: isLinkedInMetadata(file.key, paths) || isLinkedInMetadata(file.url, paths),
  }));
}

function detailsHaveMetadataFlags(details: GameDetails): boolean {
  return typeof details.hasMetadata === "boolean";
}

async function readStoredMetadata(game: string): Promise<GameMetadata | null> {
  const { client, bucket } = getS3();
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: metadataObjectKey(game) }),
    );
    const text = await object.Body?.transformToString();
    return text ? parseGameMetadata(text) : null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
    throw error;
  }
}

async function getGameFromS3(name: string): Promise<GameDetails> {
  const { publicBaseUrl } = getS3();
  const game = sanitizeGameName(name);
  const [hasCover, hasBanner, hasIcon, imageObjects, videoObjects, metadata] = await Promise.all([
    objectExists(`${game}/${COVER_FILE}`),
    objectExists(`${game}/${BANNER_FILE}`),
    objectExists(`${game}/${ICON_FILE}`),
    listAll(`${game}/images/`),
    listAll(`${game}/videos/`),
    readStoredMetadata(game),
  ]);
  const linked = metadataMediaPaths(metadata);

  const images = imageObjects
    .map((object) => {
      const key = object.Key || "";
      const fileName = key.split("/").pop() || "";
      return {
        name: fileName,
        key,
        url: mediaUrl(publicBaseUrl, key),
        size: object.Size ?? 0,
      };
    })
    .filter((file) => file.name && !file.name.includes("/"))
    .sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));

  return {
    name: game,
    coverUrl: publicUrl(publicBaseUrl, [game, COVER_FILE]),
    bannerUrl: publicUrl(publicBaseUrl, [game, BANNER_FILE]),
    iconUrl: publicUrl(publicBaseUrl, [game, ICON_FILE]),
    hasCover,
    hasBanner,
    hasIcon,
    hasMetadata: metadata !== null,
    images: markLinked(images, linked.images),
    videos: markLinked(groupVideos(game, videoObjects), linked.videos),
  };
}

export async function refreshGameMetadata(name: string): Promise<GameMetadataWriteResult> {
  const { client, bucket, publicBaseUrl } = getS3();
  const game = sanitizeGameName(name);
  const [imageObjects, videoObjects] = await Promise.all([
    listAll(`${game}/images/`),
    listAll(`${game}/videos/`),
  ]);
  const keys = [...imageObjects, ...videoObjects]
    .map((object) => object.Key || "")
    .filter(Boolean);
  const metadata = buildGameMetadata(game, publicBaseUrl, listingFromObjectKeys(game, keys));
  const key = metadataObjectKey(game);
  const body = serializeGameMetadata(metadata);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-cache",
    }),
  );
  await invalidateGame(game);

  return {
    key,
    url: mediaUrl(publicBaseUrl, key),
    images: metadata.images.length,
    videos: metadata.videos.length,
  };
}

export async function getGame(name: string, options?: { refresh?: boolean }): Promise<GameDetails> {
  const game = sanitizeGameName(name);
  if (!options?.refresh) {
    const cached = await readGameDetails(game);
    if (cached && detailsHaveMetadataFlags(cached)) {
      void prefetchAssets(imageKeysForGame(cached));
      return { ...cached, fromCache: true };
    }
  }

  const details = await getGameFromS3(game);
  const cached = await writeGameDetails(details);
  void prefetchAssets(imageKeysForGame(details), { refresh: options?.refresh });
  return { ...cached, fromCache: false };
}

export async function getAsset(
  key: string,
  options?: { refresh?: boolean },
): Promise<{ body: Buffer; contentType: string; fromCache: boolean } | null> {
  const normalized = key.trim().replace(/^\/+/, "");
  if (!options?.refresh) {
    const cached = await readAsset(normalized);
    if (cached) return { body: cached, contentType: mimeOfKey(normalized), fromCache: true };
    if (await isKnownMissing(normalized)) return null;
  }

  return withAssetLock(normalized, async () => {
    if (!options?.refresh) {
      const cached = await readAsset(normalized);
      if (cached) return cached;
      if (await isKnownMissing(normalized)) return null;
    }

    const { client, bucket } = getS3();
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: normalized }));
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) {
        await markMissing(normalized);
        return null;
      }
      const body = Buffer.from(bytes);
      await writeAsset(normalized, body);
      return body;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
        await markMissing(normalized);
        return null;
      }
      throw error;
    }
  }).then(async (body) => {
    if (!body) return null;
    return { body, contentType: mimeOfKey(normalized), fromCache: false };
  });
}

export async function uploadMedia(input: {
  game: string;
  kind: string;
  fileName: string;
  body: Buffer;
  contentType?: string;
  skipExtensionCheck?: boolean;
}): Promise<{ key: string; url: string }> {
  const { client, bucket, publicBaseUrl } = getS3();
  const game = sanitizeGameName(input.game);
  const ext = extname(input.fileName).toLowerCase();
  const stem = basename(input.fileName, extname(input.fileName));

  let key: string;
  switch (input.kind) {
    case "cover":
      if (!input.skipExtensionCheck && ext !== ".jpg" && ext !== ".jpeg") {
        throw new Error("A capa deve ser um arquivo .jpg.");
      }
      key = `${game}/${COVER_FILE}`;
      break;
    case "banner":
      if (!input.skipExtensionCheck && ext !== ".jpg" && ext !== ".jpeg") {
        throw new Error("O banner deve ser um arquivo .jpg.");
      }
      key = `${game}/${BANNER_FILE}`;
      break;
    case "icon":
      if (!input.skipExtensionCheck && ext !== ".png") {
        throw new Error("O ícone deve ser um arquivo .png.");
      }
      key = `${game}/${ICON_FILE}`;
      break;
    case "image": {
      const normalized = ext === ".jpeg" || ext === ".jpg" ? "jpg" : ext === ".png" ? "png" : "";
      if (!normalized) throw new Error("Extensão não permitida na galeria. Use .jpg ou .png.");
      key = `${game}/images/${stem}.${normalized}`;
      break;
    }
    case "video":
      if (ext !== ".mp4") throw new Error("Os clips devem ser arquivos .mp4.");
      key = `${game}/videos/${stem}/${stem}.mp4`;
      break;
    default:
      throw new Error(`Tipo de upload desconhecido: ${input.kind}`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType || mimeOf(input.fileName),
    }),
  );

  if (input.kind !== "video") {
    await writeAsset(key, input.body);
  }
  if (kindUpdatesGameMetadata(input.kind)) {
    await refreshGameMetadata(game);
  }
  await invalidateGame(game);

  return { key, url: mediaUrl(publicBaseUrl, key) };
}

async function putFolder(key: string): Promise<void> {
  const { client, bucket } = getS3();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key.endsWith("/") ? key : `${key}/`,
      Body: Buffer.alloc(0),
      ContentType: "application/x-directory",
    }),
  );
}

async function prefixExists(prefix: string): Promise<boolean> {
  const { client, bucket } = getS3();
  const page = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1,
    }),
  );
  return Boolean(page.KeyCount || page.Contents?.length || page.CommonPrefixes?.length);
}

async function listAllKeys(prefix: string): Promise<string[]> {
  const { client, bucket } = getS3();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function createGame(name: string): Promise<GameDetails> {
  const game = sanitizeGameName(name);
  const existing = await listGamesFromS3();
  const clash = existing.find(
    (item) => item.name.localeCompare(game, "pt", { sensitivity: "accent" }) === 0,
  );
  if (clash) {
    throw new HttpError(
      clash.name === game
        ? `Já existe um jogo com a pasta "${game}".`
        : `Já existe a pasta "${clash.name}" (o bucket diferencia maiúsculas/minúsculas).`,
      409,
    );
  }
  if (await prefixExists(`${game}/`)) {
    throw new HttpError(`Já existe conteúdo na pasta "${game}/" do bucket.`, 409);
  }

  await putFolder(`${game}/images/`);
  await putFolder(`${game}/videos/`);
  await refreshGameMetadata(game);

  const { publicBaseUrl } = getS3();
  const summary = {
    name: game,
    coverUrl: publicUrl(publicBaseUrl, [game, COVER_FILE]),
  };
  await upsertCatalogGame(summary);

  const details: GameDetails = {
    name: game,
    coverUrl: summary.coverUrl,
    bannerUrl: publicUrl(publicBaseUrl, [game, BANNER_FILE]),
    iconUrl: publicUrl(publicBaseUrl, [game, ICON_FILE]),
    hasCover: false,
    hasBanner: false,
    hasIcon: false,
    hasMetadata: true,
    images: [],
    videos: [],
    fromCache: false,
  };
  await writeGameDetails(details);
  return details;
}

export async function deleteMediaFile(name: string, key: string): Promise<{ deleted: string[] }> {
  const game = sanitizeGameName(name);
  const keys = await keysForMediaDelete(game, key);
  if (keys.length === 0) {
    throw new HttpError("Arquivo não encontrado no bucket.", 404);
  }

  const { client, bucket } = getS3();
  for (const objectKey of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    await forgetAsset(objectKey);
  }
  await refreshGameMetadata(game);
  await invalidateGame(game);
  return { deleted: keys };
}

async function keysForMediaDelete(game: string, key: string): Promise<string[]> {
  const normalized = key.trim().replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new HttpError("Chave de mídia inválida.", 400);
  }

  const imagePrefix = `${game}/images/`;
  const videoPrefix = `${game}/videos/`;

  if (normalized.startsWith(imagePrefix)) {
    const relative = normalized.slice(imagePrefix.length);
    if (!relative || relative.includes("/")) {
      throw new HttpError("Só é possível remover screenshots em images/.", 400);
    }
    return [normalized];
  }

  if (normalized.startsWith(videoPrefix)) {
    const relative = normalized.slice(videoPrefix.length);
    if (!relative) {
      throw new HttpError("Só é possível remover clips em videos/.", 400);
    }
    const slash = relative.indexOf("/");
    if (slash < 0) {
      return [normalized];
    }
    const folder = relative.slice(0, slash);
    const rest = relative.slice(slash + 1);
    if (!folder || !rest || rest.includes("/")) {
      throw new HttpError("Só é possível remover clips em videos/.", 400);
    }
    const folderKeys = await listAllKeys(`${game}/videos/${folder}/`);
    return folderKeys.length > 0 ? folderKeys : [normalized];
  }

  throw new HttpError("Só é possível remover screenshots em images/ ou clips em videos/.", 400);
}

export async function deleteGame(name: string): Promise<void> {
  const game = sanitizeGameName(name);
  const live = await getGameFromS3(game);
  if (live.images.length > 0 || live.videos.length > 0) {
    throw new HttpError(
      `Não é possível remover "${game}": ainda há ${live.images.length} screenshot(s) e ${live.videos.length} clip(s).`,
      409,
    );
  }

  const allowed = new Set([
    `${game}/`,
    `${game}/${COVER_FILE}`,
    `${game}/${BANNER_FILE}`,
    `${game}/${ICON_FILE}`,
    metadataObjectKey(game),
    `${game}/images/`,
    `${game}/videos/`,
  ]);
  const keys = await listAllKeys(`${game}/`);
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new HttpError(
      `Não é possível remover "${game}": a pasta ainda contém arquivos além do branding canônico.`,
      409,
    );
  }

  const { client, bucket } = getS3();
  for (const key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  await removeCatalogGame(game);
  await removeGameAssets(game);
}
