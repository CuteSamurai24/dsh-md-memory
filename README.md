# dsh-md-memory

DeepSeek Harness 的**小文件记忆**插件。模型把该记住的东西写成 `~/.dsh/memory` 里的 markdown，下次开会话由 host 自动塞进上下文。

这不是「第二大脑」。社区里已经有更完整的记忆插件（自动抽取、向量检索、设置大盘）。本插件刻意做小：磁盘上就是人能打开的文件，只有模型主动调用 `memory` 才会落盘。

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · MIT

## 它做什么

- 跨会话记住用户偏好、纠正和可复用教训
- 三层文件：`user.md`（跨项目） / `agent/MEMORY.md`（热规则） / `agent/topics/*.md`（按需专题）
- 项目专属事实请写仓库里的 `AGENTS.md`，不要写进这里
- **子代理不能写**，避免并行任务把记忆写乱
- 你说「记住 / 以后都 / 别再」这类话时，如果这轮还没写入，host 会提醒模型考虑落盘

## 它不做什么

- 不自动从对话里提炼记忆
- 不扫描密钥（不要让模型把 token 写进来）
- 不做向量 / 全文检索引擎（`search` 只是简单子串）
- 不提供浏览器管理页

请勿和同样注册名为 `memory` 的插件一起安装。

## 安装

```sh
dsh plugin --profile web add github:lq2224-collab/dsh-md-memory
```

然后重启 `dsh web`。

卸载：

```sh
dsh plugin --profile web remove dsh-md-memory
```

记忆文件留在 `~/.dsh/memory`，卸载插件不会删除它们。

## 文件在哪

```
~/.dsh/memory/
  user.md              跨项目的你：身份、沟通习惯、长期偏好
  agent/MEMORY.md      几乎每个会话都该遵守的热规则（保持短）
  agent/topics/*.md    专题，描述对得上再读
```

Windows 上就是 `C:\Users\<你>\.dsh\memory\`。用记事本打开即可检查、改、删。

## 模型怎么写

一个工具，名字叫 `memory`：

| 操作 | 用途 |
| --- | --- |
| `read` / `search` / `list` | 读 |
| `append` / `edit` / `write` | 写一层 |
| `create` / `delete` | 管专题 |

往 `user` 追加时必须带一句 `reason`：为什么这条在别的项目里也成立。

上限：user 8KB，热规则 12KB，单个专题 20KB。长内容请放到 topic。

## 关掉

默认开启。在 `~/.dsh/settings.yaml` 里写：

```yaml
md-memory:
  enabled: false
```

改完后新的一轮不再注入、不再提供 `memory` 工具。重启 `dsh web` 最省事。

## 和别的记忆插件

DSH 官方没有内置长期记忆产品。社区已经有 KV / 自动抽取 / 人格文件 / 重型「进化」方案。本插件只覆盖其中一条窄需求：**模型写 markdown，人能打开看。**

## License

[MIT](LICENSE) © lq2224-collab
