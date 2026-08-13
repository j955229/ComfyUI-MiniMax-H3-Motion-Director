import test from "node:test";
import assert from "node:assert/strict";

let runSelectionApi = {};
try {
    runSelectionApi = await import("../web/js/minimax_run_selection.mjs");
} catch {
    // The first RED run intentionally reaches here before the implementation exists.
}

const {
    commitRunSelectionMutation,
    ensureRunSelectionSerialized,
    runSelectionStateMatchesSerialized,
} = runSelectionApi;

function makeEditor({ enabled = false, selection = [], segmentCount = 3 } = {}) {
    const editor = {
        timeline: {
            runSelectEnabled: enabled,
            runSelection: [...selection],
            segments: Array.from({ length: segmentCount }, (_, index) => ({ id: `s${index}` })),
        },
        timelineWidget: { value: "{}" },
        _syncTimer: setTimeout(() => {}, 60_000),
        normalizeRunSelection() {
            if (!this.timeline.runSelectEnabled) return;
            const count = this.timeline.segments.length;
            this.timeline.runSelection = [...new Set(this.timeline.runSelection)]
                .filter((index) => index >= 0 && index < count)
                .sort((a, b) => a - b);
        },
        buildTimelinePayload() {
            return {
                segments: this.timeline.segments,
                runSelectEnabled: !!this.timeline.runSelectEnabled,
                runSelection: [...this.timeline.runSelection],
            };
        },
        _writeTimelineWidget() {
            this.timelineWidget.value = JSON.stringify(this.buildTimelinePayload());
        },
    };
    return editor;
}

test("Run Selection mutation synchronously serializes timeline_data before returning", () => {
    assert.equal(typeof commitRunSelectionMutation, "function");
    const editor = makeEditor();

    commitRunSelectionMutation(editor, () => {
        editor.timeline.runSelectEnabled = true;
        editor.timeline.runSelection = [1, 2];
    });

    assert.deepEqual(JSON.parse(editor.timelineWidget.value).runSelection, [1, 2]);
    assert.equal(JSON.parse(editor.timelineWidget.value).runSelectEnabled, true);
    assert.equal(runSelectionStateMatchesSerialized(editor), true);
});

test("Run Selection can be turned off by clicking the same toggle a second time", () => {
    const editor = makeEditor();
    const toggle = () => commitRunSelectionMutation(editor, () => {
        editor.timeline.runSelectEnabled = !editor.timeline.runSelectEnabled;
        if (editor.timeline.runSelectEnabled && !editor.timeline.runSelection.length) {
            editor.timeline.runSelection = [0, 1, 2];
        }
    });

    toggle();
    assert.equal(editor.timeline.runSelectEnabled, true);
    assert.equal(JSON.parse(editor.timelineWidget.value).runSelectEnabled, true);

    toggle();
    assert.equal(editor.timeline.runSelectEnabled, false);
    assert.equal(JSON.parse(editor.timelineWidget.value).runSelectEnabled, false);
});

test("cancel Segment 1 and queue at 0ms still serializes only Segment 2/3", () => {
    assert.equal(typeof ensureRunSelectionSerialized, "function");
    const editor = makeEditor({ enabled: true, selection: [0, 1, 2] });
    editor._writeTimelineWidget();

    commitRunSelectionMutation(editor, () => {
        editor.timeline.runSelection = [1, 2];
    });
    ensureRunSelectionSerialized(editor);

    const queued = JSON.parse(editor.timelineWidget.value);
    assert.deepEqual(queued.runSelection, [1, 2]);
    assert.equal(queued.runSelectEnabled, true);
});

test("segment deletion normalizes selection before the synchronous write", () => {
    assert.equal(typeof commitRunSelectionMutation, "function");
    const editor = makeEditor({ enabled: true, selection: [0, 1, 2] });

    commitRunSelectionMutation(editor, () => {
        editor.timeline.segments.splice(1, 1);
    });

    assert.deepEqual(editor.timeline.runSelection, [0, 1]);
    assert.deepEqual(JSON.parse(editor.timelineWidget.value).runSelection, [0, 1]);
});

test("queue preflight blocks when timeline_data cannot match memory", () => {
    assert.equal(typeof ensureRunSelectionSerialized, "function");
    const editor = makeEditor({ enabled: true, selection: [1, 2] });
    editor.timelineWidget.value = JSON.stringify({
        runSelectEnabled: true,
        runSelection: [0, 1, 2],
    });
    editor._writeTimelineWidget = () => {};

    assert.throws(
        () => ensureRunSelectionSerialized(editor),
        /Motion Director internal run-selection state mismatch\./,
    );
});
