import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFeedMiddleware } from "./feedApi.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(serverDir, "../dist/client");
const api = createFeedMiddleware();
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

server.listen(Number(process.env.PORT || 4173), "0.0.0.0");
