import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];

// 1) 投影缓存（明文 JSON）长什么样
if (file.endsWith('.json')) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('顶层键:', Object.keys(j).join(', '));
  const walk = (node, prefix = '', depth = 0) => {
    if (depth > 2 || node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
      console.log(`${'  '.repeat(depth)}${prefix}${k}: ${t}`);
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') walk(v[0], '', depth + 1);
      else if (v && typeof v === 'object') walk(v, '', depth + 1);
    }
  };
  walk(j);
  const s = JSON.stringify(j);
  console.log('\n"type":"text" 出现:', (s.match(/"type":"text"/g) || []).length);
  console.log('前 300 字符:', s.slice(0, 300));
}
