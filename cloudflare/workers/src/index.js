import { DOMParser, Node } from "@xmldom/xmldom";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

// S3 ListObjectsV2 responses are XML; the AWS SDK needs DOMParser in Workers.

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
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        return json({ error: "Rota não encontrada" }, 404, allowOrigin);
      }
      return await serveRootGames(env, allowOrigin);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "Erro interno" }, 500, allowOrigin);
    }
  },
};

async function serveRootGames(env, allowOrigin) {
  const base = publicBase(env);
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
      const name = (prefix.Prefix || "").replace(/\/+$/, "").trim();
      if (name) names.push(name);
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  names.sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));

  const games = names.map((name) => {
    const folder = `${base}/${encodePath(name)}`;
    return {
      name,
      cover: `${folder}/${BRANDING.cover}`,
      banner: `${folder}/${BRANDING.banner}`,
      icon: `${folder}/${BRANDING.icon}`,
    };
  });

  return json(games, 200, allowOrigin);
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

function encodePath(path) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function publicBase(env) {
  const configured = env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`;
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
    "Access-Control-Allow-Headers": "Content-Type",
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
