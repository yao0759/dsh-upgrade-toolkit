# DSH 升级修复工具包（DSH Upgrade Toolkit）

[English](README.md) | **中文**

一套实用、可直接运行的工具，用于在 **DeepSeek Harness（DSH）** 版本升级后恢复系统。本项目源自一次真实的 0.1.5 → 0.1.6-alpha 升级——当时 261 个会话中有 220 个损坏，并有三个插件无法激活。

如果你升级 DSH 后遇到以下任一情况，这个仓库就是为你准备的：

- `... refuses this format v0 Session: source summary requires notice form`
- `corrupt Zstandard session log: first frame is not exactly one header`
- `failed to create session: TypeError: session.events is not iterable`
- 历史对话打不开 / 模型一直卡在"加载中"
- 升级后有插件"did not activate（未激活）"

## 为什么会出现这些问题

DSH 在版本跳变时可能同时改变**会话文件格式**和**宿主插件 API**，且预稳定版本之间没有兼容性承诺。故障分为两个相互独立的层面：

1. **会话负载与分帧。** 格式校验变严格（带 `summary` 的插件源必须使用 `form: "notice"`）；而 `session.jsonl.zstd` 是一个**多帧（multi-frame）**文件，第一帧必须能独立解码且只包含头部行。若用普通 `zstd` 重压缩来修复负载，会破坏该分帧，并连锁导致工作区注册表失败。

2. **插件/宿主 API 漂移。** 插件调用的宿主接口发生变化（`session.events` → `session.snapshotEvents()`、Connection RPC 授权、Mnemon 设置 RPC）。旧版插件在升级前会停止激活。

单个损坏会话就可能让整个工作区注册表失败——这正是"只有一个对话报错"却常常伴随"模型永远加载中"的原因。

## 快速开始

需要 **Node.js ≥ 22**（`node:zlib` 已内置 zstd 支持），并在 PATH 中装有 `zstd` 命令行。

```bash
# 1. 仅扫描——不做任何改动（请务必先执行）
node scripts/migrate-sessions.mjs

# 2. 执行修复（会自动备份每个文件）
node scripts/migrate-sessions.mjs --apply

# 3. 重启 DSH
systemctl --user restart deepseek-harness.service
```

自定义会话目录：

```bash
node scripts/migrate-sessions.mjs --root /path/to/.dsh/sessions --apply
```

每个被修改的文件旁边都会生成一次性备份 `.predsmfix.bak`。工具会：解压 → 仅删除无效的、仅用于显示的 `summary` 字段 → 重建精确的多帧 Zstandard 布局 → 用 `zstd -t` 校验 → 通过后才原子替换文件。

## 插件兼容矩阵

0.1.6-alpha 升级后，以下插件需要与宿主一起更新：

| 插件 | 旧版 → 新版 | 故障 |
|---|---|---|
| `dsh-pocket` | 2.10.0 → 2.10.6 | Connection RPC / 缺少 `webServer` inject |
| `dsh-mnemon` | 0.4.4 → 0.5.12 | 设置 RPC + `remoteAccess` 授权 |
| `@anionex/dsh-vision-toolkit` | 0.1.40 → 0.1.45 | `session.events is not iterable` |

完整症状、修复方法和配置片段见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)（英文）。

## 仓库结构

```
scripts/migrate-sessions.mjs   # 主要的可运行修复工具
docs/
  TROUBLESHOOTING.md           # 每个问题的症状、根因与修复
  issues/                      # 每个遇到的故障一个文件
  config/                      # 参考配置片段
```

## 安全性

- 默认 dry-run，需显式加 `--apply`。
- 写入前自动备份。
- 每次替换都经过校验（`zstd -t`）。
- 仅删除冗余的元数据字段；指令和召回内容逐字节保留。
- 无任何网络请求，完全本地运行。

## 适用范围说明

- 针对 0.1.5 → 0.1.6-alpha 升级开发。相同机制（格式校验 + 多帧 zstd + 插件 API 漂移）也适用于后续版本跳变，但请务必先 dry-run 扫描并备份。
- 这是一个社区恢复工具，并非 DeepSeek 官方项目。
