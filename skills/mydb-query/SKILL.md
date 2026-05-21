---
name: mydb-query
description: 通过 mydb.jdfmgt.com 查询数据库。先列出数据源供选择，可展示库中所有表，再执行 SQL 并输出结果。需要 Chrome 浏览器已登录 mydb.jdfmgt.com（脚本自动读取 Cookie）。
allowed-tools: ["Bash", "AskUserQuestion"]
---

# MyDB 数据查询

## 何时使用

当用户表达类似意图时触发并执行本流程：

- "帮我查一下 mydb 里的数据"
- "在 mydb 上执行这条 SQL"
- "查一下 xxx 数据库的数据"
- "用 mydb 查询 xxx 表"
- "mydb 数据查询"
- "展示 xxx 数据源的所有表"

以下场景不适用：

- 用户想直接修改数据（INSERT/UPDATE/DELETE）——mydb 的 commitSql 接口仅支持查询
- 用户没有 mydb 访问权限或 Chrome 浏览器未登录

---

## 前提条件

脚本通过 `browser_cookie3` 自动从 Chrome 读取登录 Cookie，**无需打开浏览器或手动传入 Cookie**。

使用前确认：
1. Chrome 浏览器已登录 http://mydb.jdfmgt.com/
2. 已安装 Python 依赖：`pip3 install browser-cookie3`

---

## 脚本位置

`~/.claude/skills/mydb-query/scripts/mydb-query.js`

---

## 第一步：选择数据源

### 1.1 获取数据源列表

```bash
cd ~/.claude/skills/mydb-query/scripts
node mydb-query.js list
```

按关键词过滤：

```bash
node mydb-query.js list <keyword>
```

展示全部：

```bash
node mydb-query.js list --all
```

### 1.2 展示数据源列表并收集选择

运行脚本后，将 stdout **原文展示给用户**（必须展示，让用户看到完整列表），然后**立即调用 AskUserQuestion** 收集用户输入：

```
AskUserQuestion({
  questions: [{
    question: "请输入序号选择数据源，或输入关键词过滤：",
    header: "选择",
    multiSelect: false,
    options: [
      { label: "输入序号", description: "直接输入上方列表中的序号，如：2" },
      { label: "输入关键词", description: "输入关键词过滤数据源，如：boss_front" }
    ]
  }]
})
```

用户通过 AskUserQuestion 的"Other"输入框直接填写序号或关键词。

### 1.3 处理用户输入

- 输入**数字序号**：从 `mydb-datasources.json` 读取对应的 `id` 和 `name`，进入第二步。
- 输入**关键词**：运行 `node mydb-query.js list <keyword>`，原文展示过滤结果，再次调用 AskUserQuestion 收集选择。
- 输入**"全部"**：运行 `node mydb-query.js list --all`，原文展示全部，再次调用 AskUserQuestion 收集选择。

---

## 第二步：选择操作

选定数据源后，**立即调用 AskUserQuestion 工具**展示两个操作选项：

```
AskUserQuestion({
  questions: [{
    question: "已选择数据源：<name>（ID: <id>）\n请选择操作：",
    header: "操作",
    multiSelect: false,
    options: [
      { label: "📋 展示所有表", description: "执行 show tables，查看该库的所有表" },
      { label: "✏️ 执行 SQL",   description: "直接输入 SQL 语句进行查询" }
    ]
  }]
})
```

收到回答后：

- 选择 **展示所有表**：执行 `node mydb-query.js query <dbId> "show tables" "<dbName>"`，原文输出结果，然后提示用户输入 SQL（用文字提示即可，此时用户已知道下一步）。
- 选择 **执行 SQL**：提示用户输入 SQL 语句，等待用户下一条消息。

---

## 第三步：执行 SQL

### 3.1 获取 SQL

- 如果用户已提供 SQL，直接使用。
- 否则提示用户输入 SQL。

### 3.2 执行查询

```bash
cd ~/.claude/skills/mydb-query/scripts
node mydb-query.js query <dbId> "<sql>" "<dbName>"
```

参数说明：
- `<dbId>`：数据源 ID（从第一步获取）
- `"<sql>"`：SQL 语句（用引号包裹）
- `"<dbName>"`：数据源名称（用于报告展示，可选）

### 3.3 展示结果

脚本直接输出以下格式，**原文展示给用户，不得修改**：

```markdown
# 📊 MyDB 查询结果

---

## 🔍 查询信息

| 项目 | 内容 |
|:-----|:-----|
| 🗄️ 数据源 | `dbName` |
| ⏱️ 耗时 | `38ms` |
| 📊 结果 | `5 row(s) returned` |

---

## 📋 数据明细

| col1 | col2 | col3 |
|:-----|:-----|:-----|
| val1 | val2 | val3 |

> 共 5 行

---

*查询时间: 2026-05-20 10:30:00*
```

规则（脚本已内置）：
- 结果为空：数据明细区显示 `> 查询结果为空`
- 结果超过 50 行：只展示前 50 行，注明"共 N 行，已展示前 50 行"
- `errMsg` 非空：整体替换为 `# ❌ MyDB 查询失败` + 错误信息

---

## 第四步：继续查询

每次输出查询结果后，调用 AskUserQuestion 询问下一步：

```
AskUserQuestion({
  questions: [{
    question: "需要继续吗？",
    header: "下一步",
    multiSelect: false,
    options: [
      { label: "继续查询", description: "保持当前数据源，输入新的 SQL" },
      { label: "换库",     description: "重新选择数据源" },
      { label: "结束",     description: "退出查询流程" }
    ]
  }]
})
```

收到回答后：

- **继续查询**：提示用户输入新 SQL，等待下一条消息执行。
- **换库**：回到第一步，重新运行 `node mydb-query.js list`。
- **结束**：流程结束，不再继续。

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| Cookie 获取失败（browser_cookie3 报错） | 提示安装依赖：`pip3 install browser-cookie3` |
| 未登录（返回 HTML 或跳转登录页） | 提示用户先访问 http://mydb.jdfmgt.com/ 完成登录 |
| 无权限（errMsg 含权限相关信息） | 提示申请对应数据源的查询权限 |
| SQL 语法错误（errMsg 含 SQL 错误） | 原样展示错误信息，建议检查 SQL |
| 网络超时 | 提示检查网络或稍后重试 |
| 数据源列表为空 | 提示用户检查账号权限 |

---

## 安全约束

- 脚本内置安全校验：只允许 SELECT / SHOW / DESC / EXPLAIN，拒绝一切写操作。
- 不展示或记录数据库密码、加密字段原文等敏感信息。
- 不自动推断或补全用户未提供的 SQL。

---

## AI 执行规则

1. 运行脚本后，将 stdout 中的查询报告**原文**展示给用户（从 `# 📊` 开头到末尾的 `*查询时间*` 行）
2. **禁止**在报告之外添加任何额外分析、总结或建议文字
3. 报告内容完全由脚本生成，AI 只负责原文透传
4. 所有需要用户做选择的节点，**必须使用 AskUserQuestion 工具**，不得用文字输出选项后等待用户回复——文字等待无法阻止 AI 继续执行后续步骤

---

## 完整交互流程

```
启动
  │
  ▼
node mydb-query.js list
  │  原文输出完整数据源列表（默认前 20 条）
  │
  ▼
AskUserQuestion（"输入序号或关键词"）← 硬阻断，用户在 Other 框输入
  │
  ├─ 输入关键词 → node mydb-query.js list <keyword>（全部匹配，不截断）
  │              → 原文输出过滤结果 → 再次 AskUserQuestion ← 硬阻断
  ├─ 输入"全部" → node mydb-query.js list --all → 原文输出 → 再次 AskUserQuestion
  └─ 输入序号   → 从 mydb-datasources.json 读取 id/name
                        │
                        ▼
              AskUserQuestion（操作选择）← 硬阻断
                        │
          ┌─────────────┴─────────────┐
          │ 展示所有表                  │ 执行 SQL
          ▼                            ▼
  node mydb-query.js query          等待用户下一条消息输入 SQL
  <dbId> "show tables"
          │
          └─────────────┬─────────────┘
                        ▼
          node mydb-query.js query <dbId> "<sql>" "<dbName>"
                        │  原文输出查询结果
                        ▼
              AskUserQuestion（下一步）← 硬阻断
                        │
          ┌─────────────┼─────────────┐
          │ 继续查询     │ 换库         │ 结束
          ▼             ▼             ▼
      等待输入SQL    回到第一步     流程结束
```

**关键设计**：
- 数据源列表用文字原文展示（无数量限制，关键词过滤后全部展示）
- `AskUserQuestion` 只负责收集用户输入（序号/关键词），作为硬阻断防止 AI 自动继续
- 操作选择和继续/换库/结束仍用 `AskUserQuestion` 弹出选项框

## 数据源列表说明

脚本输出的 `# 📦 MyDB 数据源列表` **必须原文展示给用户**，让用户看到完整列表后再做选择。展示完毕后立即调用 AskUserQuestion 收集用户输入（序号或关键词）。

## 查询结果输出模板

**严格按此格式输出，不得修改结构：**

```
# 📊 MyDB 查询结果

---

## 🔍 查询信息

| 项目 | 内容 |
|:-----|:-----|
| 🗄️ 数据源 | `{dbName}` |
| ⏱️ 耗时 | `{duration}ms` |
| 📊 结果 | `{tip}` |

---

## 📋 数据明细

| {col1} | {col2} | {col3} | ... |
|:-------|:-------|:-------|:----|
| {val}  | {val}  | {val}  | ... |
| {val}  | {val}  | {val}  | ... |

> 共 {N} 行（超 50 行时：已展示前 50 行）

---

*查询时间: {localTime}*
```

异常情况：
- 结果为空：`## 📋 数据明细` 下显示 `> 查询结果为空`
- 查询失败：整体替换为 `# ❌ MyDB 查询失败` + 错误信息
