---
name: feishu2md
description: 将飞书文档转换为 Markdown 格式，自动下载图片并保存到本地
---

# 飞书文档转 Markdown

将飞书云文档（wiki）转换为本地 Markdown 文件，图片自动下载到本地。

## 触发条件

当用户要求将飞书文档转为 Markdown、导出飞书文档、飞书文档下载等时触发。

## 前置条件

需要飞书开放平台应用凭证（`app_id` + `app_secret`），应用需开通以下权限：
- `docx:document:readonly` — 读取文档内容
- `drive:drive:readonly` — 下载文档中的图片/附件
- `wiki:wiki:readonly` — 可选，导出知识库目录时需要

凭证配置在 `~/.feishu2md.config.json`：
```json
{"app_id":"cli_xxx","app_secret":"xxx"}
```

## 使用方法

### 单个文档导出

```bash
feishu2md <飞书文档URL或Token> [输出目录]
```

示例：
```bash
feishu2md https://scnek46ixq9t.feishu.cn/wiki/WN5lwEaqjiv1GMkYgh1cMC4EngR ./output
feishu2md WN5lwEaqjiv1GMkYgh1cMC4EngR
```

### 输出结构

```
输出目录/
├── 文档标题.md          # 转换后的 Markdown 文件
└── image/               # 文档中的图片
    ├── token1.png
    └── token2.png
```

## 执行流程

1. 从用户输入中提取飞书文档 Token（从 URL 解析或直接使用）
2. 调用 `feishu2md <token> <output_dir>` 执行导出
3. 完成后告知用户输出路径和文件大小

## 能力与限制

| 支持 | 不支持 |
|------|--------|
| 标题、段落、文本格式 | 文档评论 |
| 表格 | 嵌入的子文档（会丢失内容） |
| 图片（自动下载） | 视频/附件 |
| 代码块 | 飞书特有的动态内容 |
| 有序/无序列表 | 思维导图 |

## 实现

底层脚本：`~/.claude/scripts/feishu2md.cjs`
使用飞书新版 docx API（`/open-apis/docx/v1/documents/:id/raw_content`）获取内容。
