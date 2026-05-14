import test from "node:test";
import assert from "node:assert/strict";

import { joyspaceContentToMarkdown } from "./joyspace-content-to-markdown.mjs";

test("converts main block types (paragraph, heading, list, table, highlight, foldable, text-draw, img, divider, icon-link, diagram placeholder)", () => {
  const result = joyspaceContentToMarkdown({
    title: "Sample Doc",
    content: [
      { type: "p", children: [{ text: "Sample Doc" }] },
      { type: "list", header: 1, children: [{ text: "Overview" }] },
      {
        type: "p",
        children: [
          { text: "Hello " },
          { bold: true, text: "world" },
          { text: " " },
          { strike: true, text: "old" },
          { text: " " },
          { underline: true, text: "new" },
          { text: " " },
          { type: "mention", value: { name: "Alice" }, children: [{ text: "" }] },
          { type: "mention", value: { name: "Carol" }, children: [{ text: "" }] },
        ],
      },
      { type: "list", value: "ordered", children: [{ text: "First item" }] },
      { type: "list", value: "ordered", indent: 1, children: [{ text: "Nested item" }] },
      { type: "list", value: "checkbox", children: [{ text: "Todo item" }] },
      {
        type: "table",
        children: [
          {
            type: "table-row",
            children: [
              { type: "table-cell", children: [{ type: "p", children: [{ text: "Name" }] }] },
              { type: "table-cell", children: [{ type: "p", children: [{ text: "Owner" }] }] },
            ],
          },
          {
            type: "table-row",
            children: [
              { type: "table-cell", children: [{ type: "p", children: [{ text: "Task A" }] }] },
              {
                type: "table-cell",
                children: [
                  { type: "p", children: [{ type: "mention", value: { name: "Bob" }, children: [{ text: "" }] }] },
                  { type: "img", url: "https://example.com/t.png", children: [{ text: "" }] },
                ],
              },
            ],
          },
        ],
      },
      { type: "highlight-block", children: [{ type: "p", children: [{ text: "Important note" }] }] },
      { type: "foldable-block", name: "Details", children: [{ type: "p", children: [{ text: "Hidden content" }] }] },
      {
        type: "text-draw",
        lang: "plantuml",
        children: [{ children: [{ text: "@startuml" }] }, { children: [{ text: "Alice -> Bob" }] }, { children: [{ text: "@enduml" }] }],
      },
      { type: "img", url: "https://example.com/diagram.png", children: [{ text: "" }] },
      { type: "divider", children: [{ text: "" }] },
      { type: "p", children: [{ type: "icon-link", title: "需求链接", url: "https://example.com/spec", children: [{ text: "" }] }] },
      { type: "diagram", diagramId: "diag-123", children: [{ text: "" }] },
    ],
  });

  // heading & title dedup
  assert.match(result.markdown, /^# Sample Doc/m);
  assert.ok(!result.markdown.includes("# Sample Doc\n\nSample Doc"));
  assert.match(result.markdown, /^## Overview$/m);
  // inline styles & mentions
  assert.match(result.markdown, /Hello \*\*world\*\* ~~old~~ <u>new<\/u> @Alice @Carol/);
  // ordered list & nesting
  assert.match(result.markdown, /^1\. First item$/m);
  assert.match(result.markdown, /^  1\. Nested item$/m);
  // checkbox
  assert.match(result.markdown, /^- \[ \] Todo item$/m);
  // table
  assert.match(result.markdown, /\| Name \| Owner \|/);
  // highlight-block & foldable-block
  assert.match(result.markdown, /^> Important note$/m);
  assert.match(result.markdown, /<details><summary>Details<\/summary>/);
  // text-draw & image & icon-link
  assert.match(result.markdown, /```plantuml/);
  assert.match(result.markdown, /!\[image\]\(https:\/\/example\.com\/diagram\.png\)/);
  assert.match(result.markdown, /\[需求链接\]\(https:\/\/example\.com\/spec\)/);
  // diagram placeholder
  assert.match(result.markdown, /> JoySpace diagram not exported \(diagramId: diag-123\)/);
  assert.deepEqual(result.warnings, ["diagram"]);
});

test("preserves inline highlight via bgColor / highlight flag", () => {
  const result = joyspaceContentToMarkdown({
    title: "HL",
    content: [
      { type: "p", children: [{ text: "pre " }, { bgColor: "#FDF7AF", text: "黄色高亮" }, { text: " post" }] },
      { type: "p", children: [{ highlight: true, bold: true, text: "bold highlight" }] },
      { type: "p", children: [{ backgroundColor: "transparent", text: "no mark" }] },
    ],
  });

  assert.match(result.markdown, /pre <mark>黄色高亮<\/mark> post/);
  assert.match(result.markdown, /<mark>\*\*bold highlight\*\*<\/mark>/);
  assert.ok(!/<mark>no mark<\/mark>/.test(result.markdown));
});

test("renders diagram with SVG > mermaid > link fallback", () => {
  const pageUrl = "https://joyspace.jd.com/pages/demo";

  // SVG takes priority
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const svgResult = joyspaceContentToMarkdown({
    title: "D",
    content: [{ type: "diagram", diagramId: "d1", children: [{ text: "" }] }],
    diagrams: new Map([["d1", { title: "T", svg, mermaid: "flowchart TD\n  n1-->n2" }]]),
    pageUrl,
  });
  assert.ok(svgResult.markdown.includes(svg));
  assert.ok(svgResult.warnings.includes("diagram-svg"));

  // Mermaid fallback when no SVG
  const mermaidResult = joyspaceContentToMarkdown({
    title: "D",
    content: [{ type: "diagram", diagramId: "d2", children: [{ text: "" }] }],
    diagrams: new Map([["d2", { title: "流程", mermaid: "flowchart TD\n  n1[\"A\"]\n  n2[\"B\"]\n  n1 --> n2", linkUrl: "https://cdn.example.com/d2.xml?sig=abc" }]]),
    pageUrl,
  });
  assert.match(mermaidResult.markdown, /```mermaid\nflowchart TD/);
  assert.match(mermaidResult.markdown, /n1 --> n2\n```/);
  assert.ok(mermaidResult.warnings.includes("diagram-mermaid"));

  // Link fallback when no SVG & no mermaid
  const linkResult = joyspaceContentToMarkdown({
    title: "D",
    content: [{ type: "diagram", diagramId: "d3", children: [{ text: "" }] }],
    diagrams: new Map([["d3", { title: "流程图 A", svg: "", mermaid: "" }]]),
    pageUrl,
  });
  assert.match(linkResult.markdown, /> \*\*JoySpace 绘图：流程图 A\*\*/);
  assert.ok(linkResult.warnings.includes("diagram-link"));
});

test("keeps ordered list numbering across table cell", () => {
  const result = joyspaceContentToMarkdown({
    title: "TL",
    content: [
      {
        type: "table",
        children: [
          {
            type: "table-row",
            children: [
              { type: "table-cell", children: [{ type: "p", children: [{ text: "列A" }] }] },
              {
                type: "table-cell",
                children: [
                  { type: "list", value: "ordered", children: [{ text: "第一项" }] },
                  { type: "p", children: [{ text: "插入段落" }] },
                  { type: "list", value: "ordered", children: [{ text: "第二项" }] },
                  { type: "list", value: "ordered", indent: 1, children: [{ text: "嵌套" }] },
                  { type: "list", value: "ordered", children: [{ text: "第三项" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const tableLine = result.markdown.split("\n").find((l) => l.startsWith("| 列A |"));
  assert.ok(tableLine, "expected rendered table row");
  assert.match(tableLine, /1\. 第一项/);
  assert.match(tableLine, /2\. 第二项/);
  assert.match(tableLine, /3\. 第三项/);
});