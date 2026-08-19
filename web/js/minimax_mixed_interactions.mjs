export function selectedIdsFromTimeline(state = {}) {
  if (!state?.runSelectEnabled) return new Set();
  const segments = Array.isArray(state?.segments) ? state.segments : [];
  const ids = new Set();
  for (const raw of Array.isArray(state?.runSelection) ? state.runSelection : []) {
    const index = Number.parseInt(raw, 10);
    const id = Number.isInteger(index) ? segments[index]?.id : null;
    if (id != null && id !== '') ids.add(String(id));
  }
  return ids;
}

export function selectionIndicesForIds(segments = [], ids = new Set()) {
  const wanted = ids instanceof Set ? ids : new Set(ids || []);
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => wanted.has(String(segment?.id ?? '')) ? index : -1)
    .filter((index) => index >= 0);
}

export function toggleSelectedId(ids, segmentId, checked) {
  const next = new Set(ids instanceof Set ? ids : (ids || []));
  const id = String(segmentId ?? '');
  if (!id) return next;
  if (checked) next.add(id); else next.delete(id);
  return next;
}

export function moveSegmentById(segments = [], segmentId, targetIndex) {
  const out = Array.isArray(segments) ? [...segments] : [];
  if (!out.length) return out;
  const id = String(segmentId ?? '');
  const fromIndex = out.findIndex((segment) => String(segment?.id ?? '') === id);
  if (fromIndex < 0) return out;
  const clamped = Math.max(0, Math.min(Number.parseInt(targetIndex, 10) || 0, out.length - 1));
  if (fromIndex === clamped) return out;
  const [item] = out.splice(fromIndex, 1);
  out.splice(clamped, 0, item);
  return out;
}

export function autoScrollDelta(pointerX, rect, { threshold = 56, step = 32 } = {}) {
  const left = Number(rect?.left ?? 0);
  const right = Number(rect?.right ?? left);
  const x = Number(pointerX);
  if (!Number.isFinite(x) || right <= left) return 0;
  if (x <= left + threshold) return -Math.abs(step);
  if (x >= right - threshold) return Math.abs(step);
  return 0;
}
