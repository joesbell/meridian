// 生产静态服务器：托管 dist/client 构建产物，并把 /api/* 请求交给 feedApi 中间件。
// 启动时初始化数据库和定时抓取调度器（每 2 小时全量抓取，00:00 清空重建）。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFeedMiddleware } from "./feedApi.mjs";
import { startScheduler } from "./scheduler.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
// 前端构建产物目录（npm run build 输出到 dist/client）
const publicDir = path.resolve(serverDir, "../dist/client");
// 数据接口中间件（新闻 / GitHub 榜单 / 正文 / 图片代理）
const api = createFeedMiddleware();

// 常见静态资源的 MIME 映射；未列出的扩展名按二进制流返回
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// 静态文件托管：SPA 兜底——任何找不到的文件都回退到 index.html
async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://radius.local").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(publicDir, relative);
  let file = candidate.startsWith(`${publicDir}${path.sep}`) ? candidate : path.join(publicDir, "index.html");
  try {
    const info = await stat(file);
    if (!info.isFile()) file = path.join(publicDir, "index.html");
  } catch {
    file = path.join(publicDir, "index.html");
  }
  const body = await readFile(file);
  response.statusCode = 200;
  response.setHeader("content-type", mime[path.extname(file)] || "application/octet-stream");
  response.end(body);
}

// 请求入口：/api/* 走数据中间件，其余走静态托管
const server = createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    api(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
    return;
  }
  serveStatic(request, response).catch((error) => {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : String(error));
  });
});

// 启动定时调度器（含启动时的初始抓取）
startScheduler();

// 监听端口：默认 4173
const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () => {
  console.log(`[server] Radius Live Edition 已启动 → http://localhost:${port}`);
});
