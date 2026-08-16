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
        { id: "b", mode: "r2v" },
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
assert.deepEqual(dependencyIndices(timeline.segments, 2), [0, 1]);

const duplicated = duplicateMixedSegment(timeline.segments, 2, { idFactory });
assert.notEqual(duplicated[3].id, "c");
assert.equal(duplicated[3].inputs.resultRefs[0].segmentId, "a");

const moved = moveMixedSegment(timeline.segments, 0, 2);
const errors = validateMixedReferences(moved);
assert.ok(errors.some((e) => e.code === "invalid_reference" && e.consumerId === "c"));

assert.deepEqual(referencedDependents(timeline.segments, "a"), ["c"]);
assert.deepEqual(legalOriginsForSlot("source_video"), ["upload"]);
assert.deepEqual(legalOriginsForSlot("r2v_reference_video"), ["upload", "library"]);
assert.deepEqual(legalOriginsForSlot("identity"), ["upload", "library", "previous", "earlier"]);

console.log("mixed state tests passed");
