#!/usr/bin/env bash
# 一键部署：本地改动 → 同步到 VPS → 重新构建镜像 → 重启容器
# 用法：bash scripts/deploy.sh
# 注意：.env 不上传（密钥留在服务器上）；数据卷 radius-data 不受影响，缓存/翻译库不会丢
set -euo pipefail

SERVER="root@192.255.136.126"
REMOTE_DIR="/root/radius-live-edition"

echo "→ 同步代码到服务器…"
rsync -az --delete \
  --exclude node_modules --exclude .venv --exclude data --exclude dist \
  --exclude .git --exclude work --exclude .playwright-mcp \
  --exclude __pycache__ --exclude ".codegraph" --exclude .env \
  ./ "$SERVER:$REMOTE_DIR/"

echo "→ 服务器上重新构建镜像并重启容器（约 5-15 分钟）…"
ssh "$SERVER" "cd $REMOTE_DIR \
  && docker build -t radius-live . \
  && (docker rm -f radius-live >/dev/null 2>&1 || true) \
  && docker run -d --name radius-live --restart unless-stopped \
       --env-file .env -v radius-data:/app/data \
       -p 127.0.0.1:4173:4173 radius-live >/dev/null \
  && sleep 8 && docker ps --format '容器状态: {{.Status}}'"

echo "✅ 部署完成 → https://joesbell.top"
