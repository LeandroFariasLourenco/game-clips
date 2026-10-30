const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { moovIsAtStart } = require('./mp4-faststart.cjs');

function box(type, payload = Buffer.alloc(0)) {
  const buf = Buffer.alloc(8 + payload.length);
  buf.writeUInt32BE(buf.length, 0);
  buf.write(type, 4, 4, 'ascii');
  payload.copy(buf, 8);
  return buf;
}

function writeLayout(filePath, types) {
  fs.writeFileSync(filePath, Buffer.concat(types.map((type) => box(type, Buffer.alloc(4)))));
}

test('prepareVideoFile rejects missing files', () => {
  const { prepareVideoFile } = require('./prepare-clip.cjs');
  assert.throws(
    () => prepareVideoFile(path.join(os.tmpdir(), 'missing-clip-xyz.mp4')),
    /não encontrado/i,
  );
});

test('moovIsAtStart detects moov before mdat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststart-'));
  const ready = path.join(dir, 'ready.mp4');
  const late = path.join(dir, 'late.mp4');
  writeLayout(ready, ['ftyp', 'moov', 'mdat']);
  writeLayout(late, ['ftyp', 'mdat', 'moov']);
  assert.equal(moovIsAtStart(ready), true);
  assert.equal(moovIsAtStart(late), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
