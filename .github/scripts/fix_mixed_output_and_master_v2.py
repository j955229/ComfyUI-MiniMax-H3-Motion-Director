from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def replace_func(text, start_marker, end_marker, new_func, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    return text[:start] + new_func + text[end:]


# Backend: Mixed boundary links are requests; node masters remain explicit.
path = 'nodes/director.py'
text = read(path)
old = '''        if bool(getattr(plan, "mixed_mode", False)):\n            bind_mixed_runtime_node(plan, unique_id)\n            source_overlap_frames = 0\n            # Mixed per-boundary toggles are authoritative. The legacy node-level\n            # masters are hidden in Mixed mode and must never silently gate a link.\n            links = [getattr(segment, "context_link", None) for segment in plan.segments]\n            motion_context_enabled = any(\n                bool(link and link.visual_enabled) for link in links\n            )\n            audio_context_enabled = any(\n                bool(link and link.audio_enabled) for link in links\n            )\n'''
new = '''        if bool(getattr(plan, "mixed_mode", False)):\n            bind_mixed_runtime_node(plan, unique_id)\n            source_overlap_frames = 0\n            # Mixed boundary toggles are per-link requests. The visible node-level\n            # Motion/Audio Context switches remain the user-controlled global masters;\n            # executor_core combines master AND ContextLink for the actual handoff.\n'''
text = replace_once(text, old, new, 'director Mixed master block')
write(path, text)


# Continuity facade: show Motion/Audio masters in Mixed and gate global tuning by MC master.
path = 'web/js/minimax_continuity_ui.mjs'
text = read(path)
text = replace_once(text,
'''    const generatedMotionUi = mode === "motion_context_task";\n    const videoMotionUi = mode === "video_strategy"\n        && videoStrategy === VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT;\n    const motionActive = (generatedMotionUi && motionOn) || videoMotionUi;\n''',
'''    const generatedMotionUi = mode === "motion_context_task";\n    const mixedMotionUi = mode === "mixed";\n    const videoMotionUi = mode === "video_strategy"\n        && videoStrategy === VIDEO_CONTINUITY_STRATEGIES.MOTION_CONTEXT;\n    const motionActive = mixedMotionUi\n        ? (multiSegment && motionOn)\n        : ((generatedMotionUi && motionOn) || videoMotionUi);\n''', 'continuity mixed motion state')
text = replace_once(text,
'    const showAudioContinuation = multiSegment && supportedVisualTask;\n',
'    const showAudioContinuation = multiSegment && (supportedVisualTask || mixedTask);\n', 'continuity mixed audio visibility')
text = replace_once(text,
'        showMotionContext: generatedMotionUi,\n',
'        showMotionContext: generatedMotionUi || mixedMotionUi,\n', 'continuity show mixed motion master')
text = replace_once(text,
'''        motionContextControlEnabled: generatedMotionUi,\n        contextFramesControlEnabled: mixedTask ? multiSegment : motionActive,\n''',
'''        motionContextControlEnabled: generatedMotionUi || mixedMotionUi,\n        contextFramesControlEnabled: mixedTask ? (multiSegment && motionOn) : motionActive,\n''', 'continuity mixed motion enabled')
text = replace_once(text,
'        colorReanchorControlEnabled: mixedTask ? multiSegment : (showColorReanchor && motionActive),\n',
'''        colorReanchorControlEnabled: mixedTask\n            ? (multiSegment && motionOn)\n            : (showColorReanchor && motionActive),\n''', 'continuity mixed color gate')
text = replace_once(text,
'''        pinRenormControlEnabled: mixedTask\n            ? multiSegment\n            : (multiSegment && supportedVisualTask && motionActive),\n''',
'''        pinRenormControlEnabled: mixedTask\n            ? (multiSegment && motionOn)\n            : (multiSegment && supportedVisualTask && motionActive),\n''', 'continuity mixed pin gate')
write(path, text)


path = 'web/js/minimax_timeline.js'
text = read(path)
text = replace_once(text,
'from "./minimax_continuity_ui.mjs?boot=director_ui_v4";',
'from "./minimax_continuity_ui.mjs?boot=director_ui_v5";',
'continuity boot key')

# Output visibility function: Mixed uses ResolutionSelector, not source-video size mode.
new_update_mode = '''    updateOutputModeUI() {\n        const taskKey = this.getTaskKey();\n        const mixedMode = this.isMixedMode();\n        const useSelector = mixedMode || this.isImageBatch() || this.isGenMode() || this.isFl2vMode()\n            || NO_VIDEO_UPLOAD_TASKS.has(taskKey);\n        // Gen / batch / fl2v / Mixed: aspect + megapixels, or Custom width/height.\n        // Standalone source-video edit (v2v/rv2v): long_edge / fixed.\n        if (this.outAspect) this.outAspect.classList.toggle("hidden", !useSelector);\n        if (this.outMode) this.outMode.classList.toggle("hidden", useSelector);\n        if (this.outLongWrap) this.outLongWrap.style.display = "";\n        if (useSelector) {\n            const activeOutput = mixedMode\n                ? (this._ensureMixedTimeline().output || {})\n                : (this.timeline.output || {});\n            const custom = isCustomAspectRatio(activeOutput.aspectRatio ?? this.outAspect?.value);\n            if (this.outMpWrap) this.outMpWrap.classList.toggle("hidden", custom);\n            if (this.outLongWrap) this.outLongWrap.classList.add("hidden");\n            if (this.outFixedWrap) this.outFixedWrap.classList.toggle("hidden", !custom);\n            // Mixed has its own state object; never mutate standalone timeline.output here.\n            if (!mixedMode) {\n                if (custom) this.applyCustomResolution();\n                else this.applyResolutionSelector();\n            }\n            return;\n        }\n        if (this.outMpWrap) this.outMpWrap.classList.add("hidden");\n        const mode = this.timeline.output?.mode || "long_edge";\n        const isFixed = mode === "fixed";\n        if (this.outLongWrap) this.outLongWrap.classList.toggle("hidden", isFixed);\n        if (this.outFixedWrap) this.outFixedWrap.classList.toggle("hidden", !isFixed);\n    }\n\n'''
text = replace_func(text, '    updateOutputModeUI() {\n', '    updateOutputPreview() {\n', new_update_mode, 'updateOutputModeUI')

# Modify only updateOutputPreview(), not the similar syncOutputToWidgets() branch.
preview_start = text.find('    updateOutputPreview() {\n')
preview_end = text.find('    _exportPreviewSuffix() {\n', preview_start)
if preview_start < 0 or preview_end < 0:
    raise SystemExit('updateOutputPreview boundaries not found')
preview = text[preview_start:preview_end]
preview = replace_once(preview,
'''        if (this.isGenBlank() || this.isImageBatch() || this.isFl2vMode()) {\n            const out = this.timeline.output || {};\n''',
'''        if (this.isGenBlank() || this.isImageBatch() || this.isFl2vMode() || this.isMixedMode()) {\n            const out = this.isMixedMode()\n                ? (this._ensureMixedTimeline().output || {})\n                : (this.timeline.output || {});\n''', 'Mixed output preview selector branch')
text = text[:preview_start] + preview + text[preview_end:]

# Export suffix reads Mixed export settings when in Mixed mode.
export_start = text.find('    _exportPreviewSuffix() {\n')
export_end = text.find('    onOutputField(key, value) {\n', export_start)
if export_start < 0 or export_end < 0:
    raise SystemExit('export suffix boundaries not found')
export_body = text[export_start:export_end]
export_body = replace_once(export_body,
'''        const exportMode = this.timeline.output?.exportMode === "segments"\n            ? t("output.preview.segmentExport")\n            : "";\n''',
'''        const activeOutput = this.isMixedMode()\n            ? this._ensureMixedTimeline().output\n            : this.timeline.output;\n        const exportMode = activeOutput?.exportMode === "segments"\n            ? t("output.preview.segmentExport")\n            : "";\n''', 'Mixed export preview suffix')
text = text[:export_start] + export_body + text[export_end:]

# Replace only the initial Mixed branch of onOutputField().
on_start = text.find('    onOutputField(key, value) {\n')
on_end = text.find('        this.timeline.output = this.timeline.output || {\n', on_start)
if on_start < 0 or on_end < 0:
    raise SystemExit('onOutputField Mixed branch boundaries not found')
on_prefix = text[on_start:on_end]
new_on_prefix = '''    onOutputField(key, value) {\n        if (this.isMixedMode()) {\n            const state = this._ensureMixedTimeline();\n            state.output = state.output || {};\n            const out = state.output;\n            out.mode = "fixed";\n            out.multiple = out.multiple ?? MINIMAX_CANVAS_MULTIPLE;\n\n            const applySelector = () => {\n                if (isCustomAspectRatio(out.aspectRatio)) return;\n                out.aspectRatio = normalizeAspectRatioLabel(out.aspectRatio || DEFAULT_ASPECT_RATIO);\n                out.megapixels = clampMegapixels(out.megapixels ?? DEFAULT_MEGAPIXELS);\n                const resolved = resolutionFromSelector(\n                    out.aspectRatio,\n                    out.megapixels,\n                    out.multiple,\n                );\n                if (!resolved) return;\n                out.aspectRatio = resolved.aspectRatio;\n                out.megapixels = resolved.megapixels;\n                out.multiple = resolved.multiple;\n                out.width = resolved.width;\n                out.height = resolved.height;\n                out.longEdge = Math.max(resolved.width, resolved.height);\n            };\n\n            if (key === "aspectRatio") {\n                if (isCustomAspectRatio(value)) {\n                    out.aspectRatio = CUSTOM_ASPECT_RATIO;\n                    out.width = snapResolutionDim(out.width ?? 864, out.multiple);\n                    out.height = snapResolutionDim(out.height ?? 480, out.multiple);\n                    out.longEdge = Math.max(out.width, out.height);\n                } else {\n                    out.aspectRatio = normalizeAspectRatioLabel(value || DEFAULT_ASPECT_RATIO);\n                    applySelector();\n                }\n            } else if (key === "megapixels") {\n                out.megapixels = clampMegapixels(value);\n                applySelector();\n            } else if (key === "width") {\n                out.aspectRatio = CUSTOM_ASPECT_RATIO;\n                out.width = snapResolutionDim(value || 864, out.multiple);\n                out.height = snapResolutionDim(out.height ?? 480, out.multiple);\n                out.longEdge = Math.max(out.width, out.height);\n            } else if (key === "height") {\n                out.aspectRatio = CUSTOM_ASPECT_RATIO;\n                out.width = snapResolutionDim(out.width ?? 864, out.multiple);\n                out.height = snapResolutionDim(value || 480, out.multiple);\n                out.longEdge = Math.max(out.width, out.height);\n            } else if (key === "maxExportFrames") {\n                const n = Number.parseInt(value, 10);\n                out.maxExportFrames = Number.isFinite(n) && n > 0 ? n : 0;\n            } else if (key === "exportMode") {\n                out.exportMode = value === "segments" ? "segments" : "all";\n            } else if (key === "longEdge") {\n                out.longEdge = Math.max(32, Number(value) || 32);\n            } else if (key !== "audioMode" && key !== "mode") {\n                out[key] = value;\n            }\n\n            out.audioMode = "generate";\n            out.mode = "fixed";\n            this.mixedTimeline = normalizeMixedTimeline(state);\n            this._applyMixedSharedControls();\n            this.scheduleTimelineSync();\n            return;\n        }\n'''
text = text[:on_start] + new_on_prefix + text[on_end:]

# Replace Mixed shared output synchronization function as one unit.
new_shared = '''    _applyMixedSharedControls() {\n        const state = this._ensureMixedTimeline();\n        state.output = state.output || {};\n        const output = state.output;\n        const initialWidth = Math.max(32, Number(output.width ?? state.width ?? 864) || 864);\n        const initialHeight = Math.max(32, Number(output.height ?? state.height ?? 480) || 480);\n\n        output.mode = "fixed";\n        output.multiple = output.multiple ?? MINIMAX_CANVAS_MULTIPLE;\n        if (!output.aspectRatio) {\n            const match = RESOLUTION_ASPECTS.find(([, aw, ah]) => (\n                Math.abs(initialWidth / initialHeight - aw / ah) < 0.02\n            ));\n            output.aspectRatio = match ? match[0] : CUSTOM_ASPECT_RATIO;\n        } else {\n            output.aspectRatio = isCustomAspectRatio(output.aspectRatio)\n                ? CUSTOM_ASPECT_RATIO\n                : normalizeAspectRatioLabel(output.aspectRatio);\n        }\n        if (output.megapixels == null) {\n            const inferred = Math.round((initialWidth * initialHeight / (1024 * 1024)) * 10) / 10;\n            output.megapixels = clampMegapixels(inferred || DEFAULT_MEGAPIXELS);\n        } else {\n            output.megapixels = clampMegapixels(output.megapixels);\n        }\n\n        if (isCustomAspectRatio(output.aspectRatio)) {\n            output.width = snapResolutionDim(initialWidth, output.multiple);\n            output.height = snapResolutionDim(initialHeight, output.multiple);\n        } else {\n            const resolved = resolutionFromSelector(\n                output.aspectRatio,\n                output.megapixels,\n                output.multiple,\n            );\n            output.width = resolved?.width ?? snapResolutionDim(initialWidth, output.multiple);\n            output.height = resolved?.height ?? snapResolutionDim(initialHeight, output.multiple);\n            if (resolved) {\n                output.aspectRatio = resolved.aspectRatio;\n                output.megapixels = resolved.megapixels;\n                output.multiple = resolved.multiple;\n            }\n        }\n        output.longEdge = Math.max(output.width, output.height);\n        state.width = output.width;\n        state.height = output.height;\n        state.refMaxSize = output.longEdge;\n\n        const setWidget = (name, value) => {\n            const widget = this.widget?.(name) || this.node?.widgets?.find?.((item) => item?.name === name);\n            if (widget && value != null) widget.value = value;\n        };\n        setWidget("frame_rate", state.frameRate ?? 24);\n        setWidget("width", output.width);\n        setWidget("height", output.height);\n        setWidget("ref_max_size", output.longEdge);\n        if (this.fpsInput) this.fpsInput.value = String(state.frameRate ?? 24);\n        if (this.outAspect) this.outAspect.value = output.aspectRatio;\n        if (this.outMp) this.outMp.value = String(output.megapixels);\n        if (this.outW) this.outW.value = String(output.width);\n        if (this.outH) this.outH.value = String(output.height);\n        if (this.outLong) this.outLong.value = String(output.longEdge);\n        if (this.outMode) this.outMode.value = "fixed";\n        if (this.outExportMode && output.exportMode) this.outExportMode.value = output.exportMode;\n        if (this.outMaxFrames) this.outMaxFrames.value = String(output.maxExportFrames ?? 0);\n        if (this.outAudioMode) this.outAudioMode.value = "generate";\n        this.updateOutputModeUI?.();\n        this.updateOutputPreview?.();\n    }\n\n'''
text = replace_func(text, '    _applyMixedSharedControls() {\n', '    _setMixedBodiesActive(active) {\n', new_shared, '_applyMixedSharedControls')
write(path, text)
