import { MODES } from './resize.mjs';
import { compareAssets, reconcileLibrary } from './library.mjs';

const { t, errorText, getLanguage } = window.ResizeI18n;
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="resize-token"]').content;
const supported = /\.(png|jpe?g|webp|bmp)$/i;
const state = { mode: 'height', items: new Map(), config: null, engine: null, engineError: '', libraryRoot: null, busy: false, scanning: false, importing: false, cancelled: false, thumbnailQueue: [], thumbnailWorkers: 0 };
const protocol = '2';
let toastTimer, lastToast, lastProgress, previewController, exportController, previewPresentation;
let previewUrls = [];
let planTimer, planController, planGeneration = 0, planRequestKey = '';
let savedPreferences = {};
const bytes = value => value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const element = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };

function optimizationText(result) {
  if (result.status === 'optimized') return t('png.optimized', { before: bytes(result.originalBytes), after: bytes(result.optimizedBytes), saved: bytes(result.savedBytes), percent: (100 * result.savedBytes / result.originalBytes).toFixed(1) });
  if (result.status === 'unchanged') return t('png.unchanged');
  if (result.status === 'original') return t('png.original');
  return t(result.status === 'timed-out' ? 'png.timedOut' : 'png.failed');
}
function processingText(processing) { return t('processing.detail', { resample: processing.resample, palette: t(processing.palette ? 'processing.palette' : 'processing.rgba') }); }
function messageText({ key, params }) { return t(key, { ...params, ...(params.error !== undefined ? { error: errorText(params.error) } : {}), ...(params.optimization ? { detail: optimizationText(params.optimization) } : {}), ...(params.processing ? { detail: processingText(params.processing) } : {}) }); }
function renderLog(row) {
  row.textContent = row.message.at.toLocaleTimeString(getLanguage() === 'zh' ? 'zh-CN' : 'en-GB', { hour12: false }) + '  ' + messageText(row.message);
}
function log(key, kind = 'neutral', params = {}) {
  const row = element('li', kind); row.message = { key, params, at: new Date() }; renderLog(row);
  $('log').prepend(row);
  while ($('log').children.length > 300) $('log').lastElementChild.remove();
}
function toast(key, params = {}) { lastToast = { key, params }; $('toast').textContent = messageText(lastToast); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function errorReport(error) { log('log.error', 'error', { error: error.message }); toast('log.error', { error: error.message }); }
function progressMessage(key, params = {}) { lastProgress = { key, params }; $('progress-label').textContent = messageText(lastProgress); }
function on(id, event, action) { $(id).addEventListener(event, e => { Promise.resolve().then(() => action(e)).catch(errorReport); }); }
async function api(route, { method = 'GET', body, raw = false, signal } = {}) {
  const processing = route === 'plan' || route.startsWith('preview?') || route.startsWith('export?');
  if (processing) requireEngine();
  const response = await fetch(`/api/${route}`, { method, headers: { 'X-Resize-Token': token, ...(processing ? { 'X-Resize-Protocol': protocol } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal });
  if (processing && response.headers.get('X-Resize-Protocol') !== protocol) throw incompatibleEngine();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (processing && response.status === 409) throw incompatibleEngine();
    throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { status: response.status });
  }
  if (route.startsWith('preview?')) {
    let metadata;
    try { metadata = JSON.parse(response.headers.get('X-Resize-Result')); } catch {}
    if (!metadata?.layout?.width || !metadata?.layout?.height || !metadata?.original?.width || !metadata?.original?.height) throw new Error('Invalid image processing response.');
    return { ...metadata, blob: await response.blob() };
  }
  return route.startsWith('image?') ? response.blob() : response.json();
}
function incompatibleEngine() {
  state.engine = null;
  state.engineError = 'The image processing service is incompatible. Restart Resize Studio and reload this page.';
  updateCounts(); updateEngineHint();
  return new Error(state.engineError);
}
function requireEngine() { if (state.engine?.protocol !== Number(protocol) || state.engine.engine !== 'pillow') throw incompatibleEngine(); }
function updateEngineHint() {
  $('engine-hint').textContent = state.engineError ? errorText(state.engineError) : state.engine ? t('resize.engine') : t('engine.checking');
  $('engine-hint').classList.toggle('error', Boolean(state.engineError));
}
function processPreview(blob, settings, format, signal) {
  return api(`preview?options=${encodeURIComponent(JSON.stringify({ ...settings, format }))}`, { method: 'POST', body: blob, raw: true, signal });
}

function options() {
  return { mode: state.mode, width: Number($('width').value), height: Number($('height').value), percent: Number($('percent').value), fit: $('fit').value, allowUpscale: $('allow-upscale').checked, quality: Number($('quality').value) / 100, pngOptimize: $('png-optimize').checked, palette: $('palette').checked };
}
function selectedItems() { return [...state.items.values()].filter(item => item.selected); }
function visibleItems() {
  const query = $('search').value.trim().toLocaleLowerCase();
  return [...state.items.values()].filter(item => item.relativePath.toLocaleLowerCase().includes(query)).sort(compareAssets);
}
function updateCounts() {
  const count = selectedItems().length;
  $('library-count').textContent = t('assets.count', { count: state.items.size });
  $('selection-count').textContent = t('assets.selection', { count, visible: visibleItems().length });
  $('export-count').textContent = t('assets.exportCount', { count });
  $('export').disabled = state.busy || state.importing || count === 0 || !state.config || !state.engine;
  $('empty').hidden = visibleItems().length > 0;
}
function updateCard(item, card) {
  card.classList.toggle('selected', item.selected);
  card.classList.toggle('failed', Boolean(item.error));
  card.querySelector('input').checked = item.selected;
  const target = card.querySelector('.card-target');
  target.classList.remove('error');
  if (item.error) { target.textContent = errorText(item.error); target.classList.add('error'); }
  else if (item.width) {
    const plan = item.targetPlan?.settingsKey === JSON.stringify({ ...options(), format: $('format').value }) ? item.targetPlan : null;
    if (plan?.error) { target.textContent = errorText(plan.error); target.classList.add('error'); }
    else if (plan?.layout) target.textContent = `→ ${plan.layout.width} × ${plan.layout.height} px`;
    else target.textContent = state.engineError ? errorText(state.engineError) : t('assets.planning');
  } else target.textContent = t('assets.reading');
  card.querySelector('.card-size').textContent = item.width ? `${item.width} × ${item.height} · ${bytes(item.size)}` : bytes(item.size);
  const thumb = card.querySelector('.thumb-button');
  if (item.thumbnail && !thumb.querySelector('img')) { const image = element('img'); image.src = item.thumbnail; image.alt = item.name; thumb.replaceChildren(image); }
}
function renderLibrary() {
  const fragment = document.createDocumentFragment();
  for (const item of visibleItems()) {
    const card = element('article', 'image-card'); card.dataset.id = item.id; card.title = item.relativePath;
    const check = element('label', 'card-check'); const input = element('input'); input.type = 'checkbox'; input.setAttribute('aria-label', t('assets.select', { name: item.relativePath })); check.append(input);
    const thumb = element('button', 'thumb-button'); thumb.type = 'button'; thumb.setAttribute('aria-label', t('assets.preview', { name: item.relativePath })); thumb.append(element('span', '', '▧'));
    const body = element('div', 'card-body'); body.append(element('div', 'card-name', item.name), element('div', 'card-size'), element('div', 'card-target'), element('div', 'card-source', t(item.source === 'local' ? 'assets.local' : 'assets.imported')));
    card.append(check, thumb, body); updateCard(item, card); fragment.append(card);
  }
  $('library').replaceChildren(fragment); updateCounts();
}
function repaintItem(item) { for (const card of $('library').children) if (card.dataset.id === item.id) updateCard(item, card); }
function updateTargets() {
  updateEngineHint();
  for (const card of $('library').children) { const item = state.items.get(card.dataset.id); if (item) updateCard(item, card); }
  queueTargetPlans();
}
function cancelTargetPlans() { clearTimeout(planTimer); planController?.abort(); planGeneration++; planRequestKey = ''; }
function queueTargetPlans() {
  if (!state.engine || state.busy) return;
  const settings = { ...options(), format: $('format').value }, settingsKey = JSON.stringify(settings);
  const images = [...state.items.values()].filter(item => item.width && item.height).map(({ id, width, height }) => ({ id, width, height }));
  const requestKey = JSON.stringify({ settings, images });
  if (requestKey === planRequestKey) return;
  cancelTargetPlans(); planRequestKey = requestKey;
  if (!images.length) return;
  const generation = planGeneration;
  planTimer = setTimeout(() => {
    const controller = new AbortController(); planController = controller;
    requestTargetPlans(images, settings, settingsKey, generation, controller).catch(errorReport);
  }, 150);
}
async function requestTargetPlans(images, settings, settingsKey, generation, controller) {
  try {
    const result = await api('plan', { method: 'POST', body: { images, options: settings }, signal: controller.signal });
    if (generation !== planGeneration || controller.signal.aborted) return;
    if (!Array.isArray(result.items)) throw new Error('Invalid image processing response.');
    for (const planned of result.items) {
      const item = state.items.get(planned.id);
      if (!item) continue;
      item.targetPlan = { settingsKey, layout: planned.layout, error: planned.error };
      repaintItem(item);
    }
  } catch (error) {
    if (generation !== planGeneration || controller.signal.aborted) return;
    for (const { id } of images) {
      const item = state.items.get(id);
      if (item) { item.targetPlan = { settingsKey, error: error.message }; repaintItem(item); }
    }
  } finally { if (planController === controller) planController = null; }
}

function setMode(mode) {
  state.mode = mode;
  for (const button of $('modes').children) { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  $('height-field').hidden = !['height', 'exact', 'fit'].includes(mode);
  $('width-field').hidden = !['width', 'exact', 'fit'].includes(mode);
  $('percent-field').hidden = mode !== 'percent'; $('fit-field').hidden = mode !== 'exact';
  $('mode-help').textContent = t(`mode.${mode}.help`);
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
const preferenceIds = ['height', 'width', 'percent', 'fit', 'allow-upscale', 'format', 'collision', 'suffix', 'preserve', 'quality', 'png-optimize', 'palette'];
function remember() {
  const values = { ...savedPreferences, mode: state.mode };
  for (const id of preferenceIds) values[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  try { localStorage.setItem('resize-studio-options', JSON.stringify(values)); } catch {}
}
function formatChanged() { $('quality-field').hidden = $('format').value === 'png'; $('png-optimize-field').hidden = $('format').value !== 'png'; $('palette-field').hidden = $('format').value !== 'png'; remember(); }
function resetDefaults() {
  const defaults = state.engine?.defaults || {};
  $('height').value = defaults.height ?? 120; $('width').value = defaults.width ?? 120;
  $('percent').value = 100; $('fit').value = 'stretch'; $('format').value = 'png'; $('quality').value = 95;
  $('png-optimize').checked = defaults.pngOptimize ?? true;
  $('palette').checked = defaults.palette ?? false; $('allow-upscale').checked = defaults.allowUpscale ?? false;
  setMode(defaults.mode || 'height'); formatChanged(); toast('toast.defaults');
}
function setBusy(busy) {
  state.busy = busy; $('language-select').disabled = busy;
  for (const node of document.querySelectorAll('main button, main input, main select, .image-card input')) node.disabled = busy;
  $('cancel').hidden = !busy; $('cancel').disabled = false; $('cancel').textContent = t('export.cancel'); $('progress').hidden = !busy; updateCounts();
  if (busy) cancelTargetPlans(); else { runThumbnailQueue(); queueTargetPlans(); }
}

async function loadSource(item, signal) {
  return item.source === 'local' ? api(`image?path=${encodeURIComponent(item.relativePath)}&mtime=${item.modified}`, { signal }) : item.file;
}
function queueThumbnail(item) {
  state.thumbnailQueue.push(item);
  runThumbnailQueue();
}
function runThumbnailQueue() {
  while (!state.busy && state.thumbnailWorkers < 3 && state.thumbnailQueue.length) {
    const item = state.thumbnailQueue.shift();
    if (state.items.get(item.id) !== item) continue;
    state.thumbnailWorkers++;
    makeThumbnail(item).catch(error => {
      if (state.items.get(item.id) !== item || error.name === 'AbortError') return;
      item.error = error.message; log('log.fileError', 'error', { name: item.relativePath, error: error.message }); repaintItem(item);
    }).finally(() => { state.thumbnailWorkers--; runThumbnailQueue(); });
  }
}
async function makeThumbnail(item) {
  const controller = new AbortController(); item.thumbnailController = controller;
  try {
    const source = await loadSource(item, controller.signal);
    if (state.items.get(item.id) !== item) return;
    const rendered = await processPreview(source, { mode: 'fit', width: 220, height: 160, allowUpscale: false, pngOptimize: false }, 'png', controller.signal);
    if (state.items.get(item.id) !== item) return;
    item.width = rendered.original.width; item.height = rendered.original.height;
    item.thumbnail = URL.createObjectURL(rendered.blob);
    repaintItem(item); queueTargetPlans();
  } finally { if (item.thumbnailController === controller) delete item.thumbnailController; }
}
function removeItem(item) { item.thumbnailController?.abort(); if (item.thumbnail) URL.revokeObjectURL(item.thumbnail); state.items.delete(item.id); queueTargetPlans(); }

async function refreshLibrary(manual = false) {
  if (!state.config || state.scanning || state.busy || state.importing) return;
  state.scanning = true;
  try {
    const snapshot = await api('library');
    if (state.busy || state.importing) return;
    const changes = reconcileLibrary(state.items, state.config.input, snapshot.files, { autoSelectNew: state.libraryRoot === state.config.input });
    state.libraryRoot = state.config.input;
    for (const item of changes.removed) removeItem(item);
    for (const item of changes.added) queueThumbnail(item);
    if (changes.added.length || changes.removed.length || manual) renderLibrary();
    if (manual) log('log.refreshed', 'neutral', { count: snapshot.files.length });
    else if (changes.added.length || changes.removed.length) log('log.changes', 'neutral', { added: changes.added.length, removed: changes.removed.length });
    if (changes.newCount) { log('log.new', 'success', { count: changes.newCount }); toast('toast.new', { count: changes.newCount }); }
    for (const warning of snapshot.warnings) log('log.warning', 'error', { error: warning });
    $('watch-label').textContent = t(state.config.watch ? 'watch.active' : 'watch.manual');
  } finally { state.scanning = false; }
}
async function saveConfig(input = state.config.input) {
  state.config = await api('config', { method: 'POST', body: { input, output: $('output-path').value.trim(), watch: $('watch').checked } });
  $('input-path').value = state.config.input;
  $('output-hint').textContent = t('output.hint', { path: state.config.output });
  $('watch-label').textContent = t(state.config.watch ? 'watch.active' : 'watch.manual');
}
async function applyInput() {
  if (state.scanning || state.busy || state.importing) { toast('toast.reading'); return; }
  await saveConfig($('input-path').value.trim()); await refreshLibrary(true);
}
async function browse(kind) {
  const button = $(`browse-${kind}`); button.disabled = true; toast('toast.browse');
  try {
    const result = await api('choose-folder', { method: 'POST', body: { initial: $(`${kind}-path`).value || state.config[kind], language: getLanguage() } });
    if (!result.path) return;
    $(`${kind}-path`).value = result.path;
    if (kind === 'input') await applyInput(); else { await saveConfig(); toast('toast.output'); }
  } finally { button.disabled = state.busy; }
}

async function importFiles(entries) {
  if (state.busy || state.importing) { toast('toast.busy'); return; }
  state.importing = true; updateCounts();
  try {
    let added = 0, ignored = 0;
    const addedAt = Date.now();
    for (const { file, relativePath } of entries) {
      if (!supported.test(file.name)) { ignored++; continue; }
      const relative = relativePath || file.webkitRelativePath || file.name;
      const id = `drop:${relative}:${file.size}:${file.lastModified}`;
      if (state.items.has(id)) continue;
      const item = { id, name: file.name, relativePath: relative, file, size: file.size, modified: file.lastModified, source: 'drop', selected: true, addedAt };
      state.items.set(id, item); queueThumbnail(item); added++;
    }
    renderLibrary(); log('log.imported', 'neutral', { count: added, ignored }); toast('toast.added', { count: added });
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

function clearPreview() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = []; previewPresentation = null;
}
function updatePreviewLabels() {
  if (!previewPresentation) return;
  const { originalTitle, resultTitle, originalImage, resultImage, optimization, processing } = previewPresentation;
  originalTitle.textContent = t('preview.original'); resultTitle.textContent = t('preview.result');
  originalImage.alt = t('preview.original'); resultImage.alt = t('preview.alt');
  $('preview-note').textContent = t($('preview-scale').value === 'actual' ? 'preview.actualNote' : 'preview.note') + (processing ? ' ' + processingText(processing) : '') + (optimization ? ' ' + optimizationText(optimization) : '');
}
function applyPreviewScale() {
  previewPresentation?.resultContainer.classList.toggle('actual-size', $('preview-scale').value === 'actual');
  updatePreviewLabels();
}
async function preview(item) {
  if (state.busy) return;
  requireEngine();
  previewController?.abort();
  clearPreview();
  const controller = new AbortController(); previewController = controller;
  const settings = options(), format = $('format').value;
  $('preview-name').removeAttribute('data-i18n'); $('preview-name').textContent = item.relativePath; $('preview-content').replaceChildren(); $('preview-note').textContent = t('preview.preparing');
  if (!$('preview').open) $('preview').showModal();
  const urls = [];
  try {
    const source = await loadSource(item, controller.signal);
    if (controller.signal.aborted) return;
    const rendered = await processPreview(source, settings, format, controller.signal);
    if (controller.signal.aborted || !$('preview').open) return;
    const original = element('div', 'preview-box'), originalTitle = element('h3'); original.append(originalTitle);
    const originalContainer = element('div', 'preview-image');
    const originalImage = element('img'); originalImage.src = URL.createObjectURL(source); urls.push(originalImage.src); originalContainer.append(originalImage);
    original.append(originalContainer, element('p', '', `${rendered.original.width} × ${rendered.original.height} px · ${bytes(item.size)}`));
    const result = element('div', 'preview-box'), resultTitle = element('h3'); result.append(resultTitle);
    const resultContainer = element('div', 'preview-image');
    // Display the original bytes and the final Python-encoded result directly.
    const resultImage = element('img'); resultImage.src = URL.createObjectURL(rendered.blob); urls.push(resultImage.src);
    await Promise.all([originalImage.decode(), resultImage.decode()]);
    if (controller.signal.aborted || !$('preview').open) return;
    resultContainer.append(resultImage);
    result.append(resultContainer, element('p', '', `${rendered.layout.width} × ${rendered.layout.height} px · ${bytes(rendered.blob.size)}`));
    previewUrls = urls.splice(0);
    previewPresentation = { originalTitle, resultTitle, originalImage, resultImage, resultContainer, optimization: rendered.optimization, processing: rendered.processing };
    $('preview-content').replaceChildren(original, result); applyPreviewScale();
  } catch (error) { if (!controller.signal.aborted) $('preview-note').textContent = errorText(error); }
  finally { for (const url of urls) URL.revokeObjectURL(url); if (previewController === controller) previewController = null; }
}

async function exportSelected() {
  const items = selectedItems(); if (!items.length || state.busy) return;
  requireEngine();
  const settings = options(); const format = $('format').value;
  const suffix = $('suffix').value; const preserve = $('preserve').checked; const collision = $('collision').value;
  const controller = new AbortController(); exportController = controller;
  state.cancelled = false; setBusy(true); let saved = 0, skipped = 0, failed = 0, attempted = 0, savedBytes = 0;
  $('progress').max = items.length; $('progress').value = 0; progressMessage('export.preparing');
  try {
    // Persist the explicit output path before any file is written.
    await saveConfig();
    log('log.exportStart', 'neutral', { count: items.length, path: state.config.output });
    for (const item of items) {
      if (state.cancelled || !state.engine) break;
      attempted++;
      $('progress-label').textContent = `${attempted} / ${items.length} · ${item.relativePath}`;
      try {
        const source = await loadSource(item, controller.signal);
        if (state.cancelled) { attempted--; break; }
        progressMessage('export.processing', { position: attempted, total: items.length, name: item.relativePath });
        const result = await api(`export?sourceName=${encodeURIComponent(item.relativePath)}&suffix=${encodeURIComponent(suffix)}&preserve=${preserve}&collision=${encodeURIComponent(collision)}&options=${encodeURIComponent(JSON.stringify({ ...settings, format }))}`, { method: 'POST', body: source, raw: true, signal: controller.signal });
        if (result.status === 'skipped') { skipped++; log('log.skipped', 'neutral', { path: result.path }); }
        else {
          if (!result.layout?.width || !result.layout?.height) throw new Error('Invalid image processing response.');
          saved++; log('log.saved', 'success', { width: result.layout.width, height: result.layout.height, size: bytes(result.size), path: result.path });
          if (result.processing) log('log.processing', 'neutral', { name: item.relativePath, processing: { engine: result.processing.engine, resample: result.processing.resample, palette: result.processing.palette } });
          if (result.optimization) {
            savedBytes += result.optimization.savedBytes;
            // Keep only numeric metadata in activity, never hold full image Blobs.
            const { status, originalBytes, optimizedBytes, savedBytes: saving } = result.optimization;
            log('log.png', status === 'optimized' ? 'success' : 'neutral', { name: item.relativePath, optimization: { status, originalBytes, optimizedBytes, savedBytes: saving } });
          }
        }
        item.error = ''; repaintItem(item);
      } catch (error) {
        if (controller.signal.aborted) { attempted--; break; }
        failed++; item.error = error.message; repaintItem(item); log('log.fileError', 'error', { name: item.relativePath, error: error.message });
      }
      $('progress').value = attempted;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const key = state.cancelled || !state.engine ? 'export.stopped' : 'export.complete';
    const params = { saved, skipped, failed, remaining: items.length - attempted };
    progressMessage(key, params); log(key, failed ? 'error' : 'success', params); toast(key, params);
    if (format === 'png' && settings.pngOptimize) log('png.batch', 'neutral', { saved: bytes(savedBytes) });
  } finally { exportController = null; setBusy(false); }
}

for (const mode of MODES) {
  const button = element('button', 'mode-button'); button.type = 'button'; button.dataset.mode = mode.id;
  const text = element('div'); text.append(element('strong', '', t(`mode.${mode.id}.title`)), element('small', '', t(`mode.${mode.id}.description`))); button.append(element('span', 'mode-icon', mode.icon), text);
  button.addEventListener('click', () => setMode(mode.id)); $('modes').append(button);
}
try {
  const stored = JSON.parse(localStorage.getItem('resize-studio-options') || '{}');
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    // The retired sampling toggle must not survive an upgrade; keep other settings.
    delete stored.nearest; savedPreferences = stored;
    for (const id of preferenceIds) if (stored[id] !== undefined) { if ($(id).type === 'checkbox') $(id).checked = stored[id]; else $(id).value = stored[id]; }
    if (MODES.some(mode => mode.id === stored.mode)) state.mode = stored.mode;
  }
} catch {}
setMode(state.mode); formatChanged(); updateCounts();
for (const id of preferenceIds) on(id, 'input', () => { remember(); updateTargets(); if (id === 'format') formatChanged(); });
on('search', 'input', renderLibrary);
on('reset-defaults', 'click', resetDefaults);
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
      progressMessage('folder.reading'); files = [];
      for (const entry of entries) files.push(...await collectEntry(entry));
    }
    state.importing = false;
    await importFiles(files); lastProgress = null; $('progress-label').textContent = '';
  })().catch(errorReport).finally(() => { state.importing = false; updateCounts(); });
});
// Prevent accidental browser navigation if a file is dropped just outside the drop area.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
on('apply-input', 'click', applyInput);
on('input-path', 'keydown', event => { if (event.key === 'Enter') return applyInput(); });
on('output-path', 'change', async () => { await saveConfig(); toast('toast.output'); });
on('watch', 'change', () => saveConfig());
on('refresh', 'click', () => refreshLibrary(true));
on('browse-input', 'click', () => browse('input')); on('browse-output', 'click', () => browse('output'));
on('export', 'click', exportSelected);
on('cancel', 'click', () => { state.cancelled = true; exportController?.abort(); $('cancel').disabled = true; $('cancel').textContent = t('export.stopping'); });
on('open-output', 'click', async () => { await saveConfig(); await api('open-output', { method: 'POST' }); });
on('clear-log', 'click', () => $('log').replaceChildren());
on('close-preview', 'click', () => $('preview').close());
on('preview-scale', 'change', applyPreviewScale);
on('preview', 'close', () => { previewController?.abort(); clearPreview(); });
window.addEventListener('beforeunload', () => { previewController?.abort(); exportController?.abort(); cancelTargetPlans(); clearPreview(); for (const item of state.items.values()) item.thumbnailController?.abort(); });
on('preview', 'click', event => { if (event.target === $('preview')) { const rect = $('preview').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('preview').close(); } });

window.addEventListener('resize-language-change', () => {
  for (const button of $('modes').children) {
    button.querySelector('strong').textContent = t(`mode.${button.dataset.mode}.title`);
    button.querySelector('small').textContent = t(`mode.${button.dataset.mode}.description`);
  }
  $('mode-help').textContent = t(`mode.${state.mode}.help`); updateEngineHint(); renderLibrary();
  if (state.config) {
    $('output-hint').textContent = t('output.hint', { path: state.config.output });
    $('watch-label').textContent = t(state.config.watch ? 'watch.active' : 'watch.manual');
  }
  for (const row of $('log').children) if (row.message) renderLog(row);
  if (lastToast) $('toast').textContent = messageText(lastToast);
  if (lastProgress) $('progress-label').textContent = messageText(lastProgress);
  updatePreviewLabels();
});

async function initialize() {
  try {
    const engine = await api('engine');
    if (engine.protocol !== Number(protocol) || engine.engine !== 'pillow' || !engine.buildId || engine.upToDate === false) throw incompatibleEngine();
    state.engine = engine; state.engineError = ''; updateEngineHint();
  } catch (error) {
    state.engine = null;
    if (!state.engineError) state.engineError = error.status === 404 ? 'The image processing service is incompatible. Restart Resize Studio and reload this page.' : 'Cannot connect to the image processing service. Restart Resize Studio and reload this page.';
    updateEngineHint(); updateCounts();
    throw new Error(state.engineError);
  }
  state.config = await api('config'); $('input-path').value = state.config.input; $('output-path').value = state.config.output; $('watch').checked = state.config.watch;
  $('output-hint').textContent = t('output.hint', { path: state.config.output });
  await refreshLibrary(true); updateCounts();
  setInterval(() => { if (state.config.watch) refreshLibrary().catch(error => { $('watch-label').textContent = t('watch.failed'); console.warn(error.message); }); }, 3000);
}
initialize().catch(errorReport);
