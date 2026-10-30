const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z_(.+)#(\d+)$/;
const READ_ITEM_DATES_PS = path.join(__dirname, 'read-item-dates.ps1');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatUtcStamp(date) {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

function formatFileDateStamp(date) {
  return formatUtcStamp(date);
}

function utcStampToIso(stamp) {
  const match = String(stamp).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return stamp;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

function mediaFileLabel(gameName) {
  return String(gameName).replace(/_/g, ' ').trim() || 'game';
}

function parseStandardizedMediaName(fileName) {
  const match = path.parse(fileName).name.match(STAMP_RE);
  if (!match) return null;
  const stamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
  const iso = utcStampToIso(stamp);
  return {
    stamp,
    iso,
    date: new Date(iso),
    game: match[7],
    sequence: Number(match[8]),
  };
}

function dateFromStandardizedName(fileName) {
  return parseStandardizedMediaName(fileName)?.date ?? null;
}

function isStandardizedFileName(fileName, gameName) {
  const parsed = parseStandardizedMediaName(fileName);
  if (!parsed || Number.isNaN(parsed.date.getTime())) return false;
  if (gameName !== undefined && parsed.game !== mediaFileLabel(gameName)) return false;
  return true;
}

function buildStandardizedMediaName(date, gameName, sequence, ext) {
  const suffix = ext ? `.${String(ext).replace(/^\./, '')}` : '';
  return `${formatUtcStamp(date)}_${mediaFileLabel(gameName)}#${sequence}${suffix}`;
}

function parseLocalDateTime(text) {
  const match = String(text).trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function powershellPath() {
  if (process.platform !== 'win32') return 'powershell';
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function fallbackMtime(filePath) {
  return fs.statSync(filePath).mtime;
}

function readItemDates(filePaths) {
  const dates = new Map();
  const unique = [...new Set(filePaths.map((filePath) => path.resolve(filePath)))];

  if (unique.length === 0) return dates;

  if (process.platform === 'win32' && fs.existsSync(READ_ITEM_DATES_PS)) {
    const listFile = path.join(os.tmpdir(), `game-clips-item-dates-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(listFile, `\uFEFF${unique.join('\n')}\n`, 'utf8');
    const result = spawnSync(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        READ_ITEM_DATES_PS,
        '-PathList',
        listFile,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    try {
      fs.unlinkSync(listFile);
    } catch {
      /* ignore */
    }

    if (result.status !== 0) {
      const details = (result.stderr || result.error?.message || `powershell saiu com código ${result.status}`).trim();
      throw new Error(`Falha ao ler a coluna Data do Explorer: ${details}`);
    }

    if (result.stdout) {
      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const filePath = line.slice(0, tab).replace(/^\uFEFF/, '');
        const parsed = parseLocalDateTime(line.slice(tab + 1));
        if (parsed) dates.set(path.resolve(filePath), parsed);
      }
    }
  }

  for (const filePath of unique) {
    if (!dates.has(filePath)) dates.set(filePath, fallbackMtime(filePath));
  }

  return dates;
}

module.exports = {
  buildStandardizedMediaName,
  dateFromStandardizedName,
  formatFileDateStamp,
  formatUtcStamp,
  isStandardizedFileName,
  mediaFileLabel,
  parseStandardizedMediaName,
  readItemDates,
  utcStampToIso,
};
