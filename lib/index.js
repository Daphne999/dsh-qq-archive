/**
 * dsh-qq-archive —— 把 DSH 会话日志里的聊天内容归档成可检索的本地库。
 *
 * 为什么从会话日志入手：QQ/IM 插件的消息不对外暴露，但宿主本来就把每条
 * user/message、assistant/message 落到 ~/.dsh/sessions/**.zstd 里。那份日志
 * 是多帧 zstd（几千帧首尾相接），直接解只能拿到第一帧——lib/decode.js 里有逐帧解码。
 *
 * 暴露三个工具：
 *   qq_archive_sync  { dir?, limit? }  扫描日志并入库（幂等，重复跑不会重复写）
 *   qq_archive_search { query, limit? } 关键词检索历史对话
 *   qq_archive_stats  {}               库里有多少、覆盖哪些会话
 *
 * 隐私：全部本地 SQLite，不上传；DB 位置可配置，删掉即清空。
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { decodeSessionLines, extractMessages } from './decode.js';
import { openStore, insertMessages, search, stats } from './store.js';

export const name = 'dsh-qq-archive';
export const inject = [];

const defaultSessionsDir = () => path.join(os.homedir(), '.dsh', 'sessions');
const defaultDb = () => path.join(os.homedir(), '.dsh', 'qq-archive.db');

/** 递归找出所有会话日志文件 */
function listSessionFiles(root, max = 5000) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= max) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl.zstd')) out.push(full);
      if (out.length >= max) return;
    }
  };
  walk(root);
  return out;
}

const sessionIdOf = (file) => {
  // .../sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd，或 .../sessions/<workspace>/<file>.zstd
  const parts = file.split(/[\\/]/);
  const idx = parts.lastIndexOf('sessions');
  if (idx === -1) return path.basename(file).replace(/\.(v\d+)?\.?jsonl\.zstd$/, '');
  const rest = parts.slice(idx + 1);
  return rest.length >= 2 ? rest[1].replace(/\.(v\d+)?\.?jsonl\.zstd$/, '') : path.basename(file);
};

export async function apply(ctx, config = {}) {
  const log = (line) => {
    try {
      ctx.logger?.info?.(`[dsh-qq-archive] ${line}`);
    } catch {}
    try {
      console.log(`[dsh-qq-archive] ${line}`);
    } catch {}
  };

  const sessionsDir = config.sessionsDir ? path.resolve(config.sessionsDir) : defaultSessionsDir();
  const dbFile = config.dbPath ? path.resolve(config.dbPath) : defaultDb();

  let db;
  try {
    db = openStore(dbFile);
  } catch (err) {
    log(`⚠️ 打不开 SQLite（${dbFile}）：${err.message}；工具不注册`);
    return;
  }

  let tools;
  try {
    tools = ctx.get('tools');
  } catch {
    tools = undefined;
  }
  if (!tools?.register) {
    log('⚠️ tools 服务不可用，归档工具未注册');
    return;
  }

  const text = (s) => ({ type: 'text', text: s });

  tools.register({
    name: 'qq_archive_sync',
    description:
      'Import chat history from DSH session logs into the local archive DB. Reads ~/.dsh/sessions/**.jsonl.zstd '
      + '(multi-frame zstd), extracts user/assistant text messages, and inserts them idempotently. Safe to run '
      + 'repeatedly: already-imported messages are skipped.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Override the sessions directory (default ~/.dsh/sessions).' },
        limit: { type: 'number', description: 'Max number of session files to scan (default 200).' },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: true },
      render: (_a, v) => [text(v?.report ?? '')],
    },
    async execute(args) {
      const root = args?.dir ? path.resolve(args.dir) : sessionsDir;
      const limit = Math.max(1, Math.min(2000, Number(args?.limit) || 200));
      const files = listSessionFiles(root, limit);
      let scanned = 0;
      let inserted = 0;
      let messages = 0;
      const failures = [];
      for (const file of files) {
        try {
          const lines = decodeSessionLines(file);
          const rows = extractMessages(lines, sessionIdOf(file));
          messages += rows.length;
          inserted += insertMessages(db, rows);
          scanned++;
        } catch (err) {
          failures.push(`${path.basename(file)}: ${err.message}`);
        }
      }
      const report = [
        `扫描 ${scanned}/${files.length} 个会话文件`,
        `抽出 ${messages} 条消息，新入库 ${inserted} 条（重复的自动跳过）`,
        failures.length ? `失败 ${failures.length} 个：${failures.slice(0, 3).join('; ')}` : '没有失败',
      ].join('\n');
      log(`sync → 扫描 ${scanned} / 新入库 ${inserted}`);
      return { ok: true, scanned, messages, inserted, report };
    },
  });

  tools.register({
    name: 'qq_archive_search',
    description:
      'Search the local chat archive by keyword (SQLite LIKE). Returns the most recent matching messages with their '
      + 'role (user/assistant) and timestamp. Use it when the user asks "我之前说过什么/上次那个事".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to search for.' },
        limit: { type: 'number', description: 'Max results (default 10, max 100).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: true },
      render: (_a, v) => [text(v?.report ?? '')],
    },
    async execute(args) {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error('qq_archive_search: query 不能为空');
      const rows = search(db, query, args?.limit ?? 10);
      if (rows.length === 0) return { ok: true, count: 0, report: `没有找到包含「${query}」的消息（先跑 qq_archive_sync 入库）` };
      const lines = rows.map((r) => {
        const when = r.at ? new Date(r.at).toLocaleString('zh-CN') : '时间未知';
        return `[${r.role === 'user' ? '我' : '小鱼'} ${when}] ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`;
      });
      return { ok: true, count: rows.length, report: `找到 ${rows.length} 条：\n${lines.join('\n')}` };
    },
  });

  tools.register({
    name: 'qq_archive_stats',
    description: 'Report what the local chat archive currently holds: message count, per-role split, time range, and the heaviest sessions.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: true },
      render: (_a, v) => [text(v?.report ?? '')],
    },
    async execute() {
      const s = stats(db);
      const span = s.range?.first && s.range?.last ? `${new Date(s.range.first).toLocaleDateString('zh-CN')} → ${new Date(s.range.last).toLocaleDateString('zh-CN')}` : '无';
      const roles = s.byRole.map((r) => `${r.role === 'user' ? '我' : '小鱼'} ${r.c}`).join(' / ');
      const report = [`共 ${s.total} 条消息（${roles || '空'}）`, `时间跨度：${span}`, `会话数：${s.bySession.length}（最多的一条 ${s.bySession[0]?.c ?? 0} 条）`].join('\n');
      return { ok: true, report };
    },
  });

  log(`✅ 三个工具已注册（db: ${dbFile}）`);
}
