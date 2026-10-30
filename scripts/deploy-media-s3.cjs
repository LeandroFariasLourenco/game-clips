const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_MEDIA_ROOT = path.join(PROJECT_ROOT, 'media');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), override: true, quiet: true });

function parseArgs(argv) {
  const options = {
    root: DEFAULT_MEDIA_ROOT,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--root') {
      options.root = path.resolve(argv[i + 1] || '');
      i += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = path.resolve(arg.slice('--root='.length));
    }
  }

  return options;
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBucketUri() {
  const raw = readEnv('AWS_S3_BUCKET') || readEnv('AWS_S3-BUCKET');
  if (!raw) {
    throw new Error(
      'Defina AWS_S3_BUCKET (ou AWS_S3-BUCKET) no ambiente ou no .env. Ex.: s3://meu-bucket ou meu-bucket',
    );
  }
  return raw.startsWith('s3://') ? raw.replace(/\/+$/, '') : `s3://${raw.replace(/^\/+|\/+$/g, '')}`;
}

function resolveRegion() {
  const region = readEnv('AWS_REGION') || readEnv('AWS_DEFAULT_REGION');
  if (!region) {
    throw new Error('Defina AWS_REGION no ambiente ou no .env.');
  }
  return region;
}

function run(command, args, label) {
  console.log(`\n▶ ${label}\n   ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.error) {
    throw new Error(`${label} falhou: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} encerrou com código ${result.status}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const bucket = resolveBucketUri();
  const region = resolveRegion();

  if (!fs.existsSync(options.root)) {
    console.error(`Pasta de mídia não encontrada: ${options.root}`);
    process.exit(1);
  }

  const syncArgs = ['s3', 'sync', options.root, bucket, '--region', region];
  if (options.dryRun) syncArgs.push('--dryrun');

  console.log('Deploy de mídia para o S3');
  console.log(`  pasta:  ${options.root}`);
  console.log(`  bucket: ${bucket}`);
  console.log(`  região: ${region}`);
  if (options.dryRun) console.log('  modo:   dry-run (nada será enviado ao S3)');

  run('aws', syncArgs, 'Sync para o S3');

  console.log('\n✅ Deploy de mídia concluído.\n');
}

try {
  main();
} catch (error) {
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
}
