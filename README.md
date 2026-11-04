# dsh-qq-archive

> 把 DSH 的聊天历史变成**本地可检索的库** —— 不需要任何外部服务、不上传。

QQ / Telegram / 微信这些 IM 通道的消息内容，插件层通常拿不到；但宿主本来就把每条 `user/message`、`assistant/message` 写进了 `~/.dsh/sessions/**.jsonl.zstd`。

问题在于：**那份日志是几千个 zstd 帧首尾相接**，直接丢给 `zstdDecompressSync` 只能解出第一帧（一个 `session` 头）。这个插件里有逐帧解码器，实测 3596 帧全解。

## 装

```bash
dsh plugin --profile web add dsh-qq-archive
```

## 三个工具

| 工具 | 作用 |
|---|---|
| `qq_archive_sync` | 扫描 `~/.dsh/sessions/**.jsonl.zstd`，抽 user/assistant 文本入库（**幂等**，重复跑不会重复写） |
| `qq_archive_search` | 关键词检索历史对话，返回角色 + 时间 + 片段 |
| `qq_archive_stats` | 库里有多少条、时间跨度、哪些会话最多 |

## 用起来是什么样

```
> qq_archive_sync {}
扫描 3/3 个会话文件
抽出 393 条消息，新入库 393 条（重复的自动跳过）

> qq_archive_search { "query": "重启" }
[我 2026/11/4 14:27:39] 我们把睡眠关了，插电不休眠…
[小鱼 2026/11/4 09:12:02] 重启会中断会话，记录在磁盘上不会丢…
```

## 设计取舍

- **只存文本**：图片、工具调用结果不进库（日志里太大，检索价值低）
- **过滤机器消息**：`[dsh-proactive …]`、`[SCHEDULE REMINDER …]` 这类定时唤醒不算聊天，跳过
- **幂等**：唯一索引 `(session_id, role, at, text)`，同一会话反复 sync 不会膨胀
- **纯本地**：`~/.dsh/qq-archive.db`（node:sqlite，无需编译），删掉即清空

## 已知限制

- 只能读到**宿主写下来的**日志；日志被轮转/删除就没法补
- 逐帧解码依赖帧头 magic 扫描，文件格式若变动需要跟着改
- 检索是 `LIKE`，不做分词/向量 —— 对聊天这种短文本够用，量大后可以换 FTS5

## License

MIT
