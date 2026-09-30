import { MODES, geometry, outputName, renderImage } from './resize.mjs';

const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="resize-token"]').content;
const supported = /\.(png|jpe?g|webp|bmp)$/i;
const state = { mode: 'height', items: new Map(), config: null, busy: false, scanning: false, importing: false, cancelled: false, thumbnailQueue: [], thumbnailWorkers: 0 };
let toastTimer;
const bytes = value => value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const element = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };

function log(message, kind = 'neutral') {
  const row = element('li', kind, `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`);
  $('log').prepend(row);
  while ($('log').children.length > 300) $('log').lastElementChild.remove();
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function errorReport(error) { log(error.message, 'error'); toast(error.message); }
function on(id, event, action) { $(id).addEventListener(event, e => { Promise.resolve().then(() => action(e)).catch(errorReport); }); }
async function api(route, { method = 'GET', body, raw = false } = {}) {
  const response = await fetch(`/api/${route}`, { method, headers: { 'X-Resize-Token': token, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `请求失败 (${response.status})`); }
  return route.startsWith('image?') ? response.blob() : response.json();
}

function options() {
  return { mode: state.mode, width: Number($('width').value), height: Number($('height').value), percent: Number($('percent').value), fit: $('fit').value, nearest: $('nearest').checked, allowUpscale: $('allow-upscale').checked, quality: Number($('quality').value) / 100 };
}
function selectedItems() { return [...state.items.values()].filter(item => item.selected); }
function visibleItems() {
  const query = $('search').value.trim().toLocaleLowerCase();
  return [...state.items.values()].filter(item => item.relativePath.toLocaleLowerCase().includes(query));
}
function updateCounts() {
  const count = selectedItems().length;
  $('library-count').textContent = `${state.items.size} 张素材`;
  $('selection-count').textContent = `已选择 ${count} 张 / 当前显示 ${visibleItems().length} 张`;
  $('export-count').textContent = `准备导出 ${count} 张`;
  $('export').disabled = state.busy || state.importing || count === 0 || !state.config;
  $('empty').hidden = visibleItems().length > 0;
}
function updateCard(item, card) {
  card.classList.toggle('selected', item.selected);
  card.classList.toggle('failed', Boolean(item.error));
  card.querySelector('input').checked = item.selected;
  const target = card.querySelector('.card-target');
  target.classList.remove('error');
  if (item.error) { target.textContent = item.error; target.classList.add('error'); }
  else if (item.width) {
    try { const size = geometry(item.width, item.height, options()); target.textContent = `→ ${size.width} × ${size.height} px`; }
    catch (error) { target.textContent = error.message; target.classList.add('error'); }
  } else target.textContent = '读取尺寸中…';
  card.querySelector('.card-size').textContent = item.width ? `${item.width} × ${item.height} · ${bytes(item.size)}` : bytes(item.size);
  const thumb = card.querySelector('.thumb-button');
  if (item.thumbnail && !thumb.querySelector('img')) { const image = element('img'); image.src = item.thumbnail; image.alt = item.name; thumb.replaceChildren(image); }
}
function renderLibrary() {
  const fragment = document.createDocumentFragment();
  for (const item of visibleItems()) {
    const card = element('article', 'image-card'); card.dataset.id = item.id; card.title = item.relativePath;
    const check = element('label', 'card-check'); const input = element('input'); input.type = 'checkbox'; input.setAttribute('aria-label', `选择 ${item.relativePath}`); check.append(input);
    const thumb = element('button', 'thumb-button'); thumb.type = 'button'; thumb.setAttribute('aria-label', `预览 ${item.relativePath}`); thumb.append(element('span', '', '▧'));
    const body = element('div', 'card-body'); body.append(element('div', 'card-name', item.name), element('div', 'card-size'), element('div', 'card-target'), element('div', 'card-source', item.source === 'local' ? '素材目录' : '拖入 / 手动导入'));
    card.append(check, thumb, body); updateCard(item, card); fragment.append(card);
  }
  $('library').replaceChildren(fragment); updateCounts();
}
function repaintItem(item) { for (const card of $('library').children) if (card.dataset.id === item.id) updateCard(item, card); }
function updateTargets() { for (const card of $('library').children) { const item = state.items.get(card.dataset.id); if (item) updateCard(item, card); } }

function setMode(mode) {
  state.mode = mode;
  for (const button of $('modes').children) { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  $('height-field').hidden = !['height', 'exact', 'fit'].includes(mode);
  $('width-field').hidden = !['width', 'exact', 'fit'].includes(mode);
  $('percent-field').hidden = mode !== 'percent'; $('fit-field').hidden = mode !== 'exact';
  $('mode-help').textContent = {
    height: '指定高度，宽度按原图比例计算；尺寸取整与原 Python 工具一致。',
    width: '指定宽度，高度按原图比例计算。',
    exact: '拉伸可能改变比例；留白保留完整内容；裁切填满画布。',
    percent: '50% 即原尺寸的一半；80% 即原尺寸的 0.8 倍。',
    fit: '在限定的宽高内等比缩放，输出实际尺寸，不补留白。'
  }[mode];
  const presets = mode === 'percent' ? [25, 50, 80, 100] : mode === 'height' || mode === 'width' ? [50, 108, 120, 256] : [64, 108, 128, 256];
  $('presets').replaceChildren(...presets.map(size => {
    const button = element('button', 'preset', mode === 'percent' ? `${size}%` : mode === 'exact' || mode === 'fit' ? `${size}²` : `${size}px`);
    button.type = 'button'; button.addEventListener('click', () => {
      if (mode === 'percent') $('percent').value = size;
      else if (mode === 'height') $('height').value = size;
      else if (mode === 'width') $('width').value = size;
      else { $('height').value = size; $('width').value = size; }
      remember(); updateTargets();
    }); return button;
  }));
  updateTargets(); remember();
}
const preferenceIds = ['height', 'width', 'percent', 'fit', 'allow-upscale', 'nearest', 'format', 'collision', 'suffix', 'preserve', 'quality'];
function remember() {
  const values = { mode: state.mode };
  for (const id of preferenceIds) values[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  try { localStorage.setItem('resize-studio-options', JSON.stringify(values)); } catch {}
}
function formatChanged() { $('quality-field').hidden = $('format').value === 'png'; remember(); }
function setBusy(busy) {
  state.busy = busy;
  for (const node of document.querySelectorAll('main button, main input, main select, .image-card input')) node.disabled = busy;
  $('cancel').hidden = !busy; $('cancel').disabled = false; $('cancel').textContent = '停止剩余任务'; $('progress').hidden = !busy; updateCounts();
}

async function loadSource(item) {
  const blob = item.source === 'local' ? await api(`image?path=${encodeURIComponent(item.relativePath)}&mtime=${item.modified}`) : item.file;
  const url = URL.createObjectURL(blob); const image = new Image(); image.src = url;
  try { await image.decode(); } catch { URL.revokeObjectURL(url); throw new Error('图片无法解码，可能已损坏或格式不支持'); }
  return { image, dispose: () => { image.src = ''; URL.revokeObjectURL(url); } };
}
function queueThumbnail(item) {
  state.thumbnailQueue.push(item);
  runThumbnailQueue();
}
function runThumbnailQueue() {
  while (state.thumbnailWorkers < 3 && state.thumbnailQueue.length) {
    const item = state.thumbnailQueue.shift();
    if (state.items.get(item.id) !== item) continue;
    state.thumbnailWorkers++;
    makeThumbnail(item).catch(error => {
      if (state.items.get(item.id) !== item) return;
      item.error = error.message; log(`${item.relativePath}：${error.message}`, 'error'); repaintItem(item);
    }).finally(() => { state.thumbnailWorkers--; runThumbnailQueue(); });
  }
}
async function makeThumbnail(item) {
  const source = await loadSource(item);
  try {
    if (state.items.get(item.id) !== item) return;
    item.width = source.image.naturalWidth; item.height = source.image.naturalHeight;
    const scale = Math.min(1, 220 / item.width, 160 / item.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(item.width * scale)); canvas.height = Math.max(1, Math.round(item.height * scale));
    canvas.getContext('2d').drawImage(source.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    if (state.items.get(item.id) !== item) return;
    if (blob) item.thumbnail = URL.createObjectURL(blob);
    repaintItem(item);
  } finally { source.dispose(); }
}
function removeItem(item) { if (item.thumbnail) URL.revokeObjectURL(item.thumbnail); state.items.delete(item.id); }

async function refreshLibrary(manual = false) {
  if (!state.config || state.scanning || state.busy || state.importing) return;
  state.scanning = true;
  try {
    const snapshot = await api('library');
    if (state.busy || state.importing) return;
    const keep = new Set(); let added = 0, removed = 0;
    for (const file of snapshot.files) {
      const id = `local:${state.config.input}:${file.relativePath}:${file.size}:${file.modified}`;
      keep.add(id);
      if (state.items.has(id)) continue;
      // Preserve an existing selection when a file is replaced in the watched folder.
      const previous = [...state.items.values()].find(item => item.source === 'local' && item.root === state.config.input && item.relativePath === file.relativePath);
      const item = { ...file, id, source: 'local', root: state.config.input, selected: previous?.selected ?? false };
      state.items.set(id, item); queueThumbnail(item); added++;
    }
    for (const item of [...state.items.values()]) if (item.source === 'local' && !keep.has(item.id)) { removeItem(item); removed++; }
    if (added || removed || manual) renderLibrary();
    if (manual) log(`素材目录已刷新：${snapshot.files.length} 张图片。目录素材默认不勾选，请选择所需素材。`);
    else if (added || removed) log(`目录变化：新增或更新 ${added} 张，移除 ${removed} 张。`);
    for (const warning of snapshot.warnings) log(`目录读取提示：${warning}`, 'error');
    $('watch-label').textContent = state.config.watch ? '自动刷新中' : '手动刷新';
  } finally { state.scanning = false; }
}
async function saveConfig(input = state.config.input) {
  state.config = await api('config', { method: 'POST', body: { input, output: $('output-path').value.trim(), watch: $('watch').checked } });
  $('input-path').value = state.config.input;
  $('output-hint').textContent = `当前导出：${state.config.output}。目录不存在时自动创建。`;
  $('watch-label').textContent = state.config.watch ? '自动刷新中' : '手动刷新';
}
async function applyInput() {
  if (state.scanning || state.busy || state.importing) { toast('素材正在读取，请稍后再切换目录'); return; }
  await saveConfig($('input-path').value.trim()); await refreshLibrary(true);
}
async function browse(kind) {
  const button = $(`browse-${kind}`); button.disabled = true; toast('请选择文件夹；目录选择窗口可能位于浏览器后方。');
  try {
    const result = await api('choose-folder', { method: 'POST', body: { initial: $(`${kind}-path`).value || state.config[kind] } });
    if (!result.path) return;
    $(`${kind}-path`).value = result.path;
    if (kind === 'input') await applyInput(); else { await saveConfig(); toast('导出目录已更新'); }
  } finally { button.disabled = state.busy; }
}

async function importFiles(entries) {
  if (state.busy || state.importing) { toast('当前任务进行中，请完成后再添加素材'); return; }
  state.importing = true; updateCounts();
  try {
    let added = 0, ignored = 0;
    for (const { file, relativePath } of entries) {
      if (!supported.test(file.name)) { ignored++; continue; }
      const relative = relativePath || file.webkitRelativePath || file.name;
      const id = `drop:${relative}:${file.size}:${file.lastModified}`;
      if (state.items.has(id)) continue;
      const item = { id, name: file.name, relativePath: relative, file, size: file.size, modified: file.lastModified, source: 'drop', selected: true };
      state.items.set(id, item); queueThumbnail(item); added++;
    }
    renderLibrary(); log(`导入 ${added} 张图片${ignored ? `；忽略 ${ignored} 个不支持的文件` : ''}。导入素材已自动勾选。`); toast(`已添加 ${added} 张图片`);
  } finally { state.importing = false; updateCounts(); }
}
async function collectEntry(entry, base = '') {
  const relative = `${base}${entry.name}`;
  if (entry.isFile) return [{ file: await new Promise((resolve, reject) => entry.file(resolve, reject)), relativePath: relative }];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader(); const result = [];
  // Chromium returns directory entries in chunks (often 100); read until empty.
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) result.push(...await collectEntry(child, `${relative}/`));
  }
  return result;
}

async function preview(item) {
  if (state.busy) return;
  $('preview-name').textContent = item.relativePath; $('preview-content').replaceChildren(); $('preview-note').textContent = '正在生成预览…';
  if (!$('preview').open) $('preview').showModal();
  const source = await loadSource(item);
  try {
    const rendered = await renderImage(source.image, options(), $('format').value);
    if (!$('preview').open) return;
    const original = element('div', 'preview-box'); original.append(element('h3', '', '原图'));
    const originalContainer = element('div', 'preview-image');
    const originalThumb = document.createElement('canvas'); const ratio = Math.min(1, 700 / source.image.naturalWidth, 700 / source.image.naturalHeight); originalThumb.width = Math.max(1, Math.round(source.image.naturalWidth * ratio)); originalThumb.height = Math.max(1, Math.round(source.image.naturalHeight * ratio)); originalThumb.getContext('2d').drawImage(source.image, 0, 0, originalThumb.width, originalThumb.height); originalContainer.append(originalThumb);
    original.append(originalContainer, element('p', '', `${source.image.naturalWidth} × ${source.image.naturalHeight} px · ${bytes(item.size)}`));
    const result = element('div', 'preview-box'); result.append(element('h3', '', '处理后'));
    const resultContainer = element('div', 'preview-image');
    // Preview the encoded output too, so JPG/WebP quality is visible.
    const url = URL.createObjectURL(rendered.blob); const resultImage = element('img'); resultImage.src = url; resultImage.alt = '处理后预览'; await resultImage.decode(); URL.revokeObjectURL(url); resultContainer.append(resultImage);
    result.append(resultContainer, element('p', '', `${rendered.layout.width} × ${rendered.layout.height} px · ${bytes(rendered.blob.size)}`));
    $('preview-content').replaceChildren(original, result); $('preview-note').textContent = '预览自适应窗口大小，标注尺寸为实际输出尺寸。棋盘格代表透明区域。';
  } catch (error) { $('preview-note').textContent = error.message; }
  finally { source.dispose(); }
}

async function exportSelected() {
  const items = selectedItems(); if (!items.length || state.busy) return;
  const settings = options(); const format = $('format').value;
  const suffix = $('suffix').value; const preserve = $('preserve').checked; const collision = $('collision').value;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(suffix)) throw new Error('文件名后缀不能包含路径或特殊字符');
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('不支持的导出格式');
  if (format !== 'png' && (!Number.isFinite(settings.quality) || settings.quality < 0.01 || settings.quality > 1)) throw new Error('编码质量必须为 1–100');
  state.cancelled = false; setBusy(true); let saved = 0, skipped = 0, failed = 0, attempted = 0;
  $('progress').max = items.length; $('progress').value = 0; $('progress-label').textContent = '准备导出…';
  try {
    // Persist the explicit output path before any file is written.
    await saveConfig();
    log(`开始导出 ${items.length} 张 → ${state.config.output}`);
    for (const item of items) {
      if (state.cancelled) break;
      attempted++; let source;
      $('progress-label').textContent = `${attempted} / ${items.length} · ${item.relativePath}`;
      try {
        source = await loadSource(item);
        const rendered = await renderImage(source.image, settings, format);
        const name = outputName(item.relativePath, format, suffix, preserve);
        const result = await api(`export?name=${encodeURIComponent(name)}&collision=${collision}`, { method: 'POST', body: rendered.blob, raw: true });
        if (result.status === 'skipped') { skipped++; log(`跳过同名文件：${result.path}`); }
        else { saved++; log(`已保存 ${rendered.layout.width} × ${rendered.layout.height} · ${bytes(result.size)} → ${result.path}`, 'success'); }
        item.error = ''; repaintItem(item);
      } catch (error) { failed++; item.error = error.message; repaintItem(item); log(`${item.relativePath}：${error.message}`, 'error'); }
      finally { source?.dispose(); }
      $('progress').value = attempted;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const summary = `${state.cancelled ? '已停止' : '处理完成'}：保存 ${saved}，跳过 ${skipped}，失败 ${failed}${state.cancelled ? `，未处理 ${items.length - attempted}` : ''}`;
    $('progress-label').textContent = summary; log(summary, failed ? 'error' : 'success'); toast(summary);
  } finally { setBusy(false); }
}

for (const mode of MODES) {
  const button = element('button', 'mode-button'); button.type = 'button'; button.dataset.mode = mode.id;
  const text = element('div'); text.append(element('strong', '', mode.title), element('small', '', mode.description)); button.append(element('span', 'mode-icon', mode.icon), text);
  button.addEventListener('click', () => setMode(mode.id)); $('modes').append(button);
}
try {
  const stored = JSON.parse(localStorage.getItem('resize-studio-options') || '{}');
  for (const id of preferenceIds) if (stored[id] !== undefined) { if ($(id).type === 'checkbox') $(id).checked = stored[id]; else $(id).value = stored[id]; }
  if (MODES.some(mode => mode.id === stored.mode)) state.mode = stored.mode;
} catch {}
setMode(state.mode); formatChanged();
for (const id of preferenceIds) on(id, 'input', () => { remember(); updateTargets(); if (id === 'format') formatChanged(); });
on('search', 'input', renderLibrary);
on('select-all', 'click', () => { for (const item of visibleItems()) item.selected = true; renderLibrary(); });
on('select-none', 'click', () => { for (const item of state.items.values()) item.selected = false; renderLibrary(); });
on('clear-imports', 'click', () => { for (const item of [...state.items.values()]) if (item.source === 'drop') removeItem(item); renderLibrary(); });
on('library', 'change', event => { const item = state.items.get(event.target.closest('.image-card')?.dataset.id); if (!item) return; item.selected = event.target.checked; repaintItem(item); updateCounts(); });
on('library', 'click', event => { const button = event.target.closest('.thumb-button'); if (!button) return; const item = state.items.get(button.closest('.image-card').dataset.id); return preview(item); });
on('pick-files', 'click', event => { event.stopPropagation(); $('files-input').click(); });
on('pick-folder', 'click', event => { event.stopPropagation(); $('folder-input').click(); });
on('files-input', 'change', async event => { await importFiles([...event.target.files].map(file => ({ file }))); event.target.value = ''; });
on('folder-input', 'change', async event => { await importFiles([...event.target.files].map(file => ({ file }))); event.target.value = ''; });
on('dropzone', 'click', event => { if (!event.target.closest('button') && !state.busy) $('files-input').click(); });
on('dropzone', 'keydown', event => { if (event.target === $('dropzone') && ['Enter', ' '].includes(event.key) && !state.busy) { event.preventDefault(); $('files-input').click(); } });
for (const type of ['dragenter', 'dragover']) $('dropzone').addEventListener(type, event => { event.preventDefault(); if (!state.busy) $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', event => { if (!$('dropzone').contains(event.relatedTarget)) $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => {
  event.preventDefault(); $('dropzone').classList.remove('dragging'); if (state.busy || state.importing) return;
  // Capture entries and files synchronously before the DataTransfer store expires.
  const entries = [...event.dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = [...event.dataTransfer.files].map(file => ({ file }));
  state.importing = true; updateCounts();
  (async () => {
    let files = fallback;
    if (entries.length) {
      $('progress-label').textContent = '正在读取拖入的文件夹…'; files = [];
      for (const entry of entries) files.push(...await collectEntry(entry));
    }
    state.importing = false;
    await importFiles(files); $('progress-label').textContent = '';
  })().catch(errorReport).finally(() => { state.importing = false; updateCounts(); });
});
// Prevent accidental browser navigation if a file is dropped just outside the drop area.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
on('apply-input', 'click', applyInput);
on('input-path', 'keydown', event => { if (event.key === 'Enter') return applyInput(); });
on('output-path', 'change', async () => { await saveConfig(); toast('导出目录已保存'); });
on('watch', 'change', () => saveConfig());
on('refresh', 'click', () => refreshLibrary(true));
on('browse-input', 'click', () => browse('input')); on('browse-output', 'click', () => browse('output'));
on('export', 'click', exportSelected);
on('cancel', 'click', () => { state.cancelled = true; $('cancel').disabled = true; $('cancel').textContent = '正在停止…'; });
on('open-output', 'click', async () => { await saveConfig(); await api('open-output', { method: 'POST' }); });
on('clear-log', 'click', () => $('log').replaceChildren());
on('close-preview', 'click', () => $('preview').close());
on('preview', 'click', event => { if (event.target === $('preview')) { const rect = $('preview').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('preview').close(); } });

async function initialize() {
  state.config = await api('config'); $('input-path').value = state.config.input; $('output-path').value = state.config.output; $('watch').checked = state.config.watch;
  $('output-hint').textContent = `当前导出：${state.config.output}。留空使用默认 output。`;
  await refreshLibrary(true); updateCounts();
  setInterval(() => { if (state.config.watch) refreshLibrary().catch(error => { $('watch-label').textContent = '读取失败，可手动刷新'; console.warn(error.message); }); }, 3000);
}
initialize().catch(errorReport);
