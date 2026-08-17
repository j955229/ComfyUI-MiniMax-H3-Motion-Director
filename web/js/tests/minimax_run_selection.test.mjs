import assert from "node:assert/strict";
import {
    ensureRunSelectionSerialized,
    runSelectionStateMatchesSerialized,
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
