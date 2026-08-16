import assert from "node:assert/strict";
import {
    desiredDirectorInputSockets,
    resolveDirectorTaskKey,
} from "../minimax_director_inputs_core.mjs";
import {
    MIXED_SEGMENT_MODES,
    backendTaskPreview,
    dependencyIndices,
    duplicateMixedSegment,
    legalOriginsForSlot,
    moveMixedSegment,
    newMixedSegment,
    normalizeMixedTimeline,
    referencedDependents,
    validateMixedReferences,
} from "../minimax_mixed_state.mjs";

assert.equal(resolveDirectorTaskKey("mixed — 混合模式(Mixed)"), "mixed");
assert.deepEqual(desiredDirectorInputSockets("mixed", 6), []);

const standaloneCases = [
    ["t2v — 文生视频(Text to Video)", "t2v", ["text_prompt_1", "text_prompt_2"]],
    ["i2v — 图生视频(Image to Video)", "i2v", ["image_prompt_1", "image_1", "image_prompt_2", "image_2"]],
    ["fl2v — 首尾帧生视频(First-Last Frame)", "fl2v", ["fl_prompt_1", "fl_assets_1", "fl_prompt_2", "fl_assets_2"]],
    ["r2v — 参考主体生视频(Reference to Video)", "r2v", ["ref_prompt_1", "ref_assets_1", "ref_prompt_2", "ref_assets_2"]],
    ["v2v — 视频转视频(Video to Video)", "v2v", ["video_prompt_1", "video_prompt_2"]],
    ["rv2v — 参考素材改视频(Reference Video Edit)", "rv2v", ["rv_prompt_1", "rv_assets_1", "rv_prompt_2", "rv_assets_2"]],
];
for (const [label, key, expectedSockets] of standaloneCases) {
    assert.equal(resolveDirectorTaskKey(label), key);
    assert.deepEqual(
        desiredDirectorInputSockets(label, 2).map((socket) => socket.name),
        expectedSockets,
        `${key} Director Inputs routing changed`,
    );
}

assert.deepEqual(MIXED_SEGMENT_MODES, ["t2v", "i2v", "fl2v", "r2v", "source_video"]);
assert.equal(backendTaskPreview("source_video", 0), "v2v");
assert.equal(backendTaskPreview("source_video", 2), "rv2v");

let seq = 0;
const idFactory = () => `seg_${++seq}`;
const created = newMixedSegment({ idFactory });
assert.equal(created.id, "seg_1");
assert.equal(created.mode, "t2v");

const timeline = normalizeMixedTimeline({
    timelineMode: "mixed",
    segments: [
        { id: "a", mode: "t2v" },
        {
            id: "b",
            mode: "i2v",
            inputs: {
                resultRefs: [{ role: "i2v_start", origin: "previous", frame: "last" }],
            },
        },
        {
            id: "c",
            mode: "source_video",
            inputs: {
                sourceVideo: { videoFile: "fight.mp4", range: { startSec: 1, endSec: 3 } },
                resultRefs: [{ role: "identity", origin: "earlier", segmentId: "a", frame: "last" }],
            },
            continuity: { visual: true, audio: false },
        },
    ],
}, { idFactory });

assert.equal(timeline.version, 1);
assert.equal(timeline.segments[2].backendTask, "rv2v");
assert.deepEqual(
    timeline.segments[1].inputs.resultRefs[0],
    { role: "i2v_start", origin: "segment", segmentId: "a", frame: "last" },
    "legacy Previous must migrate to the concrete preceding stable segment id",
);
assert.deepEqual(
    timeline.segments[2].inputs.resultRefs[0],
    { role: "identity", origin: "segment", segmentId: "a", frame: "last" },
    "legacy Earlier must migrate to canonical Segment Result",
);
assert.deepEqual(dependencyIndices(timeline.segments, 2), [0, 1]);

const duplicated = duplicateMixedSegment(timeline.segments, 2, { idFactory });
assert.notEqual(duplicated[3].id, "c");
assert.equal(duplicated[3].inputs.resultRefs[0].origin, "segment");
assert.equal(duplicated[3].inputs.resultRefs[0].segmentId, "a");

const moved = moveMixedSegment(timeline.segments, 0, 2);
const errors = validateMixedReferences(moved);
assert.ok(errors.some((e) => e.code === "invalid_reference" && e.consumerId === "c"));

assert.deepEqual(referencedDependents(timeline.segments, "a").sort(), ["b", "c"]);
assert.deepEqual(legalOriginsForSlot("source_video"), ["upload"]);
assert.deepEqual(legalOriginsForSlot("r2v_reference_video"), ["upload", "library"]);
assert.deepEqual(legalOriginsForSlot("identity"), ["upload", "library", "segment"]);
assert.deepEqual(legalOriginsForSlot("i2v_start"), ["upload", "library", "segment"]);

console.log("mixed state tests passed");
