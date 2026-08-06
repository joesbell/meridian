// 开发模式独立后端服务器：只启动 API 中间件 + 定时调度器，不托管静态文件。
// 前端由 Vite 独立运行（npm run dev），通过 proxy 将 /api/* 转发到本服务。
//
// 用法：npm run server
import { createServer } from "node:http";
import { createFeedMiddleware } from "./feedApi.mjs";
import { startScheduler } from "./scheduler.mjs";

const api = createFeedMiddleware();

const server = createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    api(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
    return;
  }
  response.statusCode = 404;
  response.end("Not found — 前端请通过 Vite dev server (5173) 访问");
});

startScheduler();

const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () => {
  console.log(`[server] 后端 API 已启动 → http://localhost:${port}`);
  console.log(`[server] 前端请运行 npm run dev (Vite 5173)，API 请求将自动代理到本服务`);
});
