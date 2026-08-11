#!/usr/bin/env bash
# 线上手动清空数据库：SSH 到 VPS → 容器内执行 purgeAllData → 重启容器。
# 重启后 scheduler 启动即自动重新抓取一轮，期间页面短暂无数据（约几分钟）。
# 用法：npm run db:reset:server
set -euo pipefail

SERVER="root@192.255.136.126"

echo "→ 清空线上数据库（容器内执行 purgeAllData）…"
ssh "$SERVER" "docker exec meridian-live node --input-type=module -e \"
  import('/app/server/db.mjs').then((m) => { m.purgeAllData(); console.log('容器内数据库已清空'); });
\""

echo "→ 重启容器，触发启动抓取重新填充数据…"
ssh "$SERVER" "docker restart meridian-live >/dev/null && sleep 5 && docker ps --format '容器状态: {{.Status}}'"

echo "✅ 线上数据库已清空并重新开始抓取 → https://joesbell.top"
