const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const THUMB_FILENAME = 'thumb.jpg';
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '..', 'media');

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
    else if (arg === '--root') {
      options.root = path.resolve(argv[i + 1] || '');
      i += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = path.resolve(arg.slice('--root='.length));
    }
  }

  return options;
}

const STANDARDIZED_STEM = /^\d{14}-.+/;

function isVideoFile(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalTimestamp(date) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

function isStandardizedFileName(fileName) {
  return STANDARDIZED_STEM.test(path.parse(fileName).name);
}

function uniqueFileName(dirPath, fileName, sourcePath) {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let suffix = 2;
  while (true) {
    const fullPath = path.join(dirPath, candidate);
    if (!fs.existsSync(fullPath) || path.resolve(fullPath) === path.resolve(sourcePath)) {
      return candidate;
    }
    candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }
}

function standardFileName(filePath, fileName) {
  if (isStandardizedFileName(fileName)) return fileName;
  const parsed = path.parse(fileName);
  const stamp = formatLocalTimestamp(fs.statSync(filePath).mtime);
  return `${stamp}-${parsed.name}${parsed.ext}`;
}

function renameToStandard(filePath, dryRun) {
  const dirPath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const nextName = uniqueFileName(dirPath, standardFileName(filePath, fileName), filePath);
  if (nextName === fileName) return { renamed: false, fileName };
  if (!dryRun) fs.renameSync(filePath, path.join(dirPath, nextName));
  return { renamed: true, fileName: nextName, from: fileName };
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
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ],
    { encoding: 'utf8' }
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

function listDir(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true });
}

function moveLooseVideo(videosDir, fileName, dryRun) {
  const stem = path.parse(fileName).name;
  const sourcePath = path.join(videosDir, fileName);
  const folderPath = path.join(videosDir, stem);
  const destinationPath = path.join(folderPath, fileName);

  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return { folderPath, moved: false };
  }

  if (!dryRun) {
    fs.mkdirSync(folderPath, { recursive: true });
    fs.renameSync(sourcePath, destinationPath);
  }

  return { folderPath, moved: true };
}

function standardizeGameFileNames(gameName, gameDir, options, stats) {
  const imagesDir = path.join(gameDir, 'images');
  if (fs.existsSync(imagesDir) && fs.statSync(imagesDir).isDirectory()) {
    for (const entry of listDir(imagesDir)) {
      if (!entry.isFile() || !isImageFile(entry.name)) continue;
      const relative = `${gameName}/images/${entry.name}`;
      try {
        const result = renameToStandard(path.join(imagesDir, entry.name), options.dryRun);
        if (result.renamed) {
          stats.renamed += 1;
          console.log(`  → nome: ${relative} → ${result.fileName}`);
        }
      } catch (error) {
        stats.failed += 1;
        stats.failures.push(`${relative}: ${error.message}`);
        console.error(`  ✖ falha ao padronizar ${relative}: ${error.message}`);
      }
    }
  }

  const videosDir = path.join(gameDir, 'videos');
  if (!fs.existsSync(videosDir) || !fs.statSync(videosDir).isDirectory()) return;

  for (const entry of listDir(videosDir)) {
    if (!entry.isFile() || !isVideoFile(entry.name)) continue;
    const relative = `${gameName}/videos/${entry.name}`;
    try {
      const result = renameToStandard(path.join(videosDir, entry.name), options.dryRun);
      if (result.renamed) {
        stats.renamed += 1;
        console.log(`  → nome: ${relative} → ${result.fileName}`);
      }
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${relative}: ${error.message}`);
      console.error(`  ✖ falha ao padronizar ${relative}: ${error.message}`);
    }
  }

  for (const folder of listDir(videosDir).filter((entry) => entry.isDirectory())) {
    const folderPath = path.join(videosDir, folder.name);
    const relativeFolder = `${gameName}/videos/${folder.name}`;
    try {
      const videoEntries = listDir(folderPath).filter((entry) => entry.isFile() && isVideoFile(entry.name));
      const videoNamesAfter = [];
      for (const video of videoEntries) {
        const relative = `${relativeFolder}/${video.name}`;
        const result = renameToStandard(path.join(folderPath, video.name), options.dryRun);
        videoNamesAfter.push(result.fileName);
        if (result.renamed) {
          stats.renamed += 1;
          console.log(`  → nome: ${relative} → ${result.fileName}`);
        }
      }

      if (videoNamesAfter.length !== 1) continue;

      const nextFolderName = uniqueDirName(videosDir, path.parse(videoNamesAfter[0]).name, folderPath);
      if (nextFolderName === folder.name) continue;
      if (!options.dryRun) fs.renameSync(folderPath, path.join(videosDir, nextFolderName));
      stats.renamedFolders += 1;
      console.log(`  → pasta: ${relativeFolder} → ${nextFolderName}`);
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${relativeFolder}: ${error.message}`);
      console.error(`  ✖ falha ao padronizar ${relativeFolder}: ${error.message}`);
    }
  }
}

function processGameVideos(gameName, videosDir, options, stats) {
  const entries = listDir(videosDir);
  const looseVideos = entries.filter((entry) => entry.isFile() && isVideoFile(entry.name));
  const existingFolders = entries.filter((entry) => entry.isDirectory());
  const processedFolders = new Set();

  for (const video of looseVideos) {
    try {
      const { folderPath, moved } = moveLooseVideo(videosDir, video.name, options.dryRun);
      if (moved) {
        stats.moved += 1;
        console.log(`  → reorganizado: ${gameName}/videos/${video.name}`);
      }
      processedFolders.add(path.resolve(folderPath));
      processVideoFolder(gameName, folderPath, video.name, options, stats);
    } catch (error) {
      stats.failed += 1;
      stats.failures.push(`${gameName}/videos/${video.name}: ${error.message}`);
      console.error(`  ✖ falha ao reorganizar ${video.name}: ${error.message}`);
    }
  }

  for (const folder of existingFolders) {
    const folderPath = path.join(videosDir, folder.name);
    if (processedFolders.has(path.resolve(folderPath))) continue;
    processVideoFolder(gameName, folderPath, null, options, stats);
  }
}

function processVideoFolder(gameName, folderPath, knownVideoName, options, stats) {
  const relativeFolder = `${gameName}/videos/${path.basename(folderPath)}`;

  if (options.dryRun && knownVideoName && !fs.existsSync(folderPath)) {
    stats.videos += 1;
    stats.generated += 1;
    console.log(`  ★ thumb (dry-run): ${relativeFolder}/${THUMB_FILENAME}`);
    return;
  }

  if (!fs.existsSync(folderPath)) {
    stats.skipped += 1;
    return;
  }

  const entries = listDir(folderPath);
  const videoEntry = knownVideoName
    ? { name: knownVideoName }
    : findVideoInFolder(entries);

  if (!videoEntry) {
    stats.skipped += 1;
    return;
  }

  stats.videos += 1;

  if (hasThumbnail(entries, options.force)) {
    stats.existing += 1;
    return;
  }

  const videoPath = path.join(folderPath, videoEntry.name);
  const thumbPath = path.join(folderPath, THUMB_FILENAME);

  if (options.dryRun) {
    stats.generated += 1;
    console.log(`  ★ thumb (dry-run): ${relativeFolder}/${THUMB_FILENAME}`);
    return;
  }

  try {
    extractThumbnail(videoPath, thumbPath);
    stats.generated += 1;
    console.log(`  ★ thumb: ${relativeFolder}/${THUMB_FILENAME}`);
  } catch (error) {
    stats.failed += 1;
    stats.failures.push(`${relativeFolder}: ${error.message}`);
    console.error(`  ✖ falha na thumb de ${relativeFolder}: ${error.message}`);
  }
}

function printSummary(stats, options) {
  console.log('\n========== Sumário ==========');
  console.log(`Pasta de mídia:        ${options.root}`);
  console.log(`Modo:                  ${options.dryRun ? 'dry-run' : 'gravação'}`);
  console.log(`Jogos processados:     ${stats.games}`);
  console.log(`Arquivos renomeados:   ${stats.renamed}`);
  console.log(`Pastas de clip:        ${stats.renamedFolders}`);
  console.log(`Vídeos soltos movidos: ${stats.moved}`);
  console.log(`Pastas de vídeo:       ${stats.videos}`);
  console.log(`Thumbs já existentes:  ${stats.existing}`);
  console.log(`Thumbs geradas:        ${stats.generated}`);
  console.log(`Falhas:                ${stats.failed}`);
  if (stats.failures.length > 0) {
    console.log('\nFalhas:');
    for (const failure of stats.failures) {
      console.log(`  - ${failure}`);
    }
  }
  console.log('=============================\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const stats = {
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

  if (!fs.existsSync(options.root)) {
    console.error(`Pasta de mídia não encontrada: ${options.root}`);
    process.exit(1);
  }

  console.log(`Padronizando nomes e gerando thumbnails em: ${options.root}`);
  if (options.dryRun) console.log('Dry-run: nenhum arquivo será movido ou gravado.\n');
  else console.log('');

  const gameFolders = listDir(options.root).filter((entry) => entry.isDirectory());

  for (const game of gameFolders) {
    const gameDir = path.join(options.root, game.name);
    const imagesDir = path.join(gameDir, 'images');
    const videosDir = path.join(gameDir, 'videos');
    const hasImages = fs.existsSync(imagesDir) && fs.statSync(imagesDir).isDirectory();
    const hasVideos = fs.existsSync(videosDir) && fs.statSync(videosDir).isDirectory();
    if (!hasImages && !hasVideos) continue;

    stats.games += 1;
    standardizeGameFileNames(game.name, gameDir, options, stats);
    if (hasVideos) processGameVideos(game.name, videosDir, options, stats);
  }

  printSummary(stats, options);

  if (stats.failed > 0) process.exit(1);
}

main();
