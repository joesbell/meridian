// 回归测试：2026-08-17 线上批次 #21 挂死 32 小时事故。
// 事故链：Chrome 孙进程 setsid 脱离进程组并继承 stdout 管道 → python 被组杀后
// close 事件永不触发 → 旧代码只杀进程但不 settle → 串行队列永久卡死。
// 本测试用假 python 复现该场景，断言 runScrapling 在超时后强制 reject 而不是挂死。
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const fakePython = path.join(os.tmpdir(), "fake-scrapling-python.py");
writeFileSync(
  fakePython,
  [
    "#!/usr/bin/env python3",
    "import os, sys, time",
    "if os.fork() == 0:",
    "    os.setsid()  # 孙进程脱离进程组，但继承 stdout 管道",
    "    time.sleep(5)  # 比 settle(约3.5s)活得久即可，避免拖慢测试退出",
    "    sys.exit(0)",
    "time.sleep(30)  # 父进程装死，等超时强杀",
  ].join("\n"),
);
chmodSync(fakePython, 0o755);

process.env.SCRAPLING_PYTHON = fakePython;
process.env.SCRAPLING_TIMEOUT_MS = "1500";

const { runScrapling } = await import("../server/scraper.mjs");

test("孙进程持有管道时超时强杀也会 settle，队列不卡死", async () => {
  const started = Date.now();
  await assert.rejects(runScrapling("article", { url: "https://example.com" }), /超时/);
  const elapsed = Date.now() - started;
  // 1.5s 超时 + 2s 宽限 = 约 3.5s 必须 reject；旧逻辑会挂到 30s（sleep 结束）
  assert.ok(elapsed < 10_000, `任务应在 10s 内强制结束，实际 ${elapsed}ms`);

  // 队列必须未被毒化：再跑一次同一假 python，应再次在超时后 reject 而不是永远排队
  await assert.rejects(runScrapling("article", { url: "https://example.com/2" }), /超时/);
});
