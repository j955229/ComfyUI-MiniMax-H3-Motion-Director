import { app } from "../../scripts/app.js";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function parseMixed(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object"
            && !Array.isArray(value)
            && String(value.timelineMode || "").toLowerCase() === "mixed"
            ? value
            : null;
    } catch {
        return null;
    }
}

function timelineWidget(node) {
    return node?.widgets?.find((widget) => widget?.name === "timeline_data") || null;
}

function restoreSnapshot(node, snapshot, raw, attempt = 0) {
    const editor = node?._minimaxEditor;
    if (!editor?.timelineWidget) {
        if (attempt < 8) {
            setTimeout(() => restoreSnapshot(node, snapshot, raw, attempt + 1), 25 * (attempt + 1));
        }
        return;
    }

    // Only restore while the node itself still says Mixed.  If another
    // extension/user changed task_type during configure, never force Mixed back.
    const task = node.widgets?.find((widget) => widget?.name === "task_type");
    if (!/^mixed(?:\b|\s|—|-)/i.test(String(task?.value || "").trim())) return;

    const currentRaw = String(editor.timelineWidget.value || "");
    const currentMixed = parseMixed(currentRaw);
    if (currentMixed && currentMixed.nodeId && currentMixed.nodeId === String(node.id)) {
        // A newer Mixed controller already wrote authoritative state.
        return;
    }

    const restored = clone(snapshot);
    if (node.id != null) restored.nodeId = String(node.id);
    editor._mmxMixedWorkspace = clone(restored);
    editor.timeline = restored;
    editor.timelineWidget.value = JSON.stringify(restored);
    node._mmxMixedSerializedSnapshot = clone(restored);
    node.setDirtyCanvas?.(true, false);

    // The main Mixed extension patches/mounts asynchronously.  Calling the
    // current layout hook is safe if it is already patched; otherwise its own
    // scheduled sync will consume _mmxMixedWorkspace shortly afterwards.
    queueMicrotask(() => editor.applyTaskLayout?.());
}

function wrapDirector(nodeType) {
    const previous = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const widget = timelineWidget(this);
        const raw = String(widget?.value || "");
        const snapshot = parseMixed(raw);
        if (snapshot) this._mmxMixedSerializedSnapshot = clone(snapshot);

        const result = previous?.apply(this, arguments);

        if (snapshot) {
            // A microtask runs after the complete wrapper chain but before the
            // Mixed extension's timer-based mounting retries.
            queueMicrotask(() => restoreSnapshot(this, snapshot, raw));
        }
        return result;
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.MixedPersistence",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;
        wrapDirector(nodeType);
    },
});
