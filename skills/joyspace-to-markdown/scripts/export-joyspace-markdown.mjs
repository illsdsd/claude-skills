#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  createJoySpaceApiContext,
  downloadDiagramXml,
  extractPageIdFromUrl,
  fetchDiagramDetail,
  fetchPageBasic,
  fetchPageContent,
} from "./joyspace-api-client.mjs";
import { joyspaceContentToMarkdown } from "./joyspace-content-to-markdown.mjs";
import { drawioXmlToMermaid } from "./joyspace-drawio-to-mermaid.mjs";

const usage = `
Usage:
  node scripts/export-joyspace-markdown.mjs --url <joyspace-url> [options]

Options:
  --url <url>                 JoySpace document URL. Required.
  --output-dir <dir>          Output directory. Defaults to current working directory.
  --output-name <filename>    Output filename. Defaults to extracted title.
  --tenant-code <tenant>      Tenant code. Defaults to env or CN.JD.GROUP.

Environment:
  JOYSPACE_DRAWIO_EXPORT_URL  Optional. If set, diagram XML is POSTed to this URL
                              expecting an SVG response, and the SVG is inlined into
                              the output Markdown. Without this, diagram blocks are
                              rendered as a link stub pointing to the saved .drawio
                              file and the original JoySpace page.
`;

const REMOVED_BROWSER_OPTIONS = new Set(["browser", "cdp-port", "cdp-port-file"]);
const REMOVED_AUTH_OPTIONS = new Set(["device-id", "startup-token", "config"]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`缺少参数值: --${key}\n${usage}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function assertNoRemovedBrowserOptions(options) {
  const found = Object.keys(options).filter((key) => REMOVED_BROWSER_OPTIONS.has(key));
  if (found.length > 0) {
    throw new Error(
      `当前脚本已切换为纯 API 导出，不再支持浏览器参数: ${found.map((key) => `--${key}`).join(", ")}`,
    );
  }
}

function assertNoRemovedAuthOptions(options) {
  const found = Object.keys(options).filter((key) => REMOVED_AUTH_OPTIONS.has(key));
  if (found.length > 0) {
    throw new Error(
      `当前脚本统一使用 relay-d2c-b 的浏览器 cookie 方式，不再支持认证参数: ${found.map((key) => `--${key}`).join(", ")}`,
    );
  }
}

function sanitizeFilename(value) {
  const cleaned = String(value || "Doc")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Doc";
}

function ensureMarkdownSuffix(filename) {
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function resolveOutputPath(outputDir, filename) {
  const initialPath = path.join(outputDir, ensureMarkdownSuffix(filename));
  if (!fs.existsSync(initialPath)) {
    return initialPath;
  }

  const parsed = path.parse(initialPath);
  let index = 1;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function inferBlockTypes(content) {
  return [...new Set((content || []).map((item) => item?.type).filter(Boolean))];
}

function collectDiagramIds(content) {
  const ids = new Set();
  const visit = (nodes) => {
    if (!Array.isArray(nodes)) {
      return;
    }
    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        continue;
      }
      if (node.type === "diagram") {
        const id = String(node.diagramId || node.id || "").trim();
        if (id) {
          ids.add(id);
        }
      }
      if (Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  };
  visit(content);
  return [...ids];
}

async function renderSvgFromXml(xml) {
  const exportUrl = process.env.JOYSPACE_DRAWIO_EXPORT_URL;
  if (!exportUrl || !xml) {
    return "";
  }
  try {
    const response = await fetch(exportUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "image/svg+xml",
      },
      body: xml,
    });
    if (!response.ok) {
      process.stderr.write(
        `[diagram] SVG 渲染失败 HTTP ${response.status} ${response.statusText}\n`,
      );
      return "";
    }
    const svg = await response.text();
    return svg.includes("<svg") ? svg : "";
  } catch (error) {
    process.stderr.write(`[diagram] SVG 渲染异常: ${error.message}\n`);
    return "";
  }
}

async function fetchDiagramEntry({ diagramId, pageId, apiContext, pageUrl }) {
  try {
    const detail = await fetchDiagramDetail({
      diagramId,
      pageId,
      cookieHeader: apiContext.cookieHeader,
      teamHeaderId: apiContext.teamHeaderId,
    });

    const linkUrl = detail?.linkUrl || detail?.link_url || detail?.url || "";
    const title = String(
      detail?.title || detail?.name || detail?.fileName || "",
    ).trim();

    let xml = "";
    if (linkUrl) {
      try {
        xml = await downloadDiagramXml(linkUrl);
      } catch (error) {
        process.stderr.write(
          `[diagram ${diagramId}] 下载 XML 失败: ${error.message}\n`,
        );
      }
    }

    const svg = xml ? await renderSvgFromXml(xml) : "";
    let mermaid = "";
    if (xml && !svg) {
      try {
        mermaid = drawioXmlToMermaid(xml) || "";
      } catch (error) {
        process.stderr.write(
          `[diagram ${diagramId}] mermaid 转换失败: ${error.message}\n`,
        );
      }
    }

    return [
      diagramId,
      {
        title,
        linkUrl,
        pageUrl,
        svg,
        mermaid,
      },
    ];
  } catch (error) {
    process.stderr.write(
      `[diagram ${diagramId}] 获取 detail 失败: ${error.message}\n`,
    );
    return [
      diagramId,
      {
        title: "",
        linkUrl: "",
        pageUrl,
        svg: "",
        mermaid: "",
        error: error.message,
      },
    ];
  }
}

async function fetchDiagramsMap({
  content,
  pageId,
  apiContext,
  pageUrl,
  concurrency = 4,
}) {
  const ids = collectDiagramIds(content);
  if (ids.length === 0) {
    return { diagrams: new Map(), ids };
  }

  const diagrams = new Map();
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const diagramId = ids[index];
      const [, info] = await fetchDiagramEntry({
        diagramId,
        pageId,
        apiContext,
        pageUrl,
      });
      diagrams.set(diagramId, info);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, ids.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return { diagrams, ids };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertNoRemovedBrowserOptions(options);
  assertNoRemovedAuthOptions(options);

  const url = options.url;
  if (!url) {
    throw new Error(`缺少 JoySpace 链接。\n${usage}`);
  }

  const pageId = extractPageIdFromUrl(url);
  const outputDir = options["output-dir"] ? path.resolve(options["output-dir"]) : process.cwd();
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error(`输出目录不存在或不可用: ${outputDir}`);
  }

  const apiContext = await createJoySpaceApiContext({
    tenantCode: options["tenant-code"],
  });

  const basic = await fetchPageBasic({
    pageId,
    cookieHeader: apiContext.cookieHeader,
    teamHeaderId: apiContext.teamHeaderId,
  });

  // Handle special page types, e.g. page_type=5 (reference/copy pages that use origin_id)
  // These return PAGE_TYPE_NOT_SUPPORT from /v1/pages/content but can fallback to origin_id
  let effectivePageId = pageId;
  let titleSource = basic;
  const pageType = basic?.page_type ?? basic?.type;
  let usedOriginId = null;
  if (pageType === 5 && basic?.origin_id) {
    process.stderr.write(
      `[info] page_type=${pageType} (reference page), falling back to origin_id=${basic.origin_id} for content fetch\n`,
    );
    effectivePageId = basic.origin_id;
    usedOriginId = basic.origin_id;
    try {
      const originBasic = await fetchPageBasic({
        pageId: effectivePageId,
        cookieHeader: apiContext.cookieHeader,
        teamHeaderId: apiContext.teamHeaderId,
      });
      titleSource = originBasic;
      process.stderr.write(`[info] Using origin title: "${originBasic?.title || "Untitled"}"\n`);
    } catch (originErr) {
      process.stderr.write(`[warn] Failed to fetch origin basic: ${originErr.message}\n`);
    }
  } else if (pageType && !["13", 13, 5, "5"].includes(String(pageType))) {
    process.stderr.write(`[warn] page_type=${pageType} may not be fully supported\n`);
  }

  const contentPayload = await fetchPageContent({
    pageId: effectivePageId,
    cookieHeader: apiContext.cookieHeader,
    teamHeaderId: apiContext.teamHeaderId,
  });

  const content = contentPayload?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(
      `JoySpace API 未返回有效的 data.content。page_type=${pageType || "unknown"}, pageId=${pageId}${
        usedOriginId ? ` (used origin ${usedOriginId})` : ""
      }`,
    );
  }

  const { diagrams, ids: diagramIds } = await fetchDiagramsMap({
    content,
    pageId: effectivePageId,  // use effective ID for diagram detail queries (matches content source)
    apiContext,
    pageUrl: url,
  });

  const conversion = joyspaceContentToMarkdown({
    title: titleSource?.title || titleSource?.full_name || basic?.title || basic?.full_name || "Doc",
    content,
    diagrams,
    pageUrl: url,
  });

  if (!conversion.markdown.trim()) {
    throw new Error("Markdown 转换结果为空。");
  }

  const requestedName = options["output-name"]
    ? sanitizeFilename(options["output-name"])
    : sanitizeFilename(conversion.title);
  const outputPath = resolveOutputPath(outputDir, requestedName);
  const markdown = conversion.markdown.endsWith("\n")
    ? conversion.markdown
    : `${conversion.markdown}\n`;

  fs.writeFileSync(outputPath, markdown, "utf8");

  const diagramSummary = [...diagrams.entries()].map(([id, info]) => ({
    diagramId: id,
    title: info.title || "",
    hasSvg: Boolean(info.svg),
    hasMermaid: Boolean(info.mermaid),
    error: info.error || undefined,
  }));

  process.stdout.write(
    `${JSON.stringify(
      {
        title: conversion.title,
        pageId,  // original pageId from URL
        effectivePageId,
        pageType,
        usedOriginId,
        outputPath,
        authMode: apiContext.authMode,
        cookieSource: apiContext.cookieSource || undefined,
        contentLength: content.length,
        blockTypes: inferBlockTypes(content),
        warnings: conversion.warnings,
        diagrams: diagramSummary,
        diagramIds,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
