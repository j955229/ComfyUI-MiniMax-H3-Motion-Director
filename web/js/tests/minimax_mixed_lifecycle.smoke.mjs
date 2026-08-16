import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
});
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    navigator: dom.window.navigator,
});
window.confirm = () => true;

const { __extensions } = await import("../../../scripts/app.js");
await import("../zz_minimax_mixed_mode.js");
await import("../zzz_minimax_mixed_persistence.js");

const mixedExtension = __extensions.find(
    (item) => item.name === "MiniMaxH3.MotionDirector.MixedMode",
);
const persistenceExtension = __extensions.find(
    (item) => item.name === "MiniMaxH3.MotionDirector.MixedPersistence",
);
assert.ok(mixedExtension);
assert.ok(persistenceExtension);

class NodeType {
    onNodeCreated() {}

    onConfigure() {
        // Deliberately emulate the legacy editor normalizing an unknown
        // timelineMode before the Mixed extension gets its async mount turn.
        this._minimaxEditor.timeline = {
            version: 4,
            timelineMode: "video",
            segments: [{ id: "s0", start: 0, length: 124 }],
        };
        this._minimaxEditor.timelineWidget.value = JSON.stringify(
            this._minimaxEditor.timeline,
        );
    }

    onWidgetChanged() {}
    onRemoved() {}
}

// Registration order must not matter: each wrapper calls the previous hook.
for (const extension of [mixedExtension, persistenceExtension]) {
    extension.beforeRegisterNodeDef(NodeType, { name: "MiniMaxH3MotionDirector" });
}

const serializedMixed = {
    version: 1,
    timelineMode: "mixed",
    frameRate: 24,
    output: {
        mode: "fixed",
        width: 864,
        height: 480,
        longEdge: 864,
        exportMode: "all",
        audioMode: "generate",
    },
    segments: [
        {
            id: "original_mixed",
            mode: "t2v",
            duration: 5,
            prompt: "persist me",
            inputs: { resultRefs: [] },
            continuity: {},
        },
    ],
};

const generation = document.createElement("div");
const legacyRoot = document.createElement("div");
legacyRoot.id = "legacy-root";
const taskWidget = {
    name: "task_type",
    value: "mixed — 混合模式(Mixed)",
};
const timelineWidget = {
    name: "timeline_data",
    value: JSON.stringify(serializedMixed),
};
const node = new NodeType();
Object.assign(node, {
    id: 77,
    widgets: [
        taskWidget,
        timelineWidget,
        { name: "frame_rate", value: 24 },
        { name: "width", value: 864 },
        { name: "height", value: 480 },
        { name: "ref_max_size", value: 864 },
        { name: "global_prompt", value: "" },
        { name: "total_frames", value: 124 },
    ],
    setDirtyCanvas() {},
});
node._minimaxEditor = {
    node,
    timelineWidget,
    timeline: structuredClone(serializedMixed),
    selectedIndex: 0,
    root: legacyRoot,
    _directorModalController: { pages: { generation } },
    globalTask: taskWidget,
    getDirectorMode: () => "video",
    applyTaskLayout() {},
    buildTimelinePayload() {
        return this.timeline;
    },
    _writeTimelineWidget() {
        this.timelineWidget.value = JSON.stringify(this.timeline);
    },
    syncFromWidgets() {},
    getRunnableSegmentCount() {
        return 1;
    },
    supportsRunSelect() {
        return false;
    },
    isRunSelectEnabled() {
        return false;
    },
    normalizeRunSelection() {},
    isSegmentRunEnabled() {
        return true;
    },
};

node.onConfigure({});
await new Promise((resolve) => setTimeout(resolve, 1300));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(
    node._minimaxEditor._mmxMixedController.state.segments[0].id,
    "original_mixed",
    "legacy configure must not erase serialized Mixed state",
);

// Switching out must restore a standalone-shaped timeline, while switching
// back must recover the independent Mixed workspace unchanged.
taskWidget.value = "t2v — 文生视频(Text to Video)";
node.onWidgetChanged("task_type", taskWidget.value);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(node._minimaxEditor._mmxMixedController, null);
assert.notEqual(JSON.parse(timelineWidget.value).timelineMode, "mixed");

taskWidget.value = "mixed — 混合模式(Mixed)";
node.onWidgetChanged("task_type", taskWidget.value);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(
    node._minimaxEditor._mmxMixedController.state.segments[0].id,
    "original_mixed",
);

node.onRemoved();
console.log("mixed lifecycle smoke passed");
