export const DIALOGUE_DRIVE_VERSION = 1;

export function ensureDialogueDriveState(timeline) {
    const root = timeline && typeof timeline === "object" ? timeline : {};
    let state = root.dialogueDrive;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        state = {};
        root.dialogueDrive = state;
    }
    state.version = DIALOGUE_DRIVE_VERSION;
    state.globalAssetId = String(state.globalAssetId || state.global_asset_id || "");
    const legacy = state.segment_asset_ids;
    state.segmentAssetIds = state.segmentAssetIds && typeof state.segmentAssetIds === "object"
        ? state.segmentAssetIds
        : (legacy && typeof legacy === "object" ? { ...legacy } : {});
    delete state.global_asset_id;
    delete state.segment_asset_ids;
    return state;
}

export function dialogueDriveScopeKey(segment, index = 0) {
    const id = String(segment?.id || "").trim();
    return id || String(Number(index) || 0);
}

export function getDialogueDriveAsset(timeline, scopeKey, { global = false } = {}) {
    const state = ensureDialogueDriveState(timeline);
    return global
        ? String(state.globalAssetId || "")
        : String(state.segmentAssetIds?.[String(scopeKey)] || "");
}

export function setDialogueDriveAsset(timeline, scopeKey, assetId, { global = false } = {}) {
    const state = ensureDialogueDriveState(timeline);
    const value = String(assetId || "").trim();
    if (global) {
        state.globalAssetId = value;
        return value;
    }
    const key = String(scopeKey);
    if (value) state.segmentAssetIds[key] = value;
    else delete state.segmentAssetIds[key];
    return value;
}

export function clearStaleDialogueDriveAsset(timeline, scopeKey, validAssetIds, options = {}) {
    const current = getDialogueDriveAsset(timeline, scopeKey, options);
    if (!current) return false;
    const valid = new Set((validAssetIds || []).map((value) => String(value)));
    if (valid.has(current)) return false;
    setDialogueDriveAsset(timeline, scopeKey, "", options);
    return true;
}
