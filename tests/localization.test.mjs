import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { File } from 'node:buffer';
import { MODES } from '../public/resize.mjs';
import { compareAssets } from '../public/library.mjs';

const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [html, i18n, theme, app, resize, server, processor, python] = await Promise.all(['public/index.html', 'public/i18n.js', 'public/theme.js', 'public/app.js', 'public/resize.mjs', 'server.mjs', 'image-processor.mjs', 'python/process_image.py'].map(read));

// A small DOM stub tests actual presentation scripts without launching a browser
// or decoding images. These checks do not validate Pillow output or visual layout.
class Node {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag; this.attributes = attrs; this.children = []; this.dataset = {}; this.listeners = {};
    this.value = attrs.value || ''; this.type = attrs.type || ''; this.checked = 'checked' in attrs;
    this.hidden = 'hidden' in attrs; this.className = attrs.class || ''; this.content = attrs.content;
    const classes = () => new Set(this.className.split(' ').filter(Boolean));
    this.classList = {
      toggle: (name, enabled) => { const values = classes(); if (enabled ?? !values.has(name)) values.add(name); else values.delete(name); this.className = [...values].join(' '); },
      add: name => { const values = classes(); values.add(name); this.className = [...values].join(' '); },
      remove: name => { const values = classes(); values.delete(name); this.className = [...values].join(' '); },
      contains: name => classes().has(name)
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text || ''; }
  append(...nodes) { for (const node of nodes) { if (node.tag === 'fragment') this.append(...node.children); else this.children.push(node); } }
  prepend(node) { this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  removeAttribute(key) { delete this.attributes[key]; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
  async decode() {}
  addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
}
function environment(saved = {}, blockedStorage = false) {
  const store = new Map(Object.entries(saved)), nodes = [], ids = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
    const node = new Node(match[1], attrs); nodes.push(node); if (attrs.id) ids.set(attrs.id, node);
  }
  for (const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>\s*<option value="([^"]+)"/g)) ids.get(match[1]).value = match[2];
  // Only the descendants queried by the standalone theme script are required.
  const label = nodes.find(node => 'data-theme-label' in node.attributes);
  const themeButton = ids.get('theme-toggle'); themeButton.append(label);
  const originalQuery = themeButton.querySelector.bind(themeButton);
  themeButton.querySelector = selector => selector === '[data-theme-label]' ? label : originalQuery(selector);
  const document = new Node();
  document.documentElement = { dataset: {}, lang: '' };
  document.getElementById = id => ids.get(id);
  document.querySelector = () => nodes.find(node => node.attributes.name === 'resize-token');
  document.querySelectorAll = selector => {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
    return attribute ? nodes.filter(node => attribute in node.attributes) : [];
  };
  document.createElement = tag => { assert.notEqual(tag, 'canvas', 'Image processing must not create a browser canvas'); return new Node(tag); };
  document.createDocumentFragment = () => new Node('fragment');
  const window = new Node();
  const context = vm.createContext({ document, window, Event: class { constructor(type) { this.type = type; } }, localStorage: {
    getItem: key => { if (blockedStorage) throw Error('blocked'); return store.get(key); },
    setItem: (key, value) => { if (blockedStorage) throw Error('blocked'); store.set(key, value); }
  }, setTimeout: callback => setTimeout(callback, 0), clearTimeout, setInterval: () => 0, fetch: () => new Promise(() => {}), console, MODES, compareAssets, Blob, AbortController, URL });
  vm.runInContext(i18n, context);
  return { context, document, window, store, ids, label, language: window.ResizeI18n };
}

test('English default, saved Chinese, live text/attribute switching and storage failures', () => {
  const env = environment(); env.document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(env.document.documentElement.lang, 'en');
  assert.equal(env.language.t('pick.files'), 'Choose images');
  assert.equal(env.ids.get('search').getAttribute('placeholder'), 'Search filenames…');
  let changes = 0; env.window.addEventListener('resize-language-change', () => changes++);
  env.ids.get('language-select').dispatchEvent({ type: 'change', target: { value: 'zh' } });
  assert.equal(env.document.documentElement.lang, 'zh-CN');
  assert.equal(env.ids.get('search').getAttribute('aria-label'), '搜索素材');
  assert.equal(env.store.get('resize-studio-language'), 'zh');
  assert.equal(env.language.t('assets.selection', { count: 3, visible: 8 }), '已选择 3 张 / 当前显示 8 张');
  assert.equal(environment(Object.fromEntries(env.store)).language.getLanguage(), 'zh');
  env.language.setLanguage('en');
  assert.equal(env.ids.get('language-select').value, 'en'); assert.equal(changes, 2);
  const blocked = environment({}, true); blocked.document.dispatchEvent({ type: 'DOMContentLoaded' });
  blocked.language.setLanguage('zh'); assert.equal(blocked.language.t('pick.files'), '选择图片');
});

test('theme labels follow language while persisted theme remains independent', () => {
  const env = environment({ 'resize-studio-theme': 'dark' });
  vm.runInContext(theme, env.context); env.document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(env.document.documentElement.dataset.theme, 'dark'); assert.equal(env.label.textContent, 'Light mode');
  env.language.setLanguage('zh'); assert.equal(env.label.textContent, '浅色模式');
  assert.equal(env.ids.get('theme-toggle').getAttribute('aria-label'), '切换到浅色模式');
  env.ids.get('theme-toggle').dispatchEvent({ type: 'click' });
  assert.equal(env.store.get('resize-studio-theme'), 'light');
  env.language.setLanguage('en'); assert.equal(env.label.textContent, 'Dark mode');
  assert.equal(env.document.documentElement.dataset.theme, 'light');
});

test('every referenced label and stable core/API error has both translations', () => {
  const { language } = environment();
  const keys = new Set([...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)].map(m => m[1]));
  for (const code of [app, theme]) for (const match of code.matchAll(/\b(?:t|log|toast|progressMessage)\('([\w.]+)'/g)) keys.add(match[1]);
  for (const mode of MODES) for (const part of ['title', 'description', 'help']) keys.add(`mode.${mode.id}.${part}`);
  for (const lang of ['en', 'zh']) {
    language.setLanguage(lang);
    for (const key of keys) assert.notEqual(language.t(key), key, `Missing ${lang}: ${key}`);
  }
  language.setLanguage('en');
  for (const code of [resize, server, app]) {
    for (const match of code.matchAll(/(?:throw new Error|reject\(new Error)\('([^']+)'\)/g)) assert.doesNotMatch(language.errorText(match[1]), /[\p{Script=Han}]/u, match[1]);
  }
  assert.equal(language.errorText('请求失败 (403)'), 'Request failed (403)');
  language.setLanguage('zh');
  for (const code of [processor, python, server]) {
    for (const match of code.matchAll(/(?:new Error\('([^']+)'|ImageRequestError\("([^"]+)"\))/g)) {
      const message = match[1] || match[2];
      assert.match(language.errorText(message), /[\p{Script=Han}]/u, `Missing Chinese error: ${message}`);
    }
  }
  assert.equal(language.errorText('Python image processing timed out'), 'Python 图片处理超时');
  assert.equal(language.errorText('Image processing failed'), 'Python 图片处理失败');
  assert.equal(language.errorText('Invalid image processing response.'), '图片处理返回数据无效，请重试');
  const file = '人物/hero_small.png'; assert(language.t('log.skipped', { path: file }).includes(file));
});

test('actual app language handler preserves selections/options and retranslates activity/errors', () => {
  const env = environment();
  vm.runInContext(theme, env.context);
  vm.runInContext(app.replace(/^import .*;\r?\n/gm, ''), env.context);
  env.document.dispatchEvent({ type: 'DOMContentLoaded' });
  vm.runInContext(`
    state.config = { input: './input', output: './output', watch: true };
    state.items.set('sample', { id: 'sample', name: '人物.png', relativePath: '角色/人物.png', source: 'local', selected: true, width: 240, height: 240, size: 1024 });
    $('height').value = '108'; $('suffix').value = '_small'; renderLibrary();
    log('log.fileError', 'error', { name: '角色/人物.png', error: '图片无法解码，可能已损坏或格式不支持' });
    log('log.saved', 'success', { width: 108, height: 108, size: '1.0 KB', path: './output/角色/人物.png' });
    progressMessage('export.complete', { saved: 1, skipped: 0, failed: 1 });
  `, env.context);
  const optionsBefore = vm.runInContext('JSON.stringify(options())', env.context);
  env.language.setLanguage('zh');
  assert.equal(vm.runInContext('JSON.stringify(options())', env.context), optionsBefore);
  assert.equal(vm.runInContext("state.items.get('sample').selected", env.context), true);
  assert.equal(env.ids.get('suffix').value, '_small'); assert.equal(env.ids.get('library-count').textContent, '1 张素材');
  assert.match(env.ids.get('log').children[0].textContent, /已保存.*人物\.png/);
  assert.match(env.ids.get('log').children[1].textContent, /图片无法解码/);
  env.language.setLanguage('en');
  assert.match(env.ids.get('log').children[0].textContent, /Saved.*人物\.png/);
  assert.match(env.ids.get('log').children[1].textContent, /Cannot decode/);
  assert.equal(env.ids.get('progress-label').textContent, 'Complete: 1 saved, 0 skipped, 1 failed');
  assert.equal(env.ids.get('modes').children[0].querySelector('strong').textContent, 'By height');
});

test('PNG default survives old preferences; format changes and language keep the saved toggle', () => {
  for (const savedOptions of [{ height: '108' }, { 'png-optimize': false }]) {
    const env = environment({ 'resize-studio-options': JSON.stringify(savedOptions) });
    vm.runInContext(app.replace(/^import .*;\r?\n/gm, ''), env.context);
    env.document.dispatchEvent({ type: 'DOMContentLoaded' });
    assert.equal(env.ids.get('png-optimize').checked, savedOptions['png-optimize'] !== false);
    assert.equal(env.ids.get('png-optimize-field').hidden, false);
    env.ids.get('format').value = 'jpeg'; vm.runInContext('formatChanged()', env.context);
    assert.equal(env.ids.get('png-optimize-field').hidden, true);
    env.ids.get('png-optimize').checked = false; vm.runInContext('remember()', env.context);
    env.ids.get('format').value = 'png'; vm.runInContext('formatChanged()', env.context);
    env.language.setLanguage('zh');
    assert.equal(env.ids.get('png-optimize-field').hidden, false); assert.equal(env.ids.get('png-optimize').checked, false);
    assert.equal(JSON.parse(env.store.get('resize-studio-options'))['png-optimize'], false);
  }
});


function runApp(env, ready = true) {
  vm.runInContext(app.replace(/^import .*;\r?\n/gm, ''), env.context);
  env.document.dispatchEvent({ type: 'DOMContentLoaded' });
  if (ready) vm.runInContext("state.config = { input: './input', output: './output', watch: true }; state.engine = { protocol: 2, engine: 'pillow', buildId: 'test-build', defaults: { mode: 'height', height: 120, pngOptimize: true, palette: false } }; updateCounts(); updateEngineHint()", env.context);
}
const response = (body, { status = 200, metadata, protocol = '2' } = {}) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, blob: async () => body,
  headers: { get: key => key === 'X-Resize-Protocol' ? protocol : key === 'X-Resize-Result' && metadata ? JSON.stringify(metadata) : null }
});

test('batch uploads original files to Python and records only successful export metadata', async () => {
  for (const scenario of ['optimized', 'failed', 'off', 'jpeg', 'skip', 'cancel', 'fileFailure']) {
    const env = environment({ 'resize-studio-options': JSON.stringify({ nearest: true }) }), requests = [];
    const original = new File(['original image bytes'], '人物.png', { type: 'image/png' });
    const optimization = { status: scenario === 'failed' ? 'failed' : 'optimized', originalBytes: 1000, optimizedBytes: scenario === 'failed' ? 1000 : 700, savedBytes: scenario === 'failed' ? 0 : 300 };
    runApp(env);
    env.context.original = original;
    env.context.fetch = async (route, request) => {
      if (route === '/api/config') return response({ input: './input', output: './output', watch: true });
      if (route.startsWith('/api/export?')) {
        requests.push({ route, ...request });
        assert.strictEqual(request.body, original, 'Original File is uploaded unchanged');
        assert(request.signal instanceof AbortSignal);
        assert.equal(request.headers['X-Resize-Token'], '__RESIZE_TOKEN__');
        assert.equal(request.headers['X-Resize-Protocol'], '2');
        const query = new URL(route, 'http://localhost').searchParams;
        assert.equal(query.get('sourceName'), requests.length === 2 ? '下一张.png' : '人物.png');
        assert.equal(query.get('preserve'), 'true'); assert.equal(query.has('name'), false);
        if (scenario === 'cancel') {
          vm.runInContext('state.cancelled = true; exportController.abort()', env.context);
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        if (scenario === 'fileFailure' && requests.length === 1) return response({ error: 'Python image processing failed' }, { status: 422 });
        return response({ status: scenario === 'skip' ? 'skipped' : 'saved', size: 700, path: './output/人物.png', layout: { width: 108, height: 108 }, processing: { engine: 'pillow', resample: 'LANCZOS', palette: false }, ...(scenario === 'off' || scenario === 'jpeg' ? {} : { optimization }) });
      }
      throw Error('Unexpected route: ' + route);
    };
    env.ids.get('png-optimize').checked = scenario !== 'off';
    env.ids.get('format').value = scenario === 'jpeg' ? 'jpeg' : 'png';
    vm.runInContext("state.items.set('sample', { id: 'sample', name: '人物.png', relativePath: '人物.png', file: original, source: 'drop', selected: true })", env.context);
    if (scenario === 'fileFailure') vm.runInContext("state.items.set('second', { id: 'second', name: '下一张.png', relativePath: '下一张.png', file: original, source: 'drop', selected: true })", env.context);
    await vm.runInContext('exportSelected()', env.context);
    assert.equal(requests.length, scenario === 'fileFailure' ? 2 : 1);
    const options = JSON.parse(new URL(requests[0].route, 'http://localhost').searchParams.get('options'));
    assert.equal(options.pngOptimize, scenario !== 'off');
    assert.equal(options.format, scenario === 'jpeg' ? 'jpeg' : 'png');
    assert.equal(options.palette, false);
    assert.equal(Object.hasOwn(options, 'nearest'), false, 'Export must not send a sampling toggle');
    const optimizationRows = env.ids.get('log').children.filter(row => row.message?.key === 'log.png');
    if (['optimized', 'failed', 'fileFailure'].includes(scenario)) {
      assert.equal(optimizationRows.length, 1);
      assert.deepEqual(Object.keys(optimizationRows[0].message.params.optimization).sort(), ['optimizedBytes', 'originalBytes', 'savedBytes', 'status']);
      env.language.setLanguage('zh');
      assert.match(optimizationRows[0].textContent, scenario === 'failed' ? /保留基础 PNG/ : /节省/);
    } else assert.equal(optimizationRows.length, 0);
    env.language.setLanguage('en');
    if (scenario === 'cancel') assert.match(env.ids.get('progress-label').textContent, /0 saved, 0 skipped, 0 failed, 1 remaining/);
    if (scenario === 'skip') assert.match(env.ids.get('log').children[0].textContent, /saved 0\.0 KB/);
    if (scenario === 'fileFailure') assert.match(env.ids.get('progress-label').textContent, /1 saved, 0 skipped, 1 failed/);
    if (!['skip', 'cancel'].includes(scenario)) assert(env.ids.get('log').children.some(row => row.message?.key === 'log.processing' && row.textContent.includes('LANCZOS')));
    assert.equal(vm.runInContext('state.busy', env.context), false);
  }
});

test('preview and thumbnails upload original bytes and display Python dimensions without Canvas', async () => {
  const env = environment({ 'resize-studio-options': JSON.stringify({ nearest: true }) }), requests = [];
  runApp(env);
  const original = new File(['original bytes'], '原图.png', { type: 'image/png' });
  const encoded = new Blob(['Python PNG output'], { type: 'image/png' });
  const metadata = { original: { width: 1254, height: 1254 }, layout: { width: 120, height: 120 }, format: 'png', processing: { engine: 'pillow', resample: 'LANCZOS', palette: true }, optimization: { status: 'original', savedBytes: 0 } };
  env.context.original = original;
  env.context.fetch = async (route, request) => {
    requests.push({ route, ...request });
    assert(route.startsWith('/api/preview?'));
    assert.strictEqual(request.body, original);
    assert(request.signal instanceof AbortSignal);
    return response(encoded, { metadata });
  };
  vm.runInContext("state.items.set('sample', { id: 'sample', name: '原图.png', relativePath: '原图.png', file: original, size: original.size, source: 'drop', selected: true })", env.context);
  await vm.runInContext("makeThumbnail(state.items.get('sample'))", env.context);
  assert.equal(vm.runInContext("state.items.get('sample').width", env.context), 1254);
  const thumbnailOptions = JSON.parse(new URL(requests[0].route, 'http://localhost').searchParams.get('options'));
  assert.deepEqual(thumbnailOptions, { mode: 'fit', width: 220, height: 160, allowUpscale: false, pngOptimize: false, format: 'png' });
  await vm.runInContext("preview(state.items.get('sample'))", env.context);
  assert.equal(requests.length, 2);
  assert.equal(Object.hasOwn(JSON.parse(new URL(requests[1].route, 'http://localhost').searchParams.get('options')), 'nearest'), false, 'Preview must not send a sampling toggle');
  assert.equal(env.ids.get('preview-content').children.length, 2);
  assert.equal(env.ids.get('preview-content').children[0].querySelector('p').textContent, '1254 × 1254 px · 0.0 KB');
  assert.equal(env.ids.get('preview-content').children[1].querySelector('p').textContent, '120 × 120 px · 0.0 KB');
  const resultContainer = env.ids.get('preview-content').children[1].querySelector('.preview-image');
  assert(resultContainer.classList.contains('actual-size'));
  const originalUrl = env.ids.get('preview-content').children[1].querySelector('img').src;
  env.ids.get('preview-scale').value = 'fit'; vm.runInContext('applyPreviewScale()', env.context);
  assert.equal(resultContainer.classList.contains('actual-size'), false);
  assert.equal(env.ids.get('preview-content').children[1].querySelector('img').src, originalUrl);
  assert.equal(requests.length, 2, 'Display scale must not process the image again');
  assert.match(env.ids.get('preview-note').textContent, /LANCZOS.*256-color palette.*original encoding/);
  env.language.setLanguage('zh');
  assert.equal(env.ids.get('preview-content').children[1].querySelector('h3').textContent, '处理后');
  assert.equal(env.ids.get('preview-content').children[1].querySelector('img').alt, '处理后预览');
  vm.runInContext("clearPreview(); removeItem(state.items.get('sample')); cancelTargetPlans()", env.context);
});

test('closing a preview cancels the backend request and invalid metadata is reported', async () => {
  const env = environment(); runApp(env);
  env.context.original = new File(['original bytes'], '原图.png');
  let requestSignal;
  env.context.fetch = async (_route, request) => {
    requestSignal = request.signal;
    vm.runInContext('previewController.abort()', env.context);
    throw new DOMException('The operation was aborted.', 'AbortError');
  };
  vm.runInContext("state.items.set('sample', { id: 'sample', name: '原图.png', relativePath: '原图.png', file: original, source: 'drop', selected: true })", env.context);
  await vm.runInContext("preview(state.items.get('sample'))", env.context);
  assert(requestSignal.aborted);
  assert.equal(env.ids.get('preview-content').children.length, 0);
  env.context.fetch = async () => response(new Blob(['png']), { metadata: {} });
  await vm.runInContext("preview(state.items.get('sample'))", env.context);
  assert.equal(env.ids.get('preview-note').textContent, 'Invalid image processing response.');
});


const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('retired nearest preference is removed while other saved settings, language, theme and selections survive', () => {
  const savedOptions = { nearest: true, mode: 'height', height: '300', width: '240', percent: '80', fit: 'contain', 'allow-upscale': true, format: 'webp', palette: true, suffix: '_keep', collision: 'skip', preserve: false, quality: '83', 'png-optimize': false, extraPreference: { keep: true } };
  const env = environment({ 'resize-studio-options': JSON.stringify(savedOptions), 'resize-studio-language': 'zh', 'resize-studio-theme': 'dark' });
  runApp(env);
  vm.runInContext("state.items.set('sample', { id: 'sample', name: '原图.png', relativePath: '原图.png', source: 'drop', selected: true }); $('input-path').value = './素材'; $('output-path').value = './导出'; updateEngineHint()", env.context);
  const { nearest, ...expectedOptions } = savedOptions;
  assert.equal(nearest, true);
  assert.deepEqual(JSON.parse(env.store.get('resize-studio-options')), expectedOptions);
  assert.equal(env.ids.has('nearest'), false);
  assert.equal(vm.runInContext("Object.hasOwn(options(), 'nearest')", env.context), false);
  assert.equal(env.ids.get('height').value, '300');
  assert.equal(env.ids.get('format').value, 'webp');
  assert.equal(env.ids.get('palette').checked, true);
  assert.match(env.ids.get('engine-hint').textContent, /LANCZOS/);
  env.language.setLanguage('en');
  assert.deepEqual(JSON.parse(env.store.get('resize-studio-options')), expectedOptions);
  vm.runInContext('resetDefaults()', env.context);
  assert.equal(Object.hasOwn(JSON.parse(env.store.get('resize-studio-options')), 'nearest'), false);
  assert.deepEqual(JSON.parse(env.store.get('resize-studio-options')).extraPreference, { keep: true });
  assert.equal(env.ids.get('palette').checked, false);
  assert.equal(Number(env.ids.get('height').value), 120);
  assert.equal(env.ids.get('format').value, 'png');
  assert.equal(env.ids.get('suffix').value, '_keep');
  assert.equal(env.ids.get('input-path').value, './素材');
  assert.equal(env.ids.get('output-path').value, './导出');
  assert.equal(vm.runInContext("state.items.get('sample').selected", env.context), true);
  assert.equal(env.language.getLanguage(), 'en');
  assert.equal(env.store.get('resize-studio-theme'), 'dark');
  assert.match(env.ids.get('engine-hint').textContent, /LANCZOS/);
});

test('unknown, old, or stale services disable export before any image upload', async () => {
  for (const scenario of ['missing', 'old', 'stale']) {
    const env = environment(), requests = [];
    env.context.fetch = async (route, request) => {
      requests.push({ route, request });
      if (scenario === 'missing') return response({ error: '接口不存在' }, { status: 404, protocol: null });
      return response({ protocol: scenario === 'old' ? 1 : 2, engine: 'pillow', buildId: 'test-build', upToDate: scenario !== 'stale' });
    };
    runApp(env, false);
    await tick();
    vm.runInContext("state.items.set('sample', { id: 'sample', name: '原图.png', relativePath: '原图.png', size: 1000, selected: true, file: new Blob(['original']) }); updateCounts()", env.context);
    assert.equal(env.ids.get('export').disabled, true);
    assert.match(env.ids.get('engine-hint').textContent, /incompatible/);
    await assert.rejects(vm.runInContext('exportSelected()', env.context), /incompatible/);
    assert.deepEqual(requests.map(request => request.route), ['/api/engine']);
    env.language.setLanguage('zh');
    assert.match(env.ids.get('engine-hint').textContent, /版本不兼容/);
  }
});

test('processing requires the protocol response header and disables a mismatched service', async () => {
  const env = environment(); runApp(env);
  env.context.fetch = async () => response(new Blob(['bytes']), { protocol: null, metadata: { original: { width: 10, height: 10 }, layout: { width: 5, height: 5 } } });
  await assert.rejects(vm.runInContext("processPreview(new Blob(['original']), options(), 'png')", env.context), /incompatible/);
  assert.equal(vm.runInContext('state.engine', env.context), null);
  assert.equal(env.ids.get('export').disabled, true);
});

test('backend target planning batches assets, ignores stale replies and does not rerun on language changes', async () => {
  const env = environment({ 'resize-studio-options': JSON.stringify({ nearest: true }) }), plans = [];
  runApp(env);
  env.context.fetch = (route, request) => {
    assert.equal(route, '/api/plan');
    assert.equal(request.headers['X-Resize-Protocol'], '2');
    return new Promise(resolve => plans.push({ request, resolve }));
  };
  vm.runInContext("state.items.set('sample', { id: 'sample', name: '原图.png', relativePath: '原图.png', width: 1254, height: 1254, size: 1000, selected: true }); state.items.set('second', { id: 'second', name: '另一张.png', relativePath: '另一张.png', width: 320, height: 240, size: 1000, selected: true }); renderLibrary(); $('height').value = '150'; updateTargets()", env.context);
  await tick();
  assert.equal(plans.length, 1);
  assert.equal(JSON.parse(plans[0].request.body).images.length, 2);
  assert.equal(Object.hasOwn(JSON.parse(plans[0].request.body).options, 'nearest'), false, 'Plans must not send a sampling toggle');
  vm.runInContext("$('height').value = '100'; updateTargets()", env.context);
  await tick();
  assert.equal(plans.length, 2);
  assert(plans[0].request.signal.aborted);
  plans[1].resolve(response({ items: [{ id: 'sample', layout: { width: 100, height: 100 } }, { id: 'second', error: 'Target requires upscaling; enable Allow upscaling or reduce dimensions' }] }));
  await tick();
  assert.equal(vm.runInContext("state.items.get('sample').targetPlan.layout.width", env.context), 100);
  plans[0].resolve(response({ items: [{ id: 'sample', layout: { width: 150, height: 150 } }] }));
  await tick();
  assert.equal(vm.runInContext("state.items.get('sample').targetPlan.layout.width", env.context), 100);
  env.language.setLanguage('zh');
  await tick();
  assert.equal(plans.length, 2);
  const plannedCard = env.ids.get('library').children.find(card => card.dataset.id === 'sample');
  assert.equal(plannedCard.querySelector('.card-target').textContent, '→ 100 × 100 px');
  const failedCard = env.ids.get('library').children.find(card => card.dataset.id === 'second');
  assert.match(failedCard.querySelector('.card-target').textContent, /允许放大/);
  vm.runInContext('cancelTargetPlans()', env.context);
});
