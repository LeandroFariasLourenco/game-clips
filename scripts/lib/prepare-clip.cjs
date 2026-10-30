const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyMp4Faststart } = require('./mp4-faststart.cjs');

const VIDEO_THUMB_FILE = 'thumb.jpg';

let ffmpegReady = false;

function ensureFfmpeg() {
  if (ffmpegReady) return;
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error('ffmpeg não encontrado no PATH. Instale o ffmpeg para faststart e miniaturas.');
  }
  ffmpegReady = true;
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

function thumbPathFor(videoPath) {
  return path.join(path.dirname(videoPath), VIDEO_THUMB_FILE);
}

/**
 * Faststart + thumb for a single MP4. Used by local prepare, CLI, and panel upload.
 * @param {string} videoPath
 * @param {{ force?: boolean, dryRun?: boolean, faststart?: boolean, thumb?: boolean }} [options]
 */
function prepareVideoFile(videoPath, options = {}) {
  const resolved = path.resolve(videoPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Vídeo não encontrado: ${videoPath}`);
  }
  if (path.extname(resolved).toLowerCase() !== '.mp4') {
    throw new Error('prepareVideoFile aceita apenas arquivos .mp4.');
  }

  const doFaststart = options.faststart !== false;
  const doThumb = options.thumb !== false;
  const thumbPath = thumbPathFor(resolved);
  const thumbExists = fs.existsSync(thumbPath);

  const result = {
    videoPath: resolved,
    thumbPath: thumbExists ? thumbPath : null,
    faststart: 'skipped',
    thumb: 'skipped',
  };

  if (doFaststart) {
    if (!options.dryRun) ensureFfmpeg();
    result.faststart = applyMp4Faststart(resolved, { force: options.force, dryRun: options.dryRun });
  }

  if (doThumb) {
    if (!options.force && thumbExists) {
      result.thumb = 'existing';
      result.thumbPath = thumbPath;
    } else if (options.dryRun) {
      result.thumb = 'dry-run';
      result.thumbPath = thumbPath;
    } else {
      extractThumbnail(resolved, thumbPath);
      result.thumb = 'generated';
      result.thumbPath = thumbPath;
    }
  }

  return result;
}

function prepareVideoFiles(videoPaths, options = {}) {
  return (Array.isArray(videoPaths) ? videoPaths : [videoPaths]).map((filePath) =>
    prepareVideoFile(filePath, options),
  );
}

module.exports = {
  VIDEO_THUMB_FILE,
  ensureFfmpeg,
  extractThumbnail,
  prepareVideoFile,
  prepareVideoFiles,
  thumbPathFor,
};
