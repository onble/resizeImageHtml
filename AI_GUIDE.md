# 给后续 AI 的项目说明

独立像素化工具位于 [pixelImage](pixelImage/AI_GUIDE.md)，可整体移动运行，使用端口 4180 和自身配置。其最近邻像素化只在子项目实现，不得更改本项目固定 LANCZOS 的处理方式；维护子工具时先读其本地 AGENTS.md。

## 目标和来源

用户过去通过 AI 调用 Python 脚本处理重复缩放任务。这个项目把常用能力做成窗口按钮，用浏览器交互减少反复描述成本。用户已明确要求前端仅交互、全部图片处理使用本地 Python 后端。原始缩放脚本以 python/resize_image.py 内置，必须逐字节保留，通过 python/resize-source.json 记录并验证 SHA-256；项目可整体移动，不依赖外部项目目录。界面、代码和文档中的图片处理来源使用「原始缩放脚本」等中性名称，不记录外部来源项目名或路径。默认 PNG 的按高度和正方形拉伸直接调用原 resize_png，不再只抽取两句 resize。其它宽度/百分比/限定范围/留白/裁切/非正方形拉伸由 Python 适配，不得描述为原 CLI 全部支持。保留五种尺寸模式、PNG 优化，并提供对应原 --palette 的有损调色板开关；已按用户要求彻底移除工作台的「像素风/最近邻」，全部处理固定 LANCZOS。原脚本副本中的 --nearest 定义逐字节保留，但工作台调用时不得启用。Excel 映射仍未迁移。

用户要求原有 output 保留，显式目标文件夹优先；可批量拖入图片/目录；可从监听目录中的素材窗口选择所需图片。最新要求：默认改为新项目的 `./input` 和 `./output`，采用相对路径，并保留页面自定义目录的功能。

运行环境为 Node.js 20+ 内置模块与 Python 3.10+/Pillow，没有 npm 安装依赖或构建步骤。显式 RESIZE_IMAGE_PYTHON 优先；否则依次查找项目 .venv、py -3/python3/python，Codex 自带运行时仅作最后回退。`node image-processor.mjs --check` 输出运行时、protocol:2 与 buildId。`start.ps1` 在启动或复用服务前执行预检，不自动安装依赖。处理代码内置于本项目，不能修改其它现有工具，也不能清空任何输入或已有输出。

Windows 子进程兼容处理和真实图片自检统一放在 `image-processor.mjs`：探测 Python 前，先短暂启动当前 `process.execPath` 初始化 libuv 的 JobObject，避免 Windows Store 程序别名作为首个子进程触发旧版 libuv 的 `AssignProcessToJobObject: (87)` 问题，参见 [libuv #4152](https://github.com/libuv/libuv/pull/4152)。本机现场为 Node 20.20.2 / libuv 1.46.0，日志出现该错误且 4178 已无监听；不能把一次现场证据写成所有环境均已复现。兼容处理不要求升级系统 Node，不安装依赖，也不能修改原始像素算法。

`--check` 除验证解释器/Pillow/来源哈希，还必须通过真实 Python 处理内置小 PNG。服务进程在开始监听前也执行自检，不能仅凭静态页面或解释器版本可读就报告后台就绪。自检只用受控临时目录，不写用户 input/output。排查缩略图全部 fetch 失败且刷新无法访问时，先看 `.runtime/server.error.log` 和端口监听，再验证正常启动、图片处理及刷新；不要仅修改前端提示掩盖后端退出。

2026-10-09 对用户 cardIcon 原图和原脚本生成的 cardIcon.png 验证：高度 150、LANCZOS、RGBA PNG 时，工作台实际服务结果与原始输出逐字节一致。不能把用户视觉反馈直接写成已证实的算法错误；排查必须包含原图、实际尺寸/采样/调色板设置、服务版本和显示比例。

## 文件和职责

| 文件 | 职责 |
| --- | --- |
| public/index.html | 默认英文的双语页面结构、参数区、素材区、预览弹窗、处理记录 |
| public/styles.css | 蓝色主操作 + 中性灰白工作台样式；主题颜色集中在 :root，无外部字体/CDN |
| public/theme.js | 浅色/暗黑切换与 localStorage 记忆，在样式前恢复主题 |
| public/i18n.js | 英文/中文文案、静态标签、错误显示及独立语言记忆，在 theme.js 前加载 |
| public/favicon.svg | 浏览器标签及页面左上角共用的 SVG 站点图标 |
| public/app.js | 模式按钮、拖入、递归读取目录、后端缩略图、选择/搜索、配置、监听、后端预览和逐张导出 |
| public/library.mjs | 素材列表同步、运行期间新增自动选择、时间与名称排序 |
| public/resize.mjs | 仅保留界面 MODES 注册，不含 geometry 或 outputName |
| image-processor.mjs | Python 解释器发现、依赖/协议/构建预检、后端 plan、进程调用和取消 |
| python/resize_image.py / python/resize-source.json | 逐字节未修改的原始缩放脚本副本，以及 SHA-256 校验记录 |
| python/process_image.py | 原入口直调、工作台模式适配、尺寸计划与命名、PNG/JPEG/WebP 编码、优化与回退 |
| public/vendor/oxipng/ | 保留旧 JS/WASM 及 Apache/MIT 许可证；应用不执行也不通过 HTTP 暴露 |
| server.mjs | 本机静态服务、带令牌的图像处理/目录 API、原生目录选择窗口、路径与输出保护 |
| start.ps1 / start.cmd | 检查 Node、Python/Pillow、协议/构建和端口，核实本项目旧服务后升级，在后台启动并打开浏览器 |
| stop.ps1 / 停止工具.cmd | 校验 PID 与命令行后停止本项目服务 |
| tests/core.test.mjs | 纯逻辑与临时目录/HTTP 集成验证 |
| tests/localization.test.mjs | 双语完整性、语言记忆、主题标签、DOM 桩中运行真实前端脚本验证参数/选择/记录 |
| tests/backend.test.mjs / tests/python_image_test.py | 真实 Python 编码、原工具像素对照、透明度、PNG 回退、取消、本机接口和导出验证 |
| tests/image-fixtures.mjs | 图像测试数据及后端验证用的独立 PNG 解码 |
| settings.json | 运行时生成，输入/输出目录和监听设置；不提交，不覆盖用户配置 |
| .runtime/ | 启动日志和 PID；不提交 |

## 增加一个缩放模式

1. 在 `MODES` 中添加 id 和图标；在 i18n.js 注册 mode.id.title / description / help 的英文和中文。页面通过 t() 显示，不直接读取模式中的中文元数据。
2. 在 `python/process_image.py` 的尺寸计划与真实处理一起接通，页面通过 /api/plan 显示结果。不得恢复前端 geometry/outputName 或在 Canvas 中实现第二套算法；图片尺寸与命名只有后端一处实现。
3. 如需新参数，在 index.html 增加有 label 的控件，在 app.js 的 options()/setMode()/preferenceIds 中接通。纯模式切换通常不需要改服务端。
4. 为有效场景与关键边界增加少量有意义的测试。验证实际编码图片的尺寸和透明度，前后预览应与导出一致。
5. 更新英文 README.md 和中文 README.zh-CN.md 的功能表、参数和限制。

批量导出统一经过 exportSelected → loadSource 原图 → /api/export：提交原始图片、原相对路径和处理参数，后端计划输出尺寸及命名，由 image-processor.mjs 调用 Python，再由 Node 的 saveImage 使用原有原子 wx/覆盖策略最终写入，返回 layout/optimization/processing 等元数据。/api/preview 同样处理原始图片，返回编码二进制和 X-Resize-Result 元数据；缩略图与预览复用此接口，浏览器仅显示结果。预览默认 1:1，可切换适应窗口；采样方式、调色板状态以实际后端返回为准，记录不得仅复述页面参数。每张错误单独记录，继续后续文件；停止取消当前处理请求和剩余任务，保留已写入文件。Python 仅在受控临时目录调用原函数，不直接写用户目标目录；最终目录安全和同名策略由 Node 处理。

GET /api/engine 与其它 API 一样受令牌保护，返回 protocol:2、buildId、engine:'pillow'、defaults、runtime。前端确认协议和引擎再处理，plan/preview/export 带版本协议；不得静默回退旧服务。启动脚本读取页面令牌查询 /api/engine，protocol/buildId 与本地预检都匹配才复用。版本不匹配时，只可停止同时通过 server.pid、Get-CimInstance 精确项目命令行和本次监听端口验证的旧进程；不能确认就报具体错误，不停止其它程序。

「恢复默认参数」是用户主动操作：按高度 120、PNG/LANCZOS、PNG 优化开、palette 关。启动页面时删除浏览器保存的旧 nearest 偏好，其它偏好保持不变；后端忽略旧请求中的 nearest，所有尺寸模式、缩略图、预览和导出固定 LANCZOS，不能通过旧设置重新启用最近邻。保留参数的引擎默认值从原 parser 获得，页面不得自行声称其它旧选择已恢复为默认。

## 输入与监听

- 目录素材使用 `local:根目录:相对路径:大小:mtime` 标识，首次加载/切换目录的已有素材默认不选中；同目录后续扫描中新出现的文件自动选中。改变的同路径图片保留原选择状态和加入时间，手动取消选择不会在刷新后被撤销。
- `libraryRoot` 标记上次成功同步的目录；`reconcileLibrary` 处理列表同步和选择，`compareAssets` 处理展示顺序。运行期间新增/手动导入使用同批 `addedAt`，优先显示，按加入时间倒序；已有素材按 mtime 倒序；同一时间按名称升序，重名按相对路径排序。拷贝老文件也会排在前面。
- 拖入素材使用 `drop:相对路径:大小:mtime` 去重，保存浏览器 File，默认选中。
- 文件夹拖入用 webkitGetAsEntry；必须在 drop 事件同步捕获句柄，目录 reader.readEntries 要循环到空，避免只读前 100 个文件。
- 缩略图保持受限并发，将原图送到后端生成缩略图，记录后端返回的原始尺寸并显示编码结果；导出逐张处理，及时释放对象 URL，避免长期持有全尺寸解码图片。
- 监听是页面每 3 秒 /api/library 轮询，不是后台自动转换。浏览器后台可能节流，导出期间冻结参数并暂停刷新。

## 输出约定

默认输入 `./input`、默认输出 `./output`，配置和页面保留相对路径；服务端在实际读写、目录选择和打开目录时统一以项目目录解析，不依赖 process.cwd()。用户仍可在页面指定相对或绝对路径，指定目标目录优先；空输出配置恢复 `./output`。目录不清空，旧工具的 input/output 保留。

safeRelative 限制越界和 Windows 非法文件名；noLinks 避免子目录链接。saveImage 使用 wx 原子写入做自动重命名/跳过，覆盖需明确策略。输入目录下的目标拒绝写入。浏览器拖入文件无绝对源路径，文档已提醒用户将输出与原图分开。

PNG 与 WebP 保留透明，JPG 补白背景；输出扩展名必须匹配编码类型。图像先转换为 RGBA，固定使用 Pillow LANCZOS，包括原工具入口、扩展模式和失败回退，不保留工作台的 NEAREST 处理分支。文件体积目标尚未实现，不能把指定宽高描述成「压到指定 KB」。缩小尺寸本身仍会丢失细线等细节，不能把 PNG 无损编码等同于整个缩放过程无损。

## PNG 无损优化

png-optimize 默认 checked，随 preferenceIds 记忆；formatChanged 只在 PNG 显示。正常原入口直接保留 resize_png 的 `optimize=True, compress_level=9` 编码，即使没有体积节省也不替换；此时 status 为 original，savedBytes 为 0。Python 扩展模式仍可只采用严格更小的优化候选。原入口或优化失败、30 秒超时时尝试基础 PNG 回退；取消整个请求时不得继续导出。预览与导出共用相同处理。

palette 是独立、默认关闭的有损选项，对应原 --palette：缩放后转为 256 色 P 模式，可能改变颜色与透明度，不能混同 PNG 无损编码。像素保真检查应比较所选转换之后的 RGBA 解码结果；关闭 palette 时仍须保证无损优化不改变 RGBA，包括全透明像素 RGB。

日志只保留 status/originalBytes/optimizedBytes/savedBytes，并根据当前语言展示；不能保存整张 Blob。批次总节省只计实际成功写入的文件。预览关闭和停止按钮接入 AbortController，取消当前尚未写入的图片不计失败。验证优化前后真实解码 RGBA，包括 alpha=0 像素的隐藏 RGB；代码检查和自动测试不替代浏览器预览/目标文件验收。

旧 OxiPNG 文件及许可证保留在仓库中，但不再运行或列入服务端静态白名单。移除为其设置的 WASM/Worker 运行需求；不能开放远程资源或通用 unsafe-eval。Python 图像接口与原有目录接口一样，必须保留 127.0.0.1 绑定、Host/Origin 检查、请求令牌、请求体/像素限制、相对路径和符号链接检查。

## 视觉主题约定

主色 `--primary: #355CE5` 用于主导出按钮、选中、焦点和进度；`--primary-soft` 用于选中模式的浅色背景；中性灰白用于页面、卡片和素材棋盘格。主导出按钮蓝底白字，hover 使用 `--primary-hover`，disabled 使用独立的 `--disabled-bg` / `--disabled-text`，不叠加全局半透明效果。成功/错误使用独立的 `--success` / `--danger`。SVG 图标为蓝底白色线条，保持同一主题。调整颜色时保留布局和业务逻辑，并检查文字对比度及禁用状态。

右上角 `theme-toggle` 在浅色/暗黑之间切换。theme.js 是在 CSS 前加载的独立脚本，先恢复 `resize-studio-theme`，再在 DOMContentLoaded 接上按钮；首次默认浅色。CSS 的 `:root[data-theme="dark"]` 覆盖颜色变量，表面统一使用 `--surface` / `--input-bg` 等变量，不能添加固定白色的背景。暗黑模式的蓝色文字用 `--primary`，蓝底白字主按钮用 `--action-bg`，避免提亮文字蓝色后导致主按钮白字对比不足。主题切换不重建素材列表、不改变勾选或加工参数，也不改变 Python 图片输出。

素材工具栏使用 `.library-action` 图标文字按钮，「全选可见」用 `.library-action-accent` 强调。SVG 使用 currentColor 随主题变化，aria-hidden 避免重复朗读；data-i18n 放在内部 span，切换语言保留图标。保持现有选择与清空导入事件，窄屏允许按钮换行。

## 中英文约定

首次默认英文。页头 language-select 在 EN / 中文之间切换，localStorage 的 resize-studio-language 独立于主题和加工参数；文档默认 README.md 英文，README.zh-CN.md 中文。i18n.js 在 theme.js 和样式之前加载，提供 window.ResizeI18n 的 t / getLanguage / setLanguage / errorText。静态纯文本用 data-i18n，placeholder / aria-label 用 data-i18n-placeholder / data-i18n-aria；有 input、图标等子元素的标签应只翻译内部 span，避免 textContent 清除控件。

动态文案通过 t(key, params)；参数中的路径和文件名保持原样。处理记录存 key、params 和时间，resize-language-change 时重新翻译已有记录，不能只保存翻译后的字符串。核心计算和服务端保留稳定错误消息，errorText 在界面显示时映射双语；新增错误需同时补映射。语言切换只更新显示，保留素材列表、选择、排序、数值、路径和图片输出。批量导出期间禁用语言选择。新增文案补双语并运行 npm test 的本地化验证。

## 可继续扩展的明确方向

这些是候选功能，只有用户要求后才添加：目标 KB/MB 压缩、Excel 按素材映射尺寸、裁切锚点、命名模板、常用操作预设、图片边距和透明边缘处理。
