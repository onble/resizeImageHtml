import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { geometry, outputName } from '../public/resize.mjs';
import { safeRelative, saveImage, scanLibrary, createApp } from '../server.mjs';
import { compareAssets, reconcileLibrary } from '../public/library.mjs';

test('比例计算、Python .5 取整及固定画布的留白与裁切', () => {
  assert.deepEqual([geometry(120, 600, { mode: 'height', height: 300 }).width, geometry(120, 600, { mode: 'height', height: 300 }).height], [60, 300]);
  assert.equal(geometry(5, 10, { mode: 'height', height: 5 }).width, 2);
  assert.equal(geometry(7, 10, { mode: 'height', height: 5 }).width, 4);
  const contain = geometry(240, 120, { mode: 'exact', width: 108, height: 108, fit: 'contain' });
  assert.deepEqual([contain.width, contain.height, contain.drawWidth, contain.drawHeight, contain.x, contain.y], [108, 108, 108, 54, 0, 27]);
  const cover = geometry(240, 120, { mode: 'exact', width: 108, height: 108, fit: 'cover' });
  assert.deepEqual([cover.drawWidth, cover.drawHeight, cover.x], [216, 108, -54]);
  const percent = geometry(500, 100, { mode: 'percent', percent: 80 });
  assert.deepEqual([percent.width, percent.height], [400, 80]);
  const fit = geometry(240, 120, { mode: 'fit', width: 100, height: 100 });
  assert.deepEqual([fit.width, fit.height], [100, 50]);
  assert.equal(geometry(20, 10, { mode: 'fit', width: 100, height: 100 }).width, 20);
});

test('异常参数被拒绝，格式转换和相对子目录保留', () => {
  assert.throws(() => geometry(100, 100, { mode: 'height', height: 0 }), /大于/);
  assert.throws(() => geometry(100, 100, { mode: 'height', height: 200 }), /放大/);
  assert.throws(() => geometry(100, 100, { mode: 'exact', width: 20000, height: 20000, fit: 'stretch', allowUpscale: true }), /过大/);
  assert.equal(outputName('目录/图层 1.bmp', 'png', '_small'), '目录/图层 1_small.png');
  assert.equal(outputName('目录/图层 1.png', 'jpeg', '', false), '图层 1.jpg');
  for (const value of ['../escape.png', 'D:/escape.png', '/escape.png', 'nul.png', 'folder/../escape.png', 'folder\\..\\escape.png']) assert.throws(() => safeRelative(value));
});

test('真实目录扫描、输出冲突处理、源文件保护和本地接口访问限制', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(path.join(input, 'nested'), { recursive: true });
  await fs.writeFile(path.join(input, 'nested', '素材.png'), Buffer.from('original'));
  await fs.writeFile(path.join(input, 'nested', '素材.png.meta'), 'metadata');
  await fs.writeFile(path.join(input, 'readme.txt'), 'ignored');
  const library = await scanLibrary(input);
  assert.equal(library.files.length, 1);
  assert.equal(library.files[0].relativePath, 'nested/素材.png');
  const result = await saveImage(output, 'nested/素材.png', Buffer.from('new'), 'rename', input);
  assert.equal(result.status, 'saved');
  const duplicate = await saveImage(output, 'nested/素材.png', Buffer.from('other'), 'rename', input);
  assert.match(duplicate.path, /素材_1\.png$/);
  assert.equal((await saveImage(output, 'nested/素材.png', Buffer.from('ignored'), 'skip', input)).status, 'skipped');
  assert.equal((await fs.readFile(result.path)).toString(), 'new');
  await saveImage(output, 'nested/素材.png', Buffer.from('replacement'), 'overwrite', input);
  assert.equal((await fs.readFile(result.path)).toString(), 'replacement');
  await assert.rejects(saveImage(input, 'nested/素材.png', Buffer.from('bad'), 'overwrite', input), /保留原图/);
  await assert.rejects(saveImage(output, '../escape.png', Buffer.from('bad')), /路径不合法/);
  assert.equal((await fs.readFile(path.join(input, 'nested', '素材.png'))).toString(), 'original');
  const server = await createApp({ input, output, persist: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  assert.match(html, /<html lang="en">/);
  assert(html.indexOf('/i18n.js') < html.indexOf('/theme.js'));
  const languageScript = await fetch(`${base}/i18n.js`);
  assert.equal(languageScript.status, 200);
  assert.match(languageScript.headers.get('content-type'), /text\/javascript/);
  assert.match(await languageScript.text(), /resize-studio-language/);
  const wasm = await fetch(`${base}/vendor/oxipng/squoosh_oxipng_bg.wasm`);
  assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).subarray(0, 4)], [0, 97, 115, 109]);
  assert.match(wasm.headers.get('content-security-policy'), /'wasm-unsafe-eval'/);
  assert.match(wasm.headers.get('content-security-policy'), /worker-src 'self'/);
  assert.doesNotMatch(wasm.headers.get('content-security-policy'), /'unsafe-eval'/);
  for (const route of ['png-optimizer.mjs', 'png-worker.mjs', 'vendor/oxipng/squoosh_oxipng.js']) {
    const response = await fetch(`${base}/${route}`); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/javascript/);
  }
  assert.equal((await fetch(`${base}/vendor/oxipng/unknown.js`)).status, 404);
  const token = html.match(/name="resize-token" content="([^"]+)"/)[1];
  assert.equal((await fetch(`${base}/api/config`)).status, 403);
  assert.equal((await fetch(`${base}/api/config`, { headers: { 'X-Resize-Token': token, Origin: 'https://example.com' } })).status, 403);
  const headers = { 'X-Resize-Token': token };
  assert.equal((await (await fetch(`${base}/api/library`, { headers })).json()).files.length, 1);
  assert.equal((await fetch(`${base}/api/image?path=..%2Fescape.png`, { headers })).status, 400);
  const exported = await (await fetch(`${base}/api/export?name=api.png`, { method: 'POST', headers, body: Buffer.from('api-bytes') })).json();
  assert.equal(exported.path, path.join(output, 'api.png'));
  const changed = await fetch(`${base}/api/config`, { method: 'POST', headers, body: JSON.stringify({ input, output: path.join(root, 'target'), watch: false }) });
  assert.equal(changed.status, 200);
  assert.equal((await (await fetch(`${base}/api/config`, { headers })).json()).watch, false);
});

test('默认目录使用项目相对路径，自定义目录和配置持久化继续可用', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-relative-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'input'));
  await fs.writeFile(path.join(root, 'input', 'sample.png'), 'source');
  const server = await createApp({ projectDir: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  const token = html.match(/name="resize-token" content="([^"]+)"/)[1];
  const headers = { 'X-Resize-Token': token };
  const defaults = await (await fetch(`${base}/api/config`, { headers })).json();
  assert.equal(defaults.input, './input');
  assert.equal(defaults.output, './output');
  assert.equal(defaults.defaultOutput, './output');
  assert.equal((await (await fetch(`${base}/api/library`, { headers })).json()).files[0].name, 'sample.png');
  assert.equal(await (await fetch(`${base}/api/image?path=sample.png`, { headers })).text(), 'source');
  const exported = await (await fetch(`${base}/api/export?name=sample.png`, { method: 'POST', headers, body: 'result' })).json();
  assert.equal(exported.path, path.join(root, 'output', 'sample.png'));
  assert.equal(await fs.readFile(path.join(root, 'input', 'sample.png'), 'utf8'), 'source');

  await fs.mkdir(path.join(root, 'custom-input'));
  await fs.writeFile(path.join(root, 'custom-input', 'custom.png'), 'custom-source');
  const changed = await fetch(`${base}/api/config`, { method: 'POST', headers, body: JSON.stringify({ input: './custom-input', output: './custom-output', watch: true }) });
  assert.equal(changed.status, 200);
  const stored = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(stored.input, './custom-input');
  assert.equal(stored.output, './custom-output');
  assert.equal((await (await fetch(`${base}/api/library`, { headers })).json()).files[0].name, 'custom.png');
  const customExport = await (await fetch(`${base}/api/export?name=custom.png`, { method: 'POST', headers, body: 'custom-result' })).json();
  assert.equal(customExport.path, path.join(root, 'custom-output', 'custom.png'));
  const reset = await (await fetch(`${base}/api/config`, { method: 'POST', headers, body: JSON.stringify({ input: './custom-input', output: '', watch: true }) })).json();
  assert.equal(reset.output, './output');
  const absolute = await (await fetch(`${base}/api/config`, { method: 'POST', headers, body: JSON.stringify({ input: path.join(root, 'input'), output: path.join(root, 'absolute-output'), watch: true }) })).json();
  assert.equal(absolute.input, path.join(root, 'input'));
  assert.equal(absolute.output, path.join(root, 'absolute-output'));
});

test('新增自动选择且优先按加入时间排序，保留取消选择与文件更新状态', () => {
  const file = (name, modified, size = 10) => ({ name, relativePath: name, modified, size });
  const items = new Map();
  const existing = [file('old.png', 5000), file('frame10.png', 500), file('frame2.png', 500)];
  reconcileLibrary(items, './input', existing);
  assert([...items.values()].every(item => !item.selected));
  assert.deepEqual([...items.values()].sort(compareAssets).map(item => item.name), ['old.png', 'frame2.png', 'frame10.png']);
  const old = [...items.values()].find(item => item.name === 'old.png'); old.selected = true;

  const addedFiles = [...existing, file('new10.png', 1), file('new2.png', 2)];
  const firstChange = reconcileLibrary(items, './input', addedFiles, { autoSelectNew: true, now: 1000 });
  assert.equal(firstChange.newCount, 2);
  assert(firstChange.added.every(item => item.selected));
  assert.deepEqual([...items.values()].sort(compareAssets).map(item => item.name), ['new2.png', 'new10.png', 'old.png', 'frame2.png', 'frame10.png']);
  const unchecked = [...items.values()].find(item => item.name === 'new2.png'); unchecked.selected = false;
  assert.equal(reconcileLibrary(items, './input', addedFiles, { autoSelectNew: true, now: 2000 }).newCount, 0);
  assert.equal(unchecked.selected, false);

  const replaced = addedFiles.map(item => item.name === 'new2.png' ? file('new2.png', 3, 20) : item);
  const update = reconcileLibrary(items, './input', replaced, { autoSelectNew: true, now: 2000 });
  assert.equal(update.newCount, 0);
  assert.equal(update.added[0].selected, false);
  assert.equal(update.added[0].addedAt, 1000);
  assert.equal(old.selected, true);
  reconcileLibrary(items, './input', [...replaced, file('latest.png', 0)], { autoSelectNew: true, now: 2000 });
  assert.equal([...items.values()].sort(compareAssets)[0].name, 'latest.png');

  items.set('drop', { id: 'drop', name: 'drag.png', relativePath: 'folder/drag.png', source: 'drop', modified: 0, addedAt: 3000, selected: true });
  const switched = reconcileLibrary(items, './other', [file('other.png', 0)]);
  assert.equal(switched.newCount, 0);
  assert.equal(switched.added[0].selected, false);
  assert.equal([...items.values()].filter(item => item.source === 'local').length, 1);
  assert.equal(items.get('drop').selected, true);
});

test('真实 input 扫描识别保留旧时间的新文件，并正确处理删除与重名排序', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-watch-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'a')); await fs.mkdir(path.join(root, 'b'));
  await fs.writeFile(path.join(root, 'existing.png'), 'existing');
  const items = new Map();
  reconcileLibrary(items, root, (await scanLibrary(root)).files);
  await fs.writeFile(path.join(root, 'b', 'new.png'), 'new-b');
  await fs.writeFile(path.join(root, 'a', 'new.png'), 'new-a');
  await fs.utimes(path.join(root, 'b', 'new.png'), 1, 1);
  await fs.utimes(path.join(root, 'a', 'new.png'), 1, 1);
  const change = reconcileLibrary(items, root, (await scanLibrary(root)).files, { autoSelectNew: true, now: Date.now() });
  assert.equal(change.newCount, 2);
  assert(change.added.every(item => item.selected));
  assert.deepEqual([...items.values()].sort(compareAssets).map(item => item.relativePath), ['a/new.png', 'b/new.png', 'existing.png']);
  await fs.unlink(path.join(root, 'a', 'new.png'));
  const deleted = reconcileLibrary(items, root, (await scanLibrary(root)).files, { autoSelectNew: true });
  assert.equal(deleted.removed.length, 1);
  assert.equal(deleted.newCount, 0);
  assert.equal([...items.values()].filter(item => item.selected).length, 1);
});
