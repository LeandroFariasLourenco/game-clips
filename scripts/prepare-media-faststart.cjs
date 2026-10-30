const {
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runFaststart,
} = require('./lib/prepare-media.cjs');

const options = parseArgs(process.argv.slice(2));
ensureMediaRoot(options.root);
const stats = emptyStats();
runFaststart(options, stats);
printSummary(stats, options, [
  `Pastas de vídeo:       ${stats.videos}`,
  `Já com moov no início: ${stats.alreadyFaststart}`,
  `Remux faststart:       ${stats.faststart}`,
]);
finish(stats);
