import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownBlocks } from "../server/scraper.mjs";

// 复现 kaneo README 的乱码场景：HTML 块、shields badge、单行 <h1>
const SAMPLE = `<p align="center">
  <a href="https://kaneo.app"><img src="logo.svg" /></a>
</p>

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![CI](https://img.shields.io/badge/ci-passing-green.svg)](https://github.com/x/y/actions)

<h1 align="center">Kaneo</h1>

Everything you need, nothing you don't. Open source project management.

## Features

- [Documentation](https://example.com) with **bold** words
- Plain item

\`\`\`bash
npm install kaneo
\`\`\`
`;

test("strips HTML blocks, badges and inline markup from README markdown", () => {
  const blocks = parseMarkdownBlocks(SAMPLE);
  const all = blocks.map((b) => b.text).join("\n");

  // 乱码来源全部不得残留
  assert.ok(!all.includes("<"), `标记残留: ${all}`);
  assert.ok(!all.includes(" shields.io ") && !all.includes("[!"), `badge 残留: ${all}`);

  // 有效内容保留
  assert.ok(all.includes("Kaneo"), "单行 <h1> 的文字应提取出来");
  assert.ok(all.includes("Everything you need"), "正文段落应保留");
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Features"), "markdown 标题应保留");
  assert.ok(blocks.some((b) => b.type === "list" && b.text === "Documentation with bold words"), "列表项应剥掉链接和粗体");
  assert.ok(blocks.some((b) => b.type === "code" && b.text.includes("npm install kaneo")), "代码块应保留原文");

  // badge 行剥完为空，不应产生空段落
  assert.ok(!blocks.some((b) => b.type === "paragraph" && b.text.trim() === ""), "不应有空段落");
});

test("plain markdown without HTML is unaffected", () => {
  const blocks = parseMarkdownBlocks("# Title\n\nA simple paragraph.\n\n- one\n- two\n");
  assert.equal(blocks[0].text, "Title");
  assert.equal(blocks[1].text, "A simple paragraph.");
  assert.equal(blocks.filter((b) => b.type === "list").length, 2);
});
