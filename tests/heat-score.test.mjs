// 头条热度逻辑检查：coverageHeats 在原文标题上识别多源共现，promoteTopStory 只提升最高分条目
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageHeats } from "../server/scraper.mjs";
import { promoteTopStory } from "../server/feedApi.mjs";

test("coverageHeats: 同一故事被不同源报道时识别共现", () => {
  const items = [
    { source: "MarketWatch", title: "CoreWeave stock soars as earnings show strong AI business growth" },
    { source: "CNBC", title: "CoreWeave stock soars after earnings beat on strong AI business growth" },
    { source: "WSJ", title: "Oil prices fall for a third straight session amid supply glut" },
  ];
  const heats = coverageHeats(items);
  assert.ok(heats[0] >= 1, "CoreWeave(MarketWatch) 应识别到 CNBC 的同故事报道");
  assert.ok(heats[1] >= 1, "CoreWeave(CNBC) 应识别到 MarketWatch 的同故事报道");
  assert.equal(heats[2], 0, "无关故事热度应为 0");
});

test("coverageHeats: 同源重复不计入共现", () => {
  const items = [
    { source: "HN", title: "Show HN: A tiny SQLite editor in one file" },
    { source: "HN", title: "Show HN: A tiny SQLite editor in one file" },
  ];
  assert.deepEqual(coverageHeats(items), [0, 0]);
});

test("promoteTopStory: 有共现热度的条目提升为头条", () => {
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const items = [
    { id: "a", title: "最新但无共现", publishedAt: fresh, heat: 0 },
    { id: "b", title: "普通条目", publishedAt: fresh, heat: 0 },
    { id: "c", title: "稍旧但两家报道", publishedAt: old, heat: 2 },
  ];
  const result = promoteTopStory(items);
  assert.equal(result[0].id, "c", "热度 2 的条目应提升为头条");
  assert.equal(result.length, 3);
});

test("promoteTopStory: 无共现信号时维持原顺序", () => {
  const fresh = new Date().toISOString();
  const items = [
    { id: "a", publishedAt: fresh, heat: 0 },
    { id: "b", publishedAt: fresh, heat: 0 },
    { id: "c", publishedAt: fresh, heat: 0 },
  ];
  assert.equal(promoteTopStory(items)[0].id, "a");
});
