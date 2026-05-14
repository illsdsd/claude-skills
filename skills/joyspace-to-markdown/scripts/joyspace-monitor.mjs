#!/usr/bin/env node
/**
 * JoySpace Monitor — 每日对比快照，记录文档变更
 *
 * Usage:
 *   node scripts/joyspace-monitor.mjs [--data-dir <path>]
 *
 * Output:
 *   <data-dir>/snapshot.json          — 最新快照（用于下次对比）
 *   <data-dir>/daily/YYYY-MM-DD.json  — 当日变更记录
 */

import fs from "node:fs";
import path from "node:path";
import { createJoySpaceApiContext, requestJoySpaceJson } from "./joyspace-api-client.mjs";

const DEFAULT_DATA_DIR = path.resolve(
  process.env.JOYSPACE_MONITOR_DATA_DIR || path.join(process.env.HOME || "~", ".joyspace-monitor"),
);

function parseArgs(argv) {
  const opts = { dataDir: DEFAULT_DATA_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data-dir" && argv[i + 1]) {
      opts.dataDir = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return opts;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function buildPageKey(page) {
  return {
    id: page.id,
    title: page.title,
    updated_at: page.updated_at,
    created_at: page.created_at,
    word_num: page.word_num ?? 0,
    preview_text: (page.preview_text || "").slice(0, 200),
    full_name: page.full_name || page.title,
    author: page.author?.name || "",
  };
}

async function fetchAllOwnPages(ctx, pageSize = 50) {
  const allPages = [];
  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    const pages = await requestJoySpaceJson({
      method: "GET",
      url: `/v1/pages?createdBy=${encodeURIComponent(ctx.userId)}&sortBy=updatedAt&order=desc&pageSize=${pageSize}&pageNum=${pageNum}`,
      cookieHeader: ctx.cookieHeader,
      teamHeaderId: ctx.teamHeaderId,
    });

    if (!Array.isArray(pages) || pages.length === 0) {
      hasMore = false;
    } else {
      allPages.push(...pages);
      pageNum++;
      if (pages.length < pageSize) hasMore = false;
    }
  }
  return allPages;
}

function detectChanges(prevPages, currPages) {
  const prevMap = new Map(prevPages.map((p) => [p.id, p]));
  const currMap = new Map(currPages.map((p) => [p.id, p]));

  const created = [];
  const updated = [];
  const unchanged = [];

  for (const [id, curr] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      created.push({ id, title: curr.title, created_at: curr.created_at, word_num: curr.word_num });
    } else if (prev.updated_at !== curr.updated_at) {
      const wordDiff = curr.word_num - prev.word_num;
      updated.push({
        id,
        title: curr.title,
        prev_updated: prev.updated_at,
        curr_updated: curr.updated_at,
        word_num_before: prev.word_num,
        word_num_after: curr.word_num,
        word_diff: wordDiff,
      });
    } else {
      unchanged.push(id);
    }
  }

  return { created, updated, unchanged };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = opts.dataDir;
  const dailyDir = path.join(dataDir, "daily");
  const snapshotPath = path.join(dataDir, "snapshot.json");

  ensureDir(dataDir);
  ensureDir(dailyDir);

  // 1. Auth
  const baseCtx = await createJoySpaceApiContext();

  // 2. Get current user info to find userId
  // We need to get the user's ID. Let's try a few approaches:
  // Approach: just use the first page's author ID as a starting point
  // But better: try to find pages created by the current user
  // Actually, the simplest approach: use a config file for userId, or try to discover it

  // Try the /v1/teams endpoint to get team context, then use a known user ID
  // Since we know the user is 刘光源 with ID MOVQtbzRfE3rQXTSGjtQ,
  // let's accept userId as a param or env var

  const userId = process.env.JOYSPACE_USER_ID;
  if (!userId) {
    throw new Error(
      "需要设置 JOYSPACE_USER_ID 环境变量。\n" +
        "你可以通过以下方式获取：\n" +
        "1. 在 JoySpace 中打开你的个人页面\n" +
        "2. 或者运行 node -e \"const {createJoySpaceApiContext,requestJoySpaceJson}=require('./joyspace-api-client.mjs');(async()=>{const c=await createJoySpaceApiContext();const p=await requestJoySpaceJson({method:'GET',url:'/v1/pages?pageSize=1',cookieHeader:c.cookieHeader,teamHeaderId:c.teamHeaderId});console.log('你的userId:',p[0]?.author?.id, '名字:', p[0]?.author?.name)})\"",
    );
  }

  const ctx = { ...baseCtx, userId };

  // 3. Fetch all current pages
  console.error(`[monitor] Fetching pages for user: ${userId}...`);
  const rawPages = await fetchAllOwnPages(ctx);
  const currPages = rawPages.map(buildPageKey);
  console.error(`[monitor] Found ${currPages.length} pages total.`);

  // 4. Compare with previous snapshot
  const prevSnapshot = loadJson(snapshotPath);
  const prevMap = prevSnapshot?.pages ? new Map(prevSnapshot.pages.map((p) => [p.id, p])) : null;

  let changes = { created: [], updated: [], unchanged: currPages.map((p) => p.id) };

  if (prevMap) {
    changes = detectChanges(
      [...prevMap.values()],
      currPages,
    );
  } else {
    // First run — all pages are "existing", no changes to report
    console.error("[monitor] First run — saving initial snapshot, no changes to report.");
  }

  // 5. Save snapshot
  const snapshot = {
    capturedAt: new Date().toISOString(),
    userId,
    totalPages: currPages.length,
    pages: currPages.map((p) => ({
      id: p.id,
      title: p.title,
      updated_at: p.updated_at,
      created_at: p.created_at,
      word_num: p.word_num,
    })),
  };
  saveJson(snapshotPath, snapshot);

  // 6. Save daily log (only if there are actual changes, or first run marker)
  const today = new Date().toISOString().slice(0, 10);
  const dailyLogPath = path.join(dailyDir, `${today}.json`);

  // Merge with existing daily log if it exists (e.g., multiple runs in a day)
  const existingDaily = loadJson(dailyLogPath) || { date: today, created: [], updated: [] };

  // Merge without duplicates
  const existingCreatedIds = new Set(existingDaily.created.map((c) => c.id));
  const existingUpdatedIds = new Set(existingDaily.updated.map((u) => u.id));

  for (const c of changes.created) {
    if (!existingCreatedIds.has(c.id)) {
      existingDaily.created.push(c);
      existingCreatedIds.add(c.id);
    }
  }
  for (const u of changes.updated) {
    // For updates, we want the latest state
    const idx = existingDaily.updated.findIndex((eu) => eu.id === u.id);
    if (idx >= 0) {
      // Update with latest info
      existingDaily.updated[idx] = {
        ...existingDaily.updated[idx],
        ...u,
        word_num_before: existingDaily.updated[idx].word_num_before, // keep original baseline
      };
    } else {
      existingDaily.updated.push(u);
      existingUpdatedIds.add(u.id);
    }
  }

  saveJson(dailyLogPath, existingDaily);

  // 7. Output summary
  const summary = {
    date: today,
    userId,
    totalPages: currPages.length,
    created: changes.created.map((c) => c.title),
    updated: changes.updated.map((u) => u.title),
    dailyLogPath,
    snapshotPath,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[monitor] ERROR: ${error.message}`);
  process.exit(1);
});
