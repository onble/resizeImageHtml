import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'python', 'process_image.py');
const MAX_BYTES = 80 * 1024 * 1024;
const abortError = () => Object.assign(new Error('Image processing cancelled'), { name: 'AbortError' });
let runtimePromise;
let processingCheckPromise;
export const PROCESSING_PROTOCOL = 2;

export async function processingBuildId() {
  const hash = createHash('sha256');
  for (const name of ['server.mjs', 'image-processor.mjs', 'python/resize_image.py', 'python/resize-source.json', 'python/process_image.py', 'public/app.js', 'public/resize.mjs', 'public/index.html', 'public/i18n.js', 'public/styles.css']) {
    hash.update(name); hash.update(await fs.readFile(path.join(here, name)));
  }
  return hash.digest('hex');
}

export async function engineInfo(buildId) {
  buildId ??= await processingBuildId();
  const runtime = await pythonRuntime();
  const processingCheck = await verifyImageProcessing();
  return { protocol: PROCESSING_PROTOCOL, buildId, engine: 'pillow', defaults: { mode: 'height', height: 120, format: 'png', palette: false, ...runtime.defaults, pngOptimize: true }, runtime, processingCheck };
}

function execute(command, args, { input, signal, timeoutMs = 60000, limit = MAX_BYTES + 65536, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const child = spawn(command, args, { cwd: here, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', ...env } });
    const chunks = []; let size = 0, errors = '', failure;
    const stop = error => { failure ??= error; child.kill(); };
    const cancel = () => stop(abortError());
    const timer = setTimeout(() => stop(new Error('Python image processing timed out')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > limit) stop(new Error('Processed image exceeds 80 MB')); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { if (errors.length < 8192) errors += chunk.toString('utf8'); });
    child.on('error', error => { failure ??= error; });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(errors.trim() || 'Python image processing failed'));
      else resolve(Buffer.concat(chunks));
    });
    if (signal?.aborted) cancel();
    child.stdin.end(input);
  });
}

export async function pythonRuntime() {
  runtimePromise ??= (async () => {
    // Older Windows libuv can terminate Node when its first child is a Store
    // app alias (such as py.exe) and the next child is a normal executable.
    // Initialize job ownership with this real Node executable before probing.
    // Keep children attached so timeout, cancellation and parent-exit cleanup
    // still work. See https://github.com/libuv/libuv/pull/4152.
    if (process.platform === 'win32') {
      await execute(process.execPath, ['--eval', '0'], { timeoutMs: 10000, limit: 1024 });
    }
    const custom = process.env.RESIZE_IMAGE_PYTHON;
    const candidates = custom ? [[custom, []]] : [
      [path.join(here, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), []],
      ...(process.platform === 'win32' ? [['py', ['-3']]] : []),
      ['python3', []], ['python', []],
      [path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'), []]
    ];
    for (const [command, prefix] of candidates) {
      try {
        const info = JSON.parse((await execute(command, [...prefix, script, '--check'], { timeoutMs: 10000, limit: 65536 })).toString('utf8'));
        // Launch the resolved interpreter directly: killing the Windows py
        // launcher alone could otherwise leave its image-processing child alive.
        return { ...info, command: info.executable, prefix: [], discoveredWith: [command, ...prefix] };
      } catch (error) {
        if (error.message === 'Bundled resize source failed verification') throw error;
        // A system Python 2 or a Python without Pillow must not be selected.
      }
    }
    throw new Error('Python 3.10+ with Pillow is required. Set RESIZE_IMAGE_PYTHON to a compatible Python executable.');
  })();
  try { return await runtimePromise; } catch (error) { runtimePromise = undefined; throw error; }
}

// Bound memory and CPU use when several thumbnail requests arrive together.
let active = 0;
const waiting = [];
function acquire(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active < 3) { active++; return Promise.resolve(); }
  if (waiting.length >= 64) return Promise.reject(new Error('Too many image processing requests'));
  return new Promise((resolve, reject) => {
    const entry = { resolve, signal, cancel: () => { const index = waiting.indexOf(entry); if (index !== -1) waiting.splice(index, 1); reject(abortError()); } };
    signal?.addEventListener('abort', entry.cancel, { once: true });
    waiting.push(entry);
  });
}
function release() {
  const entry = waiting.shift();
  if (entry) { entry.signal?.removeEventListener('abort', entry.cancel); entry.resolve(); }
  else active--;
}

export async function processImage(bytes, options, { signal, timeoutMs = 60000 } = {}) {
  if (!bytes.length) throw new Error('Image data is empty');
  if (bytes.length > MAX_BYTES) throw new Error('Image exceeds 80 MB');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid image processing options');
  const header = Buffer.from(JSON.stringify(options) + '\n');
  if (header.length > 8192) throw new Error('Invalid image processing options');
  await acquire(signal);
  let scratch;
  try {
    const runtime = await pythonRuntime();
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'resize-image-request-'));
    const output = await execute(runtime.command, [...runtime.prefix, script], { input: Buffer.concat([header, bytes]), signal, timeoutMs, env: { TEMP: scratch, TMP: scratch, TMPDIR: scratch } });
    const end = output.indexOf(10);
    if (end < 1 || end > 65536) throw new Error('Invalid Python image response');
    const metadata = JSON.parse(output.subarray(0, end).toString('utf8'));
    const result = output.subarray(end + 1);
    const format = metadata.format;
    const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format];
    if (!mime || !result.length || result.length > MAX_BYTES || !Number.isInteger(metadata.layout?.width) || !Number.isInteger(metadata.layout?.height)) throw new Error('Invalid Python image response');
    return { bytes: result, mime, ...metadata, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    try {
      if (scratch) {
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(scratch));
        if (!relative.startsWith('resize-image-request-') || relative.includes(path.sep)) throw new Error('Invalid processing temporary directory');
        await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
    } finally { release(); }
  }
}

export async function planImages(images, options, { signal } = {}) {
  if (!Array.isArray(images) || images.length > 10000 || !options || typeof options !== 'object') throw new Error('Invalid image processing options');
  await acquire(signal);
  try {
    const runtime = await pythonRuntime();
    const bytes = await execute(runtime.command, [...runtime.prefix, script, '--plan'], { input: JSON.stringify({ images, options }), signal, limit: 4 * 1024 * 1024 });
    return JSON.parse(bytes.toString('utf8'));
  } finally { release(); }
}

export async function verifyImageProcessing() {
  processingCheckPromise ??= (async () => {
    // A 2x3 RGBA fixture with opaque, partial and fully transparent pixels.
    // Exercise the resolved interpreter and PNG encoding after discovery;
    // importing Pillow alone cannot detect a failing second process launch.
    const source = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAI0lEQVR4nGP4z8Dwn+E/QwMDj5IFAyMT8z8GDSOb/ykVPf8BbcsI5AZjXZUAAAAASUVORK5CYII=', 'base64');
    const result = await processImage(source, { mode: 'height', height: 1, format: 'png', palette: false, pngOptimize: true });
    if (result.layout.width !== 1 || result.layout.height !== 1 || result.bytes.length < 33 ||
        result.bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        result.bytes.readUInt32BE(16) !== 1 || result.bytes.readUInt32BE(20) !== 1) {
      throw new Error('Image processing startup check failed');
    }
    return { width: 1, height: 1, format: 'png' };
  })();
  try { return await processingCheckPromise; } catch (error) { processingCheckPromise = undefined; throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--check')) {
  try { const engine = await engineInfo(); console.log(JSON.stringify({ ...engine.runtime, ...engine })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
