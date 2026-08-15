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

# 移动热点/国际线路抖动：keepalive 防止 NAT 空闲断连，断线快速失败交给外层重试
SSH_OPTS="-o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ConnectTimeout=15"

# SSH 直连被线路干扰时走本地代理：DEPLOY_PROXY=127.0.0.1:7897 npm run deploy
if [ -n "${DEPLOY_PROXY:-}" ]; then
  PROXY_CONF=$(mktemp)
  printf 'Host *\n  ProxyCommand nc -X connect -x %s %%h %%p\n' "$DEPLOY_PROXY" > "$PROXY_CONF"
  SSH_OPTS="-F $PROXY_CONF $SSH_OPTS"
fi
export RSYNC_RSH="ssh $SSH_OPTS"

echo "→ 导出 $DEPLOY_BRANCH 分支代码…"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
git archive "$DEPLOY_BRANCH" | tar -x -C "$TMP_DIR"

echo "→ 同步代码到服务器…"
rsync -az --delete --partial --timeout=60 \
  --exclude node_modules --exclude .venv --exclude data --exclude dist \
  --exclude .git --exclude work --exclude .playwright-mcp \
  --exclude __pycache__ --exclude ".codegraph" --exclude .env \
  "$TMP_DIR/" "$SERVER:$REMOTE_DIR/"

# 远程构建放到 nohup 里跑：ssh 途中断连不会杀掉构建，断线后重跑本脚本即可续上
echo "→ 服务器上重新构建镜像并重启容器（约 5-15 分钟）…"
ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR && rm -f /tmp/meridian-deploy-done \
  && nohup bash -c 'docker build -t meridian-live . \
    && (docker rm -f meridian-live >/dev/null 2>&1 || true) \
    && docker run -d --name meridian-live --restart unless-stopped \
      --env-file .env -v meridian-data:/app/data \
      -p 127.0.0.1:4173:4173 meridian-live >/dev/null \
    && docker image prune -f >/dev/null \
    && touch /tmp/meridian-deploy-done' > /tmp/meridian-deploy.log 2>&1 &"

echo "→ 构建已在服务器后台运行，轮询等待完成…"
for i in $(seq 1 60); do
  if ssh $SSH_OPTS "$SERVER" "test -f /tmp/meridian-deploy-done" 2>/dev/null; then
    ssh $SSH_OPTS "$SERVER" "rm -f /tmp/meridian-deploy-done && docker ps --format '容器状态: {{.Status}}' && tail -3 /tmp/meridian-deploy.log"
    echo "✅ 部署完成 → https://joesbell.top"
    exit 0
  fi
  sleep 15
done
echo "⚠️ 等待超时：构建可能仍在进行或已失败。SSH 上去看 tail -50 /tmp/meridian-deploy.log"
exit 1
