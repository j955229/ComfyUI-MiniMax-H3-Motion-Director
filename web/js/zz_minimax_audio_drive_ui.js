import { app } from "../../scripts/app.js";
import { getLocale } from "./minimax_i18n.js";
import {
    effectiveReferenceAssets,
    ensureR2vReferenceAssetSchema,
    ensureReferenceAssetSchema,
} from "./minimax_reference_assets.mjs";
import {
    clearStaleDialogueDriveAsset,
    dialogueDriveScopeKey,
    getDialogueDriveAsset,
    setDialogueDriveAsset,
} from "./minimax_dialogue_drive_core.mjs";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const CONTROL_CLASS = "mmx-dialogue-drive-control";

function strings(r2v = false) {
    if (getLocale() === "en") return {
        label: r2v ? "Dialogue Drive (selected group)" : "Dialogue Drive",
        off: "Off · normal reference",
        empty: "Upload speech audio first",
        title: "Use one uploaded reference audio as the dialogue performance. The speaker follows its words/timing while H3 still generates ambience, SFX and music.",
    };
    return {
        label: r2v ? "对白驱动（当前组）" : "对白驱动",
        off: "关闭 · 普通参考",
        empty: "请先上传人物说话音频",
        title: "把一个已上传的参考音频作为人物对白表演：人物按其中的话语和时间说话并对口型；最终音频仍由 H3 生成，所以可同时生成环境音、音效和背景音乐。",
    };
}

function taskKey(editor) {
    return String(editor?.getTaskKey?.() || "").trim().toLowerCase();
}

function audioOutputSelect(editor) {
    return editor?.outAudioMode || editor?.root?.querySelector?.('[data-r="out-audio-mode"]') || null;
}

function removeWrongOutputMode(editor) {
    const output = editor?.timeline?.output;
    if (!output) return false;
    const select = audioOutputSelect(editor);
    let changed = false;
    for (const option of Array.from(select?.options || [])) {
        if (String(option.value) === "drive") { option.remove(); changed = true; }
    }
    if (output.audioDrive === true || output.audio_drive === true) {
        delete output.audioDrive;
        delete output.audio_drive;
        output.audioMode = "generate";
        if (select) select.value = "generate";
        changed = true;
    }
    return changed;
}

function forceGeneratedAudio(editor) {
    editor.timeline.output = editor.timeline.output || {};
    editor.timeline.output.audioMode = "generate";
    const select = audioOutputSelect(editor);
    if (select) select.value = "generate";
    editor.updateSegmentContinuityUI?.();
}

function commit(editor, node) {
    editor.scheduleTimelineSync?.();
    editor.commit?.();
    node?.setDirtyCanvas?.(true, true);
}

function basename(item, fallback) {
    const raw = String(item?.audioFile || item?.fileName || fallback || "Audio");
    return raw.split(/[\\/]/).pop() || fallback || "Audio";
}

function r2vAudios(timeline, segment) {
    return effectiveReferenceAssets(timeline.r2vCommon || {}, segment)
        .filter((a) => a.kind === "audio" && !a.paired && a.assetId && (a.item?.audioFile || a.item?.fileName))
        .map((a) => ({
            id: String(a.assetId),
            tag: String(a.effectiveTag || a.officialTag || ""),
            name: String(a.label || basename(a.item, "Audio")),
        }));
}

function rv2vAudios(target) {
    return (target?.refAudios || [])
        .filter((a) => a?.audioFile || a?.fileName)
        .map((a, order) => {
            const slot = Number(a.index ?? a.slot ?? order);
            return {
                id: String(a.assetId || a.asset_id || ""),
                tag: `<Audio ${slot + 1}>`,
                name: basename(a, `Audio ${slot + 1}`),
            };
        }).filter((a) => a.id);
}

function ensureStyle() {
    if (document.getElementById("mmx-dialogue-drive-style")) return;
    const style = document.createElement("style");
    style.id = "mmx-dialogue-drive-style";
    style.textContent = `
.${CONTROL_CLASS}{display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid #34463a;border-radius:7px;background:#101713;color:#a9c9b1;font-size:10px}
.${CONTROL_CLASS} .mmx-dialogue-drive-label{white-space:nowrap;font-weight:650;color:#7ee59a}
.${CONTROL_CLASS} select{min-width:150px;max-width:330px;height:26px}
`;
    document.head.appendChild(style);
}

function syncControl(host, { timeline, editor, node, scope, global = false, audios, r2v = false }) {
    if (!host) return false;
    const words = strings(r2v);
    const stale = clearStaleDialogueDriveAsset(timeline, scope, audios.map((a) => a.id), { global });
    if (stale) commit(editor, node);

    let control = host.querySelector?.(`.${CONTROL_CLASS}`);
    if (!control) {
        control = document.createElement("div");
        control.className = CONTROL_CLASS;
        control.innerHTML = '<span class="mmx-dialogue-drive-label"></span><select class="bd-select"></select>';
        host.appendChild(control);
    }
    control.title = words.title;
    control.querySelector(".mmx-dialogue-drive-label").textContent = words.label;
    const select = control.querySelector("select");
    const current = getDialogueDriveAsset(timeline, scope, { global });
    const sig = JSON.stringify([getLocale(), audios.map((a) => [a.id, a.tag, a.name])]);
    if (select.dataset.sig !== sig) {
        select.innerHTML = "";
        const off = document.createElement("option");
        off.value = "";
        off.textContent = audios.length ? words.off : words.empty;
        select.appendChild(off);
        for (const audio of audios) {
            const option = document.createElement("option");
            option.value = audio.id;
            option.textContent = `${audio.tag ? `${audio.tag} · ` : ""}${audio.name}`;
            select.appendChild(option);
        }
        select.dataset.sig = sig;
        select.disabled = audios.length === 0;
    }
    select.value = current;
    if (!select._mmxDialogueBound) {
        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("change", (e) => {
            e.stopPropagation();
            setDialogueDriveAsset(timeline, scope, select.value, { global });
            if (select.value) forceGeneratedAudio(editor);
            commit(editor, node);
        });
        select._mmxDialogueBound = true;
    }
    return true;
}

function syncR2v(editor, node) {
    const timeline = editor.timeline;
    ensureR2vReferenceAssetSchema(timeline);
    const index = Number(editor.selectedIndex) || 0;
    const segment = timeline.segments?.[index];
    if (!segment) return false;
    const host = editor.batchPanel?.querySelector?.(".bd-batch-toolbar")
        || editor.root?.querySelector?.('[data-r="batch-panel"] .bd-batch-toolbar');
    return syncControl(host, {
        timeline, editor, node, r2v: true,
        scope: dialogueDriveScopeKey(segment, index),
        audios: r2vAudios(timeline, segment),
    });
}

function syncRv2v(editor, node) {
    const timeline = editor.timeline;
    ensureReferenceAssetSchema(timeline);
    const global = !!editor.isGlobalMode?.();
    const index = Number(editor.selectedIndex) || 0;
    const segment = timeline.segments?.[index];
    const target = global ? timeline.global : segment;
    if (!target) return false;
    const host = editor.root?.querySelector?.(
        global ? '[data-r="global-ref-audios-wrap"]' : '[data-r="seg-ref-audios-wrap"]'
    );
    return syncControl(host, {
        timeline, editor, node, global,
        scope: global ? "global" : dialogueDriveScopeKey(segment, index),
        audios: rv2vAudios(target),
    });
}

function syncDialogueDriveUi(node) {
    const editor = node?._minimaxEditor;
    if (!editor?.timeline || !editor?.root) return false;
    ensureStyle();
    let changed = removeWrongOutputMode(editor);
    const key = taskKey(editor);
    if (key === "r2v") changed = syncR2v(editor, node) || changed;
    else if (key === "rv2v") changed = syncRv2v(editor, node) || changed;
    return changed;
}

function schedule(node) {
    for (const delay of [0, 80, 250, 800]) setTimeout(() => syncDialogueDriveUi(node), delay);
}

function wrap(nodeType) {
    for (const hook of ["onNodeCreated", "onConfigure", "onWidgetChanged"]) {
        const original = nodeType.prototype[hook];
        nodeType.prototype[hook] = function () {
            const result = original?.apply(this, arguments);
            schedule(this);
            return result;
        };
    }
    const draw = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
        const result = draw?.apply(this, arguments);
        syncDialogueDriveUi(this);
        return result;
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.DialogueDrive",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === DIRECTOR_CLASS) wrap(nodeType);
    },
});
