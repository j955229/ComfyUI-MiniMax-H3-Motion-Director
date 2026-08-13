import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const comfyOrigin = process.env.MMX_COMFY_ORIGIN || "http://127.0.0.1:8190";
const cdpOrigin = process.env.MMX_CDP_ORIGIN || "http://127.0.0.1:9223";
const artifactDir = resolve(process.env.MMX_ARTIFACT_DIR || "artifacts");
const taskKeys = ["t2v", "i2v", "fl2v", "r2v", "v2v", "rv2v"];

await mkdir(artifactDir, { recursive: true });

const tabs = await (await fetch(`${cdpOrigin}/json`)).json();
const tab = tabs.find((item) => item.type === "page" && item.url.startsWith(comfyOrigin));
assert.ok(tab?.webSocketDebuggerUrl, "A ComfyUI Chrome CDP page is required.");

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
});

let nextId = 0;
const pending = new Map();
const listeners = new Map();
const consoleErrors = [];

socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
        return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
});

function on(method, listener) {
    const bucket = listeners.get(method) || [];
    bucket.push(listener);
    listeners.set(method, bucket);
}

function call(method, params = {}) {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            rejectCall(new Error(`CDP timeout: ${method}`));
        }, 20_000);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
    });
}

async function evaluate(expression) {
    const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
}

async function waitFor(expression, timeoutMs = 12_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
}

async function screenshot(name, clip = null) {
    const params = { format: "png", fromSurface: true };
    if (clip) params.clip = { ...clip, scale: 1 };
    const capture = await call("Page.captureScreenshot", params);
    const path = resolve(artifactDir, name);
    await writeFile(path, Buffer.from(capture.data, "base64"));
    return path;
}

async function setTask(taskKey) {
    const result = await evaluate(`(() => {
        const node = globalThis.__mmxLiveNode;
        const editor = node?._minimaxEditor;
        const select = editor?.globalTask;
        const option = [...(select?.options || [])].find((item) => item.value.toLowerCase().startsWith(${JSON.stringify(taskKey)} + " "));
        if (!option) return { ok: false };
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: option.value };
    })()`);
    assert.equal(result.ok, true, `Task ${taskKey} must exist.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
}

async function ensureTwoT2vSegments() {
    await setTask("t2v");
    await evaluate(`(() => {
        const editor = globalThis.__mmxLiveNode._minimaxEditor;
        const current = structuredClone(editor.timeline.segments?.[0] || {});
        const first = {
            ...current,
            id: "live-s1",
            start: 0,
            length: 124,
            frameCount: 124,
            durationSec: 5,
            contextLink: { schema: "previous_context_link_v1", enabled: false, visual: false, audio: false },
        };
        const second = {
            ...structuredClone(first),
            id: "live-s2",
            start: 124,
            contextLink: { schema: "previous_context_link_v1", enabled: true, visual: true, audio: true },
        };
        editor.timeline.segments = [first, second];
        editor.timeline.totalFrames = 248;
        editor.timeline.output.audioMode = "generate";
        editor.commit(false, { syncTimeline: true });
        const node = globalThis.__mmxLiveNode;
        for (const [name, value] of Object.entries({
            motion_context_enabled: true,
            audio_context_enabled: true,
            color_reanchor_enabled: true,
            pin_renorm_enabled: true,
        })) {
            const widget = node.widgets.find((item) => item.name === name);
            if (widget) widget.value = value;
        }
        const motion = node.widgets.find((item) => item.name === "motion_context_enabled");
        motion?.callback?.(motion.value);
        editor.commit(false, { syncTimeline: true });
        return editor.timeline.segments.length;
    })()`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
}

async function nodeClip() {
    return evaluate(`(() => {
        const node = globalThis.__mmxLiveNode;
        const canvas = globalThis.app.canvas;
        canvas.centerOnNode?.(node);
        canvas.setDirty?.(true, true);
        const rect = canvas.canvas.getBoundingClientRect();
        const scale = Number(canvas.ds?.scale || 1);
        const offset = canvas.ds?.offset || [0, 0];
        const x = rect.left + (Number(node.pos[0]) + Number(offset[0])) * scale - 8;
        const y = rect.top + (Number(node.pos[1]) + Number(offset[1])) * scale - 34;
        return {
            x: Math.max(0, x),
            y: Math.max(0, y),
            width: Math.min(window.innerWidth - Math.max(0, x), Number(node.size[0]) * scale + 16),
            height: Math.min(window.innerHeight - Math.max(0, y), (Number(node.size[1]) + 40) * scale + 16),
        };
    })()`);
}

on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    consoleErrors.push(exceptionDetails.exception?.description || exceptionDetails.text || "Runtime exception");
});
on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type !== "error") return;
    consoleErrors.push(args.map((item) => item.value || item.description || "").join(" "));
});
on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") consoleErrors.push(entry.text || "Log error");
});

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
console.log("LIVE_UI stage=cdp-ready");
await call("Browser.grantPermissions", {
    origin: comfyOrigin,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
});
await call("Page.reload", { ignoreCache: true });
console.log("LIVE_UI stage=page-reloaded");
await waitFor(`document.readyState === "complete"
    && globalThis.app?.graph
    && globalThis.LiteGraph?.registered_node_types?.MiniMaxH3MotionDirector`, 20_000);

await evaluate(`(async () => {
    globalThis.app.graph.clear();
    const node = globalThis.LiteGraph.createNode("MiniMaxH3MotionDirector");
    globalThis.app.graph.add(node);
    node.pos = [120, 120];
    globalThis.__mmxLiveNode = node;
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    globalThis.app.canvas.centerOnNode?.(node);
    globalThis.app.canvas.setDirty?.(true, true);
})()`);
await waitFor(`globalThis.__mmxLiveNode?._minimaxEditor`);
console.log("LIVE_UI stage=node-created");

await ensureTwoT2vSegments();

const widgetAudit = await evaluate(`(() => {
    const node = globalThis.__mmxLiveNode;
    return (node.widgets || []).map((widget, index) => ({
        index,
        name: widget.name,
        type: widget.type,
        hidden: !!widget.hidden,
        optionHidden: !!widget.options?.hidden,
        serialize: widget.serialize,
        optionSerialize: widget.options?.serialize,
        size: widget.computeSize?.(node.size[0]) || null,
        value: widget.value,
        drawName: widget.draw?.name || "",
    }));
})()`);

const requiredHidden = [
    "task_type", "timeline_data", "global_prompt", "frame_rate", "width", "height",
    "ref_max_size", "total_frames", "source_overlap_frames", "pin_renorm_enabled",
    "bd_grp_experimental",
];
for (const name of requiredHidden) {
    const widget = widgetAudit.find((item) => item.name === name);
    assert.ok(widget, `${name} backend widget must exist.`);
    assert.equal(widget.hidden, true, `${name} must be hidden.`);
    assert.equal(widget.optionHidden, true, `${name} options.hidden must be true.`);
    assert.deepEqual(widget.size, [0, 0], `${name} must consume zero canvas height.`);
}

const pinProxy = widgetAudit.filter((item) => item.name === "mmx_pin_renorm_proxy");
assert.equal(pinProxy.length, 1, "Exactly one dedicated pin proxy must exist.");
assert.equal(pinProxy[0].serialize, false);
assert.equal(pinProxy[0].optionSerialize, false);
assert.equal(pinProxy[0].hidden, false);
assert.ok(pinProxy[0].size?.[1] > 0);

const booleanNames = [
    "motion_context_enabled", "audio_context_enabled", "color_reanchor_enabled",
    "pin_renorm_enabled", "clear_vram_between_segments", "export_source_images",
];
for (const name of booleanNames) {
    const widget = widgetAudit.find((item) => item.name === name);
    assert.ok(widget, `${name} must exist.`);
    assert.equal(typeof widget.value, "boolean", `${name} must retain a real Boolean value.`);
    assert.equal(widget.drawName, "drawDirectorBooleanWidget", `${name} must use the shared green renderer.`);
}
console.log("LIVE_UI stage=widget-audit");

const nodeScreenshots = [];
for (const taskKey of taskKeys) {
    if (taskKey === "t2v") await ensureTwoT2vSegments();
    else await setTask(taskKey);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const clip = await nodeClip();
    nodeScreenshots.push(await screenshot(`director_node_${taskKey}.png`, clip));
}
console.log("LIVE_UI stage=node-screenshots");

const modal = await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    editor._directorModalController.open();
    return editor._directorModalOpen;
})()`);
assert.equal(modal, true);
await new Promise((resolveWait) => setTimeout(resolveWait, 200));

const selectorRects = {};
const modalScreenshots = [];
for (const taskKey of taskKeys) {
    await setTask(taskKey);
    const state = await evaluate(`(() => {
        const editor = globalThis.__mmxLiveNode._minimaxEditor;
        const select = editor.globalTask;
        const rect = select.getBoundingClientRect();
        const anchor = select.closest(".bd-task-anchor");
        const left = anchor?.parentElement;
        return {
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            anchorClass: anchor?.className || "",
            leftClass: left?.className || "",
            adjacentActions: left?.children?.[1]?.classList?.contains("bd-actions") || false,
        };
    })()`);
    assert.match(state.anchorClass, /bd-task-anchor/);
    assert.match(state.leftClass, /bd-toolbar-left/);
    assert.equal(state.adjacentActions, true);
    selectorRects[taskKey] = state.rect;
    if (["t2v", "r2v", "rv2v"].includes(taskKey)) {
        modalScreenshots.push(await screenshot(`director_modal_${taskKey}.png`));
    }
}
console.log("LIVE_UI stage=modal-screenshots");

const xs = Object.values(selectorRects).map((rect) => rect.x);
const ys = Object.values(selectorRects).map((rect) => rect.y);
assert.ok(Math.max(...xs) - Math.min(...xs) <= 1, "Task selector x must stay within 1px.");
assert.ok(Math.max(...ys) - Math.min(...ys) <= 1, "Task selector y must stay within 1px.");

await ensureTwoT2vSegments();
await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    if (!editor._directorModalOpen) editor._directorModalController.open();
    editor.timeline.runSelectEnabled = false;
    editor.updateRunSelectUI();
})()`);

const runSelection = await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    const button = editor.root.querySelector('[data-a="run-select-toggle"]');
    button.click();
    const afterFirst = {
        enabled: editor.timeline.runSelectEnabled,
        active: button.classList.contains("active"),
    };
    button.click();
    return {
        afterFirst,
        afterSecond: {
            enabled: editor.timeline.runSelectEnabled,
            active: button.classList.contains("active"),
        },
    };
})()`);
assert.deepEqual(runSelection.afterFirst, { enabled: true, active: true });
assert.deepEqual(runSelection.afterSecond, { enabled: false, active: false });
console.log("LIVE_UI stage=run-selection");

await setTask("v2v");
await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    const controller = editor._promptMentionControllers.find((item) => item.rich.getClientRects().length > 0);
    controller.setValue("");
    controller.rich.focus();
})()`);
await call("Input.insertText", { text: "@" });
await new Promise((resolveWait) => setTimeout(resolveWait, 80));
const mentionState = await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    const controller = editor._promptMentionControllers.find((item) => item.rich.getClientRects().length > 0);
    return { open: controller.isMenuOpen, value: controller.getValue() };
})()`);
assert.equal(mentionState.open, true, "Typing @ must open the material picker immediately.");
assert.match(mentionState.value, /@/);
console.log("LIVE_UI stage=mention");

const clipboardPrepared = await evaluate(`(async () => {
    const node = globalThis.__mmxLiveNode;
    const canvas = globalThis.app.canvas;
    canvas.selectNode?.(node);
    if (typeof canvas.copyToClipboard !== "function") return false;
    canvas.copyToClipboard();
    await navigator.clipboard.writeText("PASTE_OK");
    const editor = node._minimaxEditor;
    const controller = editor._promptMentionControllers.find((item) => item.rich.getClientRects().length > 0);
    controller.setValue("");
    controller.rich.focus();
    return true;
})()`);
assert.equal(clipboardPrepared, true, "LiteGraph copyToClipboard must be available.");

const beforeModalPasteNodes = await evaluate(`globalThis.app.graph._nodes.length`);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
await new Promise((resolveWait) => setTimeout(resolveWait, 150));
const modalPaste = await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    const controller = editor._promptMentionControllers.find((item) => item.rich.getClientRects().length > 0);
    return {
        value: controller.getValue(),
        nodeCount: globalThis.app.graph._nodes.length,
    };
})()`);
assert.match(modalPaste.value, /PASTE_OK/, "Prompt must receive native Ctrl+V text.");
assert.equal(modalPaste.nodeCount, beforeModalPasteNodes, "Prompt Ctrl+V must not paste graph nodes.");
console.log("LIVE_UI stage=modal-paste");

await evaluate(`(() => {
    const editor = globalThis.__mmxLiveNode._minimaxEditor;
    editor._directorModalController.close({ restoreFocus: false });
    globalThis.app.canvas.canvas.tabIndex = 0;
    globalThis.app.canvas.canvas.focus();
})()`);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
await new Promise((resolveWait) => setTimeout(resolveWait, 200));
const afterClosedPasteNodes = await evaluate(`globalThis.app.graph._nodes.length`);
assert.ok(afterClosedPasteNodes > beforeModalPasteNodes, "Graph Ctrl+V must recover after Director closes.");

const directorErrors = consoleErrors.filter((message) => (
    /MiniMax|Motion Director|minimax_|does not provide an export|Failed to fetch dynamically imported module|Cannot access before initialization|undefined is not a function/i.test(message)
));
assert.deepEqual(directorErrors, [], `Director browser console errors:\n${directorErrors.join("\n")}`);

const report = {
    status: "LIVE UI VALIDATED",
    comfyOrigin,
    widgetAudit,
    selectorRects,
    selectorMaxDelta: {
        x: Math.max(...xs) - Math.min(...xs),
        y: Math.max(...ys) - Math.min(...ys),
    },
    runSelection,
    mentionState,
    modalPaste,
    beforeModalPasteNodes,
    afterClosedPasteNodes,
    consoleErrorCount: directorErrors.length,
    nodeScreenshots,
    modalScreenshots,
};
await writeFile(resolve(artifactDir, "live_ui_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
socket.close();
