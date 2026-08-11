#!/usr/bin/env bash
# 一键部署（发版）：main 分支代码 → 导出干净副本 → 同步到 VPS → 重建镜像 → 重启容器
# 用法：npm run deploy
# 注意：
#   - 发版内容 = 本地 main 分支最后一次提交的代码（git archive 导出，与当前工作区无关，
#     未提交的改动、当前所在分支都不会被带上去）
#   - .env 不上传（密钥留在服务器上）；数据卷 meridian-data 不受影响，数据库不会丢
set -euo pipefail

SERVER="root@192.255.136.126"
REMOTE_DIR="/root/meridian-live-edition"
DEPLOY_BRANCH="main"

echo "→ 导出 $DEPLOY_BRANCH 分支代码…"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
git archive "$DEPLOY_BRANCH" | tar -x -C "$TMP_DIR"

echo "→ 同步代码到服务器…"
rsync -az --delete \
  --exclude node_modules --exclude .venv --exclude data --exclude dist \
  --exclude .git --exclude work --exclude .playwright-mcp \
  --exclude __pycache__ --exclude ".codegraph" --exclude .env \
  "$TMP_DIR/" "$SERVER:$REMOTE_DIR/"

echo "→ 服务器上重新构建镜像并重启容器（约 5-15 分钟）…"
ssh "$SERVER" "cd $REMOTE_DIR \
  && docker build -t meridian-live . \
  && (docker rm -f meridian-live >/dev/null 2>&1 || true) \
  && docker run -d --name meridian-live --restart unless-stopped \
       --env-file .env -v meridian-data:/app/data \
       -p 127.0.0.1:4173:4173 meridian-live >/dev/null \
  && sleep 8 && docker ps --format '容器状态: {{.Status}}' \
  && docker image prune -f >/dev/null && echo '已清理旧镜像层'"

echo "✅ 部署完成 → https://joesbell.top"
