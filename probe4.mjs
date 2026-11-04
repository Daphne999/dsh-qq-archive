import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
const file = fs.readdirSync(dir).find((n) => n.endsWith('.zstd'));
const buf = fs.readFileSync(path.join(dir, file));

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
let idx = buf.indexOf(magic);
while (idx !== -1) {
  offsets.push(idx);
  idx = buf.indexOf(magic, idx + 4);
}
console.log('帧数:', offsets.length);

let ok = 0;
let fail = 0;
const lines = [];
for (let i = 0; i < offsets.length; i++) {
  const start = offsets[i];
  const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
  try {
    const out = zlib.zstdDecompressSync(buf.subarray(start, end));
    if (out.length) {
      ok++;
      lines.push(...out.toString('utf8').split('\n').filter(Boolean));
    }
  } catch {
    fail++;
  }
}
console.log('单帧解码: 成功', ok, '失败', fail, '| 拿到行数', lines.length);

const types = {};
for (const l of lines) {
  try {
    const j = JSON.parse(l);
    types[j.type] = (types[j.type] || 0) + 1;
  } catch {}
}
console.log('事件类型:', JSON.stringify(types).slice(0, 500));
