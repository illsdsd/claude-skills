---
name: blog-publish
description: 将本地 Markdown 文件发布到个人博客。当用户要求发布文章到博客、推送 .md 文件到博客、通过 CLI 发博客时触发。
---

# 博客发布

将本地 Markdown 文件一键发布到个人博客（http://8.140.221.24）。

## 前置条件

- `curl` 可用
- `python3` 可用
- 博客服务器运行中（8.140.221.24:3000，通过 nginx 80 端口代理）

## 使用方法

```bash
blog-publish.sh <文件路径>            # 直接发布
blog-publish.sh <文件路径> --draft    # 保存为草稿
```

示例：
```bash
blog-publish.sh ~/articles/my-post.md
blog-publish.sh ~/articles/my-post.md --draft
```

## 支持的文件格式

支持标准 Markdown 文件（`.md` / `.markdown`），可选 YAML frontmatter 作为元数据。

### Frontmatter 支持的字段

```yaml
---
title: 文章标题          # 必填，不填则用文件名
slug: my-post-slug       # 必填，不填则从标题自动生成
tags: JavaScript, React  # 可选，逗号分隔
excerpt: 文章摘要         # 可选
cover_url: https://...   # 可选，封面图URL
---
```

没有 frontmatter 时，用文件名作为标题，自动生成 slug。

## 执行流程

1. 确认用户指定的 .md 文件存在
2. 调用 `blog-publish.sh <文件路径>` 执行发布
3. 解析输出，返回文章链接（格式：`http://8.140.221.24/post/<slug>`）

## 原理

本地脚本通过 HTTP API 与博客交互：

```
本地 .md → Python 解析 frontmatter + 正文
         → 构建 JSON {title, slug, content_md, tags, ...}
         → curl POST /api/posts (Bearer Token 认证)
         → 服务端 marked 渲染 MD → HTML → 存入 SQLite
```

API Token 硬编码在脚本中，通过 `Authorization: Bearer <token>` 头认证。

## 实现

脚本路径：`~/bin/blog-publish.sh`

环境变量覆盖：
- `BLOG_API` — API 地址（默认 `http://8.140.221.24`）
- `BLOG_TOKEN` — API Token（默认已内置）

## 限制

- slug 重复时会报 HTTP 409，需要手动处理（改 slug 或先用 API 删除旧文章）
- 图片需要引用外部 URL 或在博客后台编辑器粘贴上传后拿到 `/uploads/xxx` 地址再引用
- 文件编码需要 UTF-8
