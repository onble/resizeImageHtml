// No dependencies: English is the default; language only affects presentation.
(() => {
  const messages = {
    'page.title': ['Resize Studio · Local Image Workbench', '图片缩放工作台 · Resize Studio'],
    'brand.title': ['Resize Studio', '图片缩放工作台'],
    'brand.subtitle': ['LOCAL IMAGE WORKBENCH', 'RESIZE STUDIO / 本地素材工具'],
    'local': ['Local processing · No cloud uploads', '本地处理 · 图片无需上传'],
    'language': ['Interface language', '界面语言'],
    'theme.light': ['Light mode', '浅色模式'],
    'theme.dark': ['Dark mode', '暗黑模式'],
    'theme.switch': ['Switch to {mode}', '切换到{mode}'],
    'section.assets': ['01 / ASSETS', '01 / 素材'],
    'headline': ['Batch Image Resizing', '批量调整图片尺寸'],
    'intro': ['Choose your assets. Set the size. Export in one go.', '选好素材，设置尺寸，一次导出。'],
    'drop.aria': ['Choose images or drop images and folders', '选择图片或拖入图片与文件夹'],
    'drop.title': ['Drop images or an entire folder', '拖入图片，或整个文件夹'],
    'drop.hint': ['PNG, JPG, WebP, BMP · Add more at any time', '支持 PNG、JPG、WebP、BMP · 可多次添加'],
    'pick.files': ['Choose images', '选择图片'],
    'pick.folder': ['Import folder', '导入文件夹'],
    'folder.title': ['Asset folder', '素材目录'],
    'folder.path': ['Asset folder path', '素材目录路径'],
    'folder.placeholder': ['./input or a custom folder path', './input 或自定义目录路径'],
    'browse': ['Browse', '浏览'],
    'load': ['Load', '加载'],
    'watch': ['Watch folder for changes', '监听目录变化'],
    'watch.hint': ['Checks every 3 seconds while this page is open', '页面打开时每 3 秒检查一次'],
    'watch.active': ['Watching', '自动刷新中'],
    'watch.manual': ['Manual refresh', '手动刷新'],
    'watch.failed': ['Read failed · Try refreshing', '读取失败，可手动刷新'],
    'refresh': ['Refresh now ↻', '立即刷新 ↻'],
    'select.all': ['Select visible', '全选可见'],
    'select.none': ['Deselect all', '取消选择'],
    'clear.imports': ['Clear imports', '清空拖入素材'],
    'search.placeholder': ['Search filenames…', '搜索文件名…'],
    'search.aria': ['Search assets', '搜索素材'],
    'sort.hint': ['Newest first · Then name · Click to preview', '最新优先 · 同时按名称 · 点击预览'],
    'assets.count': ['{count} assets', '{count} 张素材'],
    'assets.selection': ['{count} selected / {visible} visible', '已选择 {count} 张 / 当前显示 {visible} 张'],
    'assets.exportCount': ['Ready to export {count} images', '准备导出 {count} 张'],
    'assets.select': ['Select {name}', '选择 {name}'],
    'assets.preview': ['Preview {name}', '预览 {name}'],
    'assets.reading': ['Reading dimensions…', '读取尺寸中…'],
    'assets.local': ['Asset folder', '素材目录'],
    'assets.imported': ['Dropped / imported', '拖入 / 手动导入'],
    'empty.title': ['Your workspace is ready', '素材区准备好了'],
    'empty.hint': ['Drop images or load an asset folder to get started.', '拖入图片，或加载一个素材目录。'],
    'section.resize': ['02 / RESIZE', '02 / 缩放方式'],
    'resize.title': ['How would you like to resize?', '你想怎样改变尺寸？'],
    'mode.height.title': ['By height', '按高度'],
    'mode.height.description': ['Keep the aspect ratio', '宽度等比变化'],
    'mode.width.title': ['By width', '按宽度'],
    'mode.width.description': ['Keep the aspect ratio', '高度等比变化'],
    'mode.exact.title': ['Exact dimensions', '指定尺寸'],
    'mode.exact.description': ['Stretch / Pad / Crop', '拉伸 / 留白 / 裁切'],
    'mode.percent.title': ['By percentage', '按百分比'],
    'mode.percent.description': ['Scale proportionally', '整体等比缩放'],
    'mode.fit.title': ['Fit within bounds', '限定范围'],
    'mode.fit.description': ['Keep within a size limit', '等比放进尺寸内'],
    'mode.height.help': ['Set the height; width scales proportionally. Rounding matches the original Python tool.', '指定高度，宽度按原图比例计算；尺寸取整与原 Python 工具一致。'],
    'mode.width.help': ['Set the width; height scales proportionally.', '指定宽度，高度按原图比例计算。'],
    'mode.exact.help': ['Stretch may change proportions. Pad keeps the full image. Crop fills the canvas.', '拉伸可能改变比例；留白保留完整内容；裁切填满画布。'],
    'mode.percent.help': ['50% is half the original size; 80% is 0.8× the original dimensions.', '50% 即原尺寸的一半；80% 即原尺寸的 0.8 倍。'],
    'mode.fit.help': ['Fit proportionally within the limits. Export the actual size without padding.', '在限定的宽高内等比缩放，输出实际尺寸，不补留白。'],
    'field.height': ['Target height', '目标高度'],
    'field.width': ['Target width', '目标宽度'],
    'field.percent': ['Scale', '缩放比例'],
    'field.fit': ['Canvas fit', '尺寸适配'],
    'fit.stretch': ['Stretch to exact dimensions', '拉伸到指定尺寸'],
    'fit.contain': ['Keep ratio + centered padding', '等比缩放 + 居中留白'],
    'fit.cover': ['Keep ratio + centered crop', '等比缩放 + 居中裁切'],
    'upscale': ['Allow upscaling', '允许放大'],
    'nearest': ['Pixel art / nearest neighbor', '像素风 / 最近邻'],
    'section.export': ['03 / EXPORT', '03 / 导出'],
    'export.title': ['Save to your asset folder', '保存到你的素材目录'],
    'field.output': ['Destination folder', '目标文件夹'],
    'output.placeholder': ['Leave empty to use ./output', '留空使用 ./output'],
    'output.hint': ['Destination: {path}. Missing folders are created automatically.', '当前导出：{path}。目录不存在时自动创建。'],
    'field.format': ['Output format', '输出格式'],
    'format.png': ['PNG · Transparency', 'PNG · 保留透明'],
    'format.webp': ['WebP · Transparency', 'WebP · 保留透明'],
    'format.jpeg': ['JPG · White background', 'JPG · 白色背景'],
    'field.collision': ['Existing files', '遇到同名文件'],
    'collision.rename': ['Add a number', '自动加序号'],
    'collision.skip': ['Skip', '跳过'],
    'collision.overwrite': ['Overwrite destination', '覆盖目标文件'],
    'field.suffix': ['Filename suffix', '文件名后缀'],
    'suffix.placeholder': ['e.g. _small', '如 _small'],
    'field.quality': ['Encoding quality', '编码质量'],
    'preserve': ['Keep the input subfolder structure', '保留输入文件夹的子目录结构'],
    'export.hint': ['Keep originals; save directly to the destination.', '原图保留，结果直接写入目标文件夹'],
    'export.action': ['Resize & export', '批量处理并导出'],
    'export.cancel': ['Stop remaining tasks', '停止剩余任务'],
    'export.stopping': ['Stopping…', '正在停止…'],
    'export.preparing': ['Preparing export…', '准备导出…'],
    'export.open': ['Open output folder ↗', '打开输出文件夹 ↗'],
    'activity.title': ['Activity', '处理记录'],
    'activity.clear': ['Clear activity', '清空记录'],
    'log.ready': ['Ready. Using ./input and ./output relative to this project.', '就绪。默认读取本项目的 ./input，未指定目录时导出到 ./output；相对路径以本项目目录为基准。'],
    'footer': ['Pixel dimensions, not a file-size target · No animated GIF or TIFF · See activity for failed assets', '尺寸缩放 ≠ 指定文件体积 · 不处理 GIF 动画与 TIFF · 处理失败的素材可查看记录'],
    'preview.title': ['Image preview', '图片预览'],
    'preview.close': ['Close preview', '关闭预览'],
    'preview.preparing': ['Generating preview…', '正在生成预览…'],
    'preview.original': ['Original', '原图'],
    'preview.result': ['Resized', '处理后'],
    'preview.alt': ['Resized image preview', '处理后预览'],
    'preview.note': ['Preview fits the window; labels show actual output dimensions. The checkerboard indicates transparency.', '预览自适应窗口大小，标注尺寸为实际输出尺寸。棋盘格代表透明区域。'],
    'log.error': ['{error}', '{error}'],
    'log.fileError': ['{name}: {error}', '{name}：{error}'],
    'log.refreshed': ['Folder refreshed: {count} images. New arrivals are selected and shown first.', '素材目录已刷新：{count} 张图片。运行期间新增图片自动勾选并排在前面。'],
    'log.changes': ['Folder changed: {added} added or updated, {removed} removed.', '目录变化：新增或更新 {added} 张，移除 {removed} 张。'],
    'log.new': ['{count} new images selected and moved to the front.', '新增 {count} 张图片，已自动勾选并优先显示。'],
    'log.warning': ['Folder read warning: {error}', '目录读取提示：{error}'],
    'log.imported': ['Imported {count} images; ignored {ignored} unsupported files. Imported assets are selected.', '导入 {count} 张图片；忽略 {ignored} 个不支持的文件。导入素材已自动勾选。'],
    'log.exportStart': ['Exporting {count} images → {path}', '开始导出 {count} 张 → {path}'],
    'log.skipped': ['Skipped existing file: {path}', '跳过同名文件：{path}'],
    'log.saved': ['Saved {width} × {height} · {size} → {path}', '已保存 {width} × {height} · {size} → {path}'],
    'export.complete': ['Complete: {saved} saved, {skipped} skipped, {failed} failed', '处理完成：保存 {saved}，跳过 {skipped}，失败 {failed}'],
    'export.stopped': ['Stopped: {saved} saved, {skipped} skipped, {failed} failed, {remaining} remaining', '已停止：保存 {saved}，跳过 {skipped}，失败 {failed}，未处理 {remaining}'],
    'toast.new': ['{count} new images selected', '新增 {count} 张图片，已自动勾选'],
    'toast.added': ['Added {count} images', '已添加 {count} 张图片'],
    'toast.reading': ['Reading assets. Please wait before switching folders.', '素材正在读取，请稍后再切换目录'],
    'toast.browse': ['Choose a folder. The dialog may be behind your browser.', '请选择文件夹；目录选择窗口可能位于浏览器后方。'],
    'toast.output': ['Destination folder saved', '导出目录已保存'],
    'toast.busy': ['A task is running. Wait before adding more assets.', '当前任务进行中，请完成后再添加素材'],
    'folder.reading': ['Reading the dropped folder…', '正在读取拖入的文件夹…'],
    'error.positive': ['Dimensions and scale must be greater than zero.', '尺寸和比例必须大于 0'],
    'error.integer': ['Pixel dimensions must be whole numbers.', '像素尺寸必须为整数'],
    'error.large': ['Image too large: max 16384 px per side and approximately 32 million pixels.', '尺寸过大：单边最多 16384 px，总面积最多 3200 万像素'],
    'error.upscale': ['This size requires upscaling. Enable “Allow upscaling” or use smaller dimensions.', '目标需要放大，请勾选「允许放大」或减小尺寸'],
    'error.mode': ['Unknown resize mode.', '未知缩放模式'],
    'error.canvas': ['The browser could not create a canvas.', '浏览器无法创建画布'],
    'error.encode': ['Image encoding failed.', '图片编码失败'],
    'error.decode': ['Cannot decode the image. It may be damaged or unsupported.', '图片无法解码，可能已损坏或格式不支持'],
    'error.suffix': ['Filename suffix cannot contain paths or special characters.', '文件名后缀不能包含路径或特殊字符'],
    'error.quality': ['Encoding quality must be between 1 and 100.', '编码质量必须为 1–100'],
    'error.relative': ['Invalid filename or relative path.', '文件名或相对路径不合法'],
    'error.links': ['Files inside symbolic links or junctions cannot be read or written.', '不读写符号链接或目录联接中的文件'],
    'error.collision': ['Invalid existing-file policy.', '同名处理方式无效'],
    'error.absolute': ['The resolved destination must be an absolute path.', '导出目录必须为绝对路径'],
    'error.format': ['Unsupported export format.', '不支持的导出格式'],
    'error.source': ['Destination is inside the asset folder. Choose a separate folder to preserve originals.', '目标位于当前素材目录中，请选择独立的导出目录以保留原图'],
    'error.duplicates': ['Too many files with this name. Choose another output name.', '同名文件过多，请更换输出名称'],
    'error.bytes': ['A single export exceeds 80 MB.', '单个文件超过 80 MB'],
    'error.dialog': ['The folder dialog is Windows-only. Enter a folder path instead.', '目录选择窗口仅支持 Windows；请直接输入绝对路径'],
    'error.host': ['Only local access is allowed.', '仅接受本机访问'],
    'error.origin': ['Requests from other websites are not allowed.', '不接受其他网页的请求'],
    'error.token': ['Access this endpoint from the Resize Studio page.', '请从本工具页面访问'],
    'error.input': ['The input folder does not exist or is not a directory.', '输入目录不存在或不是文件夹'],
    'error.imageType': ['Unsupported image format.', '不支持的图片格式'],
    'error.empty': ['Image data is empty.', '图片数据为空'],
    'error.explorer': ['Opening a folder automatically is Windows-only.', '自动打开目录仅支持 Windows'],
    'error.api': ['Endpoint not found.', '接口不存在'],
    'error.method': ['Method not supported.', '方法不支持'],
    'error.file': ['File not found.', '文件不存在'],
    'error.request': ['Request failed ({status})', '请求失败 ({status})'],
    'error.browserFormat': ['This browser does not support {format} export.', '当前浏览器不支持 {format} 导出']
  };
  const key = 'resize-studio-language';
  let language = 'en';
  try { if (localStorage.getItem(key) === 'zh') language = 'zh'; } catch {}
  const getLanguage = () => language;
  function t(id, params = {}) {
    const text = messages[id]?.[language === 'zh' ? 1 : 0] ?? id;
    return text.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
  }
  const errorKeys = new Map(Object.entries(messages).filter(([id]) => id.startsWith('error.')).flatMap(([id, texts]) => texts.map(text => [text, id])));
  function errorText(error) {
    const message = String(error?.message ?? error);
    if (errorKeys.has(message)) return t(errorKeys.get(message));
    const request = message.match(/^(?:请求失败|Request failed) \((\d+)\)$/);
    if (request) return t('error.request', { status: request[1] });
    const format = message.match(/^当前浏览器不支持 (\w+) 导出$/);
    if (format) return t('error.browserFormat', { format: format[1] });
    return message;
  }
  function applyStatic() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const [attribute, target] of [['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label']]) {
      for (const node of document.querySelectorAll(`[${attribute}]`)) node.setAttribute(target, t(node.getAttribute(attribute)));
    }
    const select = document.getElementById('language-select');
    if (select) select.value = language;
  }
  function setLanguage(value) {
    language = value === 'zh' ? 'zh' : 'en';
    try { localStorage.setItem(key, language); } catch {}
    applyStatic();
    window.dispatchEvent(new Event('resize-language-change'));
  }
  window.ResizeI18n = { t, getLanguage, setLanguage, applyStatic, errorText };
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.addEventListener('DOMContentLoaded', () => {
    applyStatic();
    document.getElementById('language-select').addEventListener('change', event => setLanguage(event.target.value));
  });
})();
