# Claude Code Skills — 赛博永生 🦞

我的 Claude Code 技能库，实现跨机器、跨会话的技能持久化。

## 技能列表

| 技能 | 说明 |
|------|------|
| `feishu2md` | 飞书文档 → Markdown，自动下载图片 |
| `remote-server` | 阿里云 ECS 服务器远程操作 |
| `code-change` | 代码变更标准工作流：技术方案 → 代码实现 |
| `tech-doc` | 根据 git diff 自动生成技术优化文档 |
| `browser-use` | 浏览器自动化操作 |
| `markdown-to-joyspace` | Markdown 导入 JoySpace |
| `skill` | 强制中文交互规范 |

## 安装到新机器

```bash
git clone https://github.com/illsdsd/claude-skills.git ~/.claude/skills-repo
cp -r ~/.claude/skills-repo/skills/* ~/.claude/skills/
cp -r ~/.claude/skills-repo/scripts/* ~/.claude/scripts/
```
