/**
 * robustness.mjs —— 坏输入不崩溃测试。
 *
 * 会话日志可能被截断、损坏、只有头帧；这些情况必须返回空结果而不是抛异常，
 * 否则一次 sync 就会把整个归档流程打断。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeSessionLines, extractMessages } from '../lib/decode.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-robust-'));
const cases = [];

// 1. 只有 zstd magic 的垃圾数据
{
  const f = path.join(dir, 'garbage.zstd');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from('not really compressed')]));
  cases.push(['只有 magic 的垃圾', f]);
}

// 2. 空文件
{
  const f = path.join(dir, 'empty.zstd');
  fs.writeFileSync(f, Buffer.alloc(0));
  cases.push(['空文件', f]);
}

// 3. 合法帧 + 截断帧（模拟写一半断电）
{
  const good = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '你好' }] } }) + '\n'));
  const f = path.join(dir, 'truncated.zstd');
  fs.writeFileSync(f, Buffer.concat([good, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01])]));
  cases.push(['合法帧 + 截断帧', f]);
}

// 4. 不是 zstd 的普通文本
{
  const f = path.join(dir, 'plain.zstd');
  fs.writeFileSync(f, 'this is not zstd at all');
  cases.push(['纯文本冒充 zstd', f]);
}

let failed = 0;
for (const [name, file] of cases) {
  try {
    const lines = decodeSessionLines(file);
    const msgs = extractMessages(lines, 'test');
    console.log(`✅ ${name}: 行 ${lines.length}，消息 ${msgs.length}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}: 抛异常 ${e.message}`);
  }
}

// 5. 合法帧应能被识别出来（第 3 个用例里有一条真消息）
try {
  const lines = decodeSessionLines(path.join(dir, 'truncated.zstd'));
  const msgs = extractMessages(lines, 'test');
  if (msgs.length === 1 && msgs[0].text === '你好') {
    console.log('✅ 截断文件里的合法消息仍被解出');
  } else {
    failed++;
    console.log(`❌ 期望 1 条「你好」，实际 ${msgs.length} 条`);
  }
} catch (e) {
  failed++;
  console.log('❌ 截断文件解析抛异常:', e.message);
}

for (const f of fs.readdirSync(dir)) {
  try {
    fs.unlinkSync(path.join(dir, f));
  } catch {}
}
try {
  fs.rmdirSync(dir);
} catch {}

console.log(failed === 0 ? '\n✅ 坏输入全部被安全处理' : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
