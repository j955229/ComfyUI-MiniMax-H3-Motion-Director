// MiniMax H3 Motion Director — pure Material Library allocation planning.

function countExistingSegments(timeline, mode) {
    if (mode === "fl2v") return Array.isArray(timeline?.shots) ? timeline.shots.length : 0;
    return Array.isArray(timeline?.segments) ? timeline.segments.length : 0;
}

function assignment(queueKind, entry, segmentIndex, targetKind, extra = {}) {
    return {
        queueKind,
        occurrenceOrder: entry.order,
        itemId: entry.itemId,
        item: entry.item,
        segmentIndex,
        targetKind,
        ...extra,
    };
}

export function buildMaterialAllocationPlan({ mode, state, timeline }) {
    const key = String(mode || "");
    const assignments = [];
    const warnings = [];
    const existing = countExistingSegments(timeline, key);
    let requiredSegments = existing;
    let blockedReason = "";

    if (key === "t2v") {
        requiredSegments = Math.max(existing, state.prompts.length);
        state.prompts.forEach((entry, index) => assignments.push(assignment("prompt", entry, index, "prompt")));
    } else if (key === "i2v") {
        requiredSegments = Math.max(existing, state.images.length, state.prompts.length);
        state.images.forEach((entry, index) => assignments.push(assignment("image", entry, index, "start_image")));
        state.prompts.forEach((entry, index) => assignments.push(assignment("prompt", entry, index, "prompt")));
    } else if (key === "fl2v") {
        const anchors = Math.max(state.fl2vFirstFrames.length, state.fl2vLastFrames.length);
        requiredSegments = Math.max(existing, anchors);
        if (!requiredSegments && state.prompts.length) {
            blockedReason = "fl2v_prompt_without_shot";
        }
        state.fl2vFirstFrames.forEach((entry, index) => assignments.push(assignment("first", entry, index, "first_frame")));
        state.fl2vLastFrames.forEach((entry, index) => assignments.push(assignment("last", entry, index, "last_frame")));
        state.prompts.forEach((entry, index) => {
            if (index < requiredSegments) assignments.push(assignment("prompt", entry, index, "prompt"));
            else warnings.push({ code: "prompt_without_segment", order: entry.order });
        });
    } else if (key === "v2v") {
        requiredSegments = state.videos.length ? state.videos.length : existing;
        state.videos.forEach((entry, index) => assignments.push(assignment("video", entry, index, "source_video")));
        state.prompts.forEach((entry, index) => {
            if (index < requiredSegments) assignments.push(assignment("prompt", entry, index, "prompt"));
            else warnings.push({ code: "prompt_without_segment", order: entry.order });
        });
        if (!state.videos.length && !existing && state.prompts.length) blockedReason = "v2v_prompt_without_video";
    } else if (key === "r2v" || key === "rv2v") {
        if (!state.target) blockedReason = "target_required";
        const isCommon = key === "r2v" && state.target === "common";
        let segmentIndex = null;
        if (!isCommon && /^segment:\d+$/.test(String(state.target || ""))) {
            segmentIndex = Math.max(0, parseInt(String(state.target).split(":")[1], 10) || 0);
            if (segmentIndex >= existing) blockedReason = "invalid_target";
        } else if (!isCommon && state.target) {
            blockedReason = "invalid_target";
        }
        state.images.forEach((entry) => assignments.push(assignment("image", entry, segmentIndex, isCommon ? "common_picture" : "reference_picture")));
        state.audio.forEach((entry) => assignments.push(assignment("audio", entry, segmentIndex, isCommon ? "common_audio" : "reference_audio")));
        if (key === "r2v") {
            state.videos.forEach((entry) => assignments.push(assignment("video", entry, segmentIndex, isCommon ? "common_video" : "reference_video")));
        }
        if (isCommon && state.prompts.length) {
            warnings.push({ code: "prompt_not_allowed_common" });
        } else {
            state.prompts.forEach((entry) => assignments.push(assignment("prompt", entry, segmentIndex, "prompt")));
        }
    } else {
        blockedReason = "unsupported_mode";
    }

    return {
        mode: key,
        target: state.target,
        existingSegments: existing,
        requiredSegments,
        createSegments: Math.max(0, requiredSegments - existing),
        assignments,
        warnings,
        blockedReason,
    };
}
