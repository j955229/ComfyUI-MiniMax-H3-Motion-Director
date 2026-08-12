// MiniMax H3 Motion Director — ephemeral per-mode Material Library selection state.

function occurrenceId() {
    if (globalThis.crypto?.randomUUID) return `occ_${crypto.randomUUID()}`;
    return `occ_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMaterialLibraryState(mode = "") {
    return {
        mode: String(mode || ""),
        activeType: "prompt",
        activeCategory: "",
        search: "",
        promptApplyMode: "append",
        target: null,
        fl2vRole: "first",
        images: [],
        audio: [],
        videos: [],
        prompts: [],
        fl2vFirstFrames: [],
        fl2vLastFrames: [],
    };
}

export function resetMaterialLibraryState(state, mode) {
    const fresh = createMaterialLibraryState(mode);
    Object.keys(state || {}).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    return state;
}

export function ensureMaterialLibraryMode(state, mode) {
    const normalized = String(mode || "");
    if (!state || typeof state !== "object") return createMaterialLibraryState(normalized);
    if (state.mode !== normalized) resetMaterialLibraryState(state, normalized);
    return state;
}

export function queueFor(state, kind, role = null) {
    if (kind === "image" && state?.mode === "fl2v") {
        return role === "last" ? state.fl2vLastFrames : state.fl2vFirstFrames;
    }
    if (kind === "image") return state.images;
    if (kind === "audio") return state.audio;
    if (kind === "video") return state.videos;
    if (kind === "prompt") return state.prompts;
    throw new Error(`Unknown Material Library queue: ${kind}`);
}

function compact(queue) {
    queue.forEach((entry, index) => { entry.order = index + 1; });
    return queue;
}

export function addMaterialOccurrence(state, kind, item, role = null) {
    const queue = queueFor(state, kind, role);
    const entry = {
        occurrenceId: occurrenceId(),
        itemId: String(item?.id || ""),
        item,
        order: queue.length + 1,
        role: role || null,
    };
    queue.push(entry);
    return entry;
}

export function removeLastMaterialOccurrence(state, kind, itemId, role = null) {
    const queue = queueFor(state, kind, role);
    const identity = String(itemId || "");
    for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (String(queue[index]?.itemId || "") === identity) {
            const [removed] = queue.splice(index, 1);
            compact(queue);
            return removed;
        }
    }
    return null;
}

export function ordersForMaterial(state, kind, itemId, role = null) {
    const identity = String(itemId || "");
    return queueFor(state, kind, role)
        .filter((entry) => String(entry?.itemId || "") === identity)
        .map((entry) => entry.order);
}

export function queueCounts(state) {
    return {
        image: state?.mode === "fl2v"
            ? (state.fl2vFirstFrames.length + state.fl2vLastFrames.length)
            : state?.images?.length || 0,
        audio: state?.audio?.length || 0,
        video: state?.videos?.length || 0,
        prompt: state?.prompts?.length || 0,
        first: state?.fl2vFirstFrames?.length || 0,
        last: state?.fl2vLastFrames?.length || 0,
    };
}

export function allSelectedItemIds(state) {
    const queues = [
        state?.images || [], state?.audio || [], state?.videos || [], state?.prompts || [],
        state?.fl2vFirstFrames || [], state?.fl2vLastFrames || [],
    ];
    return new Set(queues.flat().map((entry) => String(entry?.itemId || "")).filter(Boolean));
}


export function clearQueueSelections(state, kind, predicate = null, role = null) {
    const queue = queueFor(state, kind, role);
    if (typeof predicate !== "function") {
        queue.length = 0;
        compact(queue);
        return;
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (predicate(queue[index])) queue.splice(index, 1);
    }
    compact(queue);
}

export function clearSelectionsForTypeAndCategory(state, kind, category = "") {
    const matchCategory = String(category || "").trim();
    const match = (entry) => !matchCategory || String(entry?.item?.category || "").trim() === matchCategory;
    if (kind === "image" && state?.mode === "fl2v") {
        clearQueueSelections(state, "image", match, "first");
        clearQueueSelections(state, "image", match, "last");
        return;
    }
    clearQueueSelections(state, kind, match, null);
}

export function clearAllSelections(state) {
    clearQueueSelections(state, "image", null, null);
    clearQueueSelections(state, "audio", null, null);
    clearQueueSelections(state, "video", null, null);
    clearQueueSelections(state, "prompt", null, null);
    if (state?.mode === "fl2v") {
        clearQueueSelections(state, "image", null, "first");
        clearQueueSelections(state, "image", null, "last");
    }
}
