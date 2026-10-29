import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const THUMB_FILE = "thumb.jpg";
export const METADATA_FILE = "metadata.json";
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);
const VIDEO_EXT = ".mp4";

export interface GameMetadataVideo {
  url: string;
  thumb: string;
}

export interface GameMetadata {
  images: string[];
  videos: GameMetadataVideo[];
}

export interface PrepareReport {
  games: number;
  moved: number;
  renamed: number;
  thumbs: number;
  metadata: number;
}

interface VideoClip {
  folder: string;
  fileName: string;
}

function logLine(log: ((line: string) => void) | undefined, line: string) {
  log?.(line);
}

function encodePath(segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split("/"))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function mediaFileUrl(publicBaseUrl: string, game: string, relativePath: string): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${encodePath([game, relativePath])}`;
}

async function listNames(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink()).map((entry) => entry.name);
}

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
}

function isMp4(fileName: string): boolean {
  return extname(fileName).toLowerCase() === VIDEO_EXT;
}

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function ensureFfmpeg() {
  try {
    const result = await run("ffmpeg", ["-version"]);
    if (result.code !== 0) throw new Error("ffmpeg não respondeu.");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? "ffmpeg não encontrado no PATH. Instale o ffmpeg para gerar as miniaturas."
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function seekTimeFor(duration: number): string {
  if (duration <= 0) return "0";
  const tenth = duration * 0.1;
  return Math.min(Math.max(tenth, 0.1), Math.max(duration - 0.05, 0), 3).toFixed(3);
}

async function extractThumbnail(videoPath: string, outputPath: string) {
  const seek = seekTimeFor(await probeDurationSeconds(videoPath));
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    seek,
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1280:-2",
    "-q:v",
    "3",
    outputPath,
  ];

  let result = await run("ffmpeg", args);
  if (result.code === 0 && existsSync(outputPath)) return;

  const fallback = args.slice();
  fallback[5] = "0";
  result = await run("ffmpeg", fallback);
  if (result.code !== 0 || !existsSync(outputPath)) {
    const details = (result.stderr || "ffmpeg falhou").trim();
    throw new Error(details);
  }
}

async function standardizeVideos(videosDir: string): Promise<{ moved: number; renamed: number }> {
  let moved = 0;
  let renamed = 0;
  const loose = (await listNames(videosDir)).filter(isMp4);

  for (const fileName of loose) {
    const stem = basename(fileName, extname(fileName));
    const folderPath = join(videosDir, stem);
    const destination = join(folderPath, `${stem}${VIDEO_EXT}`);
    if (existsSync(destination)) {
      throw new Error(`Já existe ${destination}. Remova o duplicado antes do deploy.`);
    }
    await mkdir(folderPath, { recursive: true });
    await rename(join(videosDir, fileName), destination);
    moved += 1;
  }

  for (const folder of await listDirs(videosDir)) {
    const folderPath = join(videosDir, folder);
    const videos = (await listNames(folderPath)).filter(isMp4);
    const canonical = `${folder}${VIDEO_EXT}`;
    if (videos.length === 1 && videos[0] !== canonical) {
      const destination = join(folderPath, canonical);
      if (existsSync(destination)) {
        throw new Error(`Já existe ${destination}. Remova o duplicado antes do deploy.`);
      }
      await rename(join(folderPath, videos[0]), destination);
      renamed += 1;
    }
  }

  return { moved, renamed };
}

async function clipsIn(videosDir: string): Promise<VideoClip[]> {
  const clips: VideoClip[] = [];
  for (const folder of (await listDirs(videosDir)).sort((a, b) => a.localeCompare(b, "pt"))) {
    const videos = (await listNames(join(videosDir, folder))).filter(isMp4).sort((a, b) => a.localeCompare(b, "pt"));
    for (const fileName of videos) clips.push({ folder, fileName });
  }
  return clips;
}

async function generateMissingThumbs(
  gameName: string,
  videosDir: string,
  log?: (line: string) => void,
): Promise<number> {
  const pending: VideoClip[] = [];
  for (const folder of await listDirs(videosDir)) {
    const names = await listNames(join(videosDir, folder));
    if (names.some((name) => name.toLowerCase() === THUMB_FILE)) continue;
    const videos = names.filter(isMp4);
    if (videos.length === 0) continue;
    const canonical = `${folder}${VIDEO_EXT}`;
    const fileName = videos.includes(canonical) ? canonical : videos.sort((a, b) => a.localeCompare(b, "pt"))[0];
    pending.push({ folder, fileName });
  }
  if (pending.length === 0) return 0;

  await ensureFfmpeg();
  let generated = 0;
  for (const clip of pending) {
    const folderPath = join(videosDir, clip.folder);
    await extractThumbnail(join(folderPath, clip.fileName), join(folderPath, THUMB_FILE));
    generated += 1;
    logLine(log, `thumb: ${gameName}/videos/${clip.folder}/${THUMB_FILE}`);
  }
  return generated;
}

export async function readGameMetadata(game: string, gameDir: string, publicBaseUrl: string): Promise<GameMetadata> {
  const images = (await listNames(join(gameDir, "images")))
    .filter((name) => IMAGE_EXT.has(extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }))
    .map((name) => mediaFileUrl(publicBaseUrl, game, `images/${name}`));

  const videos = (await clipsIn(join(gameDir, "videos"))).map((clip) => ({
    url: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${clip.fileName}`),
    thumb: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${THUMB_FILE}`),
  }));

  return { images, videos };
}

async function writeMetadata(game: string, gameDir: string, publicBaseUrl: string): Promise<boolean> {
  const metadata = await readGameMetadata(game, gameDir, publicBaseUrl);
  const next = `${JSON.stringify(metadata, null, 2)}\n`;
  const target = join(gameDir, METADATA_FILE);
  if (existsSync(target) && (await readFile(target, "utf8")) === next) return false;
  await writeFile(target, next, "utf8");
  return true;
}

async function needsNewThumbnail(videosDir: string): Promise<boolean> {
  if (!existsSync(videosDir)) return false;
  if ((await listNames(videosDir)).some(isMp4)) return true;
  for (const folder of await listDirs(videosDir)) {
    const names = await listNames(join(videosDir, folder));
    const hasVideo = names.some(isMp4);
    const hasThumb = names.some((name) => name.toLowerCase() === THUMB_FILE);
    if (hasVideo && !hasThumb) return true;
  }
  return false;
}

export async function prepareLocalMedia(options: {
  root: string;
  publicBaseUrl: string;
  log?: (line: string) => void;
}): Promise<PrepareReport> {
  const report: PrepareReport = { games: 0, moved: 0, renamed: 0, thumbs: 0, metadata: 0 };
  const games = (await listDirs(options.root)).sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
  const failures: string[] = [];

  for (const game of games) {
    if (await needsNewThumbnail(join(options.root, game, "videos"))) {
      await ensureFfmpeg();
      break;
    }
  }

  for (const game of games) {
    report.games += 1;
    const gameDir = join(options.root, game);
    const videosDir = join(gameDir, "videos");
    try {
      if (existsSync(videosDir)) {
        const standardized = await standardizeVideos(videosDir);
        report.moved += standardized.moved;
        report.renamed += standardized.renamed;
        if (standardized.moved > 0) {
          logLine(options.log, `${game}: ${standardized.moved} vídeo(s) movido(s) para subpastas`);
        }
        if (standardized.renamed > 0) {
          logLine(options.log, `${game}: ${standardized.renamed} vídeo(s) renomeado(s) para <pasta>/<pasta>.mp4`);
        }
        const thumbs = await generateMissingThumbs(game, videosDir, options.log);
        report.thumbs += thumbs;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${game}: ${message}`);
      logLine(options.log, `falha em ${game}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Preparação interrompida antes do sync. ${failures.length} falha(s).`);
  }

  for (const game of games) {
    const wrote = await writeMetadata(game, join(options.root, game), options.publicBaseUrl);
    if (wrote) {
      report.metadata += 1;
      const metadata = await readGameMetadata(game, join(options.root, game), options.publicBaseUrl);
      logLine(
        options.log,
        `metadata.json: ${game} (${metadata.images.length} imagens, ${metadata.videos.length} vídeos)`,
      );
    }
  }

  return report;
}
