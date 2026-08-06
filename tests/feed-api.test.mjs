import test from "node:test";
import assert from "node:assert/strict";
import { isNetworkFailure, isPrivateAddress, publicApiError, safeRemoteUrl } from "../server/feedApi.mjs";

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

test("flags private and reserved IP ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.3.4",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("rejects local and private URLs before any fetch", async () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "http://localhost:6379/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
  ]) {
    await assert.rejects(safeRemoteUrl(url), (error) => error.code === "SSRF_BLOCKED", url);
  }
});

test("maps SSRF rejections to a stable 403 response", async () => {
  const failure = publicApiError(await safeRemoteUrl("http://127.0.0.1/").catch((error) => error));
  assert.equal(failure.status, 403);
  assert.equal(failure.body.code, "FORBIDDEN");
});

test("maps unknown news category to a stable 400 response", () => {
  const error = new Error("未知的新闻分类");
  error.code = "BAD_CATEGORY";
  const failure = publicApiError(error);
  assert.equal(failure.status, 400);
  assert.equal(failure.body.code, "BAD_CATEGORY");
});
