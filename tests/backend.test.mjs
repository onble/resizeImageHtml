import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp, saveImage } from '../server.mjs';
import { processImage, pythonRuntime } from '../image-processor.mjs';
import { fixture, fixtureOptions, fixturePixels, decodeRgba } from './image-fixtures.mjs';

test('fresh startup verifies real processing and survives subsequent concurrent Python launches', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { engineInfo, processImage } from './image-processor.mjs';
    import { fixture, fixtureOptions, fixturePixels, decodeRgba } from './tests/image-fixtures.mjs';
    const engine = await engineInfo();
    assert.deepEqual(engine.processingCheck, { width: 1, height: 1, format: 'png' });
    const results = await Promise.all(Array.from({ length: 3 }, () => processImage(fixture, fixtureOptions)));
    for (const result of results) assert.deepEqual(decodeRgba(result.bytes).rgba, fixturePixels);
    console.log('startup and repeated processing passed');
  `], { cwd: new URL('..', import.meta.url), windowsHide: true, timeout: 60000 });
  assert.match(stdout, /startup and repeated processing passed/);
});

test('Python tests compare original resize pixels, alpha, layouts and encoding', async () => {
  const runtime = await pythonRuntime();
  const { stdout, stderr } = await promisify(execFile)(runtime.command, [...runtime.prefix, 'tests/python_image_test.py'], { cwd: new URL('..', import.meta.url), windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.match(stdout + stderr, /OK/);
});

test('backend preview and export share actual Python bytes, preserve originals and reject unsafe input', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-python-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(input); await fs.writeFile(path.join(input, '原图.png'), fixture);
  const server = await createApp({ input, output, persist: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  const headers = { 'X-Resize-Token': html.match(/name="resize-token" content="([^"]+)"/)[1], 'X-Resize-Protocol': '2' };
  const query = `options=${encodeURIComponent(JSON.stringify(fixtureOptions))}`;
  const post = (route, body = fixture, extraHeaders = {}) => fetch(`${base}/api/${route}`, { method: 'POST', headers: { ...headers, ...extraHeaders }, body });
  const engine = await (await fetch(`${base}/api/engine`, { headers })).json();
  assert.equal(engine.protocol, 2); assert.equal(engine.engine, 'pillow'); assert(engine.upToDate);
  assert.match(engine.buildId, /^[a-f0-9]{64}$/); assert.equal(engine.defaults.resample, 'LANCZOS'); assert.equal(Object.hasOwn(engine.defaults, 'nearest'), false);
  const incompatible = await post(`export?name=old-page.png&${query}`, fixture, { 'X-Resize-Protocol': '1' });
  assert.equal(incompatible.status, 409);
  await assert.rejects(fs.stat(path.join(output, 'old-page.png')), { code: 'ENOENT' });
  const planned = await (await post('plan', JSON.stringify({ images: [{ id: 'source', width: 2, height: 3 }], options: fixtureOptions }))).json();
  assert.deepEqual(planned.items[0].layout, { width: 2, height: 3 });
  const preview = await post(`preview?${query}`);
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/png');
  const metadata = JSON.parse(preview.headers.get('x-resize-result'));
  assert.deepEqual(metadata.layout, { width: 2, height: 3 });
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  assert.deepEqual(decodeRgba(previewBytes).rgba, fixturePixels);
  const legacyOptions = { mode: 'height', height: 2, nearest: true, pngOptimize: false, format: 'png' };
  const legacyQuery = `options=${encodeURIComponent(JSON.stringify(legacyOptions))}`;
  const legacyPreview = await post(`preview?${legacyQuery}`);
  assert.equal(legacyPreview.status, 200);
  assert.equal(JSON.parse(legacyPreview.headers.get('x-resize-result')).processing.resample, 'LANCZOS');
  const fixedPreviewBytes = Buffer.from(await legacyPreview.arrayBuffer());
  const fixedResult = await processImage(fixture, { ...legacyOptions, nearest: false });
  assert.deepEqual(fixedPreviewBytes, fixedResult.bytes);
  const legacyExport = await (await post(`export?name=legacy-option.png&${legacyQuery}`)).json();
  assert.equal(legacyExport.processing.resample, 'LANCZOS');
  assert.deepEqual(await fs.readFile(legacyExport.path), fixedPreviewBytes);
  const exported = await (await post(`export?name=${encodeURIComponent('中文/图标.png')}&${query}`)).json();
  assert.equal(exported.status, 'saved'); assert.deepEqual(exported.layout, metadata.layout);
  assert.deepEqual(await fs.readFile(exported.path), previewBytes);
  const named = await (await post(`export?sourceName=${encodeURIComponent('中文/原图.bmp')}&suffix=_test&preserve=false&${query}`)).json();
  assert.equal(path.basename(named.path), '原图_test.png');
  assert.equal(path.dirname(named.path), output); assert.equal(named.processing.resample, 'LANCZOS');
  assert.match(named.sourceSha256, /^[a-f0-9]{64}$/);
  const renamed = await (await post(`export?name=${encodeURIComponent('中文/图标.png')}&${query}`)).json();
  assert.match(renamed.path, /图标_1\.png$/);
  const skipped = await (await post(`export?name=${encodeURIComponent('中文/图标.png')}&collision=skip&${query}`)).json();
  assert.equal(skipped.status, 'skipped');
  const withoutOptimization = await processImage(fixture, { ...fixtureOptions, pngOptimize: false });
  assert.deepEqual(decodeRgba(withoutOptimization.bytes).rgba, fixturePixels);
  for (const route of ['export?name=x.png', `preview?${query}`, `export?name=../bad.png&${query}`, `export?name=bad.jpg&${query}`]) {
    const response = await post(route, route.startsWith('preview') ? Buffer.from('corrupt') : fixture);
    assert.equal(response.status, 400);
  }
  assert.equal((await post(`preview?${query}`, fixture, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(`${base}/api/preview?${query}`, { method: 'POST', body: fixture })).status, 403);
  const before = await fs.readdir(output);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(fetch(`${base}/api/export?name=cancelled.png&${query}`, { method: 'POST', headers, body: fixture, signal: cancelled.signal }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(output), before);
  await post('config', JSON.stringify({ input, output: input, watch: false }));
  const protectedExport = await post(`export?name=${encodeURIComponent('原图.png')}&collision=overwrite&${query}`);
  assert.equal(protectedExport.status, 400);
  assert.deepEqual(await fs.readFile(path.join(input, '原图.png')), fixture);
});

test('abort and timeout terminate Python work and allow subsequent processing', async () => {
  await pythonRuntime();
  const controller = new AbortController();
  const pending = processImage(fixture, fixtureOptions, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(processImage(fixture, fixtureOptions, { timeoutMs: 1 }), /timed out/);
  const recovered = await processImage(fixture, fixtureOptions);
  assert.deepEqual(decodeRgba(recovered.bytes).rgba, fixturePixels);
});

test('cancelling while preparing output directories prevents the final file write', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-cancel-write-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = saveImage(root, 'nested/cancelled.png', fixture, 'rename', '', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(fs.stat(path.join(root, 'nested', 'cancelled.png')), { code: 'ENOENT' });
});
