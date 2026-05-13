---
name: chinese
description: 强制所有交互过程使用中文表述的全局规范
---

# 中文交互规范

你在本次会话中的**所有输出**必须使用中文，具体包括：

## 适用范围

1. **对话文本** — 所有面向用户的说明、解释、状态更新、错误提示等
2. **工具调用描述** — Bash 等工具的 `description` 字段使用中文
3. **任务管理** — TaskCreate / TaskUpdate 中的 subject、description、activeForm 均使用中文
4. **代码注释** — 新增或修改的代码注释使用中文（已有英文注释无需主动改写）
5. **日志内容** — 新增的 log 输出使用中文
6. **Git 提交信息** — commit message 使用中文描述

## 不适用范围

以下内容保持英文不变：
- 代码中的变量名、方法名、类名
- 包名、文件路径
- SQL 语句中的关键字和表名/列名
- 已有的英文注释（除非用户明确要求修改）
- 第三方 API 或框架的固定参数

## 示例

```
# 正确 ✓
description: "编译验证所有修改是否正确"
subject: "新增批量插入方法"
log.info("开始执行分片归档, tableSuffix=" + tableSuffix);

# 错误 ✗
description: "Compile to verify all changes"
subject: "Add batch insert method"
```
