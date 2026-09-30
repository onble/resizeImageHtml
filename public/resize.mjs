// Pure geometry: add modes here first, then register their controls in app.js.
export const MODES = [
  { id: 'height', icon: '↕', title: '按高度', description: '宽度等比变化' },
  { id: 'width', icon: '↔', title: '按宽度', description: '高度等比变化' },
  { id: 'exact', icon: '▣', title: '指定尺寸', description: '拉伸 / 留白 / 裁切' },
  { id: 'percent', icon: '%', title: '按百分比', description: '整体等比缩放' },
  { id: 'fit', icon: '⛶', title: '限定范围', description: '等比放进尺寸内' }
];

// Match Python round() at .5, keeping legacy fixed-height dimensions consistent.
function round(value) { const floor = Math.floor(value); return value - floor === 0.5 ? floor + floor % 2 : Math.round(value); }
export function geometry(width, height, options) {
  const positive = value => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error('尺寸和比例必须大于 0'); return n; };
  let w, h, scale;
  switch (options.mode) {
    case 'height': h = positive(options.height); w = Math.max(1, round(width * h / height)); break;
    case 'width': w = positive(options.width); h = Math.max(1, round(height * w / width)); break;
    case 'percent': scale = positive(options.percent) / 100; w = Math.max(1, round(width * scale)); h = Math.max(1, round(height * scale)); break;
    case 'exact': w = positive(options.width); h = positive(options.height); break;
    case 'fit': scale = Math.min(positive(options.width) / width, positive(options.height) / height); if (!options.allowUpscale) scale = Math.min(1, scale); w = Math.max(1, round(width * scale)); h = Math.max(1, round(height * scale)); break;
    default: throw new Error('未知缩放模式');
  }
  if (!Number.isInteger(w) || !Number.isInteger(h)) throw new Error('像素尺寸必须为整数');
  if (w > 16384 || h > 16384 || w * h > 32 * 1024 * 1024) throw new Error('尺寸过大：单边最多 16384 px，总面积最多 3200 万像素');
  let drawWidth = w, drawHeight = h;
  if (options.mode === 'exact' && options.fit !== 'stretch') {
    scale = options.fit === 'cover' ? Math.max(w / width, h / height) : Math.min(w / width, h / height);
    drawWidth = width * scale; drawHeight = height * scale;
  }
  if (!options.allowUpscale && (drawWidth > width + 0.001 || drawHeight > height + 0.001)) throw new Error('目标需要放大，请勾选「允许放大」或减小尺寸');
  return { width: w, height: h, drawWidth, drawHeight, x: (w - drawWidth) / 2, y: (h - drawHeight) / 2 };
}

export function outputName(relative, format, suffix = '', preserve = true) {
  const name = preserve ? relative : relative.replaceAll('\\', '/').split('/').at(-1);
  return name.replace(/\.[^.\/\\]+$/, '') + suffix + ({ png: '.png', jpeg: '.jpg', webp: '.webp' }[format] || '.png');
}

export async function renderImage(image, options, format = 'png') {
  const layout = geometry(image.naturalWidth || image.width, image.naturalHeight || image.height, options);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建画布');
  if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.imageSmoothingEnabled = !options.nearest;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, layout.x, layout.y, layout.drawWidth, layout.drawHeight);
  const mime = `image/${format}`;
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), mime, Number(options.quality || 0.95)));
  if (blob.type !== mime) throw new Error(`当前浏览器不支持 ${format} 导出`);
  return { canvas, blob, layout };
}
