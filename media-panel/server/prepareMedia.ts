import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import {
  IMAGE_EXTENSIONS,
  METADATA_FILE,
  VIDEO_EXTENSION,
  VIDEO_THUMB_FILE,
  buildGameMetadata,
  serializeGameMetadata,
  type GameMetadata,
} from "./gameMetadata.ts";
import {
  buildStandardizedMediaName,
  formatUtcStamp,
  mediaFileLabel,
  parseStandardizedMediaName,
  readItemDates,
} from "./itemDate.ts";

export { METADATA_FILE, type GameMetadata, type GameMetadataVideo } from "./gameMetadata.ts";

const THUMB_FILE = VIDEO_THUMB_FILE;

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
  return extname(fileName).toLowerCase() === VIDEO_EXTENSION;
}

function isGalleryImage(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function nextSequence(used: Set<number>): number {
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return sequence;
}

function targetExt(fileName: string, kind: "images" | "videos"): string {
  const ext = extname(fileName).toLowerCase();
  if (kind === "images" && (ext === ".jpeg" || ext === ".jpg")) return ".jpg";
  return ext;
}

async function uniqueName(parentDir: string, name: string, sourcePath: string, asDir: boolean): Promise<string> {
  const parsed = parse(name);
  let candidate = name;
  let suffix = 2;
  while (true) {
    const fullPath = join(parentDir, candidate);
    if (!existsSync(fullPath) || resolve(fullPath) === resolve(sourcePath)) return candidate;
    candidate = asDir ? `${name}-${suffix}` : `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }
}

async function applyGroupNames(
  gameName: string,
  kind: "images" | "videos",
  files: string[],
): Promise<number> {
  const label = mediaFileLabel(gameName);
  const used = new Set<number>();
  const dates = readItemDates(files);
  const pending: Array<{ filePath: string; date: Date }> = [];
  const restamp: Array<{ filePath: string; date: Date; sequence: number }> = [];

  for (const filePath of files) {
    const parsed = parseStandardizedMediaName(basename(filePath));
    const date = dates.get(resolve(filePath)) ?? statSyncOrNow(filePath);
    if (parsed && parsed.game === label) {
      used.add(parsed.sequence);
      if (parsed.stamp !== formatUtcStamp(date)) restamp.push({ filePath, date, sequence: parsed.sequence });
    } else {
      pending.push({ filePath, date });
    }
  }

  pending.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
    return basename(a.filePath).localeCompare(basename(b.filePath), "pt");
  });

  const plans = [
    ...restamp.map(({ filePath, date, sequence }) => ({
      filePath,
      nextPath: join(dirname(filePath), buildStandardizedMediaName(date, gameName, sequence, targetExt(filePath, kind))),
    })),
    ...pending.map(({ filePath, date }) => {
      const sequence = nextSequence(used);
      used.add(sequence);
      return {
        filePath,
        nextPath: join(dirname(filePath), buildStandardizedMediaName(date, gameName, sequence, targetExt(filePath, kind))),
      };
    }),
  ];

  const temps: Array<{ tempPath: string; nextPath: string }> = [];
  for (const plan of plans) {
    if (resolve(plan.filePath) === resolve(plan.nextPath)) continue;
    const tempPath = join(
      dirname(plan.filePath),
      `.renaming-${process.pid}-${Math.random().toString(16).slice(2)}${extname(plan.nextPath)}`,
    );
    await rename(plan.filePath, tempPath);
    temps.push({ tempPath, nextPath: plan.nextPath });
  }
  for (const plan of temps) {
    await rename(plan.tempPath, plan.nextPath);
  }
  return temps.length;
}

function statSyncOrNow(filePath: string): Date {
  try {
    return statSync(filePath).mtime;
  } catch {
    return new Date();
  }
}

async function applyTimestampNames(gameName: string, imagesDir: string, videosDir: string): Promise<number> {
  let renamed = 0;
  const imageFiles: string[] = [];
  const videoFiles: string[] = [];

  if (existsSync(imagesDir)) {
    for (const fileName of (await listNames(imagesDir)).filter(isGalleryImage)) {
      imageFiles.push(join(imagesDir, fileName));
    }
  }

  if (existsSync(videosDir)) {
    for (const fileName of (await listNames(videosDir)).filter(isMp4)) {
      videoFiles.push(join(videosDir, fileName));
    }
    for (const folder of await listDirs(videosDir)) {
      const folderPath = join(videosDir, folder);
      for (const fileName of (await listNames(folderPath)).filter(isMp4)) {
        videoFiles.push(join(folderPath, fileName));
      }
    }
  }

  renamed += await applyGroupNames(gameName, "images", imageFiles);
  renamed += await applyGroupNames(gameName, "videos", videoFiles);

  if (!existsSync(videosDir)) return renamed;

  for (const folder of await listDirs(videosDir)) {
    const folderPath = join(videosDir, folder);
    const videos = (await listNames(folderPath)).filter(isMp4);
    if (videos.length !== 1) continue;
    const nextFolder = await uniqueName(videosDir, parse(videos[0]).name, folderPath, true);
    if (nextFolder === folder) continue;
    await rename(folderPath, join(videosDir, nextFolder));
    renamed += 1;
  }

  return renamed;
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
    const destination = join(folderPath, `${stem}${VIDEO_EXTENSION}`);
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
    const canonical = `${folder}${VIDEO_EXTENSION}`;
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
    const canonical = `${folder}${VIDEO_EXTENSION}`;
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
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
  const videos = await clipsIn(join(gameDir, "videos"));
  return buildGameMetadata(game, publicBaseUrl, { images, videos });
}

async function writeMetadata(game: string, gameDir: string, publicBaseUrl: string): Promise<boolean> {
  const metadata = await readGameMetadata(game, gameDir, publicBaseUrl);
  const next = serializeGameMetadata(metadata);
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
    const imagesDir = join(gameDir, "images");
    const videosDir = join(gameDir, "videos");
    try {
      const stamped = await applyTimestampNames(game, imagesDir, videosDir);
      report.renamed += stamped;
      if (stamped > 0) {
        logLine(options.log, `${game}: ${stamped} arquivo(s) padronizado(s) como UTC_Jogo#n`);
      }
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
