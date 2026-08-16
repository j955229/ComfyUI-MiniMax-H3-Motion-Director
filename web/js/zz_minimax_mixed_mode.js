import { app } from "../../scripts/app.js";
import { resolveDirectorTaskKey } from "./minimax_director_inputs_core.mjs?boot=mixed_mode_v1";
import {
    mountMixedUI,
    parseOrCreateMixedTimeline,
    syncMixedGlobalsFromWidgets,
} from "./minimax_mixed_ui.mjs?boot=mixed_mode_v1";
import { normalizeMixedTimeline } from "./minimax_mixed_state.mjs?boot=mixed_mode_v1";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function widgetByName(node, name) {
    return node?.widgets?.find((widget) => widget?.name === name) || null;
}

function currentTaskKey(node, editor = node?._minimaxEditor) {
    const value = widgetByName(node, "task_type")?.value
        || editor?.globalTask?.value
        || editor?.timeline?.global?.taskType
        || "t2v";
    return resolveDirectorTaskKey(value);
}

function stampNodeId(editor, state) {
    if (state && editor?.node?.id != null) state.nodeId = String(editor.node.id);
    return state;
}

function writeState(editor, nextState, { render = false } = {}) {
    if (!editor?.timelineWidget) return;
    const normalized = normalizeMixedTimeline(stampNodeId(editor, clone(nextState)));
    syncMixedGlobalsFromWidgets(editor, normalized);
    stampNodeId(editor, normalized);
    editor._mmxMixedWorkspace = clone(normalized);
    editor.timeline = normalized;
    editor.timelineWidget.value = JSON.stringify(normalized);
    if (render && editor._mmxMixedController) {
        editor._mmxMixedController.setState(normalized);
    }
    editor.node?.setDirtyCanvas?.(true, false);
}

function saveLegacyWorkspace(editor) {
    const raw = String(editor.timelineWidget?.value || "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    if (String(parsed?.timelineMode || "").toLowerCase() === "mixed") return;
    editor._mmxLegacyBeforeMixed = {
        timeline: clone(editor.timeline || {}),
        serialized: raw,
        selectedIndex: Number(editor.selectedIndex || 0),
    };
}

function legacyFallback(editor) {
    const taskType = String(widgetByName(editor?.node, "task_type")?.value || "t2v — 文生视频(Text to Video)");
    const prompt = String(widgetByName(editor?.node, "global_prompt")?.value || "");
    const frameRate = Number(widgetByName(editor?.node, "frame_rate")?.value || 24) || 24;
    const width = Number(widgetByName(editor?.node, "width")?.value || 864) || 864;
    const height = Number(widgetByName(editor?.node, "height")?.value || 480) || 480;
    const refMaxSize = Number(widgetByName(editor?.node, "ref_max_size")?.value || 864) || 864;
    const totalFrames = Number(widgetByName(editor?.node, "total_frames")?.value || 124) || 124;
    return {
        version: 4,
        editMode: "global",
        totalFrames,
        frameRate,
        width,
        height,
        refMaxSize,
        output: {
            mode: "fixed",
            longEdge: refMaxSize,
            width,
            height,
            maxExportFrames: 0,
            exportMode: "all",
            audioMode: "generate",
        },
        videoClips: [],
        video: {
            fileName: "",
            videoFile: "",
            subfolder: "",
            type: "input",
            frames: [],
            frameMap: [],
        },
        global: {
            taskType,
            prompt,
            refs: [],
            referenceVideo: {},
            continuousReference: false,
        },
        segments: [{
            id: "s0",
            start: 0,
            length: totalFrames,
            prompt: "",
            taskType: "",
            refs: [],
            referenceVideo: {},
        }],
    };
}

function restoreLegacyWorkspace(editor) {
    const saved = editor._mmxLegacyBeforeMixed;
    if (saved) {
        editor.timeline = clone(saved.timeline || {});
        editor.selectedIndex = Number(saved.selectedIndex || 0);
        if (editor.timelineWidget && saved.serialized) editor.timelineWidget.value = saved.serialized;
        return true;
    }

    // A workflow may be loaded while already in Mixed mode, so there may be no
    // prior standalone workspace to restore. Build the same minimal legacy
    // shape used by the backend default instead of handing Mixed JSON to the
    // old six-mode editor.
    const fallback = legacyFallback(editor);
    editor.timeline = fallback;
    editor.selectedIndex = 0;
    if (editor.timelineWidget) editor.timelineWidget.value = JSON.stringify(fallback);
    return false;
}

function mixedGlobalWidgetCapture(editor, event) {
    const target = event?.target;
    if (!target || target.tagName !== "INPUT") return;
    const label = target.closest?.(".mmx-mixed-global label");
    if (!label) return;
    const prefix = Array.from(label.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .trim();
    const widgetName = ({ FPS: "frame_rate", Width: "width", Height: "height" })[prefix];
    if (!widgetName) return;
    const widget = widgetByName(editor.node, widgetName);
    const value = Number(target.value);
    if (widget && Number.isFinite(value)) widget.value = value;
}

function enterMixed(editor) {
    if (!editor?._directorModalController?.pages?.generation) return false;
    if (editor._mmxMixedController) return true;

    saveLegacyWorkspace(editor);
    const state = editor._mmxMixedWorkspace
        ? normalizeMixedTimeline(editor._mmxMixedWorkspace)
        : parseOrCreateMixedTimeline(editor);
    stampNodeId(editor, state);
    editor._mmxMixedWorkspace = clone(state);
    editor.timeline = state;

    const host = editor._directorModalController.pages.generation;
    editor._mmxLegacyGenerationRoot = editor.root || editor._mmxLegacyGenerationRoot || null;
    editor._mmxMixedController = mountMixedUI({
        host,
        editor,
        initialState: state,
        onChange(next) {
            if (currentTaskKey(editor.node, editor) !== "mixed") return;
            writeState(editor, next, { render: false });
        },
    });
    const capture = (event) => mixedGlobalWidgetCapture(editor, event);
    editor._mmxMixedGlobalCapture = capture;
    editor._mmxMixedController.root.addEventListener("change", capture, true);
    writeState(editor, state, { render: false });
    editor.selectedIndex = 0;
    editor.node?.setDirtyCanvas?.(true, true);
    return true;
}

function leaveMixed(editor) {
    if (!editor?._mmxMixedController) return false;
    editor._mmxMixedWorkspace = stampNodeId(editor, editor._mmxMixedController.state);
    if (editor._mmxMixedGlobalCapture) {
        editor._mmxMixedController.root.removeEventListener(
            "change",
            editor._mmxMixedGlobalCapture,
            true,
        );
        editor._mmxMixedGlobalCapture = null;
    }
    editor._mmxMixedController.destroy();
    editor._mmxMixedController = null;
    const host = editor._directorModalController?.pages?.generation;
    if (host && editor._mmxLegacyGenerationRoot) {
        host.replaceChildren(editor._mmxLegacyGenerationRoot);
    }
    restoreLegacyWorkspace(editor);
    editor.node?.setDirtyCanvas?.(true, true);
    return true;
}

function normalizeMixedRunSelection(editor) {
    const state = editor._mmxMixedController?.state || editor._mmxMixedWorkspace || editor.timeline;
    if (!state || String(state.timelineMode || "").toLowerCase() !== "mixed") return;
    const count = state.segments?.length || 0;
    const selection = [...new Set((state.runSelection || [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < count))]
        .sort((a, b) => a - b);
    state.runSelection = state.runSelectEnabled
        ? (selection.length ? selection : [...Array(count).keys()])
        : [];
    stampNodeId(editor, state);
    editor._mmxMixedWorkspace = clone(state);
    editor.timeline = state;
}

function patchEditor(editor) {
    if (!editor || editor._mmxMixedPatched) return false;
    editor._mmxMixedPatched = true;

    const original = {
        getDirectorMode: editor.getDirectorMode?.bind(editor),
        applyTaskLayout: editor.applyTaskLayout?.bind(editor),
        buildTimelinePayload: editor.buildTimelinePayload?.bind(editor),
        writeTimeline: editor._writeTimelineWidget?.bind(editor),
        syncFromWidgets: editor.syncFromWidgets?.bind(editor),
        getRunnableSegmentCount: editor.getRunnableSegmentCount?.bind(editor),
        supportsRunSelect: editor.supportsRunSelect?.bind(editor),
        isRunSelectEnabled: editor.isRunSelectEnabled?.bind(editor),
        normalizeRunSelection: editor.normalizeRunSelection?.bind(editor),
        isSegmentRunEnabled: editor.isSegmentRunEnabled?.bind(editor),
    };
    editor._mmxMixedOriginal = original;

    editor.getDirectorMode = function (taskTypeValue) {
        const key = resolveDirectorTaskKey(
            taskTypeValue
            || widgetByName(this.node, "task_type")?.value
            || this.globalTask?.value
            || "",
        );
        if (key === "mixed") return "mixed";
        return original.getDirectorMode?.(taskTypeValue) || "video";
    };

    editor.applyTaskLayout = function () {
        const key = currentTaskKey(this.node, this);
        if (key === "mixed") {
            enterMixed(this);
            return;
        }
        if (this._mmxMixedController) leaveMixed(this);
        return original.applyTaskLayout?.apply(this, arguments);
    };

    editor.syncFromWidgets = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            const state = this._mmxMixedController?.state || this._mmxMixedWorkspace || this.timeline;
            if (state) {
                syncMixedGlobalsFromWidgets(this, state);
                stampNodeId(this, state);
                this._mmxMixedWorkspace = clone(state);
                this.timeline = state;
            }
            return;
        }
        return original.syncFromWidgets?.apply(this, arguments);
    };

    editor.buildTimelinePayload = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            const state = this._mmxMixedController?.state || this._mmxMixedWorkspace || this.timeline;
            normalizeMixedRunSelection(this);
            syncMixedGlobalsFromWidgets(this, state);
            stampNodeId(this, state);
            return clone(state);
        }
        return original.buildTimelinePayload?.apply(this, arguments);
    };

    editor._writeTimelineWidget = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            const payload = this.buildTimelinePayload();
            stampNodeId(this, payload);
            this._mmxMixedWorkspace = clone(payload);
            this.timeline = payload;
            if (this.timelineWidget) this.timelineWidget.value = JSON.stringify(payload);
            this.node?.setDirtyCanvas?.(true, false);
            return;
        }
        return original.writeTimeline?.apply(this, arguments);
    };

    editor.getRunnableSegmentCount = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            return Number(
                (this._mmxMixedController?.state || this._mmxMixedWorkspace || this.timeline)
                    ?.segments?.length || 0,
            );
        }
        return original.getRunnableSegmentCount?.apply(this, arguments) ?? 0;
    };

    editor.supportsRunSelect = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            return this.getRunnableSegmentCount() >= 2;
        }
        return original.supportsRunSelect?.apply(this, arguments) ?? false;
    };

    editor.isRunSelectEnabled = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            return !!(
                this._mmxMixedController?.state
                || this._mmxMixedWorkspace
                || this.timeline
            )?.runSelectEnabled;
        }
        return original.isRunSelectEnabled?.apply(this, arguments) ?? false;
    };

    editor.normalizeRunSelection = function () {
        if (currentTaskKey(this.node, this) === "mixed") {
            normalizeMixedRunSelection(this);
            return;
        }
        return original.normalizeRunSelection?.apply(this, arguments);
    };

    editor.isSegmentRunEnabled = function (index) {
        if (currentTaskKey(this.node, this) === "mixed") {
            const state = this._mmxMixedController?.state || this._mmxMixedWorkspace || this.timeline;
            if (!state?.runSelectEnabled) return true;
            return (state.runSelection || []).includes(Number(index));
        }
        return original.isSegmentRunEnabled?.apply(this, arguments) ?? true;
    };

    if (currentTaskKey(editor.node, editor) === "mixed") enterMixed(editor);
    return true;
}

function syncNode(node) {
    const editor = node?._minimaxEditor;
    if (!editor) return false;
    patchEditor(editor);
    const mixed = currentTaskKey(node, editor) === "mixed";
    if (mixed && !editor._mmxMixedController) enterMixed(editor);
    if (!mixed && editor._mmxMixedController) editor.applyTaskLayout?.();
    return true;
}

function scheduleSync(node) {
    node._mmxMixedTimers = node._mmxMixedTimers || new Set();
    for (const delay of [0, 60, 180, 500, 1200]) {
        const timer = setTimeout(() => {
            node._mmxMixedTimers?.delete(timer);
            syncNode(node);
        }, delay);
        node._mmxMixedTimers.add(timer);
    }
}

function wrapDirector(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        scheduleSync(this);
        return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        scheduleSync(this);
        return result;
    };

    const onWidgetChanged = nodeType.prototype.onWidgetChanged;
    nodeType.prototype.onWidgetChanged = function () {
        const result = onWidgetChanged?.apply(this, arguments);
        queueMicrotask(() => syncNode(this));
        return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        for (const timer of this._mmxMixedTimers || []) clearTimeout(timer);
        this._mmxMixedTimers?.clear?.();
        if (this._minimaxEditor?._mmxMixedController && this._minimaxEditor._mmxMixedGlobalCapture) {
            this._minimaxEditor._mmxMixedController.root.removeEventListener(
                "change",
                this._minimaxEditor._mmxMixedGlobalCapture,
                true,
            );
        }
        this._minimaxEditor?._mmxMixedController?.destroy?.();
        return onRemoved?.apply(this, arguments);
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.MixedMode",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;
        wrapDirector(nodeType);
    },
});
