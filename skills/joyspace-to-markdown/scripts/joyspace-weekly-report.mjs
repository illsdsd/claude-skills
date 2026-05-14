#!/usr/bin/env node
/**
 * JoySpace Weekly Report — 按 JD 周报模板格式生成
 *
 * Usage:
 *   node scripts/joyspace-weekly-report.mjs [--data-dir <path>] [--output <path>] [--week <YYYY-Www>] [--ai]
 *
 * Environment:
 *   JOYSPACE_USER_ID        — JoySpace 用户 ID (必需)
 *   JOYSPACE_REPORT_OUTPUT  — 周报输出目录 (默认: ~/.joyspace-monitor/reports/)
 *   JOYSPACE_AI_API_KEY     — AI 总结 API Key (--ai 模式必需)
 *   JOYSPACE_AI_BASE_URL    — AI API 地址 (默认: https://api.deepseek.com/v1)
 *   JOYSPACE_AI_MODEL       — AI 模型 (默认: deepseek-chat)
 */

import fs from "node:fs";
import path from "node:path";
import { createJoySpaceApiContext, requestJoySpaceJson } from "./joyspace-api-client.mjs";

const DEFAULT_DATA_DIR = path.resolve(
  process.env.JOYSPACE_MONITOR_DATA_DIR || path.join(process.env.HOME || "~", ".joyspace-monitor"),
);
const DEFAULT_OUTPUT_DIR = process.env.JOYSPACE_REPORT_OUTPUT
  ? path.resolve(process.env.JOYSPACE_REPORT_OUTPUT)
  : path.join(DEFAULT_DATA_DIR, "reports");

const AI_BASE_URL = process.env.JOYSPACE_AI_BASE_URL || loadJson(path.join(DEFAULT_DATA_DIR, "config.json"))?.aiBaseUrl || "https://api.deepseek.com/v1";
const AI_MODEL = process.env.JOYSPACE_AI_MODEL || loadJson(path.join(DEFAULT_DATA_DIR, "config.json"))?.aiModel || "deepseek-chat";

function getAIKey() {
  return process.env.JOYSPACE_AI_API_KEY || loadJson(path.join(DEFAULT_DATA_DIR, "config.json"))?.aiApiKey || "";
}

function parseArgs(argv) {
  const opts = { dataDir: DEFAULT_DATA_DIR, outputDir: DEFAULT_OUTPUT_DIR, week: null, ai: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data-dir" && argv[i + 1]) {
      opts.dataDir = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--output" && argv[i + 1]) {
      opts.outputDir = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--week" && argv[i + 1]) {
      opts.week = argv[i + 1];
      i++;
    } else if (argv[i] === "--ai") {
      opts.ai = true;
    }
  }
  return opts;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

// ─── Text extraction from JoySpace content blocks ───

function extractBlockText(block) {
  if (!block) return "";
  if (typeof block.text === "string" && block.text.trim()) return block.text;
  if (Array.isArray(block.children)) {
    return block.children.map((c) => extractBlockText(c)).join("");
  }
  return "";
}

const SKIP_BLOCK_TYPES = new Set(["table", "table-row", "table-cell", "block-code"]);

/** Extract full plain text from document content blocks (no tables/code) */
function extractFullText(content) {
  const paragraphs = [];
  for (const block of content) {
    if (!block || SKIP_BLOCK_TYPES.has(block.type)) continue;
    const text = extractBlockText(block).trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

function extractSectionBlocks(content) {
  const sections = [];
  let currentSection = null;

  for (const block of content) {
    if (!block || SKIP_BLOCK_TYPES.has(block.type)) continue;
    const text = extractBlockText(block).trim();
    const isHeader =
      block.type === "p" &&
      text &&
      /^[一二三四五六七八九十]+[、.]/.test(text);

    if (isHeader) {
      if (currentSection) sections.push(currentSection);
      currentSection = { header: text, body: [] };
    } else if (currentSection && text) {
      currentSection.body.push(text);
    } else if (!currentSection && text && !sections.length) {
      currentSection = { header: "_preamble", body: [text] };
    }
  }
  if (currentSection) sections.push(currentSection);
  return sections;
}

function extractDocumentSummary(content, title) {
  const sections = extractSectionBlocks(content);
  const fullText = extractFullText(content);
  const background = sections
    .find((s) => s.header.includes("业务背景") || s.header.includes("背景"))
    ?.body?.[0]
    ?.slice(0, 300) || "";

  return { title, background, sections, fullText };
}

// ─── AI Summarization ───

const AI_SUMMARY_PROMPT = `你是一位京东技术团队的周报撰写助手。请根据以下文档内容，用 1-2 句话概括本周的**实际进展**（做了什么、完成了什么、当前状态），而不是描述文档结构。

要求：
- 只输出 1-2 句中文
- 聚焦行动和结果，不要说"文档包含"、"本章节介绍了"
- 语气专业、简洁
- 如果有技术细节（如版本号、接口名、架构调整），保留关键信息
- 不超过 80 字`;

async function summarizeWithAI(docSummary) {
  const apiKey = getAIKey();
  if (!apiKey) {
    console.error("[ai] JOYSPACE_AI_API_KEY not set, skipping AI summarization");
    return null;
  }

  const { title, fullText } = docSummary;
  // Truncate text to avoid token limits (DeepSeek context is large, but keep it reasonable)
  const text = fullText.slice(0, 6000);

  console.error(`[ai] Summarizing: ${title.slice(0, 60)}...`);

  try {
    const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: AI_SUMMARY_PROMPT },
          { role: "user", content: `文档标题：${title}\n\n文档内容：\n${text}` },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ai] API error ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    const summary = data?.choices?.[0]?.message?.content?.trim();
    if (summary) {
      console.error(`[ai] → ${summary.slice(0, 100)}`);
      return summary;
    }
    return null;
  } catch (e) {
    console.error(`[ai] Request failed: ${e.message}`);
    return null;
  }
}

async function runAISummaries(summaries) {
  const results = new Map();
  for (const s of summaries) {
    const aiSummary = await summarizeWithAI(s);
    if (aiSummary) results.set(s.title, aiSummary);
  }
  return results;
}

// ─── Report generation ───

function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getMondayOfISOWeek(year, weekNum) {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - (jan4Day - 1));
  const monday = new Date(firstMonday);
  monday.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
  return monday;
}

async function fetchDocumentSummaries(pageIds, ctx) {
  const summaries = [];
  for (const pageId of pageIds) {
    try {
      let title = "未命名";
      const basic = await requestJoySpaceJson({
        method: "GET",
        url: `/v3/pages/${pageId}/basic?sendRecent=0`,
        cookieHeader: ctx.cookieHeader,
        teamHeaderId: ctx.teamHeaderId,
      });
      title = basic?.title || basic?.full_name || "未命名";

      let effectivePageId = pageId;
      if (basic?.page_type === 5 && basic?.origin_id) {
        effectivePageId = basic.origin_id;
      }

      const payload = await requestJoySpaceJson({
        method: "POST",
        url: "/v1/pages/content",
        cookieHeader: ctx.cookieHeader,
        teamHeaderId: ctx.teamHeaderId,
        body: { pageId: effectivePageId },
      });
      const content = payload?.content || [];
      const summary = extractDocumentSummary(content, title);
      summary.pageId = pageId;
      summaries.push(summary);
    } catch (e) {
      console.error(`[report] Failed to fetch doc ${pageId}: ${e.message}`);
    }
  }
  return summaries;
}

function projectName(title) {
  let name = title.replace(/^\d{8}[-—–\s]*/, "").trim();
  if (name.length > 40) name = name.slice(0, 40) + "…";
  return name;
}

function buildReport({ weekLabel, createdSummaries, updatedSummaries, reportDate, userName, aiSummaries }) {
  // Deduplicate
  const createdMap = new Map(createdSummaries.map((s) => [s.pageId, s]));
  const deduped = [...updatedSummaries.map((s) => ({ ...s, isNew: false }))];
  for (const [id, s] of createdMap) {
    if (!deduped.find((d) => d.pageId === id)) {
      deduped.push({ ...s, isNew: true });
    }
  }
  const allDocs = deduped;

  const statusIcon = (s) => {
    const title = s.title || "";
    const bg = s.background || "";
    if (title.includes("风险") || title.includes("紧急") || bg.includes("风险")) return "⚠️ 风险";
    if (title.includes("预警") || bg.includes("预警")) return "🟡 预警";
    return "🟢 正常";
  };

  let r = "";
  r += `您好：\n`;
  r += `以下是本周周报，请审阅\n\n`;

  // ── 一、待决策 ──
  r += `一、待决策/需支持/需关注事项：\n`;
  const riskItems = allDocs.filter(
    (d) => statusIcon(d) === "⚠️ 风险" || statusIcon(d) === "🟡 预警",
  );
  if (riskItems.length > 0) {
    for (const item of riskItems) {
      r += `1. ${statusIcon(item)} ${projectName(item.title)}：${item.background.slice(0, 80)}…\n`;
    }
  } else {
    r += `1. 需关注/需支持/待决策：无\n`;
  }
  r += `\n`;

  // ── 二、本周重点工作 ──
  r += `二、本周重点工作：\n`;
  let idx = 1;
  for (const doc of allDocs) {
    const icon = statusIcon(doc);
    const name = projectName(doc.title);
    const aiSummary = aiSummaries?.get(doc.title);

    r += `${idx}. ${icon} 【账务】${name}：\n`;
    r += `l 进展：\n`;

    if (aiSummary) {
      // AI-generated progress summary
      r += `  ${aiSummary}\n`;
    } else {
      // Fallback: extract first paragraph of each non-background section
      const nonBgSections = doc.sections?.filter(
        (s) => !s.header.includes("业务背景") && !s.header.includes("背景") && s.header !== "_preamble",
      ) || [];
      if (nonBgSections.length > 0) {
        for (const sec of nonBgSections.slice(0, 3)) {
          const bodyText = sec.body[0]?.slice(0, 120) || "";
          if (bodyText) r += `  - ${sec.header}：${bodyText}\n`;
        }
      } else {
        r += `  ${doc.isNew ? "新建文档" : "更新文档"}，详细内容见下方链接\n`;
      }
    }

    // Background
    const bgText = doc.sections
      ?.find((s) => s.header.includes("业务背景") || s.header.includes("背景"))
      ?.body?.[0]
      ?.slice(0, 200) || "";
    if (bgText) {
      r += `l 背景：${bgText}\n`;
    }

    const link = doc.pageId
      ? `https://joyspace.jd.com/pages/${doc.pageId}`
      : "JoySpace 文档链接";
    r += `l 进度：${doc.isNew ? "本周新建" : "本周更新"}，详见：${link}\n`;
    r += `\n`;
    idx++;
  }

  // ── 三、下周重点工作 ──
  r += `三、下周重点工作：\n`;
  if (allDocs.length > 0) {
    r += `1. 持续完善本周新建/更新的文档\n`;
    r += `2. 根据业务进展更新对应 JoySpace 文档\n`;
  } else {
    r += `1. 持续跟进账务相关需求\n`;
  }
  r += `\n`;

  // ── Footer ──
  r += `${userName || "刘光源"}\n`;
  r += `京东科技JDT金融科技事业部-金融科技研发部-支付基础研发部-商户服务研发部\n`;

  return r;
}

async function generateReport(opts) {
  const { dataDir, outputDir, week, ai } = opts;
  const dailyDir = path.join(dataDir, "daily");

  if (!fs.existsSync(dailyDir)) {
    throw new Error(`每日记录目录不存在: ${dailyDir}。请先运行 joyspace-monitor.mjs 进行数据采集。`);
  }

  const userId = process.env.JOYSPACE_USER_ID;
  if (!userId) throw new Error("需要设置 JOYSPACE_USER_ID 环境变量");

  // Determine week range
  let monday, sunday;
  if (week) {
    const [y, w] = week.split("-W").map(Number);
    monday = getMondayOfISOWeek(y, w);
    sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
  } else {
    const range = getWeekRange();
    monday = range.monday;
    sunday = range.sunday;
  }

  // Collect daily logs
  const dailyLogs = [];
  const d = new Date(monday);
  while (d <= sunday) {
    const dateKey = formatDate(d);
    const logPath = path.join(dailyDir, `${dateKey}.json`);
    const log = loadJson(logPath);
    if (log && (log.created?.length || log.updated?.length)) {
      dailyLogs.push({ date: dateKey, ...log });
    }
    d.setDate(d.getDate() + 1);
  }

  // Collect unique page IDs
  const createdIds = new Set();
  const updatedIds = new Set();
  for (const log of dailyLogs) {
    for (const c of log.created || []) createdIds.add(c.id);
    for (const u of log.updated || []) updatedIds.add(u.id);
  }

  if (createdIds.size === 0 && updatedIds.size === 0) {
    console.error("[report] No changes this week, generating empty report.");
    const weekLabel = week || `${formatDate(monday)} ~ ${formatDate(sunday)}`;
    const report = buildReport({
      weekLabel,
      createdSummaries: [],
      updatedSummaries: [],
      reportDate: new Date().toISOString().slice(0, 10),
      userName: process.env.JOYSPACE_USER_NAME || "刘光源",
      aiSummaries: new Map(),
    });
    return saveReport(report, outputDir, week || formatDate(monday));
  }

  // Auth for content fetching
  const baseCtx = await createJoySpaceApiContext();
  const ctx = { ...baseCtx, userId };

  // Fetch content for all changed docs
  console.error(`[report] Fetching ${createdIds.size} new + ${updatedIds.size} updated docs...`);
  const createdSummaries = await fetchDocumentSummaries([...createdIds], ctx);
  const updatedSummaries = await fetchDocumentSummaries([...updatedIds], ctx);

  // AI summarization
  let aiSummaries = new Map();
  if (ai) {
    console.error("[report] Running AI summarization...");
    aiSummaries = await runAISummaries([...createdSummaries, ...updatedSummaries]);
  }

  // Build report
  const weekLabel = week || `${formatDate(monday)} ~ ${formatDate(sunday)}`;
  const report = buildReport({
    weekLabel,
    createdSummaries,
    updatedSummaries,
    reportDate: new Date().toISOString().slice(0, 10),
    userName: process.env.JOYSPACE_USER_NAME || "刘光源",
    aiSummaries,
  });

  return saveReport(report, outputDir, week || formatDate(monday));
}

function saveReport(report, outputDir, weekLabel) {
  ensureDir(outputDir);
  const fileName = weekLabel.includes("-W")
    ? `report-${weekLabel}.md`
    : `report-${weekLabel}.md`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, report, "utf8");
  return { outputPath, weekLabel };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.ai && !getAIKey()) {
    console.error("[report] WARNING: --ai flag set but JOYSPACE_AI_API_KEY not configured. Falling back to basic mode.");
  }
  const result = await generateReport(opts);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[report] ERROR: ${error.message}`);
  process.exit(1);
});
