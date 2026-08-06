// 新闻滚动分页与入库去重的数据库层测试。
// 使用独立的测试分类（TEST_CATEGORY），用例结束清理，不影响真实数据。
import test from "node:test";
import assert from "node:assert/strict";
import {
  createBatch,
  completeBatch,
  insertNewsItems,
  getNewsPageByCategory,
  getArticleDetails,
  saveArticleDetail,
  closeDb,
} from "../server/db.mjs";

const TEST_CATEGORY = "__测试分类__";

function makeItems(batchId, count, tag) {
  return Array.from({ length: count }, (_, i) => ({
    id: `test-${tag}-${i}`,
    category: TEST_CATEGORY,
    title: `标题 ${tag}-${i}`,
    summary: "摘要",
    source: "测试源",
    url: `https://example.com/${tag}/${i}`,
    publishedAt: new Date(1700000000000 + i * 60000).toISOString(),
  }));
}

test.after(() => {
  closeDb();
});

test("分页按存入时间倒序、不重复、能翻到底", () => {
  const batchId = createBatch("12:00", 12, "scheduled");
  insertNewsItems(batchId, makeItems(batchId, 12, "a"));
  completeBatch(batchId);

  // 第一页 5 条
  const page1 = getNewsPageByCategory(TEST_CATEGORY, null, 5);
  assert.equal(page1.items.length, 5);
  assert.ok(page1.nextCursor);

  // 第二页 5 条
  const page2 = getNewsPageByCategory(TEST_CATEGORY, page1.nextCursor, 5);
  assert.equal(page2.items.length, 5);

  // 第三页只剩 2 条 → 不足 5 条即到底
  const page3 = getNewsPageByCategory(TEST_CATEGORY, page2.nextCursor, 5);
  assert.equal(page3.items.length, 2);

  // 到底之后再翻为空
  const page4 = getNewsPageByCategory(TEST_CATEGORY, page3.nextCursor, 5);
  assert.equal(page4.items.length, 0);

  // 全量无重复
  const ids = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id);
  assert.equal(new Set(ids).size, 12);
});

test("重复入库保留首次 created_at（旧闻不置顶）", () => {
  const first = getNewsPageByCategory(TEST_CATEGORY, null, 12);
  const before = new Map(first.items.map((item) => [item.id, item.createdAt]));

  // 同一批 id 再次入库（模拟隔天重复抓到）
  const batchId = createBatch("18:00", 18, "scheduled");
  insertNewsItems(batchId, makeItems(batchId, 12, "a"));
  completeBatch(batchId);

  const second = getNewsPageByCategory(TEST_CATEGORY, null, 12);
  for (const item of second.items) {
    assert.equal(item.createdAt, before.get(item.id), `${item.id} 的 created_at 不应被更新`);
  }
});

test("批量详情查询返回 url → detail 映射", () => {
  saveArticleDetail({ url: "https://example.com/a/0", title: "中文标题", paragraphs: ["要点一", "要点二"] });
  const details = getArticleDetails(["https://example.com/a/0", "https://example.com/missing"]);
  assert.equal(details["https://example.com/a/0"].title, "中文标题");
  assert.deepEqual(details["https://example.com/a/0"].paragraphs, ["要点一", "要点二"]);
  assert.equal(details["https://example.com/missing"], undefined);
});
