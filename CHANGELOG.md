# Changelog

## 0.1.1 — 2026-11-08

- 声明 `inject = ['tools']`，确保 tools 服务就绪后再注册工具（修复隔离 profile 启动时报「tools 服务不可用」）。
- 会话目录与 SQLite 路径优先使用 `DSH_HOME`，不再硬编码 `~/.dsh`。

## 0.1.0 — 2026-11-04

首个版本。

- b37fd22 chore: add repository metadata
- f44f3c4 feat: initial release

