/**
 * decode.js —— 把 DSH 的会话日志（多帧 zstd JSONL）解成事件数组。
 *
 * 关键点：这些文件是**几千个独立 zstd 帧首尾相接**，Node 的 zstdDecompressSync
 * 直接喂整个 buffer 只会解出第一帧。所以这里先扫描帧头 magic（0x28B52FFD），
 * 再逐帧解码——实测 3596 帧全部成功。
 *
 * 只抽出聊天内容（user/message 与 assistant/message 的文本块），其余事件丢弃。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 解出全部 JSONL 行（字符串） */
export function decodeSessionLines(file) {
  const buf = fs.readFileSync(file);
  const offsets = [];
  let idx = buf.indexOf(MAGIC);
  while (idx !== -1) {
    offsets.push(idx);
    idx = buf.indexOf(MAGIC, idx + 4);
  }
  if (offsets.length === 0) return [];

  const lines = [];
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try {
      const out = zlib.zstdDecompressSync(buf.subarray(start, end));
      if (out.length === 0) continue;
      for (const line of out.toString('utf8').split('\n')) {
        if (line.trim()) lines.push(line);
      }
    } catch {
      /* 单帧坏了就跳过，不影响整体 */
    }
  }
  return lines;
}

/** 把 "{type, data, at?}" 事件流抽成聊天消息 */
export function extractMessages(lines, sessionId) {
  const out = [];
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue;
    const content = ev.data?.message?.content ?? ev.data?.content;
    const texts = [];
    if (typeof content === 'string') texts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
      }
    }
    const text = texts.join('\n').trim();
    if (!text) continue;
    // 定时唤醒 / 计划提醒这类"机器自己投递的 user 消息"不算聊天，跳过
    if (/^\[(dsh-proactive|SCHEDULE REMINDER|meow-memory)/.test(text)) continue;
    if (/^\[Quoted message begins\]/.test(text) && text.length > 4000) continue;
    out.push({
      sessionId,
      role: ev.type === 'user/message' ? 'user' : 'assistant',
      text,
      at: typeof ev.time === 'number' ? ev.time : typeof ev.at === 'number' ? ev.at : typeof ev.data?.at === 'number' ? ev.data.at : null,
    });
  }
  return out;
}
