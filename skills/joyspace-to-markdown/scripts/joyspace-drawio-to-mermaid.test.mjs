import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  cleanMermaidLabel,
  decodeDrawioMxGraphXml,
  drawioXmlToMermaid,
  mxGraphToMermaid,
} from "./joyspace-drawio-to-mermaid.mjs";

const sampleMxGraph = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Start" style="ellipse" vertex="1" parent="1"/>
  <mxCell id="b" value="&lt;b&gt;Decide&lt;/b&gt;" style="rhombus" vertex="1" parent="1"/>
  <mxCell id="c" value="End" style="rounded=1" vertex="1" parent="1"/>
  <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle" edge="1" source="a" target="b" parent="1"/>
  <mxCell id="e2" value="yes" edge="1" source="b" target="c" parent="1"/>
</root></mxGraphModel>`;

function encodeMxGraph(xml) {
  return `<mxfile><diagram>${Buffer.from(zlib.deflateRawSync(encodeURIComponent(xml))).toString("base64")}</diagram></mxfile>`;
}

test("mxGraphToMermaid maps shapes and edges to mermaid flowchart", () => {
  const mermaid = mxGraphToMermaid(sampleMxGraph);
  assert.ok(mermaid.startsWith("flowchart TD"));
  assert.match(mermaid, /n1\(\("Start"\)\)/);
  assert.match(mermaid, /n2\{"Decide"\}/);
  assert.match(mermaid, /n3\("End"\)/);
  assert.match(mermaid, /n1 --> n2/);
  assert.match(mermaid, /n2 -->\|"yes"\| n3/);
});

test("decodeDrawioMxGraphXml + drawioXmlToMermaid round-trip", () => {
  const wrapped = encodeMxGraph(sampleMxGraph);
  const xml = decodeDrawioMxGraphXml(wrapped);
  assert.match(xml, /<mxGraphModel\b/);
  const mermaid = drawioXmlToMermaid(wrapped);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /n1 --> n2/);
  // invalid payload returns empty
  assert.equal(drawioXmlToMermaid("<mxfile></mxfile>"), "");
  assert.equal(drawioXmlToMermaid(""), "");
});

test("cleanMermaidLabel strips html and normalizes entities", () => {
  assert.equal(cleanMermaidLabel("&lt;font color='#f00'&gt;需要&lt;br&gt;换行&lt;/font&gt;"), "需要 换行");
});

test("mxGraphToMermaid handles edgeLabel children and skips decorative empty vertices", () => {
  const withEdgeLabel = `<mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="Start" vertex="1" parent="1"/>
    <mxCell id="b" value="End" vertex="1" parent="1"/>
    <mxCell id="e" edge="1" source="a" target="b" parent="1"/>
    <mxCell id="el" value="go" style="edgeLabel;html=1" vertex="1" connectable="0" parent="e"/>
  </root></mxGraphModel>`;
  const m1 = mxGraphToMermaid(withEdgeLabel);
  assert.match(m1, /n1 -->\|"go"\| n2/);
  assert.ok(!/n3/.test(m1), "edgeLabel must not become its own vertex");

  const withDecorative = `<mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="A" vertex="1" parent="1"/>
    <mxCell id="b" value="B" vertex="1" parent="1"/>
    <mxCell id="bracket" value="" style="shape=curlyBracket;html=1" vertex="1" parent="1"/>
    <mxCell id="e" edge="1" source="a" target="b" parent="1"/>
  </root></mxGraphModel>`;
  const m2 = mxGraphToMermaid(withDecorative);
  assert.match(m2, /n1 --> n2/);
  assert.ok(!/curlyBracket|n3/.test(m2));
});