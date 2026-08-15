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
} from "./minimax_director_runtime_fix_core.mjs?boot=continuity_runtime_fix_v1";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";

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
    return node?.widgets?.find(
        (widget) => widget?.name === name,
    ) || null;
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

    let changed = setWidgetLabel(
        widget,
        label,
    );

    if (widget._mmxSamplingStatusText !== label) {
        widget._mmxSamplingStatusText = label;
        changed = true;
    }

    if (widget._bdGroupLabel !== label) {
        widget._bdGroupLabel = label;
        changed = true;
    }

    if (widget.value !== label) {
        widget.value = label;
        changed = true;
    }

    if (
        widget.element
        && widget.element.textContent !== label
    ) {
        widget.element.textContent = label;
        changed = true;
    }

    return changed;
}

function currentTaskKey(node) {
    const editorTask =
        node?._minimaxEditor?.getTaskKey?.();

    const widgetTask =
        widgetByName(node, "task_type")?.value;

    return resolveDirectorTaskKey(
        editorTask || widgetTask,
    );
}

function currentTimeline(node) {
    const live =
        node?._minimaxEditor?.timeline;

    if (
        live
        && typeof live === "object"
    ) {
        return live;
    }

    return parseDirectorTimeline(
        widgetByName(
            node,
            "timeline_data",
        )?.value,
    );
}

function syncGeneratedAudioContinuation(node) {
    const taskKey = currentTaskKey(node);
    const timeline = currentTimeline(node);
    const groupCount = directorGroupCount(
        timeline,
        taskKey,
    );

    if (
        !generatedAudioContinuationShouldBeInteractive(
            taskKey,
            groupCount,
        )
    ) {
        return false;
    }

    const widget = widgetByName(
        node,
        "audio_context_enabled",
    );

    if (!widget) return false;

    let changed = false;

    // T2V / I2V / R2V / FL2V always use generated audio for this control.
    // A stale hidden source/mute audioMode from V2V/RV2V must not disable it.
    if (widget._mmxContinuityDisabled === true) {
        widget._mmxContinuityDisabled = false;
        changed = true;
    }

    if (widget.disabled === true) {
        widget.disabled = false;
        changed = true;
    }

    return changed;
}

function syncLocalizedLabels(node) {
    const locale =
        getLocale() === "en"
            ? "en"
            : "zh";

    const samplingState =
        getSamplingConnectionState(
            node?.inputs || [],
        );

    let changed = false;

    changed = setHeaderLabel(
        widgetByName(
            node,
            "bd_grp_sample",
        ),
        samplingHeaderText(
            locale,
            samplingState,
        ),
    ) || changed;

    for (const sectionId of [
        "bd_grp_motion",
        "mmx_postprocess_group",
        "bd_grp_perf",
    ]) {
        changed = setHeaderLabel(
            widgetByName(
                node,
                sectionId,
            ),
            sectionTitle(
                locale,
                sectionId,
            ),
        ) || changed;
    }

    for (
        const [widgetName, sourceName]
        of Object.entries(
            LABEL_SOURCE_BY_WIDGET,
        )
    ) {
        changed = setWidgetLabel(
            widgetByName(
                node,
                widgetName,
            ),
            localizedWidgetLabel(
                locale,
                sourceName,
            ),
        ) || changed;
    }

    const seed = widgetByName(
        node,
        "seed",
    );

    for (
        const linked
        of seed?.linkedWidgets || []
    ) {
        const raw = String(
            linked?.name
            || linked?.label
            || "",
        ).toLowerCase();

        if (
            !/control[_\s]?after[_\s]?generate|生成后定制/.test(
                raw,
            )
        ) {
            continue;
        }

        changed = setWidgetLabel(
            linked,
            localizedWidgetLabel(
                locale,
                "control_after_generate",
            ),
        ) || changed;
    }

    return changed;
}

function syncRuntimeFix(node) {
    if (
        !node
        || !Array.isArray(node.widgets)
    ) {
        return;
    }

    const audioChanged =
        syncGeneratedAudioContinuation(node);

    const labelsChanged =
        syncLocalizedLabels(node);

    const changed =
        audioChanged || labelsChanged;

    if (changed) {
        node.setDirtyCanvas?.(
            true,
            true,
        );
    }
}

function syncBeforePaint(node) {
    syncRuntimeFix(node);

    if (
        typeof queueMicrotask === "function"
    ) {
        queueMicrotask(
            () => syncRuntimeFix(node),
        );
    }

    if (
        typeof requestAnimationFrame
        === "function"
    ) {
        requestAnimationFrame(
            () => syncRuntimeFix(node),
        );
    }
}

function wrapDirector(nodeType) {
    const onNodeCreated =
        nodeType.prototype.onNodeCreated;

    nodeType.prototype.onNodeCreated = function () {
        const result =
            onNodeCreated?.apply(
                this,
                arguments,
            );

        syncBeforePaint(this);
        return result;
    };

    const onConfigure =
        nodeType.prototype.onConfigure;

    nodeType.prototype.onConfigure = function () {
        const result =
            onConfigure?.apply(
                this,
                arguments,
            );

        syncBeforePaint(this);
        return result;
    };

    const onConnectionsChange =
        nodeType.prototype.onConnectionsChange;

    nodeType.prototype.onConnectionsChange = function () {
        const result =
            onConnectionsChange?.apply(
                this,
                arguments,
            );

        syncBeforePaint(this);
        return result;
    };

    const onWidgetChanged =
        nodeType.prototype.onWidgetChanged;

    nodeType.prototype.onWidgetChanged = function () {
        const result =
            onWidgetChanged?.apply(
                this,
                arguments,
            );

        // Old continuity refreshes can temporarily restore backend English labels
        // and can re-disable generated-audio continuation. Correct both before paint.
        syncBeforePaint(this);
        return result;
    };

    const onDrawBackground =
        nodeType.prototype.onDrawBackground;

    nodeType.prototype.onDrawBackground = function () {
        const result =
            onDrawBackground?.apply(
                this,
                arguments,
            );

        // LiteGraph draws widgets after onDrawBackground. Reassert the locale and
        // generated-audio availability here so no stale state reaches the screen.
        syncRuntimeFix(this);
        return result;
    };
}

app.registerExtension({
    name:
        "MiniMaxH3.MotionDirector.RuntimeContinuityFix",

    beforeRegisterNodeDef(
        nodeType,
        nodeData,
    ) {
        if (
            nodeData?.name
            !== DIRECTOR_CLASS
        ) {
            return;
        }

        wrapDirector(nodeType);
    },
});
