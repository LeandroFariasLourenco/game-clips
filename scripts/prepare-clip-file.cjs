const path = require('path');
const { prepareVideoFiles } = require('./lib/prepare-clip.cjs');

function parseFiles(argv) {
  const files = [];
  const options = { force: false, dryRun: false, faststart: true, thumb: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-thumb') options.thumb = false;
    else if (arg === '--no-faststart') options.faststart = false;
    else if (arg === '--file') {
      files.push(argv[i + 1] || '');
      i += 1;
    } else if (arg.startsWith('--file=')) {
      files.push(arg.slice('--file='.length));
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    }
  }

  return { files: files.filter(Boolean).map((file) => path.resolve(file)), options };
}

const { files, options } = parseFiles(process.argv.slice(2));
if (files.length === 0) {
  console.error('Uso: node scripts/prepare-clip-file.cjs --file <clip.mp4> [--file <outro.mp4>]');
  process.exit(1);
}

try {
  const results = prepareVideoFiles(files, options);
  for (const result of results) {
    console.log(
      `${path.basename(result.videoPath)}: faststart=${result.faststart} thumb=${result.thumb}${
        result.thumbPath ? ` (${path.basename(result.thumbPath)})` : ''
      }`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
