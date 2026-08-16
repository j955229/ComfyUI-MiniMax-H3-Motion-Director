from pathlib import Path
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Mixed i18n: labels used by the native-looking picture expander.
# ---------------------------------------------------------------------------
path = 'web/js/minimax_mixed_i18n.mjs'
s = read(path)
s = replace_once(
    s,
    '    "mixed.uploadSourceVideo": "上传源视频",\n',
    '    "mixed.uploadSourceVideo": "上传源视频",\n    "mixed.expandMore": "展开更多（+{n}）",\n    "mixed.collapse": "收起",\n',
    'zh native input labels',
)
s = replace_once(
    s,
    '    "mixed.uploadSourceVideo": "Upload Source Video",\n',
    '    "mixed.uploadSourceVideo": "Upload Source Video",\n    "mixed.expandMore": "Expand (+{n})",\n    "mixed.collapse": "Collapse",\n',
    'en native input labels',
)
write(path, s)

# ---------------------------------------------------------------------------
# Mixed UI: route the selected segment body through the native visual renderer,
# remove the custom prompt/media construction from the live path, expose the
# selected segment to the single global Material Library, and make continuity
# compact/full-width instead of consuming a permanent right column.
# ---------------------------------------------------------------------------
path = 'web/js/minimax_mixed_ui_v2.mjs'
s = read(path)
s = replace_once(
    s,
    'import { mt, onMixedLocaleChange } from "./minimax_mixed_i18n.mjs";\n',
    'import { mt, onMixedLocaleChange } from "./minimax_mixed_i18n.mjs";\nimport { renderMixedNativeModeCard } from "./minimax_mixed_native_inputs.mjs?boot=native_inputs_v1";\n',
    'import native mixed renderer',
)
s = replace_once(
    s,
    '.mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:8px}.mmx-mixed-editor-panel,.mmx-mixed-continuity-panel{min-height:0;overflow:auto}.mmx-mixed-field{display:flex;flex-direction:column;gap:4px}.mmx-mixed-field-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mmx-mixed-field-row>.grow{flex:1 1 180px;min-width:120px}.mmx-mixed-field input[type=number],.mmx-mixed-field input[type=text]{background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:5px 7px;box-sizing:border-box}.mmx-mixed-field input[type=text]{width:100%}.mmx-mixed-media-block{display:flex;flex-direction:column;gap:6px;padding-top:7px;border-top:1px solid #333}.mmx-mixed-media-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.mmx-mixed-media-head b{margin-right:auto}.mmx-mixed-media-row{display:flex;align-items:center;gap:6px;min-width:0}.mmx-mixed-media-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mmx-mixed-media-row .bd-select{max-width:180px}.mmx-mixed-source-preview{height:150px;background:#111;border:1px solid #333;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center}.mmx-mixed-source-preview video{width:100%;height:100%;object-fit:contain}.mmx-mixed-status{min-height:18px}.mmx-mixed-status.error{color:#ff9090}.mmx-mixed-status.ok{color:#72d99b}.mmx-mixed-warning{color:#f5b55f}.mmx-mixed-toggle{display:flex;align-items:center;gap:7px}.mmx-mixed-toggle input{accent-color:#4fff8f}.mmx-mixed-result-row{display:grid;grid-template-columns:minmax(130px,1fr) 110px auto;gap:6px;align-items:center}\n@media(max-width:768px){.mmx-mixed-editor-grid{grid-template-columns:1fr}.mmx-mixed-card{flex-basis:165px;min-width:165px}.mmx-mixed-result-row{grid-template-columns:1fr 90px auto}}\n',
    '.mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.mmx-mixed-editor-panel{min-height:0;overflow:visible}.mmx-mixed-continuity-panel{min-height:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 8px!important;overflow:visible}.mmx-mixed-continuity-panel>b{font-size:11px;color:#999;font-weight:500}.mmx-mixed-continuity-panel .mmx-mixed-toggle{border:1px solid #444;border-radius:999px;padding:5px 9px;background:#171717}.mmx-mixed-field{display:flex;flex-direction:column;gap:4px}.mmx-mixed-field-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mmx-mixed-field-row>.grow{flex:1 1 180px;min-width:120px}.mmx-mixed-field input[type=number],.mmx-mixed-field input[type=text]{background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:5px 7px;box-sizing:border-box}.mmx-mixed-field input[type=text]{width:100%}.mmx-mixed-media-block{display:flex;flex-direction:column;gap:6px;padding-top:7px;border-top:1px solid #333}.mmx-mixed-media-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.mmx-mixed-media-head b{margin-right:auto}.mmx-mixed-media-row{display:flex;align-items:center;gap:6px;min-width:0}.mmx-mixed-media-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mmx-mixed-media-row .bd-select{max-width:180px}.mmx-mixed-source-preview{height:150px;background:#111;border:1px solid #333;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center}.mmx-mixed-source-preview video{width:100%;height:100%;object-fit:contain}.mmx-mixed-status{min-height:18px}.mmx-mixed-status.error{color:#ff9090}.mmx-mixed-status.ok{color:#72d99b}.mmx-mixed-warning{color:#f5b55f}.mmx-mixed-toggle{display:flex;align-items:center;gap:7px}.mmx-mixed-toggle input{accent-color:#4fff8f}.mmx-mixed-result-row,.mmx-mixed-native-result-row{display:grid;grid-template-columns:minmax(130px,1fr) 110px auto;gap:6px;align-items:center}.mmx-mixed-native-card{width:100%;box-sizing:border-box}.mmx-mixed-native-slot-actions,.mmx-mixed-native-section-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}.mmx-mixed-native-slot-actions .mmx-mixed-native-result-row{flex:1 1 320px}.mmx-mixed-source-range{margin-top:8px}.mmx-mixed-source-range input{width:70px}.mmx-mixed-editor-panel>.bd-seg-head{margin-bottom:6px}\n@media(max-width:768px){.mmx-mixed-card{flex-basis:165px;min-width:165px}.mmx-mixed-result-row,.mmx-mixed-native-result-row{grid-template-columns:1fr 90px auto}}\n',
    'mixed stack/native styles',
)
s = s.replace('origin: "earlier", segmentId: sourceId, frame: "last"', 'origin: "segment", segmentId: sourceId, frame: "last"')

pattern = re.compile(r'''\n        const promptField = document\.createElement\("div"\);.*?\n        renderModeInputs\(panel, seg\);\n''', re.S)
replacement = '''
        renderMixedNativeModeCard({
            container: panel,
            segment: seg,
            segmentIndex: selectedIndex,
            segments: state.segments,
            mutate,
            upload: uploadDescriptor,
            probeVideo,
            viewUrl,
            status,
            onPromptInput: (value) => {
                seg.prompt = value;
                onChange?.(clone(state));
            },
            tr: mt,
        });
'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'replace live generic Mixed editor: expected 1 match, got {count}')

s = replace_once(
    s,
    '        grid.append(editorPanel, continuityPanel);\n        root.append(timeline, grid);\n',
    '        if (selectedIndex > 0) grid.appendChild(continuityPanel);\n        grid.appendChild(editorPanel);\n        root.append(timeline, grid);\n',
    'compact continuity placement',
)
s = replace_once(
    s,
    '        get state() { return state; },\n        setState(next) {\n',
    '        get state() { return state; },\n        get selectedIndex() { return selectedIndex; },\n        get selectedSegment() { return selectedSegment(); },\n        commitExternalMutation() { notify(); },\n        setState(next) {\n',
    'mixed controller external mutation API',
)
write(path, s)

# ---------------------------------------------------------------------------
# Single global Material Library: in Mixed, treat the selected segment's mode as
# the library mode, show only that selected segment as target, and apply directly
# into Mixed schema instead of legacy editor.timeline.
# ---------------------------------------------------------------------------
path = 'web/js/minimax_material_library_modal.mjs'
s = read(path)
old = '''function currentMode(editor) {
    return String(editor?.getTaskKey?.() || editor?.globalTask?.value || editor?.timeline?.global?.taskType || "t2v").trim().toLowerCase();
}

function allowedTypes(mode) { return TYPE_ALLOWED[mode] || new Set(["prompt"]); }
'''
new = '''function isMixedEditor(editor) {
    return !!editor?.isMixedMode?.();
}

function currentMixedSegment(editor) {
    return editor?._mixedController?.selectedSegment
        || editor?.mixedTimeline?.segments?.[Number(editor?._mixedController?.selectedIndex || 0)]
        || null;
}

function currentMixedIndex(editor) {
    return Math.max(0, Number(editor?._mixedController?.selectedIndex || 0) || 0);
}

function mixedEffectiveMode(editor) {
    const mode = String(currentMixedSegment(editor)?.mode || "t2v").trim().toLowerCase();
    if (mode === "source_video") return "rv2v";
    return ["t2v", "i2v", "fl2v", "r2v"].includes(mode) ? mode : "t2v";
}

function currentMode(editor) {
    if (isMixedEditor(editor)) return mixedEffectiveMode(editor);
    return String(editor?.getTaskKey?.() || editor?.globalTask?.value || editor?.timeline?.global?.taskType || "t2v").trim().toLowerCase();
}

function allowedTypes(mode) { return TYPE_ALLOWED[mode] || new Set(["prompt"]); }
'''
s = replace_once(s, old, new, 'material current Mixed mode')

anchor = '''function selectedCountTotal(state) {
    const c = queueCounts(state);
    return c.image + c.audio + c.video + c.prompt;
}
'''
insert = anchor + '''
function buildMixedMaterialPlan(state, editor) {
    const segment = currentMixedSegment(editor);
    const mode = mixedEffectiveMode(editor);
    const segmentIndex = currentMixedIndex(editor);
    const assignments = [];
    const pushAll = (queue, queueKind, targetKind) => {
        for (const entry of queue || []) {
            assignments.push({
                queueKind,
                occurrenceOrder: entry.order,
                itemId: entry.itemId,
                item: entry.item,
                segmentIndex,
                targetKind,
            });
        }
    };
    if (!segment) {
        return { mode, target: null, existingSegments: 0, requiredSegments: 0, createSegments: 0, assignments, warnings: [], blockedReason: "target_required" };
    }
    if (mode === "t2v") {
        pushAll(state.prompts, "prompt", "prompt");
    } else if (mode === "i2v") {
        pushAll(state.images, "image", "start_image");
        pushAll(state.prompts, "prompt", "prompt");
    } else if (mode === "fl2v") {
        pushAll(state.fl2vFirstFrames, "first", "first_frame");
        pushAll(state.fl2vLastFrames, "last", "last_frame");
        pushAll(state.prompts, "prompt", "prompt");
    } else if (mode === "r2v") {
        pushAll(state.images, "image", "reference_picture");
        pushAll(state.audio, "audio", "reference_audio");
        pushAll(state.videos, "video", "reference_video");
        pushAll(state.prompts, "prompt", "prompt");
    } else if (mode === "rv2v") {
        pushAll(state.images, "image", "reference_picture");
        pushAll(state.audio, "audio", "reference_audio");
        // Source Video is intentionally local-upload only in Mixed.
        pushAll(state.prompts, "prompt", "prompt");
    }
    return {
        mode,
        target: `mixed:${segment.id || segmentIndex}`,
        existingSegments: 1,
        requiredSegments: 1,
        createSegments: 0,
        assignments,
        warnings: [],
        blockedReason: "",
    };
}
'''
s = replace_once(s, anchor, insert, 'mixed material planner')

# Track Mixed target so queued selections never silently carry to another segment.
s = replace_once(
    s,
    '    let lastAppliedSignature = null;\n\n    const setStatus =',
    '    let lastAppliedSignature = null;\n    let lastMixedTargetId = "";\n\n    const setStatus =',
    'mixed material selected target state',
)
old_sync = '''    const syncStateMode = () => {
        const before = state.mode;
        state = ensureMaterialLibraryMode(state, currentMode(editor));
        editor._materialLibraryState = state;
        if (before !== state.mode) {
            state.activeType = firstAllowedType(state.mode);
            state.activeCategory = "";
            lastAppliedSignature = null;
            setStatus("");
        }
        if (!allowedTypes(state.mode).has(state.activeType)) state.activeType = firstAllowedType(state.mode);
        if (state.mode === "r2v" && state.target === "common" && state.activeType === "prompt") state.activeType = "image";
    };
'''
new_sync = '''    const syncStateMode = () => {
        const before = state.mode;
        state = ensureMaterialLibraryMode(state, currentMode(editor));
        editor._materialLibraryState = state;
        if (before !== state.mode) {
            state.activeType = firstAllowedType(state.mode);
            state.activeCategory = "";
            lastAppliedSignature = null;
            setStatus("");
        }
        if (isMixedEditor(editor)) {
            const seg = currentMixedSegment(editor);
            const targetId = String(seg?.id || `index:${currentMixedIndex(editor)}`);
            if (lastMixedTargetId && lastMixedTargetId !== targetId) {
                clearAllSelections(state);
                lastAppliedSignature = null;
            }
            lastMixedTargetId = targetId;
            state.target = `mixed:${targetId}`;
        }
        if (!allowedTypes(state.mode).has(state.activeType)) state.activeType = firstAllowedType(state.mode);
        if (!isMixedEditor(editor) && state.mode === "r2v" && state.target === "common" && state.activeType === "prompt") state.activeType = "image";
    };
'''
s = replace_once(s, old_sync, new_sync, 'mixed material syncStateMode')

old_context = '''        if (state.mode === "r2v" || state.mode === "rv2v") {
            const label = document.createElement("span"); label.className = "mmx-ml-context-label"; label.textContent = `${mlT("target")}:`;
            const targets = document.createElement("div"); targets.className = "mmx-ml-targets";
            if (state.mode === "r2v") addTargetButton(targets, "common", mlT("common"));
            (editor.timeline?.segments || []).forEach((_seg, index) => addTargetButton(targets, `segment:${index}`, `S${index + 1}`));
            contextEl.append(label, targets);
            if (state.mode === "rv2v") {
                const note = document.createElement("span"); note.className = "mmx-ml-context-label"; note.textContent = mlT("sourceLocalOnly");
                contextEl.appendChild(note);
            }
        }
'''
new_context = '''        if (isMixedEditor(editor)) {
            const label = document.createElement("span");
            label.className = "mmx-ml-context-label";
            label.textContent = `${mlT("target")}: S${currentMixedIndex(editor) + 1}`;
            contextEl.appendChild(label);
            if (state.mode === "rv2v") {
                const note = document.createElement("span"); note.className = "mmx-ml-context-label"; note.textContent = mlT("sourceLocalOnly");
                contextEl.appendChild(note);
            }
        } else if (state.mode === "r2v" || state.mode === "rv2v") {
            const label = document.createElement("span"); label.className = "mmx-ml-context-label"; label.textContent = `${mlT("target")}:`;
            const targets = document.createElement("div"); targets.className = "mmx-ml-targets";
            if (state.mode === "r2v") addTargetButton(targets, "common", mlT("common"));
            (editor.timeline?.segments || []).forEach((_seg, index) => addTargetButton(targets, `segment:${index}`, `S${index + 1}`));
            contextEl.append(label, targets);
            if (state.mode === "rv2v") {
                const note = document.createElement("span"); note.className = "mmx-ml-context-label"; note.textContent = mlT("sourceLocalOnly");
                contextEl.appendChild(note);
            }
        }
'''
s = replace_once(s, old_context, new_context, 'mixed material context target')

# In Mixed I2V/FL2V a click replaces the one legal image role rather than building a queue.
old_click = '''        card.addEventListener("click", () => {
            const role = state.mode === "fl2v" && item.type === "image" ? state.fl2vRole : null;
            markSelectionChanged(); addMaterialOccurrence(state, item.type, item, role); renderAll();
        });
'''
new_click = '''        card.addEventListener("click", () => {
            const role = state.mode === "fl2v" && item.type === "image" ? state.fl2vRole : null;
            markSelectionChanged();
            if (isMixedEditor(editor) && state.mode === "i2v" && item.type === "image") {
                state.images = [];
            } else if (isMixedEditor(editor) && state.mode === "fl2v" && item.type === "image") {
                if (role === "first") state.fl2vFirstFrames = [];
                else state.fl2vLastFrames = [];
            }
            addMaterialOccurrence(state, item.type, item, role);
            renderAll();
        });
'''
s = replace_once(s, old_click, new_click, 'mixed single image material selection')

s = replace_once(
    s,
    '        const plan = buildMaterialAllocationPlan({ mode: state.mode, state, timeline: editor.timeline });\n',
    '        const plan = isMixedEditor(editor)\n            ? buildMixedMaterialPlan(state, editor)\n            : buildMaterialAllocationPlan({ mode: state.mode, state, timeline: editor.timeline });\n',
    'mixed material preview planner',
)

# Add direct Mixed application helper before standalone applyPlan.
anchor = '''    const applySequentialPrompts = (segments, promptQueue) => {
        promptQueue.forEach((entry, index) => {
            const segment = segments[index]; if (!segment) return;
            segment.prompt = applyPromptText(segment.prompt, entry.item?.content || "", state.promptApplyMode);
        });
    };

    const applyPlan = async () => {
'''
helper = '''    const applySequentialPrompts = (segments, promptQueue) => {
        promptQueue.forEach((entry, index) => {
            const segment = segments[index]; if (!segment) return;
            segment.prompt = applyPromptText(segment.prompt, entry.item?.content || "", state.promptApplyMode);
        });
    };

    const mixedDescriptor = (kind, mat, item, index = 0) => {
        const path = inputRelativePath(mat);
        const base = {
            index,
            assetId: item?.id || "",
            fileName: mat?.name || relativeName(item),
            type: "input",
            subfolder: mat?.subfolder || "",
        };
        if (kind === "image") return { ...base, imageFile: path };
        if (kind === "audio") return { ...base, audioFile: path };
        return { ...base, videoFile: path };
    };

    const removeMixedResultRole = (segment, role) => {
        segment.inputs = segment.inputs || {};
        segment.inputs.resultRefs = Array.isArray(segment.inputs.resultRefs) ? segment.inputs.resultRefs : [];
        segment.inputs.resultRefs = segment.inputs.resultRefs.filter((ref) => ref?.role !== role);
    };

    const appendMixedQueue = async (segment, field, kind, queue, limit, materialize) => {
        segment.inputs = segment.inputs || {};
        const values = Array.isArray(segment.inputs[field]) ? [...segment.inputs[field]] : [];
        for (const entry of queue || []) {
            if (values.length >= limit) break;
            const mat = await materialize(entry.item);
            values.push(mixedDescriptor(kind, mat, entry.item, values.length));
        }
        segment.inputs[field] = values.slice(0, limit).map((item, index) => ({ ...item, index }));
    };

    const applyMixedPlan = async (materialize) => {
        const segment = currentMixedSegment(editor);
        if (!segment) throw new Error("Mixed segment is not available.");
        const mode = mixedEffectiveMode(editor);
        segment.inputs = segment.inputs || {};
        segment.inputs.resultRefs = Array.isArray(segment.inputs.resultRefs) ? segment.inputs.resultRefs : [];

        if (mode === "i2v" && state.images.length) {
            const entry = state.images[state.images.length - 1];
            const mat = await materialize(entry.item);
            segment.inputs.startFrame = mixedDescriptor("image", mat, entry.item, 0);
            removeMixedResultRole(segment, "i2v_start");
        } else if (mode === "fl2v") {
            if (state.fl2vFirstFrames.length) {
                const entry = state.fl2vFirstFrames[state.fl2vFirstFrames.length - 1];
                const mat = await materialize(entry.item);
                segment.inputs.firstFrame = mixedDescriptor("image", mat, entry.item, 0);
                removeMixedResultRole(segment, "fl2v_first");
            }
            if (state.fl2vLastFrames.length) {
                const entry = state.fl2vLastFrames[state.fl2vLastFrames.length - 1];
                const mat = await materialize(entry.item);
                segment.inputs.lastFrame = mixedDescriptor("image", mat, entry.item, 0);
                removeMixedResultRole(segment, "fl2v_last");
            }
        } else if (mode === "r2v") {
            await appendMixedQueue(segment, "pictures", "image", state.images, MAX_REFERENCE_IMAGES, materialize);
            await appendMixedQueue(segment, "referenceAudios", "audio", state.audio, MAX_REFERENCE_AUDIOS, materialize);
            await appendMixedQueue(segment, "referenceVideos", "video", state.videos, MAX_REFERENCE_VIDEOS, materialize);
        } else if (mode === "rv2v") {
            await appendMixedQueue(segment, "identityPictures", "image", state.images, MAX_REFERENCE_IMAGES, materialize);
            await appendMixedQueue(segment, "referenceAudios", "audio", state.audio, MAX_REFERENCE_AUDIOS, materialize);
        }

        if (state.prompts.length) {
            const text = state.prompts.map((entry) => entry.item?.content || "").filter(Boolean).join("\n");
            if (text) segment.prompt = applyPromptText(segment.prompt, text, state.promptApplyMode);
        }
        editor._mixedController?.commitExternalMutation?.();
    };

    const applyPlan = async () => {
'''
s = replace_once(s, anchor, helper, 'mixed material apply helper')

old_try = '''        const materialize = materializeCacheFactory();
        try {
            if (state.mode === "t2v") {
'''
new_try = '''        const materialize = materializeCacheFactory();
        try {
            if (isMixedEditor(editor)) {
                await applyMixedPlan(materialize);
            } else if (state.mode === "t2v") {
'''
s = replace_once(s, old_try, new_try, 'mixed material apply branch')
write(path, s)

# ---------------------------------------------------------------------------
# Director native layout: every Mixed activation enforces the same ordering as
# standalone modes: output bar first, then the mode body. Also bump module boot
# query so local browsers do not keep the previous Mixed UI module cached.
# ---------------------------------------------------------------------------
path = 'web/js/minimax_timeline.js'
s = read(path)
s = s.replace('"./minimax_mixed_ui.mjs?boot=mixed_native_v2"', '"./minimax_mixed_ui.mjs?boot=mixed_native_v3"')
s = s.replace('"./minimax_mixed_state.mjs?boot=mixed_native_v2"', '"./minimax_mixed_state.mjs?boot=mixed_native_v3"')
old = '''    _setMixedBodiesActive(active) {
        const host = this._mixedPanelHost;
        for (const child of Array.from(this.mainBody?.children || [])) {
            if (child === host || child === this.outputBarEl) continue;
            child.classList?.toggle("hidden", !!active);
        }
'''
new = '''    _setMixedBodiesActive(active) {
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
'''
s = replace_once(s, old, new, 'force Mixed output bar ordering')
write(path, s)

# Mixed re-export cache bump.
path = 'web/js/minimax_mixed_ui.mjs'
s = read(path)
s = replace_once(
    s,
    '} from "./minimax_mixed_ui_v2.mjs";',
    '} from "./minimax_mixed_ui_v2.mjs?boot=native_inputs_v1";',
    'mixed UI re-export cache bump',
)
write(path, s)

# Global Material Library cache bump so Mixed-aware allocation loads after pull.
path = 'web/js/minimax_material_library.js'
s = read(path)
s = replace_once(
    s,
    'import { mountMaterialLibrary } from "./minimax_material_library_modal.mjs";',
    'import { mountMaterialLibrary } from "./minimax_material_library_modal.mjs?boot=mixed_global_library_v1";',
    'material library cache bump',
)
write(path, s)

print('Mixed native UI alignment patch applied.')
