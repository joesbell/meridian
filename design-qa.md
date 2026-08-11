# TechTide 二级页 — Design QA

## Source visual truth

- 新闻详情原始截图：`/var/folders/lb/xyxn_07j6t5c_1bn16w77nkm0000gn/T/codex-clipboard-836db407-a651-4582-a6e7-d01785dded1f.png`
- GitHub 详情原始截图：`/var/folders/lb/xyxn_07j6t5c_1bn16w77nkm0000gn/T/codex-clipboard-3dde4689-f1a5-4e9f-9c0d-efe95520a4db.png`
- 首页背景基准截图：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/home-background-source.png`
- 用户约束：缩小正文标题、增大类别标签；正文使用 Spotlight Card 与边缘颜色光晕；返回按钮复用首页抓取按钮的 Specular Button 视觉。二级页外围必须复用首页深色动态网格和鼠标凸起效果，但网格不再中央亮、两侧暗，而是全屏保持首页中央区域的亮度。

## Implementation evidence

- 页面：`http://localhost:5173/repo/daily-pascalorg-editor`
- 首屏截图：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-uniform-grid-implementation.png`
- 同尺寸 QA 截图：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-uniform-grid-qa-1280x720.png`
- 首页与二级页并排对比：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-background-comparison.png`
- 首页源图为 1280 × 720 px；二级页实现为 1265 × 712 px，并排比较时等比例归一到 1280 × 720。
- 状态：GitHub 详情及中文 README 已加载，指针停在左侧背景网格，鼠标凸起形变可见，无加载遮罩或错误弹层。

## Comparison findings

- P1 已解决：撤销上一轮错误的浅灰绿色整页背景；二级页外围重新使用首页同款 `#06090a` 深色底、42px 动态网格、信号微粒、光圈及鼠标凸起位移。
- P1 已解决：二级页网格线基础透明度固定为首页中央区域的 `0.21`，不再按横向距离衰减；左、中、右三处视觉亮度一致。
- P2 已解决：二级页背景移除首页的横向暗角和中央径向明暗遮罩，仅保留均匀的深色底色，不改变卡片本身。
- P1 已解决：H1 从原先接近海报式的超大字号收敛到 `clamp(29px, 3.15vw, 40px)`，中文标题在桌面宽度下形成稳定的三行结构。
- P2 已解决：类别标签提升到 14px、加深绿色并保留字距，与标题形成明确但不过度悬殊的两级信息层级。
- P1 已解决：正文承载层改为浅色 Spotlight Card；聚光位置由卡片内指针坐标驱动，离开时回到低强度静态状态。
- P2 已解决：Spotlight Card 外增加独立 Border Glow 壳层，青绿渐变边缘与柔和投影在浅色背景上仍清晰可见。
- P2 已解决：按钮文案已从“返回控制台”改为“返回”，并复用首页刷新按钮的 OGL Specular Button 参数与图标结构。
- P2 已解决：正文、README、代码块、指标和来源链接均重新映射为适合浅底阅读的深色文字与青绿强调色。
- P2 已解决：“核验原始来源”由文章末尾移动到卡片顶部，与类别标签左右对齐；页面仅保留一个来源入口，链接地址保持真实原始 URL。
- P3：新闻源提供的主图本身分辨率有限，页面保持等比例显示，没有额外锐化或虚构替代图片。

## Interaction verification

- 点击“返回”后地址正确切换为 `http://localhost:5173/`。
- 再次进入新闻详情后，标题、正文与图片均正常恢复。
- Spotlight 与 Border Glow 的 CSS 变量由同一指针事件同步更新；两个效果在结构上分层，不竞争伪元素。
- 背景运行状态为 `ambient ambient--uniform`；Canvas 保持 `gridMode="convex"` 和 `gridRadius="150"`。
- 指针移动到左侧网格后，左侧线条产生与首页一致的局部凸起和光圈，远端网格仍保持相同基础亮度。
- “核验原始来源”在 DOM 中仅有一个，当前仓库页链接为 `https://github.com/pascalorg/editor`。
- 浏览器运行日志无应用错误；仅存在既有 Spline 依赖的非阻塞更新警告，与二级页无关。

## Comparison history

### Iteration 1 — 二级页阅读层级

- 解决了标题过大、类别过小、返回按钮样式不一致、卡片缺少 Spotlight 与 Border Glow 的问题。
- 首次修改误把整个二级页外围改成浅灰绿色，虽然阅读变亮，但丢失了首页的空间感和动态网格语言。

### Iteration 2 — 背景语义纠正

- 恢复首页深色动态背景、指针光圈与凸起网格。
- 为二级路由增加独立的 `uniformGrid` 状态：继续复用同一个 Canvas 动画实现，仅关闭中央到两侧的亮度衰减。
- 保持信息卡浅色、Spotlight 和 Border Glow 参数完全不变。
- 并排证据显示首页与二级页使用同一网格密度、色相和互动语言；二级页各边缘网格亮度保持一致。

### Iteration 3 — 来源入口上移

- 将文章末尾的来源链接移动到卡片顶部右侧，与类别标签构成稳定的顶部工具行。
- 保留真实外链、图标、颜色与新窗口打开行为，没有重复入口。

### Iteration 4 — 百分比宽度与卡片内滚动

- 最新源图：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-responsive-source.png`。
- 最新实现：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-responsive-implementation.png`。
- 同屏并排对比：`/Users/jiangs/Documents/Codex/2026-07-24/ai-product-design-plugin-product-design-2/outputs/meridian-live-edition/design/detail-responsive-comparison.png`。
- CSS 视口：1863 × 1354；调整前截图为 1848 × 1343 px（页面原生滚动条占用截图区域），调整后截图为 1863 × 1354 px。并排图将两侧等比例放入 1863 × 1354 的同尺寸面板，设备像素比不变。
- P1 已解决：正文壳层由固定 900px 改为视口宽度的 92%，宽屏中的无效留白显著减少，同时保留 4% 的左右背景呼吸区。
- P1 已解决：详情页固定为一屏高，正文卡片占用工具栏下方剩余空间；页面文档高度从 2767px 收敛为 1354px。
- P1 已解决：超出内容现在只在 `.detail-card` 内滚动。实测 `clientHeight=1233px`、`scrollHeight=2006px`、`overflow-y=auto`。
- P2 已解决：鼠标在卡片内滚动 760px 后，`detail-card.scrollTop=760`，同时 `window.scrollY=0`，证明背景和返回按钮不会跟随正文漂移。
- P2 已解决：增加窄青绿色滚动条，颜色与现有 Spotlight、Border Glow 主色一致，没有引入新的蓝色系统态。
- 全视图对比显示，原有浅色信息卡、标题层级、图片比例、返回按钮、统一亮网格背景和顶部原始来源入口均保持不变。
- 本轮无需额外局部裁切：宽度、固定高度和滚动条在完整桌面视图中均清晰可判定。

## Build verification

- `npm run build`：通过。
- `npm run test:feed`：3/3 通过。
- `npm run test:sites`：4/4 通过。

final result: passed
