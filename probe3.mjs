import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
const file = fs.readdirSync(dir).find((n) => n.endsWith('.zstd'));
const buf = fs.readFileSync(path.join(dir, file));

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
let idx = buf.indexOf(magic);
while (idx !== -1 && offsets.length < 20) {
  offsets.push(idx);
  idx = buf.indexOf(magic, idx + 4);
}
console.log('前几个帧偏移:', offsets.slice(0, 8));

for (const [i, off] of offsets.slice(0, 4).entries()) {
  try {
    const out = zlib.zstdDecompressSync(buf.subarray(off));
    const lines = out.toString('utf8').split('\n').filter(Boolean);
    console.log(`帧#${i} (offset ${off}) → ${lines.length} 行, ${Math.round(out.length / 1024)}KB`);
    if (lines.length > 1) {
      const types = {};
      for (const l of lines) {
        try {
          const j = JSON.parse(l);
          types[j.type] = (types[j.type] || 0) + 1;
        } catch {}
      }
      console.log('   事件类型:', JSON.stringify(types).slice(0, 300));
    }
  } catch (e) {
    console.log(`帧#${i} (offset ${off}) 失败: ${e.message}`);
  }
}
