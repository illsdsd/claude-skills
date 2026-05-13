#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const os = require("os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: CLAUDE_DIR, encoding: "utf-8", ...opts });
  } catch (e) {
    console.error(`命令失败: ${cmd}\n${e.stderr || e.message}`);
    process.exit(1);
  }
}

console.log("赛博永生 — 同步 Claude Skills 到 GitHub\n");

// 1. 进入 ~/.claude
process.chdir(CLAUDE_DIR);

// 2. 拉取远端更新（防止冲突）
console.log("拉取远端...");
try { run("git pull --rebase origin main"); } catch (e) { /* 首次可能没有上游 */ }

// 3. 暂存 skills/ 和 scripts/ 目录
console.log("暂存变更...");
run("git add skills/ scripts/ README.md .gitignore");

// 4. 检查是否有变更
const status = run("git status --porcelain");
if (!status.trim()) {
  console.log("没有变更，无需推送。");
  process.exit(0);
}

// 5. 显示变更摘要
const changedFiles = status.trim().split("\n").length;
console.log(`检测到 ${changedFiles} 个文件变更:`);
console.log(status);

// 6. 提交
const msg = process.argv[2] || `sync: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
console.log(`\n提交: ${msg}`);
run(`git commit -m "${msg}"`);

// 7. 推送
console.log("推送到 GitHub...");
run("git push origin main");

console.log("\n同步完成！https://github.com/illsdsd/claude-skills");
