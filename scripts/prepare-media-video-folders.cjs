const {
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runFolders,
} = require('./lib/prepare-media.cjs');

const options = parseArgs(process.argv.slice(2));
ensureMediaRoot(options.root);
const stats = emptyStats();
runFolders(options, stats);
printSummary(stats, options, [
  `Vídeos soltos movidos: ${stats.moved}`,
  `Pastas de clip:        ${stats.renamedFolders}`,
]);
finish(stats);
