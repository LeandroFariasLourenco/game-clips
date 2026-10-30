const {
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runThumbs,
} = require('./lib/prepare-media.cjs');

const options = parseArgs(process.argv.slice(2));
ensureMediaRoot(options.root);
const stats = emptyStats();
runThumbs(options, stats);
printSummary(stats, options, [
  `Pastas de vídeo:       ${stats.videos}`,
  `Já com moov no início: ${stats.alreadyFaststart}`,
  `Remux faststart:       ${stats.faststart}`,
  `Thumbs já existentes:  ${stats.existing}`,
  `Thumbs geradas:        ${stats.generated}`,
]);
finish(stats);
