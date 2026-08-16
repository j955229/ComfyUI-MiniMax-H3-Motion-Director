from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')


def regex_once(path, pattern, replacement, label):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    out, count = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    p.write_text(out, encoding='utf-8')

# ---------------------------------------------------------------------------
# JS state: one authoritative visible-frame calculation + validation.
# ---------------------------------------------------------------------------
state = 'web/js/minimax_mixed_state.mjs'
replace_once(
    state,
    '''export function backendTaskPreview(mode, identityCount = 0) {\n    const normalized = normalizeMode(mode);\n    if (normalized === "source_video") return Number(identityCount) > 0 ? "rv2v" : "v2v";\n    return normalized;\n}\n''',
    '''export function backendTaskPreview(mode, identityCount = 0) {\n    const normalized = normalizeMode(mode);\n    if (normalized === "source_video") return Number(identityCount) > 0 ? "rv2v" : "v2v";\n    return normalized;\n}\n\nexport function mixedSegmentVisibleFrameCount(segment, fps = 24) {\n    const seg = segment || {};\n    const mode = normalizeMode(seg.mode);\n    const rate = Math.max(0.001, Number(fps) || 24);\n    if (mode === "source_video") {\n        const range = seg.inputs?.sourceVideo?.range || {};\n        const start = Number(range.startSec ?? 0);\n        const end = Number(range.endSec ?? 0);\n        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return 0;\n        return Math.max(4, Math.round((end - start) * rate));\n    }\n    const explicit = Number.parseInt(seg.frameCount ?? seg.frame_count ?? 0, 10);\n    if (explicit > 0) return explicit;\n    const seconds = Math.max(0.1, Number(seg.duration ?? 5) || 5);\n    const raw = Math.max(5, Math.round(seconds * rate));\n    if (raw <= 5) return 5;\n    return 5 + 17 * Math.ceil((raw - 5) / 17);\n}\n''',
    'add visible-frame helper',
)
regex_once(
    state,
    r'''export function validateMixedReferences\(segments\) \{.*?\n\}\n\nexport function referencedDependents''',
    '''export function validateMixedReferences(segments, fps = 24) {\n    const ids = new Map(segments.map((seg, index) => [String(seg.id), index]));\n    const errors = [];\n    segments.forEach((seg, consumerIndex) => {\n        for (const ref of seg.inputs?.resultRefs || []) {\n            if (ref.origin !== "segment") continue;\n            const sourceId = String(ref.segmentId || "");\n            const sourceIndex = ids.get(sourceId);\n            if (sourceIndex == null) {\n                errors.push({ code: "missing_reference", consumerId: seg.id, sourceId, message: "Referenced segment is missing." });\n            } else if (sourceIndex >= consumerIndex) {\n                errors.push({ code: "invalid_reference", consumerId: seg.id, sourceId, message: "Segment Result reference points forward after reorder." });\n            } else if (ref.frame !== "last") {\n                const frame = Number.parseInt(ref.frame, 10);\n                const frameCount = mixedSegmentVisibleFrameCount(segments[sourceIndex], fps);\n                const maxFrame = Math.max(0, frameCount - 1);\n                if (!Number.isInteger(frame) || frame < 0 || frame > maxFrame) {\n                    errors.push({\n                        code: "frame_out_of_range",\n                        consumerId: seg.id,\n                        sourceId,\n                        frame,\n                        maxFrame,\n                        message: `Segment Result frame ${ref.frame} is outside 0..${maxFrame}.`,\n                    });\n                }\n            }\n        }\n    });\n    return errors;\n}\n\nexport function referencedDependents''',
    'frame-aware JS validation',
)

# ---------------------------------------------------------------------------
# Native Mixed input UI: dynamic max + non-cramped slot controls.
# ---------------------------------------------------------------------------
native = 'web/js/minimax_mixed_native_inputs.mjs'
replace_once(
    native,
    '''// Mixed segment input renderer using the Director's existing visual language.\n''',
    '''import { mixedSegmentVisibleFrameCount } from "./minimax_mixed_state.mjs";\n\n// Mixed segment input renderer using the Director's existing visual language.\n''',
    'import visible-frame helper',
)
replace_once(
    native,
    '''.mmx-mixed-slot-tools{position:absolute;left:7px;right:7px;bottom:7px;z-index:8;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto}\n.mmx-mixed-slot-tools .bd-btn{padding:3px 8px;font-size:10px;background:rgba(18,18,18,.88);backdrop-filter:blur(2px)}\n.mmx-mixed-slot-tools .bd-btn.active{border-color:#4fff8f;color:#4fff8f;background:rgba(22,56,35,.92)}\n.mmx-mixed-result-summary{display:inline-flex;align-items:center;justify-content:center;max-width:calc(100% - 22px);padding:5px 8px;border:1px solid rgba(79,255,143,.55);border-radius:5px;background:rgba(12,30,20,.78);color:#bfffd4;font-size:11px;text-align:center;pointer-events:none}\n.mmx-mixed-result-advanced{position:absolute;left:7px;right:7px;bottom:38px;z-index:9;display:grid;grid-template-columns:minmax(110px,1fr) auto minmax(70px,110px) auto;gap:5px;align-items:center;padding:6px;border:1px solid #46515a;border-radius:6px;background:rgba(18,21,23,.96);box-shadow:0 4px 16px rgba(0,0,0,.45)}\n''',
    '''.mmx-mixed-slot-tools{position:absolute;left:7px;right:7px;bottom:7px;z-index:8;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:5px;pointer-events:auto}\n.mmx-mixed-slot-tools .bd-btn{flex:1 1 70px;min-width:0;padding:3px 5px;font-size:10px;white-space:nowrap;writing-mode:horizontal-tb!important;background:rgba(18,18,18,.88);backdrop-filter:blur(2px)}\n.mmx-mixed-slot-tools .bd-btn.active{border-color:#4fff8f;color:#4fff8f;background:rgba(22,56,35,.92)}\n.mmx-mixed-result-summary{display:inline-flex;align-items:center;justify-content:center;max-width:calc(100% - 22px);padding:5px 8px;border:1px solid rgba(79,255,143,.55);border-radius:5px;background:rgba(12,30,20,.78);color:#bfffd4;font-size:11px;text-align:center;pointer-events:auto;cursor:pointer}\n.mmx-mixed-result-advanced{position:absolute;left:7px;right:7px;bottom:38px;z-index:9;display:grid;grid-template-columns:minmax(110px,1fr) minmax(92px,auto) minmax(70px,100px) auto auto;gap:5px;align-items:center;padding:6px;border:1px solid #46515a;border-radius:6px;background:rgba(18,21,23,.96);box-shadow:0 4px 16px rgba(0,0,0,.45)}\n.mmx-mixed-result-range{font-size:10px;color:#9aa5ad;white-space:nowrap;text-align:center}\n''',
    'fix cramped slot CSS',
)
replace_once(
    native,
    '''function resultSummary(ref, segmentIndex, segments, tr) {\n    const sourceIndex = resultSourceIndex(ref, segmentIndex, segments);\n    if (ref?.frame === "last" || ref?.frame == null) {\n        return tr("mixed.resultSummaryLast", { n: sourceIndex + 1 });\n    }\n    return tr("mixed.resultSummaryFrame", { n: sourceIndex + 1, frame: ref.frame });\n}\n''',
    '''function resultSummary(ref, segmentIndex, segments, tr) {\n    const sourceIndex = resultSourceIndex(ref, segmentIndex, segments);\n    if (ref?.frame === "last" || ref?.frame == null) {\n        return tr("mixed.resultSummaryLast", { n: sourceIndex + 1 });\n    }\n    return tr("mixed.resultSummaryFrame", { n: sourceIndex + 1, frame: ref.frame });\n}\n\nfunction resultMaxFrameIndex(sourceId, segmentIndex, segments, frameRate) {\n    const index = segments.findIndex((segment, i) => i < segmentIndex && String(segment?.id) === String(sourceId));\n    const sourceIndex = index >= 0 ? index : Math.max(0, segmentIndex - 1);\n    const count = mixedSegmentVisibleFrameCount(segments[sourceIndex], frameRate || 24);\n    return Math.max(0, count - 1);\n}\n''',
    'add source max-frame helper',
)
regex_once(
    native,
    r'''function appendIntegratedResultControls\(slot, ctx, \{ role, staticKey \}\) \{.*?\n\}\n\nfunction renderT2v''',
    '''function appendIntegratedResultControls(slot, ctx, { role, staticKey }) {\n    const { seg, segmentIndex, segments, mutate, upload, status, tr, frameRate } = ctx;\n    const ref = refsFor(seg, role)[0] || null;\n    const advancedKey = resultAdvancedKey(seg, role);\n    const tools = document.createElement("div");\n    tools.className = "mmx-mixed-slot-tools";\n\n    const uploadButton = button(tr("mixed.upload"), () => {\n        void chooseAndStore({ seg, kind: "image", key: staticKey, role, upload, mutate, status, tr });\n    });\n    const resultButton = button(tr("mixed.segmentResult"), () => mutate(() => {\n        if (segmentIndex <= 0) return;\n        delete ensureInputs(seg)[staticKey];\n        addResultRef(seg, role, segments[segmentIndex - 1].id);\n        resultAdvancedVisibility.set(advancedKey, false);\n    }), { disabled: segmentIndex <= 0 });\n    resultButton.classList.toggle("active", !!ref);\n    tools.append(uploadButton, resultButton);\n    slot.appendChild(tools);\n\n    if (!ref || !resultAdvancedVisibility.get(advancedKey)) return;\n    const panel = document.createElement("div");\n    panel.className = "mmx-mixed-result-advanced";\n\n    const source = document.createElement("select");\n    source.className = "bd-select";\n    source.title = tr("mixed.resultSource");\n    for (let index = 0; index < segmentIndex; index += 1) {\n        const option = document.createElement("option");\n        option.value = segments[index].id;\n        option.textContent = tr("mixed.segment", { n: index + 1 });\n        source.appendChild(option);\n    }\n    source.value = ref.segmentId || segments[Math.max(0, segmentIndex - 1)]?.id || "";\n    let maxFrameIndex = resultMaxFrameIndex(source.value, segmentIndex, segments, frameRate);\n    source.onchange = () => mutate(() => {\n        ref.segmentId = source.value;\n        const nextMax = resultMaxFrameIndex(source.value, segmentIndex, segments, frameRate);\n        if (ref.frame !== "last") ref.frame = Math.min(nextMax, Math.max(0, Number.parseInt(ref.frame, 10) || 0));\n    });\n\n    const frameMode = document.createElement("select");\n    frameMode.className = "bd-select";\n    const last = document.createElement("option");\n    last.value = "last";\n    last.textContent = tr("mixed.resultLast");\n    const indexedFrame = document.createElement("option");\n    indexedFrame.value = "index";\n    indexedFrame.textContent = tr("mixed.resultFrameIndex");\n    frameMode.append(last, indexedFrame);\n    frameMode.value = ref.frame === "last" || ref.frame == null ? "last" : "index";\n    frameMode.onchange = () => mutate(() => {\n        ref.frame = frameMode.value === "last"\n            ? "last"\n            : Math.min(maxFrameIndex, Math.max(0, ref.frame === "last" || ref.frame == null ? 0 : Number.parseInt(ref.frame, 10) || 0));\n    });\n\n    const frameIndex = document.createElement("input");\n    frameIndex.type = "number";\n    frameIndex.min = "0";\n    frameIndex.max = String(maxFrameIndex);\n    frameIndex.step = "1";\n    frameIndex.title = `${tr("mixed.resultFrameIndex")} 0-${maxFrameIndex}`;\n    frameIndex.disabled = frameMode.value === "last";\n    frameIndex.value = frameMode.value === "last" ? "" : String(ref.frame);\n    frameIndex.oninput = () => {\n        if (frameMode.value === "last" || frameIndex.value === "") return;\n        const value = Math.max(0, Number.parseInt(frameIndex.value, 10) || 0);\n        if (value > maxFrameIndex) frameIndex.value = String(maxFrameIndex);\n    };\n    frameIndex.onchange = () => mutate(() => {\n        ref.frame = Math.min(maxFrameIndex, Math.max(0, Number.parseInt(frameIndex.value, 10) || 0));\n    });\n\n    const range = document.createElement("span");\n    range.className = "mmx-mixed-result-range";\n    range.textContent = `0-${maxFrameIndex}`;\n\n    const remove = button(tr("mixed.remove"), () => mutate(() => {\n        removeRoleRefs(seg, role);\n        resultAdvancedVisibility.delete(advancedKey);\n    }));\n    panel.append(source, frameMode, frameIndex, range, remove);\n    slot.appendChild(panel);\n}\n\nfunction renderT2v''',
    'replace integrated result controls',
)
replace_once(
    native,
    '''        summary.className = "mmx-mixed-result-summary";\n        summary.textContent = resultSummary(ref, segmentIndex, segments, tr);\n        source.appendChild(summary);\n''',
    '''        summary.className = "mmx-mixed-result-summary";\n        summary.textContent = resultSummary(ref, segmentIndex, segments, tr);\n        summary.title = tr("mixed.resultAdvanced");\n        summary.onclick = (event) => {\n            event.preventDefault();\n            event.stopPropagation();\n            const key = resultAdvancedKey(seg, "i2v_start");\n            resultAdvancedVisibility.set(key, !resultAdvancedVisibility.get(key));\n            mutate(() => {});\n        };\n        source.appendChild(summary);\n''',
    'make I2V result summary open advanced controls',
)
replace_once(
    native,
    '''        ph.className = ref ? "mmx-mixed-result-summary" : "ph";\n        ph.textContent = ref ? resultSummary(ref, segmentIndex, segments, tr) : tr(labelKey);\n        slot.appendChild(ph);\n''',
    '''        ph.className = ref ? "mmx-mixed-result-summary" : "ph";\n        ph.textContent = ref ? resultSummary(ref, segmentIndex, segments, tr) : tr(labelKey);\n        if (ref) {\n            ph.title = tr("mixed.resultAdvanced");\n            ph.onclick = (event) => {\n                event.preventDefault();\n                event.stopPropagation();\n                const key = resultAdvancedKey(seg, role);\n                resultAdvancedVisibility.set(key, !resultAdvancedVisibility.get(key));\n                mutate(() => {});\n            };\n        }\n        slot.appendChild(ph);\n''',
    'make FL2V result summary open advanced controls',
)
replace_once(
    native,
    '''    onPromptInput,\n    tr,\n}) {\n''',
    '''    onPromptInput,\n    tr,\n    frameRate = 24,\n}) {\n''',
    'accept Mixed frame rate',
)
replace_once(
    native,
    '''    const ctx = { seg, segmentIndex, segments, mutate, upload, probeVideo, viewUrl, status, onPromptInput, tr };\n''',
    '''    const ctx = { seg, segmentIndex, segments, mutate, upload, probeVideo, viewUrl, status, onPromptInput, tr, frameRate };\n''',
    'pass frame rate into native inputs',
)

# UI passes fps and validates frame bounds in cards/warnings.
ui = 'web/js/minimax_mixed_ui_v2.mjs'
replace_once(
    ui,
    '''        const errors = validateMixedReferences(state.segments);\n''',
    '''        const errors = validateMixedReferences(state.segments, state.frameRate || 24);\n''',
    'timeline frame-aware validation',
)
replace_once(
    ui,
    '''            tr: mt,\n        });\n''',
    '''            tr: mt,\n            frameRate: state.frameRate || 24,\n        });\n''',
    'pass fps to native renderer',
)
replace_once(
    ui,
    '''        const errors = validateMixedReferences(state.segments).filter((error) => String(error.consumerId) === String(seg.id));\n''',
    '''        const errors = validateMixedReferences(state.segments, state.frameRate || 24).filter((error) => String(error.consumerId) === String(seg.id));\n''',
    'editor frame-aware validation',
)

# ---------------------------------------------------------------------------
# Python schema: make invalid frame refs impossible even if JSON is edited.
# ---------------------------------------------------------------------------
schema = 'director/mixed_schema.py'
replace_once(
    schema,
    '''def normalize_mixed_segments(values: Sequence[Mapping[str, object]]) -> list[dict]:\n''',
    '''def normalize_mixed_segments(\n    values: Sequence[Mapping[str, object]],\n    *,\n    fps: float = 24.0,\n) -> list[dict]:\n''',
    'schema accepts fps',
)
replace_once(
    schema,
    '''    return normalized\n\n\ndef _id_index''',
    '''    id_to_index = {str(segment["id"]): i for i, segment in enumerate(normalized)}\n    for consumer_index, segment in enumerate(normalized):\n        for ref in (segment.get("inputs") or {}).get("resultRefs") or []:\n            source_id = str(ref.get("segmentId") or "").strip()\n            source_index = id_to_index.get(source_id)\n            if source_index is None or source_index >= consumer_index:\n                continue\n            frame = ref.get("frame", "last")\n            if frame == "last":\n                continue\n            max_index = max(0, mixed_visible_frame_count(normalized[source_index], fps) - 1)\n            if int(frame) > max_index:\n                raise MixedSchemaError(\n                    f"Result frame index {frame} is outside source Segment {source_index + 1} "\n                    f"range 0..{max_index}."\n                )\n\n    return normalized\n\n\ndef _id_index''',
    'schema rejects out-of-range refs',
)

plan = 'director/mixed_plan.py'
replace_once(
    plan,
    '''    normalized = normalize_mixed_segments(mixed.get("segments") or [])\n    fps = float(mixed.get("frameRate") or frame_rate or 24.0)\n''',
    '''    fps = float(mixed.get("frameRate") or frame_rate or 24.0)\n    normalized = normalize_mixed_segments(mixed.get("segments") or [], fps=fps)\n''',
    'planner passes fps into schema',
)

print('Applied Mixed frame bounds and compact slot controls.')
