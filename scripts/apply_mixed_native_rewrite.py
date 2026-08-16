#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TIMELINE = ROOT / "web/js/minimax_timeline.js"
GEN = ROOT / "web/js/minimax_gen_timeline.js"
BROWSER_CI = ROOT / ".github/workflows/mixed_mode_browser_ci.yml"
OLD_PATCH = ROOT / "web/js/zz_minimax_mixed_mode.js"
OLD_PERSIST = ROOT / "web/js/zzz_minimax_mixed_persistence.js"
NATIVE_TEST = ROOT / "web/js/tests/minimax_mixed_native_contract.test.mjs"
MODE_TEST = ROOT / "web/js/tests/minimax_mixed_mode_inputs.test.mjs"


def replace_exact(text: str, old: str, new: str, *, count: int = 1, label: str) -> str:
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{label}: expected {count} exact matches, found {actual}")
    return text.replace(old, new, count)


def replace_all_exact(text: str, old: str, new: str, *, count: int, label: str) -> str:
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{label}: expected {count} exact matches, found {actual}")
    return text.replace(old, new)


def inject_method_start(text: str, signature: str, body: str, *, label: str) -> str:
    old = signature + "\n"
    new = signature + "\n" + body
    return replace_exact(text, old, new, count=1, label=label)


def patch_gen() -> None:
    text = GEN.read_text(encoding="utf-8")
    old = '''export function getDirectorMode(taskTypeValue) {\n    const key = resolveTaskKey(taskTypeValue);\n    if (FL2V_TASKS.has(key)) return "fl2v";\n'''
    new = '''export function getDirectorMode(taskTypeValue) {\n    const key = resolveTaskKey(taskTypeValue);\n    if (key === "mixed") return "mixed";\n    if (FL2V_TASKS.has(key)) return "fl2v";\n'''
    text = replace_exact(text, old, new, label="native mixed routing")
    GEN.write_text(text, encoding="utf-8")


NATIVE_HELPERS = r'''    _cloneMixedValue(value) {
        if (typeof structuredClone === "function") return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    _loadNativeTimelineState(raw, totalFrames, fps) {
        const source = String(raw || "").trim();
        if (source) {
            try {
                const parsed = JSON.parse(source);
                if (parsed && typeof parsed === "object"
                    && !Array.isArray(parsed)
                    && String(parsed.timelineMode || "").trim().toLowerCase() === "mixed") {
                    this.mixedTimeline = normalizeMixedTimeline(parsed);
                    if (this.node?.id != null) this.mixedTimeline.nodeId = String(this.node.id);
                    this._mixedLoadedFromSerialized = true;
                    // Mixed schema must never pass through legacy video/batch/FL2V normalizers.
                    return parseTimeline("", totalFrames, fps);
                }
            } catch {
                // Legacy parser below owns malformed/non-Mixed timeline handling.
            }
        }
        this._mixedLoadedFromSerialized = false;
        return parseTimeline(raw, totalFrames, fps);
    }

    _ensureMixedTimeline() {
        if (!this.mixedTimeline) {
            const raw = String(this.timelineWidget?.value || "").trim();
            try {
                const parsed = JSON.parse(raw || "{}");
                if (String(parsed?.timelineMode || "").trim().toLowerCase() === "mixed") {
                    this.mixedTimeline = normalizeMixedTimeline(parsed);
                }
            } catch {
                // Fall through to a fresh Mixed timeline.
            }
        }
        if (!this.mixedTimeline) this.mixedTimeline = createDefaultMixedTimeline(this);
        this.mixedTimeline = normalizeMixedTimeline(this.mixedTimeline);
        this.mixedTimeline.output = this.mixedTimeline.output || {};
        this.mixedTimeline.output.audioMode = "generate";
        if (this.node?.id != null) this.mixedTimeline.nodeId = String(this.node.id);
        return this.mixedTimeline;
    }

    _mixedTotalFrames() {
        const state = this._ensureMixedTimeline();
        const fps = Math.max(1, Number(state.frameRate || this.frameRateWidget?.value || 24) || 24);
        return (state.segments || []).reduce((total, seg) => {
            if (seg?.mode === "source_video") {
                const range = seg?.inputs?.sourceVideo?.range || {};
                const seconds = Math.max(0, Number(range.endSec || 0) - Number(range.startSec || 0));
                return total + Math.max(1, Math.round(seconds * fps));
            }
            return total + durationToClampedMiniMaxFrames(seg?.duration ?? 5, fps).frames;
        }, 0);
    }

    _normalizeMixedRunSelection() {
        const state = this._ensureMixedTimeline();
        const count = state.segments?.length || 0;
        const selection = [...new Set((state.runSelection || [])
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < count))]
            .sort((a, b) => a - b);
        state.runSelection = state.runSelectEnabled
            ? (selection.length ? selection : [...Array(count).keys()])
            : [];
        return state;
    }

    _syncMixedFromSharedWidgets() {
        const state = this._ensureMixedTimeline();
        syncMixedGlobalsFromWidgets(this, state);
        state.output = state.output || {};
        state.output.audioMode = "generate";
        if (this.node?.id != null) state.nodeId = String(this.node.id);
        this.mixedTimeline = normalizeMixedTimeline(state);
        return this.mixedTimeline;
    }

    _applyMixedSharedControls() {
        const state = this._ensureMixedTimeline();
        const output = state.output || {};
        const setWidget = (name, value) => {
            const widget = this.widget?.(name) || this.node?.widgets?.find?.((item) => item?.name === name);
            if (widget && value != null) widget.value = value;
        };
        setWidget("frame_rate", state.frameRate ?? 24);
        setWidget("width", output.width ?? state.width ?? 864);
        setWidget("height", output.height ?? state.height ?? 480);
        setWidget("ref_max_size", output.longEdge ?? state.refMaxSize ?? 864);
        if (this.fpsInput) this.fpsInput.value = String(state.frameRate ?? 24);
        if (this.outW) this.outW.value = String(output.width ?? state.width ?? 864);
        if (this.outH) this.outH.value = String(output.height ?? state.height ?? 480);
        if (this.outLong) this.outLong.value = String(output.longEdge ?? state.refMaxSize ?? 864);
        if (this.outMode && output.mode) this.outMode.value = output.mode;
        if (this.outExportMode && output.exportMode) this.outExportMode.value = output.exportMode;
        if (this.outMaxFrames) this.outMaxFrames.value = String(output.maxExportFrames ?? 0);
        if (this.outAudioMode) this.outAudioMode.value = "generate";
    }

    _setMixedBodiesActive(active) {
        const host = this._mixedPanelHost;
        for (const child of Array.from(this.mainBody?.children || [])) {
            if (child === host || child === this.outputBarEl) continue;
            child.hidden = !!active;
        }
        for (const element of this.root?.querySelectorAll?.(
            ".bd-actions, .bd-smart-split-msg, .bd-external-groups-msg",
        ) || []) {
            element.hidden = !!active;
        }
        const continuity = this.segmentContinuityWrap
            || this.root?.querySelector?.('[data-r="segment-continuity-wrap"]');
        const common = this.r2vCommonToggle
            || this.root?.querySelector?.('[data-a="r2v-common-toggle"]');
        const audio = this.outAudioWrap
            || this.root?.querySelector?.('[data-r="out-audio-wrap"]');
        if (continuity) continuity.hidden = !!active;
        if (common) common.hidden = !!active;
        if (audio) audio.hidden = !!active;
        if (this._mixedPanelHost) this._mixedPanelHost.hidden = !active;
    }

    _ensureMixedPanelHost() {
        if (this._mixedPanelHost?.isConnected) return this._mixedPanelHost;
        const host = document.createElement("div");
        host.className = "bd-mixed-panel";
        host.dataset.r = "mixed-panel";
        host.style.minWidth = "0";
        host.style.minHeight = "0";
        host.style.width = "100%";
        const parent = this.mainBody || this.root?.querySelector?.(".bd-main");
        if (!parent) return null;
        if (this.outputBarEl?.parentElement === parent) parent.insertBefore(host, this.outputBarEl);
        else parent.appendChild(host);
        this._mixedPanelHost = host;
        return host;
    }

    _enterMixedNative(prevMode) {
        if (prevMode && prevMode !== "mixed") this._standaloneDirectorMode = prevMode;
        if (!this._standaloneDirectorMode || this._standaloneDirectorMode === "mixed") {
            this._standaloneDirectorMode = "video";
        }
        const state = this._ensureMixedTimeline();
        this._applyMixedSharedControls();
        const host = this._ensureMixedPanelHost();
        if (!host) return false;
        this._setMixedBodiesActive(true);
        if (!this._mixedController) {
            this._mixedController = mountMixedUI({
                host,
                editor: this,
                initialState: state,
                onChange: (next) => {
                    if (this.getDirectorMode() !== "mixed") return;
                    this.mixedTimeline = normalizeMixedTimeline(next);
                    this.mixedTimeline.output = this.mixedTimeline.output || {};
                    this.mixedTimeline.output.audioMode = "generate";
                    if (this.node?.id != null) this.mixedTimeline.nodeId = String(this.node.id);
                    this.scheduleTimelineSync?.();
                    this.updateVideoNameLabel?.();
                },
            });
        } else {
            this._mixedController.setState(state);
        }
        this.updateVideoNameLabel?.();
        this.node?.setDirtyCanvas?.(true, true);
        return true;
    }

    _leaveMixedNative() {
        if (this._mixedController) {
            this.mixedTimeline = normalizeMixedTimeline(this._mixedController.state);
            if (this.node?.id != null) this.mixedTimeline.nodeId = String(this.node.id);
            this._mixedController.destroy();
            this._mixedController = null;
        }
        this._setMixedBodiesActive(false);
        this.node?.setDirtyCanvas?.(true, true);
    }

    _mixedPayload() {
        const state = this._syncMixedFromSharedWidgets();
        this._normalizeMixedRunSelection();
        state.output = state.output || {};
        state.output.audioMode = "generate";
        if (this.node?.id != null) state.nodeId = String(this.node.id);
        this.mixedTimeline = normalizeMixedTimeline(state);
        return this._cloneMixedValue(this.mixedTimeline);
    }

'''


def patch_timeline() -> None:
    text = TIMELINE.read_text(encoding="utf-8")

    import_anchor = 'from "./minimax_context_links.mjs";\n'
    import_block = import_anchor + '''import {\n    createDefaultMixedTimeline,\n    mountMixedUI,\n    syncMixedGlobalsFromWidgets,\n} from "./minimax_mixed_ui.mjs?boot=mixed_native_v2";\nimport { normalizeMixedTimeline } from "./minimax_mixed_state.mjs?boot=mixed_native_v2";\n'''
    text = replace_exact(text, import_anchor, import_block, label="Mixed native imports")

    text = replace_exact(
        text,
        'this.timeline = parseTimeline(this.timelineWidget?.value, initTotal, initFps);',
        'this.timeline = this._loadNativeTimelineState(this.timelineWidget?.value, initTotal, initFps);',
        label="constructor Mixed parse isolation",
    )
    text = replace_exact(
        text,
        'ed.timeline = parseTimeline(ed.timelineWidget?.value, initTotal, initFps);',
        'ed.timeline = ed._loadNativeTimelineState(ed.timelineWidget?.value, initTotal, initFps);',
        label="configure Mixed parse isolation",
    )

    # Constructor and configure each have the same initial-mode branch. Mixed must
    # bypass every legacy timeline normalizer before native applyTaskLayout mounts it.
    old_mode_init = 'if (this._directorMode === "video") {'
    new_mode_init = 'if (this._directorMode === "mixed") {\n            // Mixed owns editor.mixedTimeline; legacy normalizers intentionally do nothing here.\n        } else if (this._directorMode === "video") {'
    text = replace_all_exact(text, old_mode_init, new_mode_init, count=1, label="constructor initial Mixed bypass")
    old_mode_init_ed = 'if (ed._directorMode === "video") {'
    new_mode_init_ed = 'if (ed._directorMode === "mixed") {\n                    // Mixed owns editor.mixedTimeline; legacy normalizers intentionally do nothing here.\n                } else if (ed._directorMode === "video") {'
    text = replace_all_exact(text, old_mode_init_ed, new_mode_init_ed, count=1, label="configure initial Mixed bypass")

    text = replace_exact(
        text,
        '    getDirectorMode() {\n',
        NATIVE_HELPERS + '    getDirectorMode() {\n',
        label="native Mixed helper methods",
    )

    text = replace_exact(
        text,
        '''    isGenMode() {\n        const mode = this.getDirectorMode();\n        return mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v";\n    }\n''',
        '''    isGenMode() {\n        const mode = this.getDirectorMode();\n        return mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v" && mode !== "mixed";\n    }\n''',
        label="Mixed not legacy gen",
    )

    old_layout = '''    applyTaskLayout(prevMode) {\n        const mode = this.getDirectorMode();\n        const prev = prevMode || "video";\n'''
    new_layout = '''    applyTaskLayout(prevMode) {\n        const mode = this.getDirectorMode();\n        if (mode === "mixed") {\n            this._enterMixedNative(prevMode || this._directorMode);\n            this._directorMode = "mixed";\n            this.updateDomWidgetHeight?.();\n            return;\n        }\n        if (prevMode === "mixed" || this._directorMode === "mixed") {\n            this._leaveMixedNative();\n            prevMode = this._standaloneDirectorMode || "video";\n        }\n        const prev = prevMode || "video";\n'''
    text = replace_exact(text, old_layout, new_layout, label="native applyTaskLayout Mixed branch")
    text = replace_exact(
        text,
        '        this._directorMode = mode;\n\n        const taskKey = this.getTaskKey();',
        '        this._directorMode = mode;\n        this._standaloneDirectorMode = mode;\n\n        const taskKey = this.getTaskKey();',
        label="remember standalone Director mode",
    )

    old_global = '''    onGlobalField(field, value) {\n        this.timeline.global = this.timeline.global || { refs: [] };\n'''
    new_global = '''    onGlobalField(field, value) {\n        if (field === "taskType") {\n            const currentMode = this._directorMode || this.getDirectorMode();\n            const nextMode = getDirectorMode(value);\n            if (nextMode === "mixed") {\n                if (currentMode !== "mixed") this._standaloneDirectorMode = currentMode;\n                if (this.globalTask) this.globalTask.value = value;\n                if (this.taskTypeWidget) this.taskTypeWidget.value = value;\n                this.applyTaskLayout(currentMode);\n                this.scheduleTimelineSync();\n                this.updateModeUI?.();\n                this.updateSelectionUI?.();\n                return;\n            }\n            if (currentMode === "mixed") {\n                this.timeline.global = this.timeline.global || { refs: [] };\n                this.timeline.global.taskType = value;\n                if (this.globalTask) this.globalTask.value = value;\n                if (this.taskTypeWidget) this.taskTypeWidget.value = value;\n                this.applyTaskLayout("mixed");\n                this.scheduleTimelineSync();\n                this.updateModeUI?.();\n                this.updateSelectionUI?.();\n                return;\n            }\n        }\n        this.timeline.global = this.timeline.global || { refs: [] };\n'''
    text = replace_exact(text, old_global, new_global, label="native onGlobalField Mixed transitions")

    text = inject_method_start(
        text,
        '    buildTimelinePayload() {',
        '        if (this.isMixedMode()) return this._mixedPayload();\n',
        label="Mixed buildTimelinePayload",
    )
    text = inject_method_start(
        text,
        '    _writeTimelineWidget() {',
        '        if (this.isMixedMode()) {\n            if (!this.timelineWidget) return;\n            this.timelineWidget.value = JSON.stringify(this._mixedPayload());\n            this.node.setDirtyCanvas(true, false);\n            return;\n        }\n',
        label="Mixed timeline serialization",
    )
    text = inject_method_start(
        text,
        '    syncFromWidgets() {',
        '        if (this.isMixedMode()) { this._syncMixedFromSharedWidgets(); return; }\n',
        label="Mixed widget sync isolation",
    )
    text = inject_method_start(
        text,
        '    commit(skipRender = false, { syncTimeline = true } = {}) {',
        '        if (this.isMixedMode()) {\n            this._syncMixedFromSharedWidgets();\n            this._normalizeMixedRunSelection();\n            if (syncTimeline) this._writeTimelineWidget();\n            this.updateVideoNameLabel?.();\n            this.updateRunSelectUI?.();\n            this.node?.setDirtyCanvas?.(true, false);\n            return;\n        }\n',
        label="Mixed commit isolation",
    )

    text = inject_method_start(
        text,
        '    getRunnableSegmentCount() {',
        '        if (this.isMixedMode()) return this._ensureMixedTimeline().segments?.length || 0;\n',
        label="Mixed runnable segment count",
    )
    text = inject_method_start(
        text,
        '    supportsRunSelect() {',
        '        if (this.isMixedMode()) return this.getRunnableSegmentCount() >= 2;\n',
        label="Mixed selective run support",
    )
    text = inject_method_start(
        text,
        '    getRunProgressSegmentTotal() {',
        '        if (this.isMixedMode()) {\n            const state = this._normalizeMixedRunSelection();\n            const n = state.segments?.length || 0;\n            if (!state.runSelectEnabled || n < 2) return Math.max(n, 1);\n            return state.runSelection?.length || Math.max(n, 1);\n        }\n',
        label="Mixed run progress total",
    )
    text = inject_method_start(
        text,
        '    isRunSelectEnabled() {',
        '        if (this.isMixedMode()) return !!this._ensureMixedTimeline().runSelectEnabled;\n',
        label="Mixed run select enabled",
    )
    text = inject_method_start(
        text,
        '    normalizeRunSelection() {',
        '        if (this.isMixedMode()) { this._normalizeMixedRunSelection(); return; }\n',
        label="Mixed run selection normalize",
    )
    text = inject_method_start(
        text,
        '    isSegmentRunEnabled(index) {',
        '        if (this.isMixedMode()) {\n            const state = this._normalizeMixedRunSelection();\n            return !state.runSelectEnabled || (state.runSelection || []).includes(Number(index));\n        }\n',
        label="Mixed segment run enabled",
    )
    text = inject_method_start(
        text,
        '    updateRunSelectUI() {',
        '        if (this.isMixedMode()) {\n            this.btnRunSelectToggle?.classList.add("hidden");\n            if (this.runSelectBar) this.runSelectBar.hidden = true;\n            return;\n        }\n',
        label="hide legacy run-select UI in Mixed",
    )

    text = inject_method_start(
        text,
        '    getTotalFrames() {',
        '        if (this.isMixedMode()) return this._mixedTotalFrames();\n',
        label="Mixed total frames",
    )
    text = inject_method_start(
        text,
        '    getFrameRate() {',
        '        if (this.isMixedMode()) return Math.max(1, Number(this._ensureMixedTimeline().frameRate || 24) || 24);\n',
        label="Mixed frame rate",
    )
    text = inject_method_start(
        text,
        '    updateVideoNameLabel() {',
        '        if (this.isMixedMode()) {\n            const n = this._ensureMixedTimeline().segments?.length || 0;\n            const frames = this._mixedTotalFrames();\n            this.videoNameEl.textContent = getLocale() === "en"\n                ? `Mixed · ${n} segment${n === 1 ? "" : "s"} · ${frames}f`\n                : `混合 · ${n}段 · ${frames}帧`;\n            return;\n        }\n',
        label="Mixed summary label",
    )
    text = inject_method_start(
        text,
        '    updateModeUI() {',
        '        if (this.isMixedMode()) {\n            this._enterMixedNative(this._standaloneDirectorMode);\n            this.updateVideoNameLabel();\n            return;\n        }\n',
        label="Mixed updateModeUI isolation",
    )
    text = inject_method_start(
        text,
        '    updateSelectionUI() {',
        '        if (this.isMixedMode()) return;\n',
        label="Mixed selection UI isolation",
    )
    text = inject_method_start(
        text,
        '    syncExternalGroupsTimeline() {',
        '        if (this.isMixedMode()) return;\n',
        label="Mixed external groups isolation",
    )

    text = inject_method_start(
        text,
        '    onFrameRateChanged(value) {',
        '''        if (this.isMixedMode()) {\n            const fps = coerceTimelineFps(value);\n            const state = this._ensureMixedTimeline();\n            state.frameRate = fps;\n            if (this.frameRateWidget) this.frameRateWidget.value = fps;\n            if (this.fpsInput) this.fpsInput.value = String(fps);\n            this.mixedTimeline = normalizeMixedTimeline(state);\n            this.scheduleTimelineSync();\n            this.updateVideoNameLabel();\n            return;\n        }\n''',
        label="Mixed FPS handling",
    )
    text = inject_method_start(
        text,
        '    onOutputField(key, value) {',
        '''        if (this.isMixedMode()) {\n            const state = this._ensureMixedTimeline();\n            state.output = state.output || {};\n            state.output[key] = key === "audioMode" ? "generate" : value;\n            if (key === "aspectRatio" || key === "megapixels") {\n                const resolved = resolutionFromSelector(\n                    state.output.aspectRatio || DEFAULT_ASPECT_RATIO,\n                    state.output.megapixels ?? DEFAULT_MEGAPIXELS,\n                );\n                if (resolved) {\n                    state.output.width = resolved.width;\n                    state.output.height = resolved.height;\n                }\n            }\n            if (key === "width") state.output.width = Math.max(32, Number(value) || 32);\n            if (key === "height") state.output.height = Math.max(32, Number(value) || 32);\n            if (key === "longEdge") state.output.longEdge = Math.max(32, Number(value) || 32);\n            state.output.audioMode = "generate";\n            this.mixedTimeline = normalizeMixedTimeline(state);\n            this._applyMixedSharedControls();\n            this.scheduleTimelineSync();\n            return;\n        }\n''',
        label="Mixed output handling",
    )

    TIMELINE.write_text(text, encoding="utf-8")


def patch_browser_ci() -> None:
    text = BROWSER_CI.read_text(encoding="utf-8")
    text = text.replace('      - "web/js/zz_minimax_mixed_mode.js"\n', '')
    text = text.replace('      - "web/js/zzz_minimax_mixed_persistence.js"\n', '')
    text = text.replace(
        '          node --check web/js/zz_minimax_mixed_mode.js\n          node --check web/js/zzz_minimax_mixed_persistence.js\n',
        '          node --check web/js/minimax_timeline.js\n          node --check web/js/minimax_gen_timeline.js\n',
    )
    text = text.replace(
        '          node --check web/js/tests/minimax_mixed_lifecycle.smoke.mjs\n',
        '          node --check web/js/tests/minimax_mixed_native_contract.test.mjs\n          node --check web/js/tests/minimax_mixed_mode_inputs.test.mjs\n',
    )
    text = text.replace(
        '      - name: Run Mixed workflow lifecycle smoke\n        run: node web/js/tests/minimax_mixed_lifecycle.smoke.mjs\n',
        '      - name: Run native Mixed integration contract\n        run: node web/js/tests/minimax_mixed_native_contract.test.mjs\n\n      - name: Run Mixed per-mode input contract\n        run: node web/js/tests/minimax_mixed_mode_inputs.test.mjs\n',
    )
    BROWSER_CI.write_text(text, encoding="utf-8")


def write_tests() -> None:
    NATIVE_TEST.write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";

const gen = fs.readFileSync(new URL("../minimax_gen_timeline.js", import.meta.url), "utf8");
const timeline = fs.readFileSync(new URL("../minimax_timeline.js", import.meta.url), "utf8");

assert.match(gen, /if \(key === "mixed"\) return "mixed";/);
assert.match(timeline, /this\.mixedTimeline = normalizeMixedTimeline/);
assert.match(timeline, /_enterMixedNative\(prevMode\)/);
assert.match(timeline, /if \(mode === "mixed"\)/);
assert.match(timeline, /if \(nextMode === "mixed"\)/);
assert.match(timeline, /if \(this\.isMixedMode\(\)\) return this\._mixedPayload\(\);/);
assert.match(timeline, /return mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v" && mode !== "mixed";/);
assert.doesNotMatch(timeline, /_mmxMixedPatched/);
assert.doesNotMatch(timeline, /_mmxLegacyBeforeMixed/);

// Standalone task legality remains untouched by the native Mixed branch.
assert.match(gen, /const NO_REF_IMAGE_TASKS = new Set\(\["v2v", "mv2v", "ads2v", "t2v", "i2v", "fl2v"\]\)/);
assert.match(gen, /return taskKey === "r2v" \|\| taskKey === "r2i" \|\| taskKey === "rv2v"/);

console.log("native Mixed integration contract passed");
''', encoding="utf-8")

    MODE_TEST.write_text(r'''import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    FormData: dom.window.FormData,
    File: dom.window.File,
    MouseEvent: dom.window.MouseEvent,
});
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
window.confirm = () => true;

const { setLocale } = await import("../minimax_i18n.js");
const { mountMixedUI } = await import("../minimax_mixed_ui.mjs");
setLocale("zh");

const editor = {
    node: { id: 4, widgets: [
        { name: "frame_rate", value: 24 },
        { name: "width", value: 864 },
        { name: "height", value: 480 },
        { name: "ref_max_size", value: 864 },
    ] },
};
const host = document.createElement("div");
document.body.appendChild(host);

function state(mode, inputs = {}) {
    return {
        version: 1,
        timelineMode: "mixed",
        frameRate: 24,
        output: { mode: "fixed", width: 864, height: 480, longEdge: 864, exportMode: "all" },
        segments: [{ id: "seg_1", mode, prompt: "one prompt", duration: 5, inputs: { resultRefs: [], ...inputs }, continuity: {} }],
    };
}

const controller = mountMixedUI({ host, editor, initialState: state("t2v"), onChange() {} });
function promptCount() { return controller.root.querySelectorAll("textarea.bd-prompt").length; }
function mediaCount() { return controller.root.querySelectorAll(".mmx-mixed-media-block").length; }

assert.equal(promptCount(), 1, "Mixed T2V must render exactly one prompt editor");
assert.equal(mediaCount(), 0, "Mixed T2V must render zero media/material slots");

controller.setState(state("i2v"));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 1, "Mixed I2V exposes Start Frame only");

controller.setState(state("fl2v"));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 2, "Mixed FL2V exposes First/Last Frame only");

controller.setState(state("r2v", { pictures: [], referenceVideos: [], referenceAudios: [] }));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 3, "Mixed R2V exposes pictures + reference video + reference audio");

controller.setState(state("source_video", { identityPictures: [], referenceAudios: [] }));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 3, "Mixed Source Video exposes source + identity + reference audio");
assert.equal(controller.root.querySelectorAll('[data-mmx-action="library-video"]').length, 0,
    "Source Video itself must never offer Material Library video as source");

controller.destroy();
console.log("Mixed per-mode input contract passed");
''', encoding="utf-8")


def main() -> None:
    patch_gen()
    patch_timeline()
    patch_browser_ci()
    write_tests()
    OLD_PATCH.unlink(missing_ok=True)
    OLD_PERSIST.unlink(missing_ok=True)
    print("native Mixed rewrite applied")


if __name__ == "__main__":
    main()
