import assert from "node:assert/strict";
import {
    ensureRunSelectionSerialized,
    runSelectionStateMatchesSerialized,
    queueDirectorRetake,
} from "../minimax_run_selection.mjs";

const mixedSerialized = JSON.stringify({
    timelineMode: "mixed",
    runSelectEnabled: true,
    runSelection: [0, 1],
});

const mixedEditor = {
    isMixedMode: () => true,
    timeline: {
        runSelectEnabled: false,
        runSelection: [],
    },
    mixedTimeline: {
        runSelectEnabled: true,
        runSelection: [0, 1],
    },
    timelineWidget: { value: mixedSerialized },
    flushTimelineSync() {
        this.timelineWidget.value = mixedSerialized;
    },
    normalizeRunSelection() {},
    _writeTimelineWidget() {
        this.timelineWidget.value = mixedSerialized;
    },
};

assert.equal(
    runSelectionStateMatchesSerialized(mixedEditor),
    true,
    "Mixed Mode must compare serialized run selection against editor.mixedTimeline",
);
assert.doesNotThrow(
    () => ensureRunSelectionSerialized(mixedEditor),
    "persisted Mixed workflows must queue without a false run-selection mismatch",
);

const normalEditor = {
    isMixedMode: () => false,
    timeline: {
        runSelectEnabled: true,
        runSelection: [2],
    },
    mixedTimeline: {
        runSelectEnabled: true,
        runSelection: [0, 1],
    },
    timelineWidget: {
        value: JSON.stringify({ runSelectEnabled: true, runSelection: [2] }),
    },
};

assert.equal(
    runSelectionStateMatchesSerialized(normalEditor),
    true,
    "Normal modes must continue using editor.timeline",
);

console.log("run selection tests passed");

const retakeTimeline = JSON.stringify({ runSelectEnabled: true, runSelection: [2] });
let confirmed = false;
let submitted = [];
let messages = [];
let failSubmission = false;
const retakeEditor = {
    node: { id: 9 },
    timeline: JSON.parse(retakeTimeline),
    timelineWidget: { value: retakeTimeline },
    isMixedMode: () => false,
    showBdDialog: async () => confirmed,
    showBdMessage: async (_title, message) => messages.push(message),
};
const retakeServices = {
    translate: (key) => key,
    app: {
        graphToPrompt: async () => ({
            output: { 9: { inputs: { timeline_data: retakeTimeline } }, 8: { inputs: { value: "unchanged" } } },
            workflow: { nodes: [{ id: 9, widgets_values: [retakeTimeline] }] },
        }),
    },
    api: {
        queuePrompt: async (number, payload, options) => {
            if (failSubmission) throw new Error("Submission failed");
            submitted.push({ number, payload, options });
        },
    },
};
assert.equal(await queueDirectorRetake(retakeEditor, retakeServices), false);
assert.equal(submitted.length, 0, "Cancel must not queue anything");
confirmed = true;
assert.equal(await queueDirectorRetake(retakeEditor, retakeServices), true);
assert.deepEqual(submitted[0].options, { partialExecutionTargets: ["9"] });
const firstRetake = JSON.parse(submitted[0].payload.output[9].inputs.timeline_data);
assert.ok(firstRetake.retake);
assert.deepEqual(firstRetake.runSelection, [2]);
assert.equal(submitted[0].payload.workflow.nodes[0].widgets_values[0], retakeTimeline);
assert.equal(retakeEditor.timelineWidget.value, retakeTimeline, "Override must not persist on the node");
assert.deepEqual(submitted[0].payload.output[8].inputs, { value: "unchanged" });
await queueDirectorRetake(retakeEditor, retakeServices);
assert.notEqual(JSON.parse(submitted[1].payload.output[9].inputs.timeline_data).retake, firstRetake.retake,
    "Repeated retakes must invalidate ComfyUI's node execution cache");
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
try {
    for (const crypto of [{}, undefined]) {
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: crypto });
        assert.equal(await queueDirectorRetake(retakeEditor, retakeServices), true,
            "Retakes must queue without crypto.randomUUID or the crypto API");
        assert.equal(retakeEditor.timelineWidget.value, retakeTimeline);
    }
    const nonces = submitted.map(({ payload }) => JSON.parse(payload.output[9].inputs.timeline_data).retake);
    assert.equal(new Set(nonces).size, nonces.length, "Every retake must have a distinct nonce");
} finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else delete globalThis.crypto;
}
failSubmission = true;
assert.equal(await queueDirectorRetake(retakeEditor, retakeServices), false);
assert.equal(messages.pop(), "Submission failed");
assert.equal(retakeEditor.timelineWidget.value, retakeTimeline);
retakeEditor.timeline.runSelection = [];
retakeEditor.timelineWidget.value = JSON.stringify(retakeEditor.timeline);
assert.equal(await queueDirectorRetake(retakeEditor, retakeServices), false);
assert.equal(messages.pop(), "modal.retakeSelect");
console.log("Retake confirmation and one-job submission tests passed");
