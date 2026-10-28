import { DOMParser, Node } from "@xmldom/xmldom";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = DOMParser;
}
if (typeof globalThis.Node === "undefined") {
  globalThis.Node = Node;
}

const BRANDING = {
  cover: "cover.jpg",
  banner: "banner.jpg",
  icon: "icon.png",
};

const VIDEO_THUMB_FILE = "thumb.jpg";
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);

const MIME_TYPES = {
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
};

let s3;

export default {
  async fetch(request, env) {
    const allowOrigin = corsOrigin(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Método não permitido" }, 405, allowOrigin);
    }

    try {
      return await handle(request, env, allowOrigin);
    } catch (error) {
      if (isMissing(error)) return json({ error: "Não encontrado" }, 404, allowOrigin);
      console.error(error);
      return json({ error: error?.message || "Erro interno" }, 500, allowOrigin);
    }
  },
};

async function handle(request, env, allowOrigin) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) {
    return serveRootGames(request, env, allowOrigin);
  }

  const game = sanitizeGameName(parts[0]);
  if (!game) return json({ error: "Nome de jogo inválido" }, 400, allowOrigin);

  if (parts.length === 2 && parts[1] === "meta") {
    return serveMeta(request, env, allowOrigin, game);
  }

  if (parts[1] === "images") {
    if (parts.length === 2) return serveListing(request, env, allowOrigin, game, "images");
    if (parts.length === 3) {
      return serveObject(request, env, allowOrigin, `${game}/images/${parts[2]}`);
    }
  }

  if (parts[1] === "videos") {
    if (parts.length === 2) return serveVideoListing(request, env, allowOrigin, game);
    if (parts.length >= 3) {
      const rest = parts.slice(2);
      if (rest.some((segment) => segment === ".." || segment === ".")) {
        return json({ error: "Caminho inválido" }, 400, allowOrigin);
      }
      return serveObject(request, env, allowOrigin, `${game}/videos/${rest.join("/")}`);
    }
  }

  if (parts.length === 2 && isBranding(parts[1])) {
    return serveObject(request, env, allowOrigin, `${game}/${parts[1]}`);
  }

  return json({ error: "Rota não encontrada" }, 404, allowOrigin);
}

async function serveRootGames(request, env, allowOrigin) {
  const base = originBase(request);
  const names = [];
  let token;

  do {
    const page = await client(env).send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET_NAME,
        Delimiter: "/",
        ContinuationToken: token,
      })
    );

    for (const prefix of page.CommonPrefixes || []) {
      const raw = prefix.Prefix || "";
      const name = raw.replace(/\/+$/, "").trim();
      if (!name) continue;
      names.push(name);
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  names.sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));

  const games = names.map((name) => ({
    name,
    cover: `${base}/${encodePath(name)}/${BRANDING.cover}`,
  }));

  return json(games, 200, allowOrigin);
}

async function serveMeta(request, env, allowOrigin, game) {
  const base = `${originBase(request)}/${encodePath(game)}`;
  const assets = { cover: null, banner: null, icon: null };

  await Promise.all(
    Object.entries(BRANDING).map(async ([key, fileName]) => {
      try {
        const head = await client(env).send(
          new HeadObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: `${game}/${fileName}` })
        );
        assets[key] = listedFile(
          fileName,
          fileName,
          head.ContentLength,
          head.LastModified,
          head.ContentType,
          `${base}/${encodePath(fileName)}`
        );
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    })
  );

  return json(assets, 200, allowOrigin);
}

async function serveListing(request, env, allowOrigin, game, folder) {
  const prefix = `${game}/${folder}/`;
  const base = `${originBase(request)}/${encodePath(game)}`;
  const files = [];
  let token;

  do {
    const page = await client(env).send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET_NAME,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: token,
      })
    );

    for (const item of page.Contents || []) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      const name = item.Key.slice(prefix.length);
      if (!name || name.includes("/")) continue;
      files.push(
        listedFile(
          name,
          `${folder}/${name}`,
          item.Size,
          item.LastModified,
          null,
          `${base}/${encodePath(`${folder}/${name}`)}`
        )
      );
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return json({ [folder]: files }, 200, allowOrigin);
}

async function serveVideoListing(request, env, allowOrigin, game) {
  const prefix = `${game}/videos/`;
  const base = `${originBase(request)}/${encodePath(game)}`;
  const objects = await listAllKeys(env, prefix);
  const clips = groupVideoClips(objects, prefix, base);
  return json({ videos: clips }, 200, allowOrigin);
}

async function listAllKeys(env, prefix) {
  const objects = [];
  let token;

  do {
    const page = await client(env).send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );

    for (const item of page.Contents || []) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      objects.push(item);
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return objects;
}

function groupVideoClips(objects, prefix, publicBase) {
  const folders = new Map();
  const looseVideos = [];

  for (const object of objects) {
    const relative = object.Key.slice(prefix.length);
    if (!relative) continue;
    const slash = relative.indexOf("/");

    if (slash < 0) {
      if (isVideoFile(relative)) looseVideos.push(object);
      continue;
    }

    const folder = relative.slice(0, slash);
    const fileName = relative.slice(slash + 1);
    if (!folder || !fileName || fileName.includes("/")) continue;
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ fileName, object });
  }

  const clips = [];

  for (const [folder, files] of folders) {
    const video = files.find((file) => isVideoFile(file.fileName));
    if (!video) continue;
    const thumb = files.find((file) => file.fileName.toLowerCase() === VIDEO_THUMB_FILE);
    const relativePath = `videos/${folder}/${video.fileName}`;
    clips.push({
      ...listedFile(
        video.fileName,
        relativePath,
        video.object.Size,
        video.object.LastModified,
        null,
        `${publicBase}/${encodePath(relativePath)}`
      ),
      thumbnailUrl: `${publicBase}/${encodePath(`videos/${folder}/${VIDEO_THUMB_FILE}`)}`,
      hasThumbnail: Boolean(thumb),
    });
  }

  for (const object of looseVideos) {
    const name = object.Key.slice(prefix.length);
    const stem = name.replace(/\.[^.]+$/, "");
    if (folders.has(stem)) continue;
    const relativePath = `videos/${name}`;
    clips.push({
      ...listedFile(
        name,
        relativePath,
        object.Size,
        object.LastModified,
        null,
        `${publicBase}/${encodePath(relativePath)}`
      ),
      thumbnailUrl: `${publicBase}/${encodePath(`videos/${stem}/${VIDEO_THUMB_FILE}`)}`,
      hasThumbnail: false,
    });
  }

  return clips;
}

function isVideoFile(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

async function serveObject(request, env, allowOrigin, key, options = {}) {
  const range = request.headers.get("Range");
  const object = await client(env).send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Range: range || undefined,
    })
  );

  const fileName = key.split("/").pop() || key;
  const headers = new Headers(corsHeaders(allowOrigin));
  headers.set("Content-Type", object.ContentType || mimeOf(fileName));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", options.cache || "public, max-age=3600");
  if (object.ContentLength != null) headers.set("Content-Length", String(object.ContentLength));
  if (object.ContentRange) headers.set("Content-Range", object.ContentRange);
  if (object.ETag) headers.set("ETag", object.ETag);

  const body = request.method === "HEAD" ? null : toBody(object.Body);
  return new Response(body, { status: object.ContentRange ? 206 : 200, headers });
}

function client(env) {
  if (!s3) {
    const endpoint = env.AWS_ENDPOINT?.trim();
    s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE === "true" || Boolean(endpoint),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return s3;
}

function listedFile(name, relativePath, size, lastModified, contentType, url) {
  return {
    name,
    relativePath,
    size: size ?? 0,
    mimeType: contentType || mimeOf(name),
    createdTime: lastModified ? new Date(lastModified).toISOString() : undefined,
    url,
  };
}

function mimeOf(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_TYPES[fileName.slice(dot).toLowerCase()] || "application/octet-stream";
}

function sanitizeGameName(name) {
  const value = name.trim();
  if (!value || value === "." || value === "..") return null;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return null;
  return value;
}

function isBranding(fileName) {
  const lower = fileName.toLowerCase();
  return lower === BRANDING.cover || lower === BRANDING.banner || lower === BRANDING.icon;
}

function isMissing(error) {
  return (
    error?.name === "NotFound" ||
    error?.name === "NoSuchKey" ||
    error?.$metadata?.httpStatusCode === 404
  );
}

function encodePath(path) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function originBase(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function corsOrigin(env, request) {
  const configured = env.CORS_ORIGIN?.trim() || "*";
  if (configured === "*") return "*";
  const requestOrigin = request.headers.get("Origin");
  const allowed = configured.split(",").map((item) => item.trim());
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0];
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, ETag, Content-Length",
    Vary: "Origin",
  };
}

function json(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function toBody(body) {
  if (body == null) return null;
  if (body instanceof ReadableStream) return body;
  if (typeof body?.transformToWebStream === "function") return body.transformToWebStream();
  return body;
}
