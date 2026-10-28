import SGDB, { type SGDBImage } from "steamgriddb";
import { HttpError, loadEnv, uploadMedia } from "./s3.ts";

export type SteamGridKind = "cover" | "banner" | "icon";

export interface SteamGridGameMatch {
  id: number;
  name: string;
  verified: boolean;
}

export interface SteamGridSuggestion {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  score: number;
}

const ALLOWED_KINDS = new Set<SteamGridKind>(["cover", "banner", "icon"]);
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

function client(): SGDB {
  loadEnv();
  const key = process.env.STEAMGRIDDB_API_KEY?.trim();
  if (!key) {
    throw new HttpError("Defina STEAMGRIDDB_API_KEY no arquivo .env do painel.", 500);
  }
  return new SGDB(key);
}

function asKind(value: string): SteamGridKind {
  if (!ALLOWED_KINDS.has(value as SteamGridKind)) {
    throw new HttpError("SteamGridDB só cobre capa, banner e ícone.", 400);
  }
  return value as SteamGridKind;
}

export function parseGameId(value: string | number): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError("Informe o ID numérico do jogo no SteamGridDB.", 400);
  }
  return id;
}

function stringifyUrl(value: SGDBImage["url"] | SGDBImage["thumb"]): string {
  return String(value);
}

function mapImages(images: SGDBImage[]): SteamGridSuggestion[] {
  return images.slice(0, 24).map((image) => ({
    id: image.id,
    url: stringifyUrl(image.url),
    thumb: stringifyUrl(image.thumb || image.url),
    width: image.width,
    height: image.height,
    score: image.score,
  }));
}

async function wrapSteamGrid<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const notFound = /not found|no .*found/i.test(message);
    throw new HttpError(
      notFound ? "Jogo não encontrado no SteamGridDB." : `SteamGridDB: ${message}`,
      notFound ? 404 : 502,
    );
  }
}

export async function searchSteamGridGames(query: string): Promise<SteamGridGameMatch[]> {
  const needle = query.trim();
  if (!needle) throw new HttpError("Informe um nome para buscar no SteamGridDB.", 400);

  const games = await wrapSteamGrid(() => client().searchGame(needle));
  return games.slice(0, 8).map((game) => ({
    id: game.id,
    name: game.name,
    verified: Boolean(game.verified),
  }));
}

export async function listSteamGridImages(
  id: number,
  kindValue: string,
): Promise<SteamGridSuggestion[]> {
  const kind = asKind(kindValue);
  const sgdb = client();
  const nsfw = "false";
  const types = ["static"];

  const images = await wrapSteamGrid(async () => {
    if (kind === "cover") {
      return sgdb.getGridsById(id, undefined, undefined, ["image/jpeg", "image/png"], types, nsfw);
    }
    if (kind === "banner") {
      return sgdb.getHeroesById(id, undefined, undefined, ["image/jpeg", "image/png"], types, nsfw);
    }
    return sgdb.getIconsById(id, undefined, undefined, ["image/png"], types, nsfw);
  });

  return mapImages(images || []);
}

function isAllowedImageHost(hostname: string): boolean {
  return hostname === "steamgriddb.com" || hostname.endsWith(".steamgriddb.com");
}

function contentTypeOf(response: Response, fallback: string): string {
  const raw = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (raw?.startsWith("image/")) return raw;
  return fallback;
}

export async function uploadFromSteamGrid(input: {
  game: string;
  kind: string;
  url: string;
}): Promise<{ key: string; url: string }> {
  const kind = asKind(input.kind);
  const source = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new HttpError("URL da imagem inválida.", 400);
  }
  if (parsed.protocol !== "https:" || !isAllowedImageHost(parsed.hostname)) {
    throw new HttpError("Só é permitido baixar imagens do SteamGridDB.", 400);
  }

  const response = await fetch(source, {
    headers: { "User-Agent": "game-vault-media-panel" },
  });
  if (!response.ok) {
    throw new HttpError(`Falha ao baixar a imagem do SteamGridDB (${response.status}).`, 502);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) throw new HttpError("A imagem baixada está vazia.", 400);
  if (body.length > MAX_DOWNLOAD_BYTES) {
    throw new HttpError("A imagem do SteamGridDB é grande demais.", 400);
  }

  const fileName = kind === "icon" ? "icon.png" : kind === "cover" ? "cover.jpg" : "banner.jpg";
  const contentType = contentTypeOf(response, kind === "icon" ? "image/png" : "image/jpeg");

  if (kind === "icon" && contentType !== "image/png") {
    throw new HttpError("O ícone precisa ser PNG.", 400);
  }

  return uploadMedia({
    game: input.game,
    kind,
    fileName,
    body,
    contentType,
    skipExtensionCheck: true,
  });
}
