# AI Skills — 赛博永生 🦞

我的 AI Agent 技能库，跨 Agent、跨机器持久化。技能定义采用通用 Markdown 格式，任何支持 prompt-based skill 的 Agent 框架均可加载。

## 技能列表

| 技能 | 说明 |
|------|------|
| `feishu2md` | 飞书文档 → Markdown，自动下载图片 |
| `sync-to-github` | 一键同步技能到 GitHub |
| `remote-server` | 远程服务器操作（SSH） |
| `code-change` | 代码变更工作流：技术方案 → 代码实现 |
| `tech-doc` | 根据 git diff 自动生成技术文档 |
| `browser-use` | 浏览器自动化操作 |
| `markdown-to-joyspace` | Markdown 文档导入 JoySpace |
| `blog-publish` | 本地 Markdown 发布到博客 |

## 目录结构

```
├── skills/          # 技能定义（Markdown 格式，Agent 无关）
│   ├── feishu2md/
│   ├── sync-to-github/
│   └── ...
├── scripts/         # 配套脚本（Node.js）
│   ├── feishu2md.cjs
│   └── sync-to-github.cjs
└── README.md
```

## 使用

```bash
# 安装到任意 Agent 工作目录
git clone https://github.com/illsdsd/claude-skills.git /path/to/agent/skills
```
