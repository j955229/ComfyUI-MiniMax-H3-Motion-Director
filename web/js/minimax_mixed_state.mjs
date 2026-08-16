export const MIXED_SEGMENT_MODES = ["t2v", "i2v", "fl2v", "r2v", "source_video"];

const MODE_ALIASES = new Map([
    ["source video", "source_video"],
    ["source-video", "source_video"],
    ["source", "source_video"],
    ["v2v", "source_video"],
    ["rv2v", "source_video"],
]);

function normalizeMode(value) {
    const raw = String(value || "t2v").trim().toLowerCase();
    const mode = MODE_ALIASES.get(raw) || raw.replaceAll("-", "_").replaceAll(" ", "_");
    if (!MIXED_SEGMENT_MODES.includes(mode)) {
        throw new Error(`Unsupported Mixed segment mode: ${value}`);
    }
    return mode;
}

export function backendTaskPreview(mode, identityCount = 0) {
    const normalized = normalizeMode(mode);
    if (normalized === "source_video") return Number(identityCount) > 0 ? "rv2v" : "v2v";
    return normalized;
}

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function normalizeFrame(value) {
    const raw = value ?? "last";
    return String(raw).toLowerCase() === "last"
        ? "last"
        : Math.max(0, Number.parseInt(raw, 10) || 0);
}

function normalizeResultRef(ref = {}, consumerIndex, segments) {
    const originRaw = String(ref.origin || "")
        .trim()
        .toLowerCase()
        .replaceAll("-", "_")
        .replaceAll(" ", "_");
    const role = String(ref.role || "identity").trim().toLowerCase().replaceAll("-", "_");
    let segmentId = String(ref.segmentId || ref.segment_id || ref.sourceSegmentId || "").trim();

    // Compatibility migration only. New Mixed state persists one explicit
    // Segment Result concept keyed by stable segment id.
    if (["previous", "previous_segment", "prev"].includes(originRaw)) {
        segmentId = consumerIndex > 0 ? String(segments[consumerIndex - 1]?.id || "") : "";
    } else if (!["earlier", "earlier_segment", "specific_segment", "segment"].includes(originRaw)) {
        throw new Error(`Unsupported Mixed result reference origin: ${ref.origin}`);
    }

    return {
        role,
        origin: "segment",
        segmentId,
        frame: normalizeFrame(ref.frame ?? ref.frameIndex),
    };
}

function identityCount(inputs = {}) {
    const staticCount = Array.isArray(inputs.identityPictures)
        ? inputs.identityPictures.length
        : Array.isArray(inputs.pictures)
            ? inputs.pictures.length
            : 0;
    const dynamicCount = Array.isArray(inputs.resultRefs)
        ? inputs.resultRefs.filter((r) => r?.role === "identity").length
        : 0;
    return staticCount + dynamicCount;
}

export function newMixedSegment({ idFactory = () => `seg_${crypto.randomUUID()}`, mode = "t2v", duration = 5 } = {}) {
    const normalized = normalizeMode(mode);
    return {
        id: String(idFactory()),
        mode: normalized,
        prompt: "",
        duration: Number(duration) || 5,
        inputs: { resultRefs: [], identityPictures: [] },
        continuity: { visual: false, audio: false },
        backendTask: backendTaskPreview(normalized, 0),
    };
}

function prepareSegment(raw, { idFactory }) {
    const seg = clone(raw || {});
    seg.id = String(seg.id || seg.segmentId || idFactory());
    seg.mode = normalizeMode(seg.mode);
    seg.prompt = String(seg.prompt || "");
    seg.duration = Number(seg.duration ?? 5) || 5;
    seg.inputs = clone(seg.inputs || {});
    return seg;
}

function finalizeSegment(seg, index, segments) {
    seg.inputs.resultRefs = Array.isArray(seg.inputs.resultRefs)
        ? seg.inputs.resultRefs.map((ref) => normalizeResultRef(ref, index, segments))
        : [];
    seg.inputs.identityPictures = Array.isArray(seg.inputs.identityPictures)
        ? seg.inputs.identityPictures.map(clone)
        : [];
    if (Array.isArray(seg.inputs.pictures)) seg.inputs.pictures = seg.inputs.pictures.map(clone);
    const continuity = seg.continuity || {};
    seg.continuity = {
        visual: index > 0 && !!continuity.visual,
        audio: index > 0 && !!continuity.audio,
    };
    seg.backendTask = backendTaskPreview(seg.mode, identityCount(seg.inputs));
    return seg;
}

export function normalizeMixedTimeline(raw = {}, { idFactory = () => `seg_${crypto.randomUUID()}` } = {}) {
    const source = clone(raw || {});
    const segmentsRaw = Array.isArray(source.segments) && source.segments.length
        ? source.segments
        : [newMixedSegment({ idFactory })];
    const prepared = segmentsRaw.map((seg) => prepareSegment(seg, { idFactory }));
    const seen = new Set();
    for (const seg of prepared) {
        if (seen.has(seg.id)) throw new Error(`Duplicate segment id: ${seg.id}`);
        seen.add(seg.id);
    }
    const segments = prepared.map((seg, index) => finalizeSegment(seg, index, prepared));
    return {
        ...source,
        version: 1,
        timelineMode: "mixed",
        segments,
    };
}

export function duplicateMixedSegment(segments, index, { idFactory = () => `seg_${crypto.randomUUID()}` } = {}) {
    const out = clone(segments || []);
    if (index < 0 || index >= out.length) return out;
    const copy = clone(out[index]);
    copy.id = String(idFactory());
    out.splice(index + 1, 0, copy);
    return normalizeMixedTimeline({ timelineMode: "mixed", segments: out }, { idFactory }).segments;
}

export function moveMixedSegment(segments, fromIndex, toIndex) {
    const out = clone(segments || []);
    if (fromIndex < 0 || fromIndex >= out.length || toIndex < 0 || toIndex >= out.length || fromIndex === toIndex) {
        return out;
    }
    const [item] = out.splice(fromIndex, 1);
    out.splice(toIndex, 0, item);
    return out;
}

export function dependencyIndices(segments, consumerIndex) {
    if (consumerIndex < 0 || consumerIndex >= segments.length) return [];
    const ids = new Map(segments.map((seg, index) => [String(seg.id), index]));
    const seg = segments[consumerIndex];
    const deps = new Set();
    for (const ref of seg.inputs?.resultRefs || []) {
        if (ref.origin !== "segment") continue;
        const idx = ids.get(String(ref.segmentId || ""));
        if (idx != null && idx < consumerIndex) deps.add(idx);
    }
    if (consumerIndex > 0 && (seg.continuity?.visual || seg.continuity?.audio)) deps.add(consumerIndex - 1);
    return [...deps].sort((a, b) => a - b);
}

export function validateMixedReferences(segments) {
    const ids = new Map(segments.map((seg, index) => [String(seg.id), index]));
    const errors = [];
    segments.forEach((seg, consumerIndex) => {
        for (const ref of seg.inputs?.resultRefs || []) {
            if (ref.origin !== "segment") continue;
            const sourceId = String(ref.segmentId || "");
            const sourceIndex = ids.get(sourceId);
            if (sourceIndex == null) {
                errors.push({ code: "missing_reference", consumerId: seg.id, sourceId, message: "Referenced segment is missing." });
            } else if (sourceIndex >= consumerIndex) {
                errors.push({ code: "invalid_reference", consumerId: seg.id, sourceId, message: "Segment Result reference points forward after reorder." });
            }
        }
    });
    return errors;
}

export function referencedDependents(segments, sourceId) {
    const source = String(sourceId);
    return (segments || [])
        .filter((seg) => (seg.inputs?.resultRefs || []).some(
            (ref) => ref.origin === "segment" && String(ref.segmentId || "") === source,
        ))
        .map((seg) => String(seg.id));
}

const SLOT_ORIGINS = {
    source_video: ["upload"],
    r2v_reference_video: ["upload", "library"],
    r2v_reference_audio: ["upload", "library"],
    identity: ["upload", "library", "segment"],
    i2v_start: ["upload", "library", "segment"],
    fl2v_first: ["upload", "library", "segment"],
    fl2v_last: ["upload", "library", "segment"],
};

export function legalOriginsForSlot(slot) {
    return [...(SLOT_ORIGINS[String(slot)] || [])];
}
