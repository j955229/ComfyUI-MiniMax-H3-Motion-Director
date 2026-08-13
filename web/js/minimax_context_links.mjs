export const CONTEXT_LINK_SCHEMA = "previous_context_link_v1";

function asBool(value, fallback = false) {
    if (value == null) return !!fallback;
    if (value === false || value === 0 || value === "0") return false;
    const text = String(value).trim().toLowerCase();
    return text !== "false" && text !== "off" && text !== "no";
}

export function normalizedContextLink(raw, index, legacy = {}) {
    if (Number(index) <= 0) {
        return { schema: CONTEXT_LINK_SCHEMA, enabled: false, visual: false, audio: false };
    }
    const saved = raw && typeof raw === "object" ? raw : null;
    if (saved) {
        const enabled = asBool(saved.enabled, true);
        const visual = asBool(saved.visual, enabled);
        const audio = asBool(saved.audio, enabled);
        return {
            schema: CONTEXT_LINK_SCHEMA,
            enabled: enabled && (visual || audio),
            visual,
            audio,
        };
    }
    const visual = asBool(legacy.visual, false);
    const audio = visual && asBool(legacy.audio, false);
    return {
        schema: CONTEXT_LINK_SCHEMA,
        enabled: visual || audio,
        visual,
        audio,
    };
}

export function legacyContextDefaults({
    taskKey = "",
    motionEnabled = false,
    audioEnabled = false,
    audioGenerate = true,
    sourceBridgeFrames = 0,
    hasExplicitI2vImage = false,
} = {}) {
    const bridge = ["v2v", "rv2v"].includes(String(taskKey).toLowerCase())
        && Number(sourceBridgeFrames) === 5;
    const imageReset = String(taskKey).toLowerCase() === "i2v" && !!hasExplicitI2vImage;
    const visual = !!motionEnabled && !bridge && !imageReset;
    return { visual, audio: visual && !!audioEnabled && !!audioGenerate };
}

export function ensureTimelineContextLinks(timeline, defaultsForSegment = () => ({})) {
    const segments = Array.isArray(timeline?.segments) ? timeline.segments : [];
    segments.forEach((segment, index) => {
        const raw = segment?.contextLink ?? segment?.context_link;
        segment.contextLink = normalizedContextLink(raw, index, defaultsForSegment(segment, index));
        delete segment.context_link;
    });
    return timeline;
}

export function toggleContextLink(link, index) {
    const current = normalizedContextLink(link, index);
    if (Number(index) <= 0) return current;
    if (current.enabled && (current.visual || current.audio)) {
        return { ...current, enabled: false, visual: false, audio: false };
    }
    return { ...current, enabled: true, visual: true, audio: true };
}

export function setContextLinkChannels(link, index, { visual, audio }) {
    const current = normalizedContextLink(link, index);
    if (Number(index) <= 0) return current;
    const nextVisual = visual == null ? current.visual : !!visual;
    const nextAudio = audio == null ? current.audio : !!audio;
    return {
        ...current,
        enabled: nextVisual || nextAudio,
        visual: nextVisual,
        audio: nextAudio,
    };
}

export function contextLinkMode(link, index) {
    const value = normalizedContextLink(link, index);
    if (!value.enabled) return "off";
    if (value.visual && value.audio) return "both";
    if (value.visual) return "visual";
    if (value.audio) return "audio";
    return "off";
}
