# 给后续 AI 的项目说明

## 目标和来源

用户过去通过 AI 调用 `D:\project\cmzn\tools\resizeImage\resize_image.py` 处理重复缩放任务。这个新项目把常用能力做成窗口按钮，用浏览器交互减少反复描述成本。原工具的「按高度等比缩放」「强制正方形」「最近邻」行为已转成页面功能。旧工具还支持 Excel 映射和调色板输出，本版未迁移。

用户要求原有 output 保留，显式目标文件夹优先；可批量拖入图片/目录；可从监听目录中的素材窗口选择所需图片。最新要求：默认改为新项目的 `./input` 和 `./output`，采用相对路径，并保留页面自定义目录的功能。

## 文件和职责

| 文件 | 职责 |
| --- | --- |
| public/index.html | 默认英文的双语页面结构、参数区、素材区、预览弹窗、处理记录 |
| public/styles.css | 蓝色主操作 + 中性灰白工作台样式；主题颜色集中在 :root，无外部字体/CDN |
| public/theme.js | 浅色/暗黑切换与 localStorage 记忆，在样式前恢复主题 |
| public/i18n.js | 英文/中文文案、静态标签、错误显示及独立语言记忆，在 theme.js 前加载 |
| public/favicon.svg | 浏览器标签及页面左上角共用的 SVG 站点图标 |
| public/app.js | 模式按钮、拖入、递归读取目录、缩略图、选择/搜索、配置、监听、预览和逐张导出 |
| public/library.mjs | 素材列表同步、运行期间新增自动选择、时间与名称排序 |
| public/resize.mjs | MODES 模式注册；geometry 纯尺寸/绘制布局；outputName 命名；renderImage Canvas 渲染与编码 |
| public/png-optimizer.mjs / png-worker.mjs | PNG 无损优化会话、Worker 复用、超时/取消/失败回退 |
| public/vendor/oxipng/ | 本地 @jsquash/oxipng 2.3.0 单线程 JS/WASM 及 Apache/MIT 许可证 |
| server.mjs | 本机静态服务、带令牌的目录 API、原生目录选择窗口、路径与输出保护 |
| start.ps1 / start.cmd | 检查 Node 和端口，在后台启动服务并打开浏览器 |
| stop.ps1 / 停止工具.cmd | 校验 PID 与命令行后停止本项目服务 |
| tests/core.test.mjs | 纯逻辑与临时目录/HTTP 集成验证 |
| tests/localization.test.mjs | 双语完整性、语言记忆、主题标签、DOM 桩中运行真实前端脚本验证参数/选择/记录 |
| tests/png-optimizer.test.mjs | 真实 WASM / RGBA 往返验证、回退、Worker 复用、超时和取消 |
| settings.json | 运行时生成，输入/输出目录和监听设置；不提交，不覆盖用户配置 |
| .runtime/ | 启动日志和 PID；不提交 |

## 增加一个缩放模式

1. 在 `MODES` 中添加 id 和图标；在 i18n.js 注册 mode.id.title / description / help 的英文和中文。页面通过 t() 显示，不直接读取模式中的中文元数据。
2. 在 `geometry()` 增加纯计算逻辑，返回输出画布大小、绘制大小和偏移；如果是图像算法，扩展 `renderImage()`，不要把计算塞进点击事件。
3. 如需新参数，在 index.html 增加有 label 的控件，在 app.js 的 options()/setMode()/preferenceIds 中接通。纯模式切换通常不需要改服务端。
4. 为有效场景与关键边界增加少量有意义的测试。验证实际编码图片的尺寸和透明度，前后预览应与导出一致。
5. 更新英文 README.md 和中文 README.zh-CN.md 的功能表、参数和限制。

批量导出统一经过 exportSelected → loadSource → renderImage → optimizeOutput → outputName → /api/export。新按钮应复用这条链路。每张错误单独记录，继续后续文件；停止按钮取消正在优化且尚未写入的文件和剩余任务，保留已写入文件。

## 输入与监听

- 目录素材使用 `local:根目录:相对路径:大小:mtime` 标识，首次加载/切换目录的已有素材默认不选中；同目录后续扫描中新出现的文件自动选中。改变的同路径图片保留原选择状态和加入时间，手动取消选择不会在刷新后被撤销。
- `libraryRoot` 标记上次成功同步的目录；`reconcileLibrary` 处理列表同步和选择，`compareAssets` 处理展示顺序。运行期间新增/手动导入使用同批 `addedAt`，优先显示，按加入时间倒序；已有素材按 mtime 倒序；同一时间按名称升序，重名按相对路径排序。拷贝老文件也会排在前面。
- 拖入素材使用 `drop:相对路径:大小:mtime` 去重，保存浏览器 File，默认选中。
- 文件夹拖入用 webkitGetAsEntry；必须在 drop 事件同步捕获句柄，目录 reader.readEntries 要循环到空，避免只读前 100 个文件。
- 缩略图 3 个并发，生成小画布后释放原图 URL，导出逐张加载，避免长期持有全尺寸解码图片。
- 监听是页面每 3 秒 /api/library 轮询，不是后台自动转换。浏览器后台可能节流，导出期间冻结参数并暂停刷新。

## 输出约定

默认输入 `./input`、默认输出 `./output`，配置和页面保留相对路径；服务端在实际读写、目录选择和打开目录时统一以项目目录解析，不依赖 process.cwd()。用户仍可在页面指定相对或绝对路径，指定目标目录优先；空输出配置恢复 `./output`。目录不清空，旧工具的 input/output 保留。

safeRelative 限制越界和 Windows 非法文件名；noLinks 避免子目录链接。saveImage 使用 wx 原子写入做自动重命名/跳过，覆盖需明确策略。输入目录下的目标拒绝写入。浏览器拖入文件无绝对源路径，文档已提醒用户将输出与原图分开。

PNG 与 WebP 保留透明，JPG 补白背景；输出扩展名必须匹配编码类型。文件体积目标尚未实现，不能把指定宽高描述成「压到指定 KB」。Canvas 平滑与 Pillow LANCZOS 结果不是逐像素一致。

## PNG 无损优化

png-optimize 默认 checked，随 preferenceIds 记忆；formatChanged 只在 PNG 显示。optimizeOutput 供预览和导出共用，不改 geometry、Canvas 绘制和 JPG/WebP。createPngOptimizer 每个批次/预览拥有一个可复用 Worker，逐张 optimize；结束 dispose，失败/超时/取消终止 Worker，下次可重建。Blob.arrayBuffer 的私有副本可转移，原始 Blob 保留，失败直接回退。30 秒超时，候选 PNG 验证签名/IHDR/尺寸且必须严格更小。

Worker 从本地 vendor 加载固定的单线程 codec，调用 optimise(bytes, 2, false, false)。不能开启透明像素 RGB 改写或量化。日志只保留 status/originalBytes/optimizedBytes/savedBytes，并通过 optimizationText 根据当前语言展示；不能保存整张 Blob。批次总节省只计实际成功写入的文件。预览关闭和停止按钮接入 AbortController，取消当前尚未写入的图片不计失败。

服务端静态白名单明确包含模块/Worker/vendor JS/WASM，WASM MIME 为 application/wasm。CSP 仅增加 wasm-unsafe-eval 和 worker-src self，不放开通用 unsafe-eval 或远程资源。参考 [MDN WebAssembly CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution)。测试中使用 Node Worker 适配器运行真实 Worker/codec，不等于浏览器排版实测；更换 codec 时必须验证 RGBA 和透明像素 RGB。

## 视觉主题约定

主色 `--primary: #355CE5` 用于主导出按钮、选中、焦点和进度；`--primary-soft` 用于选中模式的浅色背景；中性灰白用于页面、卡片和素材棋盘格。主导出按钮蓝底白字，hover 使用 `--primary-hover`，disabled 使用独立的 `--disabled-bg` / `--disabled-text`，不叠加全局半透明效果。成功/错误使用独立的 `--success` / `--danger`。SVG 图标为蓝底白色线条，保持同一主题。调整颜色时保留布局和业务逻辑，并检查文字对比度及禁用状态。

右上角 `theme-toggle` 在浅色/暗黑之间切换。theme.js 是在 CSS 前加载的独立脚本，先恢复 `resize-studio-theme`，再在 DOMContentLoaded 接上按钮；首次默认浅色。CSS 的 `:root[data-theme="dark"]` 覆盖颜色变量，表面统一使用 `--surface` / `--input-bg` 等变量，不能添加固定白色的背景。暗黑模式的蓝色文字用 `--primary`，蓝底白字主按钮用 `--action-bg`，避免提亮文字蓝色后导致主按钮白字对比度不足。主题切换不重建素材列表、不改变勾选或加工参数，也不改变 Canvas 图片输出。

素材工具栏使用 `.library-action` 图标文字按钮，「全选可见」用 `.library-action-accent` 强调。SVG 使用 currentColor 随主题变化，aria-hidden 避免重复朗读；data-i18n 放在内部 span，切换语言保留图标。保持现有选择与清空导入事件，窄屏允许按钮换行。

## 中英文约定

首次默认英文。页头 language-select 在 EN / 中文之间切换，localStorage 的 resize-studio-language 独立于主题和加工参数；文档默认 README.md 英文，README.zh-CN.md 中文。i18n.js 在 theme.js 和样式之前加载，提供 window.ResizeI18n 的 t / getLanguage / setLanguage / errorText。静态纯文本用 data-i18n，placeholder / aria-label 用 data-i18n-placeholder / data-i18n-aria；有 input、图标等子元素的标签应只翻译内部 span，避免 textContent 清除控件。

动态文案通过 t(key, params)；参数中的路径和文件名保持原样。处理记录存 key、params 和时间，resize-language-change 时重新翻译已有记录，不能只保存翻译后的字符串。核心计算和服务端保留稳定错误消息，errorText 在界面显示时映射双语；新增错误需同时补映射。语言切换只更新显示，保留素材列表、选择、排序、数值、路径和图片输出。批量导出期间禁用语言选择。新增文案补双语并运行 npm test 的本地化验证。

## 可继续扩展的明确方向

这些是候选功能，只有用户要求后才添加：目标 KB/MB 压缩、Excel 按素材映射尺寸、256 色 PNG、裁切锚点、命名模板、常用操作预设、图片边距和透明边缘处理。
