#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const os = require("os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: CLAUDE_DIR, encoding: "utf-8", stdio: "pipe", ...opts });
  } catch (e) {
    console.error(`命令失败: ${cmd}\n${e.stderr || e.message}`);
    process.exit(1);
  }
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { cwd: CLAUDE_DIR, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch (_) {
    return "";
  }
}

// 检测系统代理状态
function detectProxy() {
  try {
    const out = execSync("networksetup -getwebproxy Wi-Fi", { encoding: "utf-8" });
    const enabled = /Enabled:\s*Yes/i.test(out);
    const port = (out.match(/Port:\s*(\d+)/) || [])[1];
    if (enabled && port) {
      return { host: "127.0.0.1", port };
    }
  } catch (_) {}
  return null;
}

function setGitProxy(host, port) {
  runSilent(`git config http.proxy http://${host}:${port}`);
  runSilent(`git config https.proxy http://${host}:${port}`);
}

function clearGitProxy() {
  runSilent("git config --unset http.proxy");
  runSilent("git config --unset https.proxy");
}

console.log("赛博永生 — 同步 Claude Skills 到 GitHub\n");

// 1. 进入 ~/.claude
process.chdir(CLAUDE_DIR);

// 2. 检测代理，自动配置 git 代理
const proxy = detectProxy();
const hadProxy = runSilent("git config http.proxy") !== "";
let proxyWasSet = false;

if (proxy) {
  console.log(`检测到系统代理 ${proxy.host}:${proxy.port}，自动配置 git 代理...`);
  setGitProxy(proxy.host, proxy.port);
  proxyWasSet = true;
}

try {
  // 3. 暂存变更
  console.log("暂存变更...");
  run("git add skills/ scripts/ README.md .gitignore");

  // 4. 检查是否有变更
  const status = run("git status --porcelain");
  if (!status.trim()) {
    console.log("没有变更，无需推送。");
    process.exit(0);
  }

  // 5. stash + pull + stash pop（避免冲突）
  console.log("拉取远端...");
  run("git stash");
  try { run("git pull --rebase origin main"); } catch (_) {}
  try { run("git stash pop"); } catch (_) {}

  // 6. 显示变更摘要
  const changedFiles = status.trim().split("\n").length;
  console.log(`检测到 ${changedFiles} 个文件变更:`);
  console.log(status);

  // 7. 提交
  const msg = process.argv[2] || `sync: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
  console.log(`提交: ${msg}`);
  run(`git commit -m "${msg}"`);

  // 8. 推送
  console.log("推送到 GitHub...");
  run("git push origin main");

  console.log("\n同步完成！https://github.com/illsdsd/claude-skills");
} finally {
  // 如果之前没有 git 代理，且是我们设的，还原
  if (proxyWasSet && !hadProxy) {
    clearGitProxy();
    console.log("已还原 git 代理设置");
  }
}
