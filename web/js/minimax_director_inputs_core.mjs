export const DIRECTOR_INPUTS_TYPE = "MMX_MOTION_DIR_INPUTS";
export const DIRECTOR_ASSETS_TYPE = "MMX_MOTION_DIR_ASSETS";
export const DIRECTOR_ASSETS_BLOCKED_TYPE = "MMX_MOTION_DIR_ASSETS_BLOCKED";
export const DIRECTOR_IMAGE_BLOCKED_TYPE = "MMX_MOTION_DIR_IMAGE_BLOCKED";
export const DIRECTOR_PROMPT_BLOCKED_TYPE = "MMX_MOTION_DIR_PROMPT_BLOCKED";

const MODE_PREFIX = Object.freeze({
    t2v: "text",
    i2v: "image",
    fl2v: "fl",
    r2v: "ref",
    v2v: "video",
    rv2v: "rv",
});

export function resolveDirectorTaskKey(value) {
    const text = String(value || "").trim().toLowerCase();
    const match = text.match(/(?:^|\b)(rv2v|fl2v|r2v|i2v|v2v|t2v)(?:\b|$)/i);
    return match ? match[1].toLowerCase() : "t2v";
}

export function parseDirectorTimeline(raw) {
    if (raw && typeof raw === "object") return raw;
    const text = String(raw || "").trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

export function directorGroupCount(timeline, mode) {
    const data = parseDirectorTimeline(timeline);
    const task = resolveDirectorTaskKey(mode);
    if (task === "fl2v" && Array.isArray(data.shots) && data.shots.length) {
        return Math.max(1, data.shots.length);
    }
    if (Array.isArray(data.segments) && data.segments.length) {
        return Math.max(1, data.segments.length);
    }
    return 1;
}

export function desiredDirectorInputSockets(mode, groupCount) {
    const task = resolveDirectorTaskKey(mode);
    const prefix = MODE_PREFIX[task] || "text";
    const count = Math.max(1, Number.parseInt(groupCount, 10) || 1);
    const out = [];

    for (let group = 1; group <= count; group += 1) {
        out.push({
            name: `${prefix}_prompt_${group}`,
            kind: "prompt",
            group,
            type: "STRING",
        });

        if (task === "i2v") {
            out.push({
                name: `image_${group}`,
                kind: "image",
                group,
                type: "IMAGE",
            });
        } else if (["fl2v", "r2v", "rv2v"].includes(task)) {
            out.push({
                name: `${prefix}_assets_${group}`,
                kind: "assets",
                group,
                type: DIRECTOR_ASSETS_TYPE,
            });
        }
    }
    return out;
}

export function desiredAssetSockets(mode) {
    const task = resolveDirectorTaskKey(mode);
    if (task === "fl2v") {
        return [
            { name: "first_image", type: "IMAGE" },
            { name: "last_image", type: "IMAGE" },
        ];
    }

    if (task === "r2v") {
        return [
            ...Array.from({ length: 9 }, (_, index) => ({ name: `image_${index + 1}`, type: "IMAGE" })),
            ...Array.from({ length: 3 }, (_, index) => ({ name: `video_${index + 1}`, type: "IMAGE" })),
            ...Array.from({ length: 3 }, (_, index) => ({ name: `audio_${index + 1}`, type: "AUDIO" })),
        ];
    }

    if (task === "rv2v") {
        return [
            ...Array.from({ length: 9 }, (_, index) => ({ name: `image_${index + 1}`, type: "IMAGE" })),
            ...Array.from({ length: 3 }, (_, index) => ({ name: `audio_${index + 1}`, type: "AUDIO" })),
        ];
    }

    return [];
}

function nonEmpty(value) {
    return typeof value === "string" ? value.trim().length > 0 : !!value;
}

function imageRefHasMedia(value) {
    if (typeof value === "string") return nonEmpty(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return nonEmpty(value.imageFile)
        || nonEmpty(value.image_file)
        || nonEmpty(value.imageB64)
        || nonEmpty(value.image_b64);
}

function listHasMedia(value) {
    if (!Array.isArray(value)) return false;
    return value.some((item) => {
        if (item == null) return false;
        if (typeof item !== "object" || Array.isArray(item)) return true;
        return [
            "imageFile", "image_file", "imageB64", "image_b64",
            "videoFile", "video_file", "audioFile", "audio_file",
            "fileName", "file_name",
        ].some((key) => nonEmpty(item[key]));
    });
}

function blockHasReferenceMedia(block) {
    if (!block || typeof block !== "object") return false;
    return [
        "refs", "refImages", "ref_images",
        "refVideos", "ref_videos",
        "refAudios", "ref_audios",
    ].some((key) => listHasMedia(block[key]));
}

export function timelineGroupHasInternalMedia(timeline, groupNumber, mode) {
    const data = parseDirectorTimeline(timeline);
    const task = resolveDirectorTaskKey(mode);
    const index = Math.max(0, (Number.parseInt(groupNumber, 10) || 1) - 1);
    const segment = Array.isArray(data.segments) ? (data.segments[index] || {}) : {};
    const shot = Array.isArray(data.shots) ? (data.shots[index] || {}) : {};

    if (imageRefHasMedia(segment.genImage || segment.gen_image)) return true;
    if (imageRefHasMedia(segment.endImage || segment.end_image)) return true;
    if (nonEmpty(segment.imageFile) || nonEmpty(segment.image_file)) return true;
    if (blockHasReferenceMedia(segment)) return true;
    if (imageRefHasMedia(shot.startImage || shot.start_image)) return true;
    if (imageRefHasMedia(shot.endImage || shot.end_image)) return true;

    const globalBlock = data.global || {};
    const commonBlock = data.r2vCommon || data.r2v_common || {};

    if (task === "i2v" && imageRefHasMedia(globalBlock.genImage || globalBlock.gen_image)) {
        return true;
    }
    if ((task === "r2v" || task === "rv2v")
        && (blockHasReferenceMedia(globalBlock) || blockHasReferenceMedia(commonBlock))) {
        return true;
    }
    return false;
}

export function timelineGroupHasInternalPrompt(timeline, groupNumber, mode) {
    const data = parseDirectorTimeline(timeline);
    const task = resolveDirectorTaskKey(mode);
    const index = Math.max(0, (Number.parseInt(groupNumber, 10) || 1) - 1);

    if (task === "fl2v") {
        const shot = Array.isArray(data.shots) ? (data.shots[index] || {}) : {};
        if (nonEmpty(shot.prompt)) return true;
    }

    const segment = Array.isArray(data.segments) ? (data.segments[index] || {}) : {};
    return nonEmpty(segment.prompt);
}

export function externalMediaGroupsFromInputs(inputs = []) {
    const groups = new Set();
    for (const input of inputs || []) {
        if (input?.link == null) continue;
        const name = String(input.name || "");
        let match = name.match(/_assets_([1-9][0-9]*)$/);
        if (!match) match = name.match(/^image_([1-9][0-9]*)$/);
        if (match) groups.add(Number.parseInt(match[1], 10));
    }
    return groups;
}

export function externalPromptGroupsFromInputs(inputs = []) {
    const groups = new Set();
    for (const input of inputs || []) {
        if (input?.link == null) continue;
        const match = String(input.name || "").match(/_prompt_([1-9][0-9]*)$/);
        if (match) groups.add(Number.parseInt(match[1], 10));
    }
    return groups;
}
