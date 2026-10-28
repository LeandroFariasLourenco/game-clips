import { Buffer } from "node:buffer";
import process from "node:process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  HttpError,
  createGame,
  deleteGame,
  getAsset,
  getGame,
  listGames,
  uploadMedia,
} from "./server/s3.ts";
import {
  listSteamGridImages,
  parseGameId,
  searchSteamGridGames,
  uploadFromSteamGrid,
} from "./server/steamgrid.ts";

const host = process.env.TAURI_DEV_HOST;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function s3ApiPlugin(): Plugin {
  return {
    name: "media-panel-s3-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) {
          next();
          return;
        }

        try {
          const refresh = url.searchParams.get("refresh") === "1";

          if (req.method === "GET" && url.pathname === "/api/games") {
            sendJson(res, 200, await listGames({ refresh }));
            return;
          }

          const gameMatch = url.pathname.match(/^\/api\/games\/([^/]+)$/);
          if (req.method === "GET" && gameMatch) {
            sendJson(res, 200, await getGame(decodeURIComponent(gameMatch[1]), { refresh }));
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/asset") {
            const key = url.searchParams.get("key") || "";
            const asset = await getAsset(key, { refresh });
            if (!asset) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", asset.contentType);
            res.setHeader(
              "Cache-Control",
              asset.fromCache ? "public, max-age=31536000, immutable" : "public, max-age=86400",
            );
            res.end(asset.body);
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/games") {
            const payload = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
              name?: string;
            };
            sendJson(res, 201, await createGame(payload.name || ""));
            return;
          }

          if (req.method === "DELETE" && gameMatch) {
            await deleteGame(decodeURIComponent(gameMatch[1]));
            sendJson(res, 200, { ok: true });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/upload") {
            const game = url.searchParams.get("game") || "";
            const kind = url.searchParams.get("kind") || "";
            const fileName = url.searchParams.get("name") || "";
            const body = await readBody(req);
            sendJson(res, 200, await uploadMedia({ game, kind, fileName, body }));
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/steamgrid/search") {
            sendJson(res, 200, {
              games: await searchSteamGridGames(url.searchParams.get("q") || ""),
            });
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/steamgrid/images") {
            sendJson(res, 200, {
              images: await listSteamGridImages(
                parseGameId(url.searchParams.get("id") || ""),
                url.searchParams.get("kind") || "",
              ),
            });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/upload-from-url") {
            const payload = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
              game?: string;
              kind?: string;
              url?: string;
            };
            sendJson(
              res,
              200,
              await uploadFromSteamGrid({
                game: payload.game || "",
                kind: payload.kind || "",
                url: payload.url || "",
              }),
            );
            return;
          }

          sendJson(res, 404, { error: "Rota não encontrada" });
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500;
          sendJson(res, status, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), s3ApiPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/.env", "**/.cache/**"],
    },
  },
}));
