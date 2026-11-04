/**
 * smoke.mjs —— 用假 ctx 验证三个归档工具的真行为。
 *
 * 流程：注册 → sync（真扫 ~/.dsh/sessions）→ stats → search。
 * 用临时 DB，不动用户的真实归档。
 *
 * 用法：node test/smoke.mjs [临时db路径]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';

const dbPath = process.argv[2] || path.join(os.tmpdir(), `qq-archive-smoke-${Date.now()}.db`);
const registered = [];
const fakeCtx = {
  logger: { info: () => {} },
  get: (k) => (k === 'tools' ? { register: (def) => registered.push(def) } : undefined),
  effect: () => {},
  on: () => {},
};

await apply(fakeCtx, { dbPath, sessionsDir: path.join(os.homedir(), '.dsh', 'sessions') });

const byName = (n) => registered.find((t) => t.name === n);
for (const n of ['qq_archive_sync', 'qq_archive_search', 'qq_archive_stats']) {
  if (!byName(n)) {
    console.error(`❌ 缺少工具 ${n}`);
    process.exit(1);
  }
}
console.log('✅ 三个工具已注册');

const syncOut = await byName('qq_archive_sync').execute({ limit: 3 });
console.log('\n--- sync ---\n' + syncOut.report);

const statsOut = await byName('qq_archive_stats').execute();
console.log('\n--- stats ---\n' + statsOut.report);

const searchOut = await byName('qq_archive_search').execute({ query: '插件', limit: 3 });
console.log('\n--- search(插件) ---\n' + searchOut.report.slice(0, 600));

// 幂等性：再跑一次 sync，新入库应为 0
const again = await byName('qq_archive_sync').execute({ limit: 3 });
if (again.inserted !== 0) {
  console.error(`❌ 幂等性失败：第二次 sync 又写入了 ${again.inserted} 条`);
  process.exit(1);
}
console.log('\n✅ 幂等性通过（第二次新入库 0 条）');

try {
  fs.unlinkSync(dbPath);
} catch {}
console.log('\n临时库已清理:', dbPath);
