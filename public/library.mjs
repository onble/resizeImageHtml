// Newly added assets lead the list, even when copied files retain an old mtime.
// Each detected/imported batch shares one arrival time, then sorts by filename.
export function compareAssets(a, b) {
  return Number(Boolean(b.addedAt)) - Number(Boolean(a.addedAt))
    || (b.addedAt || b.modified || 0) - (a.addedAt || a.modified || 0)
    || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    || a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true });
}

export function reconcileLibrary(items, root, files, { autoSelectNew = false, now = Date.now() } = {}) {
  const previousByPath = new Map([...items.values()].filter(item => item.source === 'local' && item.root === root).map(item => [item.relativePath, item]));
  const keep = new Set(), added = [], removed = [];
  let newCount = 0;
  for (const file of files) {
    const id = `local:${root}:${file.relativePath}:${file.size}:${file.modified}`;
    keep.add(id);
    if (items.has(id)) continue;
    const previous = previousByPath.get(file.relativePath);
    const isNew = autoSelectNew && !previous;
    const item = { ...file, id, source: 'local', root, selected: previous?.selected ?? isNew, addedAt: previous?.addedAt ?? (isNew ? now : 0) };
    items.set(id, item); added.push(item);
    if (isNew) newCount++;
  }
  for (const item of [...items.values()]) {
    if (item.source === 'local' && !keep.has(item.id)) { items.delete(item.id); removed.push(item); }
  }
  return { added, removed, newCount };
}
