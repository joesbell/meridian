import test from "node:test";
import assert from "node:assert/strict";
import { isNetworkFailure, publicApiError } from "../server/feedApi.mjs";

test("recognizes browser and DNS offline failures", () => {
  assert.equal(isNetworkFailure(new Error("Page.goto: net::ERR_INTERNET_DISCONNECTED")), true);
  assert.equal(isNetworkFailure(new Error("getaddrinfo ENOTFOUND github.com")), true);
  assert.equal(isNetworkFailure(new Error("README 内容为空")), false);
});

test("maps offline errors to a stable API response", () => {
  const failure = publicApiError(new Error("fetch failed: ENETUNREACH"));
  assert.equal(failure.status, 503);
  assert.equal(failure.body.code, "OFFLINE");
});

test("keeps upstream parsing errors distinct from offline failures", () => {
  const failure = publicApiError(new Error("Scrapling 未返回完整的中文正文"), "正文不可读");
  assert.equal(failure.status, 502);
  assert.equal(failure.body.code, "UPSTREAM_ERROR");
  assert.equal(failure.body.error, "正文不可读");
});
