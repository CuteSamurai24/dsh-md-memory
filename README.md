# dsh-md-memory

English | [简体中文](README.zh.md)

A **small file memory** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The model writes what should persist as markdown under `~/.dsh/memory`. Next session, the host injects it.

This is not a second brain. The community already has fuller memory plugins (auto-extract, vector search, settings dashboards). This one stays small: the disk holds files you can open in a text editor, and nothing is saved unless the model calls `memory`.

MIT

## What it does

- Remembers preferences, corrections, and reusable lessons across sessions
- Three files: `user.md` (cross-project) / `agent/MEMORY.md` (hot rules) / `agent/topics/*.md` (on-demand topics)
- Project-only facts belong in the repo `AGENTS.md`, not here
- **Subagents cannot write**, so parallel tasks cannot scramble memory
- If you say things like “remember / from now on / don’t ever”, and nothing was stored this turn, the host nudges the model

## What it does not do

- No automatic extraction from the chat
- No secret scanning (do not let the model write tokens here)
- No vector / full-text engine (`search` is a plain substring)
- No browser settings page

Do not install this next to another plugin that also registers a tool named `memory`.

## Install

```sh
dsh plugin --profile web add github:CuteSamurai24/dsh-md-memory
```

Then restart `dsh web`.

Uninstall:

```sh
dsh plugin --profile web remove dsh-md-memory
```

Files stay in `~/.dsh/memory`. Uninstalling the plugin does not delete them.

## Where the files live

```
~/.dsh/memory/
  user.md              You, across projects: identity, tone, standing preferences
  agent/MEMORY.md      Hot rules for almost every session (keep this short)
  agent/topics/*.md    Topics, read when the description matches
```

On Windows that is `C:\Users\<you>\.dsh\memory\`. Open the files in Notepad to check, edit, or delete.

## How the model writes

One tool, named `memory`:

| Operation | Use |
| --- | --- |
| `read` / `search` / `list` | Read |
| `append` / `edit` / `write` | Write a layer |
| `create` / `delete` | Manage topics |

Appending to `user` requires a one-sentence `reason`: why this still holds on a different project.

Caps: user 8KB, hot rules 12KB, one topic 20KB. Long material goes in a topic.

## Turn it off

On by default. In `~/.dsh/settings.yaml`:

```yaml
md-memory:
  enabled: false
```

Later turns in this process stop injecting and stop offering the tool. Restarting `dsh web` is the simplest way.

## Other memory plugins

DSH has no official long-term memory product. The community already has KV stores, auto-extract, persona files, and heavier “evolve” suites. This plugin only covers one narrow need: **the model writes markdown, a human can open it.**

## License

[MIT](LICENSE) © CuteSamurai24
