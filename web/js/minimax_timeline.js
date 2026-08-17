// Portions derived from ComfyUI_MiniMaxH3_Director
// Copyright AIMixer and contributors
// Originally licensed under Apache License 2.0
// Modified for MiniMax H3 Motion Director, 2026-08-09
// This derivative project is distributed under GPL-3.0.
// See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    PostprocessConfigStore,
    faceRefineSummary,
    globalRefineSummary,
    mountPostprocessUI,
} from "./minimax_postprocess_ui.mjs?boot=postprocess_output_v7";
import { mountOutputUI } from "./minimax_output_ui.mjs?boot=live_results_v2";
import { resolveExternalGroupTerminal } from "./minimax_external_groups.mjs";
import {
    CUSTOM_ASPECT_RATIO,
    DEFAULT_ASPECT_RATIO,
    DEFAULT_MEGAPIXELS,
    defaultDurationSec,
    defaultFrameCount,
    durationToClampedMiniMaxFrames,
    framesToDurationSec,
    preferredDurationSecFromFrames,
    roundDurationSec,
    genLayoutHint,
    getDirectorMode,
    imageBatchRequiresFixedOutput,
    isCustomAspectRatio,
    isPromptBatchTask,
    isVideoBatchTask,
    MAX_GEN_FRAMES,
    MAX_REFERENCE_AUDIOS,
    MAX_REFERENCE_IMAGES,
    MINIMAX_CANVAS_MULTIPLE,
    minFrameCount,
    newBatchSegment,
    NO_VIDEO_UPLOAD_TASKS,
    normalizeAspectRatioLabel,
    parseMegapixelsInput,
    clampMegapixels,
    refAudioLabel,
    refImageLabel,
    RESOLUTION_ASPECTS,
    resolutionFromSelector,
    resolveTaskKey,
    snapResolutionDim,
    sumFrameCounts,
    taskUsesReferenceAudios,
    taskUsesReferenceImages,
    taskUsesReferenceVideo,
} from "./minimax_gen_timeline.js";
import {
    IMAGE_BATCH_STYLES,
    addImageBatchGroup,
    bindImageBatchEvents,
    bindR2vMediaPlayback,
    deleteImageBatchGroup,
    ensureImageBatchTimeline,
    formatMediaDuration,
    getImageBatchUiHeight,
    mountImageBatchPanel,
    normalizeImageBatchSegments,
    renderImageBatchGroups,
    setR2vToolbar,
    setToolbarDisabledForBatch,
    updateR2vToolbarBtns,
    wireBatchRunSelectControls,
    wireMediaDuration,
} from "./minimax_image_batch.js";
import {
    FL2V_STYLES,
    bindFl2vEvents,
    buildFl2vPayloadFields,
    drawFl2vSegmentThumbnails,
    ensureFl2vTimeline,
    fl2vStartIndices,
    getFl2vTotalDurationSec,
    getFl2vSampleFrames,
    getFl2vVisualFrames,
    getFl2vUiHeight,
    removeFl2vShot,
    rippleFl2vRightEdge,
    mountFl2vPanel,
    newFl2vShot,
    normalizeFl2vSegments,
    openFl2vUpload,
    setFl2vToolbar,
    flushFl2vPromptDraft,
    syncFl2vDurationSecAfterDrag,
    syncFl2vFromShots,
    updateFl2vDetailUI,
    updateFl2vToolbarBtns,
} from "./minimax_fl2v.js";
import { mountPromptImageMentions } from "./minimax_prompt_mentions.js?boot=director_ui_v2";
import {
    createTimelineShortcutHandler,
} from "./minimax_prompt_mentions_core.mjs?boot=director_ui_v2";
import {
    ensureR2vReferenceAssetSchema,
    ensureReferenceAssetSchema,
} from "./minimax_reference_assets.mjs";
import {
    restoreBatchTaskWorkspace,
    stashBatchTaskWorkspace,
} from "./minimax_batch_workspaces.mjs";
import {
    mountR2vCommonToggle,
    syncR2vCommonToggleForTask,
} from "./minimax_r2v_common_ui.mjs?boot=postprocess_output_v5";
import {
    commitRunSelectionMutation as commitRunSelectionMutationNow,
    ensureRunSelectionSerialized,
} from "./minimax_run_selection.mjs";
import {
    DIRECTOR_STATE_COLORS,
    VIDEO_CONTINUITY_STRATEGIES,
    applyVideoStrategyToWidgets,
    handleDisabledWidgetCallback,
    migrateColorReanchorWidgetValues,
    normalizeSourceBridgeValue,
    resolveContinuityUiState,
    resolveH3SpatialStride,
    setNodeInputTooltip,
    setWidgetTooltip,
    setWidgetVisibility,
    syncDisabledWidgetState,
    toggleBooleanWidgetValue,
} from "./minimax_continuity_ui.mjs?boot=director_ui_v5";
import {
    applyI18nDom,
    aspectDisplayLabel,
    getLocale,
    onLocaleChange,
    t,
    taskDisplayLabel,
    toggleLocale,
} from "./minimax_i18n.js";
import {
    applySamplingWidgetVisibility,
    migrateLegacySamplingControlNode,
    migrateLegacySamplingControlWorkflow,
    repairDirectorGroupWidgetWorkflow,
    seedControlModeFromWidgets,
} from "./minimax_sampling_ui.js";
import {
    createDirectorModal,
    destroyDirectorModalForHost,
    DIRECTOR_LAUNCHER_HEIGHT,
    getDirectorModalForHost,
} from "./minimax_director_modal.js?boot=live_results_v1";
import {
    contextLinkMode,
    ensureTimelineContextLinks,
    legacyContextDefaults,
    normalizedContextLink,
    setContextLinkChannels,
    toggleContextLink,
} from "./minimax_context_links.mjs";
import {
    createDefaultMixedTimeline,
    mountMixedUI,
    syncMixedGlobalsFromWidgets,
} from "./minimax_mixed_ui.mjs?boot=mixed_native_v7";
import { normalizeMixedTimeline } from "./minimax_mixed_state.mjs?boot=mixed_native_v6";

const RULER_H = 24;
const SEG_LABEL_H = 20;
const TRACK_H = 160;
const TRACK_Y = RULER_H + SEG_LABEL_H;
const STAGE_PREVIEW_H = 220;
const LIVE_SAMPLE_PREVIEW_H = 320;
const MIN_SEG = 4;
const HANDLE_PX = 14;
/** Canvas-drawn run-select checkbox (not a DOM control). */
const RUN_CHECK_SIZE = 14;
const RUN_CHECK_HIT_PAD_X = 8;
const RUN_CHECK_HIT_PAD_Y = 4;
const CONTEXT_LINK_RADIUS = 10;
const THUMB_MAX_W = 168;
const THUMB_JPEG_Q = 0.55;
const TIMELINE_SYNC_DEBOUNCE_MS = 500;
const MAX_THUMBS_PER_SEGMENT = 20;
const THUMB_PREFETCH_BATCH = 6;
const DIRECTOR_MIN_WIDTH = 900;
const COMFY_UPLOAD_SOFT_LIMIT = 95 * 1024 * 1024;
const MINIMAX_CHUNK_SIZE = 8 * 1024 * 1024;

/** Segment continuity is opt-in; default off unless explicitly true in output. */
function isContinuityEnabled(output) {
    if (!output) return false;
    return output.continuityEnabled === true || output.continuity_enabled === true;
}

function normalizeAudioMode(value) {
    const raw = String(value || "generate").trim().toLowerCase();
    if (raw === "source" || raw === "original" || raw === "passthrough") return "source";
    if (raw === "mute" || raw === "silent" || raw === "silence") return "mute";
    return "generate";
}

function normalizeOutputContinuity(output = {}) {
    const rawOverlap = output.continuityOverlapFrames ?? output.continuity_overlap_frames ?? 9;
    return {
        ...output,
        continuityEnabled: isContinuityEnabled(output),
        continuityOverlapFrames: Math.max(1, Math.min(81, parseInt(rawOverlap, 10) || 9)),
        audioMode: normalizeAudioMode(output.audioMode ?? output.audio_mode),
    };
}

function stripTimelineContinuityRootFields(timeline) {
    if (!timeline || typeof timeline !== "object") return;
    delete timeline.continuityEnabled;
    delete timeline.continuity_enabled;
    delete timeline.continuityOverlapFrames;
    delete timeline.continuity_overlap_frames;
}

/** Drop ephemeral UI-only fields so they never persist in timeline_data. */
function sanitizeRefImage(ref) {
    if (!ref || typeof ref !== "object") return ref;
    const index = Number(ref.index ?? ref.slot);
    return {
        index: Number.isFinite(index) ? index : 0,
        assetId: ref.assetId || ref.asset_id || "",
        imageFile: ref.imageFile || "",
        fileName: ref.fileName || "",
        type: ref.type || "input",
        subfolder: ref.subfolder || "",
    };
}

function sanitizeRefAudio(ref) {
    if (!ref || typeof ref !== "object") return ref;
    const index = Number(ref.index ?? ref.slot);
    return {
        index: Number.isFinite(index) ? index : 0,
        assetId: ref.assetId || ref.asset_id || "",
        audioFile: ref.audioFile || "",
        fileName: ref.fileName || "",
        type: ref.type || "input",
        subfolder: ref.subfolder || "",
        durationSec: ref.durationSec,
    };
}

function sanitizeRefVideo(ref) {
    if (!ref || typeof ref !== "object") return ref;
    const index = Number(ref.index ?? ref.slot);
    return {
        index: Number.isFinite(index) ? index : 0,
        assetId: ref.assetId || ref.asset_id || "",
        videoFile: ref.videoFile || "",
        fileName: ref.fileName || "",
        type: ref.type || "input",
        subfolder: ref.subfolder || "",
        durationSec: ref.durationSec,
        pairedAudioFile: ref.pairedAudioFile || "",
        previewImageFile: ref.previewImageFile || "",
        previewImageUrl: ref.previewImageUrl || "",
        linked: !!ref.linked || !!(ref.videoFile || ref.previewImageFile || ref.previewImageUrl),
    };
}

function sanitizeSegmentForPayload(seg) {
    if (!seg || typeof seg !== "object") return seg;
    const {
        previewB64,
        previewFrames,
        imageB64,
        ...rest
    } = seg;
    return {
        ...rest,
        refs: Array.isArray(rest.refs) ? rest.refs.map(sanitizeRefImage) : [],
        refAudios: Array.isArray(rest.refAudios) ? rest.refAudios.map(sanitizeRefAudio) : [],
        refVideos: Array.isArray(rest.refVideos) ? rest.refVideos.map(sanitizeRefVideo) : [],
        genImage: rest.genImage
            ? { imageFile: rest.genImage.imageFile || "", fileName: rest.genImage.fileName || "" }
            : undefined,
        referenceVideo: rest.referenceVideo
            ? {
                videoFile: rest.referenceVideo.videoFile || "",
                fileName: rest.referenceVideo.fileName || "",
                type: rest.referenceVideo.type || "input",
                subfolder: rest.referenceVideo.subfolder || "",
            }
            : undefined,
    };
}

function stripTimelineEphemeralFields(timeline) {
    if (!timeline || typeof timeline !== "object") return;
    delete timeline.videoWorkspace;
    delete timeline.batchWorkspace;
    delete timeline.batchTaskWorkspaces;
    delete timeline.fl2vWorkspace;
    // Shallow-cloned payloads still share nested refs with live state — reassign, don't mutate.
    if (Array.isArray(timeline.segments)) {
        timeline.segments = timeline.segments.map(sanitizeSegmentForPayload);
    }
    if (timeline.global && typeof timeline.global === "object") {
        timeline.global = {
            ...timeline.global,
            refs: Array.isArray(timeline.global.refs)
                ? timeline.global.refs.map(sanitizeRefImage)
                : [],
            refAudios: Array.isArray(timeline.global.refAudios)
                ? timeline.global.refAudios.map(sanitizeRefAudio)
                : [],
            refVideos: Array.isArray(timeline.global.refVideos)
                ? timeline.global.refVideos.map(sanitizeRefVideo)
                : [],
            referenceVideo: timeline.global.referenceVideo
                ? {
                    videoFile: timeline.global.referenceVideo.videoFile || "",
                    fileName: timeline.global.referenceVideo.fileName || "",
                    type: timeline.global.referenceVideo.type || "input",
                    subfolder: timeline.global.referenceVideo.subfolder || "",
                }
                : timeline.global.referenceVideo,
        };
    }
    if (timeline.r2vCommon && typeof timeline.r2vCommon === "object") {
        timeline.r2vCommon = {
            refs: Array.isArray(timeline.r2vCommon.refs)
                ? timeline.r2vCommon.refs.map(sanitizeRefImage) : [],
            refAudios: Array.isArray(timeline.r2vCommon.refAudios)
                ? timeline.r2vCommon.refAudios.map(sanitizeRefAudio) : [],
            refVideos: Array.isArray(timeline.r2vCommon.refVideos)
                ? timeline.r2vCommon.refVideos.map(sanitizeRefVideo) : [],
        };
    }
    if (timeline.video && typeof timeline.video === "object") {
        const hasFile = !!(timeline.video.videoFile || timeline.video.fileName);
        const dropFrames = hasFile
            || (Array.isArray(timeline.video.frames) && timeline.video.frames.length > 8);
        timeline.video = {
            ...timeline.video,
            frames: dropFrames ? [] : (timeline.video.frames || []),
        };
    }
    if (Array.isArray(timeline.videoClips)) {
        timeline.videoClips = timeline.videoClips.map((clip) => {
            if (!clip || typeof clip !== "object") return clip;
            const dropFrames = !!(clip.videoFile || clip.fileName)
                || (Array.isArray(clip.frames) && clip.frames.length > 8);
            return dropFrames ? { ...clip, frames: [] } : { ...clip };
        });
    }
}

const HIDDEN_WIDGETS = [
    "timeline_data", "total_frames", "width", "height", "ref_max_size",
    "task_type", "global_prompt", "frame_rate", "cfg", "postprocess_config",
    // seed stays visible under 采样设置 (with control_after_generate)
];

const DIRECTOR_WIDGET_LABEL_KEYS = {
    seed: "widget.seed",
    motion_context_enabled: "widget.motionContextEnabled",
    context_length: "widget.contextLength",
    source_overlap_frames: "widget.sourceBridgeEnabled",
    audio_context_enabled: "widget.audioContextEnabled",
    color_reanchor_enabled: "widget.colorReanchorEnabled",
    pin_renorm_enabled: "widget.pinRenormEnabled",
    steps: "widget.steps",
    sampler_name: "widget.samplerName",
    scheduler: "widget.scheduler",
    shift_video: "widget.shiftVideo",
    shift_audio: "widget.shiftAudio",
    clear_vram_between_segments: "widget.clearVram",
    export_source_images: "widget.exportSourceImages",
    control_after_generate: "widget.controlAfterGenerate",
    "control after generate": "widget.controlAfterGenerate",
};

const DIRECTOR_WIDGET_TOOLTIP_KEYS = {
    motion_context_enabled: "widget.tooltip.motionContextEnabled",
    context_length: "widget.tooltip.contextLength",
    source_overlap_frames: "widget.tooltip.sourceBridgeEnabled",
    audio_context_enabled: "widget.tooltip.audioContextEnabled",
    color_reanchor_enabled: "widget.tooltip.colorReanchorEnabled",
    pin_renorm_enabled: "widget.tooltip.pinRenormEnabled",
    clear_vram_between_segments: "widget.tooltip.clearVram",
    export_source_images: "widget.tooltip.exportSourceImages",
};

const DIRECTOR_GROUP_LABEL_KEYS = {
    bd_grp_sample: "widget.grpSample",
    bd_grp_motion: "widget.grpMotion",
    mmx_postprocess_group: "widget.grpPostprocess",
    bd_grp_advanced: "widget.grpAdvanced",
    bd_grp_perf: "widget.grpPerf",
    bd_grp_experimental: "widget.grpExperimental",
};

function applyDirectorWidgetLabels(node) {
    for (const w of node.widgets || []) {
        const name = String(w.name || "");
        const key = DIRECTOR_WIDGET_LABEL_KEYS[name]
            || (/(control[_\s]?after[_\s]?generate|生成前后)/i.test(name) || /生成前后/.test(String(w.label || ""))
                ? "widget.controlAfterGenerate"
                : null);
        if (key) {
            w.label = t(key);
            if (w.options) w.options.label = w.label;
        }
        const tipKey = DIRECTOR_WIDGET_TOOLTIP_KEYS[name];
        if (tipKey) setWidgetTooltip(w, t(tipKey), node);
        const inputType = Array.isArray(w.inputData)
            ? w.inputData[0]
            : Array.isArray(w.input_data)
                ? w.input_data[0]
                : null;
        if (String(w.type || "").toLowerCase() === "toggle" || inputType === "BOOLEAN") {
            w.options = w.options || {};
            if (!w._mmxDirectorBooleanRendererSnapshot) {
                w._mmxDirectorBooleanRendererSnapshot = {
                    draw: w.draw,
                    hasOn: Object.prototype.hasOwnProperty.call(w.options, "on"),
                    on: w.options.on,
                    hasOff: Object.prototype.hasOwnProperty.call(w.options, "off"),
                    off: w.options.off,
                };
            }
            const snapshot = w._mmxDirectorBooleanRendererSnapshot;
            if (snapshot.hasOn) w.options.on = snapshot.on;
            else delete w.options.on;
            if (snapshot.hasOff) w.options.off = snapshot.off;
            else delete w.options.off;
            w.draw = drawDirectorBooleanWidget;
        }
        const gKey = DIRECTOR_GROUP_LABEL_KEYS[name] || w._mmxGroupI18nKey;
        if (gKey) {
            const label = t(gKey);
            w._mmxGroupI18nKey = gKey;
            w._bdGroupLabel = label;
            w.value = label;
            if (w.element) w.element.textContent = label;
        }
        // Linked seed → control_after_generate combo (ComfyUI core).
        for (const linked of w.linkedWidgets || []) {
            const ln = String(linked?.name || linked?.label || "");
            if (/(control[_\s]?after[_\s]?generate|生成前后)/i.test(ln)) {
                linked.label = t("widget.controlAfterGenerate");
                if (linked.options) linked.options.label = linked.label;
            }
        }
    }
    refreshSamplingModeUi(node);
    refreshDirectorContinuityUi(node);
}

function applyDirectorNodeDataTooltips(nodeData) {
    for (const [name, tipKey] of Object.entries(DIRECTOR_WIDGET_TOOLTIP_KEYS)) {
        setNodeInputTooltip(nodeData, name, t(tipKey));
    }
}

function drawContinuityToggle(ctx, width, y, label, checked, enabled) {
    const margin = 10;
    const rowH = 24;
    const alpha = enabled ? 1 : 0.38;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = DIRECTOR_STATE_COLORS.neutralBackground;
    ctx.strokeStyle = DIRECTOR_STATE_COLORS.neutralBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(margin, y + 1, width - margin * 2, rowH - 2, 5);
    else ctx.rect(margin, y + 1, width - margin * 2, rowH - 2);
    ctx.fill();
    ctx.stroke();
    const boxX = width - margin - 34;
    const boxY = y + 5;
    ctx.fillStyle = checked ? DIRECTOR_STATE_COLORS.activeBackground : "#3a3a3a";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, boxY, 28, 14, 7);
    else ctx.rect(boxX, boxY, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.beginPath();
    ctx.arc(checked ? boxX + 20 : boxX + 8, boxY + 7, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8dce8";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, margin + 12, y + rowH / 2);
    ctx.restore();
    return [margin, y + 1, width - margin * 2, rowH - 2];
}

function drawContinuityValueRow(ctx, width, y, label, value, dropdown = false) {
    const margin = 10;
    const rowH = 24;
    ctx.save();
    ctx.fillStyle = "#252525";
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(margin, y + 1, width - margin * 2, rowH - 2, 5);
    else ctx.rect(margin, y + 1, width - margin * 2, rowH - 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#d8dce8";
    ctx.fillText(label, margin + 12, y + rowH / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#b9c4dc";
    ctx.fillText(value, width - margin - (dropdown ? 24 : 12), y + rowH / 2);
    if (dropdown) {
        ctx.fillStyle = "#9da7bc";
        ctx.beginPath();
        ctx.moveTo(width - margin - 16, y + 10);
        ctx.lineTo(width - margin - 8, y + 10);
        ctx.lineTo(width - margin - 12, y + 15);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    return [margin, y + 1, width - margin * 2, rowH - 2];
}

function pointInBounds(pos, bounds) {
    return !!bounds
        && pos[0] >= bounds[0]
        && pos[0] <= bounds[0] + bounds[2]
        && pos[1] >= bounds[1]
        && pos[1] <= bounds[1] + bounds[3];
}

function installContinuityCallbackGuard(node, widget) {
    if (!widget || widget._mmxContinuityCallbackGuarded) return;
    widget._mmxContinuityCallbackGuarded = true;
    const original = widget.callback;
    widget.callback = function (...args) {
        const disposition = handleDisabledWidgetCallback(this, {
            configuring: !!node._mmxContinuityConfiguring,
        });
        if (disposition === "block") {
            node.setDirtyCanvas?.(true, true);
            return undefined;
        }
        const result = original?.apply(this, args);
        refreshDirectorContinuityUi(node);
        return result;
    };
}

function setContinuityWidgetEnabled(widget, enabled) {
    syncDisabledWidgetState(widget, enabled);
}

function captureContinuityRenderer(widget) {
    if (!widget || widget._mmxContinuityRendererSnapshot) return;
    widget._mmxContinuityRendererSnapshot = {
        type: widget.type,
        draw: widget.draw,
        mouse: widget.mouse,
        onClick: widget.onClick,
        onPointerDown: widget.onPointerDown,
    };
}

function restoreContinuityRenderer(widget) {
    if (!widget?._mmxContinuityRendererSnapshot) return;
    const snapshot = widget._mmxContinuityRendererSnapshot;
    widget.type = snapshot.type;
    if (snapshot.draw === undefined) delete widget.draw;
    else widget.draw = snapshot.draw;
    if (snapshot.mouse === undefined) delete widget.mouse;
    else widget.mouse = snapshot.mouse;
    if (snapshot.onClick === undefined) delete widget.onClick;
    else widget.onClick = snapshot.onClick;
    if (snapshot.onPointerDown === undefined) delete widget.onPointerDown;
    else widget.onPointerDown = snapshot.onPointerDown;
}

function continuityStrategyLabel(strategy) {
    if (strategy === VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE) {
        return t("widget.strategy.sourceBridge");
    }
    if (strategy === VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT) {
        return t("widget.strategy.motionContext");
    }
    return t("widget.strategy.off");
}

function applyVideoContinuityStrategy(node, strategy, callbackArgs = []) {
    const source = node.widgets?.find((w) => w.name === "source_overlap_frames");
    const motion = node.widgets?.find((w) => w.name === "motion_context_enabled");
    if (!source || !motion) return;
    applyVideoStrategyToWidgets({
        node,
        sourceWidget: source,
        motionWidget: motion,
        strategy,
        callbackArgs,
    });
    refreshDirectorContinuityUi(node);
}

function openContinuityStrategyMenu(event, pos, node) {
    const strategies = [
        VIDEO_CONTINUITY_STRATEGIES.SOURCE_BRIDGE,
        VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT,
        VIDEO_CONTINUITY_STRATEGIES.OFF,
    ];
    const labels = strategies.map(continuityStrategyLabel);
    const select = (value) => {
        const strategy = strategies.includes(value)
            ? value
            : strategies[labels.indexOf(value)];
        if (!strategy) return;
        applyVideoContinuityStrategy(node, strategy, [app.canvas, node, pos, event]);
    };
    const ContextMenu = globalThis.LiteGraph?.ContextMenu;
    if (ContextMenu) {
        new ContextMenu(labels, {
            event,
            node,
            scale: Math.max(1, Number(app.canvas?.ds?.scale) || 1),
            className: "dark",
            callback: select,
        });
        return;
    }

    const root = document.createElement("div");
    root.className = "litegraph litecontextmenu litemenubar-panel dark";
    root.setAttribute("role", "menu");
    root.style.position = "fixed";
    root.style.zIndex = "100000";
    root.style.minWidth = "150px";

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("pointerdown", closeOnOutside, true);
        document.removeEventListener("keydown", closeOnEscape, true);
        root.remove();
    };
    const closeOnOutside = (outsideEvent) => {
        if (!root.contains(outsideEvent.target)) close();
    };
    const closeOnEscape = (keyEvent) => {
        if (keyEvent.key === "Escape") close();
    };

    strategies.forEach((strategy, index) => {
        const item = document.createElement("div");
        item.className = "litemenu-entry submenu";
        item.setAttribute("role", "menuitem");
        item.tabIndex = index === 0 ? 0 : -1;
        item.textContent = labels[index];
        item.addEventListener("pointerdown", (itemEvent) => {
            itemEvent.preventDefault();
            itemEvent.stopPropagation();
        });
        item.addEventListener("click", (itemEvent) => {
            itemEvent.preventDefault();
            itemEvent.stopPropagation();
            select(strategy);
            close();
        });
        item.addEventListener("keydown", (keyEvent) => {
            if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                keyEvent.preventDefault();
                select(strategy);
                close();
            }
        });
        root.append(item);
    });

    document.body.append(root);
    const bounds = root.getBoundingClientRect();
    const left = Math.max(4, Math.min(event.clientX - 10, window.innerWidth - bounds.width - 4));
    const top = Math.max(4, Math.min(event.clientY - 10, window.innerHeight - bounds.height - 4));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.querySelector('[role="menuitem"]')?.focus();
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
}

function openSegmentContextLinkMenu(event, editor, index) {
    const options = [
        { label: `${t("contextLink.visual")} + ${t("contextLink.audio")}`, visual: true, audio: true },
        { label: t("contextLink.visual"), visual: true, audio: false },
        { label: t("contextLink.audio"), visual: false, audio: true },
        { label: "×", visual: false, audio: false },
    ];
    const choose = (value) => {
        const option = typeof value === "string"
            ? options.find((item) => item.label === value)
            : value;
        if (option) editor.setSegmentContextChannels(index, option);
    };
    const ContextMenu = globalThis.LiteGraph?.ContextMenu;
    if (ContextMenu) {
        new ContextMenu(options.map((item) => item.label), {
            event,
            node: editor.node,
            scale: Math.max(1, Number(app.canvas?.ds?.scale) || 1),
            className: "dark",
            callback: choose,
        });
        return;
    }
    const root = document.createElement("div");
    root.className = "litegraph litecontextmenu litemenubar-panel dark";
    root.style.position = "fixed";
    root.style.zIndex = "100000";
    for (const option of options) {
        const item = document.createElement("div");
        item.className = "litemenu-entry submenu";
        item.textContent = option.label;
        item.onclick = () => { choose(option); root.remove(); };
        root.append(item);
    }
    document.body.append(root);
    root.style.left = `${Math.max(4, event.clientX)}px`;
    root.style.top = `${Math.max(4, event.clientY)}px`;
    setTimeout(() => document.addEventListener("pointerdown", () => root.remove(), { once: true }), 0);
}

function installContinuityPointerClick(widget, handler) {
    widget.onPointerDown = function (pointer, pointerNode, canvas) {
        const downEvent = pointer.eDown;
        pointer.onClick = (upEvent) => handler(
            upEvent || downEvent,
            canvas?.graph_mouse || [0, 0],
            pointerNode,
            canvas,
        );
        return true;
    };
}

function scheduleContinuityNodeResize(node, editor) {
    if (!node || node._mmxContinuityResizePending) return;
    node._mmxContinuityResizePending = true;
    queueMicrotask(() => {
        node._mmxContinuityResizePending = false;
        syncDirectorNodeSize(node, editor || node._minimaxEditor);
    });
}

function togglePinRenormFromContinuityFacade(node, event, pos) {
    if (!node?._mmxContinuityUiState?.pinRenormControlEnabled) return false;
    const pin = node.widgets?.find((w) => w.name === "pin_renorm_enabled");
    if (!pin) return false;
    const changed = toggleBooleanWidgetValue(
        node,
        pin,
        true,
        [app.canvas, node, pos, event],
    );
    if (!changed) return false;
    (app.graph ?? app.canvas?.graph)?.change?.();
    refreshDirectorContinuityUi(node);
    return true;
}

function drawDirectorBooleanWidget(ctx, _node, width, y, height = 20) {
    const margin = 10;
    const rowHeight = Math.max(18, Number(height) || 20);
    const checked = this.value === true
        || (typeof this.value === "string"
            && !["", "0", "false", "off", "no"].includes(this.value.trim().toLowerCase()));
    const x = margin;
    const rowWidth = Math.max(20, width - margin * 2);
    const trackWidth = 28;
    const trackHeight = 14;
    const trackX = width - margin - trackWidth - 5;
    const trackY = y + (rowHeight - trackHeight) / 2;

    ctx.save();
    ctx.fillStyle = DIRECTOR_STATE_COLORS.neutralBackground;
    ctx.strokeStyle = checked
        ? DIRECTOR_STATE_COLORS.accent
        : DIRECTOR_STATE_COLORS.neutralBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y + 1, rowWidth, rowHeight - 2, 5);
    else ctx.rect(x, y + 1, rowWidth, rowHeight - 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = checked
        ? DIRECTOR_STATE_COLORS.activeBackground
        : "#3a3a3a";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(trackX, trackY, trackWidth, trackHeight, 7);
    else ctx.rect(trackX, trackY, trackWidth, trackHeight);
    ctx.fill();

    ctx.fillStyle = checked ? DIRECTOR_STATE_COLORS.accent : "#ddd";
    ctx.beginPath();
    ctx.arc(checked ? trackX + 20 : trackX + 8, trackY + 7, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d8dce8";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(this.label || this.name || "", margin + 12, y + rowHeight / 2);
    ctx.restore();
}

function getNodePostprocessStore(node) {
    if (node?._mmxPostprocessStore) return node._mmxPostprocessStore;
    const widget = node?.widgets?.find((item) => item.name === "postprocess_config");
    if (!widget) return null;
    node._mmxPostprocessStore = new PostprocessConfigStore(widget, {
        onChange: () => {
            node.setDirtyCanvas?.(true, true);
            (app.graph ?? app.canvas?.graph)?.change?.();
            node._minimaxEditor?.postprocessUi?.render?.(node._mmxPostprocessStore.get());
        },
    });
    return node._mmxPostprocessStore;
}

function postprocessProxyState(node, section) {
    const store = getNodePostprocessStore(node);
    const config = store?.get?.();
    const enabled = !!config?.[section]?.enabled;
    const label = section === "global_refine" ? t("postprocess.global") : t("postprocess.face");
    const summary = section === "global_refine"
        ? globalRefineSummary(config, Number(node.widgets?.find((w) => w.name === "width")?.value || 864), Number(node.widgets?.find((w) => w.name === "height")?.value || 480), getLocale())
        : faceRefineSummary(config, getLocale());
    return { enabled, label, summary };
}

function drawPostprocessToggle(ctx, node, width, y, height = 20) {
    const state = postprocessProxyState(node, this._mmxSection);
    this.value = state.enabled;
    this.label = state.label;
    drawDirectorBooleanWidget.call(this, ctx, node, width, y, height);
}

function drawPostprocessSummary(ctx, node, width, y, height = 18) {
    const state = postprocessProxyState(node, this._mmxSection);
    const maxWidth = Math.max(20, width - 44);
    ctx.save();
    ctx.fillStyle = state.enabled ? "#9da7bc" : DIRECTOR_STATE_COLORS.disabled;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let clipped = String(state.summary || (getLocale() === "en" ? "Disabled" : "已停用"));
    while (clipped.length > 1 && ctx.measureText(clipped).width > maxWidth) clipped = `${clipped.slice(0, -2)}…`;
    ctx.fillText(clipped, 22, y + Math.max(16, Number(height) || 18) / 2);
    ctx.restore();
}

function installDirectorPostprocessUi(node) {
    const store = getNodePostprocessStore(node);
    if (!store || !node?.widgets) return;
    const backend = node.widgets.find((item) => item.name === "postprocess_config");
    hideWidget(backend);
    const specs = [
        ["mmx_postprocess_group", null, 26, null, "group"],
        ["mmx_global_refine_proxy", "global_refine", 24, drawPostprocessToggle, "toggle"],
        ["mmx_global_refine_summary", "global_refine", 18, drawPostprocessSummary, "summary"],
        ["mmx_face_refine_proxy", "face_refine", 24, drawPostprocessToggle, "toggle"],
        ["mmx_face_refine_summary", "face_refine", 18, drawPostprocessSummary, "summary"],
    ];
    const proxies = specs.map(([name, section, height, draw, kind]) => {
        let widget = node.widgets.find((item) => item.name === name);
        if (!widget) {
            widget = kind === "group"
                ? makeGroupHeaderWidget(name, ["BDGROUP", { default: t("widget.grpPostprocess") }])
                : {
                    name, type: "custom", value: null, serialize: false,
                    options: { serialize: false }, _mmxSection: section,
                    computeSize: (width) => [width, height], draw,
                    mouse: () => false,
                };
            widget.serialize = false;
            widget.options = { ...(widget.options || {}), serialize: false };
            if (kind === "toggle") installContinuityPointerClick(widget, (event, pos) => {
                store.toggle(section);
                node.setDirtyCanvas?.(true, true);
                return true;
            });
        }
        return widget;
    });
    for (const proxy of proxies) {
        const index = node.widgets.indexOf(proxy);
        if (index >= 0) node.widgets.splice(index, 1);
    }
    const advancedIndex = node.widgets.findIndex((item) => item.name === "bd_grp_advanced");
    node.widgets.splice(advancedIndex >= 0 ? advancedIndex : node.widgets.length, 0, ...proxies);
}

const DIRECTOR_TRANSIENT_WIDGETS = new Set([
    "mmx_postprocess_group", "mmx_global_refine_proxy", "mmx_global_refine_summary",
    "mmx_face_refine_proxy", "mmx_face_refine_summary", "mmx_pin_renorm_proxy",
]);

function detachDirectorTransientWidgets(node) {
    if (!node?.widgets?.length) return;
    for (let index = node.widgets.length - 1; index >= 0; index -= 1) {
        if (DIRECTOR_TRANSIENT_WIDGETS.has(node.widgets[index]?.name)) node.widgets.splice(index, 1);
    }
}



function cloneDirectorWidgetValue(value) {
    if (value == null || typeof value !== "object") {
        return value ?? null;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function captureDirectorWidgetState(node) {
    const state = {};

    for (const widget of node?.widgets || []) {
        if (!widget?.name) continue;
        if (widget.serialize === false) continue;
        if (DIRECTOR_TRANSIENT_WIDGETS.has(widget.name)) continue;

        state[widget.name] = cloneDirectorWidgetValue(
            widget.value,
        );
    }

    return state;
}

function restoreDirectorWidgetState(node, serializedNode) {
    if (!node || !serializedNode) {
        return false;
    }

    const namedValues = serializedNode.widgets_values_named;

    const savedProperties =
        serializedNode.properties?.mmx_director_widget_state;

    let source = null;

    if (
        namedValues
        && typeof namedValues === "object"
        && !Array.isArray(namedValues)
        && Object.keys(namedValues).length > 0
    ) {
        source = namedValues;
    } else if (
        savedProperties
        && typeof savedProperties === "object"
        && !Array.isArray(savedProperties)
    ) {
        source = savedProperties;
    }

    if (!source) {
        return false;
    }

    let restored = 0;

    for (const widget of node.widgets || []) {
        if (!widget?.name) continue;
        if (widget.serialize === false) continue;
        if (DIRECTOR_TRANSIENT_WIDGETS.has(widget.name)) continue;

        if (
            !Object.prototype.hasOwnProperty.call(
                source,
                widget.name,
            )
        ) {
            continue;
        }

        widget.value = cloneDirectorWidgetValue(
            source[widget.name],
        );

        restored += 1;
    }

    return restored > 0;
}


function migrateReorderedDirectorTail(serializedNode, currentWidgets = []) {
    const values = serializedNode?.widgets_values;

    if (!Array.isArray(values) || !Array.isArray(currentWidgets)) {
        return false;
    }

    const serializable = currentWidgets.filter(
        (widget) => widget?.serialize !== false,
    );

    const widgetIndex = (name) => (
        serializable.findIndex(
            (widget) => widget?.name === name,
        )
    );

    const perfIndex = widgetIndex("bd_grp_perf");
    const clearVramIndex = widgetIndex("clear_vram_between_segments");
    const exportSourceIndex = widgetIndex("export_source_images");
    const experimentalIndex = widgetIndex("bd_grp_experimental");
    const pinRenormIndex = widgetIndex("pin_renorm_enabled");
    const postprocessIndex = widgetIndex("postprocess_config");

    const indices = [
        perfIndex,
        clearVramIndex,
        exportSourceIndex,
        experimentalIndex,
        pinRenormIndex,
        postprocessIndex,
    ];

    if (
        indices.some(
            (index) => index < 0 || index >= values.length,
        )
    ) {
        return false;
    }

    const oldValues = values.slice();

    const looksLikeReorderedLayout = (
        typeof oldValues[perfIndex] === "string"
        && typeof oldValues[clearVramIndex] === "boolean"
        && typeof oldValues[exportSourceIndex] === "string"
        && typeof oldValues[experimentalIndex] === "string"
        && typeof oldValues[pinRenormIndex] === "boolean"
        && typeof oldValues[postprocessIndex] === "boolean"
    );

    if (!looksLikeReorderedLayout) {
        return false;
    }

    values[perfIndex] = oldValues[experimentalIndex];
    values[clearVramIndex] = oldValues[pinRenormIndex];
    values[exportSourceIndex] = oldValues[postprocessIndex];

    values[experimentalIndex] = oldValues[perfIndex];
    values[pinRenormIndex] = oldValues[clearVramIndex];
    values[postprocessIndex] = oldValues[exportSourceIndex];

    console.warn(
        "[MiniMax H3 Motion Director] migrated legacy reordered Director widget values",
    );

    return true;
}


function repairInvalidDirectorSamplingState(node) {
    const widget = (name) => node?.widgets?.find((item) => item.name === name);
    const steps = widget("steps");
    const sampler = widget("sampler_name");
    const scheduler = widget("scheduler");
    const videoShift = widget("shift_video");
    const audioShift = widget("shift_audio");
    const invalidCount = [
        !Number.isFinite(Number(steps?.value)) || Number(steps?.value) < 1,
        !Number.isFinite(Number(videoShift?.value)) || Number(videoShift?.value) < 0.01,
        !Number.isFinite(Number(audioShift?.value)) || Number(audioShift?.value) < 0.01,
    ].filter(Boolean).length;
    if (invalidCount < 2) return false;

    // Recovery for the short-lived frontend build that inserted non-serialized
    // postprocess proxies before LiteGraph applied widgets_values.
    if (steps) steps.value = 25;
    if (sampler) sampler.value = "res_multistep";
    if (scheduler) scheduler.value = "simple";
    if (videoShift) videoShift.value = 12;
    if (audioShift) audioShift.value = 3;
    const clearVram = widget("clear_vram_between_segments");
    const sourceImages = widget("export_source_images");
    if (clearVram) clearVram.value = true;
    if (sourceImages) sourceImages.value = false;
    console.warn("[MiniMax H3 Motion Director] repaired invalid sampling values caused by transient widget ordering");
    node?.setDirtyCanvas?.(true, true);
    return true;
}

function ensurePinRenormProxy(node, pin) {
    const existing = node.widgets?.find((w) => w.name === "mmx_pin_renorm_proxy");
    if (existing) return existing;
    const proxy = {
        name: "mmx_pin_renorm_proxy",
        type: "custom",
        value: null,
        serialize: false,
        options: { serialize: false },
        computeSize: (width) => [width, 24],
        _mmxPinBackendWidget: pin,
    };
    const contextIndex = (node.widgets || []).findIndex((w) => w.name === "context_length");
    const insertAt = contextIndex >= 0 ? contextIndex + 1 : (node.widgets?.length || 0);
    node.widgets.splice(insertAt, 0, proxy);
    return proxy;
}

function installDirectorContinuityUi(node) {
    if (!node) return;
    if (node._mmxContinuityUiInstalled) {
        const pin = node.widgets?.find((w) => w.name === "pin_renorm_enabled");
        if (pin && !node.widgets?.some((w) => w.name === "mmx_pin_renorm_proxy")) ensurePinRenormProxy(node, pin);
        return;
    }
    const source = node.widgets?.find((w) => w.name === "source_overlap_frames");
    const audio = node.widgets?.find((w) => w.name === "audio_context_enabled");
    const motion = node.widgets?.find((w) => w.name === "motion_context_enabled");
    const context = node.widgets?.find((w) => w.name === "context_length");
    const color = node.widgets?.find((w) => w.name === "color_reanchor_enabled");
    const pin = node.widgets?.find((w) => w.name === "pin_renorm_enabled");
    const experimental = node.widgets?.find((w) => w.name === "bd_grp_experimental");
    if (!source || !audio || !motion || !context || !color || !pin) return;
    const pinProxy = ensurePinRenormProxy(node, pin);
    node._mmxContinuityUiInstalled = true;

    source.value = normalizeSourceBridgeValue(source.value);
    for (const widget of [source, audio, motion, context, color, pin]) {
        setWidgetVisibility(widget, true);
        captureContinuityRenderer(widget);
    }
    setWidgetVisibility(source, false);
    setWidgetVisibility(pin, false);
    setWidgetVisibility(pinProxy, true);
    setWidgetVisibility(experimental, false);
    installContinuityCallbackGuard(node, motion);
    installContinuityCallbackGuard(node, context);
    installContinuityCallbackGuard(node, audio);
    installContinuityCallbackGuard(node, color);
    installContinuityCallbackGuard(node, pin);
    node.setDirtyCanvas?.(true, true);
}

function refreshDirectorContinuityUi(node, editor = node?._minimaxEditor) {
    if (!node) return null;
    installDirectorContinuityUi(node);
    if (!node._mmxContinuityUiInstalled) return null;
    const source = node.widgets?.find((w) => w.name === "source_overlap_frames");
    const audio = node.widgets?.find((w) => w.name === "audio_context_enabled");
    const motion = node.widgets?.find((w) => w.name === "motion_context_enabled");
    const context = node.widgets?.find((w) => w.name === "context_length");
    const color = node.widgets?.find((w) => w.name === "color_reanchor_enabled");
    const pin = node.widgets?.find((w) => w.name === "pin_renorm_enabled");
    const experimental = node.widgets?.find((w) => w.name === "bd_grp_experimental");
    const pinProxy = node.widgets?.find((w) => w.name === "mmx_pin_renorm_proxy");
    const taskKey = editor?.getTaskKey?.() || resolveTaskKey(
        node.widgets?.find((w) => w.name === "task_type")?.value,
    );
    const segmentCount = editor?.getRunnableSegmentCount?.()
        ?? editor?.timeline?.segments?.length
        ?? 1;
    const state = resolveContinuityUiState({
        taskKey,
        segmentCount,
        motionContextEnabled: motion?.value,
        contextFrames: context?.value,
        sourceBridgeValue: source?.value,
        audioContextEnabled: audio?.value,
        colorReanchorEnabled: color?.value,
        audioMode: editor?.timeline?.output?.audioMode || "generate",
    });
    source.value = state.sourceBridgeValue;
    node._mmxContinuityUiState = state;
    const spatialStride = editor?.getH3SpatialStride?.();
    if (spatialStride && editor._mmxH3SpatialStride !== spatialStride) {
        editor._mmxH3SpatialStride = spatialStride;
        editor.syncOutputToWidgets?.();
        editor.scheduleTimelineSync?.();
    }

    restoreContinuityRenderer(motion);
    restoreContinuityRenderer(source);
    restoreContinuityRenderer(audio);
    restoreContinuityRenderer(color);
    const showPinProxy = segmentCount >= 2;
    setWidgetVisibility(source, false);
    setWidgetVisibility(pin, false);
    setWidgetVisibility(pinProxy, showPinProxy);
    setWidgetVisibility(experimental, false);
    setWidgetVisibility(
        motion,
        state.showMotionContext || state.showVisualContinuitySelector,
    );
    setWidgetVisibility(context, state.showContextFrames);
    setWidgetVisibility(
        audio,
        state.showAudioContinuation || state.showBridgeLength,
    );
    setWidgetVisibility(color, state.showColorReanchor);

    setContinuityWidgetEnabled(
        motion,
        state.motionContextControlEnabled || state.showVisualContinuitySelector,
    );
    setContinuityWidgetEnabled(context, state.contextFramesControlEnabled);
    setContinuityWidgetEnabled(audio, state.audioContextControlEnabled);
    setContinuityWidgetEnabled(color, state.colorReanchorControlEnabled);
    setContinuityWidgetEnabled(pin, state.pinRenormControlEnabled);
    setContinuityWidgetEnabled(pinProxy, state.pinRenormControlEnabled);

    audio.options = audio.options || {};
    motion.options = motion.options || {};
    context.options = context.options || {};
    source.options = source.options || {};
    color.options = color.options || {};

    if (state.showVisualContinuitySelector) {
        motion.type = "custom";
        motion.label = t("widget.visualContinuity");
        setWidgetTooltip(motion, t("widget.tooltip.visualContinuity"), node);
        motion.draw = function (ctx, drawNode, width, y) {
            this._mmxContinuitySelectorBounds = drawContinuityValueRow(
                ctx,
                width,
                y,
                t("widget.visualContinuity"),
                continuityStrategyLabel(drawNode._mmxContinuityUiState?.videoStrategy),
                true,
            );
        };
        motion.mouse = function (event, pos, mouseNode) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
            if (!pointInBounds(pos, this._mmxContinuitySelectorBounds)) return false;
            event.preventDefault?.();
            openContinuityStrategyMenu(event, pos, mouseNode);
            return true;
        };
        motion.onClick = function ({ e, node: clickNode, canvas }) {
            const pos = canvas?.graph_mouse || [0, 0];
            openContinuityStrategyMenu(e, pos, clickNode);
        };
        installContinuityPointerClick(motion, (event, pos, clickNode) => {
            openContinuityStrategyMenu(event, pos, clickNode);
        });
    } else {
        motion.label = t("widget.motionContextEnabled");
        setWidgetTooltip(motion, t("widget.tooltip.motionContextEnabled"), node);
    }

    context.label = t("widget.contextLength");
    setWidgetTooltip(context, t("widget.tooltip.contextLength"), node);
    pinProxy.type = "custom";
    pinProxy.label = t("widget.pinRenormEnabled");
    setWidgetTooltip(
        pinProxy,
        state.pinRenormControlEnabled
            ? t("widget.tooltip.pinRenormEnabled")
            : t("widget.tooltip.pinRenormUnavailable"),
        node,
    );
    pinProxy.draw = function (ctx, drawNode, width, y) {
        this._mmxPinRenormFacadeBounds = drawContinuityToggle(
            ctx,
            width,
            y,
            t("widget.pinRenormEnabled"),
            !!pin.value,
            !!drawNode._mmxContinuityUiState?.pinRenormControlEnabled,
        );
    };
    pinProxy.mouse = function (event, pos, mouseNode) {
        if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
        if (!pointInBounds(pos, this._mmxPinRenormFacadeBounds)) return false;
        event.preventDefault?.();
        return togglePinRenormFromContinuityFacade(mouseNode, event, pos);
    };
    pinProxy.onClick = function ({ e, node: clickNode, canvas }) {
        togglePinRenormFromContinuityFacade(
            clickNode,
            e,
            canvas?.graph_mouse || [0, 0],
        );
    };
    installContinuityPointerClick(pinProxy, (event, pos, clickNode) => {
        togglePinRenormFromContinuityFacade(clickNode, event, pos);
    });
    color.label = t("widget.colorReanchorEnabled");
    setWidgetTooltip(color, t("widget.tooltip.colorReanchorEnabled"), node);

    if (state.showBridgeLength) {
        audio.type = "custom";
        setWidgetTooltip(audio, t("widget.tooltip.sourceBridgeEnabled"), node);
        audio.draw = function (ctx, drawNode, width, y) {
            drawContinuityValueRow(
                ctx,
                width,
                y,
                t("widget.bridgeLength"),
                t("widget.bridgeLengthFixed"),
            );
        };
        audio.mouse = (event) => event.type === "pointerdown" || event.type === "mousedown";
        audio.onClick = () => {};
        installContinuityPointerClick(audio, () => {});
    } else if (state.showAudioContinuation && !state.audioContextControlEnabled) {
        audio.type = "custom";
        setWidgetTooltip(audio, t("widget.tooltip.audioContextEnabled"), node);
        audio.draw = function (ctx, drawNode, width, y) {
            drawContinuityToggle(ctx, width, y, t("widget.audioContextEnabled"), false, false);
        };
        audio.mouse = () => true;
        audio.onClick = () => {};
        installContinuityPointerClick(audio, () => {});
    } else {
        audio.label = t("widget.audioContextEnabled");
        setWidgetTooltip(audio, t("widget.tooltip.audioContextEnabled"), node);
    }

    const group = node.widgets?.find((w) => w.name === "bd_grp_motion");
    if (group) {
        group._mmxContinuitySingleMessage = state.showSingleSegmentMessage
            ? t("widget.continuityMultiOnly")
            : "";
    }
    const layoutSignature = [
        state.mode,
        state.videoStrategy,
        state.showMotionContext,
        state.showContextFrames,
        state.showAudioContinuation,
        state.showVisualContinuitySelector,
        state.showBridgeLength,
        state.showColorReanchor,
    ].join("|");
    if (node._mmxContinuityLayoutSignature !== layoutSignature) {
        node._mmxContinuityLayoutSignature = layoutSignature;
        scheduleContinuityNodeResize(node, editor);
    }
    node.setDirtyCanvas?.(true, true);
    return state;
}

function refreshSamplingModeUi(node) {
    if (!node) return "internal";
    const state = applySamplingWidgetVisibility(node);
    const statusKey = state === "external"
        ? "sampling.status.external"
        : state === "incomplete"
            ? "sampling.status.incomplete"
            : "sampling.status.internal";
    const label = `${t("widget.grpAdvanced")} · ${t(statusKey)}`;
    const header = node.widgets?.find((widget) => widget?.name === "bd_grp_advanced");
    if (header) {
        header._mmxSamplingStatusText = label;
        header._bdGroupLabel = label;
        header.value = label;
        if (header.element) {
            header.element.textContent = label;
            header.element.style.borderLeftColor = state === "incomplete" ? "#ff6b6b" : "#7a9cff";
        }
    }
    node.setDirtyCanvas?.(true, true);
    return state;
}

function drawGroupHeader(ctx, node, widget_width, y, H, label) {
    const margin = 10;
    const barH = Math.max(18, H - 4);
    ctx.fillStyle = "#2e2e2e";
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(margin, y + 2, widget_width - margin * 2, barH, 4);
    } else {
        ctx.rect(margin, y + 2, widget_width - margin * 2, barH);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d8dce8";
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, margin + 10, y + 2 + barH / 2);
}

function makeGroupHeaderWidget(inputName, inputData) {
    const opts = inputData?.[1] || {};
    const i18nKey = DIRECTOR_GROUP_LABEL_KEYS[inputName];
    const label = i18nKey ? t(i18nKey) : (opts.default || opts.label || inputName);
    const el = document.createElement("div");
    el.className = "bd-widget-group";
    el.textContent = label;
    el.style.cssText = [
        "width:100%;box-sizing:border-box;margin:8px 0 4px;padding:6px 10px",
        "border:1px solid #555;border-left:3px solid #7a9cff;border-radius:4px",
        "color:#d8dce8;font-size:11px;font-weight:600;letter-spacing:.02em",
        "background:linear-gradient(180deg,#2e2e2e 0%,#242424 100%)",
        "pointer-events:none;user-select:none",
    ].join(";");
    return {
        name: inputName,
        type: "BDGROUP",
        value: label,
        label: "",
        element: el,
        options: opts,
        _bdGroupHeader: true,
        _mmxGroupI18nKey: i18nKey || null,
        _bdGroupLabel: label,
        draw(ctx, node, widget_width, y, H) {
            const text = this._mmxSamplingStatusText
                || (this._mmxGroupI18nKey ? t(this._mmxGroupI18nKey) : (this._bdGroupLabel || label));
            const singleMessage = inputName === "bd_grp_motion"
                ? this._mmxContinuitySingleMessage
                : "";
            drawGroupHeader(ctx, node, widget_width, y, singleMessage ? 26 : H, text);
            if (singleMessage) {
                ctx.save();
                ctx.fillStyle = "#9da7bc";
                ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(singleMessage, 20, y + 39);
                ctx.restore();
            }
        },
        computeSize(width) {
            const singleMessage = inputName === "bd_grp_motion"
                && this._mmxContinuitySingleMessage;
            return [width, singleMessage ? 48 : 26];
        },
        mouse() {
            return false;
        },
    };
}

const STYLES = `
.mmx-host{width:100%;box-sizing:border-box;display:block}
/* min-height follows content estimate; avoid flex-grow voids when node is oversized. */
.bd-wrap{--mmx-accent:#4fff8f;--mmx-active-bg:#163723;--mmx-neutral-bg:#252525;--mmx-neutral-border:#555;--mmx-disabled:#777;--mmx-danger:#ef6b6b;--mmx-warning:#f0b85a;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e0e0e0;font-size:11px;display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;position:relative;min-height:var(--comfy-widget-min-height,0px);height:auto}
.bd-main{flex:0 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;width:100%}
.bd-modal-overlay{position:absolute;inset:0;z-index:200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:10px;box-sizing:border-box;border-radius:6px}
.bd-modal{background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:12px;width:100%;max-width:460px;max-height:calc(100% - 8px);display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 28px rgba(0,0,0,.5)}
.bd-modal-title{color:#e0e0e0;font-size:12px;font-weight:600;line-height:1.35}
.bd-modal-body{color:#aaa;font-size:11px;line-height:1.5;white-space:pre-wrap}
.bd-modal-body.hidden{display:none}
.bd-modal-list{flex:1;min-height:140px;max-height:240px;overflow:auto;background:#181818;border:1px solid #333;border-radius:6px;padding:4px;display:flex;flex-direction:column;gap:2px}
.bd-modal-list.hidden{display:none}
.bd-modal-item{padding:7px 8px;border-radius:4px;cursor:pointer;color:#ccc;font-size:11px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid transparent}
.bd-modal-item:hover{background:#252525;color:#eee}
.bd-modal-item.selected{background:#163723;border-color:#4fff8f;color:#4fff8f}
.bd-modal-actions{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
.bd-toolbar-wrap{display:flex;flex-direction:column;gap:4px;width:100%}
.bd-toolbar{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:nowrap;gap:6px;width:100%}
.bd-toolbar-left{display:flex;align-items:flex-start;gap:6px;flex:1 1 auto;min-width:0}
.bd-task-anchor{display:flex;align-items:center;flex:0 0 auto;order:0}
.bd-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1 1 auto;min-width:0;order:1}
.bd-smart-split-msg{width:100%;box-sizing:border-box;font-size:11px;line-height:1.4;color:#f66;padding:0 2px;min-height:0}
.bd-smart-split-msg.hidden{display:none!important}
.bd-smart-split-msg.ok{color:#8c8}
.bd-external-groups-msg{width:100%;box-sizing:border-box;font-size:11px;line-height:1.45;color:#9ad;padding:8px 10px;margin:0 0 4px;background:#152018;border:1px solid #2f4a38;border-radius:6px}
.bd-external-groups-msg.hidden{display:none!important}
.bd-wrap.bd-external-groups .bd-batch-card:not(.bd-r2v-common-card),.bd-wrap.bd-external-groups .bd-fl2v-shot{opacity:.48;pointer-events:none}
.bd-wrap.bd-external-groups .bd-run-select-bar,.bd-wrap.bd-external-groups .bd-batch-run-check,.bd-wrap.bd-external-groups .bd-run-select-all-wrap{pointer-events:auto;opacity:1}
.bd-wrap.bd-external-groups .bd-batch-card .bd-batch-run-check{pointer-events:auto;opacity:1}
/* External mode: duration/delete stay non-interactive; allow media preview playback. */
.bd-wrap.bd-external-groups .bd-batch-del,.bd-wrap.bd-external-groups .bd-batch-fc input{pointer-events:none!important;opacity:.55}
.bd-wrap.bd-external-groups .bd-r2v-play,.bd-wrap.bd-external-groups .bd-batch-video video,.bd-wrap.bd-external-groups .bd-batch-audio audio,.bd-wrap.bd-external-groups .bd-r2v-thumb{pointer-events:auto;opacity:1}
.bd-stage{width:100%;box-sizing:border-box;background:#0c0c0c;border:1px solid #222;border-bottom:none;border-radius:6px 6px 0 0;overflow:hidden;position:relative;min-height:120px;max-height:280px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
.bd-stage.hidden{display:none!important}
.bd-stage-video,.bd-stage-img{width:100%;height:100%;max-height:280px;object-fit:contain;background:#000;display:block}
.bd-stage-img.hidden,.bd-stage-video.hidden{display:none!important}
.bd-stage-empty{color:#555;font-size:11px;pointer-events:none}
.bd-stage-badge{position:absolute;left:8px;bottom:8px;padding:2px 7px;border-radius:3px;background:rgba(0,0,0,.65);color:#ccc;font-size:10px;line-height:1.4;cursor:pointer;user-select:none}
.bd-stage-badge:hover{color:#fff;background:rgba(0,0,0,.8)}
.bd-main.bd-output-before-timeline .bd-stage{border:1px solid #222;border-radius:6px}
.bd-main.bd-output-before-timeline .bd-controls{border-radius:6px;border-color:#333;background:#1e1e1e}
.bd-main.bd-output-before-timeline .bd-output{min-height:42px}
.bd-frame-jump{display:inline-flex;align-items:center;gap:4px;color:#ddd;font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
.bd-frame-jump .bd-frame-input{width:64px;background:#181818;border:1px solid #444;border-radius:4px;color:#eee;padding:4px 4px;font-size:11px;text-align:center;-moz-appearance:textfield}
.bd-frame-jump .bd-frame-input:focus{border-color:#4fff8f;outline:none}
.bd-frame-jump .bd-frame-input::-webkit-outer-spin-button,.bd-frame-jump .bd-frame-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.bd-frame-jump .bd-frame-total{color:#888;min-width:2.5em}
.bd-controls{width:100%;box-sizing:border-box;background:#151515;border:1px solid #222;border-radius:0 0 6px 6px;padding:8px 10px;margin-top:0;flex-shrink:0}
.bd-stage.hidden+.bd-controls{border-radius:6px;border-color:#333;background:#1e1e1e}
.bd-viewport{width:100%;min-width:100%;overflow-x:auto;border-radius:6px;border:1px solid #111;background:#2a2a2a;box-sizing:border-box;flex-shrink:0}
/* object-fit:fill + mismatched CSS/bitmap aspect stretches thumbs (esp. under graph zoom). */
.bd-canvas{display:block;width:100%;min-width:100%;height:auto;cursor:pointer;box-sizing:border-box;flex-shrink:0;object-fit:fill}
.bd-canvas.bd-grab{cursor:grab}
.bd-canvas.bd-grabbing{cursor:grabbing}
.bd-output{width:100%;box-sizing:border-box;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;background:#1e1e1e;border:1px solid #333;border-radius:6px}
.bd-split{display:block;width:100%;box-sizing:border-box}
.bd-player{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%}
.bd-btn{background:#222;color:#e0e0e0;border:1px solid #111;border-radius:4px;padding:6px 12px;font-size:11px;line-height:1.35;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center}
.bd-actions>.bd-btn{height:29px;min-height:29px}
.bd-btn:hover{background:#333;border-color:#555}
.bd-btn-danger:hover{background:#4a1515;border-color:#c44;color:#faa}
.bd-split-edit-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%;box-sizing:border-box;padding:6px 10px;margin:0 0 4px;background:#241818;border:1px solid #633;border-radius:6px}
.bd-split-edit-bar.hidden{display:none!important}
.bd-split-edit-bar .bd-split-edit-hint{flex:1;min-width:140px;font-size:11px;line-height:1.35;color:#f88}
.bd-btn-del-split{background:#3a2020;border-color:#e66;color:#f88}
.bd-btn-del-split:hover{background:#4a1515;border-color:#f88;color:#fcc}
.bd-btn-sm{padding:3px 8px;font-size:10px}
.bd-btn-run-select.active{background:#1a3a2a;color:#4fff8f;border-color:#4fff8f}
.bd-output .bd-output-button-group{margin-left:auto;display:inline-flex;align-items:center;gap:6px;flex-wrap:nowrap;flex-shrink:0}
.bd-output .bd-r2v-common-toggle{background:#222;border-color:#333;color:#aaa;white-space:nowrap;height:29px;min-height:29px;padding:4px 12px}
.bd-output .bd-r2v-common-toggle:hover{background:#2a2a2a;border-color:#555;color:#ddd}
.bd-output .bd-r2v-common-toggle.active{background:#1a3a2a;color:#4fff8f;border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-live-sample{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:linear-gradient(165deg,#1a1a1a 0%,#121212 100%);border:1px solid #333;border-radius:10px;flex-shrink:0}
.bd-live-sample.hidden{display:none!important}
.bd-live-sample.receiving{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-live-sample-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.bd-live-sample-head b{color:#f0f0f0;font-size:12px;font-weight:650;letter-spacing:.02em}
.bd-live-sample-head .bd-meta{color:#888;font-size:11px}
.bd-live-sample-body{position:relative;width:100%;min-height:220px;max-height:360px;flex:1 1 auto;background:#0a0a0a;border:1px solid #262626;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.bd-live-sample-body img{width:100%;height:100%;max-width:100%;max-height:360px;object-fit:contain;display:block}
.bd-live-sample-body img.hidden{display:none!important}
.bd-live-sample-empty{color:#666;font-size:12px;text-align:center;padding:16px;line-height:1.45}
.bd-live-sample-empty.hidden{display:none!important}
.bd-live-sample-badge{position:absolute;left:10px;bottom:10px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,.75);color:#cfcfcf;font-size:11px;pointer-events:none}
.bd-live-sample-badge.hidden{display:none!important}
.bd-run-select-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:#aaa}
.bd-run-select-all-wrap{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#aaa;cursor:pointer;user-select:none;margin-left:2px}
.bd-run-select-all-wrap.hidden{display:none!important}
.bd-run-select-all-wrap input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f}
.bd-run-select-bar.hidden{display:none!important}
.bd-batch-run-check{margin-right:6px;width:14px;height:14px;cursor:pointer;accent-color:#4fff8f;flex-shrink:0}
.bd-btn-primary{background:#1a3a2a;border-color:#4fff8f;color:#4fff8f}
.bd-mode{display:flex;border:1px solid #333;border-radius:4px;overflow:hidden}
.bd-mode button{border:none;background:#222;color:#aaa;padding:6px 12px;font-size:11px;cursor:pointer}
.bd-mode button.active{background:var(--mmx-active-bg);color:var(--mmx-accent)}
.bd-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bd-bounds,.bd-timecode{color:#aaa;font-size:11px}
.bd-timecode{color:#fff;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.bd-player .bd-timecode{min-width:88px;font-size:11px;color:#ddd}
.bd-icon-btn{background:#2a2a2a;border:1px solid #444;color:#eee;cursor:pointer;padding:6px 10px;border-radius:4px}
.bd-icon-btn.active{background:#1a3a2a;color:#4fff8f;border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-seek{flex:1;min-width:120px;height:6px}
.bd-panel{width:100%;box-sizing:border-box;background:#222;border:1px solid #111;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px}
.bd-panel.bd-rv2v-panel,.bd-panel.bd-v2v-panel{background:linear-gradient(165deg,#1c1c1c 0%,#141414 52%,#111 100%);border:1px solid #2c2c2c;border-radius:12px;padding:12px 14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035);gap:10px}
.bd-panel.bd-rv2v-panel>b,.bd-panel.bd-v2v-panel>b,.bd-seg-head>b{color:#f0f0f0;font-size:13px;font-weight:650;letter-spacing:.02em}
.bd-seg-head{display:flex;align-items:baseline;justify-content:flex-start;gap:10px;flex-wrap:wrap;min-width:0}
.bd-seg-head>b{flex-shrink:0;margin:0}
.bd-seg-head .bd-meta,.bd-panel.bd-v2v-panel .bd-seg-head .bd-meta,.bd-panel.bd-rv2v-panel .bd-seg-head .bd-meta{color:#8a8a8a;font-size:11px;line-height:1.45;padding:0;min-width:0}
.bd-prompt-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,38%);gap:8px;align-items:stretch}
.bd-prompt-layout>.bd-prompt-col{order:1}
.bd-prompt-layout>.bd-refs-col{order:2}
.bd-prompt-layout.bd-rv2v-layout{grid-template-columns:minmax(240px,.85fr) minmax(0,1.4fr);gap:12px}
.bd-prompt-layout.bd-rv2v-layout>.bd-refs-col{order:1}
.bd-prompt-layout.bd-rv2v-layout>.bd-prompt-col{order:2}
/* rv2v live preview: under prompt (same stack as r2v right column) */
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live>.bd-prompt-col{gap:10px}
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live>.bd-prompt-col .bd-prompt{min-height:160px;flex:1 1 auto}
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live>.bd-prompt-col>.bd-live-sample{margin:0;padding:8px 10px;min-height:0;flex:0 0 auto;border-radius:10px}
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live .bd-live-sample-body{min-height:180px;max-height:280px}
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live .bd-live-sample-body img{width:100%;max-height:280px;object-fit:contain}
.bd-prompt-layout.bd-v2v-layout{grid-template-columns:1fr;gap:0}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live{grid-template-columns:minmax(0,1.25fr) minmax(240px,.9fr);gap:12px;align-items:stretch}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live>.bd-prompt-col{order:1;min-height:220px}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live>.bd-prompt-col .bd-prompt{flex:1 1 auto;min-height:180px}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live>.bd-refs-col{display:none!important}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live>.bd-live-sample{order:2;margin:0;height:100%;min-height:220px;align-self:stretch}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live .bd-live-sample-body{flex:1 1 auto;min-height:180px;max-height:none}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live .bd-live-sample-body img{max-height:100%}
.bd-prompt-col{display:flex;flex-direction:column;gap:5px;min-width:0}
.bd-rv2v-layout .bd-prompt-col,.bd-v2v-layout .bd-prompt-col{background:#0c0c0c;border:1px solid #262626;border-radius:10px;padding:10px 12px;gap:6px;min-height:220px}
.bd-v2v-layout .bd-prompt-col{min-height:200px}
.bd-prompt-col .bd-label,.bd-refs-col .bd-label{color:#888;font-size:10px;line-height:1.2;flex-shrink:0}
.bd-rv2v-layout .bd-prompt-col .bd-label,.bd-v2v-layout .bd-prompt-col .bd-label{color:#eaeaea;font-size:11px;font-weight:700;letter-spacing:.02em}
.bd-wrap.locale-en .bd-rv2v-layout .bd-prompt-col .bd-label,.bd-wrap.locale-en .bd-v2v-layout .bd-prompt-col .bd-label{text-transform:uppercase;letter-spacing:.08em}
.bd-prompt{width:100%;min-height:96px;background:#181818;border:1px solid #333;border-radius:6px;color:#eee;padding:8px;resize:vertical;font-size:12px;box-sizing:border-box;font-family:inherit;line-height:1.35;flex:1}
.bd-rv2v-layout .bd-prompt,.bd-v2v-layout .bd-prompt{min-height:220px;background:#101010;border-color:#2e2e2e;border-radius:8px;padding:10px;font-size:12px;line-height:1.45}
.bd-v2v-layout .bd-prompt{min-height:180px}
.bd-prompt-negative{display:none!important}
.bd-refs-col{display:flex;flex-direction:column;gap:4px;min-width:0;height:100%}
.bd-rv2v-layout .bd-refs-col{gap:10px}
.bd-refs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;width:100%;flex:1;align-content:start}
.bd-rv2v-layout .bd-refs{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:0}
.bd-ref{position:relative;width:100%;aspect-ratio:1;min-width:0;max-height:64px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;font-size:9px;color:#666;transition:border-color .15s,background .15s}
.bd-rv2v-layout .bd-ref{max-height:none;min-height:0;border-radius:8px;border:1px dashed #333;background:#080808;color:#555;font-size:10px}
.bd-ref.has-img{cursor:grab;border-style:solid}
.bd-rv2v-layout .bd-ref.has-img{border-color:#3a3a3a;background:#000}
.bd-ref.has-img:active{cursor:grabbing}
.bd-ref:hover{border-color:#7a9cff;background:#1a1a1a}
.bd-rv2v-layout .bd-ref:hover{border-color:#5a5a5a;background:#101010}
.bd-ref .bd-ref-tag{position:absolute;inset:auto 0 3px 0;text-align:center;font-size:9px;color:#777;pointer-events:none;line-height:1}
.bd-ref.has-img .bd-ref-tag{display:none}
.bd-rv2v-layout .bd-ref .bd-ref-tag,.bd-rv2v-layout .bd-ref .cap{position:absolute;left:0;right:0;bottom:0;padding:14px 6px 5px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.78));color:#ddd;font-size:10px;font-weight:600;text-align:center;pointer-events:none;z-index:2}
.bd-rv2v-layout .bd-ref:not(.has-img) .bd-ref-tag,.bd-rv2v-layout .bd-ref:not(.has-img) .cap{position:static;padding:0;background:none;color:#666;font-weight:500}
.bd-rv2v-layout .bd-ref.has-img .bd-ref-tag{display:block}
.bd-rv2v-layout .bd-ref img{object-fit:contain;object-position:center;background:#000}
.bd-rv2v-layout .bd-ref .dot{position:absolute;left:6px;top:6px;width:7px;height:7px;border-radius:50%;background:#4fff8f;box-shadow:0 0 0 2px rgba(0,0,0,.5);z-index:2}
.bd-rv2v-layout .bd-ref .x{top:4px;right:4px;width:20px;height:20px;border-radius:6px;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);color:#ff9a9a;font-size:14px;font-weight:700;z-index:3}
.bd-rv2v-layout .bd-ref:hover .x,.bd-rv2v-layout .bd-ref:focus-within .x{display:flex}
.bd-rv2v-layout .bd-ref.bd-r2v-pic-hidden{display:none!important}
.bd-rv2v-layout .bd-refs-images-wrap,.bd-rv2v-layout .bd-ref-audios-wrap{margin-top:0}
.bd-select{background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:4px 6px;font-size:11px;max-width:240px;box-sizing:border-box}
.bd-task-anchor>.bd-select{padding:6px 10px;font-size:11px;line-height:1.35;height:29px;min-height:29px;max-width:min(480px,55vw)}
.bd-ref img{width:100%;height:100%;object-fit:cover}
.bd-ref .x{position:absolute;top:1px;right:3px;color:#f88;font-size:12px;line-height:1;display:none}
.bd-ref:hover .x{display:block}
.bd-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bd-meta{color:#888;font-size:10px}
.bd-video-tag{color:#4fff8f;font-size:10px}
.bd-num{width:42px;background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:5px 4px;font-size:11px;text-align:center;-moz-appearance:textfield}
.bd-num::-webkit-outer-spin-button,.bd-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.bd-output label{color:#888;font-size:10px;white-space:nowrap}
.bd-output .bd-out-fixed{display:flex;gap:4px;align-items:center}
.bd-output .bd-out-fixed.hidden{display:none}
/* Do not use margin-top:auto — with an oversized min-height it creates a huge empty gap above the status bar. */
.bd-run-status{width:100%;box-sizing:border-box;padding:8px 10px;background:#151515;border:1px solid #333;border-radius:6px;display:flex;flex-direction:column;gap:5px;margin-top:6px;flex-shrink:0}
.bd-run-status.idle .bd-run-title{color:#888}
.bd-run-status.active .bd-run-title{color:#4fff8f}
.bd-run-status.done .bd-run-title{color:#7a9cff}
.bd-run-status.error .bd-run-title{color:#f88}
.bd-run-title{font-size:11px;font-weight:600;line-height:1.35}
.bd-run-detail{color:#999;font-size:10px;line-height:1.4}
.bd-run-bars{display:flex;flex-direction:column;gap:3px}
.bd-run-bar{height:5px;background:#2a2a2a;border-radius:3px;overflow:hidden}
.bd-run-bar-fill{height:100%;background:linear-gradient(90deg,#2a6b4a,#4fff8f);border-radius:3px;transition:width .15s ease}
.bd-run-bar-sub .bd-run-bar-fill{background:linear-gradient(90deg,#3a5080,#7a9cff)}
.hidden{display:none!important}
.bd-controls.hidden{display:none!important}
.bd-gen-src{width:100%;min-height:72px;max-height:100px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;color:#666;font-size:10px;margin-top:4px;position:relative;box-sizing:border-box}
.bd-gen-src.has-img{border-style:solid;border-color:#444}
.bd-gen-src img{width:100%;height:100%;object-fit:contain;background:#000}
.bd-gen-src .x{position:absolute;top:1px;right:3px;color:#f88;font-size:12px;line-height:1;display:none;cursor:pointer;z-index:2}
.bd-gen-src.has-img:hover .x{display:block}
.bd-gen-src.has-video{padding:0;cursor:default;align-items:stretch;justify-content:flex-start;flex-direction:column}
.bd-gen-src.has-video .bd-ref-video-preview{width:100%;flex:1;min-height:100px;max-height:220px;object-fit:contain;background:#000;display:block;border-radius:3px}
.bd-gen-src .bd-ref-replace{position:absolute;bottom:4px;left:4px;z-index:3;background:rgba(0,0,0,.72);color:#ccc;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:9px;cursor:pointer;line-height:1.4}
.bd-gen-src .bd-ref-replace:hover{color:#fff;border-color:#888}
.bd-gen-src.has-video .x{display:block;z-index:3}
.bd-ref-video-col{display:flex;flex-direction:column;gap:4px;min-width:0;width:100%;flex:1}
.bd-ref-video-col .bd-gen-src{min-height:140px;max-height:none;flex:1}
.bd-ref-video-name{word-break:break-all;line-height:1.3}
.bd-ref-audios-wrap{display:flex;flex-direction:column;gap:4px;margin-top:6px;width:100%}
.bd-ref-audios{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;width:100%}
.bd-rv2v-layout .bd-ref-audios{gap:7px}
.bd-ref-audio{position:relative;min-height:52px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;padding:6px 4px;box-sizing:border-box;font-size:9px;color:#666;text-align:center;line-height:1.25}
.bd-rv2v-layout .bd-ref-audio{min-height:0;height:auto;align-items:stretch;justify-content:flex-start;gap:6px;padding:6px;border-radius:8px;border:1px dashed #333;background:#080808;text-align:left;font-size:11px;color:#777}
.bd-ref-audio.has-audio{border-style:solid;border-color:#4a6a4a;color:#cfe;background:#152015}
.bd-rv2v-layout .bd-ref-audio.has-audio{border-color:#2f4a38;background:#101812;color:#d8ebe0}
.bd-ref-audio:hover{border-color:#7a9cff;background:#1a1a1a}
.bd-rv2v-layout .bd-ref-audio:hover{border-color:#555;background:#101010}
.bd-ref-audio.has-audio:hover{background:#1a2a1a}
.bd-rv2v-layout .bd-ref-audio .bd-r2v-thumb{width:100%;height:44px;border-radius:6px}
.bd-rv2v-layout .bd-ref-audio.has-audio .bd-r2v-thumb{border-color:#3a5a45;color:#8fdfb0;background:#152018}
.bd-rv2v-layout .bd-ref-audio .bd-r2v-meta{flex-direction:row;align-items:center;justify-content:space-between;gap:4px}
.bd-rv2v-layout .bd-ref-audio audio.bd-r2v-media{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.bd-ref-audio .bd-ref-audio-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ad;font-size:9px;padding:0 2px}
.bd-rv2v-layout .bd-ref-audio .bd-ref-audio-name,.bd-rv2v-layout .bd-ref-audio .name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#666;font-size:10px;padding:0}
.bd-ref-audio .x{position:absolute;top:1px;right:3px;color:#f88;font-size:12px;line-height:1;display:none}
.bd-rv2v-layout .bd-ref-audio .x{top:8px;right:8px;width:20px;height:20px;border-radius:6px;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);color:#ff9a9a;font-size:14px;font-weight:700;z-index:3}
.bd-ref-audio:hover .x{display:block}
.bd-rv2v-layout .bd-ref-audio:hover .x{display:flex}
.bd-rv2v-layout .bd-refs-images-wrap.bd-r2v-section,.bd-rv2v-layout .bd-ref-audios-wrap.bd-r2v-section{display:flex;flex-direction:column;gap:8px}
.bd-r2v-section-count:empty{display:none}
.bd-prompt-layout:not(.bd-rv2v-layout) .bd-r2v-section-head{display:contents}
.bd-prompt-layout:not(.bd-rv2v-layout) .bd-r2v-section-count{display:none}
.bd-continuous-ref{display:flex;align-items:center;gap:6px;font-size:10px;color:#aaa;user-select:none;margin-left:8px}
.bd-continuous-ref label{display:flex;align-items:center;gap:4px;cursor:pointer}
.bd-continuous-ref input[type="checkbox"]{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f}
.bd-gen-fc-row{display:flex;align-items:center;gap:6px;margin-top:6px}
${IMAGE_BATCH_STYLES}
${FL2V_STYLES}
@media(max-width:768px){
.bd-prompt-layout,.bd-prompt-layout.bd-rv2v-layout,.bd-prompt-layout.bd-v2v-layout,.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live{grid-template-columns:1fr}
.bd-prompt-layout.bd-v2v-layout.bd-v2v-with-live>.bd-live-sample{order:3;min-height:160px}
.bd-prompt-layout.bd-rv2v-layout.bd-rv2v-with-live .bd-live-sample-body{min-height:96px;max-height:140px}
.bd-ref{max-height:64px}
.bd-rv2v-layout .bd-ref{max-height:none}
.bd-v2v-layout .bd-prompt,.bd-rv2v-layout .bd-prompt{min-height:140px}
}
`;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function snapDim(v, stride = 32) {
    return Math.max(stride, Math.round(v / stride) * stride);
}

/**
 * Match Python ``lib.image_prep.fit_long_edge``:
 * round(dim * scale / stride) * stride — keeps aspect, long side ≤ budget.
 * Every H3 path uses the same 32-pixel canvas grid.
 */
function snapScaledDim(dim, scale, stride = 32) {
    return Math.max(stride, Math.round((dim * scale) / stride) * stride);
}

function resolveOutputDimensions(sourceW, sourceH, output, fallback = {}, spatialStride = 32) {
    const mode = String(output?.mode || "long_edge").toLowerCase();
    const fixedStride = Math.max(32, Number(spatialStride) || 32);
    const longStride = Math.max(32, Number(spatialStride) || 32);
    if (mode === "fixed") {
        const w = snapDim(+(output?.width ?? fallback.width ?? 864), fixedStride);
        const h = snapDim(+(output?.height ?? fallback.height ?? 480), fixedStride);
        return { mode: "fixed", width: w, height: h, refMaxSize: Math.max(w, h) };
    }
    const longEdge = Math.max(longStride, +(output?.longEdge ?? output?.long_edge ?? fallback.refMaxSize ?? 848));
    const sw = sourceW || 0;
    const sh = sourceH || 0;
    if (!sw || !sh) {
        // Missing source: keep long-edge budget only — do not invent a 16:9 canvas
        // (that would center-crop ultrawide footage later via fit_canvas).
        return { mode: "long_edge", width: longEdge, height: longStride, refMaxSize: longEdge };
    }
    // Always recompute from source (even when already ≤ longEdge) so snapped
    // dims stay aspect-correct; never reuse a stale fixed W×H.
    const scale = Math.min(1, longEdge / Math.max(sw, sh));
    return {
        mode: "long_edge",
        width: snapScaledDim(sw, scale, longStride),
        height: snapScaledDim(sh, scale, longStride),
        refMaxSize: longEdge,
    };
}

/** Upload a file to ComfyUI input/ (videos use the same endpoint as images). */
function isUploadSizeError(err) {
    const msg = String(err?.message || err);
    return /body size|413|max_upload|too large|104857600/i.test(msg);
}

function formatUploadError(err) {
    const msg = String(err?.message || err);
    if (isUploadSizeError(err)) return t("upload.sizeLimitDetail");
    return msg;
}

function formatProbeFps(value) {
    const fps = Math.round(Number(value) * 100) / 100;
    if (Number.isInteger(fps)) return String(fps);
    return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function coerceTimelineFps(value, fallback = 24) {
    const fps = Number(value);
    if (!Number.isFinite(fps) || fps <= 0) return coerceTimelineFps(fallback, 24);
    return Math.round(clamp(fps, 1, 240) * 100) / 100;
}

async function uploadToInput(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "true");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Upload failed (${resp.status})`);
    }
    return resp.json();
}

async function uploadVideoChunked(file, onProgress) {
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / MINIMAX_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
        const start = i * MINIMAX_CHUNK_SIZE;
        const end = Math.min(start + MINIMAX_CHUNK_SIZE, file.size);
        const body = new FormData();
        body.append("upload_id", uploadId);
        body.append("chunk_index", String(i));
        body.append("total_chunks", String(totalChunks));
        body.append("filename", file.name);
        body.append("chunk", file.slice(start, end), `${file.name}.part`);
        const resp = await api.fetchApi("/minimax/motion-director/upload_chunk", { method: "POST", body });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(text || t("upload.chunkFailed", { status: resp.status }));
        }
        onProgress?.((i + 1) / totalChunks, i + 1, totalChunks);
        const data = await resp.json();
        if (data.name) return data;
    }
    throw new Error(t("upload.chunkIncomplete"));
}

async function uploadToInputSmart(file, onProgress) {
    if (file.size <= COMFY_UPLOAD_SOFT_LIMIT) {
        try {
            return await uploadToInput(file);
        } catch (err) {
            if (!isUploadSizeError(err)) throw err;
        }
    }
    return uploadVideoChunked(file, onProgress);
}

function videoRelativePath(upload) {
    const name = upload.name || upload.filename;
    const sub = (upload.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
    return sub ? `${sub}/${name}` : name;
}

function inputViewUrl(relativePath, type = "input") {
    const norm = String(relativePath || "").replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    const filename = slash >= 0 ? norm.slice(slash + 1) : norm;
    const subfolder = slash >= 0 ? norm.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

function refViewUrl(imageFile) {
    return inputViewUrl(imageFile, "input");
}

function deletedSourceRanges(video) {
    return video?.deletedSourceRanges || video?.deleted_source_ranges || [];
}

function logicalToSourceFrame(logical, video) {
    const map = video?.frameMap;
    if (map?.length) {
        return normalizeFrameMapEntry(map[clamp(logical, 0, map.length - 1)]).frame;
    }
    let src = logical;
    for (const [start, end] of [...deletedSourceRanges(video)].sort((a, b) => a[0] - b[0])) {
        if (src >= start) src += end - start;
        else break;
    }
    return src;
}

/** Inverse of logicalToSourceFrame for sparse deletes; -1 if source is in a deleted gap. */
function sourceToLogicalFrame(srcFrame, video) {
    const map = video?.frameMap;
    if (map?.length) {
        let best = -1;
        for (let i = 0; i < map.length; i++) {
            const e = normalizeFrameMapEntry(map[i]);
            if (e.frame === srcFrame) return i;
            if (e.frame < srcFrame) best = i;
            else if (best < 0) return -1; // before first kept
        }
        return best;
    }
    let logical = srcFrame;
    for (const [start, end] of [...deletedSourceRanges(video)].sort((a, b) => a[0] - b[0])) {
        if (srcFrame >= end) logical -= (end - start);
        else if (srcFrame >= start) return -1;
        else break;
    }
    return Math.max(0, logical);
}

function buildIdentityFrameMap(count) {
    return Array.from({ length: count }, (_, i) => i);
}

function normalizeFrameMapEntry(entry, defaultClip = 0) {
    if (entry == null) return { clip: defaultClip, frame: 0 };
    if (typeof entry === "number") return { clip: defaultClip, frame: entry };
    return {
        clip: entry.clip ?? entry.videoClip ?? defaultClip,
        frame: entry.frame ?? 0,
    };
}

function buildClipFrameMap(clipIndex, count) {
    return Array.from({ length: count }, (_, i) => ({ clip: clipIndex, frame: i }));
}

const CLIP_SEGMENT_COLORS = ["rgba(255,200,50,0.9)", "rgba(102,170,255,0.9)", "rgba(79,255,143,0.9)", "rgba(255,102,170,0.9)"];

function getDirectorUiHeight(editor) {
    if (editor?.getDirectorMode?.() === "prompt_batch") {
        const batchH = getImageBatchUiHeight(editor);
        // r2v shows the main timeline track (like fl2v) above batch cards.
        if (editor?.isR2vBatch?.()) {
            const track = editor?.canvasHeight || RULER_H + SEG_LABEL_H + TRACK_H;
            // toolbar + track + batch panel (batchH already includes list max-height cap)
            return batchH + track + 100;
        }
        return batchH + 100;
    }
    if (editor?.getDirectorMode?.() === "fl2v") {
        let h = getFl2vUiHeight(editor) + 160;
        if (editor?.needsLiveSamplePanel?.()) h += LIVE_SAMPLE_PREVIEW_H + 12;
        return h;
    }
    let h = (editor?.canvasHeight || RULER_H + SEG_LABEL_H + TRACK_H) + 370 + 52;
    if (
        editor?.hasVideo?.()
        && !editor?.isImageBatch?.()
        && !editor?.isGenMode?.()
        && !editor?.isFl2vMode?.()
    ) {
        h += STAGE_PREVIEW_H + 10;
    }
    // v2v live preview sits beside the prompt (no extra vertical stack).
    if (editor?.needsLiveSamplePanel?.() && !editor?.usesV2vPromptStyle?.()) {
        h += LIVE_SAMPLE_PREVIEW_H + 12;
    }
    return h;
}

function hookTaskTypeWidget(node) {
    const tw = node.widgets?.find((w) => w.name === "task_type");
    if (!tw || tw._minimaxTaskHooked) return;
    tw._minimaxTaskHooked = true;
    const orig = tw.callback;
    tw.callback = function (...args) {
        const r = orig?.apply(this, args);
        const ed = node._minimaxEditor;
        if (ed?.globalTask) ed.globalTask.value = tw.value;
        ed?.onTaskTypeChanged?.(tw.value);
        refreshDirectorContinuityUi(node, ed);
        return r;
    };
}

function hookMotionContextWidget(node) {
    const mw = node.widgets?.find((w) => w.name === "motion_context_enabled");
    if (!mw || mw._minimaxMotionContextHooked) return;
    mw._minimaxMotionContextHooked = true;
    const orig = mw.callback;
    mw.callback = function (...args) {
        const r = orig?.apply(this, args);
        const ed = node._minimaxEditor;
        if (ed) {
            ed._externalGroupsSyncSig = null;
            ed.syncExternalGroupsTimeline?.();
            ed.renderImageBatchGroups?.();
            ed.scheduleRender?.();
        }
        refreshDirectorContinuityUi(node, ed);
        return r;
    };
}

function syncDirectorNodeSize(node, editor) {
    if (editor?.isPlaying) return;
    if (!node?.computeSize) return;
    const sz = node.computeSize();
    node.setSize([node.size[0], sz[1]]);
    node.setDirtyCanvas?.(true, true);
}

function ensureDirectorDomWidgetWidth(node) {
    const widget = node?._minimaxDomWidget;
    const fullW = node?.size?.[0];
    if (!widget || !fullW) return false;
    if (widget.width === fullW) return false;
    widget.width = fullW;
    return true;
}

function moveDirectorDomWidgetToEnd(node) {
    const widget = node?._minimaxDomWidget;
    if (!widget || !node?.widgets?.length) return;
    const idx = node.widgets.indexOf(widget);
    if (idx === -1 || idx === node.widgets.length - 1) return;
    node.widgets.splice(idx, 1);
    node.widgets.push(widget);
}

const PERF_WIDGET_ORDER = ["bd_grp_perf", "clear_vram_between_segments", "export_source_images"];

function moveDirectorPerfWidgetsBeforeTimeline(node) {
    const dom = node?._minimaxDomWidget;
    if (!node?.widgets?.length) return;

    const perfWidgets = PERF_WIDGET_ORDER
        .map((name) => node.widgets.find((w) => w.name === name))
        .filter(Boolean);
    if (!perfWidgets.length) return;

    for (const w of perfWidgets) {
        const idx = node.widgets.indexOf(w);
        if (idx !== -1) node.widgets.splice(idx, 1);
    }

    const insertAt = dom ? node.widgets.indexOf(dom) : -1;
    const at = insertAt === -1 ? node.widgets.length : insertAt;
    node.widgets.splice(at, 0, ...perfWidgets);
}

function finalizeDirectorWidgetOrder(node) {
    installDirectorPostprocessUi(node);
    moveDirectorDomWidgetToEnd(node);
}

function bindDirectorDomWidgetSizing(node, widget) {
    const minHeight = () => DIRECTOR_LAUNCHER_HEIGHT;
    widget.computeSize = (width) => [width, DIRECTOR_LAUNCHER_HEIGHT];
    widget.computeLayoutSize = () => ({
        minHeight: DIRECTOR_LAUNCHER_HEIGHT,
        minWidth: 240,
    });
    if (widget.options) {
        widget.options.getMinHeight = minHeight;
    }
    const el = widget.element;
    if (el) {
        el.style.height = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
        el.style.minHeight = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
        el.style.maxHeight = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
    }
}

function initDirectorEditor(node) {
    // Keep a private key; the upstream AIMixer Director mounts its editor on `_directorDomWidget`.
    if (!isMiniMaxH3MotionDirectorNode(node)) return null;
    if (node._minimaxEditor) return node._minimaxEditor;
    const container = node._minimaxDomWidget?.element;
    if (!container) return null;
    try {
        installDirectorContinuityUi(node);
        hookTaskTypeWidget(node);
        hookMotionContextWidget(node);
        node._minimaxEditor = new MiniMaxH3MotionDirectorEditor(node, container, node._minimaxDomWidget);
        ensureDirectorDomWidgetWidth(node);
        bindDirectorDomWidgetSizing(node, node._minimaxDomWidget);
        syncDirectorNodeSize(node, node._minimaxEditor);
        return node._minimaxEditor;
    } catch (err) {
        // createDirectorModal() runs at the start of the constructor.  Keep
        // that launcher visible even if a later page/component fails, so the
        // user is never left with an unopenable node and no diagnosis.
        const openButton = container.querySelector?.('[data-a="open-director"]');
        if (openButton) {
            openButton.title = `Director UI init failed: ${err?.message || err}`;
            openButton.dataset.initError = String(err?.message || err);
        }
        const modal = getDirectorModalForHost(container);
        const errorPanel = document.createElement("div");
        errorPanel.className = "mmx-director-init-error";
        errorPanel.style.cssText = "margin:12px;padding:12px;border:1px solid #8b3434;border-radius:7px;background:#2a1717;color:#ffb1b1;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap";
        errorPanel.textContent = `Director UI init failed\n${err?.message || err}`;
        modal?.pages?.generation?.prepend(errorPanel);
        node._minimaxEditor = null;
        console.error("[MiniMax H3 Motion Director] UI init failed:", err);
        return null;
    }
}

function patchDirectorDomWidgetLayout() {
    const canvas = app.canvas;
    if (!canvas || canvas._minimaxMotionDirectorLayoutPatch) return;
    canvas._minimaxMotionDirectorLayoutPatch = true;
    const prev = canvas.onDrawForeground;
    canvas.onDrawForeground = function (ctx) {
        const graph = app.graph ?? canvas.graph;
        for (const node of graph?._nodes ?? graph?.nodes ?? []) {
            if (node._minimaxEditor?.isPlaying) continue;
            ensureDirectorDomWidgetWidth(node);
        }
        return prev?.apply(this, arguments);
    };
}

function stopDomEvent(e) {
    e.stopPropagation();
}

function hideWidget(w) {
    if (!w) return;
    // Group headers in HIDDEN_WIDGETS duplicate timeline panel sections — hide them too.
    if (w._bdGroupHeader && !HIDDEN_WIDGETS.includes(w.name)) return;
    w.hidden = true;
    if (!w.options) w.options = {};
    w.options.hidden = true;
    w.computeSize = () => [0, 0];
    if (w.element) w.element.style.display = "none";
}

function parseTimeline(raw, totalFrames, fps) {
    const total = totalFrames || 124;
    const base = {
        version: 4,
        editMode: "global",
        totalFrames: total,
        frameRate: coerceTimelineFps(fps || 24),
        video: {
            fileName: "",
            videoFile: "",
            subfolder: "",
            type: "input",
            frames: [],
            frameMap: [],
        },
        videoClips: [],
        global: { taskType: "", prompt: "", refs: [], refAudios: [], refVideos: [], referenceVideo: {}, continuousReference: false },
        output: {
            // v2v/rv2v default: scale by long edge (preserve aspect). Fixed = center-crop.
            mode: "long_edge",
            aspectRatio: DEFAULT_ASPECT_RATIO,
            megapixels: DEFAULT_MEGAPIXELS,
            multiple: MINIMAX_CANVAS_MULTIPLE,
            longEdge: 848, width: 848, height: 480,
            maxExportFrames: 0, exportMode: "all",
            audioMode: "generate",
            continuityEnabled: false, continuityOverlapFrames: 9,
        },
        runSelectEnabled: false,
        runSelection: [],
        liveTaePreview: true,
        segments: [{ id: uid(), start: 0, length: total, prompt: "", taskType: "", refs: [], refAudios: [], referenceVideo: {} }],
    };
    if (!raw?.trim()) return base;
    try {
        const data = JSON.parse(raw);
        data.version = data.version || 4;
        data.editMode = data.editMode || "global";
        data.frameRate = coerceTimelineFps(data.frameRate ?? fps ?? 24);
        data.video = data.video || { fileName: "", frames: [] };
        if (!data.video.videoFile && data.video.fileName) {
            data.video.videoFile = data.video.fileName;
        }
        data.video.type = data.video.type || "input";
        data.video.subfolder = data.video.subfolder || "";
        data.video.frames = data.video.frames || [];
        data.global = data.global || { refs: [], refAudios: [], referenceVideo: {}, continuousReference: false };
        data.global.refs = data.global.refs || [];
        data.global.refAudios = data.global.refAudios || data.global.ref_audios || [];
        data.global.refVideos = data.global.refVideos || data.global.ref_videos || [];
        data.global.referenceVideo = data.global.referenceVideo || data.global.reference_video || {};
        data.global.continuousReference = !!data.global.continuousReference || !!data.global.continuous_reference;
        const legacyRef = data.referenceVideo || data.reference_video;
        if (legacyRef && (legacyRef.videoFile || legacyRef.fileName)
            && !(data.global.referenceVideo.videoFile || data.global.referenceVideo.fileName)) {
            data.global.referenceVideo = { ...legacyRef };
        }
        delete data.referenceVideo;
        delete data.reference_video;
        data.output = normalizeOutputContinuity({
            mode: data.output?.mode || "long_edge",
            // Keep ResolutionSelector fields across reload (were previously dropped → always 16:9).
            aspectRatio: data.output?.aspectRatio != null
                ? normalizeAspectRatioLabel(data.output.aspectRatio)
                : undefined,
            megapixels: data.output?.megapixels ?? data.output?.megaPixels ?? undefined,
            multiple: data.output?.multiple ?? MINIMAX_CANVAS_MULTIPLE,
            longEdge: data.output?.longEdge ?? data.output?.long_edge ?? data.refMaxSize ?? 848,
            width: data.output?.width ?? data.width ?? 864,
            height: data.output?.height ?? data.height ?? 480,
            maxExportFrames: data.output?.maxExportFrames ?? data.output?.max_export_frames ?? 0,
            exportMode: data.output?.exportMode ?? data.output?.export_mode ?? "all",
            audioMode: normalizeAudioMode(data.output?.audioMode ?? data.output?.audio_mode),
            continuityEnabled: data.output?.continuityEnabled ?? data.output?.continuity_enabled,
            continuityOverlapFrames: data.output?.continuityOverlapFrames ?? data.output?.continuity_overlap_frames,
        });
        // Infer aspectRatio from saved width/height when older payloads omitted the label.
        if (!data.output.aspectRatio && data.output.width > 0 && data.output.height > 0) {
            const rw = data.output.width;
            const rh = data.output.height;
            const match = RESOLUTION_ASPECTS.find(([, aw, ah]) => Math.abs(rw / rh - aw / ah) < 0.02);
            data.output.aspectRatio = match ? match[0] : CUSTOM_ASPECT_RATIO;
        }
        if (!data.output.aspectRatio) data.output.aspectRatio = DEFAULT_ASPECT_RATIO;
        if (data.output.megapixels == null) data.output.megapixels = DEFAULT_MEGAPIXELS;
        stripTimelineContinuityRootFields(data);
        stripTimelineEphemeralFields(data);
        const legacyFrames = data.video.frames?.length || 0;
        if (!data.video.frameMap?.length) {
            const n = data.totalFrames || data.video.sourceFrameCount || legacyFrames || total;
            data.totalFrames = n;
            data.video.sourceFrameCount = data.video.sourceFrameCount || n;
            data.video.deletedSourceRanges = data.video.deletedSourceRanges || [];
            data.video.frameMap = [];
        }
        if (!data.segments?.length) {
            const n = data.totalFrames || data.video.sourceFrameCount || legacyFrames || total;
            data.segments = [{ id: uid(), start: 0, length: Math.max(MIN_SEG, n), prompt: "", taskType: "", refs: [], refAudios: [], referenceVideo: {} }];
        }
        for (const seg of data.segments) {
            if (!seg.id) seg.id = uid();
            if (seg.length == null && seg.end != null) seg.length = seg.end - seg.start;
            if (seg.frameCount == null && seg.length != null) seg.frameCount = seg.length;
            seg.refs = seg.refs || [];
            seg.refAudios = seg.refAudios || seg.ref_audios || [];
            seg.refVideos = seg.refVideos || seg.ref_videos || [];
            seg.referenceVideo = seg.referenceVideo || seg.reference_video || {};
            seg.genImage = seg.genImage || { imageFile: seg.imageFile || "" };
            seg.negativePrompt = seg.negativePrompt ?? "";
        }
        if (resolveTaskKey(data.global?.taskType) === "r2v") ensureR2vReferenceAssetSchema(data);
        else ensureReferenceAssetSchema(data);
        data.gen = data.gen || { defaultFrameCount: 124 };
        if (data.global) {
            data.global.genImage = data.global.genImage || { imageFile: data.global.imageFile || "" };
        }
        data.runSelectEnabled = !!data.runSelectEnabled;
        data.runSelection = Array.isArray(data.runSelection) ? data.runSelection.map((i) => parseInt(i, 10)).filter((i) => i >= 0) : [];
        // Default on when missing (older timelines).
        data.liveTaePreview = data.liveTaePreview !== false && data.live_tae_preview !== false;
        if (data.timelineMode === "fl2v" || resolveTaskKey(data.global?.taskType || "") === "fl2v") {
            data.timelineMode = "fl2v";
            data.editMode = "segment";
            data.keyframes = Array.isArray(data.keyframes) ? data.keyframes : [];
            data.shots = Array.isArray(data.shots) ? data.shots : [];
            const stored = parseInt(data.totalFrames, 10);
            const farthest = Math.max(
                0,
                ...(data.segments || []).map((s) => (parseInt(s.start, 10) || 0) + (parseInt(s.length ?? s.frameCount, 10) || 0)),
                ...(data.keyframes || []).map((k) => (parseInt(k.start, 10) || 0) + (parseInt(k.frameCount ?? k.length, 10) || 0)),
            );
            data.totalFrames = (Number.isFinite(stored) && stored > 0)
                ? stored
                : Math.max(farthest, total, 240);
            return data;
        }
        if (data.timelineMode === "image_batch" || data.timelineMode === "prompt_batch") {
            data.timelineMode = "prompt_batch";
            data.editMode = "segment";
            data.totalFrames = sumFrameCounts(data.segments) || data.totalFrames || total;
            return data;
        }
        if (data.timelineMode === "gen_blank" || data.timelineMode === "gen_image") {
            const gkey = resolveTaskKey(data.global?.taskType || "");
            if (isPromptBatchTask(gkey)) {
                data.timelineMode = "prompt_batch";
                data.editMode = "segment";
            }
            data.totalFrames = sumFrameCounts(data.segments) || data.totalFrames || total;
            return data;
        }
        if (!data.videoClips?.length && data.video?.videoFile) {
            data.videoClips = [{
                id: data.video.id || uid(),
                fileName: data.video.fileName || "",
                videoFile: data.video.videoFile || data.video.fileName || "",
                subfolder: data.video.subfolder || "",
                type: data.video.type || "input",
                width: data.video.width || 0,
                height: data.video.height || 0,
                duration: data.video.duration || 0,
                nativeFps: data.video.nativeFps || data.video.native_fps || 0,
                nativeFrameCount: data.video.nativeFrameCount || data.video.native_frame_count || 0,
                sourceFrameCount: data.video.sourceFrameCount || data.video.frameMap?.length || 0,
                storageWidth: data.video.storageWidth,
                storageHeight: data.video.storageHeight,
            }];
        }
        data.videoClips = data.videoClips || [];
        data.totalFrames = data.totalFrames || data.video.sourceFrameCount || data.video.frameMap?.length || total;
        return data;
    } catch {
        return base;
    }
}

class MiniMaxH3MotionDirectorEditor {
    constructor(node, container, domWidget) {
        this.node = node;
        this.launcherContainer = container;
        this.domWidget = domWidget;
        this.zoom = 1;
        this.selectedIndex = 0;
        /** @type {number|null} Selected editable split-point frame (logical). */
        this.selectedSplitFrame = null;
        this.currentFrame = 0;
        this.isPlaying = false;
        this.isLooping = false;
        this._playRaf = null;
        this._drag = null;
        this._previewSegments = null;
        this._edgeSnapshot = null;
        this._isHovering = false;
        this._thumbCache = new Map();
        this._thumbPending = new Set();
        this._seekChain = Promise.resolve();
        this._legacyFrames = [];
        this._storageWidth = 0;
        this._storageHeight = 0;
        this._previewVideo = null;
        this._previewVideos = new Map();
        this._thumbCanvas = null;
        this._syncTimer = null;
        this._resizeRaf = null;
        this._renderPending = false;
        this._settleRenderTimer = null;
        this._settleRenderLateTimer = null;
        this._lastSeekUiMs = 0;
        this._playCanvasWidth = 0;
        this._pauseSettling = false;
        this._runHighlightSeg = -1;
        this._lastRunProgressDetail = null;
        this._lastRunErrorMessage = null;
        this._modalEl = null;
        this._modalKeyHandler = null;
        this._directorModalOverlay = null;
        this._directorModalShell = null;
        this._directorModalContent = null;
        this._directorOverlayLayer = null;
        this._directorModalOpen = false;
        this._directorModalKeyHandler = null;
        this._drawWidth = 0;
        this._reorderDropRank = -1;
        this._reorderFromRank = -1;
        this.canvasHeight = RULER_H + SEG_LABEL_H + TRACK_H;
        this._stageClipIndex = -1;
        this._stageSyncMs = 0;
        this._playHandoff = false;

        this._directorModalController = createDirectorModal({
            launcherHost: this.launcherContainer,
            translate: t,
            toggleLanguage: toggleLocale,
            hasInternalDialog: () => (
                !!this._modalEl
                || !!this._r2vCommonPopover?.isOpen
                || [...(this._promptMentionControllers || []), ...(this._batchPromptMentionControllers || [])]
                    .some((controller) => controller?.isMenuOpen)
            ),
            onOpen: () => {
                this._directorModalOpen = true;
                this._resetLayoutStyles();
                this.applyZoomWidth();
                this.syncExternalGroupsTimeline?.();

                this.outputUi?.setPageVisibility?.(
                    this._directorModalController?.currentPage || "generation",
                );

                refreshDirectorContinuityUi(this.node, this);
                this.scheduleSettleRender();
            },
            onClose: () => {
                if (this.isPlaying) this._stopPlay();

                this.outputUi?.setPageVisibility?.(
                    "closed",
                );

                this._r2vCommonPopover?.close?.();
                this._directorModalOpen = false;
                refreshDirectorContinuityUi(this.node, this);
            },
            onResize: () => this.onDirectorModalResize(),
            onPageChange: (page) => {
                this.outputUi?.setPageVisibility?.(
                    page,
                );
            },
        });
        this._directorModalOverlay = this._directorModalController.overlay;
        this._directorModalShell = this._directorModalController.shell;
        this._directorModalContent = this._directorModalController.content;
        this._directorOverlayLayer = this._directorModalController.overlayLayer;
        this._directorModalKeyHandler = this._directorModalController.keyHandler;
        // Existing editor code measures `container`; it now means the page-root modal content,
        // never the LiteGraph node's compact launcher host.
        this.container = this._directorModalContent;

        for (const w of node.widgets || []) {
            if (HIDDEN_WIDGETS.includes(w.name)) hideWidget(w);
        }

        this.timelineWidget = this.widget("timeline_data");
        this.totalFramesWidget = this.widget("total_frames");
        this.frameRateWidget = this.widget("frame_rate");
        this.taskTypeWidget = this.widget("task_type");
        this.globalPromptWidget = this.widget("global_prompt");
        this.negativePromptWidget = null;
        this.widthWidget = this.widget("width");
        this.heightWidget = this.widget("height");
        this.refMaxWidget = this.widget("ref_max_size");
        this.postprocessWidget = this.widget("postprocess_config");
        this._hadSerializedPostprocessConfig = !!String(this.postprocessWidget?.value || "").trim();
        this.postprocessStore = getNodePostprocessStore(this.node)
            || new PostprocessConfigStore(this.postprocessWidget);

        const initTotal = Math.max(0, parseInt(this.totalFramesWidget?.value || 124, 10));
        const initFps = coerceTimelineFps(this.frameRateWidget?.value || 24);
        this.timeline = this._loadNativeTimelineState(this.timelineWidget?.value, initTotal, initFps);
        if (!this._hadSerializedPostprocessConfig) {
            this.postprocessStore.patch("preview", "enabled", this.timeline.liveTaePreview !== false);
        }
        const initPhase = (label, callback) => {
            try { return callback(); }
            catch (error) {
                const wrapped = new Error(`${label}: ${error?.message || error}`);
                wrapped.cause = error;
                throw wrapped;
            }
        };
        initPhase("Generation state", () => this.ensureContextLinks());
        initPhase("Generation DOM", () => this.buildDOM());
        this.postprocessUi = initPhase("Postprocess page", () => mountPostprocessUI(
            this._directorModalController.pages.postprocess,
            this.postprocessStore,
            {
                fetchApi: (path) => api.fetchApi(path),
                directorSize: () => [Number(this.widthWidget?.value || 864), Number(this.heightWidget?.value || 480)],
                locale: getLocale,
            },
        ));
        this.outputUi = initPhase("Live Preview / Results pages", () => mountOutputUI(
            {
                live: this._directorModalController.pages.live,
                results: this._directorModalController.pages.results,
            },
            this.postprocessStore,
            {
                locale: getLocale,
                fetchApi: (path, options) => api.fetchApi(path, options),
                nodeId: () => String(this.node?.id ?? ""),
            },
        ));

        this.outputUi.setPageVisibility(
            this._directorModalController.currentPage,
        );
        this.runStatusEl = this.outputUi.runStatusEl;
        this.runTitleEl = this.outputUi.runTitleEl;
        this.runDetailEl = this.outputUi.runDetailEl;
        this.runOverallEl = this.outputUi.runOverallEl;
        this.runPhaseEl = this.outputUi.runPhaseEl;
        this.runSelectBar = this.outputUi.runSelectBar;
        this.runSelectSummary = this.outputUi.runSelectSummary;
        this.bindEvents();
        this._unsubLocale = onLocaleChange(() => this.applyLocale());
        this.applyLocale();
        this._directorMode = getDirectorMode(this.taskTypeWidget?.value);
        if (this._directorMode === "mixed") {
            // Mixed owns editor.mixedTimeline; legacy normalizers intentionally do nothing here.
        } else if (this._directorMode === "video") {
            this.restoreVideoFromTimeline();
        } else if (this._directorMode === "prompt_batch" || this._directorMode === "image_batch") {
            ensureImageBatchTimeline(this);
        } else {
            this.ensureGenTimeline();
        }
        this.ensureContextLinks();
        this.applyTaskLayout(this._directorMode);

        this.updateDomWidgetHeight();
        this.applyZoomWidth();
        this.syncFromWidgets();
        this.updateModeUI();
        this.updateSelectionUI();
        this.commit(true, { syncTimeline: false });
        this._observeViewportResize();
        this.syncExternalGroupsTimeline();
        this.scheduleSettleRender();
    }

    _inputLinkConnected(name) {
        const inp = this.node?.inputs?.find((i) => i?.name === name);
        return inp != null && inp.link != null;
    }

    hasExternalI2vGroups() {
        return this._inputLinkConnected("i2v_groups");
    }

    hasExternalR2vGroups() {
        return this._inputLinkConnected("r2v_groups");
    }

    isMotionContextEnabled() {
        const raw = this.widget("motion_context_enabled")?.value;
        return !(
            raw === false
            || raw === 0
            || raw === "0"
            || String(raw).trim().toLowerCase() === "false"
            || String(raw).trim().toLowerCase() === "off"
        );
    }

    _legacyContextDefaultsForSegment(seg, index) {
        const taskKey = resolveTaskKey(
            seg?.taskType || this.timeline?.global?.taskType || this.taskTypeWidget?.value || "",
        );
        const audioRaw = this.widget("audio_context_enabled")?.value;
        const sourceRaw = this.widget("source_overlap_frames")?.value;
        const hasExplicitI2vImage = !!(
            seg?.genImage?.imageFile || seg?.genImage?.imageB64 || seg?.imageFile
        );
        return legacyContextDefaults({
            taskKey,
            motionEnabled: this.isMotionContextEnabled(),
            audioEnabled: !(
                audioRaw === false || audioRaw === 0 || audioRaw === "0"
                || String(audioRaw).trim().toLowerCase() === "false"
                || String(audioRaw).trim().toLowerCase() === "off"
            ),
            audioGenerate: normalizeAudioMode(this.timeline?.output?.audioMode) === "generate",
            sourceBridgeFrames: Number(sourceRaw) || 0,
            hasExplicitI2vImage: index > 0 && hasExplicitI2vImage,
        });
    }

    ensureContextLinks() {
        ensureTimelineContextLinks(
            this.timeline,
            (seg, index) => this._legacyContextDefaultsForSegment(seg, index),
        );
        if (Array.isArray(this.timeline?.shots)) {
            this.timeline.shots.forEach((shot, index) => {
                const seg = this.timeline.segments?.[index] || shot;
                shot.contextLink = normalizedContextLink(
                    shot.contextLink ?? shot.context_link ?? seg?.contextLink,
                    index,
                    this._legacyContextDefaultsForSegment(seg, index),
                );
                delete shot.context_link;
            });
        }
        return this.timeline;
    }

    getSegmentContextLink(index) {
        this.ensureContextLinks();
        return this.timeline.segments?.[index]?.contextLink;
    }

    _commitContextLinkChange() {
        const oldValue = String(this.timelineWidget?.value || "");
        this._writeTimelineWidget();
        const newValue = String(this.timelineWidget?.value || "");
        if (newValue !== oldValue) {
            this.node?.onWidgetChanged?.("timeline_data", newValue, oldValue, this.timelineWidget);
            (app.graph ?? app.canvas?.graph)?.change?.();
        }
        this.renderImageBatchGroups?.();
        this.scheduleRender?.();
    }

    toggleSegmentContextLink(index) {
        const seg = this.timeline.segments?.[index];
        if (!seg || index <= 0) return;
        seg.contextLink = toggleContextLink(seg.contextLink, index);
        if (this.timeline.shots?.[index]) this.timeline.shots[index].contextLink = { ...seg.contextLink };
        this._commitContextLinkChange();
    }

    setSegmentContextChannels(index, channels) {
        const seg = this.timeline.segments?.[index];
        if (!seg || index <= 0) return;
        seg.contextLink = setContextLinkChannels(seg.contextLink, index, channels || {});
        if (this.timeline.shots?.[index]) this.timeline.shots[index].contextLink = { ...seg.contextLink };
        this._commitContextLinkChange();
    }

    getSegmentContextMode(index) {
        return contextLinkMode(this.getSegmentContextLink(index), index);
    }

    updateExternalGroupsBanner() {
        const el = this.externalGroupsMsgEl || this.root?.querySelector('[data-r="external-groups-msg"]');
        if (!el) return;
        const i2v = this.hasExternalI2vGroups();
        const r2v = this.hasExternalR2vGroups();
        const active = i2v || r2v;
        el.classList.toggle("hidden", !active);
        this.root?.classList.toggle("bd-external-groups", active);
        // Refresh add/delete visibility when external wiring toggles.
        if (this.isR2vBatch?.()) setR2vToolbar(this, true);
        else if (this.isFl2vMode?.()) setFl2vToolbar(this, true);
        else {
            updateR2vToolbarBtns(this);
            updateFl2vToolbarBtns(this);
        }
        if (!active) {
            el.textContent = "";
            return;
        }
        const specs = collectExternalGroupSpecs(this);
        const n = specs?.length || 0;
        const base = i2v ? t("external.i2vActive") : t("external.r2vActive");
        const count = n > 0 ? ` (${t("external.groupCount", { n })})` : "";
        el.textContent = `${base}${count} ${t("external.durationHint")}`;
    }

    /** Mirror graph-wired Group count/duration into the Director timeline UI. */
    syncExternalGroupsTimeline() {
        if (this.isMixedMode()) return;
        this.updateExternalGroupsBanner();
        const specs = collectExternalGroupSpecs(this);
        if (!specs?.length) {
            this._externalGroupsSyncSig = null;
            return;
        }

        const mode = this.getDirectorMode?.() || this._directorMode;
        const taskKey = resolveTaskKey(this.getTaskKey?.() || this.taskTypeWidget?.value);
        const motionInheritance = !!(
            this.isMotionContextEnabled?.()
            && taskKey === "i2v"
        );
        const sig = JSON.stringify([motionInheritance, (this.timeline.segments || []).length, specs.map((s) => [
            Number(s.durationSec) || 0,
            s.prompt || "",
            s.firstImageFile || "",
            s.lastImageFile || "",
            (s.refImages || []).map((r) => `${r.index}:${r.imageFile || ""}`).join(","),
            (s.refVideos || []).map((r) => [
                r.index,
                r.videoFile || "",
                r.previewImageFile || "",
                r.previewImageUrl || "",
                r.pairedAudioFile || "",
                r.linked ? 1 : 0,
            ].join(":")).join(","),
            (s.refAudios || []).map((r) => `${r.index}:${r.audioFile || ""}`).join(","),
        ])]);
        if (this._externalGroupsSyncSig === sig) return;
        this._externalGroupsSyncSig = sig;

        if (mode === "fl2v") {
            const prev = this.timeline.shots || [];
            this.timeline.shots = specs.map((spec, i) => newFl2vShot({
                ...(prev[i] || {}),
                id: prev[i]?.id,
                durationSec: spec.durationSec ?? defaultDurationSec("fl2v"),
                prompt: (spec.prompt || prev[i]?.prompt || "").trim(),
                // External graph is source of truth for media previews.
                startImage: imageRefFromPath(spec.firstImageFile),
                endImage: imageRefFromPath(spec.lastImageFile),
            }));
            syncFl2vFromShots(this);
            this.selectedIndex = Math.min(this.selectedIndex ?? 0, Math.max(0, this.timeline.shots.length - 1));
            updateFl2vDetailUI?.(this);
            this.scheduleRender?.();
            this.commit?.(false, { syncTimeline: true });
            this.updateVideoNameLabel?.();
            this.updateDomWidgetHeight?.();
            this.updateRunSelectUI?.();
            return;
        }

        if (mode === "prompt_batch" || mode === "image_batch" || isPromptBatchTask(taskKey)) {
            const prev = this.timeline.segments || [];
            const isR2v = taskKey === "r2v" || this.hasExternalR2vGroups?.();
            const plannedCount = motionInheritance ? Math.max(prev.length, specs.length) : specs.length;
            this.timeline.segments = Array.from({ length: plannedCount }, (_, i) => {
                const spec = specs[i];
                if (!spec) {
                    // With Motion Context ON, disconnected tail cards remain in
                    // the timeline and supply prompt/duration plus optional
                    // reset/reference material to the backend planner.
                    return newBatchSegment({
                        ...(prev[i] || {}),
                        id: prev[i]?.id,
                        durationSec: prev[i]?.durationSec ?? defaultDurationSec(taskKey),
                        prompt: (prev[i]?.prompt || "").trim(),
                        refs: isR2v ? [] : (prev[i]?.refs || []),
                        refAudios: isR2v ? [] : (prev[i]?.refAudios || []),
                        refVideos: isR2v ? [] : (prev[i]?.refVideos || []),
                        genImage: { imageFile: "" },
                        imageFile: "",
                    });
                }
                const firstRef = imageRefFromPath(spec.firstImageFile);
                const genImage = firstRef
                    || (isR2v ? (prev[i]?.genImage || { imageFile: "" }) : { imageFile: "" });
                // External graph is source of truth for r2v media (do not keep stale UI uploads).
                const refs = isR2v
                    ? (spec.refImages || []).map((r) => ({
                        index: r.index,
                        assetId: (prev[i]?.refs || []).find((x) => Number(x.index ?? x.slot) === Number(r.index))?.assetId || "",
                        imageFile: r.imageFile || "",
                        imageB64: "",
                    }))
                    : (prev[i]?.refs || []);
                const refVideos = isR2v
                    ? (spec.refVideos || []).map((r) => ({
                        index: r.index,
                        assetId: (prev[i]?.refVideos || []).find((x) => Number(x.index ?? x.slot) === Number(r.index))?.assetId || "",
                        videoFile: r.videoFile || "",
                        fileName: r.fileName || "",
                        type: r.type || "input",
                        subfolder: r.subfolder || "",
                        pairedAudioFile: r.pairedAudioFile || "",
                        previewImageFile: r.previewImageFile || "",
                        previewImageUrl: r.previewImageUrl || "",
                        linked: !!r.linked || !!(r.videoFile || r.previewImageFile || r.previewImageUrl),
                    }))
                    : (prev[i]?.refVideos || []);
                const refAudios = isR2v
                    ? (spec.refAudios || []).map((r) => ({
                        index: r.index,
                        assetId: (prev[i]?.refAudios || []).find((x) => Number(x.index ?? x.slot) === Number(r.index))?.assetId || "",
                        audioFile: r.audioFile || "",
                        fileName: r.fileName || "",
                        type: r.type || "input",
                        subfolder: r.subfolder || "",
                    }))
                    : (prev[i]?.refAudios || []);
                return newBatchSegment({
                    ...(prev[i] || {}),
                    id: prev[i]?.id,
                    durationSec: spec.durationSec ?? defaultDurationSec(taskKey),
                    prompt: (spec.prompt || prev[i]?.prompt || "").trim(),
                    negativePrompt: prev[i]?.negativePrompt ?? "",
                    refs,
                    refAudios,
                    refVideos,
                    genImage: genImage?.imageFile ? genImage : { imageFile: "" },
                    imageFile: genImage?.imageFile || "",
                });
            });
            normalizeImageBatchSegments(this);
            if (this.getTaskKey() === "r2v") ensureR2vReferenceAssetSchema(this.timeline);
            else ensureReferenceAssetSchema(this.timeline);
            this.selectedIndex = Math.min(this.selectedIndex ?? 0, Math.max(0, this.timeline.segments.length - 1));
            this.renderImageBatchGroups?.();
            this.scheduleRender?.();
            this.commit?.(false, { syncTimeline: true });
            this.updateVideoNameLabel?.();
            this.updateDomWidgetHeight?.();
            this.updateRunSelectUI?.();
            this.updateSelectionUI?.();
        }
    }

    _observeViewportResize() {
        if (!this.viewport || typeof ResizeObserver === "undefined") return;
        this._resizeObserver?.disconnect();
        this._resizeObserver = new ResizeObserver(() => {
            if (this.isPlaying || this._pauseSettling) return;
            this.scheduleRender();
        });
        this._resizeObserver.observe(this.viewport);
        if (this.container && this.container !== this.viewport) {
            this._resizeObserver.observe(this.container);
        }
    }

    /**
     * CSS layout width for the timeline bitmap.
     * Must NOT use getBoundingClientRect — ComfyUI graph zoom transforms inflate/deflate
     * that value while width:100% still follows clientWidth, and object-fit:fill then
     * stretches segment thumbnails.
     */
    _measureDrawWidth() {
        if (this.isPlaying && this._playCanvasWidth > 0) return this._playCanvasWidth;
        if (this.zoom > 1) {
            const zoomed = this.canvas?.clientWidth || this.canvas?.offsetWidth || 0;
            if (zoomed > 0) return zoomed;
        }
        return this.viewport?.clientWidth
            || this.canvas?.clientWidth
            || this.canvas?.offsetWidth
            || this.container?.clientWidth
            || this.root?.clientWidth
            || 0;
    }

    /** Redraw after layout/zoom settles (first mount often measures before the node finishes sizing). */
    scheduleSettleRender() {
        if (this._directorModalController && !this._directorModalOpen) return;
        this.scheduleRender();
        if (this._settleRenderTimer != null) return;
        this._settleRenderTimer = setTimeout(() => {
            this._settleRenderTimer = null;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!this.isPlaying) this.scheduleRender();
                });
            });
        }, 0);
        // Extra pass after ComfyUI node size / graph zoom finishes applying.
        clearTimeout(this._settleRenderLateTimer);
        this._settleRenderLateTimer = setTimeout(() => {
            this._settleRenderLateTimer = null;
            if (!this.isPlaying) this.scheduleRender();
        }, 100);
    }

    _capturePlayCanvasWidth() {
        const w = this.viewport?.clientWidth
            || this.container?.offsetWidth
            || this.node?.size?.[0]
            || DIRECTOR_MIN_WIDTH;
        if (w > 0) this._playCanvasWidth = w;
        return this._playCanvasWidth;
    }

    _lockPlayLayout() {
        this._capturePlayCanvasWidth();
    }

    _resetLayoutStyles() {
        if (this.isPlaying) return;
        for (const el of [this.container, this.root, this.viewport]) {
            if (!el) continue;
            el.style.removeProperty("width");
            el.style.removeProperty("min-width");
            el.style.removeProperty("max-width");
        }
        this._playCanvasWidth = 0;
        this.applyZoomWidth();
    }

    _releasePlayLayoutLock() {
        this._resetLayoutStyles();
    }

    updateDomWidgetHeight() {
        const h = getDirectorUiHeight(this);
        // The full content height belongs to the scrollable page modal only. The
        // LiteGraph DOM widget remains a fixed-height launcher in every mode.
        this.root?.style.setProperty("--comfy-widget-min-height", `${h}px`);
        if (this.root) this.root.style.minHeight = `${h}px`;
        return h;
    }

    scheduleRender() {
        if (this._directorModalController && !this._directorModalOpen) return;
        if (this._renderPending) return;
        this._renderPending = true;
        this._resizeRaf = requestAnimationFrame(() => {
            this._renderPending = false;
            if (this.isPlaying) this.renderTimelineOnly();
            else this.render();
        });
    }

    buildTimelinePayload() {
        if (this.isMixedMode()) return this._mixedPayload();
        this.ensureContextLinks();
        this.timeline.seedMode = seedControlModeFromWidgets(this.node?.widgets || []);
        if (this.isFl2vMode()) {
            const fl = buildFl2vPayloadFields(this);
            const outMode = this.timeline.output?.mode || "long_edge";
            const output = {
                ...(this.timeline.output || {}),
                mode: outMode,
            };
            const body = { ...this.timeline };
            stripTimelineContinuityRootFields(body);
            stripTimelineEphemeralFields(body);
            return {
                ...body,
                version: 5,
                ...fl,
                frameRate: this.getFrameRate(),
                global: {
                    ...(this.timeline.global || {}),
                    taskType: this.globalTask?.value || this.taskTypeWidget?.value || "",
                    prompt: this.timeline.global?.prompt || "",
                },
                output,
                ...this._runSelectionPayload(),
            };
        }
        if (this.isImageBatch()) {
            const taskKey = this.getTaskKey();
            const i2iSrc = (taskKey === "i2i" || taskKey === "i2v") ? this.getI2iSourceDimensions() : null;
            const outMode = imageBatchRequiresFixedOutput(taskKey)
                ? "fixed"
                : (this.timeline.output?.mode || "long_edge");
            const output = normalizeOutputContinuity({
                ...this.timeline.output,
                mode: outMode,
            });
            if (!isVideoBatchTask(taskKey)) {
                output.exportMode = "all";
            }
            if (i2iSrc?.width > 0 && i2iSrc?.height > 0) {
                output.sourceWidth = i2iSrc.width;
                output.sourceHeight = i2iSrc.height;
            }
            const batchBody = { ...this.timeline };
            stripTimelineContinuityRootFields(batchBody);
            stripTimelineEphemeralFields(batchBody);
            return {
                ...batchBody,
                version: 5,
                timelineMode: "prompt_batch",
                editMode: "segment",
                totalFrames: sumFrameCounts(this.timeline.segments),
                frameRate: this.getFrameRate(),
                width: this.timeline.output?.width,
                height: this.timeline.output?.height,
                global: {
                    ...this.timeline.global,
                    taskType: this.globalTask?.value || this.taskTypeWidget?.value || "",
                    prompt: this.timeline.global?.prompt || "",
                    ...(i2iSrc?.width > 0 ? { sourceWidth: i2iSrc.width, sourceHeight: i2iSrc.height } : {}),
                },
                output,
                segments: this.timeline.segments.map((s) => {
                    const clean = sanitizeSegmentForPayload(s);
                    return {
                        id: clean.id,
                        start: clean.start,
                        length: clean.frameCount ?? clean.length ?? 1,
                        frameCount: clean.frameCount ?? clean.length ?? 1,
                        durationSec: clean.durationSec,
                        prompt: clean.prompt || "",
                        negativePrompt: clean.negativePrompt || "",
                        taskType: clean.taskType || "",
                        refs: clean.refs || [],
                        refAudios: clean.refAudios || [],
                        refVideos: clean.refVideos || [],
                        genImage: clean.genImage || { imageFile: "" },
                        contextLink: clean.contextLink,
                    };
                }),
                ...this._runSelectionPayload(),
            };
        }
        if (this.isGenMode()) {
            const mode = this.getDirectorMode();
            const genBody = { ...this.timeline };
            stripTimelineContinuityRootFields(genBody);
            stripTimelineEphemeralFields(genBody);
            return {
                ...genBody,
                version: 5,
                timelineMode: mode,
                totalFrames: sumFrameCounts(this.timeline.segments),
                frameRate: this.getFrameRate(),
                width: this.timeline.output?.width,
                height: this.timeline.output?.height,
                refMaxSize: this.timeline.output?.longEdge,
                global: {
                    ...this.timeline.global,
                    taskType: this.globalTask?.value || this.taskTypeWidget?.value || "",
                    prompt: this.timeline.global?.prompt || "",
                },
                output: normalizeOutputContinuity({ ...this.timeline.output }),
                segments: this.timeline.segments.map((s) => {
                const clean = sanitizeSegmentForPayload(s);
                return {
                    ...clean,
                    frameCount: clean.frameCount ?? clean.length,
                };
            }),
            ...this._runSelectionPayload(),
            };
        }
        const video = { ...(this.timeline.video || {}) };
        const frameMap = video.frameMap?.length ? video.frameMap : [];
        const src = this.getSourceDimensions();
        const resolved = resolveOutputDimensions(src.width, src.height, this.timeline.output || {}, {
            refMaxSize: this.refMaxWidget?.value,
        }, this.getH3SpatialStride());
        const storageW = resolved.width || video.storageWidth || this._storageWidth;
        const storageH = resolved.height || video.storageHeight || this._storageHeight;
        const clips = this.getVideoClips().map((c) => ({
            ...c,
            storageWidth: storageW,
            storageHeight: storageH,
        }));
        const { referenceVideo: _legacyRefVideo, reference_video: _legacyRefVideo2, ...timelineBody } = this.timeline;
        stripTimelineContinuityRootFields(timelineBody);
        stripTimelineEphemeralFields(timelineBody);
        const clipSourceTotal = clips.reduce(
            (s, c) => s + (parseInt(c.sourceFrameCount, 10) || 0),
            0,
        );
        const sourceFrameCount = parseInt(video.sourceFrameCount, 10)
            || clipSourceTotal
            || (frameMap.length ? 0 : this.getTotalFrames());
        return {
            ...timelineBody,
            version: 4,
            timelineMode: "video",
            totalFrames: this.getTotalFrames(),
            frameRate: this.getFrameRate(),
            videoClips: clips,
            global: {
                ...(this.timeline.global || {}),
                taskType: this.globalTask?.value || this.taskTypeWidget?.value || "",
                prompt: this.timeline.global?.prompt || "",
                referenceVideo: this.timeline.global?.referenceVideo || {},
                continuousReference: !!this.timeline.global?.continuousReference,
            },
            segments: (this.timeline.segments || []).map((s) => {
                const clean = sanitizeSegmentForPayload(s);
                return {
                    ...clean,
                    referenceVideo: clean.referenceVideo || {},
                };
            }),
            video: {
                ...video,
                frameMap,
                sourceFrameCount,
                deletedSourceRanges: frameMap.length ? [] : (video.deletedSourceRanges || []),
                frames: (video.videoFile || video.fileName)
                    ? []
                    : (this._legacyFrames.length ? this._legacyFrames : []),
                storageWidth: storageW,
                storageHeight: storageH,
            },
            output: normalizeOutputContinuity({ ...this.timeline.output }),
            ...this._runSelectionPayload(),
        };
    }

    flushTimelineSync() {
        clearTimeout(this._syncTimer);
        this._syncTimer = null;
        this._writeTimelineWidget();
    }

    scheduleTimelineSync() {
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this._writeTimelineWidget(), TIMELINE_SYNC_DEBOUNCE_MS);
    }

    _writeTimelineWidget() {
        if (this.isMixedMode()) {
            if (!this.timelineWidget) return;
            this.timelineWidget.value = JSON.stringify(this._mixedPayload());
            this.node.setDirtyCanvas(true, false);
            return;
        }
        if (!this.timelineWidget) return;
        this.syncFromWidgets();
        this.timelineWidget.value = JSON.stringify(this.buildTimelinePayload());
        this.node.setDirtyCanvas(true, false);
    }

    _markNodeDirtyLight() {
        this.node.setDirtyCanvas(true, false);
    }

    buildDOM() {
        this.root = document.createElement("div");
        this.root.className = "bd-wrap";
        this.root.innerHTML = `<style>${STYLES}</style>`;

        const toolbarWrap = document.createElement("div");
        toolbarWrap.className = "bd-toolbar-wrap";
        toolbarWrap.innerHTML = `
            <div class="bd-toolbar">
                <div class="bd-toolbar-left">
                  <div class="bd-task-anchor">
                    <select class="bd-select" data-r="global-task" title="task_type"></select>
                  </div>
                  <div class="bd-actions">
                    <button type="button" class="bd-btn bd-btn-primary hidden" data-a="r2v-add-group" data-i18n="toolbar.addRefGroup" data-i18n-title="tooltip.addRefGroup">添加素材组</button>
                    <button type="button" class="bd-btn bd-btn-primary" data-a="video" data-i18n="toolbar.uploadVideo">上传视频</button>
                    <button type="button" class="bd-btn bd-btn-primary hidden" data-a="fl2v-add-shot" data-i18n="toolbar.addShot" data-i18n-title="tooltip.addShot">添加一组</button>
                    <button type="button" class="bd-btn" data-a="video-append" data-i18n="toolbar.appendVideo" data-i18n-title="tooltip.appendVideo">追加视频</button>
                    <button type="button" class="bd-btn" data-a="split" data-i18n="toolbar.split">+ 分割</button>
                    <input type="number" class="bd-num" data-r="equal-n" min="2" max="64" value="2" data-i18n-title="tooltip.equalSplitN">
                    <button type="button" class="bd-btn" data-a="equal" data-i18n="toolbar.equalSplit">均分</button>
                    <button type="button" class="bd-btn" data-a="smart-split" data-i18n="toolbar.smartSplit" data-i18n-title="tooltip.smartSplit">智能分割</button>
                    <button type="button" class="bd-btn" data-a="run-select-toggle" data-i18n="toolbar.runSelect" data-i18n-title="tooltip.runSelect">选择运行</button>
                    <label class="bd-run-select-all-wrap hidden" data-r="run-select-all-wrap" data-i18n-title="tooltip.runSelectAll">
                        <input type="checkbox" data-r="run-select-all-cb">
                        <span data-i18n="toolbar.selectAll">全选</span>
                    </label>
                    <button type="button" class="bd-btn bd-btn-danger" data-a="del" data-i18n="toolbar.deleteSegment" data-i18n-title="tooltip.deleteSegment">删除片段</button>
                    <div class="bd-mode">
                        <button type="button" data-a="mode-global" class="active" data-i18n="toolbar.modeGlobal">全局模式</button>
                        <button type="button" data-a="mode-segment" data-i18n="toolbar.modeSegment">分段模式</button>
                    </div>
                    <span class="bd-video-tag" data-r="video-name" data-i18n="toolbar.noVideo">未上传视频</span>
                  </div>
                </div>
                <div class="bd-right">
                    <div class="bd-bounds" data-r="bounds">起点: 0.00 | 终点: -</div>
                    <div class="bd-timecode" data-r="timecode">0.00s</div>
                </div>
            </div>
            <div class="bd-smart-split-msg hidden" data-r="smart-split-msg" role="status"></div>
            <div class="bd-external-groups-msg hidden" data-r="external-groups-msg" role="status"></div>`;
        this.root.appendChild(toolbarWrap);
        this.smartSplitMsgEl = toolbarWrap.querySelector('[data-r="smart-split-msg"]');
        this.externalGroupsMsgEl = toolbarWrap.querySelector('[data-r="external-groups-msg"]');

        this.mainBody = document.createElement("div");
        this.mainBody.className = "bd-main";
        this.root.appendChild(this.mainBody);

        const stage = document.createElement("div");
        stage.className = "bd-stage hidden";
        stage.setAttribute("data-r", "video-stage");
        stage.innerHTML = `
            <video class="bd-stage-video hidden" data-r="stage-video" muted playsinline preload="auto"></video>
            <img class="bd-stage-img hidden" data-r="stage-img" alt="">
            <div class="bd-stage-empty" data-r="stage-empty" data-i18n="stage.empty">上传视频后可在此预览播放</div>
            <div class="bd-stage-badge hidden" data-r="stage-badge"></div>`;
        this.mainBody.appendChild(stage);

        // Playback bar sits between video stage and timeline edit area.
        const controls = document.createElement("div");
        controls.className = "bd-controls";
        controls.innerHTML = `
            <div class="bd-player">
                <button type="button" class="bd-icon-btn" data-a="play" data-i18n-title="player.playPause">▶</button>
                <button type="button" class="bd-icon-btn" data-a="loop" data-i18n-title="player.loopOn">⟳</button>
                <button type="button" class="bd-icon-btn" data-a="frame-prev" data-i18n-title="player.framePrev">‹</button>
                <button type="button" class="bd-icon-btn" data-a="frame-next" data-i18n-title="player.frameNext">›</button>
                <span class="bd-frame-jump" data-i18n-title="player.frameJump">
                    <span data-i18n="player.frame">帧</span>
                    <input type="number" class="bd-frame-input" data-r="frame-input" min="1" step="1" value="1">
                    <span>/</span>
                    <span class="bd-frame-total" data-r="frame-total">0</span>
                </span>
                <div class="bd-timecode" data-r="player-timecode">0.00 / 0.00</div>
                <input type="range" class="bd-seek" data-r="seek" min="0" value="0" step="1">
                <div class="bd-zoom bd-row">
                    <button type="button" class="bd-icon-btn" data-a="zoom-out">−</button>
                    <input type="range" data-r="zoom" min="1" max="10" step="0.25" value="1" style="width:80px">
                    <button type="button" class="bd-icon-btn" data-a="zoom-in">+</button>
                </div>
            </div>`;
        this.mainBody.appendChild(controls);

        // Appears above the timeline when a split point is selected.
        const splitEditBar = document.createElement("div");
        splitEditBar.className = "bd-split-edit-bar hidden";
        splitEditBar.setAttribute("data-r", "split-edit-bar");
        splitEditBar.innerHTML = `
            <span class="bd-split-edit-hint" data-r="split-edit-hint" data-i18n="split.selectedHint">已选中分割点</span>
            <button type="button" class="bd-btn bd-btn-del-split" data-a="del-split" data-i18n="toolbar.deleteSplitPoint" data-i18n-title="tooltip.deleteSplitPoint">删除分割点</button>`;
        this.mainBody.appendChild(splitEditBar);
        this.splitEditBarEl = splitEditBar;
        this.splitEditHintEl = splitEditBar.querySelector('[data-r="split-edit-hint"]');

        this.viewport = document.createElement("div");
        this.viewport.className = "bd-viewport";
        this.canvas = document.createElement("canvas");
        this.canvas.className = "bd-canvas";
        this.canvas.tabIndex = 0;
        this.viewport.appendChild(this.canvas);
        this.mainBody.appendChild(this.viewport);
        this.ctx = this.canvas.getContext("2d");

        const outputBar = document.createElement("div");
        outputBar.className = "bd-output";
        outputBar.innerHTML = `
            <span class="bd-fl2v-total-wrap hidden" data-r="fl2v-total-wrap" data-i18n-title="tooltip.fl2vTotalDuration">
                <label data-i18n="output.totalDurationSec">总时长（秒）</label>
                <input type="number" class="bd-num" data-r="fl2v-total" min="1" max="99999" step="0.1" value="5" style="width:64px" disabled data-i18n-title="tooltip.fl2vTotalInput">
            </span>
            <label data-i18n="output.resolution">输出分辨率</label>
            <select class="bd-select" data-r="out-aspect" data-i18n-title="tooltip.aspectRatio" style="max-width:200px">
                ${RESOLUTION_ASPECTS.map(([label]) => `<option value="${label}"${label === DEFAULT_ASPECT_RATIO ? " selected" : ""}>${aspectDisplayLabel(label)}</option>`).join("")}
                <option value="${CUSTOM_ASPECT_RATIO}">${aspectDisplayLabel(CUSTOM_ASPECT_RATIO)}</option>
            </select>
            <span class="bd-out-mp-wrap" data-r="out-mp-wrap" data-i18n-title="tooltip.megapixels">
                <label data-i18n="output.megapixels">百万像素</label>
                <input type="number" class="bd-num" data-r="out-mp" min="0.1" max="16" step="0.1" value="${DEFAULT_MEGAPIXELS}" style="width:56px">
            </span>
            <span class="bd-out-long hidden" data-r="out-long-wrap">
                <label data-i18n="output.longEdge">最长边</label>
                <input type="number" class="bd-num" data-r="out-long" min="32" max="8192" step="1" value="864" style="width:56px" data-i18n-title="tooltip.longEdge">
            </span>
            <span class="bd-out-fixed hidden" data-r="out-fixed-wrap" data-i18n-title="tooltip.customWH">
                <label data-i18n="output.width">宽</label>
                <input type="number" class="bd-num" data-r="out-w" min="32" max="8192" step="32" value="864" style="width:56px">
                <label data-i18n="output.height">高</label>
                <input type="number" class="bd-num" data-r="out-h" min="32" max="8192" step="32" value="480" style="width:56px">
            </span>
            <select class="bd-select hidden" data-r="out-mode" data-i18n-title="tooltip.outputMode">
                <option value="long_edge" data-i18n="output.mode.longEdge">最长边缩放</option>
                <option value="fixed" data-i18n="output.mode.fixed">固定宽高</option>
            </select>
            <label data-i18n="output.fpsLabel" data-i18n-title="tooltip.fps">帧率</label>
            <input type="number" class="bd-num" data-r="timeline-fps" min="1" max="240" step="0.01" value="24" style="width:64px" data-i18n-title="tooltip.timelineFps">
            <span class="bd-out-audio-wrap hidden" data-r="out-audio-wrap" data-i18n-title="tooltip.audioMode">
                <label data-i18n="output.audio.label">声音</label>
                <select class="bd-select" data-r="out-audio-mode" style="max-width:120px">
                    <option value="generate" data-i18n="output.audio.generate">生成声音</option>
                    <option value="source" data-i18n="output.audio.source">使用原声</option>
                    <option value="mute" data-i18n="output.audio.mute">静音</option>
                </select>
            </span>
            <span class="bd-meta" data-r="out-preview">—</span>
            <span class="bd-meta hidden" data-r="out-hint"></span>
            <label data-i18n="output.exportMode.label" data-i18n-title="tooltip.exportMode">导出方式</label>
            <select class="bd-select" data-r="out-export-mode" data-i18n-title="tooltip.exportMode">
                <option value="all" data-i18n="output.exportMode.all">全部导出</option>
                <option value="segments" data-i18n="output.exportMode.segments">分段导出</option>
            </select>
            <span class="hidden" data-r="out-max-frames-wrap" hidden aria-hidden="true">
                <label data-i18n="output.maxFrames">最大帧数</label>
                <input type="number" class="bd-num" data-r="out-max-frames" min="0" max="999999" step="1" value="0" style="width:64px">
            </span>
            <span class="bd-continuous-ref hidden" data-r="segment-continuity-wrap" hidden aria-hidden="true" title="">
                <label><input type="checkbox" data-r="segment-continuity-cb"><span data-i18n="output.segmentContinuity">段间引导</span></label>
                <span class="bd-meta" data-i18n="output.continuityOverlap">参考帧数</span>
                <input type="number" class="bd-num" data-r="segment-continuity-overlap" min="1" max="81" step="4" value="9" style="width:48px">
            </span>`;
        this.r2vCommonToggle = mountR2vCommonToggle(outputBar);
        this.mainBody.appendChild(outputBar);
        this.outputBarEl = outputBar;

        // Model-result preview lives exclusively on the Output page.
        this.liveSampleEl = null;
        this._liveSampleHost = null;

        const bottom = document.createElement("div");
        bottom.className = "bd-split";
        bottom.innerHTML = `
            <div class="bd-panel" data-r="global-panel">
                <b data-r="global-panel-title" data-i18n="panel.globalPromptAndRefs">全局提示词 & 参考图 (图片1–9)</b>
                <div class="bd-prompt-layout" data-r="global-prompt-layout">
                    <div class="bd-refs-col" data-r="global-refs-col">
                        <div class="bd-refs-images-wrap" data-r="global-refs-images-wrap">
                            <div class="bd-r2v-section-head" data-r="global-refs-head">
                                <span class="bd-label bd-r2v-section-title" data-r="global-refs-label" data-i18n="panel.refImages">参考图 (图片1–9)</span>
                                <span class="bd-r2v-section-count" data-r="global-refs-count"></span>
                            </div>
                            <div class="bd-refs" data-r="global-refs"></div>
                        </div>
                        <div class="bd-ref-audios-wrap hidden" data-r="global-ref-audios-wrap">
                            <div class="bd-r2v-section-head" data-r="global-audios-head">
                                <span class="bd-label bd-r2v-section-title" data-i18n="batch.r2v.sectionAudios">参考音频</span>
                                <span class="bd-r2v-section-count" data-r="global-audios-count"></span>
                            </div>
                            <div class="bd-ref-audios" data-r="global-ref-audios"></div>
                        </div>
                        <div class="bd-ref-video-col hidden" data-r="global-ref-video-col">
                            <span class="bd-label" data-i18n="panel.refVideo">参考视频（植入内容）</span>
                            <div class="bd-gen-src" data-r="global-ref-video" data-i18n="panel.uploadRefVideo" data-i18n-title="tooltip.uploadRefVideo">点击上传参考视频</div>
                            <span class="bd-meta bd-ref-video-name" data-r="global-ref-video-name"></span>
                            <label class="bd-continuous-ref hidden" data-r="continuous-ref-wrap" data-i18n-title="tooltip.continuousRef">
                                <input type="checkbox" data-r="continuous-ref-cb">
                                <span data-i18n="panel.continuousRef">连续参考</span>
                            </label>
                        </div>
                        <div class="bd-gen-src hidden" data-r="gen-global-img" data-i18n="panel.uploadSourceImage" data-i18n-title="tooltip.uploadSourceImage">点击上传源图片</div>
                    </div>
                    <div class="bd-prompt-col">
                        <span class="bd-label" data-i18n="panel.prompt">提示词</span>
                        <textarea class="bd-prompt" data-r="global-prompt" data-i18n-placeholder="placeholder.globalPrompt" placeholder=""></textarea>
                        <textarea class="bd-prompt bd-prompt-negative hidden" data-r="global-negative" hidden aria-hidden="true"></textarea>
                    </div>
                </div>
                <div class="bd-gen-fc-row hidden" data-r="gen-global-fc-row">
                    <span class="bd-label" data-i18n="panel.defaultSegmentFrames">默认片段帧数</span>
                    <input type="number" class="bd-num" data-r="gen-default-fc" min="1" max="${MAX_GEN_FRAMES}" value="124" style="width:72px">
                </div>
            </div>
            <div class="bd-panel" data-r="segment-panel" style="display:none">
                <div class="bd-seg-head">
                    <b data-r="seg-label">片段 1</b>
                    <div class="bd-meta" data-r="seg-info"></div>
                </div>
                <div class="bd-prompt-layout" data-r="seg-prompt-layout">
                    <div class="bd-refs-col" data-r="seg-refs-col">
                        <div class="bd-refs-images-wrap" data-r="seg-refs-images-wrap">
                            <div class="bd-r2v-section-head" data-r="seg-refs-head">
                                <span class="bd-label bd-r2v-section-title" data-r="seg-refs-label" data-i18n="panel.segmentRefImages">片段参考图 (图片1–9)</span>
                                <span class="bd-r2v-section-count" data-r="seg-refs-count"></span>
                            </div>
                            <div class="bd-refs" data-r="seg-refs"></div>
                        </div>
                        <div class="bd-ref-audios-wrap hidden" data-r="seg-ref-audios-wrap">
                            <div class="bd-r2v-section-head" data-r="seg-audios-head">
                                <span class="bd-label bd-r2v-section-title" data-i18n="batch.r2v.sectionAudios">参考音频</span>
                                <span class="bd-r2v-section-count" data-r="seg-audios-count"></span>
                            </div>
                            <div class="bd-ref-audios" data-r="seg-ref-audios"></div>
                        </div>
                        <div class="bd-ref-video-col hidden" data-r="seg-ref-video-col">
                            <span class="bd-label" data-i18n="panel.segmentRefVideo">片段参考视频（植入内容）</span>
                            <div class="bd-gen-src" data-r="seg-ref-video" data-i18n="panel.uploadRefVideo" data-i18n-title="tooltip.uploadRefVideo">点击上传参考视频</div>
                            <span class="bd-meta bd-ref-video-name" data-r="seg-ref-video-name"></span>
                        </div>
                        <div class="bd-gen-src hidden" data-r="gen-seg-img" data-i18n="panel.uploadSegmentSourceImage" data-i18n-title="tooltip.uploadSourceImage">点击上传源图片</div>
                    </div>
                    <div class="bd-prompt-col">
                        <span class="bd-label" data-i18n="panel.prompt">提示词</span>
                        <textarea class="bd-prompt" data-r="seg-prompt" data-i18n-placeholder="placeholder.segmentPrompt" placeholder=""></textarea>
                        <textarea class="bd-prompt bd-prompt-negative hidden" data-r="seg-negative" hidden aria-hidden="true"></textarea>
                    </div>
                </div>
                <div class="bd-gen-fc-row hidden" data-r="gen-seg-fc-row">
                    <span class="bd-label" data-i18n="panel.segmentFrames">片段帧数</span>
                    <input type="number" class="bd-num" data-r="gen-seg-fc" min="1" max="${MAX_GEN_FRAMES}" value="124" style="width:72px">
                </div>
            </div>`;
        this.mainBody.appendChild(bottom);

        const batchUi = mountImageBatchPanel(this.mainBody);
        this.batchPanel = batchUi.panel;
        this.batchList = batchUi.list;
        this.batchHint = batchUi.hint;
        this.batchI2vNotice = batchUi.i2vNotice;
        this.batchAddBtn = batchUi.addBtn;
        wireBatchRunSelectControls(this, batchUi);

        this.fl2vUi = mountFl2vPanel(this.mainBody);
        this.fl2vTotalWrap = this.root.querySelector('[data-r="fl2v-total-wrap"]');
        if (this.fl2vUi) {
            this.fl2vUi.totalInput = this.root.querySelector('[data-r="fl2v-total"]');
        }
        bindFl2vEvents(this);

        this.container.appendChild(this.root);

        this._previewVideo = document.createElement("video");
        this._previewVideo.crossOrigin = "anonymous";
        this._previewVideo.muted = true;
        this._previewVideo.playsInline = true;
        this._previewVideo.preload = "auto";
        this._previewVideo.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none";
        document.body.appendChild(this._previewVideo);

        this._thumbCanvas = document.createElement("canvas");
        this._thumbCtx = this._thumbCanvas.getContext("2d", { alpha: false });

        this.videoNameEl = this.root.querySelector('[data-r="video-name"]');
        this.equalCountInput = this.root.querySelector('[data-r="equal-n"]');
        this.boundsEl = this.root.querySelector('[data-r="bounds"]');
        this.timecodeEl = this.root.querySelector('[data-r="timecode"]');
        this.playerTimecodeEl = this.root.querySelector('[data-r="player-timecode"]');
        this.frameInputEl = this.root.querySelector('[data-r="frame-input"]');
        this.frameTotalEl = this.root.querySelector('[data-r="frame-total"]');
        this.seekBar = this.root.querySelector('[data-r="seek"]');
        this.zoomSlider = this.root.querySelector('[data-r="zoom"]');
        this.stageEl = this.root.querySelector('[data-r="video-stage"]');
        this.stageVideo = this.root.querySelector('[data-r="stage-video"]');
        this.stageImg = this.root.querySelector('[data-r="stage-img"]');
        this.stageEmpty = this.root.querySelector('[data-r="stage-empty"]');
        this.stageBadge = this.root.querySelector('[data-r="stage-badge"]');
        if (this.stageVideo) {
            this.stageVideo.crossOrigin = "anonymous";
            this.stageVideo.muted = true;
            this.stageVideo.playsInline = true;
        }
        this.globalTask = this.root.querySelector('[data-r="global-task"]');
        this.globalPanel = this.root.querySelector('[data-r="global-panel"]');
        this.globalPanelTitle = this.globalPanel?.querySelector("b");
        this.segmentPanel = this.root.querySelector('[data-r="segment-panel"]');
        this.globalPrompt = this.root.querySelector('[data-r="global-prompt"]');
        this.globalNegative = this.root.querySelector('[data-r="global-negative"]');
        this.globalPromptLayout = this.root.querySelector('[data-r="global-prompt-layout"]');
        this.segPromptLayout = this.root.querySelector('[data-r="seg-prompt-layout"]');
        this.globalRefsBox = this.root.querySelector('[data-r="global-refs"]');
        this.globalRefsImagesWrap = this.root.querySelector('[data-r="global-refs-images-wrap"]');
        this.globalRefsCount = this.root.querySelector('[data-r="global-refs-count"]');
        this.globalAudiosCount = this.root.querySelector('[data-r="global-audios-count"]');
        this.segRefsImagesWrap = this.root.querySelector('[data-r="seg-refs-images-wrap"]');
        this.segRefsCount = this.root.querySelector('[data-r="seg-refs-count"]');
        this.segAudiosCount = this.root.querySelector('[data-r="seg-audios-count"]');
        this.globalRefAudiosWrap = this.root.querySelector('[data-r="global-ref-audios-wrap"]');
        this.globalRefAudiosBox = this.root.querySelector('[data-r="global-ref-audios"]');
        this.segRefAudiosWrap = this.root.querySelector('[data-r="seg-ref-audios-wrap"]');
        this.segRefAudiosBox = this.root.querySelector('[data-r="seg-ref-audios"]');
        this.segLabel = this.root.querySelector('[data-r="seg-label"]');
        this.segInfo = this.root.querySelector('[data-r="seg-info"]');
        this.segPrompt = this.root.querySelector('[data-r="seg-prompt"]');
        this.segNegative = this.root.querySelector('[data-r="seg-negative"]');
        this.segRefsBox = this.root.querySelector('[data-r="seg-refs"]');
        this.globalRefsCol = this.root.querySelector('[data-r="global-refs-col"]');
        this.segRefsCol = this.root.querySelector('[data-r="seg-refs-col"]');
        this.globalRefVideoCol = this.root.querySelector('[data-r="global-ref-video-col"]');
        this.globalRefVideo = this.root.querySelector('[data-r="global-ref-video"]');
        this.globalRefVideoNameEl = this.root.querySelector('[data-r="global-ref-video-name"]');
        this.segRefVideoCol = this.root.querySelector('[data-r="seg-ref-video-col"]');
        this.segRefVideo = this.root.querySelector('[data-r="seg-ref-video"]');
        this.segRefVideoNameEl = this.root.querySelector('[data-r="seg-ref-video-name"]');
        this.continuousRefWrap = this.root.querySelector('[data-r="continuous-ref-wrap"]');
        this.continuousRefCb = this.root.querySelector('[data-r="continuous-ref-cb"]');
        this.genGlobalImg = this.root.querySelector('[data-r="gen-global-img"]');
        this.genSegImg = this.root.querySelector('[data-r="gen-seg-img"]');
        this.genGlobalFcRow = this.root.querySelector('[data-r="gen-global-fc-row"]');
        this.genSegFcRow = this.root.querySelector('[data-r="gen-seg-fc-row"]');
        this.genDefaultFc = this.root.querySelector('[data-r="gen-default-fc"]');
        this.genSegFc = this.root.querySelector('[data-r="gen-seg-fc"]');
        this.controlsBar = this.root.querySelector(".bd-controls");
        this.btnVideo = this.root.querySelector('[data-a="video"]');
        this.btnFl2vAddShot = this.root.querySelector('[data-a="fl2v-add-shot"]');
        this.btnVideoAppend = this.root.querySelector('[data-a="video-append"]');
        this.outHint = this.root.querySelector('[data-r="out-hint"]');
        this.outMode = this.root.querySelector('[data-r="out-mode"]');
        this.outAspect = this.root.querySelector('[data-r="out-aspect"]');
        this.outMpWrap = this.root.querySelector('[data-r="out-mp-wrap"]');
        this.outMp = this.root.querySelector('[data-r="out-mp"]');
        this.outLongWrap = this.root.querySelector('[data-r="out-long-wrap"]');
        this.outFixedWrap = this.root.querySelector('[data-r="out-fixed-wrap"]');
        this.outLong = this.root.querySelector('[data-r="out-long"]');
        this.outW = this.root.querySelector('[data-r="out-w"]');
        this.outH = this.root.querySelector('[data-r="out-h"]');
        this.fpsInput = this.root.querySelector('[data-r="timeline-fps"]');
        this.outAudioWrap = this.root.querySelector('[data-r="out-audio-wrap"]');
        this.outAudioMode = this.root.querySelector('[data-r="out-audio-mode"]');
        this.outMaxFrames = this.root.querySelector('[data-r="out-max-frames"]');
        this.outExportMode = this.root.querySelector('[data-r="out-export-mode"]');
        this.segmentContinuityWrap = this.root.querySelector('[data-r="segment-continuity-wrap"]');
        this.segmentContinuityCb = this.root.querySelector('[data-r="segment-continuity-cb"]');
        this.segmentContinuityOverlap = this.root.querySelector('[data-r="segment-continuity-overlap"]');
        this.outPreview = this.root.querySelector('[data-r="out-preview"]');
        this.runStatusEl = this.root.querySelector('[data-r="run-status"]');
        this.runTitleEl = this.root.querySelector('[data-r="run-title"]');
        this.runDetailEl = this.root.querySelector('[data-r="run-detail"]');
        this.runOverallEl = this.root.querySelector('[data-r="run-overall"]');
        this.runPhaseEl = this.root.querySelector('[data-r="run-phase"]');
        this.runSelectBar = this.root.querySelector('[data-r="run-select-bar"]');
        this.runSelectSummary = this.root.querySelector('[data-r="run-select-summary"]');
        this.btnRunSelectToggle = this.root.querySelector('[data-a="run-select-toggle"]');
        this.runSelectAllWrap = this.root.querySelector('[data-r="run-select-all-wrap"]');
        this.runSelectAllCb = this.root.querySelector('[data-r="run-select-all-cb"]');

        this.populateTaskSelect(this.globalTask, this.taskTypeWidget?.value);
        this.syncNegativeFromWidget();
        this.syncOutputUIFromTimeline();
        bindImageBatchEvents(this);
    }

    renderImageBatchGroups() {
        renderImageBatchGroups(this);
    }

    normalizeImageBatchSegments() {
        normalizeImageBatchSegments(this);
    }

    syncNegativeFromWidget() {
        const v = this.negativePromptWidget?.value ?? "";
        if (this.globalNegative) this.globalNegative.value = v;
        if (this.segNegative) this.segNegative.value = v;
    }

    bindEvents() {
        const bind = (sel, fn) => {
            const el = this.root.querySelector(sel);
            if (!el) return;
            el.onclick = (e) => { stopDomEvent(e); fn(); };
        };
        bind('[data-a="video"]', () => this.pickVideoFile());
        bind('[data-a="fl2v-add-shot"]', () => openFl2vUpload(this));
        bind('[data-a="r2v-add-group"]', () => addImageBatchGroup(this));
        bind('[data-a="video-append"]', () => this.pickAppendVideoFile());
        bind('[data-a="split"]', () => this.splitAtFrame(this.currentFrame));
        bind('[data-a="equal"]', () => this.equalSplit());
        bind('[data-a="smart-split"]', () => { void this.smartSplit(); });
        bind('[data-a="del-split"]', () => this.deleteSelectedSplitPoint());
        bind('[data-a="run-select-toggle"]', () => this.toggleRunSelectMode());
        bind('[data-a="del"]', () => this.deleteSelectedSegment());
        bind('[data-a="mode-global"]', () => this.setEditMode("global"));
        bind('[data-a="mode-segment"]', () => this.setEditMode("segment"));
        bind('[data-a="play"]', () => this.togglePlay());
        bind('[data-a="loop"]', () => this.toggleLoop());
        bind('[data-a="frame-prev"]', () => this.stepFrame(-1));
        bind('[data-a="frame-next"]', () => this.stepFrame(1));
        bind('[data-a="zoom-in"]', () => this.adjustZoom(0.5));
        bind('[data-a="zoom-out"]', () => this.adjustZoom(-0.5));
        this.refreshLiveTaePreviewButton();
        this.updateLiveSamplePanel();

        this.seekBar.oninput = () => {
            this.seekToFrame(+this.seekBar.value, { fromUi: true });
        };
        if (this.frameInputEl) {
            const applyFrameInput = () => {
                const total = this.getTotalFrames();
                if (total < 1) return;
                const raw = parseInt(this.frameInputEl.value, 10);
                if (!Number.isFinite(raw)) {
                    this.frameInputEl.value = String(this.currentFrame + 1);
                    return;
                }
                // UI is 1-based; internal currentFrame is 0-based.
                this.seekToFrame(raw - 1, { fromUi: true });
            };
            this.frameInputEl.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                    e.preventDefault();
                    applyFrameInput();
                    this.frameInputEl.blur();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    this.frameInputEl.value = String(this.currentFrame + 1);
                    this.frameInputEl.blur();
                }
            });
            this.frameInputEl.addEventListener("change", applyFrameInput);
            this.frameInputEl.addEventListener("focus", () => {
                if (this.isPlaying) this._stopPlay();
                this.frameInputEl.select();
            });
        }
        if (this.stageBadge) {
            this.stageBadge.title = t("player.badgeJump");
            this.stageBadge.addEventListener("click", (e) => {
                e.stopPropagation();
                if (this.isPlaying) this._stopPlay();
                this.frameInputEl?.focus();
                this.frameInputEl?.select();
            });
        }
        this.zoomSlider.oninput = () => { this.zoom = +this.zoomSlider.value; this.applyZoomWidth(); this.scheduleRender(); };
        if (this.runSelectAllCb) {
            this.runSelectAllCb.onchange = (e) => {
                stopDomEvent(e);
                if (!this.isRunSelectEnabled()) return;
                this.setRunSelectionAll(this.runSelectAllCb.checked);
            };
        }
        this.globalTask.onchange = () => this.onGlobalField("taskType", this.globalTask.value);
        this.globalPrompt.oninput = () => this.onGlobalField("prompt", this.globalPrompt.value);
        if (this.continuousRefCb) {
            this.continuousRefCb.onchange = () => {
                this.timeline.global = this.timeline.global || { refs: [], referenceVideo: {} };
                this.timeline.global.continuousReference = !!this.continuousRefCb.checked;
                this.scheduleTimelineSync();
            };
        }
        this.segPrompt.oninput = () => this.onSegField("prompt", this.segPrompt.value);
        this.globalNegative.oninput = () => this.onNegativePrompt(this.globalNegative.value);
        this.segNegative.oninput = () => this.onNegativePrompt(this.segNegative.value);

        this._promptMentionControllers = mountPromptImageMentions(this);

        this.outMode.onchange = () => this.onOutputField("mode", this.outMode.value);
        if (this.outAspect) {
            this.outAspect.onchange = () => this.onOutputField("aspectRatio", this.outAspect.value);
        }
        if (this.outMp) {
            // Do not coerce incomplete drafts ("0", "0.") — that snaps back to 0.4 mid-typing.
            const applyMp = ({ force = false } = {}) => {
                const parsed = parseMegapixelsInput(this.outMp.value);
                if (parsed == null) {
                    if (!force) return;
                    const restored = clampMegapixels(
                        this.timeline.output?.megapixels ?? DEFAULT_MEGAPIXELS,
                    );
                    this.outMp.value = String(restored);
                    this.onOutputField("megapixels", restored);
                    return;
                }
                this.onOutputField("megapixels", parsed);
            };
            this.outMp.onchange = () => applyMp({ force: true });
            this.outMp.onblur = () => applyMp({ force: true });
            this.outMp.oninput = () => {
                clearTimeout(this._mpInputTimer);
                this._mpInputTimer = setTimeout(() => applyMp({ force: false }), 280);
            };
            this.outMp.addEventListener("keydown", (e) => e.stopPropagation());
        }
        this.outLong.onchange = () => this.onOutputField("longEdge", +this.outLong.value);
        this.outW.onchange = () => this.onOutputField("width", +this.outW.value);
        this.outH.onchange = () => this.onOutputField("height", +this.outH.value);
        this.fpsInput.onchange = () => this.onFrameRateChanged(this.fpsInput.value);
        this.fpsInput.oninput = () => {
            clearTimeout(this._fpsInputTimer);
            this._fpsInputTimer = setTimeout(() => this.onFrameRateChanged(this.fpsInput.value), 350);
        };
        this.outMaxFrames.onchange = () => this.onOutputField("maxExportFrames", +this.outMaxFrames.value);
        this.outExportMode.onchange = () => this.onOutputField("exportMode", this.outExportMode.value);
        if (this.outAudioMode) {
            this.outAudioMode.onchange = () => this.onOutputField("audioMode", this.outAudioMode.value);
        }
        if (this.segmentContinuityCb) {
            this.segmentContinuityCb.onchange = () => {
                this.onOutputField("continuityEnabled", this.segmentContinuityCb.checked);
                this.updateSegmentContinuityUI();
            };
        }
        if (this.segmentContinuityOverlap) {
            const applyOverlap = () => this.onOutputField("continuityOverlapFrames", +this.segmentContinuityOverlap.value);
            this.segmentContinuityOverlap.onchange = applyOverlap;
            this.segmentContinuityOverlap.oninput = applyOverlap;
            this.segmentContinuityOverlap.addEventListener("keydown", (e) => e.stopPropagation());
            this.segmentContinuityOverlap.addEventListener("keyup", (e) => e.stopPropagation());
        }

        this.genGlobalImg?.addEventListener("click", (e) => { stopDomEvent(e); this.pickGenSrcImage(true); });
        this.genSegImg?.addEventListener("click", (e) => { stopDomEvent(e); this.pickGenSrcImage(false); });
        this.genDefaultFc?.addEventListener("change", () => this.onGenDefaultFcChange());
        this.genSegFc?.addEventListener("change", () => this.onGenSegFcChange());

        this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
        this.canvas.addEventListener("mousedown", () => this.canvas.focus({ preventScroll: true }));
        this.canvas.addEventListener("dblclick", (e) => {
            if (this.isFl2vMode()) {
                stopDomEvent(e);
                e.preventDefault();
                const { x, y } = this.getMousePos(e);
                const hit = this.hitTest(x, y);
                if (hit?.type === "segment" || hit?.type === "edge") {
                    const idx = hit.index ?? this.selectedIndex;
                    if (idx !== this.selectedIndex) flushFl2vPromptDraft(this);
                    this.selectedIndex = idx;
                    this.updateSelectionUI();
                    updateFl2vDetailUI(this);
                    this._fl2vUploadMode = "slot";
                    this._fl2vSlotKind = "start";
                    this._fl2vSlotShotIndex = idx;
                    this.fl2vUi?.fileInput?.click();
                }
                return;
            }
            this.addSplitAtMouse(e);
        });
        this.canvas.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const { x, y } = this.getMousePos(e);
            const hit = this.hitTest(x, y);
            if (hit?.type === "context-link") {
                stopDomEvent(e);
                openSegmentContextLinkMenu(e, this, hit.index);
                return;
            }
            if (this.isFl2vMode()) return;
            this.addSplitAtMouse(e);
        });
        this._onMouseMove = (e) => this.onMouseMove(e);
        this._onMouseUp = () => this.onMouseUp();
        this._onCanvasHover = (e) => {
            if (this._drag || this.isPlaying) return;
            const { x, y } = this.getMousePos(e);
            const hit = this.hitTest(x, y);
            this.canvas.classList.remove("bd-grab");
            if (hit?.type === "run-check" || hit?.type === "split" || hit?.type === "context-link") {
                this.canvas.style.cursor = "pointer";
                this.canvas.title = hit?.type === "context-link"
                    ? t(this.getSegmentContextMode(hit.index) === "off"
                        ? "contextLink.connectTooltip"
                        : "contextLink.disconnectTooltip")
                    : "";
            } else if (hit?.type === "edge") {
                // Edge drag is always horizontal (change start/length); keep ↔ cursor.
                this.canvas.style.cursor = "ew-resize";
                this.canvas.title = this.isFl2vMode()
                    ? t("tooltip.dragFl2vDuration")
                    : "";
            } else if (hit?.type === "segment" && (this.isFl2vMode() || this.isR2vBatch() || this.timeline.segments.length >= 2)) {
                this.canvas.classList.add("bd-grab");
                this.canvas.style.cursor = "";
                this.canvas.title = this.isFl2vMode()
                    ? t("tooltip.dragFl2vSwap")
                    : (this.isR2vBatch() ? t("tooltip.dragR2vOrder") : t("tooltip.dragSegmentOrder"));
            } else {
                this.canvas.style.cursor = "";
                this.canvas.title = "";
            }
        };
        window.addEventListener("mousemove", this._onMouseMove);
        window.addEventListener("mouseup", this._onMouseUp);
        this.canvas.addEventListener("mousemove", this._onCanvasHover);
        this.canvas.addEventListener("mouseleave", () => {
            this.canvas.classList.remove("bd-grab");
            this.canvas.style.cursor = "";
            this.canvas.title = "";
        });

        this.root.addEventListener("mouseenter", () => { this._isHovering = true; });
        this.root.addEventListener("mouseleave", () => { this._isHovering = false; });
        this._onKeyDown = createTimelineShortcutHandler({
            timelineElement: () => this.canvas,
            getActiveElement: () => document.activeElement,
            hasSelectedSplit: () => this.selectedSplitFrame != null,
            canDelete: () => this.timeline.segments.length >= 1
                && !(this.isR2vBatch() && this.timeline.segments.length <= 1),
            onDelete: () => this.deleteSelectedSegment(),
            onTogglePlay: () => this.togglePlay(),
            onStepFrame: (delta) => this.stepFrame(delta),
        });
        window.addEventListener("keydown", this._onKeyDown, true);

        this.root.addEventListener("dragover", (e) => e.preventDefault());
        this.root.addEventListener("drop", (e) => {
            e.preventDefault();
            // Slot-to-slot moves are handled on .bd-ref; don't also treat as new upload.
            const types = [...(e.dataTransfer?.types || [])];
            if (types.includes("application/x-minimax-ref-slot")) return;
            if (types.includes("application/x-minimax-fl2v-slot")) return;
            if (types.includes("application/x-minimax-fl2v-shot")) return;
            if (e.target.closest?.(".bd-ref, .bd-batch-ref, .bd-fl2v-slot, .bd-fl2v-shot")) return;
            const f = e.dataTransfer.files?.[0];
            if (f?.type.startsWith("video/")) this.loadVideoFile(f);
            else if (f?.type.startsWith("image/")) {
                if (this.isImageBatch?.() && e.target.closest?.(".bd-batch-ref")) return;
                if (this.isImageBatch?.()) return;
                this.addRefFromFile(f, this.getRefTarget());
            }
        });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        clearTimeout(this._syncTimer);
        clearTimeout(this._settleRenderTimer);
        clearTimeout(this._settleRenderLateTimer);
        this._settleRenderTimer = null;
        this._settleRenderLateTimer = null;
        cancelAnimationFrame(this._resizeRaf);
        cancelAnimationFrame(this._playRaf);
        this._resizeObserver?.disconnect();
        this._unsubLocale?.();
        this._unsubLocale = null;
        this._closeBdModal();
        for (const controller of this._promptMentionControllers || []) controller?.destroy?.();
        this._promptMentionControllers = [];
        for (const controller of this._batchPromptMentionControllers || []) controller?.destroy?.();
        this._batchPromptMentionControllers = [];
        this._r2vCommonPopover?.destroy?.();
        this._r2vCommonPopover = null;
        this.postprocessUi?.destroy?.();
        this.outputUi?.destroy?.();
        this.postprocessUi = null;
        this.outputUi = null;
        this._directorModalController?.destroy();
        this._directorModalController = null;
        this._directorModalOverlay = null;
        this._directorModalShell = null;
        this._directorModalContent = null;
        this._directorOverlayLayer = null;
        this._directorModalKeyHandler = null;
        this._directorModalOpen = false;
        this._previewVideo?.remove();
        this._previewVideo = null;
        window.removeEventListener("mousemove", this._onMouseMove);
        window.removeEventListener("mouseup", this._onMouseUp);
        this.canvas?.removeEventListener("mousemove", this._onCanvasHover);
        this.canvas?.classList.remove("bd-grab", "bd-grabbing");
        window.removeEventListener("keydown", this._onKeyDown, true);
        if (this.node?._minimaxEditor === this) this.node._minimaxEditor = null;
    }

    widget(name) { return this.node.widgets?.find((w) => w.name === name); }

    hasVideo() {
        const v = this.timeline?.video || {};
        return !!(this.getVideoClips().length || v.videoFile || this._legacyFrames.length || v.frames?.length);
    }

    getVideoClips() {
        if (this.timeline.videoClips?.length) return this.timeline.videoClips;
        const v = this.timeline?.video || {};
        if (v.videoFile || v.fileName) {
            return [{
                id: v.id || "c0",
                fileName: v.fileName || "",
                videoFile: v.videoFile || v.fileName || "",
                subfolder: v.subfolder || "",
                type: v.type || "input",
                width: v.width || 0,
                height: v.height || 0,
                duration: v.duration || 0,
                nativeFps: v.nativeFps || v.native_fps || 0,
                nativeFrameCount: v.nativeFrameCount || v.native_frame_count || 0,
                sourceFrameCount: v.sourceFrameCount || this.getFrameMap().length,
                storageWidth: v.storageWidth,
                storageHeight: v.storageHeight,
            }];
        }
        return [];
    }

    _ensureVideoClipsArray() {
        if (!this.timeline.videoClips?.length) {
            const v = this.timeline?.video || {};
            if (v.videoFile || v.fileName) {
                this.timeline.videoClips = [{
                    id: v.id || uid(),
                    fileName: v.fileName || "",
                    videoFile: v.videoFile || v.fileName || "",
                    subfolder: v.subfolder || "",
                    type: v.type || "input",
                    width: v.width || 0,
                    height: v.height || 0,
                    duration: v.duration || 0,
                    nativeFps: v.nativeFps || v.native_fps || 0,
                    nativeFrameCount: v.nativeFrameCount || v.native_frame_count || 0,
                    sourceFrameCount: v.sourceFrameCount || this.getFrameMap().length,
                    storageWidth: v.storageWidth,
                    storageHeight: v.storageHeight,
                }];
            } else {
                this.timeline.videoClips = [];
            }
        }
    }

    getClipViewUrl(clipIndex) {
        const clip = this.getVideoClips()[clipIndex];
        if (!clip?.videoFile) return "";
        return inputViewUrl(clip.videoFile, clip.type || "input");
    }

    getRefVideoTarget() {
        if (this.isGlobalMode()) {
            this.timeline.global = this.timeline.global || { refs: [], referenceVideo: {} };
            if (!this.timeline.global.referenceVideo) this.timeline.global.referenceVideo = {};
            return this.timeline.global;
        }
        const seg = this.timeline.segments[this.selectedIndex];
        if (seg) {
            if (!seg.referenceVideo) seg.referenceVideo = {};
            return seg;
        }
        this.timeline.global = this.timeline.global || { refs: [], referenceVideo: {} };
        return this.timeline.global;
    }

    getReferenceVideoViewUrl(ref) {
        const block = ref || {};
        const file = block.videoFile || block.fileName;
        if (!file) return "";
        return inputViewUrl(file, block.type || "input");
    }

    _stopRefVideoPreviews(onlyEls = null) {
        const targets = onlyEls || [this.globalRefVideo, this.segRefVideo];
        for (const el of targets) {
            const v = el?.querySelector("video");
            if (v) {
                v.pause();
                v.removeAttribute("src");
                v.load();
            }
        }
    }

    getTaskKey() {
        return resolveTaskKey(
            this.globalTask?.value
            || this.timeline.global?.taskType
            || this.taskTypeWidget?.value,
        );
    }

    getRunnableSegmentCount() {
        if (this.isMixedMode()) return this._ensureMixedTimeline().segments?.length || 0;
        if (this.isFl2vMode()) return fl2vStartIndices(this).length;
        return this.timeline.segments?.length || 0;
    }

    hasH3ReferenceVideoConditioning(taskKey = this.getTaskKey()) {
        if (taskKey !== "r2v") return false;
        const hasFile = (item) => !!(item?.videoFile || item?.fileName);
        if (hasFile(this.timeline.global?.referenceVideo)) return true;
        if ((this.timeline.global?.refVideos || []).some(hasFile)) return true;
        return (this.timeline.segments || []).some((segment) => (
            hasFile(segment?.referenceVideo)
            || (segment?.refVideos || []).some(hasFile)
        ));
    }

    updateGenerationRowOrder(taskKey = this.getTaskKey()) {
        const { stageEl, outputBarEl, controlsBar, splitEditBarEl, viewport } = this;
        if (!stageEl || !outputBarEl || !controlsBar || !splitEditBarEl || !viewport) return;

        const swapOutputAndSourceControls = ["fl2v", "r2v", "v2v", "rv2v"].includes(taskKey);
        this.mainBody.classList.toggle("bd-output-before-timeline", swapOutputAndSourceControls);
        if (swapOutputAndSourceControls) {
            // Swap only the two requested regions while preserving everything between them.
            // stage -> output parameters -> split tools -> timeline -> source player controls
            stageEl.after(outputBarEl);
            outputBarEl.after(splitEditBarEl);
            splitEditBarEl.after(viewport);
            viewport.after(controlsBar);
            return;
        }

        // Restore the original Generation order for T2V / I2V and other modes.
        stageEl.after(controlsBar);
        controlsBar.after(splitEditBarEl);
        splitEditBarEl.after(viewport);
        viewport.after(outputBarEl);
    }

    getH3SpatialStride() {
        const taskKey = this.getTaskKey();
        return resolveH3SpatialStride({
            taskKey,
            segmentCount: this.getRunnableSegmentCount(),
            motionContextEnabled: this.widget("motion_context_enabled")?.value,
            sourceBridgeValue: this.widget("source_overlap_frames")?.value,
            hasReferenceVideo: this.hasH3ReferenceVideoConditioning(taskKey),
        });
    }

    supportsRunSelect() {
        if (this.isMixedMode()) return this.getRunnableSegmentCount() >= 2;
        const n = this.getRunnableSegmentCount();
        if (n < 2) return false;
        const mode = this.getDirectorMode();
        if (mode === "video") return true;
        if (mode === "fl2v") return true;
        if (this.isImageBatch()) return isPromptBatchTask(this.getTaskKey());
        return false;
    }

    getRunProgressSegmentTotal() {
        if (this.isMixedMode()) {
            const state = this._normalizeMixedRunSelection();
            const n = state.segments?.length || 0;
            if (!state.runSelectEnabled || n < 2) return Math.max(n, 1);
            return state.runSelection?.length || Math.max(n, 1);
        }
        const n = this.getRunnableSegmentCount();
        if (!this.isRunSelectEnabled() || n < 2) return Math.max(n, 1);
        const count = (this.timeline.runSelection || []).length;
        return count > 0 ? count : Math.max(n, 1);
    }

    isRunSelectEnabled() {
        if (this.isMixedMode()) return !!this._ensureMixedTimeline().runSelectEnabled;
        return !!this.timeline.runSelectEnabled;
    }

    normalizeRunSelection() {
        if (this.isMixedMode()) { this._normalizeMixedRunSelection(); return; }
        if (!this.isRunSelectEnabled()) return;
        if (this.isFl2vMode()) {
            const valid = new Set(fl2vStartIndices(this));
            this.timeline.runSelection = [...new Set(
                (this.timeline.runSelection || []).filter((i) => valid.has(i)),
            )].sort((a, b) => a - b);
            return;
        }
        const n = this.getRunnableSegmentCount();
        if (n < 1) return;
        this.timeline.runSelection = [...new Set(
            (this.timeline.runSelection || []).filter((i) => i >= 0 && i < n),
        )].sort((a, b) => a - b);
    }

    isSegmentRunEnabled(index) {
        if (this.isMixedMode()) {
            const state = this._normalizeMixedRunSelection();
            return !state.runSelectEnabled || (state.runSelection || []).includes(Number(index));
        }
        if (!this.isRunSelectEnabled()) return true;
        return (this.timeline.runSelection || []).includes(index);
    }

    toggleSegmentRun(index) {
        if (!this.isRunSelectEnabled()) return;
        if (this.isFl2vMode()) {
            if (!this.timeline.segments?.[index]?.isStartFrame) return;
        } else {
            const n = this.getRunnableSegmentCount();
            if (index < 0 || index >= n) return;
        }
        this.commitRunSelectionMutation(() => {
            const sel = new Set(this.timeline.runSelection || []);
            if (sel.has(index)) sel.delete(index);
            else sel.add(index);
            this.timeline.runSelection = [...sel].sort((a, b) => a - b);
        });
    }

    toggleRunSelectMode() {
        if (!this.supportsRunSelect()) return;
        this.commitRunSelectionMutation(() => {
            this.timeline.runSelectEnabled = !this.timeline.runSelectEnabled;
            if (this.timeline.runSelectEnabled) {
                if (!(this.timeline.runSelection || []).length) {
                    if (this.isFl2vMode()) {
                        this.timeline.runSelection = fl2vStartIndices(this);
                    } else {
                        const n = this.getRunnableSegmentCount();
                        this.timeline.runSelection = Array.from({ length: n }, (_, i) => i);
                    }
                } else {
                    this.normalizeRunSelection();
                }
            }
        });
    }

    setRunSelectionAll(on) {
        if (!this.isRunSelectEnabled()) return;
        if (this.isFl2vMode()) {
            this.commitRunSelectionMutation(() => {
                this.timeline.runSelection = on ? fl2vStartIndices(this) : [];
            });
            return;
        }
        const n = this.getRunnableSegmentCount();
        this.commitRunSelectionMutation(() => {
            this.timeline.runSelection = on ? Array.from({ length: n }, (_, i) => i) : [];
        });
    }

    commitRunSelectionMutation(mutation, { refresh = true } = {}) {
        commitRunSelectionMutationNow(this, mutation);
        if (!refresh) return;
        this.updateRunSelectUI();
        if (this.isImageBatch()) this.renderImageBatchGroups();
        else this.scheduleRender();
    }

    commitSegmentStructureMutation(skipRender = false) {
        if (this.isRunSelectEnabled()) {
            this.syncFromWidgets();
            this.normalizeSegments();
            this.commitRunSelectionMutation(null, { refresh: false });
            this.commit(skipRender, { syncTimeline: false });
            return;
        }
        this.commit(skipRender, { syncTimeline: true });
    }

    ensureRunSelectionSerialized() {
        ensureRunSelectionSerialized(this);
    }

    updateRunSelectUI() {
        if (this.isMixedMode()) {
            this.btnRunSelectToggle?.classList.add("hidden");
            if (this.runSelectBar) this.runSelectBar.hidden = true;
            return;
        }
        const n = this.getRunnableSegmentCount();
        const canRunSelect = this.supportsRunSelect();
        const enabled = this.isRunSelectEnabled() && canRunSelect;
        // r2v uses timeline checkboxes (fl2v-style); other batch tasks use the card bar.
        const useBatchBar = this.isImageBatch() && canRunSelect && !this.isR2vBatch();
        this.btnRunSelectToggle?.classList.toggle("active", enabled);
        this.btnRunSelectToggle?.classList.toggle("bd-btn-run-select", true);
        this.btnRunSelectToggle?.classList.toggle("hidden", !canRunSelect || useBatchBar);
        this.batchRunSelectBtn?.classList.toggle("active", enabled);
        this.batchRunSelectBtn?.classList.toggle("hidden", !useBatchBar);
        this.runSelectAllWrap?.classList.toggle("hidden", !enabled || useBatchBar);
        this.batchRunSelectAllWrap?.classList.toggle("hidden", !enabled || !useBatchBar);
        // Keep the chip hidden while a run is active — otherwise commit/sync
        // re-shows it on top of the green progress title.
        const running = !!this.runStatusEl?.classList.contains("active");
        this.runSelectBar?.classList.toggle("hidden", !enabled || running);
        if (!canRunSelect) return;
        this.normalizeRunSelection();
        const count = (this.timeline.runSelection || []).length;
        const syncAllCb = (cb) => {
            if (!cb) return;
            cb.checked = count >= n && n > 0;
            cb.indeterminate = count > 0 && count < n;
        };
        syncAllCb(this.runSelectAllCb);
        syncAllCb(this.batchRunSelectAllCb);
        const label = t(this.isImageBatch() ? "unit.group" : "unit.segment");
        if (!this.runSelectSummary) return;
        if (!count) {
            this.runSelectSummary.textContent = t("runSelect.noneChecked", { unit: label });
            this.runSelectSummary.style.color = "#f88";
        } else if (count >= n) {
            this.runSelectSummary.textContent = t("runSelect.all", { n, unit: label });
            this.runSelectSummary.style.color = "#aaa";
        } else {
            const nums = (this.timeline.runSelection || []).map((i) => i + 1).join(", ");
            const exportHint = this.timeline.output?.exportMode === "segments"
                ? t("runSelect.exportOnlyChecked")
                : t("runSelect.fillUnchecked");
            this.runSelectSummary.textContent = count === 1
                ? t("runSelect.sampleOne", { unit: label, nums, hint: exportHint })
                : t("runSelect.sampleMany", { count, unit: label, nums, hint: exportHint });
            this.runSelectSummary.style.color = "#4fff8f";
        }
    }

    /** Drop live run-select flags (mode switch). Stashed workspaces keep their own copy. */
    _clearLiveRunSelection() {
        this.timeline.runSelectEnabled = false;
        this.timeline.runSelection = [];
    }

    _runSelectionPayload() {
        // Never leak video-mode「选择运行」into i2v/batch (or vice versa).
        if (!this.supportsRunSelect() || !this.timeline.runSelectEnabled) {
            return { runSelectEnabled: false, runSelection: [] };
        }
        this.normalizeRunSelection();
        return {
            runSelectEnabled: true,
            runSelection: [...(this.timeline.runSelection || [])],
        };
    }

    isMixedMode() {
        return this.getDirectorMode() === "mixed";
    }

    _cloneMixedValue(value) {
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
        state.output = state.output || {};
        const output = state.output;
        const initialWidth = Math.max(32, Number(output.width ?? state.width ?? 864) || 864);
        const initialHeight = Math.max(32, Number(output.height ?? state.height ?? 480) || 480);

        output.mode = "fixed";
        output.multiple = output.multiple ?? MINIMAX_CANVAS_MULTIPLE;
        if (!output.aspectRatio) {
            const match = RESOLUTION_ASPECTS.find(([, aw, ah]) => (
                Math.abs(initialWidth / initialHeight - aw / ah) < 0.02
            ));
            output.aspectRatio = match ? match[0] : CUSTOM_ASPECT_RATIO;
        } else {
            output.aspectRatio = isCustomAspectRatio(output.aspectRatio)
                ? CUSTOM_ASPECT_RATIO
                : normalizeAspectRatioLabel(output.aspectRatio);
        }
        if (output.megapixels == null) {
            const inferred = Math.round((initialWidth * initialHeight / (1024 * 1024)) * 10) / 10;
            output.megapixels = clampMegapixels(inferred || DEFAULT_MEGAPIXELS);
        } else {
            output.megapixels = clampMegapixels(output.megapixels);
        }

        if (isCustomAspectRatio(output.aspectRatio)) {
            output.width = snapResolutionDim(initialWidth, output.multiple);
            output.height = snapResolutionDim(initialHeight, output.multiple);
        } else {
            const resolved = resolutionFromSelector(
                output.aspectRatio,
                output.megapixels,
                output.multiple,
            );
            output.width = resolved?.width ?? snapResolutionDim(initialWidth, output.multiple);
            output.height = resolved?.height ?? snapResolutionDim(initialHeight, output.multiple);
            if (resolved) {
                output.aspectRatio = resolved.aspectRatio;
                output.megapixels = resolved.megapixels;
                output.multiple = resolved.multiple;
            }
        }
        output.longEdge = Math.max(output.width, output.height);
        state.width = output.width;
        state.height = output.height;
        state.refMaxSize = output.longEdge;

        const setWidget = (name, value) => {
            const widget = this.widget?.(name) || this.node?.widgets?.find?.((item) => item?.name === name);
            if (widget && value != null) widget.value = value;
        };
        setWidget("frame_rate", state.frameRate ?? 24);
        setWidget("width", output.width);
        setWidget("height", output.height);
        setWidget("ref_max_size", output.longEdge);
        if (this.fpsInput) this.fpsInput.value = String(state.frameRate ?? 24);
        if (this.outAspect) this.outAspect.value = output.aspectRatio;
        if (this.outMp) this.outMp.value = String(output.megapixels);
        if (this.outW) this.outW.value = String(output.width);
        if (this.outH) this.outH.value = String(output.height);
        if (this.outLong) this.outLong.value = String(output.longEdge);
        if (this.outMode) this.outMode.value = "fixed";
        if (this.outExportMode && output.exportMode) this.outExportMode.value = output.exportMode;
        if (this.outMaxFrames) this.outMaxFrames.value = String(output.maxExportFrames ?? 0);
        if (this.outAudioMode) this.outAudioMode.value = "generate";
        this.updateOutputModeUI?.();
        this.updateOutputPreview?.();
    }

    _setMixedBodiesActive(active) {
        const host = this._mixedPanelHost;
        const parent = this.mainBody || this.root?.querySelector?.(".bd-main");
        if (active && parent && this.outputBarEl?.parentElement === parent) {
            // Keep exactly the same vertical hierarchy as standalone Director:
            // mode toolbar -> output controls -> active mode body.
            parent.insertBefore(this.outputBarEl, parent.firstChild);
            if (host?.parentElement === parent) this.outputBarEl.after(host);
        }
        for (const child of Array.from(this.mainBody?.children || [])) {
            if (child === host || child === this.outputBarEl) continue;
            child.classList?.toggle("hidden", !!active);
        }
        for (const element of this.root?.querySelectorAll?.(
            ".bd-actions, .bd-smart-split-msg, .bd-external-groups-msg",
        ) || []) {
            element.classList?.toggle("hidden", !!active);
        }
        // Legacy prompt/reference panels are nested in some standalone modes,
        // so direct-child isolation alone is insufficient.
        for (const element of [this.globalPanel, this.segmentPanel]) {
            element?.classList?.toggle("hidden", !!active);
        }
        const continuity = this.segmentContinuityWrap
            || this.root?.querySelector?.('[data-r="segment-continuity-wrap"]');
        const common = this.r2vCommonToggle
            || this.root?.querySelector?.('[data-a="r2v-common-toggle"]');
        const audio = this.outAudioWrap
            || this.root?.querySelector?.('[data-r="out-audio-wrap"]');
        continuity?.classList?.toggle("hidden", !!active);
        common?.classList?.toggle("hidden", !!active);
        audio?.classList?.toggle("hidden", !!active);
        this.outputBarEl?.classList?.remove("hidden");
        this._mixedPanelHost?.classList?.toggle("hidden", !active);
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
        if (this.outputBarEl?.parentElement === parent) {
            // Match the standalone Director hierarchy: toolbar -> output -> body.
            parent.insertBefore(this.outputBarEl, parent.firstChild);
            this.outputBarEl.after(host);
        } else {
            parent.appendChild(host);
        }
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
                    // Mixed segment count controls which global continuity tuning
                    // widgets are visible on the outer Director node. Refresh it
                    // immediately when segments are added/removed or continuity
                    // state changes instead of waiting for another task switch.
                    refreshDirectorContinuityUi(this.node, this);
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

    getDirectorMode() {
        return getDirectorMode(this.globalTask?.value || this.taskTypeWidget?.value);
    }

    isGenMode() {
        const mode = this.getDirectorMode();
        return mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v" && mode !== "mixed";
    }

    isImageBatch() {
        const mode = this.getDirectorMode();
        return mode === "prompt_batch" || mode === "image_batch";
    }

    isGenBlank() {
        return this.getDirectorMode() === "gen_blank";
    }

    isGenImage() {
        return this.getDirectorMode() === "gen_image";
    }

    isFl2vMode() {
        return this.getDirectorMode() === "fl2v";
    }

    isR2vBatch() {
        return this.isImageBatch() && this.getTaskKey() === "r2v";
    }

    _syncR2vCardSelection() {
        if (!this.isImageBatch() || !this.batchList) return;
        const runSelectOn = this.isRunSelectEnabled() && this.supportsRunSelect();
        const focusSel = this.isR2vBatch();
        const cards = this.batchList.querySelectorAll(".bd-batch-card");
        cards.forEach((el, i) => {
            const runOn = !runSelectOn || this.isSegmentRunEnabled(i);
            // t2v/i2v: no focus "selected" border — only run-on/run-skipped when 选择运行.
            el.classList.toggle("selected", focusSel && i === this.selectedIndex);
            el.classList.toggle("run-on", runSelectOn && runOn);
            el.classList.toggle("run-skipped", runSelectOn && !runOn);
            const cb = el.querySelector(".bd-batch-run-check");
            if (cb) cb.checked = runOn;
        });
    }

    onTaskTypeChanged(value) {
        this.onGlobalField("taskType", value);
    }

    /** Snapshot v2v/rv2v workspace before switching to t2i / batch / gen modes. */
    _stashVideoWorkspace() {
        const video = this.timeline.video || {};
        const clips = this.timeline.videoClips || [];
        const hasVid = !!(
            clips.length
            || video.videoFile
            || video.fileName
            || this._legacyFrames?.length
            || video.frames?.length
        );
        const segs = this.timeline.segments || [];
        if (!hasVid && !segs.length) return;

        this.timeline.videoWorkspace = {
            segments: JSON.parse(JSON.stringify(segs)),
            selectedIndex: this.selectedIndex,
            currentFrame: this.currentFrame,
            editMode: this.timeline.editMode || "global",
            runSelectEnabled: !!this.timeline.runSelectEnabled,
            runSelection: Array.isArray(this.timeline.runSelection)
                ? [...this.timeline.runSelection]
                : undefined,
            video: JSON.parse(JSON.stringify(video)),
            videoClips: JSON.parse(JSON.stringify(clips)),
            totalFrames: this.timeline.totalFrames ?? this.getTotalFrames(),
            frameRate: this.timeline.frameRate ?? this.getFrameRate(),
            legacyFrames: this._legacyFrames?.length ? [...this._legacyFrames] : [],
            storageWidth: this._storageWidth || 0,
            storageHeight: this._storageHeight || 0,
        };
    }

    /** Restore v2v/rv2v workspace after returning from t2i / batch / gen. */
    _restoreVideoWorkspace() {
        const ws = this.timeline.videoWorkspace;
        if (!ws || typeof ws !== "object") {
            this.normalizeSegments();
            this.restoreVideoFromTimeline();
            this.updateStageVisibility();
            return false;
        }

        if (ws.video && typeof ws.video === "object") {
            this.timeline.video = JSON.parse(JSON.stringify(ws.video));
        }
        if (Array.isArray(ws.videoClips)) {
            this.timeline.videoClips = JSON.parse(JSON.stringify(ws.videoClips));
        }
        if (Array.isArray(ws.segments) && ws.segments.length) {
            this.timeline.segments = JSON.parse(JSON.stringify(ws.segments));
        }
        if (ws.totalFrames != null) this.timeline.totalFrames = ws.totalFrames;
        if (ws.frameRate != null) this.timeline.frameRate = ws.frameRate;
        if (ws.editMode) this.timeline.editMode = ws.editMode;
        if (ws.runSelectEnabled != null) this.timeline.runSelectEnabled = !!ws.runSelectEnabled;
        if (Array.isArray(ws.runSelection)) this.timeline.runSelection = [...ws.runSelection];

        this.selectedIndex = clamp(
            ws.selectedIndex ?? 0,
            0,
            Math.max(0, (this.timeline.segments?.length || 1) - 1),
        );
        this.currentFrame = Math.max(0, ws.currentFrame ?? 0);
        if (Array.isArray(ws.legacyFrames) && ws.legacyFrames.length) {
            this._legacyFrames = [...ws.legacyFrames];
        }
        if (ws.storageWidth) this._storageWidth = ws.storageWidth;
        if (ws.storageHeight) this._storageHeight = ws.storageHeight;

        this.normalizeSegments();
        this.restoreVideoFromTimeline();
        const total = this.getTotalFrames();
        this.currentFrame = clamp(this.currentFrame, 0, Math.max(0, total - 1));
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, total - 1);
            this.seekBar.value = this.currentFrame;
        }
        if (this.totalFramesWidget) this.totalFramesWidget.value = total;
        this.updateVideoNameLabel();
        this.updateStageVisibility();
        // Live state is now in timeline.*; drop the snapshot so later edits
        // cannot be overwritten by a stale workspace on the next mode switch.
        this.timeline.videoWorkspace = null;
        return true;
    }

    /** Snapshot prompt-batch (r2v/r2i/…) groups before switching to video / gen. */
    _stashBatchWorkspace() {
        const segs = this.timeline.segments || [];
        if (!segs.length) return;
        // Only stash when current segments look like batch groups (have prompt/refs/fc).
        this.timeline.batchWorkspace = {
            segments: JSON.parse(JSON.stringify(segs)),
            selectedIndex: this.selectedIndex,
            editMode: this.timeline.editMode || "segment",
            runSelectEnabled: !!this.timeline.runSelectEnabled,
            runSelection: Array.isArray(this.timeline.runSelection)
                ? [...this.timeline.runSelection]
                : undefined,
            output: this.timeline.output
                ? JSON.parse(JSON.stringify(this.timeline.output))
                : undefined,
        };
    }

    /** Restore prompt-batch groups after returning from rv2v / video / gen. */
    _restoreBatchWorkspace() {
        const ws = this.timeline.batchWorkspace;
        if (!ws || typeof ws !== "object" || !Array.isArray(ws.segments) || !ws.segments.length) {
            return false;
        }
        this.timeline.segments = JSON.parse(JSON.stringify(ws.segments));
        if (ws.editMode) this.timeline.editMode = ws.editMode;
        if (ws.runSelectEnabled != null) this.timeline.runSelectEnabled = !!ws.runSelectEnabled;
        if (Array.isArray(ws.runSelection)) this.timeline.runSelection = [...ws.runSelection];
        if (ws.output && typeof ws.output === "object") {
            this.timeline.output = { ...(this.timeline.output || {}), ...JSON.parse(JSON.stringify(ws.output)) };
        }
        this.selectedIndex = clamp(
            ws.selectedIndex ?? 0,
            0,
            Math.max(0, this.timeline.segments.length - 1),
        );
        // Drop snapshot after restore so later batch edits are not clobbered by a stale stash.
        this.timeline.batchWorkspace = null;
        return true;
    }

    _stashBatchTaskWorkspace(taskKey) {
        const key = resolveTaskKey(taskKey);
        stashBatchTaskWorkspace(this.timeline, key, {
            segments: JSON.parse(JSON.stringify(this.timeline.segments)),
            selectedIndex: this.selectedIndex,
            runSelectEnabled: !!this.timeline.runSelectEnabled,
            runSelection: [...(this.timeline.runSelection || [])],
        });
    }

    _restoreBatchTaskWorkspace(taskKey) {
        const key = resolveTaskKey(taskKey);
        const workspace = restoreBatchTaskWorkspace(this.timeline, key);
        if (!workspace) return false;
        this.timeline.segments = workspace.segments;
        this.selectedIndex = clamp(workspace.selectedIndex || 0, 0, this.timeline.segments.length - 1);
        this.timeline.runSelectEnabled = !!workspace.runSelectEnabled;
        this.timeline.runSelection = [...(workspace.runSelection || [])];
        return true;
    }

    ensureGenTimeline() {
        const key = this.getTaskKey();
        this.timeline.gen = this.timeline.gen || {};
        const defFc = defaultFrameCount(key);
        if (!this.timeline.segments?.length || !sumFrameCounts(this.timeline.segments)) {
            this.timeline.segments = [{
                id: uid(), start: 0, length: defFc, frameCount: defFc,
                prompt: "", taskType: "", refs: [], genImage: { imageFile: "" },
            }];
        }
        for (const seg of this.timeline.segments) {
            if (seg.frameCount == null) seg.frameCount = seg.length ?? defFc;
            seg.genImage = seg.genImage || { imageFile: seg.imageFile || "" };
        }
        this.timeline.global = this.timeline.global || { refs: [] };
        this.timeline.global.genImage = this.timeline.global.genImage || { imageFile: "" };
        if (this.isGenBlank()) {
            this.timeline.output = this.timeline.output || {};
            this.timeline.output.mode = "fixed";
        }
        this.normalizeGenSegments();
    }

    normalizeGenSegments() {
        const key = this.getTaskKey();
        const minFc = minFrameCount(key);
        let start = 0;
        const fixed = [];
        for (const seg of [...this.timeline.segments]) {
            let fc = clamp(parseInt(seg.frameCount ?? seg.length, 10) || defaultFrameCount(key), minFc, MAX_GEN_FRAMES);
            fixed.push({
                ...seg,
                start,
                length: fc,
                frameCount: fc,
                refs: seg.refs || [],
                genImage: seg.genImage || { imageFile: "" },
            });
            start += fc;
        }
        if (!fixed.length) {
            const fc = defaultFrameCount(key);
            fixed.push({
                id: uid(), start: 0, length: fc, frameCount: fc,
                prompt: "", taskType: "", refs: [], genImage: { imageFile: "" },
            });
        }
        this.timeline.segments = fixed;
        this.timeline.totalFrames = start || fixed[0].frameCount;
        this.selectedIndex = clamp(this.selectedIndex, 0, fixed.length - 1);
    }

    /** rv2v (and video-timeline tasks with refs) use the polished r2v-like asset stage. */
    usesRv2vRefStyle(taskKey = this.getTaskKey()) {
        const key = resolveTaskKey(taskKey);
        return key === "rv2v" || key === "vrc2v" || key === "vi2v";
    }

    /** v2v prompt-only video edit — full-width polished prompt stage. */
    usesV2vPromptStyle(taskKey = this.getTaskKey()) {
        const key = resolveTaskKey(taskKey);
        return key === "v2v" || key === "mv2v";
    }

    syncRv2vRefLayoutClasses({ hideTimeline = false, seg = null } = {}) {
        const globalKey = this.getTaskKey();
        const segKey = resolveTaskKey(
            seg?.taskType || this.timeline.global?.taskType || this.globalTask?.value || globalKey,
        );
        const globalRefStyle = !hideTimeline && this.usesRv2vRefStyle(globalKey);
        const segRefStyle = !hideTimeline && this.usesRv2vRefStyle(segKey);
        const globalV2vStyle = !hideTimeline && this.usesV2vPromptStyle(globalKey);
        const segV2vStyle = !hideTimeline && this.usesV2vPromptStyle(segKey);

        this.globalPanel?.classList.toggle("bd-rv2v-panel", globalRefStyle);
        this.segmentPanel?.classList.toggle("bd-rv2v-panel", segRefStyle);
        this.globalPanel?.classList.toggle("bd-v2v-panel", globalV2vStyle);
        this.segmentPanel?.classList.toggle("bd-v2v-panel", segV2vStyle);

        this.globalPromptLayout?.classList.toggle("bd-rv2v-layout", globalRefStyle);
        this.segPromptLayout?.classList.toggle("bd-rv2v-layout", segRefStyle);
        this.globalPromptLayout?.classList.toggle("bd-v2v-layout", globalV2vStyle);
        this.segPromptLayout?.classList.toggle("bd-v2v-layout", segV2vStyle);

        for (const wrap of [this.globalRefsImagesWrap, this.globalRefAudiosWrap]) {
            wrap?.classList.toggle("bd-r2v-section", globalRefStyle);
        }
        for (const wrap of [this.segRefsImagesWrap, this.segRefAudiosWrap]) {
            wrap?.classList.toggle("bd-r2v-section", segRefStyle);
        }
        const gLabel = this.root.querySelector('[data-r="global-refs-label"]');
        if (gLabel) {
            const key = globalRefStyle ? "batch.r2v.sectionPictures" : "panel.refImages";
            gLabel.textContent = t(key);
            gLabel.setAttribute("data-i18n", key);
        }
        const sLabel = this.root.querySelector('[data-r="seg-refs-label"]');
        if (sLabel) {
            const key = segRefStyle ? "batch.r2v.sectionPictures" : "panel.segmentRefImages";
            sLabel.textContent = t(key);
            sLabel.setAttribute("data-i18n", key);
        }
    }

    updateReferenceImageVisibility({ hideTimeline = false, seg = null } = {}) {
        const globalKey = this.getTaskKey();
        const showGlobalRefs = !hideTimeline && taskUsesReferenceImages(globalKey);
        const showGlobalRefAudios = !hideTimeline && taskUsesReferenceAudios(globalKey);
        const showGlobalRefVideo = !hideTimeline && taskUsesReferenceVideo(globalKey);

        this.globalRefsCol?.classList.toggle(
            "hidden",
            !showGlobalRefs && !showGlobalRefVideo && !showGlobalRefAudios,
        );
        this.globalRefsImagesWrap?.classList.toggle("hidden", !showGlobalRefs);
        this.globalRefAudiosWrap?.classList.toggle("hidden", !showGlobalRefAudios);
        this.globalRefVideoCol?.classList.toggle("hidden", !showGlobalRefVideo);
        if (this.globalPanelTitle) {
            let titleKey = "panel.globalPromptOnly";
            if (showGlobalRefVideo) titleKey = "panel.globalPromptAndRefVideo";
            else if (showGlobalRefs || showGlobalRefAudios) {
                titleKey = showGlobalRefAudios
                    ? "panel.globalPromptAndRefsMedia"
                    : "panel.globalPromptAndRefs";
            }
            this.globalPanelTitle.textContent = t(titleKey);
            this.globalPanelTitle.setAttribute("data-i18n", titleKey);
        }

        const segKey = resolveTaskKey(
            seg?.taskType || this.timeline.global?.taskType || this.globalTask?.value || globalKey,
        );
        const showSegRefs = !hideTimeline && taskUsesReferenceImages(segKey);
        const showSegRefAudios = !hideTimeline && taskUsesReferenceAudios(segKey);
        const showSegRefVideo = !hideTimeline && taskUsesReferenceVideo(segKey);
        this.segRefsCol?.classList.toggle(
            "hidden",
            !showSegRefs && !showSegRefVideo && !showSegRefAudios,
        );
        this.segRefsImagesWrap?.classList.toggle("hidden", !showSegRefs);
        this.segRefAudiosWrap?.classList.toggle("hidden", !showSegRefAudios);
        this.segRefVideoCol?.classList.toggle("hidden", !showSegRefVideo);
        const showContinuousRef = !hideTimeline
            && this.isGlobalMode()
            && showGlobalRefVideo
            && globalKey === "ads2v";
        this.continuousRefWrap?.classList.toggle("hidden", !showContinuousRef);
        if (this.continuousRefCb) {
            this.continuousRefCb.checked = !!this.timeline.global?.continuousReference;
        }
        this.syncRv2vRefLayoutClasses({ hideTimeline, seg });
        if (showGlobalRefVideo || showSegRefVideo) this.renderRefVideoSlot();
        if (showGlobalRefAudios || showSegRefAudios) this.renderRefAudioSlots();
    }

    _stashFl2vWorkspace() {
        const shots = this.timeline.shots || [];
        const segs = this.timeline.segments || [];
        const keys = this.timeline.keyframes || [];
        if (!shots.length && !segs.length && !keys.length) return;
        this.timeline.fl2vWorkspace = {
            shots: JSON.parse(JSON.stringify(shots)),
            segments: JSON.parse(JSON.stringify(segs)),
            keyframes: JSON.parse(JSON.stringify(keys)),
            durationSec: this.timeline.durationSec,
            totalFrames: this.timeline.totalFrames,
            selectedIndex: this.selectedIndex,
            runSelectEnabled: !!this.timeline.runSelectEnabled,
            runSelection: Array.isArray(this.timeline.runSelection)
                ? [...this.timeline.runSelection]
                : [],
            output: this.timeline.output
                ? JSON.parse(JSON.stringify(this.timeline.output))
                : undefined,
        };
    }

    _restoreFl2vWorkspace() {
        const ws = this.timeline.fl2vWorkspace;
        if (!ws) return false;
        const hasShots = Array.isArray(ws.shots) && ws.shots.length;
        const hasSegs = Array.isArray(ws.segments) && ws.segments.length;
        const hasKeys = Array.isArray(ws.keyframes) && ws.keyframes.length;
        if (!hasShots && !hasSegs && !hasKeys) return false;
        if (hasShots) this.timeline.shots = JSON.parse(JSON.stringify(ws.shots));
        if (hasSegs) this.timeline.segments = JSON.parse(JSON.stringify(ws.segments));
        if (hasKeys) this.timeline.keyframes = JSON.parse(JSON.stringify(ws.keyframes));
        if (ws.durationSec != null) this.timeline.durationSec = ws.durationSec;
        if (ws.totalFrames != null) this.timeline.totalFrames = ws.totalFrames;
        if (ws.selectedIndex != null) this.selectedIndex = ws.selectedIndex;
        if (ws.runSelectEnabled != null) this.timeline.runSelectEnabled = !!ws.runSelectEnabled;
        if (Array.isArray(ws.runSelection)) this.timeline.runSelection = [...ws.runSelection];
        if (ws.output && typeof ws.output === "object") {
            this.timeline.output = { ...(this.timeline.output || {}), ...JSON.parse(JSON.stringify(ws.output)) };
        }
        this.timeline.fl2vWorkspace = null;
        return true;
    }

    applyTaskLayout(prevMode) {
        const mode = this.getDirectorMode();
        if (mode === "mixed") {
            this._enterMixedNative(prevMode || this._directorMode);
            this._directorMode = "mixed";
            this.updateDomWidgetHeight?.();
            return;
        }
        if (prevMode === "mixed" || this._directorMode === "mixed") {
            this._leaveMixedNative();
            prevMode = this._standaloneDirectorMode || "video";
        }
        const prev = prevMode || "video";
        const wasBatch = prev === "prompt_batch" || prev === "image_batch";
        const isBatch = mode === "prompt_batch";
        const wasFl2v = prev === "fl2v";
        const isFl2v = mode === "fl2v";
        const wasGen = prev !== "video" && prev !== "prompt_batch" && prev !== "image_batch" && prev !== "fl2v";
        const isGen = mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v";

        if (this.isPlaying) this._stopPlay();

        if (isFl2v) {
            if (prev === "video") {
                this._stashVideoWorkspace();
                this._clearLiveRunSelection();
            } else if (wasBatch) {
                this._stashBatchWorkspace();
                this._clearLiveRunSelection();
            }
            if (!this._restoreFl2vWorkspace()) {
                ensureFl2vTimeline(this);
                this._clearLiveRunSelection();
            } else {
                ensureFl2vTimeline(this);
            }
        } else if (isBatch) {
            if (!wasBatch) {
                if (wasFl2v) {
                    this._stashFl2vWorkspace();
                    this._clearLiveRunSelection();
                }
                // Keep v2v/rv2v video + segments so switching back can restore them.
                // Run-select is per workspace: stash video's, then clear live so i2v/batch
                // does not inherit「选择运行」from rv2v.
                if (prev === "video") {
                    this._stashVideoWorkspace();
                    this._clearLiveRunSelection();
                }
                // Prefer restoring the previous r2v/r2i/i2v batch (prompts + its own run-select).
                if (!this._restoreBatchWorkspace()) {
                    const keep = this.timeline.global?.prompt
                        || this.timeline.segments?.[0]?.prompt
                        || "";
                    const keepRefs = Array.isArray(this.timeline.global?.refs) && this.timeline.global.refs.length
                        ? JSON.parse(JSON.stringify(this.timeline.global.refs))
                        : [];
                    this.timeline.segments = [newBatchSegment({
                        prompt: keep,
                        negativePrompt: this.negativePromptWidget?.value || "bad video",
                        refs: keepRefs,
                    })];
                    this._clearLiveRunSelection();
                }
            }
            ensureImageBatchTimeline(this);
        } else if (isGen) {
            if (wasBatch) {
                this._stashBatchWorkspace();
                this._clearLiveRunSelection();
            }
            if (wasFl2v) {
                this._stashFl2vWorkspace();
                this._clearLiveRunSelection();
            }
            if (!wasGen && !wasBatch && !wasFl2v) {
                if (prev === "video") {
                    this._stashVideoWorkspace();
                    this._clearLiveRunSelection();
                }
                const key = this.getTaskKey();
                const defFc = defaultFrameCount(key);
                const keepPrompt = this.timeline.global?.prompt || "";
                this.timeline.segments = [{
                    id: uid(),
                    start: 0,
                    length: defFc,
                    frameCount: defFc,
                    prompt: keepPrompt,
                    taskType: "",
                    refs: [],
                    genImage: { imageFile: "" },
                }];
            }
            this.ensureGenTimeline();
        } else if (prev !== "video") {
            // Leaving batch/gen/fl2v for video — stash before video restore.
            if (wasBatch) {
                this._stashBatchWorkspace();
                this._clearLiveRunSelection();
            }
            if (wasFl2v) {
                this._stashFl2vWorkspace();
                this._clearLiveRunSelection();
            }
            this.timeline.timelineMode = "video";
            // Prefer restoring the stashed v2v/rv2v session (segments + thumbs + run-select).
            if (!this._restoreVideoWorkspace()) {
                this.normalizeSegments();
                this._clearLiveRunSelection();
            }
        }
        this.timeline.timelineMode = mode;
        this._directorMode = mode;
        this._standaloneDirectorMode = mode;

        const taskKey = this.getTaskKey();
        const isR2v = isBatch && taskKey === "r2v";
        syncR2vCommonToggleForTask(this.r2vCommonToggle, {
            taskKey,
            expanded: !!this._r2vCommonPopover?.isOpen,
            label: t("batch.r2v.commonReferences"),
            expandTitle: t("tooltip.r2vCommonExpand"),
            collapseTitle: t("tooltip.r2vCommonCollapse"),
        });
        // fl2v / r2v use the main timeline track; other batch + gen hide it.
        const hideTimeline = (isBatch && !isR2v) || isGen;
        const hideVideoUpload = hideTimeline || NO_VIDEO_UPLOAD_TASKS.has(taskKey) || isR2v;
        const showBatchExport = (isBatch && isVideoBatchTask(taskKey)) || isFl2v;
        // t2v / i2v / r2v: never show source-video upload (fl2v keeps "上传图片").
        this.btnVideo?.classList.toggle("hidden", (hideVideoUpload && !isFl2v) || isR2v);
        this.btnVideoAppend?.classList.toggle("hidden", hideVideoUpload || isFl2v || isR2v);
        this.controlsBar?.classList.toggle("hidden", !isFl2v && !isR2v && (hideTimeline || isBatch));
        this.boundsEl?.classList.toggle("hidden", !isFl2v && !isR2v && (hideTimeline || isBatch));
        this.timecodeEl?.classList.toggle("hidden", !isFl2v && !isR2v && (hideTimeline || isBatch));
        this.viewport?.classList.toggle("hidden", isBatch && !isR2v);
        this.updateStageVisibility();
        this.syncExternalGroupsTimeline();
        this.root.querySelector(".bd-split")?.classList.toggle("hidden", isBatch || isFl2v);
        this.batchPanel?.classList.toggle("hidden", !isBatch);
        this.fl2vUi?.root?.classList.toggle("hidden", !isFl2v);
        this.fl2vTotalWrap?.classList.toggle("hidden", !isFl2v);
        if (isFl2v) {
            setR2vToolbar(this, false);
            setFl2vToolbar(this, true);
            setToolbarDisabledForBatch(this, false);
            // Re-apply fl2v-specific disables after clearing batch disables.
            setFl2vToolbar(this, true);
        } else if (isR2v) {
            setFl2vToolbar(this, false);
            setToolbarDisabledForBatch(this, false);
            setR2vToolbar(this, true);
            if (this.btnVideo) {
                this.btnVideo.textContent = t("toolbar.uploadVideo");
                this.btnVideo.setAttribute("data-i18n", "toolbar.uploadVideo");
            }
            updateFl2vToolbarBtns(this);
        } else {
            setFl2vToolbar(this, false);
            setR2vToolbar(this, false);
            setToolbarDisabledForBatch(this, isBatch);
            if (this.btnVideo) {
                this.btnVideo.textContent = t("toolbar.uploadVideo");
                this.btnVideo.setAttribute("data-i18n", "toolbar.uploadVideo");
            }
            const del = this.root?.querySelector('[data-a="del"]');
            if (del) {
                del.textContent = t("toolbar.deleteSegment");
                del.setAttribute("data-i18n", "toolbar.deleteSegment");
                del.setAttribute("data-i18n-title", "tooltip.deleteSegment");
            }
            updateFl2vToolbarBtns(this);
            updateR2vToolbarBtns(this);
        }

        // Side ref panels stay hidden for all batch modes (refs live in cards).
        this.updateReferenceImageVisibility({ hideTimeline: isBatch || isGen });

        const showGenImg = mode === "gen_image";
        this.genGlobalImg?.classList.toggle("hidden", !showGenImg || !this.isGlobalMode());
        this.genSegImg?.classList.toggle("hidden", !showGenImg || this.isGlobalMode());
        this.genGlobalFcRow?.classList.toggle("hidden", !isGen || !this.isGlobalMode());
        this.genSegFcRow?.classList.toggle("hidden", !isGen || this.isGlobalMode());

        if (isBatch || isGen || isFl2v || NO_VIDEO_UPLOAD_TASKS.has(taskKey)) {
            this.timeline.output = this.timeline.output || {};
            this.timeline.output.mode = "fixed";
            if (isBatch && !isVideoBatchTask(taskKey)) this.timeline.output.exportMode = "all";
            if (!this.timeline.output.aspectRatio) this.timeline.output.aspectRatio = DEFAULT_ASPECT_RATIO;
            else this.timeline.output.aspectRatio = normalizeAspectRatioLabel(this.timeline.output.aspectRatio);
            if (this.timeline.output.megapixels == null) this.timeline.output.megapixels = DEFAULT_MEGAPIXELS;
            if (this.timeline.output.multiple == null) this.timeline.output.multiple = MINIMAX_CANVAS_MULTIPLE;
            if (isCustomAspectRatio(this.timeline.output.aspectRatio)) {
                this.applyCustomResolution();
            } else {
                this.applyResolutionSelector();
            }
            this.updateOutputModeUI();
        } else if (this.outMode) {
            this.outMode.disabled = false;
            // Video edit (v2v/rv2v): prefer long-edge so ultrawide sources are not
            // center-cropped into a leftover 16:9 fixed canvas from batch modes.
            this.timeline.output = this.timeline.output || {};
            if (!this.timeline.output.mode || this.timeline.output.mode === "fixed") {
                const fromBatchFixed = this._lastOutputWasBatchFixed;
                if (fromBatchFixed || !this.timeline.output.mode) {
                    this.timeline.output.mode = "long_edge";
                    if (!this.timeline.output.longEdge) this.timeline.output.longEdge = 848;
                }
            }
            this._lastOutputWasBatchFixed = false;
            this.updateOutputModeUI();
        }
        if (isBatch || isGen || isFl2v) this._lastOutputWasBatchFixed = true;

        if (this.outHint) {
            const isVideoEdit = taskKey === "v2v" || taskKey === "rv2v";
            const showHint = isGen || isBatch || isFl2v || isVideoEdit;
            this.outHint.classList.toggle("hidden", !showHint);
            this.outHint.textContent = showHint ? genLayoutHint(this.getTaskKey()) : "";
        }
        const isVideoEditTask = taskKey === "v2v" || taskKey === "rv2v";
        this.outAudioWrap?.classList.toggle("hidden", !isVideoEditTask);
        if (this.outExportMode) {
            this.outExportMode.disabled = (isBatch || isFl2v) && !showBatchExport;
            this.outExportMode.classList.toggle("hidden", (isBatch || isFl2v) && !showBatchExport);
            this.outExportMode.previousElementSibling?.classList.toggle("hidden", (isBatch || isFl2v) && !showBatchExport);
        }
        if (this.outMaxFrames) {
            this.outMaxFrames.disabled = (isBatch || isFl2v) && !showBatchExport;
            this.outMaxFrames.classList.toggle("hidden", (isBatch || isFl2v) && !showBatchExport);
            this.outMaxFrames.previousElementSibling?.classList.toggle("hidden", (isBatch || isFl2v) && !showBatchExport);
        }

        if ((isGen || isBatch || isFl2v) && prev === "video") {
            this.currentFrame = 0;
        }
        this.updateVideoNameLabel();
        if (isFl2v) {
            this.timeline.editMode = "segment";
            ensureFl2vTimeline(this);
            this.updateSelectionUI();
            updateFl2vDetailUI(this);
            this.updateVideoNameLabel();
        } else if (isBatch) {
            this.timeline.editMode = "segment";
            this.renderImageBatchGroups();
            if (isR2v) {
                this.updateSelectionUI();
                this._syncR2vCardSelection();
            }
        } else {
            this.updateModeUI();
            this.updateSelectionUI();
        }
        this.updateGenerationRowOrder(taskKey);
        this.updateDomWidgetHeight();
        this.syncOutputUIFromTimeline();
        this.seekBar.max = Math.max(0, this.getTotalFrames() - 1);
        if (!isBatch || isR2v) this.scheduleRender();
        this.scheduleTimelineSync();
        this.updateRunSelectUI();
    }

    renderGenSrcSlot(el, imageFile, label) {
        if (!el) return;
        el.classList.toggle("has-img", !!imageFile);
        if (imageFile) {
            el.innerHTML = `<img src="${refViewUrl(imageFile)}" alt="">`;
        } else {
            el.textContent = label;
        }
    }

    _paintRefVideoSlot(el, nameEl, refBlock) {
        if (!el) return;
        const ref = refBlock || {};
        const has = !!(ref.videoFile || ref.fileName);
        el.classList.toggle("has-img", false);
        el.classList.toggle("has-video", has);
        if (nameEl) {
            if (has) {
                const dur = ref.duration > 0 ? ` · ${ref.duration.toFixed(2)}s` : "";
                const fps = ref.nativeFps > 0 ? ` · ${Math.round(ref.nativeFps)}fps` : "";
                const dim = ref.width && ref.height ? ` · ${ref.width}×${ref.height}` : "";
                nameEl.textContent = `${ref.fileName || ref.videoFile || ""}${dim}${dur}${fps}`;
            } else {
                nameEl.textContent = "";
            }
        }
        if (!has) {
            el.innerHTML = "";
            el.textContent = t("panel.uploadRefVideo");
            el.onclick = () => this.pickReferenceVideoFile();
            return;
        }
        const viewUrl = this.getReferenceVideoViewUrl(ref);
        el.innerHTML = `
            <video class="bd-ref-video-preview" muted playsinline preload="metadata" controls></video>
            <button type="button" class="bd-ref-replace" title="${t("ref.replace")}">${t("ref.replace")}</button>
            <span class="x" title="${t("ref.removeVideo")}">×</span>`;
        el.onclick = null;
        const video = el.querySelector("video");
        if (video && viewUrl) {
            video.src = viewUrl;
            video.addEventListener("click", (e) => e.stopPropagation());
            video.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            });
        }
        const replaceBtn = el.querySelector(".bd-ref-replace");
        if (replaceBtn) {
            replaceBtn.onclick = (e) => {
                e.stopPropagation();
                this.pickReferenceVideoFile();
            };
        }
        const removeBtn = el.querySelector(".x");
        if (removeBtn) {
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this.clearReferenceVideo();
            };
        }
    }

    renderRefVideoSlot() {
        if (this.isGlobalMode()) {
            this._stopRefVideoPreviews([this.segRefVideo]);
            this._paintRefVideoSlot(
                this.globalRefVideo,
                this.globalRefVideoNameEl,
                this.timeline.global?.referenceVideo || {},
            );
        } else {
            this._stopRefVideoPreviews([this.globalRefVideo]);
            const seg = this.timeline.segments[this.selectedIndex];
            this._paintRefVideoSlot(this.segRefVideo, this.segRefVideoNameEl, seg?.referenceVideo || {});
        }
    }

    _activeRefVideoTaskKey() {
        if (this.isGlobalMode()) return this.getTaskKey();
        const seg = this.timeline.segments[this.selectedIndex];
        return resolveTaskKey(seg?.taskType || this.timeline.global?.taskType || this.getTaskKey());
    }

    pickReferenceVideoFile() {
        if (!taskUsesReferenceVideo(this._activeRefVideoTaskKey())) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "video/*";
        input.onchange = () => {
            if (input.files?.[0]) this.loadReferenceVideoFile(input.files[0]);
        };
        input.click();
    }

    clearReferenceVideo() {
        const target = this.getRefVideoTarget();
        this._stopRefVideoPreviews();
        target.referenceVideo = {};
        this.renderRefVideoSlot();
        this.commit();
    }

    async loadReferenceVideoFile(file) {
        const slotEl = this.isGlobalMode() ? this.globalRefVideo : this.segRefVideo;
        const nameEl = this.isGlobalMode() ? this.globalRefVideoNameEl : this.segRefVideoNameEl;
        const status = t("upload.inProgress", { name: file.name });
        if (slotEl) {
            slotEl.classList.remove("has-img", "has-video");
            slotEl.textContent = status;
        }
        if (nameEl) nameEl.textContent = status;
        try {
            const uploaded = await uploadToInputSmart(file, (frac, cur, total) => {
                const pct = Math.round(frac * 100);
                const mode = file.size > COMFY_UPLOAD_SOFT_LIMIT ? t("upload.chunkMode") : t("upload.mode");
                if (nameEl) {
                    nameEl.textContent = t("upload.refVideoProgress", {
                        mode, name: file.name, cur, total, pct,
                    });
                }
            });
            const relPath = videoRelativePath(uploaded);
            const prep = await this._prepareVideoFrames({
                fileName: file.name,
                relPath,
                subfolder: uploaded.subfolder || "",
                type: uploaded.type || "input",
                statusPrefix: t("parse.refVideo"),
                syncNativeFps: false,
            });
            this.getRefVideoTarget().referenceVideo = this._buildClipRecord(prep);
            this.renderRefVideoSlot();
            this.commit(false, { syncTimeline: true });
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] reference video load failed:", err);
            if (nameEl) nameEl.textContent = t("upload.refVideoFailed", { err: formatUploadError(err) });
            this.renderRefVideoSlot();
        }
    }

    pickGenSrcImage(isGlobal) {
        if (!this.isGenImage()) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const uploaded = await uploadToInput(file);
                const relPath = videoRelativePath(uploaded);
                if (isGlobal) {
                    this.timeline.global = this.timeline.global || { refs: [] };
                    this.timeline.global.genImage = { imageFile: relPath };
                } else {
                    const seg = this.timeline.segments[this.selectedIndex];
                    if (seg) {
                        seg.genImage = { imageFile: relPath };
                        seg.imageFile = relPath;
                    }
                }
                this.commit();
            } catch (err) {
                console.error("[MiniMax H3 Motion Director] gen image upload failed:", err);
            }
        };
        input.click();
    }

    onGenDefaultFcChange() {
        const fc = clamp(parseInt(this.genDefaultFc?.value, 10) || 1, minFrameCount(this.getTaskKey()), MAX_GEN_FRAMES);
        if (this.genDefaultFc) this.genDefaultFc.value = fc;
        this.timeline.gen = this.timeline.gen || {};
        this.timeline.gen.defaultFrameCount = fc;
        if (this.timeline.segments.length === 1) {
            this.timeline.segments[0].frameCount = fc;
            this.timeline.segments[0].length = fc;
        }
        this.commit();
    }

    onGenSegFcChange() {
        const seg = this.timeline.segments[this.selectedIndex];
        if (!seg) return;
        const minFc = minFrameCount(this.getTaskKey());
        seg.frameCount = clamp(parseInt(this.genSegFc?.value, 10) || minFc, minFc, MAX_GEN_FRAMES);
        if (this.genSegFc) this.genSegFc.value = seg.frameCount;
        this.commit();
    }

    genSplitAtFrame(frame) {
        const total = this.getTotalFrames();
        const minFc = minFrameCount(this.getTaskKey());
        if (frame <= minFc || frame >= total - minFc) return;
        const newSegs = [];
        let cursor = 0;
        for (const seg of this.timeline.segments) {
            const fc = seg.frameCount ?? seg.length;
            const end = cursor + fc;
            if (frame > cursor && frame < end) {
                const left = frame - cursor;
                const right = end - frame;
                newSegs.push({ ...seg, frameCount: left, length: left });
                newSegs.push({
                    id: uid(), start: frame, frameCount: right, length: right,
                    prompt: "", taskType: "", refs: [], genImage: { imageFile: "" },
                });
            } else {
                newSegs.push({ ...seg });
            }
            cursor = end;
        }
        this.timeline.segments = newSegs;
        this.commitSegmentStructureMutation();
    }

    genEqualSplit() {
        const n = parseInt(this.equalCountInput?.value || "2", 10);
        if (!n || n < 2) return;
        const total = this.getTotalFrames();
        const minFc = minFrameCount(this.getTaskKey());
        const count = clamp(n, 2, Math.max(2, Math.floor(total / minFc)));
        const base = Math.floor(total / count);
        let rem = total - base * count;
        this.timeline.segments = Array.from({ length: count }, () => {
            const fc = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem -= 1;
            return {
                id: uid(), frameCount: fc, length: fc, prompt: "", taskType: "", refs: [],
                genImage: { imageFile: "" },
            };
        });
        this.commitSegmentStructureMutation();
    }

    genDeleteSelectedSegment() {
        if (this.timeline.segments.length <= 1) return;
        this.timeline.segments.splice(this.selectedIndex, 1);
        this.selectedIndex = clamp(this.selectedIndex, 0, this.timeline.segments.length - 1);
        this.commitSegmentStructureMutation();
    }

    updateVideoNameLabel() {
        if (this.isMixedMode()) {
            const n = this._ensureMixedTimeline().segments?.length || 0;
            const frames = this._mixedTotalFrames();
            this.videoNameEl.textContent = getLocale() === "en"
                ? `Mixed · ${n} segment${n === 1 ? "" : "s"} · ${frames}f`
                : `混合 · ${n}段 · ${frames}帧`;
            return;
        }
        if (this.isFl2vMode()) {
            const shots = this.timeline.shots || [];
            const n = shots.length;
            const total = this.getTotalFrames();
            const withEnd = shots.filter((s) => s.endImage?.imageFile).length;
            const withStart = shots.filter((s) => s.startImage?.imageFile).length;
            const sec = getFl2vTotalDurationSec(this);
            if (!n) {
                this.videoNameEl.textContent = t("videoName.fl2vEmpty", { sec, frames: total });
            } else {
                this.videoNameEl.textContent = t("videoName.fl2vSummary", {
                    n, start: withStart, end: withEnd, sec, frames: total,
                });
            }
            return;
        }
        if (this.isImageBatch()) {
            // Prefer live drag preview so toolbar totals track the divider.
            const segs = this._previewSegments || this.timeline.segments || [];
            const n = segs.length || 0;
            const key = this.getTaskKey();
            if (isVideoBatchTask(key)) {
                let sec = 0;
                let total = 0;
                for (const seg of segs) {
                    const fc = Math.max(1, parseInt(seg.frameCount ?? seg.length, 10) || 1);
                    const raw = Number(seg.durationSec);
                    // During edge drag, frames are authoritative; durationSec may be stale.
                    const resolved = this._previewSegments
                        ? {
                            frames: fc,
                            durationSec: preferredDurationSecFromFrames(fc, 24),
                        }
                        : durationToClampedMiniMaxFrames(
                            Number.isFinite(raw)
                                ? raw
                                : preferredDurationSecFromFrames(fc || defaultFrameCount(key), 24),
                            24,
                        );
                    sec += resolved.durationSec;
                    total += resolved.frames;
                }
                sec = roundDurationSec(sec);
                const play = framesToDurationSec(total, 24);
                this.videoNameEl.textContent = total
                    ? t("videoName.batchVideo", {
                        key,
                        n,
                        sec: sec || play,
                        frames: total,
                        play,
                    })
                    : t("videoName.batchVideoEmpty", { key, n });
            } else {
                this.videoNameEl.textContent = t("videoName.batchImage", { key, n });
            }
            return;
        }
        if (this.isGenMode()) {
            const total = this.getTotalFrames();
            const key = this.getTaskKey();
            if (this.isGenBlank()) {
                this.videoNameEl.textContent = total
                    ? t("videoName.blankCanvas", { frames: total })
                    : t("videoName.blankCanvasNeedFrames");
            } else {
                this.videoNameEl.textContent = total
                    ? `${key} · ${total}f`
                    : t("videoName.genNeedSource", { key });
            }
            return;
        }
        const clips = this.getVideoClips();
        const total = this.getTotalFrames();
        if (!clips.length || !total) {
            this.videoNameEl.textContent = t("toolbar.noVideo");
            return;
        }
        if (clips.length === 1) {
            const c = clips[0];
            const nativeWh = c.width && c.height ? `${c.width}×${c.height}` : "";
            const storeW = c.storageWidth || this._storageWidth;
            const storeH = c.storageHeight || this._storageHeight;
            const storeWh = storeW && storeH ? `${storeW}×${storeH}` : "";
            let dim = "";
            if (nativeWh && storeWh && nativeWh !== storeWh) dim = ` · ${nativeWh} → ${storeWh}`;
            else if (nativeWh) dim = ` · ${nativeWh}`;
            else if (storeWh) dim = ` · ${storeWh}`;
            const nativeHint = c.nativeFps > 0 ? t("canvas.nativeFps", { fps: formatProbeFps(c.nativeFps) }) : "";
            const tlFps = this.getFrameRate();
            const dur = this.getTimelineDurationSec().toFixed(2);
            const name = c.fileName || c.videoFile;
            this.videoNameEl.textContent = t("videoName.singleClip", {
                name, total, fps: formatProbeFps(tlFps), dur, native: nativeHint, dim,
            });
            return;
        }
        const tlFps = this.getFrameRate();
        const dur = this.getTimelineDurationSec().toFixed(2);
        this.videoNameEl.textContent = t("videoName.multiClip", {
            n: clips.length, total, fps: formatProbeFps(tlFps), dur,
        });
    }

    getFrameMapEntry(logicalFrame) {
        const map = this.getFrameMap();
        if (map.length) return normalizeFrameMapEntry(map[clamp(logicalFrame, 0, map.length - 1)]);
        return { clip: 0, frame: logicalToSourceFrame(logicalFrame, this.timeline.video || {}) };
    }

    getSegmentClipIndex(seg) {
        return this.getFrameMapEntry(seg.start).clip;
    }

    getClipBoundaries() {
        const map = this.getFrameMap();
        const boundaries = [];
        for (let i = 1; i < map.length; i++) {
            const a = normalizeFrameMapEntry(map[i - 1]);
            const b = normalizeFrameMapEntry(map[i]);
            if (b.clip !== a.clip) boundaries.push(i);
        }
        return boundaries;
    }

    _segmentMetaAtFrame(frame) {
        const segs = [...this.timeline.segments].sort((a, b) => a.start - b.start);
        for (const seg of segs) {
            if (frame >= seg.start && frame < seg.start + seg.length) {
                return {
                    prompt: seg.prompt || "",
                    taskType: seg.taskType || "",
                    refs: seg.refs ? JSON.parse(JSON.stringify(seg.refs)) : [],
                };
            }
        }
        const last = segs[segs.length - 1];
        if (last) {
            return {
                prompt: last.prompt || "",
                taskType: last.taskType || "",
                refs: last.refs ? JSON.parse(JSON.stringify(last.refs)) : [],
            };
        }
        return { prompt: "", taskType: "", refs: [] };
    }

    _buildSegmentsFromSplitPoints(points, forcedPoints = null) {
        const forced = new Set(forcedPoints || []);
        forced.add(0);
        const sorted = [...new Set(points)].sort((a, b) => a - b);
        forced.add(sorted[sorted.length - 1]);
        const newSegs = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            const start = sorted[i];
            const length = sorted[i + 1] - start;
            const endsForced = forced.has(sorted[i + 1]);
            const startsForced = forced.has(start);
            if (length < MIN_SEG && !endsForced && !startsForced) continue;
            if (length < 1) continue;
            const meta = this._segmentMetaAtFrame(start);
            newSegs.push({
                id: uid(),
                start,
                length,
                prompt: meta.prompt,
                taskType: meta.taskType,
                refs: meta.refs,
            });
        }
        if (!newSegs.length) return null;
        let cursor = 0;
        return newSegs.map((seg) => {
            const s = { ...seg, start: cursor, length: seg.length };
            cursor += s.length;
            return s;
        });
    }

    _getReorderInsertFrame(dropRank, fromRank) {
        const ordered = [...this.timeline.segments].sort((a, b) => a.start - b.start);
        const lengths = ordered.map((s) => s.length);
        const without = lengths.filter((_, i) => i !== fromRank);
        let frame = 0;
        for (let i = 0; i < dropRank && i < without.length; i++) frame += without[i];
        return frame;
    }

    _orderedSegmentsWithRank() {
        return [...this.timeline.segments]
            .map((seg, arrayIndex) => ({ seg, arrayIndex }))
            .sort((a, b) => a.seg.start - b.seg.start)
            .map((item, visualRank) => ({ ...item, visualRank }));
    }

    _visualRankFromArrayIndex(arrayIndex) {
        const ordered = this._orderedSegmentsWithRank();
        return ordered.find((o) => o.arrayIndex === arrayIndex)?.visualRank ?? arrayIndex;
    }

    _computeReorderDropRank(frame, fromRank) {
        const ordered = this._orderedSegmentsWithRank();
        if (!ordered.length) return fromRank;

        // fl2v: swap slots — drop target = the clip currently under the pointer.
        if (this.isFl2vMode()) {
            for (const item of ordered) {
                const lo = item.seg.start;
                const hi = item.seg.start + item.seg.length;
                if (frame >= lo && frame < hi) return item.visualRank;
            }
            // In a gap / past the end: snap to nearest clip by center distance.
            let best = fromRank;
            let bestDist = Infinity;
            for (const item of ordered) {
                const mid = item.seg.start + item.seg.length / 2;
                const d = Math.abs(frame - mid);
                if (d < bestDist) {
                    bestDist = d;
                    best = item.visualRank;
                }
            }
            return best;
        }

        // Video / gen: insert-before semantics (skip the dragged clip).
        for (const item of ordered) {
            if (item.visualRank === fromRank) continue;
            const mid = item.seg.start + item.seg.length / 2;
            if (frame < mid) return item.visualRank;
        }
        return ordered.length - 1;
    }

    reorderSegmentsByRank(fromRank, toRank) {
        const ordered = [...this.timeline.segments]
            .map((seg) => ({ seg }))
            .sort((a, b) => a.seg.start - b.seg.start);
        if (fromRank < 0 || fromRank >= ordered.length) return;
        if (toRank < 0 || toRank >= ordered.length) return;
        if (fromRank === toRank) return;

        // fl2v: reorder shots[] (source of truth), then rebuild segments.
        if (this.isFl2vMode()) {
            const shots = [...(this.timeline.shots || [])];
            if (fromRank < 0 || fromRank >= shots.length) return;
            if (toRank < 0 || toRank >= shots.length) return;
            const [moved] = shots.splice(fromRank, 1);
            let insertRank = toRank;
            if (insertRank > fromRank) insertRank -= 1;
            shots.splice(insertRank, 0, moved);
            this.timeline.shots = shots;
            syncFl2vFromShots(this);
            this.selectedIndex = insertRank;
            updateFl2vDetailUI(this);
            this.updateVideoNameLabel();
            return;
        }
        // r2v: move whole groups (duration + refs) then renumber starts.
        if (this.isR2vBatch()) {
            const metas = ordered.map((o) => ({
                ...o.seg,
                refs: o.seg.refs ? JSON.parse(JSON.stringify(o.seg.refs)) : [],
                refAudios: o.seg.refAudios ? JSON.parse(JSON.stringify(o.seg.refAudios)) : [],
                refVideos: o.seg.refVideos ? JSON.parse(JSON.stringify(o.seg.refVideos)) : [],
            }));
            const [mMeta] = metas.splice(fromRank, 1);
            let insertRank = toRank;
            if (insertRank > fromRank) insertRank -= 1;
            metas.splice(insertRank, 0, mMeta);
            this.timeline.segments = metas;
            normalizeImageBatchSegments(this);
            this.selectedIndex = insertRank;
            this.updateVideoNameLabel();
            return;
        }
        // gen: no video frameMap — reorder by segment metadata only.
        if (this.isGenMode()) {
            const metas = ordered.map((o) => ({
                ...o.seg,
                refs: o.seg.refs ? JSON.parse(JSON.stringify(o.seg.refs)) : [],
            }));
            const slots = ordered.map((o) => ({
                start: o.seg.start,
                length: o.seg.length || o.seg.frameCount || minFrameCount(this.getTaskKey()),
            }));
            const [mMeta] = metas.splice(fromRank, 1);
            let insertRank = toRank;
            if (insertRank > fromRank) insertRank -= 1;
            metas.splice(insertRank, 0, mMeta);
            for (let i = 0; i < metas.length; i++) {
                const slot = slots[i] || slots[slots.length - 1];
                metas[i].start = slot.start;
                metas[i].length = slot.length;
                metas[i].frameCount = slot.length;
            }
            this.timeline.segments = metas;
            this.normalizeGenSegments();
            this.selectedIndex = insertRank;
            this.updateVideoNameLabel();
            return;
        }

        if (!this.getFrameMap().length && this.getTotalFrames() > 0) {
            this.materializeFrameMap();
        }
        const map = [...this.getFrameMap()];
        const slices = ordered.map((o) => map.slice(o.seg.start, o.seg.start + o.seg.length));
        const metas = ordered.map((o) => ({
            ...o.seg,
            refs: o.seg.refs ? JSON.parse(JSON.stringify(o.seg.refs)) : [],
        }));

        const [mSlice] = slices.splice(fromRank, 1);
        const [mMeta] = metas.splice(fromRank, 1);
        let insertRank = toRank;
        if (insertRank > fromRank) insertRank -= 1;
        slices.splice(insertRank, 0, mSlice);
        metas.splice(insertRank, 0, mMeta);

        const newMap = slices.flat();
        let start = 0;
        const newSegs = metas.map((seg, idx) => {
            const s = { ...seg, start, length: slices[idx].length };
            start += s.length;
            return s;
        });

        this.setFrameMap(newMap);
        this.timeline.segments = newSegs;
        this._syncPrimaryVideoFromClips(newMap);
        this._thumbCache.clear();
        this._thumbPending.clear();
        this.selectedIndex = insertRank;
        this._prefetchSegmentThumbs(0, Math.min(newMap.length, THUMB_PREFETCH_BATCH * 4));
    }

    materializeFrameMap() {
        const total = this.getTotalFrames();
        const video = this.timeline.video || {};
        if (video.frameMap?.length === total) return;
        const map = [];
        for (let i = 0; i < total; i++) map.push(this.getFrameMapEntry(i));
        video.frameMap = map;
        video.deletedSourceRanges = [];
        this.timeline.video = video;
        this.timeline.totalFrames = total;
    }

    getFrameMap() {
        const v = this.timeline?.video || {};
        if (v.frameMap?.length) return v.frameMap;
        if (this._legacyFrames.length) return buildIdentityFrameMap(this._legacyFrames.length);
        if (v.frames?.length) return buildIdentityFrameMap(v.frames.length);
        return [];
    }

    setFrameMap(map) {
        this.timeline.video = this.timeline.video || {};
        this.timeline.video.frameMap = map;
        if (map.length) {
            this.timeline.totalFrames = map.length;
            this.timeline.video.deletedSourceRanges = [];
        }
    }

    setSparseVideoFrames(totalFrames) {
        this.timeline.video = this.timeline.video || {};
        this.timeline.video.frameMap = [];
        this.timeline.video.sourceFrameCount = totalFrames;
        this.timeline.video.deletedSourceRanges = [];
        this.timeline.totalFrames = totalFrames;
    }

    logicalToSourceFrame(logical) {
        return logicalToSourceFrame(logical, this.timeline.video || {});
    }

    getTotalFrames() {
        if (this.isMixedMode()) return this._mixedTotalFrames();
        // fl2v: visual canvas may be longer than the sampling window (overflow = dashed).
        if (this.isFl2vMode()) return getFl2vVisualFrames(this);
        if (this.isImageBatch() || this.isGenMode()) {
            // t2v/i2v: never use drag preview for totals (inputs are the source of truth).
            // r2v may temporarily use _previewSegments while resizing on the timeline.
            if (this.isR2vBatch() && this._previewSegments) {
                return sumFrameCounts(this._previewSegments);
            }
            return sumFrameCounts(this.timeline.segments);
        }
        const mapLen = this.timeline?.video?.frameMap?.length || 0;
        if (mapLen > 0) return mapLen;
        // Sparse deletes: sourceFrameCount − ranges beats a stale totalFrames.
        const src = parseInt(this.timeline?.video?.sourceFrameCount || 0, 10);
        if (src > 0) {
            const removed = deletedSourceRanges(this.timeline.video).reduce((s, [a, b]) => s + (b - a), 0);
            return Math.max(0, src - removed);
        }
        const total = Math.max(0, parseInt(this.timeline?.totalFrames || this.totalFramesWidget?.value || 0, 10));
        if (total > 0) return total;
        if (!this.hasVideo()) return 0;
        return 0;
    }

    getMaxExportFrames() {
        const n = parseInt(this.timeline.output?.maxExportFrames ?? 0, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    getExportFrameTotal() {
        const total = this.getTotalFrames();
        const cap = this.getMaxExportFrames();
        return cap > 0 ? Math.min(total, cap) : total;
    }

    getFrameRate() {
        if (this.isMixedMode()) return Math.max(1, Number(this._ensureMixedTimeline().frameRate || 24) || 24);
        return coerceTimelineFps(this.fpsInput?.value ?? this.frameRateWidget?.value ?? this.timeline.frameRate ?? 24);
    }

    syncFrameRateUI(value = null) {
        const fps = coerceTimelineFps(value ?? this.fpsInput?.value ?? this.frameRateWidget?.value ?? this.timeline.frameRate ?? 24);
        this.timeline.frameRate = fps;
        if (this.frameRateWidget) this.frameRateWidget.value = fps;
        if (this.fpsInput) this.fpsInput.value = fps;
        return fps;
    }

    _clipFrameCountAtFps(clip, fps, fallback = 0) {
        const nativeFps = Number(clip?.nativeFps || 0);
        const nativeCount = Number(clip?.nativeFrameCount || 0);
        if (nativeFps > 0 && nativeCount > 0) {
            return Math.max(1, Math.round((nativeCount / nativeFps) * fps));
        }
        const duration = Number(clip?.duration || 0);
        if (duration > 0) return Math.max(1, Math.round(duration * fps));
        return Math.max(1, Math.round(fallback || Number(clip?.sourceFrameCount || 0) || 1));
    }

    _timelineFrameCountAtFps(fps, oldFps = null, oldTotal = null) {
        const nextFps = coerceTimelineFps(fps);
        const prevTotal = Number(oldTotal ?? this.getTotalFrames() ?? 0);
        const prevFps = coerceTimelineFps(oldFps ?? this.timeline.frameRate ?? this.frameRateWidget?.value ?? 24);
        // When user changes timeline FPS, preserve wall-clock duration: T = N/fps → N' = T * fps'.
        if (prevTotal > 0 && oldFps != null && Math.abs(prevFps - nextFps) >= 0.001) {
            return Math.max(1, Math.round(prevTotal * nextFps / prevFps));
        }
        const clips = this.getVideoClips();
        if (clips.length && clips.some((c) => Number(c.duration || 0) > 0 || Number(c.nativeFrameCount || 0) > 0)) {
            return clips.reduce((sum, clip) => sum + this._clipFrameCountAtFps(clip, nextFps), 0);
        }
        if (prevTotal > 0) {
            return Math.max(1, Math.round(prevTotal * nextFps / Math.max(prevFps, 0.001)));
        }
        return 1;
    }

    _rescaleSegmentsForTotal(oldTotal, newTotal) {
        if (!oldTotal || !newTotal || !this.timeline.segments?.length) {
            this._setSingleSegment(newTotal);
            return;
        }
        const ordered = [...this.timeline.segments].sort((a, b) => a.start - b.start);
        let cursor = 0;
        this.timeline.segments = ordered.map((seg, idx) => {
            const rawStart = idx === 0 ? 0 : Math.round((seg.start / oldTotal) * newTotal);
            const rawEnd = idx === ordered.length - 1
                ? newTotal
                : Math.round(((seg.start + seg.length) / oldTotal) * newTotal);
            const start = clamp(rawStart, cursor, newTotal);
            const end = clamp(rawEnd, start + 1, newTotal);
            cursor = end;
            return {
                ...seg,
                start,
                length: Math.max(1, end - start),
                frameCount: Math.max(1, end - start),
            };
        });
    }

    _syncClipFrameCountsForFps(fps, oldFps = null) {
        const clips = this.getVideoClips();
        if (!clips.length) return;
        const prevFps = coerceTimelineFps(oldFps ?? this.timeline.frameRate ?? 24);
        this.timeline.videoClips = clips.map((clip) => {
            const fallback = Number(clip.sourceFrameCount || 0) * fps / Math.max(prevFps, 0.001);
            return { ...clip, sourceFrameCount: this._clipFrameCountAtFps(clip, fps, fallback) };
        });
    }

    _resampleFrameMapForFps(oldFps, newFps, newTotal) {
        const oldTotal = this.getTotalFrames();
        if (!oldTotal || !newTotal) return [];
        const oldEntries = Array.from({ length: oldTotal }, (_, i) => this.getFrameMapEntry(i));
        const clips = this.getVideoClips();
        const map = [];
        for (let i = 0; i < newTotal; i++) {
            const oldLogical = clamp(Math.round((i / newFps) * oldFps), 0, oldTotal - 1);
            const entry = normalizeFrameMapEntry(oldEntries[oldLogical]);
            const clip = clips[entry.clip] || clips[0] || {};
            const maxFrame = this._clipFrameCountAtFps(clip, newFps) - 1;
            const sourceTime = Number(entry.frame || 0) / Math.max(oldFps, 0.001);
            map.push({
                clip: entry.clip,
                frame: clamp(Math.round(sourceTime * newFps), 0, Math.max(0, maxFrame)),
            });
        }
        return map;
    }

    _resampleTimelineForFrameRate(oldFps, newFps) {
        if (this.isImageBatch() || this.isGenMode() || !this.hasVideo()) return;
        const oldTotal = this.getTotalFrames();
        const newTotal = this._timelineFrameCountAtFps(newFps, oldFps, oldTotal);
        const hasExplicitMap = this.getFrameMap().length > 0;
        const hasSparseDeletes = deletedSourceRanges(this.timeline.video || {}).length > 0;

        if (hasExplicitMap || hasSparseDeletes || this.getVideoClips().length > 1) {
            const newMap = this._resampleFrameMapForFps(oldFps, newFps, newTotal);
            this.setFrameMap(newMap);
            this._syncClipFrameCountsForFps(newFps, oldFps);
            this._syncPrimaryVideoFromClips(newMap);
        } else {
            this._syncClipFrameCountsForFps(newFps, oldFps);
            this.setSparseVideoFrames(newTotal);
            this._syncPrimaryVideoFromClips([]);
        }

        this._rescaleSegmentsForTotal(oldTotal, newTotal);
        this.currentFrame = clamp(Math.round((this.currentFrame / Math.max(oldTotal, 1)) * newTotal), 0, Math.max(0, newTotal - 1));
        if (this.totalFramesWidget) this.totalFramesWidget.value = newTotal;
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, newTotal - 1);
            this.seekBar.value = this.currentFrame;
        }
        this._thumbCache.clear();
        this._thumbPending.clear();
    }

    onFrameRateChanged(value) {
        if (this.isMixedMode()) {
            const fps = coerceTimelineFps(value);
            const state = this._ensureMixedTimeline();
            state.frameRate = fps;
            if (this.frameRateWidget) this.frameRateWidget.value = fps;
            if (this.fpsInput) this.fpsInput.value = String(fps);
            this.mixedTimeline = normalizeMixedTimeline(state);
            this.scheduleTimelineSync();
            this.updateVideoNameLabel();
            return;
        }
        const oldFps = coerceTimelineFps(this.timeline.frameRate ?? this.frameRateWidget?.value ?? 24);
        const newFps = this.syncFrameRateUI(value);
        if (Math.abs(oldFps - newFps) < 0.001) {
            this.commit(false, { syncTimeline: true });
            return;
        }
        this._resampleTimelineForFrameRate(oldFps, newFps);
        this.updateVideoNameLabel();
        this.updateOutputPreview();
        this.scheduleRender();
        this.commit(false, { syncTimeline: true });
    }

    getTimelineDurationSec() {
        if (this.isFl2vMode()) return getFl2vTotalDurationSec(this);
        const total = this.getTotalFrames();
        const fps = this.getFrameRate();
        return total / Math.max(fps, 0.001);
    }

    isGlobalMode() { return (this.timeline.editMode || "global") === "global"; }

    setEditMode(mode) {
        this.timeline.editMode = mode;
        this.root.querySelector('[data-a="mode-global"]').classList.toggle("active", mode === "global");
        this.root.querySelector('[data-a="mode-segment"]').classList.toggle("active", mode === "segment");
        this.updateModeUI();
        this.commit();
    }

    updateModeUI() {
        if (this.isMixedMode()) {
            this._enterMixedNative(this._standaloneDirectorMode);
            this.updateVideoNameLabel();
            return;
        }
        const global = this.isGlobalMode();
        this.globalPanel.style.display = global ? "flex" : "none";
        this.segmentPanel.style.display = global ? "none" : "flex";
        this.updateReferenceImageVisibility({
            hideTimeline: this.isImageBatch() || this.isGenMode(),
            seg: global ? null : this.timeline.segments[this.selectedIndex],
        });
        if (!global) this.updateSelectionUI();
        else if (taskUsesReferenceVideo(this.getTaskKey())) this.renderRefVideoSlot();
        this.updateLiveSamplePanel();
    }

    getRefTarget() {
        if (this.isGlobalMode()) return this.timeline.global;
        const seg = this.timeline.segments[this.selectedIndex];
        return seg || this.timeline.global;
    }

    getDisplayPrompt(seg) {
        if (this.isGlobalMode()) return this.timeline.global?.prompt || "";
        return seg?.prompt || "";
    }

    populateTaskSelect(el, selected) {
        if (!el) return;
        const opts = this.taskTypeWidget?.options?.values || [];
        const prev = selected || el.value;
        el.innerHTML = "";
        for (const v of opts) {
            const o = document.createElement("option");
            o.value = v;
            const key = resolveTaskKey(v);
            o.textContent = taskDisplayLabel(key) || v;
            el.appendChild(o);
        }
        if (prev) el.value = prev;
    }

    refreshAspectSelectLabels() {
        if (!this.outAspect) return;
        const cur = this.outAspect.value;
        for (const opt of this.outAspect.options || []) {
            opt.textContent = aspectDisplayLabel(opt.value);
        }
        if (cur) this.outAspect.value = cur;
    }

    applyLocale() {
        this._directorModalController?.updateLocale();
        this.postprocessUi?.updateLocale?.(getLocale());
        this.outputUi?.updateLocale?.(getLocale());
        this.node?.setDirtyCanvas?.(true, true);
        this.root?.classList.toggle("locale-en", getLocale() === "en");
        this.root?.classList.toggle("locale-zh", getLocale() !== "en");
        applyI18nDom(this.root);
        applyDirectorWidgetLabels(this.node);
        refreshDirectorContinuityUi(this.node, this);
        this.populateTaskSelect(this.globalTask, this.taskTypeWidget?.value || this.globalTask?.value);
        this.refreshAspectSelectLabels();
        // Re-apply dynamic UI strings that overwrite data-i18n nodes.
        this.updateVideoNameLabel?.();
        this.updateRunSelectUI?.();
        this.updateOutputPreview?.();
        this.updateSelectionUI?.();
        this.refreshLoopButtonTitle?.();
        this.refreshLiveTaePreviewButton?.();
        this.updateLiveSamplePanel?.();
        this.syncExternalGroupsTimeline?.();
        updateFl2vDetailUI?.(this);
        updateFl2vToolbarBtns?.(this);
        updateR2vToolbarBtns?.(this);
        this.renderImageBatchGroups?.();
        this.syncRv2vRefLayoutClasses?.({
            hideTimeline: this.isImageBatch?.() || this.isGenMode?.(),
            seg: this.isGlobalMode?.() ? null : this.timeline?.segments?.[this.selectedIndex],
        });
        if (this.isGlobalMode?.() && taskUsesReferenceImages(this.getTaskKey())) {
            this.renderRefSlots?.(this.timeline.global?.refs, this.globalRefsBox, true);
        } else if (!this.isGlobalMode?.()) {
            const seg = this.timeline?.segments?.[this.selectedIndex];
            if (seg && taskUsesReferenceImages(resolveTaskKey(seg.taskType || this.getTaskKey()))) {
                this.renderRefSlots?.(seg.refs, this.segRefsBox, false);
            }
        }
        if (taskUsesReferenceAudios(this.getTaskKey())) this.renderRefAudioSlots?.();
        if (this._lastRunProgressDetail) {
            this.setRunProgress(this._lastRunProgressDetail);
        } else if (this._lastRunErrorMessage != null) {
            this.setRunError(this._lastRunErrorMessage);
        }
        this.scheduleRender?.();
        this.node?.setDirtyCanvas?.(true, true);
    }

    getI2iSourceDimensions() {
        for (const seg of this.timeline.segments || []) {
            const gi = seg.genImage || {};
            const w = +(gi.width || 0);
            const h = +(gi.height || 0);
            if (w > 0 && h > 0) return { width: w, height: h };
        }
        const out = this.timeline.output || {};
        if (+(out.sourceWidth || 0) > 0 && +(out.sourceHeight || 0) > 0) {
            return { width: +out.sourceWidth, height: +out.sourceHeight };
        }
        return { width: 0, height: 0 };
    }

    getSourceDimensions() {
        const clips = this.getVideoClips?.() || [];
        const video = clips[0] || this.timeline.video || {};
        // Prefer native clip/source size — never fall back to output canvas W×H
        // (that makes long_edge look like a no-op and keeps a cropped 16:9).
        if (+(video.width || 0) > 0 && +(video.height || 0) > 0) {
            return { width: +video.width, height: +video.height };
        }
        for (const clip of clips) {
            if (+(clip?.width || 0) > 0 && +(clip?.height || 0) > 0) {
                return { width: +clip.width, height: +clip.height };
            }
        }
        return { width: 0, height: 0 };
    }

    _refreshVideoStorageDimensions(resolved) {
        if (!resolved?.width || !resolved?.height) return;
        this._storageWidth = resolved.width;
        this._storageHeight = resolved.height;
        if (this.timeline.video) {
            this.timeline.video.storageWidth = resolved.width;
            this.timeline.video.storageHeight = resolved.height;
        }
        for (const clip of this.getVideoClips()) {
            clip.storageWidth = resolved.width;
            clip.storageHeight = resolved.height;
        }
    }

    syncOutputUIFromTimeline() {
        const out = this.timeline.output || {
            mode: "long_edge",
            aspectRatio: DEFAULT_ASPECT_RATIO,
            megapixels: DEFAULT_MEGAPIXELS,
            multiple: MINIMAX_CANVAS_MULTIPLE,
            longEdge: 848, width: 848, height: 480,
            maxExportFrames: 0, exportMode: "all",
            audioMode: "generate",
            continuityEnabled: false, continuityOverlapFrames: 9,
        };
        // Prefer ResolutionSelector fields; backfill from width/height when missing.
        // Custom keeps explicit width/height and does not recompute from megapixels.
        if (!isCustomAspectRatio(out.aspectRatio) && (out.aspectRatio == null || out.megapixels == null)) {
            const resolved = resolutionFromSelector(
                out.aspectRatio || DEFAULT_ASPECT_RATIO,
                out.megapixels ?? DEFAULT_MEGAPIXELS,
                out.multiple ?? MINIMAX_CANVAS_MULTIPLE,
            );
            if (resolved) {
                out.aspectRatio = resolved.aspectRatio;
                out.megapixels = resolved.megapixels;
                out.multiple = resolved.multiple;
                if (out.width == null) out.width = resolved.width;
                if (out.height == null) out.height = resolved.height;
                this.timeline.output = { ...out };
            }
        }
        if (this.outMode) this.outMode.value = out.mode || "long_edge";
        if (this.outAspect) {
            const ar = isCustomAspectRatio(out.aspectRatio)
                ? CUSTOM_ASPECT_RATIO
                : normalizeAspectRatioLabel(out.aspectRatio || DEFAULT_ASPECT_RATIO);
            this.outAspect.value = ar;
            if (out.aspectRatio !== ar) {
                out.aspectRatio = ar;
                this.timeline.output = { ...out };
            }
        }
        if (this.outMp) this.outMp.value = String(out.megapixels ?? DEFAULT_MEGAPIXELS);
        if (this.outLong) this.outLong.value = String(out.longEdge ?? 864);
        if (this.outW) this.outW.value = String(out.width ?? 864);
        if (this.outH) this.outH.value = String(out.height ?? 480);
        if (this.outMaxFrames) this.outMaxFrames.value = String(out.maxExportFrames ?? 0);
        if (this.outExportMode) this.outExportMode.value = out.exportMode === "segments" ? "segments" : "all";
        if (this.outAudioMode) {
            const am = normalizeAudioMode(out.audioMode);
            this.outAudioMode.value = am;
            if (out.audioMode !== am) {
                out.audioMode = am;
                this.timeline.output = { ...out };
            }
        }
        if (this.segmentContinuityCb) this.segmentContinuityCb.checked = isContinuityEnabled(out);
        if (this.segmentContinuityOverlap) {
            this.segmentContinuityOverlap.value = String(out.continuityOverlapFrames ?? 9);
        }
        this.syncFrameRateUI(this.timeline.frameRate);
        this.updateOutputModeUI();
        this.updateSegmentContinuityUI();
        this.updateOutputPreview();
    }

    updateSegmentContinuityUI() {
        // MiniMax H3 Motion Director: segment continuity / SCAIL UI removed.
        if (this.segmentContinuityWrap) {
            this.segmentContinuityWrap.classList.add("hidden");
            this.segmentContinuityWrap.hidden = true;
        }
        if (this.timeline?.output) {
            this.timeline.output.continuityEnabled = false;
        }
    }

    /** Apply ResolutionSelector → fixed width/height on timeline + node widgets. */
    applyResolutionSelector(aspectRatio = null, megapixels = null) {
        const out = this.timeline.output || {};
        const ar = aspectRatio ?? out.aspectRatio ?? this.outAspect?.value ?? DEFAULT_ASPECT_RATIO;
        if (isCustomAspectRatio(ar)) {
            return this.applyCustomResolution(out.width, out.height);
        }
        const resolved = resolutionFromSelector(
            ar,
            megapixels ?? out.megapixels ?? this.outMp?.value ?? DEFAULT_MEGAPIXELS,
            out.multiple ?? MINIMAX_CANVAS_MULTIPLE,
        );
        if (!resolved) {
            return this.applyCustomResolution(out.width, out.height);
        }
        this.timeline.output = {
            ...out,
            mode: "fixed",
            aspectRatio: resolved.aspectRatio,
            megapixels: resolved.megapixels,
            multiple: resolved.multiple,
            width: resolved.width,
            height: resolved.height,
            longEdge: Math.max(resolved.width, resolved.height),
        };
        if (this.widthWidget) this.widthWidget.value = resolved.width;
        if (this.heightWidget) this.heightWidget.value = resolved.height;
        if (this.refMaxWidget) this.refMaxWidget.value = Math.max(resolved.width, resolved.height);
        if (this.outW) this.outW.value = String(resolved.width);
        if (this.outH) this.outH.value = String(resolved.height);
        if (this.outAspect) this.outAspect.value = resolved.aspectRatio;
        // Keep the in-progress typed text while the field is focused.
        if (this.outMp && document.activeElement !== this.outMp) {
            this.outMp.value = String(resolved.megapixels);
        }
        return resolved;
    }

    /** Apply explicit custom width × height (snapped to canvas multiple). */
    applyCustomResolution(width = null, height = null) {
        const out = this.timeline.output || {};
        const mult = out.multiple ?? MINIMAX_CANVAS_MULTIPLE;
        const w = snapResolutionDim(width ?? out.width ?? this.outW?.value ?? this.widthWidget?.value ?? 864, mult);
        const h = snapResolutionDim(height ?? out.height ?? this.outH?.value ?? this.heightWidget?.value ?? 480, mult);
        this.timeline.output = {
            ...out,
            mode: "fixed",
            aspectRatio: CUSTOM_ASPECT_RATIO,
            megapixels: out.megapixels ?? DEFAULT_MEGAPIXELS,
            multiple: mult,
            width: w,
            height: h,
            longEdge: Math.max(w, h),
        };
        if (this.widthWidget) this.widthWidget.value = w;
        if (this.heightWidget) this.heightWidget.value = h;
        if (this.refMaxWidget) this.refMaxWidget.value = Math.max(w, h);
        if (this.outW) this.outW.value = String(w);
        if (this.outH) this.outH.value = String(h);
        if (this.outAspect) this.outAspect.value = CUSTOM_ASPECT_RATIO;
        if (this.outMp) this.outMp.value = String(this.timeline.output.megapixels);
        return {
            width: w,
            height: h,
            megapixels: this.timeline.output.megapixels,
            aspectRatio: CUSTOM_ASPECT_RATIO,
            multiple: mult,
        };
    }

    updateOutputModeUI() {
        const taskKey = this.getTaskKey();
        const mixedMode = this.isMixedMode();
        const useSelector = mixedMode || this.isImageBatch() || this.isGenMode() || this.isFl2vMode()
            || NO_VIDEO_UPLOAD_TASKS.has(taskKey);
        // Gen / batch / fl2v / Mixed: aspect + megapixels, or Custom width/height.
        // Standalone source-video edit (v2v/rv2v): long_edge / fixed.
        if (this.outAspect) this.outAspect.classList.toggle("hidden", !useSelector);
        if (this.outMode) this.outMode.classList.toggle("hidden", useSelector);
        if (this.outLongWrap) this.outLongWrap.style.display = "";
        if (useSelector) {
            const activeOutput = mixedMode
                ? (this._ensureMixedTimeline().output || {})
                : (this.timeline.output || {});
            const custom = isCustomAspectRatio(activeOutput.aspectRatio ?? this.outAspect?.value);
            if (this.outMpWrap) this.outMpWrap.classList.toggle("hidden", custom);
            if (this.outLongWrap) this.outLongWrap.classList.add("hidden");
            if (this.outFixedWrap) this.outFixedWrap.classList.toggle("hidden", !custom);
            // Mixed has its own state object; never mutate standalone timeline.output here.
            if (!mixedMode) {
                if (custom) this.applyCustomResolution();
                else this.applyResolutionSelector();
            }
            return;
        }
        if (this.outMpWrap) this.outMpWrap.classList.add("hidden");
        const mode = this.timeline.output?.mode || "long_edge";
        const isFixed = mode === "fixed";
        if (this.outLongWrap) this.outLongWrap.classList.toggle("hidden", isFixed);
        if (this.outFixedWrap) this.outFixedWrap.classList.toggle("hidden", !isFixed);
    }

    updateOutputPreview() {
        if (!this.outPreview) return;
        if (this.isImageBatch() && (this.getTaskKey() === "i2i" || this.getTaskKey() === "i2v")) {
            const out = this.timeline.output || {};
            if ((out.mode || "long_edge") === "long_edge") {
                const src = this.getI2iSourceDimensions();
                const resolved = resolveOutputDimensions(src.width, src.height, out, {
                    refMaxSize: this.refMaxWidget?.value,
                }, this.getH3SpatialStride());
                const note = src.width > 0 ? "" : t("output.preview.needSourceForLongEdge");
                this.outPreview.textContent = `→ ${resolved.width}×${resolved.height}${note}${this._exportPreviewSuffix()}`;
            } else {
                const w = snapDim(+(out.width ?? this.outW?.value ?? 864));
                const h = snapDim(+(out.height ?? this.outH?.value ?? 480));
                this.outPreview.textContent = `→ ${w}×${h}${this._exportPreviewSuffix()}`;
            }
            return;
        }
        if (this.isGenBlank() || this.isImageBatch() || this.isFl2vMode() || this.isMixedMode()) {
            const out = this.isMixedMode()
                ? (this._ensureMixedTimeline().output || {})
                : (this.timeline.output || {});
            if (isCustomAspectRatio(out.aspectRatio)) {
                const w = snapResolutionDim(out.width ?? this.outW?.value ?? 864, out.multiple ?? MINIMAX_CANVAS_MULTIPLE);
                const h = snapResolutionDim(out.height ?? this.outH?.value ?? 480, out.multiple ?? MINIMAX_CANVAS_MULTIPLE);
                this.outPreview.textContent = t("output.preview.custom", { w, h }) + this._exportPreviewSuffix();
                return;
            }
            const resolved = resolutionFromSelector(
                out.aspectRatio || DEFAULT_ASPECT_RATIO,
                out.megapixels ?? DEFAULT_MEGAPIXELS,
                out.multiple ?? MINIMAX_CANVAS_MULTIPLE,
            );
            if (!resolved) {
                const w = snapResolutionDim(out.width ?? 864);
                const h = snapResolutionDim(out.height ?? 480);
                this.outPreview.textContent = `→ ${w}×${h}${this._exportPreviewSuffix()}`;
                return;
            }
            const w = resolved.width;
            const h = resolved.height;
            const ar = resolved.aspectRatio.split(" ")[0];
            this.outPreview.textContent = `→ ${w}×${h} · ${ar} · ${resolved.megapixels}MP${this._exportPreviewSuffix()}`;
            return;
        }
        const src = this.getSourceDimensions();
        const out = this.timeline.output || {};
        const resolved = resolveOutputDimensions(src.width, src.height, out, {
            width: this.widthWidget?.value,
            height: this.heightWidget?.value,
            refMaxSize: this.refMaxWidget?.value,
        }, this.getH3SpatialStride());
        if (src.width > 0 && src.height > 0) {
            const mode = (out.mode || "long_edge").toLowerCase();
            const note = mode === "long_edge"
                ? t("output.preview.scaleKeepAspect")
                : t("output.preview.fixedCrop");
            this.outPreview.textContent = `${src.width}×${src.height} → ${resolved.width}×${resolved.height}${note}${this._exportPreviewSuffix()}`;
        } else {
            this.outPreview.textContent = `→ ${resolved.width}×${resolved.height}${t("output.preview.needSourceForLongEdge")}${this._exportPreviewSuffix()}`;
        }
    }

    _exportPreviewSuffix() {
        const cap = this.getMaxExportFrames();
        const activeOutput = this.isMixedMode()
            ? this._ensureMixedTimeline().output
            : this.timeline.output;
        const exportMode = activeOutput?.exportMode === "segments"
            ? t("output.preview.segmentExport")
            : "";
        const dur = this.getTimelineDurationSec().toFixed(2);
        const fps = formatProbeFps(this.getFrameRate());
        const timeHint = t("output.preview.timeFps", { dur, fps });
        if (cap <= 0) return `${timeHint}${exportMode}`;
        const total = this.getTotalFrames();
        const exportTotal = this.getExportFrameTotal();
        if (exportTotal >= total) {
            return `${timeHint}${t("output.preview.exportFrames", { n: exportTotal })}${exportMode}`;
        }
        return `${timeHint}${t("output.preview.exportFramesPartial", { n: exportTotal, total })}${exportMode}`;
    }

    onOutputField(key, value) {
        if (this.isMixedMode()) {
            const state = this._ensureMixedTimeline();
            state.output = state.output || {};
            const out = state.output;
            out.mode = "fixed";
            out.multiple = out.multiple ?? MINIMAX_CANVAS_MULTIPLE;

            const applySelector = () => {
                if (isCustomAspectRatio(out.aspectRatio)) return;
                out.aspectRatio = normalizeAspectRatioLabel(out.aspectRatio || DEFAULT_ASPECT_RATIO);
                out.megapixels = clampMegapixels(out.megapixels ?? DEFAULT_MEGAPIXELS);
                const resolved = resolutionFromSelector(
                    out.aspectRatio,
                    out.megapixels,
                    out.multiple,
                );
                if (!resolved) return;
                out.aspectRatio = resolved.aspectRatio;
                out.megapixels = resolved.megapixels;
                out.multiple = resolved.multiple;
                out.width = resolved.width;
                out.height = resolved.height;
                out.longEdge = Math.max(resolved.width, resolved.height);
            };

            if (key === "aspectRatio") {
                if (isCustomAspectRatio(value)) {
                    out.aspectRatio = CUSTOM_ASPECT_RATIO;
                    out.width = snapResolutionDim(out.width ?? 864, out.multiple);
                    out.height = snapResolutionDim(out.height ?? 480, out.multiple);
                    out.longEdge = Math.max(out.width, out.height);
                } else {
                    out.aspectRatio = normalizeAspectRatioLabel(value || DEFAULT_ASPECT_RATIO);
                    applySelector();
                }
            } else if (key === "megapixels") {
                out.megapixels = clampMegapixels(value);
                applySelector();
            } else if (key === "width") {
                out.aspectRatio = CUSTOM_ASPECT_RATIO;
                out.width = snapResolutionDim(value || 864, out.multiple);
                out.height = snapResolutionDim(out.height ?? 480, out.multiple);
                out.longEdge = Math.max(out.width, out.height);
            } else if (key === "height") {
                out.aspectRatio = CUSTOM_ASPECT_RATIO;
                out.width = snapResolutionDim(out.width ?? 864, out.multiple);
                out.height = snapResolutionDim(value || 480, out.multiple);
                out.longEdge = Math.max(out.width, out.height);
            } else if (key === "maxExportFrames") {
                const n = Number.parseInt(value, 10);
                out.maxExportFrames = Number.isFinite(n) && n > 0 ? n : 0;
            } else if (key === "exportMode") {
                out.exportMode = value === "segments" ? "segments" : "all";
            } else if (key === "longEdge") {
                out.longEdge = Math.max(32, Number(value) || 32);
            } else if (key !== "audioMode" && key !== "mode") {
                out[key] = value;
            }

            out.audioMode = "generate";
            out.mode = "fixed";
            this.mixedTimeline = normalizeMixedTimeline(state);
            this._applyMixedSharedControls();
            this.scheduleTimelineSync();
            return;
        }
        this.timeline.output = this.timeline.output || {
            mode: "long_edge",
            aspectRatio: DEFAULT_ASPECT_RATIO,
            megapixels: DEFAULT_MEGAPIXELS,
            multiple: MINIMAX_CANVAS_MULTIPLE,
            longEdge: 848, width: 848, height: 480,
            maxExportFrames: 0, exportMode: "all",
            audioMode: "generate",
            continuityEnabled: false, continuityOverlapFrames: 9,
        };
        if (key === "aspectRatio") {
            if (isCustomAspectRatio(value)) {
                // Keep current computed size when entering custom mode.
                this.applyCustomResolution(
                    this.timeline.output.width ?? this.outW?.value,
                    this.timeline.output.height ?? this.outH?.value,
                );
            } else {
                this.applyResolutionSelector(value, null);
            }
        } else if (key === "megapixels") {
            const mp = clampMegapixels(value);
            if (!isCustomAspectRatio(this.timeline.output.aspectRatio)) {
                this.applyResolutionSelector(null, mp);
            } else {
                this.timeline.output.megapixels = mp;
            }
        } else if (key === "mode") {
            this.timeline.output.mode = value;
        } else if (key === "longEdge") {
            // Long-edge is a size budget, not a canvas dim — do not snap to 32
            // (848 would become 864). Final W/H still snap via resolveOutputDimensions.
            const n = Math.round(Number(value) || 864);
            this.timeline.output.longEdge = Math.max(32, n);
        } else if (key === "width") {
            const useSelector = this.isImageBatch() || this.isGenMode() || this.isFl2vMode()
                || NO_VIDEO_UPLOAD_TASKS.has(this.getTaskKey());
            if (useSelector) {
                this.applyCustomResolution(value, this.timeline.output.height ?? this.outH?.value);
            } else {
                this.timeline.output.width = snapDim(value || 864);
            }
        } else if (key === "height") {
            const useSelector = this.isImageBatch() || this.isGenMode() || this.isFl2vMode()
                || NO_VIDEO_UPLOAD_TASKS.has(this.getTaskKey());
            if (useSelector) {
                this.applyCustomResolution(this.timeline.output.width ?? this.outW?.value, value);
            } else {
                this.timeline.output.height = snapDim(value || 480);
            }
        } else if (key === "maxExportFrames") {
            const n = parseInt(value, 10);
            this.timeline.output.maxExportFrames = Number.isFinite(n) && n > 0 ? n : 0;
        } else if (key === "exportMode") {
            this.timeline.output.exportMode = value === "segments" ? "segments" : "all";
        } else if (key === "audioMode") {
            this.timeline.output.audioMode = normalizeAudioMode(value);
        } else if (key === "continuityEnabled") {
            this.timeline.output.continuityEnabled = !!value;
        } else if (key === "continuityOverlapFrames") {
            const n = parseInt(value, 10);
            this.timeline.output.continuityOverlapFrames = Number.isFinite(n)
                ? Math.max(1, Math.min(81, n))
                : 9;
        }
        this.syncOutputUIFromTimeline();
        if (this.isFl2vMode()) updateFl2vDetailUI(this);
        this.commit();
        this.flushTimelineSync();
    }

    syncOutputToWidgets() {
        if (this.isImageBatch() && (this.getTaskKey() === "i2i" || this.getTaskKey() === "i2v")) {
            const out = this.timeline.output || {};
            const mode = (out.mode || "long_edge").toLowerCase();
            if (mode === "long_edge") {
                const src = this.getI2iSourceDimensions();
                const resolved = resolveOutputDimensions(src.width, src.height, out, {
                    width: this.widthWidget?.value,
                    height: this.heightWidget?.value,
                    refMaxSize: this.refMaxWidget?.value,
                }, this.getH3SpatialStride());
                this.timeline.output = {
                    ...out,
                    mode: "long_edge",
                    longEdge: out.longEdge ?? resolved.refMaxSize,
                    width: resolved.width,
                    height: resolved.height,
                };
                if (this.widthWidget) this.widthWidget.value = resolved.width;
                if (this.heightWidget) this.heightWidget.value = resolved.height;
                if (this.refMaxWidget) this.refMaxWidget.value = resolved.refMaxSize;
                this.timeline.width = resolved.width;
                this.timeline.height = resolved.height;
                this.timeline.refMaxSize = resolved.refMaxSize;
            } else {
                const w = snapDim(+(out.width ?? this.widthWidget?.value ?? 864));
                const h = snapDim(+(out.height ?? this.heightWidget?.value ?? 480));
                this.timeline.output = { ...out, mode: "fixed", width: w, height: h };
                if (this.widthWidget) this.widthWidget.value = w;
                if (this.heightWidget) this.heightWidget.value = h;
                this.timeline.width = w;
                this.timeline.height = h;
            }
            this.updateOutputPreview();
            return;
        }
        if (this.isGenBlank() || this.isImageBatch() || this.isFl2vMode()) {
            const out = this.timeline.output || {};
            const resolved = isCustomAspectRatio(out.aspectRatio)
                ? this.applyCustomResolution(out.width, out.height)
                : this.applyResolutionSelector();
            this.timeline.width = resolved.width;
            this.timeline.height = resolved.height;
            this.timeline.refMaxSize = Math.max(resolved.width, resolved.height);
            this.updateOutputPreview();
            return;
        }
        const src = this.getSourceDimensions();
        const prevOut = this.timeline.output || {};
        const resolved = resolveOutputDimensions(src.width, src.height, prevOut, {
            width: this.timeline.width,
            height: this.timeline.height,
            refMaxSize: this.timeline.refMaxSize,
        }, this.getH3SpatialStride());
        // Preserve audioMode / aspect / megapixels etc. — do not rebuild a bare object.
        this.timeline.output = {
            ...prevOut,
            mode: resolved.mode,
            longEdge: prevOut.longEdge ?? resolved.refMaxSize,
            width: resolved.width,
            height: resolved.height,
            maxExportFrames: prevOut.maxExportFrames ?? 0,
            exportMode: prevOut.exportMode ?? "all",
            audioMode: normalizeAudioMode(prevOut.audioMode),
            continuityEnabled: isContinuityEnabled(prevOut),
            continuityOverlapFrames: Math.max(1, Math.min(81,
                parseInt(prevOut.continuityOverlapFrames ?? 9, 10) || 9)),
        };
        if (this.widthWidget) this.widthWidget.value = resolved.width;
        if (this.heightWidget) this.heightWidget.value = resolved.height;
        if (this.refMaxWidget) this.refMaxWidget.value = resolved.refMaxSize;
        this.timeline.width = resolved.width;
        this.timeline.height = resolved.height;
        this.timeline.refMaxSize = resolved.refMaxSize;
        this._refreshVideoStorageDimensions(resolved);
        this.updateOutputPreview();
    }

    syncFromWidgets() {
        if (this.isMixedMode()) { this._syncMixedFromSharedWidgets(); return; }
        this.timeline.global = this.timeline.global || { refs: [], referenceVideo: {}, continuousReference: false };
        this.timeline.global.taskType = this.globalTask?.value || this.taskTypeWidget?.value || "";
        this.timeline.global.prompt = this.globalPrompt?.value ?? this.globalPromptWidget?.value ?? "";
        if (this.continuousRefCb) {
            this.timeline.global.continuousReference = !!this.continuousRefCb.checked;
        }
        // fl2v: totalFrames stores the sampling window (总时长), not visual overflow length.
        this.timeline.totalFrames = this.isFl2vMode()
            ? getFl2vSampleFrames(this)
            : this.getTotalFrames();
        this.timeline.frameRate = this.getFrameRate();
        this.timeline.output = this.timeline.output || {
            mode: "long_edge", longEdge: 864, width: 864, height: 480,
            maxExportFrames: 0, exportMode: "all",
            audioMode: "generate",
            continuityEnabled: false, continuityOverlapFrames: 9,
        };
        if (this.timeline.output.audioMode == null) {
            this.timeline.output.audioMode = "generate";
        }
        if (this.segmentContinuityCb) {
            this.timeline.output.continuityEnabled = !!this.segmentContinuityCb.checked;
        }
        if (this.segmentContinuityOverlap) {
            const n = parseInt(this.segmentContinuityOverlap.value, 10);
            this.timeline.output.continuityOverlapFrames = Number.isFinite(n)
                ? Math.max(1, Math.min(81, n))
                : (this.timeline.output.continuityOverlapFrames ?? 9);
        }
        this.syncOutputToWidgets();
    }

    commit(skipRender = false, { syncTimeline = true } = {}) {
        if (this.isMixedMode()) {
            this._syncMixedFromSharedWidgets();
            this._normalizeMixedRunSelection();
            if (syncTimeline) this._writeTimelineWidget();
            this.updateVideoNameLabel?.();
            this.updateRunSelectUI?.();
            this.node?.setDirtyCanvas?.(true, false);
            return;
        }
        this.syncFromWidgets();
        this.normalizeSegments();
        if (this.isRunSelectEnabled()) this.normalizeRunSelection();
        this.updateRunSelectUI();
        if (this.taskTypeWidget) this.taskTypeWidget.value = this.timeline.global.taskType;
        if (this.globalPromptWidget) this.globalPromptWidget.value = this.timeline.global.prompt;
        if (this.negativePromptWidget) {
            const neg = this.globalNegative?.value ?? this.segNegative?.value ?? this.negativePromptWidget.value ?? "";
            this.negativePromptWidget.value = neg;
        }
        if (this.totalFramesWidget) {
            this.totalFramesWidget.value = Math.max(
                0,
                this.isFl2vMode() ? getFl2vSampleFrames(this) : this.getTotalFrames(),
            );
        }
        this.seekBar.max = Math.max(0, this.getTotalFrames() - 1);
        if (syncTimeline) this.scheduleTimelineSync();
        if (!skipRender) this.scheduleRender();
        if (!skipRender) {
            if (this.isGlobalMode() && taskUsesReferenceImages(this.getTaskKey())) {
                this.renderRefSlots(this.timeline.global.refs, this.globalRefsBox, true);
            } else if (this.isImageBatch()) this.renderImageBatchGroups();
            else this.updateSelectionUI();
        }
        refreshDirectorContinuityUi(this.node, this);
    }

    normalizeSegments() {
        if (this.isImageBatch()) {
            this.normalizeImageBatchSegments();
            return;
        }
        if (this.isFl2vMode()) {
            normalizeFl2vSegments(this);
            const n = this.timeline.segments?.length || 0;
            this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, n - 1));
            return;
        }
        if (this.isGenMode()) {
            this.normalizeGenSegments();
            return;
        }
        const total = this.getTotalFrames();
        let segs = [...this.timeline.segments].sort((a, b) => a.start - b.start);
        if (!total) {
            this.timeline.segments = [];
            this.timeline.totalFrames = 0;
            return;
        }
        if (!segs.length) segs = [{ id: uid(), start: 0, length: total, prompt: "", taskType: "", refs: [], referenceVideo: {} }];
        const fixed = [];
        let cursor = 0;
        for (const seg of segs) {
            const start = clamp(seg.start, cursor, total);
            let length = Math.max(MIN_SEG, seg.length ?? (total - start));
            if (start + length > total) length = total - start;
            if (length < MIN_SEG) continue;
            fixed.push({ ...seg, start, length, refs: seg.refs || [] });
            cursor = start + length;
        }
        if (fixed.length && cursor < total) fixed[fixed.length - 1].length += total - cursor;
        this.timeline.segments = fixed;
        this.timeline.totalFrames = total;
        this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, fixed.length - 1));
        this.updateSegmentContinuityUI();
    }

    getVideoViewUrl() {
        return this.getClipViewUrl(0);
    }

    getSourceFrameIndex(logicalFrame) {
        return this.getFrameMapEntry(logicalFrame).frame;
    }

    _getPreviewVideoForClip(clipIndex) {
        const url = this.getClipViewUrl(clipIndex);
        if (!this._previewVideos) this._previewVideos = new Map();
        if (clipIndex === 0 && this._previewVideo && !this._previewVideos.has(0)) {
            if (url) this._previewVideo.src = url;
            this._previewVideos.set(0, this._previewVideo);
        }
        if (!url) return this._previewVideos.get(clipIndex) || (clipIndex === 0 ? this._previewVideo : null);
        let v = this._previewVideos.get(clipIndex);
        if (!v) {
            v = document.createElement("video");
            v.crossOrigin = "anonymous";
            v.muted = true;
            v.playsInline = true;
            v.preload = "auto";
            v.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
            document.body.appendChild(v);
            v.src = url;
            this._previewVideos.set(clipIndex, v);
        } else if (url && v.src !== url && !String(v.src).includes(encodeURIComponent(url.split("/").pop()?.split("?")[0] || ""))) {
            v.src = url;
        }
        return v;
    }

    _restorePreviewVideos() {
        const clips = this.getVideoClips();
        if (!clips.length) return;
        for (let i = 0; i < clips.length; i++) this._getPreviewVideoForClip(i);
        this._previewVideo = this._previewVideos.get(0) || this._previewVideo;
    }

    _clearPreviewVideos(removeExtra = true) {
        if (!this._previewVideos) return;
        for (const [idx, v] of this._previewVideos.entries()) {
            v.pause();
            if (idx === 0 && v === this._previewVideo) {
                v.removeAttribute("src");
                v.load();
                continue;
            }
            if (removeExtra) {
                v.removeAttribute("src");
                v.load();
                v.remove();
            }
        }
        const keep = this._previewVideo;
        this._previewVideos.clear();
        if (keep) this._previewVideos.set(0, keep);
    }

    async _seekPreviewVideo(timeSec, clipIndex = 0) {
        this._seekChain = this._seekChain.then(() => new Promise((resolve) => {
            const v = this._getPreviewVideoForClip(clipIndex);
            if (!v?.src) { resolve(); return; }
            const target = Math.max(0, timeSec);
            const onSeeked = () => {
                v.removeEventListener("seeked", onSeeked);
                resolve();
            };
            v.addEventListener("seeked", onSeeked);
            try {
                v.currentTime = target;
            } catch {
                onSeeked();
                return;
            }
            if (Math.abs(v.currentTime - target) < 0.02 && v.readyState >= 2) {
                onSeeked();
            }
        }));
        return this._seekChain;
    }

    updateStageVisibility() {
        if (!this.stageEl) return;
        const show = this.hasVideo()
            && !this.isImageBatch()
            && !this.isGenMode()
            && !this.isFl2vMode();
        this.stageEl.classList.toggle("hidden", !show);
        if (!show) {
            if (this.stageVideo) {
                this.stageVideo.pause();
                this.stageVideo.classList.add("hidden");
            }
            this.stageImg?.classList.add("hidden");
            this.stageEmpty?.classList.remove("hidden");
            this.stageBadge?.classList.add("hidden");
            this._stageClipIndex = -1;
        } else {
            this._syncStagePreview(this.currentFrame, { force: true });
        }
        this.updateDomWidgetHeight();
        syncDirectorNodeSize(this.node, this);
    }

    _updateStageBadge(logicalFrame) {
        if (!this.stageBadge) return;
        const total = this.getTotalFrames();
        const frame = clamp(logicalFrame | 0, 0, Math.max(0, total - 1));
        const clips = this.getVideoClips();
        const entry = this.getFrameMapEntry(frame);
        const clipHint = clips.length > 1 ? t("canvas.clipHint", { n: entry.clip + 1 }) : "";
        this.stageBadge.textContent = t("player.frameOf", { cur: frame + 1, total, clip: clipHint });
        this.stageBadge.classList.remove("hidden");
    }

    _logicalRangeForClip(clipIndex) {
        const map = this.getFrameMap();
        let start = -1;
        let end = -1;
        for (let i = 0; i < map.length; i++) {
            const e = normalizeFrameMapEntry(map[i]);
            if (e.clip !== clipIndex) {
                if (start >= 0) break;
                continue;
            }
            if (start < 0) start = i;
            end = i + 1;
        }
        if (start < 0) return { start: 0, end: this.getTotalFrames() };
        return { start, end };
    }

    _logicalFromStageTime(clipIndex, timeSec) {
        const fps = Math.max(0.001, this.getFrameRate());
        const srcFrame = Math.max(0, Math.round(Number(timeSec) * fps));
        const map = this.getFrameMap();
        if (!map.length) {
            const logical = sourceToLogicalFrame(srcFrame, this.timeline.video || {});
            if (logical < 0) return -1; // source lands in a deleted gap
            return clamp(logical, 0, Math.max(0, this.getTotalFrames() - 1));
        }
        let first = -1;
        let best = -1;
        for (let i = 0; i < map.length; i++) {
            const e = normalizeFrameMapEntry(map[i]);
            if (e.clip !== clipIndex) continue;
            if (first < 0) first = i;
            if (e.frame === srcFrame) return i;
            if (e.frame <= srcFrame) best = i;
        }
        if (best >= 0) return best;
        if (first >= 0) return first;
        return 0;
    }

    /** Next logical index whose source frame is strictly after srcFrame (same clip). */
    _nextLogicalAfterSourceFrame(clipIndex, srcFrame) {
        const map = this.getFrameMap();
        if (!map.length) {
            // Sparse: walk forward until source maps to a kept logical frame.
            const total = this.getTotalFrames();
            const startLogical = sourceToLogicalFrame(srcFrame, this.timeline.video || {});
            const from = startLogical < 0 ? 0 : startLogical;
            for (let i = from; i < total; i++) {
                if (this.logicalToSourceFrame(i) > srcFrame) return i;
            }
            return -1;
        }
        for (let i = 0; i < map.length; i++) {
            const e = normalizeFrameMapEntry(map[i]);
            if (e.clip === clipIndex && e.frame > srcFrame) return i;
        }
        return -1;
    }

    _syncStagePreview(logicalFrame, { force = false } = {}) {
        if (!this.stageEl || this.stageEl.classList.contains("hidden")) return;
        if (!this.hasVideo()) {
            this.stageEmpty?.classList.remove("hidden");
            this.stageVideo?.classList.add("hidden");
            this.stageImg?.classList.add("hidden");
            return;
        }

        // During native playback, do not seek every tick (that causes stutter).
        // Only refresh the badge; playhead is driven from video.currentTime.
        if (this.isPlaying && !force && !this._legacyFrames.length) {
            this._updateStageBadge(logicalFrame);
            return;
        }

        const frame = clamp(logicalFrame | 0, 0, Math.max(0, this.getTotalFrames() - 1));
        const fps = Math.max(0.001, this.getFrameRate());

        if (this._legacyFrames.length) {
            const dataUrl = this._legacyFrames[frame];
            if (this.stageVideo) {
                this.stageVideo.pause();
                this.stageVideo.classList.add("hidden");
            }
            if (this.stageImg && dataUrl) {
                this.stageImg.src = dataUrl;
                this.stageImg.classList.remove("hidden");
                this.stageEmpty?.classList.add("hidden");
            }
            this._updateStageBadge(frame);
            return;
        }

        const entry = this.getFrameMapEntry(frame);
        const url = this.getClipViewUrl(entry.clip);
        const v = this.stageVideo;
        if (!v || !url) {
            this.stageEmpty?.classList.remove("hidden");
            return;
        }

        this.stageImg?.classList.add("hidden");
        this.stageEmpty?.classList.add("hidden");
        v.classList.remove("hidden");

        let sameSrc = false;
        if (v.src && url) {
            try {
                sameSrc = new URL(v.src, location.href).href === new URL(url, location.href).href;
            } catch {
                sameSrc = v.src === url;
            }
        }
        // Must reload when the file changes even if clip index stays 0 (replace upload).
        if (this._stageClipIndex !== entry.clip || !sameSrc) {
            this._stageClipIndex = entry.clip;
            if (!sameSrc) {
                v.pause();
                v.src = url;
                v.load();
            }
        }

        const target = Math.max(0, entry.frame / fps);
        if (force || Math.abs(v.currentTime - target) > 0.035) {
            try {
                v.currentTime = target;
            } catch {
                /* ignore seek races while loading */
            }
        }
        if (this.isPlaying && force) {
            v.play().catch(() => {});
        }
        this._updateStageBadge(frame);
    }

    async _ensureStageReadyForFrame(logicalFrame) {
        this._syncStagePreview(logicalFrame, { force: true });
        const v = this.stageVideo;
        if (!v || this._legacyFrames.length) return false;
        if (v.readyState >= 2) return true;
        await new Promise((resolve) => {
            const done = () => {
                v.removeEventListener("loadeddata", done);
                v.removeEventListener("canplay", done);
                resolve();
            };
            v.addEventListener("loadeddata", done);
            v.addEventListener("canplay", done);
            setTimeout(done, 800);
        });
        return true;
    }

    _queueThumbPrefetch(logicalFrame) {
        if (this.isPlaying) return;
        if (this._thumbCache.has(logicalFrame) || this._thumbPending.has(logicalFrame)) return;
        if (!this.hasVideo() && !this._legacyFrames.length) return;
        this._thumbPending.add(logicalFrame);
        this._fetchThumb(logicalFrame).then((img) => {
            this._thumbPending.delete(logicalFrame);
            if (img) this._thumbCache.set(logicalFrame, img);
            this.scheduleRender();
        });
    }

    /** Capture a still from an r2v reference video for the timeline strip. */
    _queueR2vVideoThumb(cacheKey, videoFile, type = "input") {
        if (!cacheKey || !videoFile) return;
        if (this._thumbCache.has(cacheKey) || this._thumbPending.has(cacheKey)) return;
        this._thumbPending.add(cacheKey);
        const url = inputViewUrl(videoFile, type || "input");
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.crossOrigin = "anonymous";
        let done = false;
        const finish = (img) => {
            if (done) return;
            done = true;
            this._thumbPending.delete(cacheKey);
            try {
                v.removeAttribute("src");
                v.load();
            } catch (_) { /* ignore */ }
            if (img) this._thumbCache.set(cacheKey, img);
            this.scheduleRender();
        };
        const capture = () => {
            try {
                if (!v.videoWidth) {
                    finish(null);
                    return;
                }
                if (!this._thumbCanvas) {
                    this._thumbCanvas = document.createElement("canvas");
                    this._thumbCtx = this._thumbCanvas.getContext("2d", { alpha: false });
                }
                const ratio = v.videoWidth > THUMB_MAX_W ? THUMB_MAX_W / v.videoWidth : 1;
                const tw = Math.max(1, Math.round(v.videoWidth * ratio));
                const th = Math.max(1, Math.round(v.videoHeight * ratio));
                this._thumbCanvas.width = tw;
                this._thumbCanvas.height = th;
                this._thumbCtx.drawImage(v, 0, 0, tw, th);
                const img = new Image();
                img.onload = () => finish(img);
                img.onerror = () => finish(null);
                img.src = this._thumbCanvas.toDataURL("image/jpeg", THUMB_JPEG_Q);
            } catch (_) {
                finish(null);
            }
        };
        v.addEventListener("loadeddata", () => {
            const seekTo = Math.min(0.15, Math.max(0, (v.duration || 1) * 0.05));
            const onSeeked = () => {
                v.removeEventListener("seeked", onSeeked);
                capture();
            };
            v.addEventListener("seeked", onSeeked);
            try {
                v.currentTime = seekTo;
            } catch (_) {
                capture();
            }
            setTimeout(() => {
                if (!done) capture();
            }, 700);
        }, { once: true });
        v.onerror = () => finish(null);
        v.src = url;
    }

    async _fetchThumb(logicalFrame) {
        if (this._legacyFrames.length) {
            const dataUrl = this._legacyFrames[logicalFrame];
            if (!dataUrl) return null;
            return this._decodeThumb(dataUrl);
        }
        const entry = this.getFrameMapEntry(logicalFrame);
        const v = this._getPreviewVideoForClip(entry.clip);
        if (!v?.src || !v.videoWidth) return null;
        const t = Math.max(0, entry.frame / this.getFrameRate());
        await this._seekPreviewVideo(t, entry.clip);
        const ratio = v.videoWidth > THUMB_MAX_W ? THUMB_MAX_W / v.videoWidth : 1;
        const tw = Math.max(1, Math.round(v.videoWidth * ratio));
        const th = Math.max(1, Math.round(v.videoHeight * ratio));
        this._thumbCanvas.width = tw;
        this._thumbCanvas.height = th;
        this._thumbCtx.drawImage(v, 0, 0, tw, th);
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = this._thumbCanvas.toDataURL("image/jpeg", THUMB_JPEG_Q);
        });
    }

    _clearVideoState() {
        this._thumbCache.clear();
        this._thumbPending.clear();
        this._legacyFrames = [];
        this.timeline.videoClips = [];
        this.timeline.videoWorkspace = null;
        // Wipe video identity BEFORE visibility sync — otherwise hasVideo() stays
        // true via the old videoFile and stage reloads the previous clip.
        this.timeline.video = {
            fileName: "",
            videoFile: "",
            subfolder: "",
            type: "input",
            frames: [],
            frameMap: [],
            deletedSourceRanges: [],
            sourceFrameCount: 0,
            width: 0,
            height: 0,
        };
        this.timeline.totalFrames = 0;
        this._storageWidth = 0;
        this._storageHeight = 0;
        this._clearPreviewVideos(true);
        if (this._previewVideo) {
            this._previewVideo.pause();
            this._previewVideo.removeAttribute("src");
            this._previewVideo.load();
        }
        if (this.stageVideo) {
            this.stageVideo.pause();
            this.stageVideo.removeAttribute("src");
            this.stageVideo.load();
            this.stageVideo.classList.add("hidden");
        }
        this.stageImg?.classList.add("hidden");
        if (this.stageImg) this.stageImg.removeAttribute("src");
        this.stageEmpty?.classList.remove("hidden");
        this.stageBadge?.classList.add("hidden");
        this._stageClipIndex = -1;
        this.updateStageVisibility();
    }

    _resetTimelineForReplaceUpload() {
        this._clearVideoState();
        this.timeline.segments = [];
        this.selectedIndex = 0;
        this.currentFrame = 0;
        if (this.seekBar) {
            this.seekBar.value = 0;
            this.seekBar.max = 0;
        }
    }

    _setSingleSegment(totalFrames) {
        const total = Math.max(0, totalFrames);
        this.timeline.segments = total > 0
            ? [{ id: uid(), start: 0, length: total, prompt: "", taskType: "", refs: [], referenceVideo: {} }]
            : [];
        this.selectedIndex = 0;
        this.currentFrame = 0;
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, total - 1);
            this.seekBar.value = 0;
        }
    }

    restoreVideoFromTimeline() {
        const video = this.timeline.video || {};
        this._storageWidth = video.storageWidth || 0;
        this._storageHeight = video.storageHeight || 0;

        const legacy = video.frames || [];
        if (legacy.length && !video.videoFile) {
            this._legacyFrames = legacy;
            this.setFrameMap(buildIdentityFrameMap(legacy.length));
            this.videoNameEl.textContent = t("videoName.legacy", {
                name: video.fileName || t("videoName.defaultVideo"),
                frames: legacy.length,
            });
            this._prefetchSegmentThumbs(0, legacy.length);
            this.updateStageVisibility();
            return;
        }

        if (!video.videoFile) {
            this._clearVideoState();
            return;
        }

        this._restorePreviewVideos();
        const n = this.getTotalFrames();
        this._prefetchSegmentThumbs(0, Math.min(n, THUMB_PREFETCH_BATCH * 4));
        this.updateVideoNameLabel();
        if (taskUsesReferenceVideo(this.getTaskKey()) && this.getReferenceVideoViewUrl(this.timeline.global?.referenceVideo)) {
            this.renderRefVideoSlot();
        }
        this.updateStageVisibility();
    }

    _prefetchSegmentThumbs(from, to) {
        for (let f = from; f < to; f++) this._queueThumbPrefetch(f);
    }

    _decodeThumb(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                if (!img.naturalWidth || img.naturalWidth <= THUMB_MAX_W) {
                    resolve(img);
                    return;
                }
                const ratio = THUMB_MAX_W / img.naturalWidth;
                const w = THUMB_MAX_W;
                const h = Math.max(1, Math.round(img.naturalHeight * ratio));
                const c = document.createElement("canvas");
                c.width = w;
                c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                const thumb = new Image();
                thumb.onload = () => resolve(thumb);
                thumb.onerror = () => resolve(img);
                thumb.src = c.toDataURL("image/jpeg", THUMB_JPEG_Q);
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl.startsWith("data:") ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
        });
    }

    pickVideoFile() {
        if (this.isFl2vMode()) {
            openFl2vUpload(this);
            return;
        }
        const input = document.createElement("input");
        input.type = "file"; input.accept = "video/*";
        input.onchange = () => { if (input.files?.[0]) this.loadVideoFile(input.files[0]); };
        input.click();
    }

    pickAppendVideoFile() {
        if (!this.hasVideo()) {
            this.showBdMessage(
                t("dialog.appendVideoTitle"),
                t("dialog.appendVideoNeedFirst")
            );
            return;
        }
        const input = document.createElement("input");
        input.type = "file"; input.accept = "video/*";
        input.onchange = () => { if (input.files?.[0]) this.appendVideoFile(input.files[0]); };
        input.click();
    }

    async appendVideoFile(file) {
        const btn = this.root.querySelector('[data-a="video-append"]');
        if (btn) { btn.disabled = true; btn.textContent = t("common.uploading"); }
        this.videoNameEl.textContent = t("upload.appendProgress", { name: file.name });
        try {
            const uploaded = await uploadToInputSmart(file, (frac, cur, total) => {
                const pct = Math.round(frac * 100);
                const mode = file.size > COMFY_UPLOAD_SOFT_LIMIT ? t("upload.chunkMode") : t("upload.mode");
                this.videoNameEl.textContent = t("upload.appendChunk", {
                    mode, name: file.name, cur, total, pct,
                });
            });
            const relPath = videoRelativePath(uploaded);
            await this._applyAppendedVideo({
                fileName: file.name,
                relPath,
                subfolder: uploaded.subfolder || "",
                type: uploaded.type || "input",
                statusPrefix: t("parse.prefix"),
            });
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] append video failed:", err);
            this.videoNameEl.textContent = t("upload.appendFailed", { err: formatUploadError(err) });
            this.updateVideoNameLabel();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = t("toolbar.appendVideo");
            }
        }
    }

    async loadVideoFile(file) {
        const btn = this.root.querySelector('[data-a="video"]');
        if (btn) { btn.disabled = true; btn.textContent = t("common.uploading"); }
        this.videoNameEl.textContent = t("upload.inProgress", { name: file.name });
        try {
            this._resetTimelineForReplaceUpload();
            const uploaded = await uploadToInputSmart(file, (frac, cur, total) => {
                const pct = Math.round(frac * 100);
                const mode = file.size > COMFY_UPLOAD_SOFT_LIMIT ? t("upload.chunkMode") : t("upload.mode");
                this.videoNameEl.textContent = t("upload.loadChunk", {
                    mode, name: file.name, cur, total, pct,
                });
            });
            const relPath = videoRelativePath(uploaded);
            await this._applyLoadedVideo({
                fileName: file.name,
                relPath,
                subfolder: uploaded.subfolder || "",
                type: uploaded.type || "input",
                statusPrefix: t("parse.prefix"),
            });
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] video load failed:", err);
            this.videoNameEl.textContent = t("upload.loadFailed", { err: formatUploadError(err) });
            this._resetTimelineForReplaceUpload();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = t("toolbar.uploadVideo");
            }
        }
    }

    _closeBdModal() {
        if (this._modalKeyHandler) {
            window.removeEventListener("keydown", this._modalKeyHandler, true);
            this._modalKeyHandler = null;
        }
        if (this._modalEl) {
            this._modalEl.remove();
            this._modalEl = null;
        }
    }

    showBdMessage(title, message) {
        return this.showBdDialog({ title, message, confirmText: t("dialog.confirm"), cancelText: null });
    }

    showBdDialog(opts = {}) {
        const { title, message, items } = opts;
        const confirmText = opts.confirmText ?? t("dialog.confirm");
        const cancelText = Object.prototype.hasOwnProperty.call(opts, "cancelText")
            ? opts.cancelText
            : t("dialog.cancel");
        return new Promise((resolve) => {
            this._closeBdModal();

            const overlay = document.createElement("div");
            overlay.className = "bd-modal-overlay";
            const panel = document.createElement("div");
            panel.className = "bd-modal";
            panel.innerHTML = `
                <div class="bd-modal-title"></div>
                <div class="bd-modal-body hidden"></div>
                <div class="bd-modal-list hidden"></div>
                <div class="bd-modal-actions"></div>`;

            panel.querySelector(".bd-modal-title").textContent = title || "";

            const bodyEl = panel.querySelector(".bd-modal-body");
            const listEl = panel.querySelector(".bd-modal-list");
            const actionsEl = panel.querySelector(".bd-modal-actions");

            let selectedValue = items?.length ? items[0].value : null;

            const finish = (val) => {
                this._closeBdModal();
                resolve(val);
            };

            if (message) {
                bodyEl.textContent = message;
                bodyEl.classList.remove("hidden");
            }

            if (items?.length) {
                listEl.classList.remove("hidden");
                for (const item of items) {
                    const row = document.createElement("div");
                    row.className = "bd-modal-item";
                    row.textContent = item.label ?? item.value;
                    row.title = item.label ?? item.value;
                    row.dataset.value = item.value;
                    if (item.value === selectedValue) row.classList.add("selected");
                    row.onclick = () => {
                        selectedValue = item.value;
                        for (const el of listEl.querySelectorAll(".bd-modal-item")) {
                            el.classList.toggle("selected", el === row);
                        }
                    };
                    row.ondblclick = () => finish(item.value);
                    listEl.appendChild(row);
                }
            }

            if (cancelText) {
                const cancelBtn = document.createElement("button");
                cancelBtn.type = "button";
                cancelBtn.className = "bd-btn";
                cancelBtn.textContent = cancelText;
                cancelBtn.onclick = () => finish(null);
                actionsEl.appendChild(cancelBtn);
            }

            const okBtn = document.createElement("button");
            okBtn.type = "button";
            okBtn.className = "bd-btn bd-btn-primary";
            okBtn.textContent = confirmText;
            okBtn.onclick = () => finish(items?.length ? selectedValue : true);
            actionsEl.appendChild(okBtn);

            overlay.onclick = (e) => {
                if (e.target === overlay && cancelText) finish(null);
            };
            panel.onclick = (e) => e.stopPropagation();

            this._modalKeyHandler = (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(cancelText ? null : true);
                } else if (e.key === "Enter" && items?.length) {
                    e.preventDefault();
                    finish(selectedValue);
                }
            };
            window.addEventListener("keydown", this._modalKeyHandler, true);

            overlay.appendChild(panel);
            this.root.appendChild(overlay);
            this._modalEl = overlay;
            okBtn.focus();
        });
    }

    async _prepareVideoFrames({ fileName, relPath, subfolder, type, statusPrefix, syncNativeFps = true }) {
        this.videoNameEl.textContent = `${statusPrefix}: ${fileName}…`;
        const viewUrl = inputViewUrl(relPath, type || "input");

        let serverProbe = null;
        try {
            serverProbe = await this.probeVideoFile(relPath, subfolder, type);
        } catch (err) {
            console.warn("[MiniMax H3 Motion Director] video probe failed, using browser estimate:", err);
        }
        const browserMeta = await this.probeVideoMetadata(viewUrl);
        const nativeFps = Number(serverProbe?.native_fps || 0);
        const nativeFrameCount = Number(serverProbe?.frame_count || 0);
        const meta = {
            width: Number(serverProbe?.width || browserMeta.width || 0),
            height: Number(serverProbe?.height || browserMeta.height || 0),
            duration: Number(serverProbe?.duration ?? browserMeta.duration ?? 0),
            nativeFps,
            nativeFrameCount,
            probeMethod: serverProbe?.probe_method || "browser_estimate",
        };

        if (syncNativeFps && nativeFps > 0) {
            this.syncFrameRateUI(nativeFps);
        }

        const fps = this.getFrameRate();
        const totalFrames = Math.max(
            1,
            Math.round(meta.duration * fps) || nativeFrameCount,
        );

        const store = resolveOutputDimensions(meta.width, meta.height, this.timeline.output || { mode: "long_edge", longEdge: 864 }, {
            refMaxSize: this.refMaxWidget?.value,
        }, this.getH3SpatialStride());

        return { fileName, relPath, subfolder, type, meta, totalFrames, store, viewUrl };
    }

    async probeVideoFile(relPath, subfolder = "", type = "input") {
        const resp = await api.fetchApi("/minimax/motion-director/probe_video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoFile: relPath, subfolder, type: type || "input" }),
        });
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return resp.json();
    }

    _buildClipRecord({ fileName, relPath, subfolder, type, meta, totalFrames, store }) {
        return {
            id: uid(),
            fileName,
            videoFile: relPath,
            subfolder: subfolder || "",
            type: type || "input",
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            nativeFps: meta.nativeFps || null,
            nativeFrameCount: meta.nativeFrameCount || null,
            sourceFrameCount: totalFrames,
            storageWidth: store.width,
            storageHeight: store.height,
        };
    }

    _syncPrimaryVideoFromClips(frameMap) {
        const clips = this.getVideoClips();
        const primary = clips[0] || {};
        const prev = this.timeline.video || {};
        const map = Array.isArray(frameMap) ? frameMap : (prev.frameMap || []);
        this.timeline.video = {
            ...prev,
            ...primary,
            // Keep path/type from the clip record, but never drop timeline edits.
            fileName: primary.fileName || prev.fileName || "",
            videoFile: primary.videoFile || prev.videoFile || "",
            subfolder: primary.subfolder ?? prev.subfolder ?? "",
            type: primary.type || prev.type || "input",
            frames: prev.frames || [],
            frameMap: map,
            // Explicit map already encodes deletes; sparse mode keeps ranges.
            deletedSourceRanges: map.length ? [] : (prev.deletedSourceRanges || []),
            sourceFrameCount: prev.sourceFrameCount || primary.sourceFrameCount || map.length || 0,
        };
        if (map.length) this.timeline.totalFrames = map.length;
    }

    async _applyLoadedVideo({ fileName, relPath, subfolder, type, statusPrefix }) {
        const prep = await this._prepareVideoFrames({ fileName, relPath, subfolder, type, statusPrefix });
        const { totalFrames, store, viewUrl } = prep;

        this._storageWidth = store.width;
        this._storageHeight = store.height;
        const clip = this._buildClipRecord(prep);

        this.timeline.videoClips = [clip];
        this.setSparseVideoFrames(totalFrames);
        this._syncPrimaryVideoFromClips([]);
        this._setSingleSegment(totalFrames);

        this._clearPreviewVideos(true);
        this._previewVideo = this._getPreviewVideoForClip(0);
        if (this._previewVideo && viewUrl) this._previewVideo.src = viewUrl;

        // Force stage to drop any previous media before binding the new clip.
        this._stageClipIndex = -1;
        if (this.stageVideo) {
            this.stageVideo.pause();
            this.stageVideo.removeAttribute("src");
            this.stageVideo.load();
        }
        this.currentFrame = 0;

        if (this.totalFramesWidget) this.totalFramesWidget.value = totalFrames;
        this.syncOutputUIFromTimeline();
        this.updateVideoNameLabel();
        this._prefetchSegmentThumbs(0, Math.min(totalFrames, THUMB_PREFETCH_BATCH * 4));
        this.updateStageVisibility();
        this._syncStagePreview(0, { force: true });
        this.commit(false, { syncTimeline: true });
    }

    async _applyAppendedVideo({ fileName, relPath, subfolder, type, statusPrefix }) {
        const prep = await this._prepareVideoFrames({
            fileName, relPath, subfolder, type, statusPrefix,
            syncNativeFps: false,
        });
        const { totalFrames, store } = prep;

        this._ensureVideoClipsArray();
        const clipIndex = this.timeline.videoClips.length;
        const clip = this._buildClipRecord(prep);
        this.timeline.videoClips.push(clip);

        const prevTotal = this.getTotalFrames();
        if (!this.getFrameMap().length && prevTotal > 0) {
            this.materializeFrameMap();
        }
        const newEntries = buildClipFrameMap(clipIndex, totalFrames);
        const map = [...this.getFrameMap(), ...newEntries];
        this.setFrameMap(map);
        this.timeline.totalFrames = map.length;
        this._syncPrimaryVideoFromClips(map);

        this._getPreviewVideoForClip(clipIndex);

        this.timeline.segments.push({
            id: uid(),
            start: prevTotal,
            length: totalFrames,
            prompt: "",
            taskType: "",
            refs: [],
            referenceVideo: {},
            videoClipId: clip.id,
        });

        if (this.totalFramesWidget) this.totalFramesWidget.value = map.length;
        this.selectedIndex = this.timeline.segments.length - 1;
        this.currentFrame = prevTotal;
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, map.length - 1);
            this.seekBar.value = this.currentFrame;
        }

        this.normalizeSegments();
        this.syncOutputUIFromTimeline();
        this.updateVideoNameLabel();
        this._prefetchSegmentThumbs(prevTotal, Math.min(prevTotal + totalFrames, prevTotal + THUMB_PREFETCH_BATCH * 4));
        this.updateStageVisibility();
        this.commitSegmentStructureMutation(false);
    }

    async probeVideoMetadata(url) {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        await new Promise((res, rej) => {
            video.onloadedmetadata = () => res();
            video.onerror = () => rej(new Error(t("upload.metaReadFailed")));
        });
        return {
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            duration: video.duration || 0,
        };
    }

    onNodeResize() {
        // Node resizing only affects the compact launcher; editor layout follows
        // the page-root modal's own ResizeObserver/window resize events.
        this.node?.setDirtyCanvas?.(true, true);
    }

    onDirectorModalResize() {
        if (!this._directorModalOpen) return;
        if (this.isPlaying || this._pauseSettling) return;
        this._resetLayoutStyles();
        this.applyZoomWidth();
        this.scheduleSettleRender();
    }

    applyZoomWidth() {
        if (!this.canvas) return;
        if (this.zoom <= 1) {
            this.canvas.style.width = "100%";
            return;
        }
        const base = this.viewport?.clientWidth || 960;
        this.canvas.style.width = `${Math.max(base, base * this.zoom)}px`;
    }

    adjustZoom(delta) {
        this.zoom = clamp(this.zoom + delta, 1, 10);
        this.zoomSlider.value = this.zoom;
        this.applyZoomWidth();
        this.scheduleRender();
    }

    frameToX(frame, width) { return (frame / Math.max(1, this.getTotalFrames())) * width; }
    xToFrame(x, width) { return clamp(Math.round((x / width) * this.getTotalFrames()), 0, this.getTotalFrames()); }

    getLayoutWidth() {
        return this._drawWidth || this._measureDrawWidth();
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const layoutW = this.getLayoutWidth();
        const layoutH = this.canvasHeight || (RULER_H + SEG_LABEL_H + TRACK_H);
        const scaleX = rect.width > 0 ? layoutW / rect.width : 1;
        const scaleY = rect.height > 0 ? layoutH / rect.height : 1;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    }

    /** Shared draw + hit geometry for per-segment run checkboxes (segment top-left). */
    _runCheckGeometry(seg, width) {
        const x0 = this.frameToX(seg.start, width);
        const size = RUN_CHECK_SIZE;
        const boxX = x0 + 5;
        const boxY = TRACK_Y + 5;
        return {
            boxX,
            boxY,
            size,
            hitX0: boxX - RUN_CHECK_HIT_PAD_X,
            hitY0: boxY - RUN_CHECK_HIT_PAD_Y,
            hitX1: boxX + size + RUN_CHECK_HIT_PAD_X,
            hitY1: boxY + size + RUN_CHECK_HIT_PAD_Y,
        };
    }

    _contextLinkGeometry(index, width, segs = this.timeline.segments) {
        const seg = segs?.[index];
        if (!seg || index <= 0) return null;
        return {
            x: this.frameToX(seg.start, width),
            y: TRACK_Y + CONTEXT_LINK_RADIUS + 3,
            radius: CONTEXT_LINK_RADIUS,
        };
    }

    /** Draw fl2v edge grips; joints are split (top=prev yellow, bottom=next cyan). */
    _drawFl2vEdgeHandles(segs, index, x0, x1, width) {
        const ordered = (segs || [])
            .map((seg, i) => ({ seg, i }))
            .sort((a, b) => a.seg.start - b.seg.start || a.i - b.i);
        const rank = ordered.findIndex((o) => o.i === index);
        if (rank < 0) return;
        const prev = rank > 0 ? ordered[rank - 1] : null;
        const next = rank < ordered.length - 1 ? ordered[rank + 1] : null;
        const prevX1 = prev
            ? this.frameToX(prev.seg.start + prev.seg.length, width)
            : null;
        const nextX0 = next ? this.frameToX(next.seg.start, width) : null;
        const jointLeft = prev != null && Math.abs(prevX1 - x0) <= 2;
        const jointRight = next != null && Math.abs(nextX0 - x1) <= 2;
        const mid = TRACK_Y + TRACK_H / 2;
        const half = Math.max(10, TRACK_H / 2 - 6);

        if (!jointLeft) {
            this.ctx.fillStyle = "#ffcc00";
            this.ctx.fillRect(x0 - 2, mid - 12, 4, 24);
        }
        if (jointRight) {
            // Draw once on the left segment of the joint.
            this.ctx.fillStyle = "#ffcc00";
            this.ctx.fillRect(x1 - 2, TRACK_Y + 4, 4, half);
            this.ctx.fillStyle = "#5ec8ff";
            this.ctx.fillRect(x1 - 2, mid + 2, 4, half);
            this.ctx.fillStyle = "rgba(255,255,255,0.85)";
            this.ctx.fillRect(x1 - 3, mid - 1, 6, 2);
        } else {
            this.ctx.fillStyle = "#ffcc00";
            this.ctx.fillRect(x1 - 2, mid - 12, 4, 24);
        }
    }

    /**
     * fl2v edge handles: top half → previous clip's right edge;
     * bottom half → next clip's left edge.
     */
    _hitTestFl2vEdge(x, y, width, segs) {
        const ordered = (segs || [])
            .map((seg, index) => ({ seg, index }))
            .sort((a, b) => a.seg.start - b.seg.start || a.index - b.index);
        if (!ordered.length) return null;
        const trackMid = TRACK_Y + TRACK_H / 2;
        const preferNext = y >= trackMid;
        let best = null;
        let bestDist = HANDLE_PX + 1;

        for (let r = 0; r < ordered.length; r++) {
            const { seg, index } = ordered[r];
            const x0 = this.frameToX(seg.start, width);
            const x1 = this.frameToX(seg.start + seg.length, width);
            const prev = r > 0 ? ordered[r - 1] : null;
            const next = r < ordered.length - 1 ? ordered[r + 1] : null;
            const prevX1 = prev
                ? this.frameToX(prev.seg.start + prev.seg.length, width)
                : null;
            const nextX0 = next ? this.frameToX(next.seg.start, width) : null;
            const jointLeft = prev != null && Math.abs(prevX1 - x0) <= 2;
            const jointRight = next != null && Math.abs(nextX0 - x1) <= 2;

            const d0 = Math.abs(x - x0);
            if (d0 <= HANDLE_PX && d0 < bestDist) {
                if (jointLeft) {
                    best = preferNext
                        ? { type: "edge", index, edge: "left" }
                        : { type: "edge", index: prev.index, edge: "right" };
                } else {
                    best = { type: "edge", index, edge: "left" };
                }
                bestDist = d0;
            }
            const d1 = Math.abs(x - x1);
            if (d1 <= HANDLE_PX && d1 < bestDist) {
                if (jointRight) {
                    best = preferNext
                        ? { type: "edge", index: next.index, edge: "left" }
                        : { type: "edge", index, edge: "right" };
                } else {
                    best = { type: "edge", index, edge: "right" };
                }
                bestDist = d1;
            }
        }
        return best;
    }

    hitTest(x, y) {
        const width = this.getLayoutWidth();
        if (!width) return null;
        const segs = this._previewSegments || this.timeline.segments;
        const phx = this.frameToX(this.currentFrame, width);
        const trackBottom = TRACK_Y + TRACK_H;

        if (y <= RULER_H) {
            if (Math.abs(x - phx) <= HANDLE_PX) return { type: "playhead" };
            return { type: "ruler" };
        }

        for (let i = 1; i < segs.length; i++) {
            const g = this._contextLinkGeometry(i, width, segs);
            if (g && Math.hypot(x - g.x, y - g.y) <= g.radius + 4) {
                return { type: "context-link", index: i };
            }
        }

        // Checkbox corner wins over generic segment hit (same toggle action either way
        // in run-select mode; keeps hit type accurate for cursor / future hooks).
        if (this.isRunSelectEnabled() && this.getRunnableSegmentCount() >= 2 && y >= TRACK_Y && y <= trackBottom) {
            for (let i = segs.length - 1; i >= 0; i--) {
                if (this.isFl2vMode() && !segs[i]?.isStartFrame) continue;
                const g = this._runCheckGeometry(segs[i], width);
                if (x >= g.hitX0 && x <= g.hitX1 && y >= g.hitY0 && y <= g.hitY1) {
                    return { type: "run-check", index: i };
                }
            }
        }

        // Split markers: label band + full track height, before segment/edge hits.
        // (Previously label band returned null, so diamond clicks never registered.)
        if (y >= RULER_H && y <= trackBottom) {
            const hitPad = Math.max(HANDLE_PX, 12);
            let best = null;
            let bestDist = hitPad + 1;
            for (const frame of this.getEditableSplitFrames()) {
                const sx = this.frameToX(frame, width);
                const dist = Math.abs(x - sx);
                if (dist <= hitPad && dist < bestDist) {
                    bestDist = dist;
                    best = { type: "split", frame };
                }
            }
            if (best) return best;
        }

        if (y < TRACK_Y) return null;

        // Edge handles first so fl2v/gen can drag-extend duration (repeat thumbs).
        if (y >= TRACK_Y && y <= trackBottom) {
            if (this.isFl2vMode()) {
                const flHit = this._hitTestFl2vEdge(x, y, width, segs);
                if (flHit) return flHit;
            } else {
                for (let i = 0; i < segs.length; i++) {
                    const seg = segs[i];
                    const x0 = this.frameToX(seg.start, width);
                    const x1 = this.frameToX(seg.start + seg.length, width);
                    if (Math.abs(x - x0) <= HANDLE_PX) return { type: "edge", index: i, edge: "left" };
                    if (Math.abs(x - x1) <= HANDLE_PX) return { type: "edge", index: i, edge: "right" };
                }
            }
        }

        for (let i = segs.length - 1; i >= 0; i--) {
            const seg = segs[i];
            const x0 = this.frameToX(seg.start, width);
            const x1 = this.frameToX(seg.start + seg.length, width);
            const isLast = i === segs.length - 1;
            const insideX = isLast ? (x >= x0 && x <= x1) : (x >= x0 && x < x1);
            if (insideX && y >= TRACK_Y && y <= trackBottom) {
                return { type: "segment", index: i };
            }
        }

        if (Math.abs(x - phx) <= HANDLE_PX) return { type: "playhead" };
        return null;
    }

    onMouseDown(e) {
        if (e.button !== 0) return;
        // Keep LiteGraph / node drag from eating timeline clicks.
        stopDomEvent(e);
        e.preventDefault();
        const { x, y } = this.getMousePos(e);
        const hit = this.hitTest(x, y);
        if (!hit) {
            if (
                this.isFl2vMode()
                && !(this.timeline.segments || []).length
                && y >= TRACK_Y
                && y <= TRACK_Y + TRACK_H
            ) {
                openFl2vUpload(this);
            } else if (
                this.isR2vBatch()
                && !(this.timeline.segments || []).length
                && y >= TRACK_Y
                && y <= TRACK_Y + TRACK_H
            ) {
                addImageBatchGroup(this);
            }
            return;
        }
        const width = this.getLayoutWidth();
        if (hit.type === "playhead" || hit.type === "ruler") {
            this.currentFrame = this.xToFrame(x, width);
            this._drag = { kind: "playhead" };
            this.clearSplitSelection();
        } else if (hit.type === "run-check") {
            this.toggleSegmentRun(hit.index);
            this._drag = null;
        } else if (hit.type === "context-link") {
            this.toggleSegmentContextLink(hit.index);
            this._drag = null;
        } else if (hit.type === "split") {
            this.selectSplitFrame(hit.frame);
            this._drag = null;
        } else if (hit.type === "segment") {
            if (this.isFl2vMode() && hit.index !== this.selectedIndex) {
                flushFl2vPromptDraft(this);
            }
            this.selectedIndex = hit.index;
            this.clearSplitSelection();
            this.updateSelectionUI();
            if (this.isFl2vMode() || this.isR2vBatch() || this.timeline.segments.length >= 2) {
                // Drag body to reorder / swap clip positions; edges still resize.
                this._drag = {
                    kind: "segment-pending",
                    index: hit.index,
                    x0: x,
                    y0: y,
                    fromRank: this._visualRankFromArrayIndex(hit.index),
                };
            } else {
                this._drag = { kind: "segment" };
            }
        } else if (hit.type === "edge") {
            if (this.isFl2vMode() && hit.index !== this.selectedIndex) {
                flushFl2vPromptDraft(this);
            }
            this.selectedIndex = hit.index;
            this.clearSplitSelection();
            this.updateSelectionUI();
            this._drag = { kind: "edge", index: hit.index, edge: hit.edge };
            this._edgeSnapshot = JSON.parse(JSON.stringify(this.timeline.segments));
        }
        this.scheduleRender();
    }

    onMouseMove(e) {
        if (!this._drag) return;
        const { x, y } = this.getMousePos(e);
        const width = this.getLayoutWidth();
        const frame = this.xToFrame(x, width);

        if (this._drag.kind === "segment-pending") {
            if (Math.hypot(x - this._drag.x0, y - this._drag.y0) > 6) {
                this._drag = {
                    kind: "reorder",
                    fromRank: this._drag.fromRank,
                    index: this._drag.index,
                    pointerX: x,
                    pointerY: y,
                    originX: this._drag.x0,
                    originY: this._drag.y0,
                };
                this._reorderFromRank = this._drag.fromRank;
                this._reorderDropRank = this._drag.fromRank;
                this.canvas.classList.add("bd-grabbing");
                this.canvas.style.cursor = "grabbing";
            }
            return;
        }

        if (this._drag.kind === "playhead") {
            this.currentFrame = frame;
        } else if (this._drag.kind === "reorder") {
            this._drag.pointerX = x;
            this._drag.pointerY = y;
            this._reorderDropRank = this._computeReorderDropRank(frame, this._drag.fromRank);
            this.scheduleRender();
            return;
        } else if (this._drag.kind === "fl2v-move") {
            // Block-move: this clip + all later clips shift together (LTX ripple).
            const snap = this._edgeSnapshot || this.timeline.segments;
            const segs = snap.map((s) => ({ ...s }));
            const i = this._drag.index;
            const seg = segs[i];
            if (!seg) return;
            const width = this.getLayoutWidth();
            const frame0 = this.xToFrame(this._drag.x0, width);
            let delta = frame - frame0;
            const ordered = segs
                .map((s, idx) => ({ s, idx }))
                .sort((a, b) => a.s.start - b.s.start || a.idx - b.idx);
            const rank = ordered.findIndex((o) => o.s.id === seg.id);
            if (rank < 0) return;
            const prev = rank > 0 ? ordered[rank - 1].s : null;
            const minStart = prev ? prev.start + prev.length : 0;
            const desired = this._drag.start0 + delta;
            const clampedStart = Math.max(minStart, desired);
            delta = clampedStart - this._drag.start0;
            for (let r = rank; r < ordered.length; r++) {
                const orig = snap.find((x) => x.id === ordered[r].s.id) || ordered[r].s;
                ordered[r].s.start = Math.max(0, (parseInt(orig.start, 10) || 0) + delta);
                ordered[r].s.length = Math.max(minFrameCount("fl2v"), parseInt(orig.length, 10) || minFrameCount("fl2v"));
                ordered[r].s.frameCount = ordered[r].s.length;
            }
            this._previewSegments = segs;
        } else if (this._drag.kind === "edge") {
            const segs = this._edgeSnapshot.map((s) => ({ ...s }));
            const i = this._drag.index;
            const seg = segs[i];
            const isFl2v = this.isFl2vMode();
            const isGen = this.isGenMode();
            const isR2v = this.isR2vBatch();
            const minLen = (isFl2v || isGen || isR2v) ? minFrameCount(this.getTaskKey()) : MIN_SEG;
            if (isFl2v) {
                // LTX-style ripple: resize this clip's right edge and shift ALL later clips.
                // Left edge of a non-first clip = ripple the previous clip's right edge.
                // May extend past the sampling window (dashed overflow, not sampled).
                const ordered = [...segs]
                    .map((s, idx) => ({ s, idx }))
                    .sort((a, b) => a.s.start - b.s.start || a.idx - b.idx);
                const rank = ordered.findIndex((o) => o.s.id === seg.id);
                if (this._drag.edge === "right") {
                    const newEnd = Math.max(seg.start + minLen, frame);
                    rippleFl2vRightEdge(segs, i, newEnd, minLen, this);
                } else if (this._drag.edge === "left") {
                    if (rank > 0) {
                        const prevIdx = ordered[rank - 1].idx;
                        const prev = ordered[rank - 1].s;
                        const newEnd = Math.max(prev.start + minLen, frame);
                        rippleFl2vRightEdge(segs, prevIdx, newEnd, minLen, this);
                    }
                    // First clip's left edge stays at 0 (no negative timeline).
                }
            } else if (this._drag.edge === "left") {
                const prev = segs[i - 1];
                const minStart = prev ? prev.start + minLen : 0;
                const maxStart = seg.start + seg.length - minLen;
                seg.start = clamp(frame, minStart, maxStart);
                seg.length = (this._edgeSnapshot[i].start + this._edgeSnapshot[i].length) - seg.start;
                if (isGen || isR2v) seg.frameCount = seg.length;
                if (prev) {
                    prev.length = seg.start - prev.start;
                    if (isGen || isR2v) prev.frameCount = prev.length;
                }
            } else {
                const next = segs[i + 1];
                const minEnd = seg.start + minLen;
                let maxEnd;
                if (next) {
                    maxEnd = this._edgeSnapshot[i + 1].start + this._edgeSnapshot[i + 1].length;
                    if (isGen || isR2v) maxEnd -= minLen;
                } else if (isGen || isR2v) {
                    maxEnd = seg.start + MAX_GEN_FRAMES;
                } else {
                    maxEnd = this.getTotalFrames();
                }
                const end = clamp(frame, minEnd, maxEnd);
                seg.length = end - seg.start;
                if (isGen || isR2v) seg.frameCount = seg.length;
                if (next) {
                    next.start = end;
                    next.length = (this._edgeSnapshot[i + 1].start + this._edgeSnapshot[i + 1].length) - end;
                    if (isGen || isR2v) next.frameCount = next.length;
                }
            }
            this._previewSegments = segs;
            this._syncLiveDurationUiFromPreview();
        }
        this.scheduleRender();
    }

    /**
     * While dragging a segment edge, keep group seconds / toolbar / output preview in sync
     * without rebuilding the whole batch DOM (that would break the drag).
     */
    _syncLiveDurationUiFromPreview() {
        const segs = this._previewSegments;
        if (!segs?.length) return;

        if (this.isR2vBatch() || (this.isImageBatch() && isVideoBatchTask(this.getTaskKey()))) {
            for (const input of this.batchList?.querySelectorAll("input[data-batch-sec-index]") || []) {
                if (input === document.activeElement) continue;
                const index = parseInt(input.getAttribute("data-batch-sec-index"), 10);
                if (!Number.isFinite(index)) continue;
                const seg = segs[index];
                if (!seg) continue;
                const fc = Math.max(1, parseInt(seg.frameCount ?? seg.length, 10) || 1);
                const sec = preferredDurationSecFromFrames(fc, 24);
                const play = framesToDurationSec(fc, 24);
                if (input.value !== String(sec)) input.value = String(sec);
                input.title = t("batch.durationTooltip", { frames: fc, play });
            }
            this.updateVideoNameLabel();
            this.updateOutputPreview();
            return;
        }

        if (this.isFl2vMode()) {
            const shots = this.timeline.shots || [];
            for (const card of this.fl2vUi?.shotsEl?.querySelectorAll(".bd-fl2v-shot") || []) {
                const index = parseInt(card.dataset.shotIndex, 10);
                const input = card.querySelector('[data-r="shot-sec"]');
                const shot = shots[index];
                if (!input || !shot || input === document.activeElement) continue;
                const sec = roundDurationSec(Number(shot.durationSec) || 0);
                if (input.value !== String(sec)) input.value = String(sec);
            }
            if (this.fl2vUi?.totalInput && this.fl2vUi.totalInput !== document.activeElement) {
                this.fl2vUi.totalInput.value = String(getFl2vTotalDurationSec(this));
            }
            this.updateVideoNameLabel();
            this.updateOutputPreview();
            return;
        }

        // v2v / rv2v video timeline: live-update segment header + bounds while dragging.
        this._updateSegInfoFromSegment?.(segs[this.selectedIndex]);
        this._updateTimelineDom?.({ skipSeek: true });
        this.updateOutputPreview();
    }

    /** Build / refresh the segment panel meta line (frames, duration, ref counts). */
    _updateSegInfoFromSegment(seg) {
        if (!this.segInfo || !seg || this.isGlobalMode()) return;
        const fps = this.getFrameRate();
        const segKey = resolveTaskKey(
            seg.taskType || this.timeline.global?.taskType || this.getTaskKey(),
        );
        let info;
        if (this.isGenMode()) {
            const fc = seg.frameCount ?? seg.length;
            info = t("segment.infoFrames", { n: fc });
            if (this.isGenImage()) {
                info += seg.genImage?.imageFile ? t("segment.uploadedImage") : t("segment.noImage");
            }
        } else {
            info = t("segment.infoRange", {
                start: seg.start,
                end: seg.start + seg.length,
                length: seg.length,
                sec: (seg.length / fps).toFixed(2),
            });
            const clips = this.getVideoClips();
            if (clips.length > 1) {
                const clip = clips[this.getSegmentClipIndex(seg)];
                const clipName = clip?.fileName || clip?.videoFile
                    || t("slot.video", { n: this.getSegmentClipIndex(seg) + 1 });
                info += ` · ${clipName}`;
            }
            if (taskUsesReferenceVideo(segKey)) {
                info += seg.referenceVideo?.videoFile || seg.referenceVideo?.fileName
                    ? t("segment.refVideoUploaded")
                    : t("segment.refVideoMissing");
            }
            if (taskUsesReferenceImages(segKey) || taskUsesReferenceAudios(segKey)) {
                let imgs = 0;
                let audios = 0;
                for (const r of seg.refs || []) {
                    if (r?.imageFile || r?.imageB64) imgs += 1;
                }
                for (const r of seg.refAudios || []) {
                    if (r?.audioFile || r?.fileName) audios += 1;
                }
                info += ` · ${t("segment.refSummary", {
                    imgs,
                    maxImgs: MAX_REFERENCE_IMAGES,
                    audios,
                    maxAudios: MAX_REFERENCE_AUDIOS,
                })}`;
            }
        }
        this.segInfo.textContent = info;
    }

    onMouseUp() {
        if (
            (this._drag?.kind === "edge" || this._drag?.kind === "fl2v-move")
            && this._previewSegments
        ) {
            const preview = this._previewSegments;
            this._previewSegments = null;
            if (this.isFl2vMode()) {
                // Shot durations already updated during drag; rebuild layout from shots.
                syncFl2vDurationSecAfterDrag(this);
                updateFl2vDetailUI(this);
                this.updateVideoNameLabel();
            } else if (this.isR2vBatch()) {
                this.timeline.segments = preview;
                for (const seg of this.timeline.segments) {
                    const fc = Math.max(1, parseInt(seg.frameCount ?? seg.length, 10) || 1);
                    seg.frameCount = fc;
                    seg.length = fc;
                    seg.durationSec = preferredDurationSecFromFrames(fc, 24);
                }
                normalizeImageBatchSegments(this);
                this.renderImageBatchGroups();
                this.updateVideoNameLabel();
            } else {
                this.timeline.segments = preview;
            }
            this.commit();
        } else if (this._drag?.kind === "reorder") {
            const toRank = this._reorderDropRank;
            if (toRank >= 0 && toRank !== this._drag.fromRank) {
                this.reorderSegmentsByRank(this._drag.fromRank, toRank);
                this.commit(false, { syncTimeline: true });
                if (this.isFl2vMode()) {
                    updateFl2vDetailUI(this);
                    this.updateVideoNameLabel();
                } else if (this.isR2vBatch()) {
                    this.renderImageBatchGroups();
                    this.updateVideoNameLabel();
                }
            }
            this._reorderDropRank = -1;
            this._reorderFromRank = -1;
            this.canvas.classList.remove("bd-grabbing");
            this.canvas.style.cursor = "";
        } else if (this._drag) {
            this.seekBar.value = this.currentFrame;
            this.scheduleRender();
        }
        this._drag = null;
        this._edgeSnapshot = null;
    }

    addSplitAtMouse(e) {
        const { x } = this.getMousePos(e);
        this.splitAtFrame(this.xToFrame(x, this.getLayoutWidth()));
    }

    splitAtFrame(frame) {
        if (this.isGenMode()) {
            this.genSplitAtFrame(frame);
            return;
        }
        const total = this.getTotalFrames();
        if (frame <= MIN_SEG || frame >= total - MIN_SEG) return;
        const newSegs = [];
        for (const seg of [...this.timeline.segments].sort((a, b) => a.start - b.start)) {
            const end = seg.start + seg.length;
            if (frame > seg.start && frame < end) {
                newSegs.push({ ...seg, length: frame - seg.start });
                newSegs.push({ id: uid(), start: frame, length: end - frame, prompt: "", taskType: "", refs: [], referenceVideo: {} });
            } else newSegs.push({ ...seg });
        }
        this.timeline.segments = newSegs;
        this.selectedSplitFrame = null;
        this.commit();
        this.updateSplitPointUI();
    }

    equalSplit() {
        if (this.isGenMode()) {
            this.genEqualSplit();
            return;
        }
        const n = parseInt(this.equalCountInput?.value || "2", 10);
        if (!n || n < 2) return;
        const total = this.getTotalFrames();
        if (total < MIN_SEG * 2) return;
        const maxSeg = Math.floor(total / MIN_SEG);
        const count = clamp(n, 2, Math.max(2, maxSeg || 2));
        if (this.equalCountInput) this.equalCountInput.value = String(count);

        const points = new Set([0, total]);
        const clipBounds = this.getClipBoundaries();
        for (const b of clipBounds) {
            if (b > 0 && b < total) points.add(b);
        }
        for (let i = 1; i < count; i++) {
            const p = Math.round((i * total) / count);
            if (p > 0 && p < total) points.add(p);
        }

        const forced = new Set([0, total, ...clipBounds]);
        const newSegs = this._buildSegmentsFromSplitPoints([...points], forced);
        if (!newSegs?.length) return;
        this.timeline.segments = newSegs;
        this.selectedSplitFrame = null;
        this.commit();
        this.updateSplitPointUI();
    }

    /** Logical ranges for each video clip on the timeline. */
    getClipLogicalRanges() {
        const clips = this.getVideoClips();
        const total = this.getTotalFrames();
        if (!clips.length) return [];
        const map = this.getFrameMap();
        if (map.length) {
            const ranges = clips.map((clip, clipIndex) => ({
                clip,
                clipIndex,
                start: total,
                end: 0,
            }));
            for (let i = 0; i < map.length; i++) {
                const entry = normalizeFrameMapEntry(map[i]);
                const r = ranges[entry.clip];
                if (!r) continue;
                if (i < r.start) r.start = i;
                if (i + 1 > r.end) r.end = i + 1;
            }
            return ranges.filter((r) => r.end > r.start);
        }
        if (clips.length === 1) {
            return [{ clip: clips[0], clipIndex: 0, start: 0, end: total }];
        }
        let cursor = 0;
        return clips.map((clip, clipIndex) => {
            const len = Math.max(0, parseInt(clip.sourceFrameCount, 10) || 0);
            const start = cursor;
            const end = Math.min(total, cursor + len);
            cursor = end;
            return { clip, clipIndex, start, end };
        }).filter((r) => r.end > r.start);
    }

    /** Interior segment boundaries that can be selected/deleted (not clip seams). */
    getEditableSplitFrames() {
        if (this.isFl2vMode() || this.isGenMode() || this.isImageBatch()) return [];
        const total = this.getTotalFrames();
        if (total < MIN_SEG * 2) return [];
        const forced = new Set([0, total, ...this.getClipBoundaries()]);
        const segs = this._previewSegments || this.timeline.segments || [];
        const points = [];
        for (const seg of segs) {
            const start = Math.max(0, parseInt(seg.start, 10) || 0);
            if (start > 0 && start < total && !forced.has(start)) points.push(start);
        }
        return [...new Set(points)].sort((a, b) => a - b);
    }

    selectSplitFrame(frame) {
        const editable = this.getEditableSplitFrames();
        const n = Number(frame);
        if (!Number.isFinite(n) || !editable.includes(n)) {
            this.selectedSplitFrame = null;
        } else {
            // Toggle off if clicking the same selected split again.
            this.selectedSplitFrame = this.selectedSplitFrame === n ? null : n;
            if (this.selectedSplitFrame != null) {
                const segs = this.timeline.segments || [];
                const idx = segs.findIndex((s) => (parseInt(s.start, 10) || 0) === n);
                if (idx >= 0) this.selectedIndex = idx;
            }
        }
        this.updateSplitPointUI();
        this.updateSelectionUI();
        this.scheduleRender();
    }

    clearSplitSelection() {
        if (this.selectedSplitFrame == null) return;
        this.selectedSplitFrame = null;
        this.updateSplitPointUI();
        this.scheduleRender();
    }

    updateSplitPointUI() {
        const bar = this.splitEditBarEl || this.root?.querySelector('[data-r="split-edit-bar"]');
        const hint = this.splitEditHintEl || this.root?.querySelector('[data-r="split-edit-hint"]');
        const btn = this.root?.querySelector('[data-a="del-split"]');
        if (this.isImageBatch() || this.isGenMode()) {
            bar?.classList.add("hidden");
            return;
        }
        const has = this.selectedSplitFrame != null
            && this.getEditableSplitFrames().includes(this.selectedSplitFrame);
        if (bar) bar.classList.toggle("hidden", !has);
        if (hint && has) {
            hint.textContent = t("split.hintSelected", { f: this.selectedSplitFrame });
        }
        if (btn) {
            btn.disabled = !has;
            btn.title = has
                ? t("split.tooltipDelete", { f: this.selectedSplitFrame })
                : t("split.tooltipSelectFirst");
        }
        if (has && this.boundsEl) {
            this.boundsEl.textContent = t("split.boundsSelected", { f: this.selectedSplitFrame });
        }
    }

    deleteSelectedSplitPoint() {
        if (this.isGenMode() || this.isImageBatch()) return;
        const frame = this.selectedSplitFrame;
        if (frame == null) return;
        if (!this.getEditableSplitFrames().includes(frame)) {
            this.clearSplitSelection();
            return;
        }
        const segs = [...(this.timeline.segments || [])].sort((a, b) => a.start - b.start);
        const rightIdx = segs.findIndex((s) => (parseInt(s.start, 10) || 0) === frame);
        if (rightIdx <= 0) {
            this.clearSplitSelection();
            return;
        }
        const left = segs[rightIdx - 1];
        const right = segs[rightIdx];
        left.length = (parseInt(left.length, 10) || 0) + (parseInt(right.length, 10) || 0);
        segs.splice(rightIdx, 1);
        this.timeline.segments = segs;
        this.selectedSplitFrame = null;
        this.selectedIndex = Math.max(0, rightIdx - 1);
        this.commit();
        this.updateSelectionUI();
        this.updateSplitPointUI();
        this.setSmartSplitMessage("");
        this.scheduleRender();
    }

    setSmartSplitMessage(text, { ok = false } = {}) {
        const el = this.smartSplitMsgEl || this.root?.querySelector('[data-r="smart-split-msg"]');
        if (!el) return;
        const msg = String(text || "").trim();
        if (!msg) {
            el.textContent = "";
            el.classList.add("hidden");
            el.classList.remove("ok");
            return;
        }
        el.textContent = msg;
        el.classList.toggle("ok", !!ok);
        el.classList.remove("hidden");
    }

    async smartSplit() {
        if (this.isGenMode() || this.isImageBatch()) return;
        if (!this.hasVideo()) {
            this.setSmartSplitMessage(t("smartSplit.needVideo"));
            return;
        }
        const total = this.getTotalFrames();
        if (total < MIN_SEG * 2) {
            this.setSmartSplitMessage(t("smartSplit.tooShort"));
            return;
        }
        const ranges = this.getClipLogicalRanges();
        if (!ranges.length) {
            this.setSmartSplitMessage(t("smartSplit.noMaterial"));
            return;
        }
        const btn = this.root?.querySelector('[data-a="smart-split"]');
        const prevLabel = btn?.textContent;
        if (btn) {
            btn.disabled = true;
            btn.textContent = t("common.analyzing");
        }
        this.setSmartSplitMessage(t("smartSplit.analyzing"));
        try {
            const clips = ranges.map((r) => ({
                videoFile: r.clip.videoFile || r.clip.fileName,
                subfolder: r.clip.subfolder || "",
                type: r.clip.type || "input",
                logicalStart: r.start,
                logicalEnd: r.end,
                nativeFps: r.clip.nativeFps || r.clip.native_fps || null,
            }));
            const resp = await api.fetchApi("/minimax/motion-director/detect_shots", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clips,
                    frameRate: this.getFrameRate(),
                    totalFrames: total,
                    sensitivity: "medium",
                    minShotFrames: Math.max(MIN_SEG, 12),
                }),
            });
            if (!resp.ok) {
                throw new Error((await resp.text()) || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            const cutFrames = Array.isArray(data.cutFrames) ? data.cutFrames.map((n) => parseInt(n, 10) || 0) : [];
            const points = new Set([0, total, ...cutFrames.filter((f) => f > 0 && f < total)]);
            const clipBounds = this.getClipBoundaries();
            for (const b of clipBounds) {
                if (b > 0 && b < total) points.add(b);
            }
            const forced = new Set([0, total, ...clipBounds]);
            const newSegs = this._buildSegmentsFromSplitPoints([...points], forced);
            if (!newSegs?.length) {
                this.setSmartSplitMessage(t("smartSplit.noSegments"));
                return;
            }
            this.timeline.segments = newSegs;
            this.selectedIndex = 0;
            this.selectedSplitFrame = null;
            this.commitSegmentStructureMutation();
            this.updateSelectionUI();
            this.updateSplitPointUI();
            const shotCount = data.shotCount ?? Math.max(0, newSegs.length);
            const warn = Array.isArray(data.warnings) && data.warnings.length
                ? ` ${data.warnings[0]}`
                : "";
            this.setSmartSplitMessage(
                t("smartSplit.done", { shots: shotCount, segs: newSegs.length }) + (warn || ""),
                { ok: !warn },
            );
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] smartSplit failed", err);
            this.setSmartSplitMessage(t("smartSplit.failed", { err: err?.message || err }));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = prevLabel || t("toolbar.smartSplit");
            }
        }
    }

    deleteSelectedSegment() {
        if (this.isGenMode()) {
            this.genDeleteSelectedSegment();
            return;
        }
        if (this.isR2vBatch()) {
            if ((this.timeline.segments || []).length <= 1) return;
            deleteImageBatchGroup(this, this.selectedIndex);
            this.currentFrame = clamp(this.currentFrame, 0, Math.max(0, this.getTotalFrames() - 1));
            if (this.seekBar) {
                this.seekBar.max = Math.max(0, this.getTotalFrames() - 1);
                this.seekBar.value = this.currentFrame;
            }
            this.updateVideoNameLabel();
            this.updateDomWidgetHeight();
            this.scheduleRender();
            return;
        }
        if (this.isImageBatch()) {
            this.genDeleteSelectedSegment();
            return;
        }
        if (this.isFl2vMode()) {
            const idx = this.selectedIndex;
            const shots = this.timeline.shots || [];
            if (!shots[idx] && !(this.timeline.segments || [])[idx]) return;
            removeFl2vShot(this, idx);
            this.currentFrame = clamp(this.currentFrame, 0, Math.max(0, this.getTotalFrames() - 1));
            if (this.seekBar) {
                this.seekBar.max = Math.max(0, this.getTotalFrames() - 1);
                this.seekBar.value = this.currentFrame;
            }
            this.commitSegmentStructureMutation(false);
            updateFl2vDetailUI(this);
            this.updateVideoNameLabel();
            this.updateDomWidgetHeight();
            return;
        }
        const idx = this.selectedIndex;
        const seg = this.timeline.segments[idx];
        if (!seg) return;

        const start = Math.max(0, parseInt(seg.start, 10) || 0);
        const len = Math.max(0, parseInt(seg.length, 10) || 0);
        this.selectedSplitFrame = null;

        // Remove segment UI entry first, then cut matching frames from the
        // logical timeline so preview / export no longer include that range.
        this.timeline.segments.splice(idx, 1);

        let total = this.getTotalFrames();
        let map = [];
        if (len > 0 && total > 0) {
            // Sparse uploads start with an empty frameMap; materialize so we can
            // splice out the deleted range from the source-frame mapping.
            if (!this.getFrameMap().length) this.materializeFrameMap();
            map = [...this.getFrameMap()];
            if (map.length) {
                const from = clamp(start, 0, map.length);
                const count = clamp(len, 0, map.length - from);
                if (count > 0) map.splice(from, count);
                this.setFrameMap(map);
                this._syncPrimaryVideoFromClips(map);
                total = map.length;
            } else {
                // Fallback: record deleted source ranges (kept across sync).
                const video = this.timeline.video || {};
                video.deletedSourceRanges = video.deletedSourceRanges || [];
                const srcStart = this.logicalToSourceFrame(start);
                video.deletedSourceRanges.push([srcStart, srcStart + len]);
                video.deletedSourceRanges.sort((a, b) => a[0] - b[0]);
                this.timeline.video = video;
                total = this.getTotalFrames();
                this.timeline.totalFrames = total;
                this._syncPrimaryVideoFromClips([]);
            }
        }

        this._thumbCache.clear();
        this._thumbPending.clear();
        // Invalidate stashed workspace — it still contains the deleted range.
        this.timeline.videoWorkspace = null;

        if (this.totalFramesWidget) this.totalFramesWidget.value = total;

        this.compactSegmentsAfterDelete();

        this.selectedIndex = clamp(idx, 0, Math.max(0, this.timeline.segments.length - 1));
        this.currentFrame = clamp(this.currentFrame, 0, Math.max(0, total - 1));
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, total - 1);
            this.seekBar.value = this.currentFrame;
        }

        if (!total) {
            this.videoNameEl.textContent = t("toolbar.noVideo");
            this.timeline.videoClips = [];
            this.timeline.video = {
                fileName: "",
                videoFile: "",
                subfolder: "",
                type: "input",
                frames: [],
                frameMap: [],
                width: 0,
                height: 0,
            };
            this._clearVideoState();
        } else {
            this.updateVideoNameLabel();
            this._prefetchSegmentThumbs(0, Math.min(total, THUMB_PREFETCH_BATCH * 4));
            this._syncStagePreview(this.currentFrame, { force: true });
            this.updateStageVisibility();
        }

        this.commit(false, { syncTimeline: true });
    }

    compactSegmentsAfterDelete() {
        const total = this.getTotalFrames();
        if (total <= 0) {
            this.timeline.segments = [];
            return;
        }
        const segs = [...this.timeline.segments].sort((a, b) => a.start - b.start);
        if (!segs.length) {
            this.timeline.segments = [{ id: uid(), start: 0, length: total, prompt: "", taskType: "", refs: [], referenceVideo: {} }];
            return;
        }
        let cursor = 0;
        const fixed = [];
        for (const seg of segs) {
            let length = seg.length ?? MIN_SEG;
            if (cursor + length > total) length = total - cursor;
            if (length < MIN_SEG) {
                if (fixed.length) fixed[fixed.length - 1].length += length;
                cursor += length;
                continue;
            }
            fixed.push({ ...seg, start: cursor, length, refs: seg.refs || [] });
            cursor += length;
        }
        if (!fixed.length) {
            this.timeline.segments = [{ id: uid(), start: 0, length: total, prompt: "", taskType: "", refs: [], referenceVideo: {} }];
        } else if (cursor < total) {
            fixed[fixed.length - 1].length += total - cursor;
        }
        this.timeline.segments = fixed;
    }

    getFrameImage(frameIndex) {
        return this._thumbCache.get(frameIndex) || null;
    }

    drawSegmentThumbnails(ctx, seg, startX, pxWidth, y0, h) {
        if (this.isFl2vMode()) {
            drawFl2vSegmentThumbnails(this, ctx, seg, startX, pxWidth, y0, h);
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX, y0 + 1, pxWidth, h - 2);
        ctx.clip();

        if (this.isR2vBatch()) {
            ctx.fillStyle = "#0d0d0d";
            ctx.fillRect(startX, y0 + 1, pxWidth, h - 2);
            const refs = [...(seg.refs || [])].sort(
                (a, b) => Number(a.index ?? a.slot ?? 0) - Number(b.index ?? b.slot ?? 0),
            );
            const imgFile = refs.find((r) => r?.imageFile)?.imageFile || "";
            const previewB64 = seg.previewB64 || (Array.isArray(seg.previewFrames) ? seg.previewFrames[0] : "");
            const vidRef = [...(seg.refVideos || [])]
                .sort((a, b) => Number(a.index ?? a.slot ?? 0) - Number(b.index ?? b.slot ?? 0))
                .find((r) => r?.videoFile || r?.previewImageFile || r?.previewImageUrl || r?.linked);
            const vidPath = vidRef?.videoFile || "";
            const vidType = vidRef?.type || "input";
            const posterFile = vidRef?.previewImageFile || "";
            const posterUrl = vidRef?.previewImageUrl || "";
            let cacheKey = "";
            let srcKind = "";
            if (imgFile) {
                cacheKey = `r2v:${imgFile}`;
                srcKind = "image";
            } else if (previewB64) {
                cacheKey = `r2v-prev:${seg.id || startX}`;
                srcKind = "preview";
            } else if (vidPath) {
                cacheKey = `r2v-vid:${vidType}:${vidPath}`;
                srcKind = "video";
            } else if (posterFile || posterUrl) {
                cacheKey = `r2v-vid-poster:${posterFile || posterUrl}`;
                srcKind = "poster";
            }
            const drawCached = (img) => {
                if (!img?.naturalWidth && !img?.width) return false;
                const natW = img.naturalWidth || img.width;
                const natH = Math.max(1, img.naturalHeight || img.height);
                const ratio = natW / natH;
                let dw = pxWidth - 4;
                let dh = dw / ratio;
                if (dh > h - 4) {
                    dh = h - 4;
                    dw = dh * ratio;
                }
                ctx.drawImage(img, startX + (pxWidth - dw) / 2, y0 + (h - dh) / 2, dw, dh);
                return true;
            };
            if (cacheKey) {
                const img = this._thumbCache.get(cacheKey);
                if (!drawCached(img)) {
                    if (srcKind === "video") {
                        this._queueR2vVideoThumb(cacheKey, vidPath, vidType);
                    } else if (!this._thumbPending.has(cacheKey)) {
                        this._thumbPending.add(cacheKey);
                        const el = new Image();
                        el.crossOrigin = "anonymous";
                        el.onload = () => {
                            this._thumbCache.set(cacheKey, el);
                            this._thumbPending.delete(cacheKey);
                            this.scheduleRender();
                        };
                        el.onerror = () => this._thumbPending.delete(cacheKey);
                        if (srcKind === "image") el.src = refViewUrl(imgFile);
                        else if (srcKind === "poster") {
                            el.src = posterUrl || refViewUrl(posterFile);
                        } else {
                            el.src = String(previewB64).startsWith("data:")
                                ? previewB64
                                : `data:image/png;base64,${previewB64}`;
                        }
                    }
                }
            } else {
                ctx.fillStyle = "#666";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(t("canvas.uploadR2vMedia"), startX + pxWidth / 2, y0 + h / 2);
            }
            ctx.restore();
            return;
        }

        if (this.isGenBlank()) {
            ctx.fillStyle = "#0d0d0d";
            ctx.fillRect(startX, y0 + 1, pxWidth, h - 2);
            ctx.strokeStyle = "#333";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(startX + 2, y0 + 4, pxWidth - 4, h - 8);
            ctx.setLineDash([]);
            ctx.fillStyle = "#888";
            ctx.font = "11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const fc = seg.frameCount ?? seg.length;
            ctx.fillText(`${fc}f`, startX + pxWidth / 2, y0 + h / 2 - 6);
            ctx.fillStyle = "#555";
            ctx.font = "10px sans-serif";
            ctx.fillText(t("canvas.blankCanvas"), startX + pxWidth / 2, y0 + h / 2 + 8);
            ctx.restore();
            return;
        }

        if (this.isGenImage()) {
            const imgFile = this.isGlobalMode()
                ? this.timeline.global?.genImage?.imageFile
                : (seg.genImage?.imageFile || "");
            ctx.fillStyle = "#111";
            ctx.fillRect(startX, y0 + 1, pxWidth, h - 2);
            if (imgFile) {
                const cacheKey = `gen:${imgFile}`;
                let img = this._thumbCache.get(cacheKey);
                if (img?.naturalWidth) {
                    const ratio = img.naturalWidth / img.naturalHeight;
                    let dw = pxWidth - 4, dh = dw / ratio;
                    if (dh > h - 4) { dh = h - 4; dw = dh * ratio; }
                    ctx.drawImage(img, startX + (pxWidth - dw) / 2, y0 + (h - dh) / 2, dw, dh);
                } else if (!this._thumbPending.has(cacheKey)) {
                    this._thumbPending.add(cacheKey);
                    const el = new Image();
                    el.crossOrigin = "anonymous";
                    el.onload = () => {
                        this._thumbCache.set(cacheKey, el);
                        this._thumbPending.delete(cacheKey);
                        this.scheduleRender();
                    };
                    el.onerror = () => this._thumbPending.delete(cacheKey);
                    el.src = refViewUrl(imgFile);
                }
            } else {
                ctx.fillStyle = "#666";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(t("canvas.uploadSourceImage"), startX + pxWidth / 2, y0 + h / 2);
            }
            ctx.restore();
            return;
        }

        ctx.fillStyle = "#000";
        ctx.fillRect(startX, y0 + 1, pxWidth, h - 2);
        if (!this.hasVideo()) {
            ctx.fillStyle = "#666";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                this.isFl2vMode() ? t("canvas.clickAddShot") : t("canvas.clickUploadVideo"),
                startX + pxWidth / 2,
                y0 + h / 2,
            );
            ctx.restore();
            return;
        }
        const thumbW = Math.max(32, pxWidth / Math.max(1, Math.min(MAX_THUMBS_PER_SEGMENT, Math.ceil(seg.length / 4))));
        const step = Math.max(1, Math.floor(seg.length / Math.max(1, Math.ceil(pxWidth / thumbW))));
        let drawn = 0;
        for (let f = seg.start; f < seg.start + seg.length && drawn < MAX_THUMBS_PER_SEGMENT; f += step, drawn++) {
            this._queueThumbPrefetch(f);
            const img = this.getFrameImage(f);
            const tx = startX + ((f - seg.start) / seg.length) * pxWidth;
            if (img?.naturalWidth) {
                const ratio = img.naturalWidth / img.naturalHeight;
                let dw = thumbW, dh = thumbW / ratio;
                if (dh > h - 2) { dh = h - 2; dw = dh * ratio; }
                ctx.drawImage(img, tx, y0 + (h - dh) / 2, dw, dh);
            } else {
                ctx.fillStyle = "#333";
                ctx.fillRect(tx, y0 + 2, Math.max(8, thumbW * 0.6), h - 4);
            }
        }
        ctx.restore();
    }

    _drawSegmentRunCheck(x, y, enabled) {
        const ctx = this.ctx;
        const s = RUN_CHECK_SIZE;
        ctx.save();
        // Opaque plate so the control never blends into timeline chrome.
        ctx.fillStyle = "#0e0e0e";
        ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
        ctx.fillStyle = enabled ? "#1a3a2a" : "#1c1c1c";
        ctx.strokeStyle = enabled ? "#4fff8f" : "#888";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, s, s);
        ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        if (enabled) {
            ctx.fillStyle = "#4fff8f";
            ctx.font = "11px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillText("✓", x + 2, y + 11);
        }
        ctx.restore();
    }

    _drawReorderInsertMarker(ix) {
        const ctx = this.ctx;
        const y0 = TRACK_Y;
        const y1 = TRACK_Y + TRACK_H;
        ctx.save();
        ctx.strokeStyle = "#4fff8f";
        ctx.fillStyle = "#4fff8f";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ix, y0);
        ctx.lineTo(ix, y1);
        ctx.stroke();
        // Triangles at top/bottom
        const t = 7;
        ctx.beginPath();
        ctx.moveTo(ix, y0);
        ctx.lineTo(ix - t, y0 - t);
        ctx.lineTo(ix + t, y0 - t);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ix, y1);
        ctx.lineTo(ix - t, y1 + t);
        ctx.lineTo(ix + t, y1 + t);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** Floating ghost card that follows the pointer while reordering clips. */
    _drawReorderGhost(width, segs, fromRank) {
        if (fromRank < 0 || this._drag?.pointerX == null) return;
        const ordered = this._orderedSegmentsWithRank();
        const item = ordered.find((o) => o.visualRank === fromRank);
        if (!item?.seg) return;
        const seg = item.seg;
        const srcW = Math.max(48, this.frameToX(seg.start + seg.length, width) - this.frameToX(seg.start, width));
        const gw = Math.min(140, Math.max(72, srcW * 0.55));
        const gh = TRACK_H * 0.78;
        const gx = this._drag.pointerX - gw / 2;
        const gy = clamp(this._drag.pointerY - gh / 2, TRACK_Y - 8, TRACK_Y + TRACK_H - gh + 8);
        const ctx = this.ctx;
        ctx.save();
        // Drop shadow
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(gx + 4, gy + 5, gw, gh);
        ctx.globalAlpha = 0.95;
        this.drawSegmentThumbnails(ctx, seg, gx, gw, gy, gh);
        ctx.strokeStyle = "#4fff8f";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);
        ctx.fillStyle = "rgba(20,40,28,0.9)";
        ctx.fillRect(gx + 4, gy + 4, 44, 16);
        ctx.fillStyle = "#4fff8f";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(t("canvas.dragging"), gx + 8, gy + 12);
        ctx.restore();
    }

    drawPromptOverlay(ctx, seg, startX, pxWidth, y0, h) {
        const prompt = this.getDisplayPrompt(seg);
        if (!prompt || pxWidth < 24) return;
        const overlayH = Math.round(h * 0.22);
        const overlayY = y0 + h - overlayH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX, overlayY, pxWidth, overlayH);
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(startX, overlayY, pxWidth, overlayH);
        ctx.font = `${Math.min(11, overlayH * 0.55)}px sans-serif`;
        ctx.fillStyle = "#e0e3ed";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let label = prompt;
        const maxW = pxWidth - 10;
        if (ctx.measureText(label).width > maxW) {
            while (label.length > 0 && ctx.measureText(label + "…").width > maxW) label = label.slice(0, -1);
            label += "…";
        }
        ctx.fillText(label, startX + pxWidth / 2, overlayY + overlayH / 2);
        ctx.restore();
    }

    render() {
        if (this._directorModalController && !this._directorModalOpen) return;
        if (this.isPlaying) {
            this.renderTimelineOnly();
            return;
        }
        const width = this._measureDrawWidth();
        if (!width) {
            // Host not laid out yet — retry after the next layout pass.
            this.scheduleSettleRender();
            return;
        }
        this._drawWidth = width;
        this._drawTimelineCanvas(width);
        this._updateTimelineDom();
        this._syncStagePreview(this.currentFrame);
    }

    renderTimelineOnly() {
        if (this._directorModalController && !this._directorModalOpen) return;
        const width = this._measureDrawWidth()
            || this.node?.size?.[0]
            || 0;
        if (!width) return;
        this._drawWidth = width;
        this._drawTimelineCanvas(width);
        this._syncStagePreview(this.currentFrame);
    }

    _drawTimelineCanvas(width) {
        const height = this.canvasHeight;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(width * dpr);
        const bh = Math.round(height * dpr);
        // Keep bitmap ↔ CSS aspect in lockstep. Mixing getBoundingClientRect (graph-zoom
        // transformed) with width:100% clientWidth used to squash/stretch thumbs.
        if (this.canvas.width !== bw || this.canvas.height !== bh) {
            this.canvas.width = bw;
            this.canvas.height = bh;
        }
        if (this.zoom > 1) {
            this.canvas.style.width = `${Math.round(width)}px`;
        } else if (this.canvas.style.width !== "100%") {
            this.canvas.style.width = "100%";
        }
        this.canvas.style.height = `${height}px`;
        this.canvas.style.maxHeight = `${height}px`;
        this.canvas.style.minHeight = `${height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        const total = this.getTotalFrames();
        const fps = this.getFrameRate();
        const segs = this._previewSegments || this.timeline.segments;

        this.ctx.fillStyle = "#252525";
        this.ctx.fillRect(0, 0, width, RULER_H);
        this.ctx.fillStyle = "#888";
        this.ctx.font = "10px sans-serif";
        const fl2vSampleN = this.isFl2vMode() ? getFl2vSampleFrames(this) : total;
        // fl2v: ruler labels follow 总时长 (sampling window); overflow past it is dashed.
        const durationSec = this.isFl2vMode()
            ? getFl2vTotalDurationSec(this)
            : total / Math.max(fps, 0.001);
        const formatRulerSec = (sec) => {
            const n = Math.max(0, Number(sec) || 0);
            return (Math.round(n * 10) / 10).toFixed(1);
        };
        const stepSec = Math.max(1, durationSec / 10);
        // Leave a gap near the end so the duration label does not collide with the last tick.
        const endGuard = Math.min(0.6, stepSec * 0.45);
        for (let s = 0; s < durationSec - 1e-6; s += stepSec) {
            if (durationSec - s < endGuard) continue;
            const f = this.isFl2vMode()
                ? Math.min(fl2vSampleN, Math.round((s / Math.max(durationSec, 0.001)) * fl2vSampleN))
                : Math.min(total - 1, Math.round(s * fps));
            const x = this.frameToX(f, width);
            this.ctx.fillRect(x, RULER_H - 6, 1, 6);
            this.ctx.fillText(formatRulerSec(s), x + 2, 11);
        }
        if (fl2vSampleN > 0) {
            const sampleX = this.frameToX(fl2vSampleN, width);
            this.ctx.fillStyle = "#aaa";
            this.ctx.fillRect(sampleX, RULER_H - 8, 1, 8);
            const endLabel = formatRulerSec(durationSec);
            const textW = this.ctx.measureText(endLabel).width;
            this.ctx.fillText(endLabel, Math.max(2, sampleX - textW - 4), 11);
        }
        // Sample-window end marker on ruler (overflow hatch drawn after segments).
        if (this.isFl2vMode() && total > fl2vSampleN) {
            const ox = this.frameToX(fl2vSampleN, width);
            this.ctx.save();
            this.ctx.strokeStyle = "rgba(180,180,180,0.75)";
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([6, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(ox + 0.5, 0);
            this.ctx.lineTo(ox + 0.5, RULER_H + SEG_LABEL_H);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = "#999";
            this.ctx.font = "10px sans-serif";
            this.ctx.textAlign = "left";
            if (width - ox > 64) {
                this.ctx.fillText(t("canvas.beyondSampling"), ox + 6, RULER_H - 3);
            }
            this.ctx.restore();
        }

        // Frame-range labels above each segment (1-based inclusive, e.g. 1-10).
        this.ctx.fillStyle = "#1a1a1a";
        this.ctx.fillRect(0, RULER_H, width, SEG_LABEL_H);
        this.ctx.font = "10px sans-serif";
        this.ctx.textBaseline = "middle";
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const x0 = this.frameToX(seg.start, width);
            const x1 = this.frameToX(seg.start + seg.length, width);
            const pxW = Math.max(0, x1 - x0);
            if (pxW < 8 || seg.length <= 0) continue;
            const a = seg.start + 1;
            const b = seg.start + seg.length;
            const rangeText = `${a}-${b}`;
            // v2v / r2v / fl2v: emphasize selected segment label (matches card selection).
            const showSegSel = this.isR2vBatch() || this.isFl2vMode()
                || !(this.isImageBatch() || this.isGenMode());
            this.ctx.fillStyle = (showSegSel && i === this.selectedIndex) ? "#eee" : "#9a9a9a";
            let draw = rangeText;
            if (this.ctx.measureText(draw).width > pxW - 6) {
                while (draw.length > 1 && this.ctx.measureText(`${draw}…`).width > pxW - 6) {
                    draw = draw.slice(0, -1);
                }
                draw = draw.length < rangeText.length ? `${draw}…` : draw;
            }
            this.ctx.fillText(draw, x0 + 4, RULER_H + SEG_LABEL_H / 2);
        }

        this.ctx.fillStyle = "#111";
        this.ctx.fillRect(0, TRACK_Y, width, TRACK_H);

        if (!segs.length && (this.isFl2vMode() || this.isR2vBatch())) {
            this.ctx.fillStyle = "#666";
            this.ctx.font = "12px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText(
                this.isR2vBatch() ? t("canvas.clickAddRefGroup") : t("canvas.clickAddShot"),
                width / 2,
                TRACK_Y + TRACK_H / 2,
            );
        }

        const clipBounds = this.getClipBoundaries();
        if (clipBounds.length) {
            this.ctx.strokeStyle = "rgba(102,170,255,0.55)";
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 4]);
            for (const b of clipBounds) {
                const bx = this.frameToX(b, width);
                this.ctx.beginPath();
                this.ctx.moveTo(bx, TRACK_Y);
                this.ctx.lineTo(bx, TRACK_Y + TRACK_H);
                this.ctx.stroke();
            }
            this.ctx.setLineDash([]);
        }

        const reordering = this._drag?.kind === "reorder";
        const dragFromRank = reordering ? this._drag.fromRank : -1;
        const dropRank = reordering ? this._reorderDropRank : -1;
        // v2v / r2v / fl2v: selection chrome matches card selected border.
        const showSegSel = this.isR2vBatch() || this.isFl2vMode()
            || !(this.isImageBatch() || this.isGenMode());

        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const x0 = this.frameToX(seg.start, width);
            const x1 = this.frameToX(seg.start + seg.length, width);
            const pxW = x1 - x0;
            const sel = showSegSel && i === this.selectedIndex;
            const running = i === this._runHighlightSeg;
            const runOn = this.isSegmentRunEnabled(i);
            const fl2vStart = !this.isFl2vMode() || !!seg.isStartFrame;
            const visualRank = this._visualRankFromArrayIndex(i);
            const isDragSource = reordering && visualRank === dragFromRank;
            const isDropTarget = reordering && dropRank >= 0 && visualRank === dropRank && dropRank !== dragFromRank;
            if (this.isRunSelectEnabled() && this.getRunnableSegmentCount() >= 2 && fl2vStart && !runOn) {
                this.ctx.globalAlpha = 0.32;
            } else if (isDragSource) {
                this.ctx.globalAlpha = 0.28;
            } else if (reordering && !isDropTarget) {
                this.ctx.globalAlpha = 0.55;
            } else if (this.isFl2vMode() && !seg.isStartFrame) {
                this.ctx.globalAlpha = 0.72;
            }
            this.drawSegmentThumbnails(this.ctx, seg, x0, pxW, TRACK_Y, TRACK_H);
            if (!this.isFl2vMode() || seg.isStartFrame) {
                this.drawPromptOverlay(this.ctx, seg, x0, pxW, TRACK_Y, TRACK_H);
            }
            const clipIdx = this.getSegmentClipIndex(seg);
            const clipColor = CLIP_SEGMENT_COLORS[clipIdx % CLIP_SEGMENT_COLORS.length];
            if (isDropTarget) {
                this.ctx.fillStyle = "rgba(79,255,143,0.14)";
                this.ctx.fillRect(x0, TRACK_Y, pxW, TRACK_H);
                this.ctx.strokeStyle = "#4fff8f";
                this.ctx.lineWidth = 3;
                this.ctx.setLineDash([7, 4]);
                this.ctx.strokeRect(x0 + 1, TRACK_Y + 1, pxW - 2, TRACK_H - 2);
                this.ctx.setLineDash([]);
                this.ctx.fillStyle = "rgba(20,40,28,0.92)";
                const label = this.isFl2vMode() ? t("canvas.swapHere") : t("canvas.insertHere");
                this.ctx.font = "bold 11px sans-serif";
                const tw = this.ctx.measureText(label).width + 12;
                this.ctx.fillRect(x0 + (pxW - tw) / 2, TRACK_Y + 8, tw, 18);
                this.ctx.fillStyle = "#4fff8f";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText(label, x0 + pxW / 2, TRACK_Y + 17);
            } else {
                this.ctx.strokeStyle = running || sel ? "#4fff8f" : clipColor;
                this.ctx.lineWidth = running ? 3 : sel ? 2.5 : 1.5;
                this.ctx.strokeRect(x0 + 0.5, TRACK_Y + 0.5, pxW - 1, TRACK_H - 1);
                if (sel && !running) {
                    this.ctx.fillStyle = "rgba(79,255,143,0.08)";
                    this.ctx.fillRect(x0 + 1, TRACK_Y + 1, Math.max(0, pxW - 2), TRACK_H - 2);
                }
            }
            if (this.isFl2vMode()) {
                // Hatch the portion past the sampling window (不计入采样).
                const sampleN = getFl2vSampleFrames(this);
                const segEnd = seg.start + seg.length;
                if (segEnd > sampleN && seg.start < segEnd) {
                    const ox0 = this.frameToX(Math.max(seg.start, sampleN), width);
                    const ox1 = this.frameToX(segEnd, width);
                    if (ox1 > ox0 + 1) {
                        this.ctx.save();
                        this.ctx.beginPath();
                        this.ctx.rect(ox0, TRACK_Y + 1, ox1 - ox0, TRACK_H - 2);
                        this.ctx.clip();
                        this.ctx.fillStyle = "rgba(0,0,0,0.45)";
                        this.ctx.fillRect(ox0, TRACK_Y + 1, ox1 - ox0, TRACK_H - 2);
                        this.ctx.strokeStyle = "rgba(200,200,200,0.55)";
                        this.ctx.lineWidth = 1;
                        this.ctx.setLineDash([5, 4]);
                        this.ctx.strokeRect(ox0 + 0.5, TRACK_Y + 1.5, Math.max(0, ox1 - ox0 - 1), TRACK_H - 3);
                        this.ctx.setLineDash([]);
                        this.ctx.restore();
                    }
                }
                this._drawFl2vEdgeHandles(segs, i, x0, x1, width);
            } else {
                this.ctx.fillStyle = "#ffcc00";
                this.ctx.fillRect(x0 - 2, TRACK_Y + TRACK_H / 2 - 12, 4, 24);
                this.ctx.fillRect(x1 - 2, TRACK_Y + TRACK_H / 2 - 12, 4, 24);
            }
            this.ctx.globalAlpha = 1;
            // Checkbox on top-left; drawn last so it stays clear on dimmed segments.
            if (
                this.isRunSelectEnabled()
                && this.getRunnableSegmentCount() >= 2
                && pxW >= RUN_CHECK_SIZE + 8
                && (!this.isFl2vMode() || seg.isStartFrame)
            ) {
                const g = this._runCheckGeometry(seg, width);
                this._drawSegmentRunCheck(g.boxX, g.boxY, runOn);
            }
        }


        // Consumer-side Previous Context controls. The icon sits at the
        // boundary but slightly inside the track so split diamonds remain usable.
        for (let i = 1; i < segs.length; i++) {
            const g = this._contextLinkGeometry(i, width, segs);
            if (!g) continue;
            const mode = this.getSegmentContextMode(i);
            const colors = {
                both: [DIRECTOR_STATE_COLORS.activeBackground, DIRECTOR_STATE_COLORS.accent],
                visual: [DIRECTOR_STATE_COLORS.activeBackground, DIRECTOR_STATE_COLORS.accent],
                audio: [DIRECTOR_STATE_COLORS.activeBackground, DIRECTOR_STATE_COLORS.accent],
                off: [DIRECTOR_STATE_COLORS.neutralBackground, DIRECTOR_STATE_COLORS.neutralBorder],
            };
            const [fill, stroke] = colors[mode] || colors.off;
            this.ctx.save();
            this.ctx.fillStyle = fill;
            this.ctx.strokeStyle = stroke;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            this.ctx.fillStyle = stroke;
            this.ctx.font = "bold 10px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText(mode === "off" ? "×" : (mode === "both" ? "↔" : mode[0].toUpperCase()), g.x, g.y + 0.5);
            this.ctx.restore();
        }

        // fl2v: dashed overlay for the region past the sampling window.
        if (this.isFl2vMode()) {
            const sampleN = getFl2vSampleFrames(this);
            if (total > sampleN) {
                const ox = this.frameToX(sampleN, width);
                this.ctx.save();
                this.ctx.strokeStyle = "rgba(180,180,180,0.7)";
                this.ctx.lineWidth = 1.5;
                this.ctx.setLineDash([6, 5]);
                this.ctx.beginPath();
                this.ctx.moveTo(ox + 0.5, TRACK_Y);
                this.ctx.lineTo(ox + 0.5, TRACK_Y + TRACK_H);
                this.ctx.stroke();
                this.ctx.strokeRect(ox + 1, TRACK_Y + 1, Math.max(0, width - ox - 2), TRACK_H - 2);
                this.ctx.setLineDash([]);
                this.ctx.restore();
            }
        }

        if (reordering) {
            this._drawReorderGhost(width, segs, dragFromRank);
            if (dropRank >= 0 && dropRank !== dragFromRank && !this.isFl2vMode()) {
                const insertFrame = this._getReorderInsertFrame(dropRank, dragFromRank);
                const ix = this.frameToX(insertFrame, width);
                this._drawReorderInsertMarker(ix);
            }
        }

        // Editable split-point markers: click = select only; delete via toolbar button.
        const splitFrames = this.getEditableSplitFrames();
        if (splitFrames.length) {
            for (const frame of splitFrames) {
                const sx = this.frameToX(frame, width);
                const selected = this.selectedSplitFrame === frame;
                this.ctx.strokeStyle = selected ? "#ffe066" : "rgba(80, 220, 255, 0.95)";
                this.ctx.fillStyle = selected ? "#ffe066" : "rgba(80, 220, 255, 0.9)";
                this.ctx.lineWidth = selected ? 3.5 : 2;
                this.ctx.beginPath();
                this.ctx.moveTo(sx, RULER_H + 2);
                this.ctx.lineTo(sx, TRACK_Y + TRACK_H - 2);
                this.ctx.stroke();
                const cy = RULER_H + SEG_LABEL_H / 2;
                const r = selected ? 8 : 6;
                this.ctx.beginPath();
                this.ctx.moveTo(sx, cy - r);
                this.ctx.lineTo(sx + r, cy);
                this.ctx.lineTo(sx, cy + r);
                this.ctx.lineTo(sx - r, cy);
                this.ctx.closePath();
                this.ctx.fill();
                if (selected) {
                    this.ctx.strokeStyle = "#fff";
                    this.ctx.lineWidth = 1.5;
                    this.ctx.stroke();
                    // Halo so selection is obvious on dense timelines.
                    this.ctx.strokeStyle = "rgba(255, 224, 102, 0.55)";
                    this.ctx.lineWidth = 6;
                    this.ctx.beginPath();
                    this.ctx.moveTo(sx, TRACK_Y);
                    this.ctx.lineTo(sx, TRACK_Y + TRACK_H);
                    this.ctx.stroke();
                }
            }
        }

        const phx = this.frameToX(this.currentFrame, width);
        this.ctx.strokeStyle = "#ff4444";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(phx, 0);
        this.ctx.lineTo(phx, height);
        this.ctx.stroke();

        const exportCap = this.getMaxExportFrames();
        const exportTotal = this.getExportFrameTotal();
        if (exportCap > 0 && exportTotal < total) {
            const capX = this.frameToX(exportTotal, width);
            this.ctx.fillStyle = "rgba(0,0,0,0.35)";
            this.ctx.fillRect(capX, TRACK_Y, width - capX, TRACK_H);
            this.ctx.strokeStyle = "#66aaff";
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([4, 3]);
            this.ctx.beginPath();
            this.ctx.moveTo(capX, 0);
            this.ctx.lineTo(capX, height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = "#66aaff";
            this.ctx.font = "10px sans-serif";
            this.ctx.fillText(t("canvas.exportCap", { n: exportTotal }), capX + 4, TRACK_Y + 12);
        }
    }

    _updateTimelineDom({ skipSeek = false } = {}) {
        const segs = this._previewSegments || this.timeline.segments;
        const totalFrames = Math.max(0, this.getTotalFrames());
        const cur = this.formatTime(this.currentFrame);
        const total = this.formatTime(totalFrames);
        if (this.timecodeEl) this.timecodeEl.textContent = `${cur}s`;
        if (this.playerTimecodeEl) this.playerTimecodeEl.textContent = `${cur} / ${total}`;
        if (this.frameTotalEl) this.frameTotalEl.textContent = String(totalFrames);
        if (this.frameInputEl) {
            this.frameInputEl.max = String(Math.max(1, totalFrames));
            // Don't overwrite while the user is typing a target frame.
            if (document.activeElement !== this.frameInputEl) {
                this.frameInputEl.value = String(totalFrames > 0 ? this.currentFrame + 1 : 1);
            }
        }
        if (!skipSeek && this.seekBar && +this.seekBar.value !== this.currentFrame) {
            this.seekBar.value = this.currentFrame;
        }
        if (this.seekBar) this.seekBar.max = Math.max(0, totalFrames - 1);
        if (this.selectedSplitFrame != null && this.getEditableSplitFrames().includes(this.selectedSplitFrame)) {
            if (this.boundsEl) {
                this.boundsEl.textContent = t("split.boundsEditable", { f: this.selectedSplitFrame });
            }
        } else {
            const seg = segs[this.selectedIndex];
            if (seg && this.boundsEl) {
                this.boundsEl.textContent = t("bounds.range", {
                    start: this.formatTime(seg.start),
                    end: this.formatTime(seg.start + seg.length),
                });
            }
        }
        this.updateSplitPointUI();
    }

    /** Jump to an exact 0-based logical frame; syncs seek bar, preview, playhead. */
    seekToFrame(frame, { fromUi = false } = {}) {
        const total = this.getTotalFrames();
        if (total < 1) return;
        if (this.isPlaying) this._stopPlay();
        const next = clamp(Math.round(Number(frame) || 0), 0, total - 1);
        this.currentFrame = next;
        if (this.seekBar) {
            this.seekBar.max = Math.max(0, total - 1);
            this.seekBar.value = next;
        }
        this._syncStagePreview(next, { force: true });
        this._updateTimelineDom({ skipSeek: true });
        // Select the segment that contains this frame for editing context.
        const segs = this.timeline.segments || [];
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (next >= s.start && next < s.start + s.length) {
                if (this.selectedIndex !== i) {
                    this.selectedIndex = i;
                    this.updateSelectionUI();
                }
                break;
            }
        }
        this.scheduleRender();
        if (fromUi) this._queueThumbPrefetch?.(next);
    }

    stepFrame(delta) {
        const total = this.getTotalFrames();
        if (total < 1) return;
        this.seekToFrame(this.currentFrame + (Number(delta) || 0), { fromUi: true });
    }

    formatTime(frames) { return (frames / this.getFrameRate()).toFixed(2); }

    updateSelectionUI() {
        if (this.isMixedMode()) return;
        this.timeline.global = this.timeline.global || { taskType: "", prompt: "", refs: [] };
        if (this.globalTask) this.globalTask.value = this.timeline.global.taskType || "";
        if (this.globalPrompt) {
            const value = this.timeline.global.prompt || "";
            if (this.globalPrompt._mmxMentionController) this.globalPrompt._mmxMentionController.setValue(value);
            else this.globalPrompt.value = value;
        }
        this.syncNegativeFromWidget();
        updateFl2vToolbarBtns(this);
        updateR2vToolbarBtns(this);
        if (this.isFl2vMode()) updateFl2vDetailUI(this);
        if (this.isImageBatch()) this._syncR2vCardSelection();

        const hideTimeline = this.isImageBatch() || this.isGenMode();
        const seg = this.isGlobalMode() ? null : this.timeline.segments[this.selectedIndex];
        this.updateReferenceImageVisibility({ hideTimeline, seg: seg || null });

        if (this.isGlobalMode() && taskUsesReferenceImages(this.getTaskKey())) {
            this.renderRefSlots(this.timeline.global.refs, this.globalRefsBox, true);
        }
        if (this.isGlobalMode() && taskUsesReferenceAudios(this.getTaskKey())) {
            this.renderRefAudioSlots();
        }
        const refVideoKey = this.isGlobalMode()
            ? this.getTaskKey()
            : resolveTaskKey(seg?.taskType || this.timeline.global?.taskType || this.getTaskKey());
        if (taskUsesReferenceVideo(refVideoKey)) {
            this.renderRefVideoSlot();
        }
        if (this.isGenImage() && this.isGlobalMode()) {
            this.renderGenSrcSlot(
                this.genGlobalImg,
                this.timeline.global?.genImage?.imageFile,
                t("panel.uploadSourceImage"),
            );
        }
        if (this.isGenMode() && this.isGlobalMode()) {
            const defFc = this.timeline.gen?.defaultFrameCount ?? defaultFrameCount(this.getTaskKey());
            if (this.genDefaultFc) this.genDefaultFc.value = defFc;
        }

        if (this.isGlobalMode()) return;

        if (!seg) return;
        const liveSeg = (this._previewSegments || this.timeline.segments)?.[this.selectedIndex] || seg;
        const segKey = resolveTaskKey(liveSeg.taskType || this.timeline.global?.taskType || this.getTaskKey());
        this.segLabel.textContent = t("panel.segmentN", { n: this.selectedIndex + 1 });
        this._updateSegInfoFromSegment(liveSeg);
        const value = liveSeg.prompt || "";
        if (this.segPrompt._mmxMentionController) this.segPrompt._mmxMentionController.setValue(value);
        else this.segPrompt.value = value;
        if (taskUsesReferenceImages(segKey)) {
            this.renderRefSlots(liveSeg.refs, this.segRefsBox, false);
        }
        if (taskUsesReferenceAudios(segKey)) {
            this.renderRefAudioSlots();
        }
        if (this.isGenImage() && !this.isGlobalMode()) {
            this.renderGenSrcSlot(this.genSegImg, liveSeg.genImage?.imageFile, t("panel.uploadSegmentSourceImage"));
        }
        if (this.isGenMode() && !this.isGlobalMode()) {
            const fc = liveSeg.frameCount ?? liveSeg.length ?? defaultFrameCount(this.getTaskKey());
            if (this.genSegFc) this.genSegFc.value = fc;
        }
        if (this.isFl2vMode()) updateFl2vDetailUI(this);
    }

    renderRefSlots(refs, box, isGlobal) {
        if (!box) return;
        box.innerHTML = "";
        const target = isGlobal
            ? this.timeline.global
            : this.timeline.segments[this.selectedIndex];
        const taskKey = isGlobal
            ? this.getTaskKey()
            : resolveTaskKey(
                target?.taskType || this.timeline.global?.taskType || this.globalTask?.value || this.getTaskKey(),
            );
        const polished = this.usesRv2vRefStyle(taskKey);
        const wrap = isGlobal ? this.globalRefsImagesWrap : this.segRefsImagesWrap;
        const countEl = isGlobal ? this.globalRefsCount : this.segRefsCount;
        const PIC_STEP = 3;
        const PIC_SLOTS = MAX_REFERENCE_IMAGES;

        let filled = 0;
        let highestFilled = -1;
        for (const r of refs || []) {
            const idx = Number(r.index ?? r.slot);
            const has = !!(r?.imageFile || r?.imageB64);
            if (!has || !Number.isFinite(idx) || idx < 0 || idx >= PIC_SLOTS) continue;
            filled += 1;
            highestFilled = Math.max(highestFilled, idx);
        }
        if (countEl) countEl.textContent = polished ? `${filled}/${PIC_SLOTS}` : "";

        if (!this._rv2vPicsVisible) this._rv2vPicsVisible = {};
        const visKey = isGlobal ? "global" : `seg:${target?.id ?? this.selectedIndex}`;
        const minVisible = highestFilled >= 0
            ? Math.min(PIC_SLOTS, Math.ceil((highestFilled + 1) / PIC_STEP) * PIC_STEP)
            : PIC_STEP;
        let visible = polished
            ? (Number(this._rv2vPicsVisible[visKey]) || PIC_STEP)
            : PIC_SLOTS;
        if (polished) {
            visible = Math.max(PIC_STEP, Math.min(PIC_SLOTS, visible));
            if (visible < minVisible) visible = minVisible;
            this._rv2vPicsVisible[visKey] = visible;
        }

        for (let i = 0; i < PIC_SLOTS; i++) {
            const el = document.createElement("div");
            el.className = "bd-ref";
            if (polished && i >= visible) el.classList.add("bd-r2v-pic-hidden");
            el.dataset.refSlot = String(i);
            el.dataset.refScope = isGlobal ? "global" : "seg";
            const label = refImageLabel(i);
            el.title = t("ref.slotTitle", { label });
            const ref = (refs || []).find((r) => Number(r.index ?? r.slot) === i);
            const tag = document.createElement("span");
            tag.className = polished ? "cap" : "bd-ref-tag";
            tag.textContent = label;
            el.appendChild(tag);
            if (ref?.imageFile) {
                el.classList.add("has-img");
                const img = document.createElement("img");
                img.src = refViewUrl(ref.imageFile);
                img.draggable = false;
                el.appendChild(img);
                if (polished) {
                    const dot = document.createElement("span");
                    dot.className = "dot";
                    el.appendChild(dot);
                }
                const x = document.createElement("span");
                x.className = "x";
                x.textContent = "×";
                x.onclick = (e) => {
                    e.stopPropagation();
                    this.removeRef(target, i);
                };
                el.appendChild(x);
            } else if (ref?.imageB64) {
                el.classList.add("has-img");
                const img = document.createElement("img");
                img.src = ref.imageB64.startsWith("data:") ? ref.imageB64 : `data:image/png;base64,${ref.imageB64}`;
                img.draggable = false;
                el.appendChild(img);
                if (polished) {
                    const dot = document.createElement("span");
                    dot.className = "dot";
                    el.appendChild(dot);
                }
                const x = document.createElement("span");
                x.className = "x";
                x.textContent = "×";
                x.onclick = (e) => {
                    e.stopPropagation();
                    this.removeRef(target, i);
                };
                el.appendChild(x);
            }
            this._bindRefSlotDnD(el, target, i, isGlobal);
            el.onclick = () => {
                if (this._refDragMoved) {
                    this._refDragMoved = false;
                    return;
                }
                this.pickRef(target, i, isGlobal);
            };
            box.appendChild(el);
        }

        wrap?.querySelectorAll(".bd-r2v-pics-toggle").forEach((btn) => btn.remove());
        if (polished && wrap) {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "bd-r2v-pics-toggle";
            const syncToggleLabel = () => {
                if (visible < PIC_SLOTS) {
                    const next = Math.min(PIC_STEP, PIC_SLOTS - visible);
                    toggle.textContent = t("batch.r2v.expandPics", { n: next });
                } else {
                    toggle.textContent = t("batch.r2v.collapsePics");
                }
            };
            syncToggleLabel();
            toggle.onclick = (e) => {
                e.stopPropagation();
                if (visible < PIC_SLOTS) {
                    visible = Math.min(PIC_SLOTS, visible + PIC_STEP);
                } else {
                    visible = Math.max(PIC_STEP, minVisible);
                }
                this._rv2vPicsVisible[visKey] = visible;
                box.querySelectorAll(".bd-ref").forEach((el, i) => {
                    el.classList.toggle("bd-r2v-pic-hidden", i >= visible);
                });
                syncToggleLabel();
                this.updateDomWidgetHeight?.();
            };
            wrap.appendChild(toggle);
        }
    }

    _bindRefSlotDnD(el, target, slotIndex, isGlobal) {
        const hasImg = el.classList.contains("has-img");
        el.draggable = hasImg;
        el.addEventListener("dragstart", (e) => {
            if (!hasImg) {
                e.preventDefault();
                return;
            }
            this._refDragMoved = false;
            const payload = JSON.stringify({
                scope: isGlobal ? "global" : "seg",
                segIndex: isGlobal ? -1 : this.selectedIndex,
                from: slotIndex,
            });
            e.dataTransfer.setData("application/x-minimax-ref-slot", payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", () => {
            // click may fire after dragend; keep suppress for one tick
            setTimeout(() => { this._refDragMoved = false; }, 0);
        });
        el.addEventListener("dragover", (e) => {
            const types = e.dataTransfer?.types || [];
            if (![...types].includes("application/x-minimax-ref-slot") && ![...types].includes("Files")) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = [...types].includes("application/x-minimax-ref-slot")
                ? "move"
                : "copy";
        });
        el.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const raw = e.dataTransfer.getData("application/x-minimax-ref-slot")
                || e.dataTransfer.getData("text/plain");
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    const scope = isGlobal ? "global" : "seg";
                    if (data.scope !== scope) return;
                    if (!isGlobal && data.segIndex !== this.selectedIndex) return;
                    this._refDragMoved = true;
                    this.moveRefSlot(target, Number(data.from), slotIndex, isGlobal);
                    return;
                } catch (_) { /* fall through to file drop */ }
            }
            const f = e.dataTransfer.files?.[0];
            if (f?.type?.startsWith("image/")) {
                this.addRefFromFile(f, target, slotIndex, isGlobal);
            }
        });
    }

    moveRefSlot(target, fromIndex, toIndex, isGlobal) {
        if (!target || fromIndex === toIndex) return;
        const refs = [...(target.refs || [])];
        const fromRef = refs.find((r) => Number(r.index ?? r.slot) === fromIndex);
        if (!fromRef) return;
        const toRef = refs.find((r) => Number(r.index ?? r.slot) === toIndex);
        target.refs = refs.filter((r) => {
            const idx = Number(r.index ?? r.slot);
            return idx !== fromIndex && idx !== toIndex;
        });
        target.refs.push({ ...fromRef, index: toIndex, slot: undefined });
        if (toRef) {
            target.refs.push({ ...toRef, index: fromIndex, slot: undefined });
        }
        if (isGlobal) this.timeline.global = target;
        this.commit();
    }

    removeRef(target, index) {
        target.refs = (target.refs || []).filter((r) => Number(r.index ?? r.slot) !== index);
        this.commit();
    }

    renderRefAudioSlots() {
        const isGlobal = this.isGlobalMode();
        const box = isGlobal ? this.globalRefAudiosBox : this.segRefAudiosBox;
        if (!box) return;
        const target = isGlobal
            ? (this.timeline.global = this.timeline.global || { refs: [], refAudios: [] })
            : this.timeline.segments[this.selectedIndex];
        if (!target) return;
        target.refAudios = target.refAudios || [];
        const taskKey = isGlobal
            ? this.getTaskKey()
            : resolveTaskKey(
                target?.taskType || this.timeline.global?.taskType || this.globalTask?.value || this.getTaskKey(),
            );
        const polished = this.usesRv2vRefStyle(taskKey);
        const countEl = isGlobal ? this.globalAudiosCount : this.segAudiosCount;
        let filled = 0;
        for (const r of target.refAudios) {
            if (r?.audioFile || r?.fileName) filled += 1;
        }
        if (countEl) countEl.textContent = polished ? `${filled}/${MAX_REFERENCE_AUDIOS}` : "";

        box.innerHTML = "";
        for (let i = 0; i < MAX_REFERENCE_AUDIOS; i++) {
            const el = document.createElement("div");
            el.className = "bd-ref-audio";
            el.dataset.audioSlot = String(i);
            const label = refAudioLabel(i);
            const ref = (target.refAudios || []).find((r) => Number(r.index ?? r.slot) === i);
            const file = ref?.audioFile || ref?.fileName || "";
            el.title = file
                ? t("ref.audioTitleFilled", { label, file })
                : t("ref.audioTitleEmpty", { label });
            if (polished) {
                const thumb = document.createElement("div");
                thumb.className = "bd-r2v-thumb";
                const meta = document.createElement("div");
                meta.className = "bd-r2v-meta";
                const tag = document.createElement("span");
                tag.className = "tag";
                tag.textContent = label;
                meta.appendChild(tag);
                el.appendChild(thumb);
                el.appendChild(meta);
                if (file) {
                    el.classList.add("has-audio");
                    const playBtn = document.createElement("button");
                    playBtn.type = "button";
                    playBtn.className = "bd-r2v-play";
                    playBtn.title = t("batch.r2v.play");
                    playBtn.textContent = "▶";
                    thumb.appendChild(playBtn);
                    const dur = document.createElement("span");
                    dur.className = "bd-r2v-dur";
                    dur.textContent = ref?.durationSec != null
                        ? formatMediaDuration(ref.durationSec)
                        : "--:--";
                    meta.appendChild(dur);
                    const progress = document.createElement("div");
                    progress.className = "bd-r2v-progress";
                    progress.title = t("batch.r2v.seek");
                    progress.innerHTML = `<div class="bd-r2v-progress-fill"></div>`;
                    el.appendChild(progress);
                    const audio = document.createElement("audio");
                    audio.preload = "metadata";
                    audio.src = refViewUrl(file);
                    audio.className = "bd-r2v-media";
                    el.appendChild(audio);
                    bindR2vMediaPlayback(audio, playBtn, progress);
                    wireMediaDuration(audio, dur, (sec) => {
                        if (ref) ref.durationSec = sec;
                    });
                    const x = document.createElement("span");
                    x.className = "x";
                    x.textContent = "×";
                    x.onclick = (e) => {
                        e.stopPropagation();
                        this.removeRefAudio(target, i);
                    };
                    el.appendChild(x);
                } else {
                    thumb.textContent = "♪";
                    const hint = document.createElement("span");
                    hint.className = "name";
                    hint.textContent = t("batch.r2v.uploadHint");
                    meta.appendChild(hint);
                }
            } else if (file) {
                el.classList.add("has-audio");
                const tag = document.createElement("span");
                tag.textContent = label;
                el.appendChild(tag);
                const name = document.createElement("span");
                name.className = "bd-ref-audio-name";
                name.textContent = file.split("/").pop() || file;
                el.appendChild(name);
                const x = document.createElement("span");
                x.className = "x";
                x.textContent = "×";
                x.onclick = (e) => {
                    e.stopPropagation();
                    this.removeRefAudio(target, i);
                };
                el.appendChild(x);
            } else {
                el.textContent = t("ref.audioUpload", { label });
            }
            el.onclick = (e) => {
                if (e.target?.closest?.(".bd-r2v-play, .bd-r2v-progress, .x")) return;
                this.pickRefAudio(target, i);
            };
            box.appendChild(el);
        }
    }

    removeRefAudio(target, index) {
        if (!target) return;
        target.refAudios = (target.refAudios || []).filter((r) => Number(r.index ?? r.slot) !== index);
        this.commit();
        this.renderRefAudioSlots();
    }

    pickRefAudio(target, index) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) this.addRefAudioFromFile(file, target, index);
        };
        input.click();
    }

    async addRefAudioFromFile(file, target, slotIndex = null) {
        if (!target || !file) return;
        target.refAudios = target.refAudios || [];
        let index = slotIndex;
        if (index == null) {
            index = Array.from({ length: MAX_REFERENCE_AUDIOS }, (_, i) => i)
                .find((i) => !target.refAudios.some((r) => Number(r.index ?? r.slot) === i));
            if (index == null) return;
        }
        try {
            const uploaded = await uploadToInput(file);
            const relPath = videoRelativePath(uploaded);
            target.refAudios = target.refAudios.filter((r) => Number(r.index ?? r.slot) !== index);
            target.refAudios.push({
                index,
                audioFile: relPath,
                fileName: uploaded?.name || file.name,
                type: "input",
                subfolder: uploaded?.subfolder || "",
            });
            this.commit();
            this.renderRefAudioSlots();
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] ref audio upload failed:", err);
            alert(t("upload.refAudioFailed", { err: err?.message || err }));
        }
    }

    pickRef(target, index, isGlobal) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) this.addRefFromFile(file, target, index, isGlobal);
        };
        input.click();
    }

    async addRefFromFile(file, target, slotIndex = null, isGlobal = null) {
        target.refs = target.refs || [];
        let index = slotIndex;
        if (index == null) {
            index = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, i) => i)
                .find((i) => !target.refs.some((r) => Number(r.index ?? r.slot) === i));
            if (index == null) return;
        }
        try {
            const uploaded = await uploadToInput(file);
            const relPath = videoRelativePath(uploaded);
            target.refs = target.refs.filter((r) => Number(r.index ?? r.slot) !== index);
            target.refs.push({ index, imageFile: relPath, imageB64: "" });
            if (isGlobal) this.timeline.global = target;
            this.commit();
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] ref upload failed:", err);
        }
    }

    onGlobalField(field, value) {
        if (field === "taskType") {
            const currentMode = this._directorMode || this.getDirectorMode();
            const nextMode = getDirectorMode(value);
            if (nextMode === "mixed") {
                if (currentMode !== "mixed") this._standaloneDirectorMode = currentMode;
                if (this.globalTask) this.globalTask.value = value;
                if (this.taskTypeWidget) this.taskTypeWidget.value = value;
                this.applyTaskLayout(currentMode);
                this.scheduleTimelineSync();
                this.updateModeUI?.();
                this.updateSelectionUI?.();
                return;
            }
            if (currentMode === "mixed") {
                this.timeline.global = this.timeline.global || { refs: [] };
                this.timeline.global.taskType = value;
                if (this.globalTask) this.globalTask.value = value;
                if (this.taskTypeWidget) this.taskTypeWidget.value = value;
                this.applyTaskLayout("mixed");
                this.scheduleTimelineSync();
                this.updateModeUI?.();
                this.updateSelectionUI?.();
                return;
            }
        }
        this.timeline.global = this.timeline.global || { refs: [] };
        if (field === "taskType") {
            const prevTaskKey = resolveTaskKey(
                this.timeline.global?.taskType || this.globalTask?.value || this.taskTypeWidget?.value || "",
            );
            const nextTaskKey = resolveTaskKey(value);
            const switchingBatchTask = this.getDirectorMode() === "prompt_batch"
                && getDirectorMode(value) === "prompt_batch"
                && prevTaskKey !== nextTaskKey;
            if (switchingBatchTask) {
                this._stashBatchTaskWorkspace(prevTaskKey);
                if (!this._restoreBatchTaskWorkspace(nextTaskKey)) {
                    this.timeline.segments = [newBatchSegment({
                        prompt: "",
                        negativePrompt: "",
                        useCommonAssets: true,
                        excludedCommonAssetIds: [],
                    })];
                    this.selectedIndex = 0;
                    this._clearLiveRunSelection();
                }
            }
            this.timeline.global[field] = value;
            const prevMode = this._directorMode || "video";
            if (this.globalTask && this.globalTask.value !== value) this.globalTask.value = value;
            if (this.taskTypeWidget) this.taskTypeWidget.value = value;
            if (prevTaskKey === "ads2v" && resolveTaskKey(value) !== "ads2v") {
                this._stopRefVideoPreviews();
            }
            this.applyTaskLayout(prevMode);
        } else {
            this.timeline.global[field] = value;
        }
        if (field === "prompt" && this.globalPromptWidget) this.globalPromptWidget.value = value;
        this.scheduleTimelineSync();
        this.scheduleRender();
        refreshDirectorContinuityUi(this.node, this);
    }

    onSegField(field, value) {
        const seg = this.timeline.segments[this.selectedIndex];
        if (!seg) return;
        seg[field] = value;
        this.scheduleTimelineSync();
        this.scheduleRender();
    }

    onNegativePrompt(value) {
        if (this.negativePromptWidget) this.negativePromptWidget.value = value;
        if (this.globalNegative && this.globalNegative.value !== value) this.globalNegative.value = value;
        if (this.segNegative && this.segNegative.value !== value) this.segNegative.value = value;
        this._markNodeDirtyLight();
    }

    toggleLoop() {
        this.isLooping = !this.isLooping;
        const btn = this.root.querySelector('[data-a="loop"]');
        btn?.classList.toggle("active", this.isLooping);
        this.refreshLoopButtonTitle();
    }

    refreshLoopButtonTitle() {
        const btn = this.root?.querySelector('[data-a="loop"]');
        if (!btn) return;
        btn.title = this.isLooping ? t("player.loopEnabled") : t("player.loopOff");
        btn.removeAttribute("data-i18n-title");
    }

    isLiveTaePreviewEnabled() {
        return this.postprocessStore?.get?.().preview?.enabled !== false;
    }

    /** fl2v / v2v / rv2v (and aliases): show dedicated live-sample panel when toggle is on. */
    needsLiveSamplePanel() {
        return false;
    }

    toggleLiveTaePreview() {
        this.postprocessStore?.patch("preview", "enabled", !this.isLiveTaePreviewEnabled());
        this.timeline.liveTaePreview = this.isLiveTaePreviewEnabled();
        this.refreshLiveTaePreviewButton();
        this.updateLiveSamplePanel();
        this.scheduleTimelineSync();
        this.updateDomWidgetHeight?.();
        syncDirectorNodeSize(this.node, this);
    }

    refreshLiveTaePreviewButton() {
        const btn = this.root?.querySelector('[data-a="live-tae-preview"]');
        if (!btn) return;
        const on = this.isLiveTaePreviewEnabled();
        btn.classList.toggle("active", on);
        btn.textContent = t("toolbar.liveTaePreview");
        btn.title = on ? t("tooltip.liveTaePreviewOn") : t("tooltip.liveTaePreviewOff");
        btn.setAttribute("data-i18n", "toolbar.liveTaePreview");
        btn.removeAttribute("data-i18n-title");
    }

    _clearEmbeddedLiveLayoutClasses() {
        this.globalPromptLayout?.classList.remove("bd-v2v-with-live", "bd-rv2v-with-live");
        this.segPromptLayout?.classList.remove("bd-v2v-with-live", "bd-rv2v-with-live");
    }

    _activePromptLayout() {
        return this.isGlobalMode?.() ? this.globalPromptLayout : this.segPromptLayout;
    }

    _placeLiveSamplePanel() {
        const panel = this.liveSampleEl;
        if (!panel) return false;

        if (this.isFl2vMode?.() && this.fl2vUi?.workbench && this.fl2vUi?.shotsEl) {
            this._clearEmbeddedLiveLayoutClasses();
            if (this._liveSampleHost !== "fl2v" || panel.parentElement !== this.fl2vUi.workbench) {
                this.fl2vUi.workbench.insertBefore(panel, this.fl2vUi.shotsEl);
                this._liveSampleHost = "fl2v";
            }
            return true;
        }

        const layout = this._activePromptLayout();

        // v2v: preview sits to the right of the prompt column.
        if (this.usesV2vPromptStyle?.() && this.isLiveTaePreviewEnabled() && layout) {
            if (panel.parentElement !== layout) layout.appendChild(panel);
            this.globalPromptLayout?.classList.toggle("bd-v2v-with-live", layout === this.globalPromptLayout);
            this.segPromptLayout?.classList.toggle("bd-v2v-with-live", layout === this.segPromptLayout);
            this.globalPromptLayout?.classList.remove("bd-rv2v-with-live");
            this.segPromptLayout?.classList.remove("bd-rv2v-with-live");
            this._liveSampleHost = "v2v";
            return true;
        }

        // rv2v: preview under the prompt (same stack as r2v right column).
        if (this.usesRv2vRefStyle?.() && this.isLiveTaePreviewEnabled() && layout) {
            const promptCol = layout.querySelector(".bd-prompt-col");
            if (promptCol) {
                if (panel.parentElement !== promptCol) promptCol.appendChild(panel);
                this.globalPromptLayout?.classList.toggle("bd-rv2v-with-live", layout === this.globalPromptLayout);
                this.segPromptLayout?.classList.toggle("bd-rv2v-with-live", layout === this.segPromptLayout);
                this.globalPromptLayout?.classList.remove("bd-v2v-with-live");
                this.segPromptLayout?.classList.remove("bd-v2v-with-live");
                this._liveSampleHost = "rv2v";
                return true;
            }
        }

        this._clearEmbeddedLiveLayoutClasses();
        panel.remove();
        this._liveSampleHost = null;
        return false;
    }

    updateLiveSamplePanel() {
        const panel = this.liveSampleEl;
        if (!panel) return;
        const show = this.needsLiveSamplePanel() && this._placeLiveSamplePanel();
        panel.classList.toggle("hidden", !show);
        if (!show) {
            panel.classList.remove("receiving");
            return;
        }
        if (!this._liveSampleB64) {
            this.liveSampleImg?.classList.add("hidden");
            this.liveSampleEmpty?.classList.remove("hidden");
            this.liveSampleBadge?.classList.add("hidden");
            if (this.liveSampleMeta) this.liveSampleMeta.textContent = t("liveSample.idleHint");
        }
    }

    clearLiveSamplePreview() {
        this._liveSampleB64 = "";
        this._liveSampleStep = null;
        this._liveSampleTotal = null;
        this._liveSampleSeg = null;
        this.liveSampleEl?.classList.remove("receiving");
        if (this.liveSampleImg) {
            this.liveSampleImg.removeAttribute("src");
            this.liveSampleImg.classList.add("hidden");
        }
        this.liveSampleEmpty?.classList.remove("hidden");
        this.liveSampleBadge?.classList.add("hidden");
        if (this.liveSampleMeta) this.liveSampleMeta.textContent = t("liveSample.idleHint");
        this.outputUi?.clear?.();
    }

    setLiveSamplePreview(detail = {}) {
        this.outputUi?.consumePreview?.(detail);
        if (!this.needsLiveSamplePanel()) return;
        const b64 = detail.image_b64 || detail.imageB64 || "";
        if (!b64) return;
        if (!this._placeLiveSamplePanel()) return;
        this.liveSampleEl?.classList.remove("hidden");
        this._liveSampleB64 = b64;
        this._liveSampleStep = detail.step ?? null;
        this._liveSampleTotal = detail.total_steps ?? detail.totalSteps ?? null;
        this._liveSampleSeg = detail.segment_index ?? detail.segmentIndex ?? null;

        const src = b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
        if (this.liveSampleImg) {
            this.liveSampleImg.src = src;
            this.liveSampleImg.classList.remove("hidden");
        }
        this.liveSampleEmpty?.classList.add("hidden");
        this.liveSampleEl?.classList.toggle("receiving", !!detail.live);

        const step = this._liveSampleStep;
        const total = this._liveSampleTotal;
        const seg = this._liveSampleSeg;
        let badge = "";
        if (step && total) badge = t("batch.generatingStep", { step, total });
        else if (detail.live) badge = t("batch.generating");
        if (this.liveSampleBadge) {
            this.liveSampleBadge.textContent = badge;
            this.liveSampleBadge.classList.toggle("hidden", !badge);
        }
        if (this.liveSampleMeta) {
            const unit = this.isFl2vMode?.() ? t("unit.shot") : t("unit.segment");
            const segLabel = (seg != null && seg !== "")
                ? t("liveSample.segmentHint", { unit, n: Number(seg) + 1 })
                : "";
            this.liveSampleMeta.textContent = detail.live
                ? (segLabel || t("liveSample.sampling"))
                : (segLabel || t("liveSample.done"));
        }
    }

    setRunProgress(detail) {
        if (!this.runStatusEl) return;
        this.outputUi?.setPipelineStatus?.(detail);
        this._lastRunProgressDetail = { ...detail };
        this._lastRunErrorMessage = null;
        const timelineTotal = this.timeline?.segments?.length || 0;
        const runTotal = Math.max(detail.segment_total || this.getRunProgressSegmentTotal(), 1);
        const runSeg = Math.max(1, detail.segment || 1);
        const timelineSeg = detail.timeline_segment ?? runSeg;
        const partialRun = !!detail.partial_run
            || (this.isRunSelectEnabled?.() && runTotal < timelineTotal);
        const phaseLabel = detail.phase_label || detail.phase || t("run.phase.default");
        const overallPct = detail.overall_max > 0
            ? Math.round((100 * detail.overall_value) / detail.overall_max)
            : 0;
        const phasePct = detail.phase_max > 0
            ? Math.round((100 * detail.phase_value) / detail.phase_max)
            : 0;
        const remain = Math.max(0, runTotal - runSeg);

        if (detail.phase === "finish") {
            this.runStatusEl.className = "bd-run-status done";
            this.runTitleEl.textContent = t("run.titleDone");
            this.runDetailEl.textContent = runTotal
                ? (this.isImageBatch()
                    ? (isVideoBatchTask(this.getTaskKey())
                        ? t("run.detailDoneVideos", { n: runTotal })
                        : t("run.detailDoneImages", { n: runTotal }))
                    : (partialRun
                        ? t("run.detailDoneSegmentsPartial", { n: runTotal })
                        : t("run.detailDoneSegments", { n: runTotal })))
                : t("run.detailDoneGeneric");
            this.runOverallEl.style.width = "100%";
            this.runPhaseEl.style.width = "100%";
            this._runHighlightSeg = -1;
            this.updateRunSelectUI();
            if (this.isImageBatch()) this.renderImageBatchGroups();
            else this.scheduleRender();
            return;
        }

        this.runStatusEl.className = "bd-run-status active";
        // Hide the pre-run "将运行 N 段" chip while progress is live — it sits
        // under the title in the same green accent and reads as a layout glitch.
        this.runSelectBar?.classList.add("hidden");
        this._runHighlightSeg = timelineSeg - 1;
        let title;
        if (detail.phase === "plan") {
            title = runTotal > 1 ? t("run.titlePlanning", { n: runTotal, phase: phaseLabel }) : phaseLabel;
        } else if (this.isImageBatch()) {
            // Partial run: show timeline card number (e.g. group 4), not compact run order.
            title = partialRun
                ? t("run.titleBatchGroupPartial", {
                    timeline: timelineSeg, i: runSeg, n: runTotal, phase: phaseLabel,
                })
                : t("run.titleBatchGroup", { i: runSeg, n: runTotal, phase: phaseLabel });
        } else if (partialRun) {
            title = t("run.titleSegmentPartial", { timeline: timelineSeg, i: runSeg, n: runTotal, phase: phaseLabel });
        } else {
            title = t("run.titleSegment", { i: runSeg, n: runTotal, phase: phaseLabel });
        }
        if (phasePct > 0 && detail.phase !== "plan") {
            title += ` · ${phasePct}%`;
        }
        this.runTitleEl.textContent = title;
        const parts = [];
        if (detail.frames_label) parts.push(detail.frames_label);
        if (detail.task_key) parts.push(detail.task_key);
        const elapsedSeconds = Math.max(0, Number(detail.elapsed_seconds) || 0);
        const phaseElapsedSeconds = Math.max(0, Number(detail.phase_elapsed_seconds) || 0);
        const fmtElapsed = (seconds) => {
            if (seconds < 60) return `${seconds.toFixed(1)}s`;
            const minutes = Math.floor(seconds / 60);
            const remainSeconds = Math.floor(seconds % 60);
            return `${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
        };
        if (elapsedSeconds > 0) parts.push(`已用 ${fmtElapsed(elapsedSeconds)}`);
        if (phaseElapsedSeconds > 0) parts.push(`当前阶段 ${fmtElapsed(phaseElapsedSeconds)}`);
        parts.push(t("run.detailOverall", { pct: overallPct }));
        if (runTotal > 1) {
            parts.push(this.isImageBatch()
                ? t("run.detailRemainingGroups", { n: remain })
                : t("run.detailRemainingSegments", { n: remain }));
        }
        if (partialRun && timelineTotal > runTotal) {
            parts.push(t("run.detailTimelineTotal", { n: timelineTotal }));
        }
        this.runDetailEl.textContent = parts.join(" · ");
        this.runOverallEl.style.width = `${overallPct}%`;
        this.runPhaseEl.style.width = `${phasePct}%`;
        // Progress text can grow the status bar — resize host so the timeline
        // canvas is not flex-squashed (fl2v repeat thumbs look stretched).
        syncDirectorNodeSize(this.node, this);
        if (this.isImageBatch()) this.renderImageBatchGroups();
        else this.scheduleRender();
    }

    clearRunProgress(title, detail) {
        if (!this.runStatusEl) return;
        this._lastRunProgressDetail = null;
        this._lastRunErrorMessage = null;
        this.runStatusEl.className = "bd-run-status idle";
        this.runTitleEl.textContent = title || t("run.titleIdle");
        this.runDetailEl.textContent = detail || t("run.detailIdle");
        this.runOverallEl.style.width = "0%";
        this.runPhaseEl.style.width = "0%";
        this._runHighlightSeg = -1;
        this.updateRunSelectUI();
        if (this.isImageBatch()) this.renderImageBatchGroups();
        else this.scheduleRender();
    }

    setRunError(message) {
        if (!this.runStatusEl) return;
        this._lastRunProgressDetail = null;
        this._lastRunErrorMessage = message || "";
        this.runStatusEl.className = "bd-run-status error";
        this.runTitleEl.textContent = t("run.titleError");
        this.runDetailEl.textContent = message || t("run.detailError");
        if (this.runOverallEl) this.runOverallEl.style.width = "0%";
        if (this.runPhaseEl) this.runPhaseEl.style.width = "0%";
        this._runHighlightSeg = -1;
        this.updateRunSelectUI();
        this.scheduleRender();
    }

    _stopPlay() {
        this.isPlaying = false;
        this._playHandoff = false;
        this._nativePlayFailed = false;
        this._pauseSettling = true;
        cancelAnimationFrame(this._playRaf);
        this._playRaf = null;
        this.stageVideo?.pause();
        this.root.querySelector('[data-a="play"]').textContent = "▶";
        this._resizeObserver?.disconnect();

        const w = this._playCanvasWidth;
        this._releasePlayLayoutLock();

        if (w) this._drawTimelineCanvas(w);
        this._updateTimelineDom({ skipSeek: true });
        this._syncStagePreview(this.currentFrame, { force: true });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (+this.seekBar.value !== this.currentFrame) {
                    this.seekBar.value = this.currentFrame;
                }
                this._observeViewportResize();
                const drawW = this.viewport?.clientWidth || w;
                if (drawW) this._drawTimelineCanvas(drawW);
                this._syncStagePreview(this.currentFrame, { force: true });
                this._pauseSettling = false;
            });
        });
    }

    async _beginNativePlay() {
        const total = this.getTotalFrames();
        if (total < 1) return;
        if (this.currentFrame >= total) this.currentFrame = 0;
        await this._ensureStageReadyForFrame(this.currentFrame);
        if (!this.isPlaying) return;
        const v = this.stageVideo;
        if (!v) return;
        try {
            await v.play();
        } catch {
            // Native play blocked/failed — keep isPlaying but drive via frame clock.
            this._nativePlayFailed = true;
        }
    }

    async _advanceNativePlayToNextClipOrEnd() {
        if (this._playHandoff || !this.isPlaying) return;
        this._playHandoff = true;
        try {
            const total = this.getTotalFrames();
            const range = this._logicalRangeForClip(this._stageClipIndex);
            const next = range.end < total ? range.end : -1;
            if (next >= 0) {
                this.currentFrame = next;
                await this._beginNativePlay();
                return;
            }
            if (this.isLooping) {
                this.currentFrame = 0;
                await this._beginNativePlay();
                return;
            }
            this.currentFrame = Math.max(0, total - 1);
            this._stopPlay();
        } finally {
            this._playHandoff = false;
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this._stopPlay();
            return;
        }
        const total = this.getTotalFrames();
        if (total < 1) return;

        this.isPlaying = true;
        this._nativePlayFailed = false;
        this.root.querySelector('[data-a="play"]').textContent = "⏸";
        this._lockPlayLayout();
        this._resizeObserver?.disconnect();

        if (this.currentFrame >= total) this.currentFrame = 0;
        this.renderTimelineOnly();
        this._updateTimelineDom();

        const useNative = !this._legacyFrames.length && !!this.stageVideo;
        if (useNative) {
            this._beginNativePlay();
        } else {
            this._syncStagePreview(this.currentFrame, { force: true });
        }

        const tick = () => {
            if (!this.isPlaying) return;
            const fps = Math.max(0.001, this.getFrameRate());

            if (useNative && this.stageVideo && !this._nativePlayFailed) {
                const v = this.stageVideo;
                const clipIndex = this._stageClipIndex >= 0 ? this._stageClipIndex : 0;
                const range = this._logicalRangeForClip(clipIndex);
                const lastLogical = Math.max(range.start, range.end - 1);
                const lastTime = this.getFrameMapEntry(lastLogical).frame / fps;
                const atMappedEnd = v.currentTime >= Math.max(0, lastTime - 0.04);
                const hasTimelineEdits = !!(
                    this.getFrameMap().length
                    || deletedSourceRanges(this.timeline.video || {}).length
                );
                // With deletes, file duration still includes removed tails — trust mapped end.
                const atMediaEnd = !hasTimelineEdits && (
                    v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.04)
                );

                if ((atMappedEnd || atMediaEnd) && !v.seeking && !this._playHandoff) {
                    this.currentFrame = lastLogical;
                    this.renderTimelineOnly();
                    this._updateTimelineDom();
                    this._advanceNativePlayToNextClipOrEnd();
                    if (this.isPlaying) this._playRaf = requestAnimationFrame(tick);
                    return;
                }

                if (!v.paused) {
                    const srcFrame = Math.max(0, Math.round(v.currentTime * fps));
                    let logical = this._logicalFromStageTime(clipIndex, v.currentTime);
                    const jumpToKept = () => {
                        const nextLogical = this._nextLogicalAfterSourceFrame(clipIndex, srcFrame);
                        if (nextLogical >= 0) {
                            const nextSrc = this.getFrameMapEntry(nextLogical).frame;
                            try { v.currentTime = nextSrc / fps; } catch { /* seek race */ }
                            return nextLogical;
                        }
                        return -1;
                    };
                    // Sparse deleted gap, or mid/leading gap vs mapped source.
                    if (logical < 0) {
                        const next = jumpToKept();
                        if (next < 0) {
                            this.currentFrame = lastLogical;
                            this.renderTimelineOnly();
                            this._updateTimelineDom();
                            this._advanceNativePlayToNextClipOrEnd();
                            if (this.isPlaying) this._playRaf = requestAnimationFrame(tick);
                            return;
                        }
                        logical = next;
                    } else {
                        const mapped = this.getFrameMapEntry(logical);
                        if (mapped.clip === clipIndex && mapped.frame !== srcFrame) {
                            // leading gap (mapped > src) or mid gap (mapped < src)
                            if (mapped.frame > srcFrame || mapped.frame < srcFrame) {
                                const next = mapped.frame > srcFrame ? logical : jumpToKept();
                                if (next < 0) {
                                    this.currentFrame = clamp(logical, 0, total - 1);
                                    this.renderTimelineOnly();
                                    this._updateTimelineDom();
                                    this._advanceNativePlayToNextClipOrEnd();
                                    if (this.isPlaying) this._playRaf = requestAnimationFrame(tick);
                                    return;
                                }
                                if (mapped.frame > srcFrame) {
                                    try { v.currentTime = mapped.frame / fps; } catch { /* seek race */ }
                                }
                                logical = next;
                            }
                        }
                    }
                    this.currentFrame = clamp(logical, 0, total - 1);
                    this.renderTimelineOnly();
                    const now = performance.now();
                    if (now - this._lastSeekUiMs > 66) {
                        this._updateTimelineDom();
                        this._lastSeekUiMs = now;
                    }
                }
            } else {
                // Legacy embedded frames (or native play unavailable): step by logical frame.
                this.currentFrame += 1;
                if (this.currentFrame >= total) {
                    if (this.isLooping) this.currentFrame = 0;
                    else {
                        this.currentFrame = total - 1;
                        this._stopPlay();
                        return;
                    }
                }
                this.renderTimelineOnly();
                this._syncStagePreview(this.currentFrame, { force: true });
                const now = performance.now();
                if (now - this._lastSeekUiMs > 80) {
                    this._updateTimelineDom();
                    this._lastSeekUiMs = now;
                }
            }
            this._playRaf = requestAnimationFrame(tick);
        };
        this._playRaf = requestAnimationFrame(tick);
    }
}

function findDirectorNode(nodeId) {
    const id = String(nodeId);
    const graph = app.graph ?? app.canvas?.graph;
    for (const node of graph?._nodes ?? graph?.nodes ?? []) {
        if (String(node.id) === id) return node;
    }
    return null;
}

const EXTERNAL_GROUP_NODE_TYPES = new Set([
    "MiniMaxH3MotionDirectorGroupImageToVideo",
    "MiniMaxH3MotionDirectorGroupReferenceToVideo",
]);
const EXTERNAL_COMBINE_NODE_TYPE = "MiniMaxH3MotionDirectorGroupsCombine";

function graphLinkRecord(graph, linkId) {
    if (linkId == null || !graph) return null;
    const links = graph.links;
    if (!links) return null;
    let link = links[linkId];
    if (!link && typeof links.find === "function") {
        link = links.find((l) => l && (l.id === linkId || l[0] === linkId));
    }
    if (!link) return null;
    return {
        originId: link.origin_id ?? link[1],
        originSlot: link.origin_slot ?? link[2],
    };
}

function nodeWidgetValue(node, name) {
    const w = (node?.widgets || []).find((x) => x?.name === name);
    return w?.value;
}

/** Normalize LoadImage-style widget value → relative input path. */
function normalizeImageWidgetPath(value) {
    if (value == null || value === "") return null;
    let val = value;
    if (Array.isArray(val)) val = val[0];
    if (typeof val === "object" && val) {
        const name = String(val.filename || val.name || "").trim();
        if (!name) return null;
        const sub = String(val.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
        return sub ? `${sub}/${name}` : name;
    }
    if (typeof val === "string") {
        const s = val.replace(/\s*\[(input|output|temp)\]\s*$/i, "").trim();
        return s || null;
    }
    return null;
}

function readImageWidgetPath(node) {
    for (const name of ["image", "image_path", "filename"]) {
        const path = normalizeImageWidgetPath(nodeWidgetValue(node, name));
        if (path) return path;
    }
    return null;
}

/** VHS Load Video / Load Video Path use `video`; some loaders use video_path. */
function readVideoWidgetPath(node) {
    for (const name of ["video", "video_path", "file"]) {
        const path = normalizeImageWidgetPath(nodeWidgetValue(node, name));
        if (path) return path;
    }
    return null;
}

/** LoadAudio uses `audio`; VHS audio output often has no file — fall back to sibling video widget. */
function readAudioWidgetPath(node) {
    for (const name of ["audio", "audio_path", "file"]) {
        const path = normalizeImageWidgetPath(nodeWidgetValue(node, name));
        if (path) return path;
    }
    return readVideoWidgetPath(node);
}

function mediaBaseName(path) {
    const s = String(path || "").replace(/\\/g, "/");
    return s.split("/").pop() || s;
}

function parseViewUrlToPath(url) {
    try {
        const u = new URL(String(url || ""), window.location.origin);
        const filename = u.searchParams.get("filename");
        if (!filename) return null;
        const subfolder = (u.searchParams.get("subfolder") || "").replace(/\\/g, "/").replace(/\/$/, "");
        return subfolder ? `${subfolder}/${filename}` : filename;
    } catch {
        return null;
    }
}

function linkedSourceNode(graph, node, inputName) {
    if (!graph || !node) return null;
    const inp = (node.inputs || []).find((i) => i?.name === inputName);
    if (inp?.link == null) return null;
    const rec = graphLinkRecord(graph, inp.link);
    if (!rec) return null;
    return graph.getNodeById?.(rec.originId) || null;
}

/** Resolve an IMAGE input on `node` to a Comfy input-folder relative path. */
function resolveLinkedImageFile(graph, node, inputName, depth = 0) {
    if (!graph || !node || depth > 8) return null;
    const src = linkedSourceNode(graph, node, inputName);
    if (!src) return null;

    const direct = readImageWidgetPath(src);
    if (direct) return direct;

    const imgEl = (src.imageIndex != null ? src.imgs?.[src.imageIndex] : null) || src.imgs?.[0];
    const fromPreview = parseViewUrlToPath(imgEl?.src);
    if (fromPreview) return fromPreview;

    // Walk through IMAGE passthrough nodes (Resize, etc.).
    const imgInputs = (src.inputs || []).filter((i) => String(i?.type || "") === "IMAGE" && i.link != null);
    for (const next of imgInputs) {
        const path = resolveLinkedImageFile(graph, src, next.name, depth + 1);
        if (path) return path;
    }
    return null;
}

/**
 * Resolve ref_video IMAGE-batch wiring to a previewable file path.
 * VHS Load Video exposes frames on IMAGE but the path lives on the `video` widget.
 */
function resolveLinkedVideoFile(graph, node, inputName, depth = 0) {
    if (!graph || !node || depth > 8) return null;
    const src = linkedSourceNode(graph, node, inputName);
    if (!src) return null;

    const direct = readVideoWidgetPath(src);
    if (direct) return direct;

    // Some loaders still put the clip name on filename / image widgets.
    const fallback = readImageWidgetPath(src);
    if (fallback && /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(fallback)) return fallback;

    const walkTypes = new Set(["IMAGE", "VIDEO"]);
    const nextInputs = (src.inputs || []).filter(
        (i) => walkTypes.has(String(i?.type || "").toUpperCase()) && i.link != null,
    );
    for (const next of nextInputs) {
        const path = resolveLinkedVideoFile(graph, src, next.name, depth + 1);
        if (path) return path;
    }
    return null;
}

/** Resolve AUDIO wiring (LoadAudio / VHS audio out) to a previewable path. */
function resolveLinkedAudioFile(graph, node, inputName, depth = 0) {
    if (!graph || !node || depth > 8) return null;
    const src = linkedSourceNode(graph, node, inputName);
    if (!src) return null;

    const direct = readAudioWidgetPath(src);
    if (direct) return direct;

    const nextInputs = (src.inputs || []).filter(
        (i) => String(i?.type || "").toUpperCase() === "AUDIO" && i.link != null,
    );
    for (const next of nextInputs) {
        const path = resolveLinkedAudioFile(graph, src, next.name, depth + 1);
        if (path) return path;
    }
    return null;
}

function imageRefFromPath(path) {
    if (!path) return null;
    return { imageFile: path, width: 0, height: 0 };
}

function videoRefFromPath(path, index) {
    if (!path) return null;
    return {
        index,
        videoFile: path,
        fileName: mediaBaseName(path),
        type: "input",
        subfolder: "",
        pairedAudioFile: "",
        previewImageFile: "",
        previewImageUrl: "",
        linked: true,
    };
}

/** First-frame poster from Load Video / IMAGE-batch upstream (when file path missing). */
function resolveLinkedVideoPoster(graph, node, inputName, depth = 0) {
    if (!graph || !node || depth > 8) return null;
    const src = linkedSourceNode(graph, node, inputName);
    if (!src) return null;
    const imgEl = (src.imageIndex != null ? src.imgs?.[src.imageIndex] : null) || src.imgs?.[0];
    if (imgEl?.src) {
        return {
            previewImageUrl: imgEl.src,
            previewImageFile: parseViewUrlToPath(imgEl.src) || "",
        };
    }
    const nextInputs = (src.inputs || []).filter(
        (i) => String(i?.type || "").toUpperCase() === "IMAGE" && i.link != null,
    );
    for (const next of nextInputs) {
        const poster = resolveLinkedVideoPoster(graph, src, next.name, depth + 1);
        if (poster) return poster;
    }
    return null;
}

function collectAutogrowVideoRefs(graph, node) {
    const found = new Map();
    const re = /(?:^|\.)ref_video_(\d+)$/;
    for (const inp of node.inputs || []) {
        const m = String(inp?.name || "").match(re);
        if (!m || inp.link == null) continue;
        const idx = parseInt(m[1], 10);
        if (!Number.isFinite(idx) || found.has(idx)) continue;
        patchUpstreamVideoWidgetSync(graph, node, inp.name);
        const path = resolveLinkedVideoFile(graph, node, inp.name);
        const poster = resolveLinkedVideoPoster(graph, node, inp.name);
        if (path) {
            const ref = videoRefFromPath(path, idx);
            if (poster) {
                ref.previewImageFile = poster.previewImageFile || "";
                ref.previewImageUrl = poster.previewImageUrl || "";
            }
            found.set(idx, ref);
        } else if (poster?.previewImageUrl || poster?.previewImageFile) {
            found.set(idx, {
                index: idx,
                videoFile: "",
                fileName: poster.previewImageFile
                    ? mediaBaseName(poster.previewImageFile)
                    : `video_${idx + 1}`,
                type: "input",
                subfolder: "",
                pairedAudioFile: "",
                previewImageFile: poster.previewImageFile || "",
                previewImageUrl: poster.previewImageUrl || "",
                linked: true,
            });
        } else {
            // Linked IMAGE batch without resolvable path/poster — still mark occupied.
            found.set(idx, {
                index: idx,
                videoFile: "",
                fileName: "",
                type: "input",
                subfolder: "",
                pairedAudioFile: "",
                previewImageFile: "",
                previewImageUrl: "",
                linked: true,
            });
        }
    }
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function audioRefFromPath(path, index) {
    if (!path) return null;
    return {
        index,
        audioFile: path,
        fileName: mediaBaseName(path),
        type: "input",
        subfolder: "",
    };
}

function patchUpstreamWidgetSync(graph, node, inputName, widgetNames) {
    if (!graph || !node || !widgetNames?.length) return;
    const src = linkedSourceNode(graph, node, inputName);
    if (!src?.widgets) return;
    const names = new Set(widgetNames);
    for (const w of src.widgets) {
        if (!w || !names.has(w.name)) continue;
        if (w._mmxExternalMediaSyncPatched) continue;
        w._mmxExternalMediaSyncPatched = true;
        const prev = w.callback;
        w.callback = function (...cbArgs) {
            const r = prev?.apply(this, cbArgs);
            queueMicrotask(() => notifyDirectorsSyncExternalGroups());
            return r;
        };
    }
}

function patchUpstreamImageWidgetSync(graph, node, inputName) {
    patchUpstreamWidgetSync(graph, node, inputName, ["image", "image_path", "filename"]);
}

function patchUpstreamVideoWidgetSync(graph, node, inputName) {
    patchUpstreamWidgetSync(graph, node, inputName, ["video", "video_path", "file", "filename"]);
}

function patchUpstreamAudioWidgetSync(graph, node, inputName) {
    patchUpstreamWidgetSync(graph, node, inputName, ["audio", "audio_path", "video", "video_path", "file", "filename"]);
}

/** Collect Autogrow / legacy slots matching `(?:^|\.)prefix_(\\d+)$`. */
function collectAutogrowSlotRefs(graph, node, prefix, resolvePath, toRef, patchSync) {
    const found = new Map();
    const re = new RegExp(`(?:^|\\.)${prefix}_(\\d+)$`);
    for (const inp of node.inputs || []) {
        const m = String(inp?.name || "").match(re);
        if (!m || inp.link == null) continue;
        const idx = parseInt(m[1], 10);
        if (!Number.isFinite(idx) || found.has(idx)) continue;
        patchSync?.(graph, node, inp.name);
        const path = resolvePath(graph, node, inp.name);
        const ref = path ? toRef(path, idx) : null;
        if (ref) found.set(idx, ref);
    }
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function readExternalGroupSpec(node, graph = null) {
    const g = graph || app.graph || app.canvas?.graph;
    const durRaw = Number(nodeWidgetValue(node, "duration_sec"));
    const prompt = String(nodeWidgetValue(node, "prompt") ?? "");
    const cls = node?.comfyClass || node?.type || "";
    const firstImageFile = resolveLinkedImageFile(g, node, "first_frame");
    const lastImageFile = resolveLinkedImageFile(g, node, "last_frame");
    patchUpstreamImageWidgetSync(g, node, "first_frame");
    patchUpstreamImageWidgetSync(g, node, "last_frame");

    let refImages = [];
    let refVideos = [];
    let refAudios = [];
    if (cls === "MiniMaxH3MotionDirectorGroupReferenceToVideo") {
        // Autogrow: ref_images.ref_image_0 / ref_videos.ref_video_0 / …
        refImages = collectAutogrowSlotRefs(
            g, node, "ref_image", resolveLinkedImageFile,
            (path, idx) => ({ index: idx, imageFile: path, imageB64: "" }),
            patchUpstreamImageWidgetSync,
        );
        refVideos = collectAutogrowVideoRefs(g, node);
        const standaloneAudios = collectAutogrowSlotRefs(
            g, node, "ref_audio", resolveLinkedAudioFile,
            audioRefFromPath,
            patchUpstreamAudioWidgetSync,
        );
        // Paired soundtrack for the same-index reference video (ref_video_audio_N).
        const pairedAudios = collectAutogrowSlotRefs(
            g, node, "ref_video_audio", resolveLinkedAudioFile,
            audioRefFromPath,
            patchUpstreamAudioWidgetSync,
        );
        const pairedByIndex = new Map(pairedAudios.map((a) => [a.index, a]));
        for (const vid of refVideos) {
            const paired = pairedByIndex.get(vid.index);
            if (paired?.audioFile) {
                vid.pairedAudioFile = paired.audioFile;
                pairedByIndex.delete(vid.index);
            }
        }
        // Show unpaired video-audio (or standalone) in the 参考音频 strip.
        const audioMap = new Map(standaloneAudios.map((a) => [a.index, a]));
        for (const [idx, paired] of pairedByIndex) {
            if (!audioMap.has(idx)) audioMap.set(idx, paired);
        }
        refAudios = [...audioMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    }

    return {
        durationSec: Number.isFinite(durRaw) && durRaw > 0 ? durRaw : null,
        prompt,
        firstImageFile,
        lastImageFile,
        refImages,
        refVideos,
        refAudios,
    };
}

/** Autogrow slots are named `groups.group_0`; legacy used `group_0` / `group_01`. */
function combineGroupSlotIndex(name) {
    const m = String(name || "").match(/(?:^|\.)group_(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
}

function isCombineGroupSlot(input) {
    if (!input) return false;
    if (combineGroupSlotIndex(input.name) != null) return true;
    // Fallback: any MMX_MOTION_DIR_GROUP input on the combine node.
    return String(input.type || "") === "MMX_MOTION_DIR_GROUP";
}

function expandExternalGroupLink(graph, linkId, depth = 0) {
    if (linkId == null || depth > 16) return [];
    const terminal = resolveExternalGroupTerminal(graph, linkId, 16 - depth);
    if (!terminal) return [];
    const node = terminal.node;
    const cls = node.comfyClass || node.type || "";
    if (cls === EXTERNAL_COMBINE_NODE_TYPE) {
        const out = [];
        const slots = (node.inputs || [])
            .filter(isCombineGroupSlot)
            .sort((a, b) => {
                const ai = combineGroupSlotIndex(a.name);
                const bi = combineGroupSlotIndex(b.name);
                if (ai != null && bi != null) return ai - bi;
                return 0;
            });
        for (const input of slots) {
            if (input.link == null) continue;
            out.push(...expandExternalGroupLink(graph, input.link, depth + 1));
        }
        return out;
    }
    if (EXTERNAL_GROUP_NODE_TYPES.has(cls)) {
        return [readExternalGroupSpec(node, graph)];
    }
    // Unknown upstream packer — still reserve one slot for run-select/timeline.
    return [{
        durationSec: null,
        prompt: "",
        firstImageFile: null,
        lastImageFile: null,
        refImages: [],
        refVideos: [],
        refAudios: [],
    }];
}

function collectExternalGroupSpecs(editor) {
    const port = editor?.hasExternalI2vGroups?.()
        ? "i2v_groups"
        : editor?.hasExternalR2vGroups?.()
            ? "r2v_groups"
            : null;
    if (!port) return null;
    const graph = app.graph ?? app.canvas?.graph;
    const inp = editor?.node?.inputs?.find((i) => i?.name === port);
    if (!graph || inp?.link == null) return null;
    const specs = expandExternalGroupLink(graph, inp.link);
    return specs.length ? specs : null;
}

function notifyDirectorsSyncExternalGroups() {
    const graph = app.graph ?? app.canvas?.graph;
    for (const node of graph?._nodes ?? graph?.nodes ?? []) {
        if (!isMiniMaxH3MotionDirectorNode(node)) continue;
        node._minimaxEditor?.syncExternalGroupsTimeline?.();
    }
}

function clearAllDirectorRunStatus() {
    const graph = app.graph ?? app.canvas?.graph;
    for (const node of graph?._nodes ?? graph?.nodes ?? []) {
        node._minimaxEditor?.clearRunProgress?.();
    }
}

/** Old workflows may still list removed output slots (e.g. segment_images). */
function isMiniMaxH3MotionDirectorNode(node) {
    const cls = node?.comfyClass || node?.type || "";
    return cls === "MiniMaxH3MotionDirector" || cls === "ComfyMiniMaxH3MotionDirector";
}

function isDirectorNodeDef(nodeType, nodeData) {
    const cls = nodeType?.comfyClass || nodeData?.name || "";
    return cls === "MiniMaxH3MotionDirector" || cls === "ComfyMiniMaxH3MotionDirector";
}

function stripDeprecatedDirectorOutputs(node) {
    if (!isMiniMaxH3MotionDirectorNode(node) || !node.outputs?.length) return;
    const stale = new Set(["segment_images"]);
    for (let i = node.outputs.length - 1; i >= 0; i--) {
        if (stale.has(node.outputs[i]?.name)) {
            node.removeOutput(i);
        }
    }
}

/** Reorder legacy output links after slot layout changes. */
function migrateDirectorOutputLinks(node) {
    if (!isMiniMaxH3MotionDirectorNode(node)) return;
    const graph = app.graph ?? app.canvas?.graph;
    const links = graph?.links;
    if (!links?.length) return;
    const outputs = node.outputs || [];
    const byName = Object.fromEntries(
        outputs.map((o, i) => [o?.name, i]).filter(([n]) => !!n)
    );

    for (const link of links) {
        if (!link || String(link.origin_id) !== String(node.id)) continue;
        const target = graph.getNodeById?.(link.target_id);
        const input = target?.inputs?.[link.target_slot];
        const inputType = (input?.type || "").toUpperCase();

        // Old layouts had report at slot 1 or 3 as STRING.
        if (inputType === "STRING" && byName.report != null && link.origin_slot !== byName.report) {
            link.origin_slot = byName.report;
            continue;
        }
        // Old layouts had fps last (slot 5) as FLOAT.
        if (inputType === "FLOAT" && byName.fps != null && link.origin_slot !== byName.fps) {
            link.origin_slot = byName.fps;
            continue;
        }
        // Old layouts had frame_count at slot 2 as INT.
        if (inputType === "INT" && byName.frame_count != null && link.origin_slot !== byName.frame_count) {
            link.origin_slot = byName.frame_count;
        }
    }
}

function normalizeDirectorOutputs(node) {
    stripDeprecatedDirectorOutputs(node);
    migrateDirectorOutputLinks(node);
}

if (!globalThis.__MMX_MOTION_DIRECTOR_EXTENSION_REGISTERED__) {
app.registerExtension({
    name: "ComfyUI.MiniMaxH3MotionDirectorPlugin",
    async beforeConfigureGraph(graphData) {
        migrateLegacySamplingControlWorkflow(graphData);
        repairDirectorGroupWidgetWorkflow(graphData);
    },
    async setup() {
        const flushDirectors = () => {
            const graph = app.graph ?? app.canvas?.graph;
            for (const node of graph?._nodes ?? graph?.nodes ?? []) {
                const editor = node._minimaxEditor;
                if (!editor) continue;
                editor.ensureRunSelectionSerialized?.();
            }
        };
        if (app.queuePrompt && !app.queuePrompt._minimaxPatched) {
            const orig = app.queuePrompt.bind(app);
            app.queuePrompt = function (...args) {
                flushDirectors();
                clearAllDirectorRunStatus();
                return orig(...args);
            };
            app.queuePrompt._minimaxPatched = true;
        }

        api.addEventListener("minimax_motion_director_progress", ({ detail }) => {
            findDirectorNode(detail?.node_id)?._minimaxEditor?.setRunProgress?.(detail);
        });

        api.addEventListener("minimax_motion_director_preview", ({ detail }) => {
            const editor = findDirectorNode(detail?.node_id)?._minimaxEditor;
            if (!editor) return;
            editor.outputUi?.consumePreview?.(detail);
        });

        api.addEventListener("minimax_motion_director_report", ({ detail }) => {
            findDirectorNode(detail?.node_id)?._minimaxEditor?.outputUi?.setReport?.(detail?.report || "");
        });

        api.addEventListener("minimax_motion_director_audio", ({ detail }) => {
            findDirectorNode(detail?.node_id)?._minimaxEditor?.outputUi?.setAudio?.(detail);
        });

        api.addEventListener("minimax_motion_director_final_ready", ({ detail }) => {
            findDirectorNode(detail?.node_id)?._minimaxEditor?.outputUi?.setFinalRecord?.(detail);
        });

        api.addEventListener("executing", ({ detail }) => {
            if (detail == null) return;
            const node = findDirectorNode(detail);
            const editor = node?._minimaxEditor;
            if (!editor) return;
            editor.flushTimelineSync?.();
            editor.outputUi?.clear?.();
            const segTotal = editor.getRunProgressSegmentTotal?.() ?? (editor.timeline?.segments?.length || 1);
            const timelineTotal = editor.timeline?.segments?.length || segTotal;
            editor.setRunProgress({
                node_id: detail,
                segment: 1,
                segment_total: segTotal,
                timeline_segment: 1,
                timeline_segment_total: timelineTotal,
                partial_run: editor.isRunSelectEnabled?.() && segTotal < timelineTotal,
                phase: "plan",
                phase_label: t("executing.parseTimeline"),
                phase_value: 0,
                phase_max: 1,
                overall_value: 0,
                overall_max: Math.max(1, segTotal * 6),
                remaining_segments: Math.max(0, segTotal - 1),
            });
        });

        api.addEventListener("execution_error", ({ detail }) => {
            const node = findDirectorNode(detail?.node_id);
            if (node?._minimaxEditor) {
                node._minimaxEditor.setRunError(detail?.exception_message || t("executing.error"));
            }
        });

        patchDirectorDomWidgetLayout();
        setTimeout(patchDirectorDomWidgetLayout, 500);
    },
    async loadedGraphNode(node) {
        if (!isMiniMaxH3MotionDirectorNode(node)) return;
        normalizeDirectorOutputs(node);
        if (!node._minimaxDomWidget) return;
        finalizeDirectorWidgetOrder(node);
        ensureDirectorDomWidgetWidth(node);
        bindDirectorDomWidgetSizing(node, node._minimaxDomWidget);
        initDirectorEditor(node);
        refreshSamplingModeUi(node);
        node._minimaxEditor?.scheduleRender?.();
    },
    async getCustomWidgets() {
        return {
            BDGROUP(node, inputName, inputData) {
                const w = makeGroupHeaderWidget(inputName, inputData);
                if (!node.widgets) node.widgets = [];
                node.widgets.push(w);
                return w;
            },
        };
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const cls = nodeType?.comfyClass || nodeData?.name || "";
        if (EXTERNAL_GROUP_NODE_TYPES.has(cls) || cls === EXTERNAL_COMBINE_NODE_TYPE) {
            const onConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (...args) {
                const out = onConnectionsChange?.apply(this, args);
                // Combine/Group wiring changes do not fire Director.onConnectionsChange.
                queueMicrotask(() => notifyDirectorsSyncExternalGroups());
                return out;
            };
            const onCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const out = onCreated?.apply(this, arguments);
                // Keep Director timeline in sync when duration/prompt widgets change.
                queueMicrotask(() => {
                    for (const w of this.widgets || []) {
                        if (w?.name !== "duration_sec" && w?.name !== "prompt") continue;
                        if (w._mmxExternalSyncPatched) continue;
                        w._mmxExternalSyncPatched = true;
                        const prev = w.callback;
                        w.callback = function (...cbArgs) {
                            const r = prev?.apply(this, cbArgs);
                            notifyDirectorsSyncExternalGroups();
                            return r;
                        };
                    }
                });
                return out;
            };
            return;
        }

        if (!isDirectorNodeDef(nodeType, nodeData)) return;

        // Current Vue-node tooltips are built from the registered node definition.
        // Replace backend-length help before ComfyUI copies that definition into its store.
        applyDirectorNodeDataTooltips(nodeData);

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated?.apply(this, arguments);
            normalizeDirectorOutputs(this);
            applyDirectorWidgetLabels(this);
            // ComfyUI may attach seed's control_after_generate combo after onNodeCreated.
            queueMicrotask(() => applyDirectorWidgetLabels(this));
            setTimeout(() => applyDirectorWidgetLabels(this), 0);
            this.size = [620, 420];

            // Idempotent: avoid a second DOM stack if onNodeCreated is wrapped twice.
            if (this._minimaxDomWidget?.element) {
                setTimeout(() => {
                    finalizeDirectorWidgetOrder(this);
                    initDirectorEditor(this);
                }, 0);
                return r;
            }

            const container = document.createElement("div");
            container.className = "mmx-host";
            container.style.height = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
            container.style.minHeight = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
            container.style.maxHeight = `${DIRECTOR_LAUNCHER_HEIGHT}px`;
            const self = this;
            const widget = this.addDOMWidget("minimax_motion_director_ui", "director", container, {
                getValue: () => "",
                setValue: () => {},
                getMinHeight: () => DIRECTOR_LAUNCHER_HEIGHT,
                hideOnZoom: false,
                onDraw() {
                    if (self._minimaxEditor?.isPlaying) return;
                    ensureDirectorDomWidgetWidth(self);
                },
                afterResize: () => {
                    if (self._minimaxEditor?.isPlaying || self._minimaxEditor?._pauseSettling) return;
                    ensureDirectorDomWidgetWidth(self);
                    self._minimaxEditor?.onNodeResize?.();
                },
            });
            bindDirectorDomWidgetSizing(self, widget);
            widget.element = container;
            ensureDirectorDomWidgetWidth(self);
            self._minimaxDomWidget = widget;

            setTimeout(() => {
                finalizeDirectorWidgetOrder(self);
                initDirectorEditor(self);
            }, 0);
            return r;
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            ensureDirectorDomWidgetWidth(this);
            const out = onResize?.apply(this, arguments);
            if (!this._minimaxEditor?.isPlaying && !this._minimaxEditor?._pauseSettling) {
                this._minimaxEditor?.onNodeResize?.(size);
            }
            return out;
        };

        const onSelected = nodeType.prototype.onSelected;
        nodeType.prototype.onSelected = function () {
            ensureDirectorDomWidgetWidth(this);
            const out = onSelected?.apply(this, arguments);
            // Reselect often lands after graph zoom/layout changes — settle redraw
            // fixes thumbs that were stretched from a mismatched canvas CSS box.
            this._minimaxEditor?.scheduleSettleRender?.();
            this._minimaxEditor?.syncExternalGroupsTimeline?.();
            return out;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (...args) {
            const out = onConnectionsChange?.apply(this, args);
            this._minimaxEditor?.syncExternalGroupsTimeline?.();
            refreshSamplingModeUi(this);
            queueMicrotask(() => refreshSamplingModeUi(this));
            return out;
        };

        const onDeselected = nodeType.prototype.onDeselected;
        nodeType.prototype.onDeselected = function () {
            const out = onDeselected?.apply(this, arguments);
            if (this._minimaxEditor?.isPlaying) this._minimaxEditor._stopPlay();
            return out;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._minimaxEditor?.destroy();
            this._minimaxEditor = null;
            return onRemoved?.apply(this, arguments);
        };

        const onSerialize = nodeType.prototype.onSerialize;

        nodeType.prototype.onSerialize = function (serializedNode) {
            onSerialize?.apply(this, arguments);

            serializedNode.properties =
                serializedNode.properties || {};

            serializedNode.properties.mmx_director_widget_state =
                captureDirectorWidgetState(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            // LiteGraph applies widgets_values by widget order.  Transient
            // visual facades must never exist while native deserialization runs.
            detachDirectorTransientWidgets(this);

            migrateLegacySamplingControlNode(
                arguments[0],
            );

            migrateColorReanchorWidgetValues(
                arguments[0],
                this.widgets || [],
            );

            migrateReorderedDirectorTail(
                arguments[0],
                this.widgets || [],
            );

            normalizeDirectorOutputs(this);
            this._mmxContinuityConfiguring = true;

            let out;

            try {
                out = onConfigure?.apply(
                    this,
                    arguments,
                );

                restoreDirectorWidgetState(
                    this,
                    arguments[0],
                );
            } finally {
                this._mmxContinuityConfiguring = false;

                repairInvalidDirectorSamplingState(
                    this,
                );

                for (const widget of this.widgets || []) {
                    if (widget?._mmxContinuityDisabled) {
                        widget._mmxContinuityStoredValue =
                            widget.value;
                    }
                }
            }
            setTimeout(() => {
                finalizeDirectorWidgetOrder(this);
                this._mmxPostprocessStore?.reload?.();
                applyDirectorWidgetLabels(this);
                const ed = initDirectorEditor(this) || this._minimaxEditor;
                if (!ed) return;
                const initTotal = Math.max(0, parseInt(ed.totalFramesWidget?.value || 124, 10));
                const initFps = coerceTimelineFps(ed.frameRateWidget?.value || 24);
                ed.timeline = ed._loadNativeTimelineState(ed.timelineWidget?.value, initTotal, initFps);
                ed.ensureContextLinks();
                ed.syncFrameRateUI(ed.timeline.frameRate);
                ed._directorMode = ed.getDirectorMode();
                if (ed._directorMode === "mixed") {
                    // Mixed owns editor.mixedTimeline; legacy normalizers intentionally do nothing here.
                } else if (ed._directorMode === "video") {
                    ed.restoreVideoFromTimeline();
                } else if (ed._directorMode === "prompt_batch" || ed._directorMode === "image_batch") {
                    ensureImageBatchTimeline(ed);
                } else {
                    ed.ensureGenTimeline();
                }
                ed.ensureContextLinks();
                ed.applyTaskLayout(ed._directorMode);
                ed.populateTaskSelect(ed.globalTask, ed.taskTypeWidget?.value);
                ed.setEditMode(ed.timeline.editMode || "global");
                ed.selectedIndex = 0;
                ed.updateSelectionUI();
                ed.commit(true, { syncTimeline: false });
                ed._externalGroupsSyncSig = null;
                ed.syncExternalGroupsTimeline?.();
                ed.scheduleSettleRender?.();
            }, 80);
            return out;
        };
    },
});
globalThis.__MMX_MOTION_DIRECTOR_EXTENSION_REGISTERED__ = true;
}
