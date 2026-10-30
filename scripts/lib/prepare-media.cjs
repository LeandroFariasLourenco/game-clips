const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildStandardizedMediaName,
  formatUtcStamp,
  mediaFileLabel,
  parseStandardizedMediaName,
  readItemDates,
} = require('./item-date.cjs');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const THUMB_FILENAME = 'thumb.jpg';
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '..', '..', 'media');

function parseArgs(argv) {
  const options = {
    root: DEFAULT_MEDIA_ROOT,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--base-url') {
      options.publicBaseUrl = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--base-url=')) {
      options.publicBaseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--root') {
      options.root = path.resolve(argv[i + 1] || '');
      i += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = path.resolve(arg.slice('--root='.length));
    }
  }

  return options;
}

function emptyStats() {
  return {
    games: 0,
    renamed: 0,
    renamedFolders: 0,
    moved: 0,
    videos: 0,
    existing: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
}

function isVideoFile(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function listDir(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true });
}

function nextSequence(used) {
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return sequence;
}

function targetExt(fileName, kind) {
  const ext = path.extname(fileName).toLowerCase();
  if (kind === 'images' && (ext === '.jpeg' || ext === '.jpg')) return '.jpg';
  return ext;
}

function uniqueDirName(parentDir, dirName, sourcePath) {
  let candidate = dirName;
  let suffix = 2;
  while (true) {
    const fullPath = path.join(parentDir, candidate);
    if (!fs.existsSync(fullPath) || path.resolve(fullPath) === path.resolve(sourcePath)) {
      return candidate;
    }
    candidate = `${dirName}-${suffix}`;
    suffix += 1;
  }
}

function renamePath(fromPath, toPath, dryRun) {
  if (path.resolve(fromPath) === path.resolve(toPath)) return;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
  }
}

function ensureMediaRoot(root) {
  if (!fs.existsSync(root)) {
    console.error(`Pasta de mídia não encontrada: ${root}`);
    process.exit(1);
  }
}

function listGameFolders(root) {
  return listDir(root).filter((entry) => entry.isDirectory());
}

function forEachGame(root, callback) {
  let games = 0;
  for (const game of listGameFolders(root)) {
    const gameDir = path.join(root, game.name);
    const imagesDir = path.join(gameDir, 'images');
    const videosDir = path.join(gameDir, 'videos');
    const hasImages = fs.existsSync(imagesDir) && fs.statSync(imagesDir).isDirectory();
    const hasVideos = fs.existsSync(videosDir) && fs.statSync(videosDir).isDirectory();
    if (!hasImages && !hasVideos) continue;
    games += 1;
    callback({ gameName: game.name, gameDir, imagesDir, videosDir, hasImages, hasVideos });
  }
  return games;
}

function collectNameGroups(root) {
  const groups = [];
  forEachGame(root, ({ gameName, imagesDir, videosDir, hasImages, hasVideos }) => {
    if (hasImages) {
      const targets = [];
      for (const entry of listDir(imagesDir)) {
        if (!entry.isFile() || !isImageFile(entry.name)) continue;
        targets.push({
          filePath: path.join(imagesDir, entry.name),
          relative: `${gameName}/images/${entry.name}`,
          kind: 'images',
          gameName,
        });
      }
      if (targets.length > 0) groups.push({ gameName, kind: 'images', targets });
    }
    if (!hasVideos) return;
    const targets = [];
    for (const entry of listDir(videosDir)) {
      if (!entry.isFile() || !isVideoFile(entry.name)) continue;
      targets.push({
        filePath: path.join(videosDir, entry.name),
        relative: `${gameName}/videos/${entry.name}`,
        kind: 'videos',
        gameName,
      });
    }
    for (const folder of listDir(videosDir).filter((entry) => entry.isDirectory())) {
      const folderPath = path.join(videosDir, folder.name);
      for (const video of listDir(folderPath).filter((entry) => entry.isFile() && isVideoFile(entry.name))) {
        targets.push({
          filePath: path.join(folderPath, video.name),
          relative: `${gameName}/videos/${folder.name}/${video.name}`,
          kind: 'videos',
          gameName,
        });
      }
    }
    if (targets.length > 0) groups.push({ gameName, kind: 'videos', targets });
  });
  return groups;
}

function planGroupRenames(group, dates) {
  const label = mediaFileLabel(group.gameName);
  const used = new Set();
  const pending = [];
  const restamp = [];

  for (const target of group.targets) {
    const parsed = parseStandardizedMediaName(path.basename(target.filePath));
    const date = dates.get(path.resolve(target.filePath)) || fs.statSync(target.filePath).mtime;
    if (parsed && parsed.game === label) {
      used.add(parsed.sequence);
      if (parsed.stamp !== formatUtcStamp(date)) {
        restamp.push({ target, date, sequence: parsed.sequence });
      }
    } else {
      pending.push({ target, date });
    }
  }

  pending.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
    return path.basename(a.target.filePath).localeCompare(path.basename(b.target.filePath), 'pt');
  });

  const plans = restamp.map(({ target, date, sequence }) => {
    const nextName = buildStandardizedMediaName(date, group.gameName, sequence, targetExt(target.filePath, group.kind));
    return { ...target, nextName, nextPath: path.join(path.dirname(target.filePath), nextName) };
  });

  for (const { target, date } of pending) {
    const sequence = nextSequence(used);
    used.add(sequence);
    const nextName = buildStandardizedMediaName(date, group.gameName, sequence, targetExt(target.filePath, group.kind));
    plans.push({
      ...target,
      nextName,
      nextPath: path.join(path.dirname(target.filePath), nextName),
    });
  }

  return plans;
}

function applyRenamePlans(plans, options, stats) {
  const moving = plans.filter((plan) => path.resolve(plan.filePath) !== path.resolve(plan.nextPath));
  const temps = [];

  for (const plan of moving) {
    try {
      if (options.dryRun) {
        stats.renamed += 1;
        console.log(`  → nome: ${plan.relative} → ${plan.nextName}`);
        continue;
      }
      const tempPath = path.join(
        path.dirname(plan.filePath),
        `.renaming-${process.pid}-${Math.random().toString(16).slice(2)}${path.extname(plan.nextName)}`,
      );
      fs.renameSync(plan.filePath, tempPath);
      temps.push({ ...plan, tempPath });
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${plan.relative}: ${error.message}`);
      console.error(`  ✖ falha ao padronizar ${plan.relative}: ${error.message}`);
    }
  }

  for (const plan of temps) {
    try {
      renamePath(plan.tempPath, plan.nextPath, false);
      stats.renamed += 1;
      console.log(`  → nome: ${plan.relative} → ${plan.nextName}`);
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${plan.relative}: ${error.message}`);
      console.error(`  ✖ falha ao padronizar ${plan.relative}: ${error.message}`);
    }
  }
}

function runNames(options, stats) {
  console.log(`Padronizando nomes em: ${options.root}`);
  if (options.dryRun) console.log('Dry-run: nenhum arquivo será renomeado.\n');
  else console.log('');

  stats.games = forEachGame(options.root, () => {});
  const groups = collectNameGroups(options.root);
  const dates = readItemDates(groups.flatMap((group) => group.targets.map((target) => target.filePath)));

  for (const group of groups) {
    applyRenamePlans(planGroupRenames(group, dates), options, stats);
  }
}

function moveLooseVideo(videosDir, fileName, dryRun) {
  const stem = path.parse(fileName).name;
  const sourcePath = path.join(videosDir, fileName);
  const folderName = uniqueDirName(videosDir, stem, sourcePath);
  const folderPath = path.join(videosDir, folderName);
  const destinationPath = path.join(folderPath, fileName);

  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return { folderPath, moved: false };
  }

  if (!dryRun) {
    fs.mkdirSync(folderPath, { recursive: true });
    fs.renameSync(sourcePath, destinationPath);
  }

  return { folderPath, moved: true, folderName };
}

function alignFolderToVideo(videosDir, folderName, dryRun) {
  const folderPath = path.join(videosDir, folderName);
  const videoEntries = listDir(folderPath).filter((entry) => entry.isFile() && isVideoFile(entry.name));
  if (videoEntries.length !== 1) return { renamed: false };

  const videoName = videoEntries[0].name;
  const nextFolderName = uniqueDirName(videosDir, path.parse(videoName).name, folderPath);
  if (nextFolderName === folderName) return { renamed: false, folderName, videoName };

  const nextFolderPath = path.join(videosDir, nextFolderName);
  if (!dryRun) fs.renameSync(folderPath, nextFolderPath);
  return { renamed: true, folderName: nextFolderName, from: folderName, videoName };
}

function runFolders(options, stats) {
  console.log(`Padronizando pastas de vídeo em: ${options.root}`);
  if (options.dryRun) console.log('Dry-run: nenhum arquivo será movido.\n');
  else console.log('');

  stats.games = forEachGame(options.root, ({ gameName, videosDir, hasVideos }) => {
    if (!hasVideos) return;

    for (const entry of listDir(videosDir)) {
      if (!entry.isFile() || !isVideoFile(entry.name)) continue;
      const relative = `${gameName}/videos/${entry.name}`;
      try {
        const result = moveLooseVideo(videosDir, entry.name, options.dryRun);
        if (result.moved) {
          stats.moved += 1;
          console.log(`  → pasta: ${relative} → ${path.basename(result.folderPath)}/${entry.name}`);
        }
      } catch (error) {
        stats.failed += 1;
        stats.failures.push(`${relative}: ${error.message}`);
        console.error(`  ✖ falha ao reorganizar ${relative}: ${error.message}`);
      }
    }

    for (const folder of listDir(videosDir).filter((entry) => entry.isDirectory())) {
      const relativeFolder = `${gameName}/videos/${folder.name}`;
      try {
        const result = alignFolderToVideo(videosDir, folder.name, options.dryRun);
        if (result.renamed) {
          stats.renamedFolders += 1;
          console.log(`  → pasta: ${relativeFolder} → ${result.folderName}`);
        }
      } catch (error) {
        stats.failed += 1;
        stats.failures.push(`${relativeFolder}: ${error.message}`);
        console.error(`  ✖ falha ao padronizar ${relativeFolder}: ${error.message}`);
      }
    }
  });
}

function hasThumbnail(entries, force) {
  if (force) return false;
  return entries.some((entry) => {
    if (!entry.isFile()) return false;
    const name = entry.name.toLowerCase();
    return name === THUMB_FILENAME || isImageFile(entry.name);
  });
}

function findVideoInFolder(entries) {
  return entries.find((entry) => entry.isFile() && isVideoFile(entry.name)) || null;
}

function ensureFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error('ffmpeg não encontrado no PATH. Instale o ffmpeg para gerar as thumbnails.');
  }
}

function probeDurationSeconds(videoPath) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
    { encoding: 'utf8' },
  );
  const duration = Number.parseFloat((result.stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function seekTimeFor(duration) {
  if (duration <= 0) return 0;
  const tenth = duration * 0.1;
  return Math.min(Math.max(tenth, 0.1), Math.max(duration - 0.05, 0), 3);
}

function extractThumbnail(videoPath, outputPath) {
  ensureFfmpeg();
  const seek = seekTimeFor(probeDurationSeconds(videoPath)).toFixed(3);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    seek,
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=1280:-2',
    '-q:v',
    '3',
    outputPath,
  ];

  let result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status === 0 && fs.existsSync(outputPath)) return;

  const fallbackArgs = args.map((value, index) => (index === 5 ? '0' : value));
  result = spawnSync('ffmpeg', fallbackArgs, { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const details = (result.stderr || result.error?.message || 'ffmpeg falhou').trim();
    throw new Error(details);
  }
}

function processVideoFolder(gameName, folderPath, options, stats) {
  const relativeFolder = `${gameName}/videos/${path.basename(folderPath)}`;

  if (!fs.existsSync(folderPath)) {
    stats.skipped += 1;
    return;
  }

  const entries = listDir(folderPath);
  const videoEntry = findVideoInFolder(entries);
  if (!videoEntry) {
    stats.skipped += 1;
    return;
  }

  stats.videos += 1;

  if (hasThumbnail(entries, options.force)) {
    stats.existing += 1;
    return;
  }

  const thumbPath = path.join(folderPath, THUMB_FILENAME);
  if (options.dryRun) {
    stats.generated += 1;
    console.log(`  ★ thumb (dry-run): ${relativeFolder}/${THUMB_FILENAME}`);
    return;
  }

  try {
    extractThumbnail(path.join(folderPath, videoEntry.name), thumbPath);
    stats.generated += 1;
    console.log(`  ★ thumb: ${relativeFolder}/${THUMB_FILENAME}`);
  } catch (error) {
    stats.failed += 1;
    stats.failures.push(`${relativeFolder}: ${error.message}`);
    console.error(`  ✖ falha na thumb de ${relativeFolder}: ${error.message}`);
  }
}

const METADATA_FILE = 'metadata.json';
const METADATA_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const METADATA_VIDEO_EXTENSION = '.mp4';

function encodeMediaPath(segments) {
  return segments
    .flatMap((segment) => String(segment).split('/'))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function mediaFileUrl(publicBaseUrl, game, relativePath) {
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');
  return `${base}/${encodeMediaPath([game, relativePath])}`;
}

function listClipFolders(videosDir) {
  if (!fs.existsSync(videosDir) || !fs.statSync(videosDir).isDirectory()) return [];
  const clips = [];
  for (const folder of listDir(videosDir).filter((entry) => entry.isDirectory())) {
    const videos = listDir(path.join(videosDir, folder.name))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === METADATA_VIDEO_EXTENSION)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'pt'));
    for (const fileName of videos) clips.push({ folder: folder.name, fileName });
  }
  clips.sort((a, b) => {
    const folder = a.folder.localeCompare(b.folder, 'pt', { sensitivity: 'base' });
    return folder !== 0 ? folder : a.fileName.localeCompare(b.fileName, 'pt', { sensitivity: 'base' });
  });
  return clips;
}

function buildGameMetadata(game, publicBaseUrl, imagesDir, videosDir) {
  const images = fs.existsSync(imagesDir)
    ? listDir(imagesDir)
        .filter((entry) => entry.isFile() && METADATA_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, 'pt', { sensitivity: 'base' }))
    : [];
  const videos = listClipFolders(videosDir);
  return {
    images: images.map((name) => mediaFileUrl(publicBaseUrl, game, `images/${name}`)),
    videos: videos.map((clip) => ({
      url: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${clip.fileName}`),
      thumb: mediaFileUrl(publicBaseUrl, game, `videos/${clip.folder}/${THUMB_FILENAME}`),
    })),
  };
}

function runMetadata(options, stats) {
  const publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    throw new Error(
      'Defina a URL pública do bucket (--base-url, AWS_S3_PUBLIC_BASE_URL ou VITE_MEDIA_BUCKET_URL).',
    );
  }

  console.log(`Gerando metadata.json em: ${options.root}`);
  console.log(`URL pública:             ${publicBaseUrl}`);
  if (options.dryRun) console.log('Dry-run: nenhum metadata.json será gravado.\n');
  else console.log('');

  stats.games = forEachGame(options.root, ({ gameName, gameDir, imagesDir, videosDir }) => {
    try {
      const metadata = buildGameMetadata(gameName, publicBaseUrl, imagesDir, videosDir);
      const next = `${JSON.stringify(metadata, null, 2)}\n`;
      const target = path.join(gameDir, METADATA_FILE);
      const unchanged = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === next;
      if (unchanged) {
        stats.existing += 1;
        return;
      }
      if (!options.dryRun) fs.writeFileSync(target, next, 'utf8');
      stats.generated += 1;
      console.log(
        `  → metadata.json: ${gameName} (${metadata.images.length} imagens, ${metadata.videos.length} vídeos)`,
      );
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${gameName}: ${error.message}`);
      console.error(`  ✖ falha no metadata de ${gameName}: ${error.message}`);
    }
  });
}

function runThumbs(options, stats) {
  console.log(`Gerando thumbnails em: ${options.root}`);
  if (options.dryRun) console.log('Dry-run: nenhuma thumbnail será gravada.\n');
  else console.log('');

  stats.games = forEachGame(options.root, ({ gameName, videosDir, hasVideos }) => {
    if (!hasVideos) return;
    for (const folder of listDir(videosDir).filter((entry) => entry.isDirectory())) {
      processVideoFolder(gameName, path.join(videosDir, folder.name), options, stats);
    }
  });
}

function printSummary(stats, options, extraLines) {
  console.log('\n========== Sumário ==========');
  console.log(`Pasta de mídia:        ${options.root}`);
  console.log(`Modo:                  ${options.dryRun ? 'dry-run' : 'gravação'}`);
  console.log(`Jogos processados:     ${stats.games}`);
  for (const line of extraLines) console.log(line);
  console.log(`Falhas:                ${stats.failed}`);
  if (stats.failures.length > 0) {
    console.log('\nFalhas:');
    for (const failure of stats.failures) {
      console.log(`  - ${failure}`);
    }
  }
  console.log('=============================\n');
}

function finish(stats) {
  if (stats.failed > 0) process.exit(1);
}

module.exports = {
  DEFAULT_MEDIA_ROOT,
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runFolders,
  runMetadata,
  runNames,
  runThumbs,
};
