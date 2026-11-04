import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
const file = fs.readdirSync(dir).find((n) => n.endsWith('.zstd'));
const full = path.join(dir, file);
const buf = fs.readFileSync(full);

// 数一下 zstd 帧头（magic 0x28 B5 2F FD）
let frames = 0;
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) frames++;
}
console.log('文件:', file, Math.round(buf.length / 1024) + 'KB', '| zstd 帧头出现次数:', frames);
console.log('可用的 zstd API:', Object.keys(zlib).filter((k) => /zstd/i.test(k)).join(', '));

const tryDecompress = (label, fn) => {
  try {
    const out = fn();
    const text = out.toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    console.log(`\n[${label}] 解出 ${lines.length} 行, ${Math.round(text.length / 1024)}KB`);
    return lines;
  } catch (e) {
    console.log(`\n[${label}] 失败: ${e.message}`);
    return null;
  }
};

let lines = tryDecompress('sync', () => zlib.zstdDecompressSync(buf));

if ((!lines || lines.length <= 1) && typeof zlib.createZstdDecompress === 'function') {
  const stream = zlib.createZstdDecompress();
  const chunks = [];
  await new Promise((resolve) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', resolve);
    stream.on('error', (e) => {
      console.log('stream error:', e.message);
      resolve();
    });
    stream.end(buf);
  });
  const text = Buffer.concat(chunks).toString('utf8');
  const l2 = text.split('\n').filter(Boolean);
  console.log(`\n[stream] 解出 ${l2.length} 行, ${Math.round(text.length / 1024)}KB`);
  if (l2.length > (lines?.length || 0)) lines = l2;
}

if (lines && lines.length) {
  const types = {};
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      types[j.type] = (types[j.type] || 0) + 1;
    } catch {}
  }
  console.log('\n事件类型:', JSON.stringify(types).slice(0, 400));
  for (const l of lines.slice(0, 6)) {
    try {
      const j = JSON.parse(l);
      console.log('·', j.type, '| keys:', Object.keys(j).join(',').slice(0, 100));
    } catch {}
  }
}
