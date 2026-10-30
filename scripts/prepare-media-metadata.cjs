const path = require('path');
const dotenv = require('dotenv');
const {
  emptyStats,
  ensureMediaRoot,
  finish,
  parseArgs,
  printSummary,
  runMetadata,
} = require('./lib/prepare-media.cjs');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_PUBLIC_BASE_URL = 'https://d3nyc65v53ljin.cloudfront.net';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), override: true, quiet: true });
dotenv.config({ path: path.join(PROJECT_ROOT, 'media-panel', '.env'), override: true, quiet: true });

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePublicBaseUrl(cliValue) {
  const raw =
    (typeof cliValue === 'string' ? cliValue.trim() : '') ||
    readEnv('AWS_S3_PUBLIC_BASE_URL') ||
    readEnv('VITE_MEDIA_BUCKET_URL') ||
    DEFAULT_PUBLIC_BASE_URL;
  return raw.replace(/\/+$/, '');
}

const options = parseArgs(process.argv.slice(2));
options.publicBaseUrl = resolvePublicBaseUrl(options.publicBaseUrl);
ensureMediaRoot(options.root);
const stats = emptyStats();
runMetadata(options, stats);
printSummary(stats, options, [
  `URL pública:           ${options.publicBaseUrl}`,
  `metadata.json novos:   ${stats.generated}`,
  `metadata.json iguais:  ${stats.existing}`,
]);
finish(stats);
