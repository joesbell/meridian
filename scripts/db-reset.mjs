// 线下手动清空数据库：删除全部表数据（事务执行，本地服务器运行中也安全，WAL 模式不冲突）。
// 清空后重启 npm run server 即可触发启动抓取重新填充。
// 用法：npm run db:reset
import { purgeAllData } from "../server/db.mjs";

purgeAllData();
console.log("✅ 本地数据库已清空（news_items / repo_items / article_details / readme_details / batches）");
console.log("   重启本地服务（npm run server）后会立即重新抓取一轮数据");
