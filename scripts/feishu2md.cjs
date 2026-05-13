#!/usr/bin/env node
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ========== 配置 ==========
function loadConfig() {
  const configPath = path.join(os.homedir(), ".feishu2md.config.json");
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (cfg.app_id && cfg.app_secret) return cfg;
    } catch (_) {}
  }
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    return { app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET };
  }
  console.error("未找到飞书凭证。请配置 ~/.feishu2md.config.json 或环境变量");
  process.exit(1);
}

// ========== Token ==========
async function getTenantToken(cfg) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ app_id: cfg.app_id, app_secret: cfg.app_secret });
    const req = https.request(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const j = JSON.parse(raw);
          if (j.code === 0) resolve(j.tenant_access_token);
          else reject(new Error(`获取 token 失败: ${raw}`));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function apiGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(raw);
          if (j.code === 0) resolve(j.data);
          else reject(new Error(`API 错误 [${j.code}]: ${j.msg}`));
        } catch (e) {
          reject(new Error(`解析失败: ${raw.slice(0, 200)}`));
        }
      });
    }).on("error", reject);
  });
}

function downloadFile(url, filepath, token) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath)) return resolve("skip");
    const req = https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, (r2) => {
          const file = fs.createWriteStream(filepath);
          r2.pipe(file);
          r2.on("end", () => { file.close(); resolve("ok"); });
          r2.on("error", reject);
        }).on("error", reject);
        return;
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      res.on("end", () => { file.close(); resolve("ok"); });
    });
    req.on("error", reject);
  });
}

function extractToken(input) {
  const m = input.match(/\/wiki\/([A-Za-z0-9]+)/);
  return m ? m[1] : input.trim();
}

// ========== Block → Markdown 核心转换 ==========

// block_type → 元素属性名 映射
const BLOCK_TYPE_KEY = {
  2: "text",
  3: "heading1", 4: "heading2", 5: "heading3",
  6: "heading4", 7: "heading5", 8: "heading6", 9: "heading7",
  12: "bullet",
  13: "ordered",
  14: "code",
  15: "quote",
  17: "callout",
  22: "divider",
  24: "quote_container",
  25: "table",
  26: "table_cell",
  27: "image",
  30: "sheet",
  31: "file",
  32: "grid",
  33: "grid_column",
  34: "iframe",
};

// heading block_type → # 数量
const HEADING_LEVEL = { 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7 };

// 将 text_run elements 数组转为内联 Markdown 字符串
function elementsToInline(elements) {
  if (!elements) return "";
  return elements.map((el) => {
    if (el.text_run) {
      let text = el.text_run.content || "";
      const style = el.text_run.text_element_style || {};
      // 转义 Markdown 特殊字符（在非代码模式下）
      if (!style.inline_code) {
        // 只转义可能破坏格式的字符
      }
      if (style.inline_code) text = `\`${text}\``;
      if (style.bold) text = `**${text}**`;
      if (style.italic) text = `*${text}*`;
      if (style.strikethrough) text = `~~${text}~~`;
      if (style.underline) text = `<u>${text}</u>`;
      if (el.text_run.text_element_style?.link) {
        const url = el.text_run.text_element_style.link.url || "";
        text = `[${text}](${url})`;
      }
      return text;
    }
    if (el.mention_user) return `@${el.mention_user.name || el.mention_user.user_id || ""}`;
    if (el.mention_doc) return `[${el.mention_doc.title || "文档"}](${el.mention_doc.url || ""})`;
    if (el.mention_date) return el.mention_date.value || "";
    if (el.equation) return `$${el.equation.content || ""}$`;
    return "";
  }).join("");
}

// 有序列表计数追踪
const orderedCounters = [];

function getOrderedNumber(sequence, depth) {
  if (sequence && sequence !== "auto" && /^\d+$/.test(sequence)) {
    const num = parseInt(sequence, 10);
    orderedCounters[depth] = num;
    return num;
  }
  if (orderedCounters[depth] === undefined) {
    orderedCounters[depth] = 1;
  } else {
    orderedCounters[depth]++;
  }
  return orderedCounters[depth];
}

// 单个 block → Markdown（可能多行，如表格）
function blockToMarkdown(block, imageTokens, listContext) {
  const bt = block.block_type;
  const key = BLOCK_TYPE_KEY[bt];
  if (!key) return "";

  const data = block[key];
  if (!data) return "";

  // Heading
  if (HEADING_LEVEL[bt]) {
    const level = HEADING_LEVEL[bt];
    const text = elementsToInline(data.elements);
    const prefix = "#".repeat(level) + " ";
    return prefix + text + "\n";
  }

  // Paragraph / Text
  if (bt === 2) {
    const text = elementsToInline(data.elements);
    if (!text.trim()) return "\n";
    return text + "\n";
  }

  // Bullet list
  if (bt === 12) {
    const text = elementsToInline(data.elements);
    const indent = "  ".repeat(listContext.depth || 0);
    return indent + "- " + text + "\n";
  }

  // Ordered list
  if (bt === 13) {
    const text = elementsToInline(data.elements);
    const depth = listContext.depth || 0;
    const num = getOrderedNumber(data.style?.sequence, depth);
    const indent = "  ".repeat(depth);
    return indent + num + ". " + text + "\n";
  }

  // Code block
  if (bt === 14) {
    const code = elementsToInline(data.elements);
    const lang = data.style?.language || "";
    return "```" + lang + "\n" + code + "\n```\n";
  }

  // Quote
  if (bt === 15) {
    const text = elementsToInline(data.elements);
    return "> " + text + "\n";
  }

  // Divider
  if (bt === 22) return "---\n";

  // Image
  if (bt === 27) {
    const imgToken = data.token;
    const filename = imgToken + ".png";
    imageTokens.set(imgToken, filename);
    return `![${filename}](image/${filename})\n`;
  }

  // Table - simplified, just note it
  if (bt === 25) return ""; // handled via child cells if needed

  // Quote container
  if (bt === 24) return "";

  // Fallback for known but unhandled types
  return "";
}

// 获取文档标题
function extractTitle(blocks) {
  for (const b of blocks) {
    if (b.block_type === 3 && b.heading1) {
      const text = elementsToInline(b.heading1.elements);
      if (text.trim()) return text.trim();
    }
  }
  return "untitled";
}

// ========== 主流程 ==========
async function main() {
  const cfg = loadConfig();
  const input = process.argv[2];
  if (!input) {
    console.error("用法: feishu2md <飞书文档URL|文档Token> [输出目录]");
    process.exit(1);
  }

  const docToken = extractToken(input);
  const outputDir = process.argv[3] || path.join(process.cwd(), "feishu-export");
  const imageDir = path.join(outputDir, "image");

  [outputDir, imageDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  console.log(`文档 Token: ${docToken}`);

  // 1. 获取 Token
  const token = await getTenantToken(cfg);

  // 2. 获取所有 block
  console.log("获取文档结构...");
  const blockData = await apiGet(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks?page_size=500`,
    token
  );
  const blocks = blockData.items || [];

  // 3. 构建 block_id → block 的 Map
  const blockMap = new Map();
  for (const b of blocks) {
    blockMap.set(b.block_id, b);
  }

  // 4. 获取文档标题
  const title = extractTitle(blocks);

  // 5. 找到根节点，按 children 顺序遍历
  const root = blocks.find((b) => b.block_type === 1);
  if (!root) {
    console.error("未找到文档根节点");
    process.exit(1);
  }

  const imageTokens = new Map();
  const listContext = { depth: 0 };
  let markdown = "";

  // 递归处理块，遵循 parent-child 层级
  function walkBlock(blockId, depth) {
    const block = blockMap.get(blockId);
    if (!block) return;

    // 跳过根节点本身
    if (block.block_type !== 1) {
      const md = blockToMarkdown(block, imageTokens, { depth });
      markdown += md;
    }

    // 处理子块
    const children = block.children || [];
    for (const childId of children) {
      walkBlock(childId, block.block_type === 12 || block.block_type === 13 ? depth + 1 : depth);
    }
  }

  // 6. 从根节点开始遍历
  if (root.children) {
    for (const childId of root.children) {
      walkBlock(childId, 0);
    }
  } else {
    // 如果没有 children，尝试按原始顺序遍历
    for (const b of blocks) {
      if (b.block_type === 1) continue;
      if (!b.parent_id || b.parent_id === docToken) {
        markdown += blockToMarkdown(b, imageTokens, { depth: 0 });
      }
    }
  }

  // 7. 下载图片
  if (imageTokens.size > 0) {
    console.log(`下载 ${imageTokens.size} 张图片...`);
    let downloaded = 0;
    for (const [imgToken, filename] of imageTokens) {
      try {
        const result = await downloadFile(
          `https://open.feishu.cn/open-apis/drive/v1/medias/${imgToken}/download`,
          path.join(imageDir, filename),
          token
        );
        if (result === "ok") {
          downloaded++;
          process.stdout.write(`\r  进度: ${downloaded}/${imageTokens.size}`);
        }
      } catch (e) {
        console.error(`\n  图片 ${imgToken} 下载失败: ${e.message}`);
      }
    }
    if (downloaded > 0) console.log();
  }

  // 8. 保存
  const safeTitle = title.replace(/[\/\\:*?"<>|]/g, "-");
  const mdPath = path.join(outputDir, `${safeTitle}.md`);
  fs.writeFileSync(mdPath, markdown, "utf-8");

  console.log(`导出完成: ${mdPath}`);
  console.log(`内容大小: ${Buffer.byteLength(markdown, "utf-8")} bytes`);
  console.log(`图片数量: ${imageTokens.size}`);
}

main().catch((e) => {
  console.error("导出失败:", e.message);
  process.exit(1);
});
