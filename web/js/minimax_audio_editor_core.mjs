const roundMs = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function clampTrimSelection(trimStart = 0, trimEnd = 0, sourceDuration = 0) {
  const duration = Math.max(0, Number(sourceDuration) || 0);
  const start = clamp(Number.isFinite(Number(trimStart)) ? Number(trimStart) : 0, 0, duration);
  const end = clamp(Number.isFinite(Number(trimEnd)) ? Number(trimEnd) : duration, start, duration);
  return { trimStart: roundMs(start), trimEnd: roundMs(end) };
}

export function moveTrimSelection(trimStart = 0, trimEnd = 0, deltaSec = 0, sourceDuration = 0) {
  const duration = Math.max(0, Number(sourceDuration) || 0);
  const current = clampTrimSelection(trimStart, trimEnd, duration);
  const width = Math.max(0, current.trimEnd - current.trimStart);
  const maxStart = Math.max(0, duration - width);
  const nextStart = clamp(current.trimStart + (Number(deltaSec) || 0), 0, maxStart);
  return { trimStart: roundMs(nextStart), trimEnd: roundMs(nextStart + width) };
}

function cloneSnapshot(value) {
  return { ...value };
}

function sameSnapshot(a, b) {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

export function createAudioEditHistory(initial) {
  let entries = [cloneSnapshot(initial || {})];
  let index = 0;
  const current = () => cloneSnapshot(entries[index]);
  return {
    get canUndo() { return index > 0; },
    get canRedo() { return index < entries.length - 1; },
    current,
    push(next) {
      const snapshot = cloneSnapshot(next || {});
      if (sameSnapshot(entries[index], snapshot)) return current();
      entries = entries.slice(0, index + 1);
      entries.push(snapshot);
      index += 1;
      return current();
    },
    undo() {
      if (index > 0) index -= 1;
      return current();
    },
    redo() {
      if (index < entries.length - 1) index += 1;
      return current();
    },
  };
}

export function orderDriveRows(rows = [], orderedAssetIds = []) {
  const order = new Map((orderedAssetIds || []).map((assetId, index) => [String(assetId), index]));
  return [...(rows || [])].sort((a, b) => {
    const aId = String(a?.assetId || "");
    const bId = String(b?.assetId || "");
    const aIndex = order.has(aId) ? order.get(aId) : Number.MAX_SAFE_INTEGER;
    const bIndex = order.has(bId) ? order.get(bId) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex || aId.localeCompare(bId);
  });
}

export function shouldCloseEditorBackdrop(pointerDownWasBackdrop, pointerUpWasBackdrop) {
  return Boolean(pointerDownWasBackdrop && pointerUpWasBackdrop);
}
