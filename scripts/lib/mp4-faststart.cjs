const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function moovIsAtStart(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let offset = 0;
    const header = Buffer.alloc(16);
    while (offset + 8 <= size) {
      fs.readSync(fd, header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (offset + 16 > size) return false;
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (!Number.isFinite(boxSize) || boxSize < headerSize) return false;
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      offset += boxSize;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function remuxMp4Faststart(filePath) {
  const tmpPath = path.join(
    path.dirname(filePath),
    `.faststart-${process.pid}-${Math.random().toString(16).slice(2)}.mp4`,
  );
  const backupPath = `${filePath}.bak-faststart`;
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', tmpPath],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !fs.existsSync(tmpPath)) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    const details = (result.stderr || result.error?.message || 'ffmpeg falhou ao aplicar faststart.').trim();
    throw new Error(details);
  }

  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  fs.renameSync(filePath, backupPath);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.renameSync(backupPath, filePath);
    } catch {
      // original already moved; leave backup for recovery
    }
    throw error;
  }
  fs.unlinkSync(backupPath);
}

function applyMp4Faststart(filePath, options = {}) {
  if (!options.force && moovIsAtStart(filePath)) return 'already';
  if (options.dryRun) return 'dry-run';
  remuxMp4Faststart(filePath);
  return 'remuxed';
}

module.exports = {
  applyMp4Faststart,
  moovIsAtStart,
  remuxMp4Faststart,
};
