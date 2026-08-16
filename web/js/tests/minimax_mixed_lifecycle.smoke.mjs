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
});
window.confirm = () => true;

const { __extensions } = await import("../../../scripts/app.js");
await import("../zz_minimax_mixed_mode.js");
await import("../zzz_minimax_mixed_persistence.js");

const mixedExtension = __extensions.find((item) => item.name === "MiniMaxH3.MotionDirector.MixedMode");
const persistenceExtension = __extensions.find((item) => item.name === "MiniMaxH3.MotionDirector.MixedPersistence");
assert.ok(mixedExtension);
assert.ok(persistenceExtension);

class NodeType {
    onNodeCreated() {}
    onConfigure() {
        this._minimaxEditor.timeline = {
            version: 4,
            timelineMode: "video",
            global: { taskType: "t2v — 文生视频(Text to Video)" },
            segments: [{ id: "s0", start: 0, length: 124 }],
        };
        this._minimaxEditor.timelineWidget.value = JSON.stringify(this._minimaxEditor.timeline);
    }
    onWidgetChanged() {}
    onRemoved() {}
}
for (const extension of [mixedExtension, persistenceExtension]) {
    extension.beforeRegisterNodeDef(NodeType, { name: "MiniMaxH3MotionDirector" });
}

const serializedMixed = {
    version: 1,
    timelineMode: "mixed",
    frameRate: 24,
    output: { mode: "fixed", width: 864, height: 480, longEdge: 864, exportMode: "all", audioMode: "generate" },
    segments: [{
        id: "original_mixed",
        mode: "t2v",
        duration: 5,
        prompt: "persist me",
        inputs: { resultRefs: [] },
        continuity: {},
    }],
};

const generation = document.createElement("div");
const legacyRoot = document.createElement("div");
legacyRoot.id = "legacy-root";
const toolbar = document.createElement("div");
toolbar.className = "bd-toolbar-wrap";
const globalTask = document.createElement("select");
globalTask.dataset.r = "global-task";
for (const value of [
    "mixed — 混合模式(Mixed)",
    "t2v — 文生视频(Text to Video)",
    "r2v — 参考主体生视频(Reference to Video)",
]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    globalTask.appendChild(option);
}
globalTask.value = "mixed — 混合模式(Mixed)";
toolbar.appendChild(globalTask);
const legacyBody = document.createElement("div");
legacyBody.className = "bd-main";
legacyRoot.append(toolbar, legacyBody);
generation.appendChild(legacyRoot);
document.body.appendChild(generation);

const taskWidget = { name: "task_type", value: "mixed — 混合模式(Mixed)" };
const timelineWidget = { name: "timeline_data", value: JSON.stringify(serializedMixed) };
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
    mainBody: legacyBody,
    _directorModalController: { pages: { generation } },
    globalTask,
    taskTypeWidget: taskWidget,
    getDirectorMode: () => "video",
    applyTaskLayout() {},
    onGlobalField(field, value) {
        this.timeline.global = this.timeline.global || { refs: [] };
        this.timeline.global[field] = value;
        if (field === "taskType") {
            this.globalTask.value = value;
            this.taskTypeWidget.value = value;
            this.applyTaskLayout("video");
        }
    },
    buildTimelinePayload() { return this.timeline; },
    _writeTimelineWidget() { this.timelineWidget.value = JSON.stringify(this.timeline); },
    syncFromWidgets() {},
    getRunnableSegmentCount() { return 1; },
    supportsRunSelect() { return false; },
    isRunSelectEnabled() { return false; },
    normalizeRunSelection() {},
    isSegmentRunEnabled() { return true; },
};
globalTask.onchange = () => node._minimaxEditor.onGlobalField("taskType", globalTask.value);

node.onConfigure({});
await new Promise((resolve) => setTimeout(resolve, 1300));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(node._minimaxEditor._mmxMixedController.state.segments[0].id, "original_mixed");
assert.ok(globalTask.isConnected, "the existing Director mode selector must remain mounted while Mixed is active");
assert.ok(legacyRoot.isConnected, "Mixed must reuse the existing Director root instead of replacing the Generation page");

// Existing wrapper-level switch path remains supported.
globalTask.value = "t2v — 文生视频(Text to Video)";
taskWidget.value = globalTask.value;
node.onWidgetChanged("task_type", taskWidget.value);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(node._minimaxEditor._mmxMixedController, null);
assert.ok(globalTask.isConnected);
assert.notEqual(JSON.parse(timelineWidget.value).timelineMode, "mixed");

globalTask.value = "mixed — 混合模式(Mixed)";
taskWidget.value = globalTask.value;
node.onWidgetChanged("task_type", taskWidget.value);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(node._minimaxEditor._mmxMixedController.state.segments[0].id, "original_mixed");

// Exercise the real legacy Director dropdown path: onchange mutates
// editor.timeline before calling applyTaskLayout. Mixed must restore the
// standalone workspace first, then let the original handler apply R2V.
globalTask.value = "t2v — 文生视频(Text to Video)";
globalTask.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(node._minimaxEditor._mmxMixedController, null);
assert.match(String(node._minimaxEditor.timeline.global?.taskType || ""), /^t2v\b/i);

globalTask.value = "mixed — 混合模式(Mixed)";
globalTask.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(node._minimaxEditor._mmxMixedController.state.segments[0].id, "original_mixed");

globalTask.value = "r2v — 参考主体生视频(Reference to Video)";
globalTask.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(node._minimaxEditor._mmxMixedController, null);
assert.match(
    String(node._minimaxEditor.timeline.global?.taskType || ""),
    /^r2v\b/i,
    "real dropdown transition must apply the newly selected standalone task to the restored legacy workspace",
);

// Re-entering Mixed still recovers its independent state after the R2V switch.
globalTask.value = "mixed — 混合模式(Mixed)";
globalTask.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(node._minimaxEditor._mmxMixedController);
assert.equal(node._minimaxEditor._mmxMixedController.state.segments[0].id, "original_mixed");

node.onRemoved();
console.log("mixed lifecycle smoke passed");
