import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const staticTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function safeRelative(value) {
  const parts = String(value).replaceAll('\\', '/').split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new Error('文件名或相对路径不合法');
  }
  return parts.join(path.sep);
}

export async function scanLibrary(root) {
  const files = [], warnings = [];
  const walk = async (folder) => {
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch (error) { warnings.push(`${path.relative(root, folder) || folder}: ${error.message}`); return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && types[path.extname(entry.name).toLowerCase()]) {
        try {
          const stat = await fs.stat(filename);
          files.push({ name: entry.name, relativePath: path.relative(root, filename).split(path.sep).join('/'), size: stat.size, modified: stat.mtimeMs });
        } catch (error) { warnings.push(`${entry.name}: ${error.message}`); }
      }
    }
  };
  await walk(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));
  return { files, warnings };
}

async function noLinks(root, relative) {
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('不读写符号链接或目录联接中的文件'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function saveImage(root, relative, bytes, collision = 'rename', sourceRoot = '') {
  if (!['rename', 'skip', 'overwrite'].includes(collision)) throw new Error('同名处理方式无效');
  if (!path.isAbsolute(root)) throw new Error('导出目录必须为绝对路径');
  relative = safeRelative(relative);
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(relative).toLowerCase())) throw new Error('不支持的导出格式');
  await fs.mkdir(root, { recursive: true });
  const canonicalRoot = await fs.realpath(root);
  await noLinks(canonicalRoot, relative);
  let destination = path.join(canonicalRoot, relative);
  if (sourceRoot && within(await fs.realpath(sourceRoot), destination)) throw new Error('目标位于当前素材目录中，请选择独立的导出目录以保留原图');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const parsed = path.parse(destination);
  for (let index = 0; index < 10000; index++) {
    const candidate = index ? path.join(parsed.dir, `${parsed.name}_${index}${parsed.ext}`) : destination;
    try {
      // wx makes collision handling atomic; overwrite is an explicit user option.
      await fs.writeFile(candidate, bytes, { flag: collision === 'overwrite' ? 'w' : 'wx' });
      return { status: 'saved', path: candidate, size: bytes.length };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (collision === 'skip') return { status: 'skipped', path: candidate };
    }
  }
  throw new Error('同名文件过多，请更换输出名称');
}

async function readBody(request, limit = 80 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('单个文件超过 80 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function chooseFolder(initial, language = 'en') {
  if (process.platform !== 'win32') throw new Error('目录选择窗口仅支持 Windows；请直接输入绝对路径');
  const script = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${language === 'zh' ? '选择图片输入目录或导出目录' : 'Choose an input or output folder'}'
$dialog.SelectedPath = $env:RESIZE_INITIAL_PATH
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }
$dialog.Dispose()`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, RESIZE_INITIAL_PATH: initial || here }, timeout: 300000 });
  return stdout.replace(/^\uFEFF/, '').trim();
}

export async function createApp({ input, output, persist = true, projectDir = here } = {}) {
  const settingsFile = path.join(projectDir, 'settings.json');
  // Keep configuration relative; resolve filesystem paths against this project,
  // regardless of the working directory used to launch Node.
  const directory = value => path.resolve(projectDir, value);
  let stored = {};
  if (persist) { try { stored = JSON.parse(await fs.readFile(settingsFile, 'utf8')); } catch {} }
  const defaultOutput = './output';
  let config = {
    input: input ?? stored.input ?? './input',
    output: output ?? stored.output ?? defaultOutput,
    watch: stored.watch ?? true
  };
  if (!input && !(await fs.stat(directory(config.input)).catch(() => null))?.isDirectory()) { config.input = './input'; await fs.mkdir(directory(config.input), { recursive: true }); }
  const token = randomBytes(24).toString('hex');
  const server = http.createServer(async (request, response) => {
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    try {
      const authority = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== authority) { json(403, { error: '仅接受本机访问' }); return; }
      const origin = request.headers.origin;
      if (origin && origin !== `http://${authority}`) { json(403, { error: '不接受其他网页的请求' }); return; }
      const url = new URL(request.url, `http://${authority}`);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (url.pathname.startsWith('/api/')) {
        if (request.headers['x-resize-token'] !== token) { json(403, { error: '请从本工具页面访问' }); return; }
        if (url.pathname === '/api/config' && request.method === 'GET') { json(200, { ...config, defaultOutput }); return; }
        if (url.pathname === '/api/config' && request.method === 'POST') {
          const next = JSON.parse((await readBody(request, 65536)).toString());
          const inputPath = String(next.input || config.input).trim();
          const outputPath = String(next.output || defaultOutput).trim();
          if (!(await fs.stat(directory(inputPath))).isDirectory()) throw new Error('输入目录不存在或不是文件夹');
          config = { input: inputPath, output: outputPath, watch: Boolean(next.watch) };
          if (persist) await fs.writeFile(settingsFile, JSON.stringify(config, null, 2));
          json(200, { ...config, defaultOutput }); return;
        }
        if (url.pathname === '/api/library' && request.method === 'GET') { json(200, await scanLibrary(directory(config.input))); return; }
        if (url.pathname === '/api/image' && request.method === 'GET') {
          const relative = safeRelative(url.searchParams.get('path') || '');
          const type = types[path.extname(relative).toLowerCase()];
          if (!type) throw new Error('不支持的图片格式');
          const root = await fs.realpath(directory(config.input));
          await noLinks(root, relative);
          const bytes = await fs.readFile(path.join(root, relative));
          response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(bytes); return;
        }
        if (url.pathname === '/api/export' && request.method === 'POST') {
          const bytes = await readBody(request);
          if (!bytes.length) throw new Error('图片数据为空');
          const result = await saveImage(directory(config.output), url.searchParams.get('name'), bytes, url.searchParams.get('collision') || 'rename', directory(config.input));
          json(200, result); return;
        }
        if (url.pathname === '/api/choose-folder' && request.method === 'POST') {
          const body = JSON.parse((await readBody(request, 65536)).toString());
          json(200, { path: await chooseFolder(directory(body.initial || config.input), body.language) }); return;
        }
        if (url.pathname === '/api/open-output' && request.method === 'POST') {
          const outputDirectory = directory(config.output);
          await fs.mkdir(outputDirectory, { recursive: true });
          if (process.platform !== 'win32') throw new Error('自动打开目录仅支持 Windows');
          const child = spawn('explorer.exe', [outputDirectory], { detached: true, stdio: 'ignore', windowsHide: true });
          child.on('error', () => {}); child.unref();
          json(200, { path: outputDirectory }); return;
        }
        json(404, { error: '接口不存在' }); return;
      }
      if (request.method !== 'GET') { json(405, { error: '方法不支持' }); return; }
      const routes = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/theme.js': 'theme.js', '/i18n.js': 'i18n.js', '/styles.css': 'styles.css', '/resize.mjs': 'resize.mjs', '/library.mjs': 'library.mjs', '/favicon.svg': 'favicon.svg' };
      const filename = routes[url.pathname];
      if (!filename) { json(404, { error: '文件不存在' }); return; }
      let bytes = await fs.readFile(path.join(here, 'public', filename));
      if (filename === 'index.html') bytes = Buffer.from(bytes.toString().replace('__RESIZE_TOKEN__', token));
      response.writeHead(200, { 'Content-Type': staticTypes[path.extname(filename)], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
      response.end(bytes);
    } catch (error) { json(400, { error: error.message }); }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 4178);
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。若工具已启动，请打开 http://127.0.0.1:${port}；也可设置 PORT 使用其他端口。` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${server.address().port}`;
    console.log(`图片缩放工作台：${address}\n关闭此进程即可停止服务。`);
    if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', address], { windowsHide: true }, () => {});
    }
  });
}
