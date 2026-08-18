export const AUDIO_ROLE_VERSION = 1;
export const AUDIO_ROLE_REFERENCE = "reference";
export const AUDIO_ROLE_AUDIO_DRIVE = "audio_drive";
export const AUDIO_ROLE_DIALOGUE_DRIVE = "dialogue_drive";
export const AUDIO_DRIVE_ROLES = new Set([AUDIO_ROLE_AUDIO_DRIVE, AUDIO_ROLE_DIALOGUE_DRIVE]);
export const DIALOGUE_DRIVE_VERSION = 1;

const roundMs = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const finiteNonNegative = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : Math.max(0, Number(fallback) || 0);
};

function normalizeRole(value) {
    const role = String(value || "").trim().toLowerCase();
    if (role === AUDIO_ROLE_AUDIO_DRIVE || role === AUDIO_ROLE_DIALOGUE_DRIVE) return role;
    return AUDIO_ROLE_REFERENCE;
}

function normalizeConfig(raw = {}) {
    const sourceDuration = finiteNonNegative(raw.sourceDuration ?? raw.source_duration, 0);
    const trimStart = Math.min(sourceDuration || Infinity, finiteNonNegative(raw.trimStart ?? raw.trim_start, 0));
    const rawEnd = raw.trimEnd ?? raw.trim_end;
    const trimEnd = sourceDuration > 0
        ? Math.max(trimStart, Math.min(sourceDuration, finiteNonNegative(rawEnd, sourceDuration)))
        : Math.max(trimStart, finiteNonNegative(rawEnd, trimStart));
    return {
        role: normalizeRole(raw.role),
        sourceDuration: roundMs(sourceDuration),
        trimStart: roundMs(Number.isFinite(trimStart) ? trimStart : 0),
        trimEnd: roundMs(trimEnd),
        timelineStart: roundMs(finiteNonNegative(raw.timelineStart ?? raw.timeline_start, 0)),
    };
}

function ensureScopeBucket(state, scopeKey, { global = false } = {}) {
    if (global) {
        if (!state.global || typeof state.global !== "object" || Array.isArray(state.global)) state.global = {};
        return state.global;
    }
    if (!state.segments || typeof state.segments !== "object" || Array.isArray(state.segments)) state.segments = {};
    const key = String(scopeKey ?? "0");
    if (!state.segments[key] || typeof state.segments[key] !== "object" || Array.isArray(state.segments[key])) {
        state.segments[key] = {};
    }
    return state.segments[key];
}

function migrateLegacyDialogueDrive(root, state) {
    const legacy = root.dialogueDrive || root.dialogue_drive;
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy) || state.legacyDialogueMigrated) return;
    const globalId = String(legacy.globalAssetId || legacy.global_asset_id || "").trim();
    if (globalId) {
        const bucket = ensureScopeBucket(state, "global", { global: true });
        bucket[globalId] = normalizeConfig({ role: AUDIO_ROLE_DIALOGUE_DRIVE });
    }
    const assignments = legacy.segmentAssetIds || legacy.segment_asset_ids || {};
    if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        for (const [scope, assetIdRaw] of Object.entries(assignments)) {
            const assetId = String(assetIdRaw || "").trim();
            if (!assetId) continue;
            const bucket = ensureScopeBucket(state, scope);
            bucket[assetId] = normalizeConfig({ role: AUDIO_ROLE_DIALOGUE_DRIVE });
        }
    }
    state.legacyDialogueMigrated = true;
}

export function ensureAudioRoleState(timeline) {
    const root = timeline && typeof timeline === "object" ? timeline : {};
    let state = root.audioRoles || root.audio_roles;
    if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
    root.audioRoles = state;
    delete root.audio_roles;
    state.version = AUDIO_ROLE_VERSION;
    if (!state.global || typeof state.global !== "object" || Array.isArray(state.global)) state.global = {};
    if (!state.segments || typeof state.segments !== "object" || Array.isArray(state.segments)) state.segments = {};
    migrateLegacyDialogueDrive(root, state);
    return state;
}

export function audioRoleScopeKey(segment, index = 0) {
    const id = String(segment?.id || "").trim();
    return id || String(Number(index) || 0);
}

export function getAudioRole(timeline, scopeKey, assetId, options = {}) {
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, options);
    const key = String(assetId || "").trim();
    return normalizeConfig((key && bucket[key]) || {});
}

export function setAudioRole(timeline, scopeKey, assetId, config = {}, options = {}) {
    const key = String(assetId || "").trim();
    if (!key) return normalizeConfig(config);
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, options);
    const previous = normalizeConfig(bucket[key] || {});
    const patch = { ...config };
    const discoversDuration = Number(previous.sourceDuration) <= 0
        && Number(previous.trimStart) === 0
        && Number(previous.trimEnd) === 0
        && Number(patch.sourceDuration ?? patch.source_duration) > 0
        && !("trimEnd" in patch) && !("trim_end" in patch);
    if (discoversDuration) patch.trimEnd = Number(patch.sourceDuration ?? patch.source_duration);
    const merged = normalizeConfig({ ...previous, ...patch });
    if (merged.role === AUDIO_ROLE_REFERENCE && merged.sourceDuration <= 0
        && merged.trimStart === 0 && merged.trimEnd === 0 && merged.timelineStart === 0) {
        delete bucket[key];
    } else {
        bucket[key] = merged;
    }
    return merged;
}

export function updateAudioRoleEdit(timeline, scopeKey, assetId, patch = {}, options = {}) {
    return setAudioRole(timeline, scopeKey, assetId, patch, options);
}

export function effectiveAudioDuration(config = {}) {
    const cfg = normalizeConfig(config);
    return roundMs(Math.max(0, cfg.trimEnd - cfg.trimStart));
}

export function audioPlacement(config = {}, segmentDuration = 0) {
    const cfg = normalizeConfig(config);
    const total = finiteNonNegative(segmentDuration, 0);
    const duration = effectiveAudioDuration(cfg);
    const start = roundMs(cfg.timelineStart);
    const end = roundMs(start + duration);
    const overrun = roundMs(Math.max(0, end - total));
    return {
        start,
        end,
        duration,
        leftRatio: total > 0 ? start / total : 0,
        widthRatio: total > 0 ? duration / total : 0,
        overrun,
    };
}

export function moveAudioRole(config = {}, requestedStart = 0, segmentDuration = 0) {
    const cfg = normalizeConfig(config);
    const total = finiteNonNegative(segmentDuration, 0);
    const duration = effectiveAudioDuration(cfg);
    const maxStart = Math.max(0, total - duration);
    return { ...cfg, timelineStart: roundMs(Math.max(0, Math.min(maxStart, finiteNonNegative(requestedStart, 0)))) };
}

export function validateAudioRoleIntervals(items = [], segmentDuration = 0) {
    const total = finiteNonNegative(segmentDuration, 0);
    const errors = [];
    const drives = [];
    for (const raw of items || []) {
        const cfg = normalizeConfig(raw);
        if (!AUDIO_DRIVE_ROLES.has(cfg.role)) continue;
        const assetId = String(raw?.assetId || raw?.asset_id || "");
        const p = audioPlacement(cfg, total);
        if (p.duration <= 0) {
            errors.push({ code: "empty_drive", assetId });
            continue;
        }
        if (p.overrun > 0) errors.push({ code: "overrun", assetId, overrun: p.overrun });
        drives.push({ assetId, role: cfg.role, start: p.start, end: p.end });
    }
    drives.sort((a, b) => a.start - b.start || a.end - b.end || a.assetId.localeCompare(b.assetId));
    for (let i = 1; i < drives.length; i++) {
        const prev = drives[i - 1];
        const cur = drives[i];
        if (cur.start < prev.end - 0.0005) {
            errors.push({ code: "drive_overlap", assetIds: [prev.assetId, cur.assetId], start: cur.start, end: Math.min(prev.end, cur.end) });
        }
    }
    return { errors, intervals: drives };
}

export function clearStaleAudioRoles(timeline, scopeKey, validAssetIds, options = {}) {
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, options);
    const valid = new Set((validAssetIds || []).map((value) => String(value)));
    let changed = false;
    for (const assetId of Object.keys(bucket)) {
        if (!valid.has(assetId)) {
            delete bucket[assetId];
            changed = true;
        }
    }
    return changed;
}

export function listAudioRoles(timeline, scopeKey, options = {}) {
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, options);
    return Object.entries(bucket).map(([assetId, config]) => ({ assetId, ...normalizeConfig(config) }));
}

// Compatibility façade for workflows/extensions that used the old one-audio Dialogue Drive API.
export function ensureDialogueDriveState(timeline) {
    ensureAudioRoleState(timeline);
    const root = timeline && typeof timeline === "object" ? timeline : {};
    let legacy = root.dialogueDrive;
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) legacy = {};
    legacy.version = DIALOGUE_DRIVE_VERSION;
    legacy.globalAssetId = String(legacy.globalAssetId || legacy.global_asset_id || "");
    legacy.segmentAssetIds = legacy.segmentAssetIds && typeof legacy.segmentAssetIds === "object"
        ? legacy.segmentAssetIds
        : { ...(legacy.segment_asset_ids || {}) };
    delete legacy.global_asset_id;
    delete legacy.segment_asset_ids;
    root.dialogueDrive = legacy;
    return legacy;
}

export const dialogueDriveScopeKey = audioRoleScopeKey;

export function getDialogueDriveAsset(timeline, scopeKey, { global = false } = {}) {
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, { global });
    for (const [assetId, raw] of Object.entries(bucket)) {
        if (normalizeConfig(raw).role === AUDIO_ROLE_DIALOGUE_DRIVE) return assetId;
    }
    return "";
}

export function setDialogueDriveAsset(timeline, scopeKey, assetId, { global = false } = {}) {
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, { global });
    for (const [id, raw] of Object.entries(bucket)) {
        if (normalizeConfig(raw).role === AUDIO_ROLE_DIALOGUE_DRIVE) {
            bucket[id] = normalizeConfig({ ...raw, role: AUDIO_ROLE_REFERENCE });
        }
    }
    const value = String(assetId || "").trim();
    if (value) setAudioRole(timeline, scopeKey, value, { role: AUDIO_ROLE_DIALOGUE_DRIVE }, { global });
    return value;
}

export function clearStaleDialogueDriveAsset(timeline, scopeKey, validAssetIds, options = {}) {
    const current = getDialogueDriveAsset(timeline, scopeKey, options);
    if (!current) return false;
    const valid = new Set((validAssetIds || []).map(String));
    if (valid.has(current)) return false;
    const state = ensureAudioRoleState(timeline);
    const bucket = ensureScopeBucket(state, scopeKey, options);
    delete bucket[current];
    return true;
}
