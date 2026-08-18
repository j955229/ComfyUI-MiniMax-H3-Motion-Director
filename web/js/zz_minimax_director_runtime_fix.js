import { app } from "../../scripts/app.js";
import { getLocale } from "./minimax_i18n.js";
import { getSamplingConnectionState } from "./minimax_sampling_ui.js";
import {
    directorGroupCount,
    parseDirectorTimeline,
    resolveDirectorTaskKey,
} from "./minimax_director_inputs_core.mjs?boot=unified_inputs_v2";
import {
    localizedWidgetLabel,
    samplingHeaderText,
    sectionTitle,
} from "./minimax_director_sections_core.mjs?boot=director_sections_v1";
import {
    generatedAudioContinuationShouldBeInteractive,
    keepSamplingSourceHidden,
    restoreContinuityWidgetRenderer,
} from "./minimax_director_runtime_fix_core.mjs?boot=continuity_runtime_fix_v4";
import {
    enforceStandaloneSplitPointVisibility,
} from "./minimax_mixed_ui.mjs?boot=mixed_native_v8";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

const INTERNAL_SAMPLING_SOURCES = Object.freeze([
    "steps",
    "sampler_name",
    "scheduler",
    "shift_video",
    "shift_audio",
]);

const LABEL_SOURCE_BY_WIDGET = Object.freeze({
    seed: "seed",
    motion_context_enabled: "motion_context_enabled",
    context_length: "context_length",
    source_overlap_frames: "source_overlap_frames",
    audio_context_enabled: "audio_context_enabled",
    color_reanchor_enabled: "color_reanchor_enabled",
    pin_renorm_enabled: "pin_renorm_enabled",
    mmx_pin_renorm_proxy: "mmx_pin_renorm_proxy",
    mmx_global_refine_proxy: "mmx_global_refine_proxy",
    mmx_face_refine_proxy: "mmx_face_refine_proxy",
    clear_vram_between_segments: "clear_vram_between_segments",
    mmx_section_steps_proxy: "steps",
    mmx_section_sampler_proxy: "sampler_name",
    mmx_section_scheduler_proxy: "scheduler",
    mmx_section_shift_video_proxy: "shift_video",
    mmx_section_shift_audio_proxy: "shift_audio",
});

function widgetByName(node, name) {
    return node?.widgets?.find((widget) => widget?.name === name) || null;
}

function setWidgetLabel(widget, label) {
    if (!widget || !label) return false;
    let changed = false;

    if (widget.label !== label) {
        widget.label = label;
        changed = true;
    }

    widget.options = widget.options || {};
    if (widget.options.label !== label) {
        widget.options.label = label;
        changed = true;
    }

    return changed;
}

function setHeaderLabel(widget, label) {
    if (!widget || !label) return false;
    let changed = setWidgetLabel(widget, label);

    for (const key of ["_mmxSamplingStatusText", "_bdGroupLabel", "value"]) {
        if (widget[key] !== label) {
            widget[key] = label;
            changed = true;
        }
    }

    if (widget.element && widget.element.textContent !== label) {
        widget.element.textContent = label;
        changed = true;
    }

    return changed;
}

function currentTaskKey(node) {
    const editorTask = node?._minimaxEditor?.getTaskKey?.();
    const widgetTask = widgetByName(node, "task_type")?.value;
    return resolveDirectorTaskKey(editorTask || widgetTask);
}

function currentTimeline(node) {
    const live = node?._minimaxEditor?.timeline;
    if (live && typeof live === "object") return live;
    return parseDirectorTimeline(widgetByName(node, "timeline_data")?.value);
}

function syncGeneratedAudioContinuation(node) {
    const taskKey = currentTaskKey(node);
    const timeline = currentTimeline(node);
    const groupCount = directorGroupCount(timeline, taskKey);

    if (!generatedAudioContinuationShouldBeInteractive(taskKey, groupCount)) {
        return false;
    }

    const widget = widgetByName(node, "audio_context_enabled");
    if (!widget) return false;

    let changed = restoreContinuityWidgetRenderer(widget);

    if (widget._mmxContinuityDisabled === true) {
        widget._mmxContinuityDisabled = false;
        changed = true;
    }
    if (widget.disabled === true) {
        widget.disabled = false;
        changed = true;
    }
    widget.options = widget.options || {};
    if (widget.options.disabled === true) {
        widget.options.disabled = false;
        changed = true;
    }

    return changed;
}

function syncSamplingSourceOwnership(node) {
    let changed = false;
    for (const name of INTERNAL_SAMPLING_SOURCES) {
        changed = keepSamplingSourceHidden(widgetByName(node, name)) || changed;
    }
    return changed;
}

function syncLocalizedLabels(node) {
    const locale = getLocale() === "en" ? "en" : "zh";
    const samplingState = getSamplingConnectionState(node?.inputs || []);
    let changed = false;

    changed = setHeaderLabel(
        widgetByName(node, "bd_grp_sample"),
        samplingHeaderText(locale, samplingState),
    ) || changed;

    for (const sectionId of [
        "bd_grp_motion",
        "mmx_postprocess_group",
        "bd_grp_perf",
    ]) {
        changed = setHeaderLabel(
            widgetByName(node, sectionId),
            sectionTitle(locale, sectionId),
        ) || changed;
    }

    for (const [widgetName, sourceName] of Object.entries(LABEL_SOURCE_BY_WIDGET)) {
        changed = setWidgetLabel(
            widgetByName(node, widgetName),
            localizedWidgetLabel(locale, sourceName),
        ) || changed;
    }

    const seed = widgetByName(node, "seed");
    for (const linked of seed?.linkedWidgets || []) {
        const raw = String(linked?.name || linked?.label || "").toLowerCase();
        if (!/control[_\s]?after[_\s]?generate|生成后定制/.test(raw)) continue;
        changed = setWidgetLabel(
            linked,
            localizedWidgetLabel(locale, "control_after_generate"),
        ) || changed;
    }

    return changed;
}

function syncOutputUi(node) {
    const outputUi = node?._minimaxEditor?.outputUi;
    if (!outputUi?.liveRoot) return false;
    let changed = false;

    const syncGlobalRefineVisibleText = () => {
        const label = getLocale() === "en" ? "Global Refine" : "全局精修";
        let localChanged = false;
        const tab = outputUi.liveRoot?.querySelector?.('[data-live-tab="global_refine"]');
        if (tab && tab.textContent !== label) {
            tab.textContent = label;
            localChanged = true;
        }
        for (const selector of ["[data-live-source]", "[data-live-badge]"]) {
            const element = outputUi.liveRoot?.querySelector?.(selector);
            if (!element) continue;
            const text = String(element.textContent || "");
            const next = text
                .replace(/^放大(?=\s*·|$)/, label)
                .replace(/^Global Refine(?=\s*·|$)/, label);
            if (next !== text) {
                element.textContent = next;
                localChanged = true;
            }
        }
        return localChanged;
    };

    changed = syncGlobalRefineVisibleText() || changed;

    if (!outputUi._mmxGlobalRefineLocalePatched && typeof outputUi.updateLocale === "function") {
        const updateLocale = outputUi.updateLocale.bind(outputUi);
        outputUi.updateLocale = function (...args) {
            const result = updateLocale(...args);
            syncGlobalRefineVisibleText();
            return result;
        };
        outputUi._mmxGlobalRefineLocalePatched = true;
        changed = true;
    }

    if (!outputUi._mmxGlobalRefinePreviewPatched && typeof outputUi.consumePreview === "function") {
        const consumePreview = outputUi.consumePreview.bind(outputUi);
        outputUi.consumePreview = function (...args) {
            const result = consumePreview(...args);
            syncGlobalRefineVisibleText();
            return result;
        };
        outputUi._mmxGlobalRefinePreviewPatched = true;
        changed = true;
    }

    if (!outputUi._mmxGlobalRefineStagePatched && typeof outputUi.setLiveStage === "function") {
        const setLiveStage = outputUi.setLiveStage.bind(outputUi);
        outputUi.setLiveStage = function (...args) {
            const result = setLiveStage(...args);
            syncGlobalRefineVisibleText();
            return result;
        };
        outputUi._mmxGlobalRefineStagePatched = true;
        changed = true;
    }

    if (!outputUi._mmxDeblurPipelinePatched && typeof outputUi.setPipelineStatus === "function") {
        const setPipelineStatus = outputUi.setPipelineStatus.bind(outputUi);
        outputUi.setPipelineStatus = function (detail = {}) {
            if (String(detail?.phase || "") !== "rtx_deblur") {
                return setPipelineStatus(detail);
            }
            const target = outputUi.liveRoot?.querySelector?.("[data-pipeline-status]");
            if (!target) return setPipelineStatus(detail);
            const zh = getLocale() !== "en";
            const segmentWord = zh ? "片段" : "Segment";
            const frameWord = zh ? "帧" : "Frame";
            const segment = detail.timeline_segment || detail.segment || 1;
            const total = detail.timeline_segment_total || detail.segment_total || 1;
            const progress = Number(detail.phase_max) > 1
                ? ` · ${frameWord} ${detail.phase_value}/${detail.phase_max}`
                : "";
            target.textContent = `${segmentWord} ${segment}/${total} · NVIDIA RTX Deblur${progress}`;
        };
        outputUi._mmxDeblurPipelinePatched = true;
        changed = true;
    }

    return changed;
}

function syncRuntimeFix(node) {
    if (!node || !Array.isArray(node.widgets)) return false;

    const changed = [
        syncSamplingSourceOwnership(node),
        syncGeneratedAudioContinuation(node),
        syncLocalizedLabels(node),
        syncOutputUi(node),
        enforceStandaloneSplitPointVisibility(node?._minimaxEditor),
    ].some(Boolean);

    if (changed) node.setDirtyCanvas?.(true, true);
    return changed;
}

function scheduleRetrySync(node) {
    if (!node) return;
    node._mmxRuntimeFixTimers = node._mmxRuntimeFixTimers || new Set();
    for (const delay of [0, 80, 250, 800]) {
        const timer = setTimeout(() => {
            node._mmxRuntimeFixTimers?.delete(timer);
            syncRuntimeFix(node);
        }, delay);
        node._mmxRuntimeFixTimers.add(timer);
    }
}

function syncBeforePaint(node) {
    syncRuntimeFix(node);
    if (typeof queueMicrotask === "function") {
        queueMicrotask(() => syncRuntimeFix(node));
    }
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => syncRuntimeFix(node));
    }
}

function wrapDirector(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        syncBeforePaint(this);
        scheduleRetrySync(this);
        return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        syncBeforePaint(this);
        scheduleRetrySync(this);
        return result;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = onConnectionsChange?.apply(this, arguments);
        syncBeforePaint(this);
        return result;
    };

    const onWidgetChanged = nodeType.prototype.onWidgetChanged;
    nodeType.prototype.onWidgetChanged = function () {
        const result = onWidgetChanged?.apply(this, arguments);
        syncBeforePaint(this);
        return result;
    };

    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
        // Locale refresh and legacy sampling visibility run outside this extension.
        // Reassert ownership before LiteGraph paints any widget so neither the
        // old sampling rows nor old-language labels can reach a visible frame.
        syncRuntimeFix(this);
        const result = onDrawBackground?.apply(this, arguments);
        syncRuntimeFix(this);
        return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        for (const timer of this._mmxRuntimeFixTimers || []) clearTimeout(timer);
        this._mmxRuntimeFixTimers?.clear?.();
        return onRemoved?.apply(this, arguments);
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.RuntimeContinuityFix",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;
        wrapDirector(nodeType);
    },
});
