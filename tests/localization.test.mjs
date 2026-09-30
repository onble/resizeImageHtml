import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { MODES, geometry } from '../public/resize.mjs';
import { compareAssets } from '../public/library.mjs';

const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [html, i18n, theme, app, resize, server] = await Promise.all(['public/index.html', 'public/i18n.js', 'public/theme.js', 'public/app.js', 'public/resize.mjs', 'server.mjs'].map(read));

// A small DOM stub tests actual presentation scripts without launching a browser
// or decoding images. These checks do not validate Canvas output or visual layout.
class Node {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag; this.attributes = attrs; this.children = []; this.dataset = {}; this.listeners = {};
    this.value = attrs.value || ''; this.type = attrs.type || ''; this.checked = 'checked' in attrs;
    this.hidden = 'hidden' in attrs; this.className = attrs.class || ''; this.content = attrs.content;
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {} };
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
  document.createElement = tag => new Node(tag);
  document.createDocumentFragment = () => new Node('fragment');
  const window = new Node();
  const context = vm.createContext({ document, window, Event: class { constructor(type) { this.type = type; } }, localStorage: {
    getItem: key => { if (blockedStorage) throw Error('blocked'); return store.get(key); },
    setItem: (key, value) => { if (blockedStorage) throw Error('blocked'); store.set(key, value); }
  }, setTimeout: () => 1, clearTimeout: () => {}, fetch: () => new Promise(() => {}), console, MODES, geometry, compareAssets });
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
  assert.equal(language.errorText('当前浏览器不支持 webp 导出'), 'This browser does not support webp export.');
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
