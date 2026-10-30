const {
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runNames,
} = require('./lib/prepare-media.cjs');

const options = parseArgs(process.argv.slice(2));
ensureMediaRoot(options.root);
const stats = emptyStats();
runNames(options, stats);
printSummary(stats, options, [`Arquivos renomeados:   ${stats.renamed}`]);
finish(stats);
