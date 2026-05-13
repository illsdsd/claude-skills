---
name: sync-to-github
description: 一键将 Claude Code 技能和脚本同步到 GitHub 实现赛博永生
---

# 赛博永生 — 同步到 GitHub

将本地 `~/.claude/skills/` 和 `~/.claude/scripts/` 一键提交并推送到 GitHub。

## 触发条件

当用户要求同步到 GitHub、上传技能、赛博永生、备份 skill 等时触发。

## 执行

```bash
node ~/.claude/scripts/sync-to-github.cjs "<提交信息>"
```

如果用户没有提供提交信息，自动使用时间戳。

## 仓库

https://github.com/illsdsd/claude-skills

## 安装到新机器

```bash
git clone https://github.com/illsdsd/claude-skills.git /tmp/claude-skills
cp -r /tmp/claude-skills/skills/* ~/.claude/skills/
cp -r /tmp/claude-skills/scripts/* ~/.claude/scripts/
```
