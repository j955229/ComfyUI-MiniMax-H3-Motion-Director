import { app } from "../../scripts/app.js";
import { getLocale } from "./minimax_i18n.js";
import {
    allKnownReferenceAssets,
    effectiveReferenceAssets,
    ensureR2vReferenceAssetSchema,
    ensureReferenceAssetSchema,
} from "./minimax_reference_assets.mjs";
import {
    AUDIO_ROLE_AUDIO_DRIVE,
    AUDIO_ROLE_DIALOGUE_DRIVE,
    AUDIO_ROLE_REFERENCE,
    audioPlacement,
    audioRoleScopeKey,
    clearStaleAudioRoles,
    effectiveAudioDuration,
    ensureAudioRoleState,
    getAudioRole,
    listAudioRoles,
    moveAudioRole,
    setAudioRole,
    validateAudioRoleIntervals,
} from "./minimax_dialogue_drive_core.mjs";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const STYLE_ID = "mmx-audio-roles-style";
const PANEL_CLASS = "mmx-audio-role-panel";
const CARD_BOUND = "mmxAudioRoleBound";

function words() {
    if (getLocale() === "en") return {
        reference: "Normal reference",
        audioDrive: "Original Audio Drive",
        dialogueDrive: "Dialogue Drive",
        timeline: "Drive timeline",
        edit: "Edit audio",
        editorTitle: "Edit audio",
        play: "Play",
        pause: "Pause",
        loop: "Loop selection",
        reset: "Reset",
        cancel: "Cancel",
        save: "Save",
        trimStart: "Trim start",
        trimEnd: "Trim end",
        effective: "Effective",
        overlap: "Drive intervals overlap. Drag a block to a free time range.",
        overrun: "A drive block exceeds this segment. Move it earlier or shorten it in the editor.",
        decodeFail: "Unable to decode this audio for editing.",
        common: "Common",
    };
    return {
        reference: "普通参考",
        audioDrive: "原音驱动",
        dialogueDrive: "对白驱动",
        timeline: "驱动时间轴",
        edit: "编辑音频",
        editorTitle: "编辑音频",
        play: "播放",
        pause: "暂停",
        loop: "循环选区",
        reset: "重置",
        cancel: "取消",
        save: "保存",
        trimStart: "裁切开始",
        trimEnd: "裁切结束",
        effective: "有效长度",
        overlap: "驱动时间发生重叠，请拖动音频块到空闲时间范围。",
        overrun: "驱动音频超出片段，请向前拖动或在编辑器中剪短。",
        decodeFail: "无法解码这条音频，不能打开编辑器。",
        common: "共用",
    };
}

function taskKey(editor) {
    return String(editor?.getTaskKey?.() || "").trim().toLowerCase();
}

function commit(editor, node) {
    editor.scheduleTimelineSync?.();
    editor.commit?.();
    node?.setDirtyCanvas?.(true, true);
}

function audioOutputSelect(editor) {
    return editor?.outAudioMode || editor?.root?.querySelector?.('[data-r="out-audio-mode"]') || null;
}

function forceGeneratedAudio(editor) {
    editor.timeline.output = editor.timeline.output || {};
    editor.timeline.output.audioMode = "generate";
    const select = audioOutputSelect(editor);
    if (select) select.value = "generate";
    editor.updateSegmentContinuityUI?.();
}

function cleanOldDriveOutput(editor) {
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

function basename(item, fallback = "Audio") {
    const raw = String(item?.audioFile || item?.fileName || fallback || "Audio");
    return raw.split(/[\\/]/).pop() || fallback;
}

function audioUrl(item) {
    const raw = String(item?.audioFile || item?.fileName || "").replace(/\\/g, "/");
    const bits = raw.split("/").filter(Boolean);
    const filename = bits.pop() || "";
    const subfolder = String(item?.subfolder || bits.join("/") || "").replace(/\\/g, "/");
    const type = String(item?.type || "input");
    return `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder)}`;
}

function segmentDuration(editor, segment, { global = false } = {}) {
    const fps = Number(editor?.timeline?.frameRate || editor?.frameRateWidget?.value || 24) || 24;
    if (global) {
        const durations = (editor.timeline.segments || []).map((seg) => segmentDuration(editor, seg)).filter((v) => v > 0);
        return durations.length ? Math.min(...durations) : 0;
    }
    const explicit = Number(segment?.durationSec ?? segment?.duration);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const frames = Number(segment?.frameCount ?? segment?.length ?? ((segment?.end ?? 0) - (segment?.start ?? 0)));
    return Number.isFinite(frames) && frames > 0 ? frames / fps : 0;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-audio-role-select{width:100%;min-width:0;height:24px;padding:2px 5px;border:1px solid #35503d;border-radius:5px;background:#111713;color:#d7e8dc;font-size:10px;box-sizing:border-box}
.mmx-audio-edit-btn{position:absolute;right:32px;top:7px;z-index:5;width:22px;height:22px;border:1px solid #44554a;border-radius:6px;background:rgba(10,14,11,.88);color:#a9d8b8;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;line-height:1;padding:0}
.mmx-audio-edit-btn:hover{border-color:#70b485;color:#eafff0;background:#17251b}
.mmx-audio-role-meta{display:flex;align-items:center;justify-content:flex-end;gap:5px;color:#829188;font-size:9px;min-width:0}
.mmx-audio-common-roles{display:flex;flex-direction:column;gap:5px;margin-top:4px}
.mmx-audio-common-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(112px,150px) 26px;gap:6px;align-items:center;padding:5px 7px;border:1px solid #2c3d31;border-radius:6px;background:#0d120f;color:#9fb0a4;font-size:10px}
.mmx-audio-common-row button{position:static;width:24px;height:24px}
.${PANEL_CLASS}{display:flex;flex-direction:column;gap:5px;margin-top:7px;padding:7px 8px;border:1px solid #2e4034;border-radius:8px;background:#0b100d;box-sizing:border-box;min-width:0}
.${PANEL_CLASS}[hidden]{display:none!important}
.mmx-audio-timeline-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#a9b7ad;font-size:10px}
.mmx-audio-timeline-head b{color:#bfe6ca;font-weight:650}
.mmx-audio-timeline-warning{color:#ffb36b;font-size:9px;text-align:right}
.mmx-audio-axis{position:relative;height:16px;color:#66736a;font-size:8px;font-variant-numeric:tabular-nums}
.mmx-audio-axis span{position:absolute;transform:translateX(-50%);top:0}.mmx-audio-axis span:first-child{transform:none}.mmx-audio-axis span:last-child{transform:translateX(-100%)}
.mmx-audio-tracks{position:relative;min-height:30px;border:1px solid #263229;border-radius:5px;background:repeating-linear-gradient(90deg,#0d110e 0,#0d110e calc(25% - 1px),#1b241e calc(25% - 1px),#1b241e 25%);overflow:hidden}
.mmx-audio-drive-block{position:absolute;height:24px;border-radius:5px;display:flex;align-items:center;gap:5px;padding:0 7px;box-sizing:border-box;cursor:grab;user-select:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px;font-weight:650;touch-action:none}
.mmx-audio-drive-block:active{cursor:grabbing}
.mmx-audio-drive-block[data-role="dialogue_drive"]{background:#173b27;border:1px solid #4dba72;color:#c8f5d5}
.mmx-audio-drive-block[data-role="audio_drive"]{background:#302717;border:1px solid #c69b49;color:#ffe3a8}
.mmx-audio-drive-block.invalid{border-color:#ff725f;background:#3a1815;color:#ffd0c9}
.mmx-audio-drive-block .time{opacity:.72;font-weight:500}
.mmx-audio-editor-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.mmx-audio-editor{width:min(760px,calc(100vw - 40px));background:#101311;border:1px solid #3b4c40;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.72);padding:14px;display:flex;flex-direction:column;gap:11px;color:#ddd;font-size:11px}
.mmx-audio-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.mmx-audio-editor-head b{font-size:13px;color:#e6eee8}.mmx-audio-editor-head span{color:#7e8a82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mmx-wave-wrap{position:relative;height:130px;border:1px solid #2b352e;border-radius:8px;background:#080a09;overflow:hidden;cursor:crosshair}.mmx-wave-wrap canvas{display:block;width:100%;height:100%}.mmx-trim-selection{position:absolute;top:0;bottom:0;background:rgba(79,255,143,.09);border-left:1px solid #4fff8f;border-right:1px solid #4fff8f;pointer-events:none}.mmx-trim-handle{position:absolute;top:0;bottom:0;width:10px;background:rgba(79,255,143,.26);pointer-events:auto;cursor:ew-resize}.mmx-trim-handle.left{left:-5px}.mmx-trim-handle.right{right:-5px}
.mmx-audio-editor-fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.mmx-audio-editor-fields label{display:flex;flex-direction:column;gap:4px;color:#8f9d93}.mmx-audio-editor-fields input{width:100%;box-sizing:border-box;background:#090b0a;color:#e7eee9;border:1px solid #343d37;border-radius:5px;padding:6px;font-variant-numeric:tabular-nums}
.mmx-audio-editor-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mmx-audio-editor-controls button,.mmx-audio-editor-actions button{border:1px solid #3c4940;border-radius:6px;background:#181d19;color:#d9e3dc;padding:6px 10px;cursor:pointer}.mmx-audio-editor-controls button:hover,.mmx-audio-editor-actions button:hover{border-color:#698174}.mmx-audio-editor-controls label{display:flex;align-items:center;gap:5px;color:#98a49c}.mmx-audio-editor-actions{display:flex;justify-content:flex-end;gap:7px}.mmx-audio-editor-actions .save{border-color:#4b8b5e;color:#bdf4cb;background:#15301d}
.bd-batch-r2v .bd-batch-audio.has-audio,.bd-rv2v-layout .bd-ref-audio.has-audio{padding-top:6px;padding-bottom:7px}
`;
    document.head.appendChild(style);
}

function roleOptions(select, current) {
    const w = words();
    const opts = [
        [AUDIO_ROLE_REFERENCE, w.reference],
        [AUDIO_ROLE_AUDIO_DRIVE, w.audioDrive],
        [AUDIO_ROLE_DIALOGUE_DRIVE, w.dialogueDrive],
    ];
    select.innerHTML = "";
    for (const [value, label] of opts) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    select.value = current;
}

function activeItems(timeline, scope, audios, options) {
    return audios.map((a) => ({ assetId: a.id, ...getAudioRole(timeline, scope, a.id, options) }));
}

function nextDriveStart(timeline, scope, assetId, audios, segmentSec, options) {
    const rows = activeItems(timeline, scope, audios, options)
        .filter((r) => r.assetId !== assetId && (r.role === AUDIO_ROLE_AUDIO_DRIVE || r.role === AUDIO_ROLE_DIALOGUE_DRIVE));
    let end = 0;
    for (const row of rows) end = Math.max(end, audioPlacement(row, segmentSec).end);
    return end;
}

function setDiscoveredDuration(timeline, scope, audio, duration, options, editor, node) {
    if (!Number.isFinite(duration) || duration <= 0 || !audio?.id) return;
    const current = getAudioRole(timeline, scope, audio.id, options);
    if (Math.abs(Number(current.sourceDuration) - duration) < 0.005 && effectiveAudioDuration(current) > 0) return;
    setAudioRole(timeline, scope, audio.id, { sourceDuration: duration }, options);
    commit(editor, node);
}

function discoverDuration(audio, timeline, scope, options, editor, node, onReady) {
    const current = getAudioRole(timeline, scope, audio.id, options);
    if (Number(current.sourceDuration) > 0) {
        onReady?.(Number(current.sourceDuration));
        return;
    }
    const media = new Audio();
    media.preload = "metadata";
    media.src = audioUrl(audio.item);
    const apply = () => {
        if (!Number.isFinite(media.duration) || media.duration <= 0 || media.duration === Infinity) return;
        setDiscoveredDuration(timeline, scope, audio, media.duration, options, editor, node);
        onReady?.(media.duration);
        media.src = "";
    };
    media.addEventListener("loadedmetadata", apply, { once: true });
}

function drawWaveform(canvas, buffer) {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(100, Math.round(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#66c987";
    ctx.lineWidth = Math.max(1, dpr);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    const mid = height / 2;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
        const start = x * step;
        const end = Math.min(data.length, start + step);
        let min = 1, max = -1;
        for (let i = start; i < end; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
        ctx.moveTo(x, mid + min * mid * 0.88);
        ctx.lineTo(x, mid + max * mid * 0.88);
    }
    ctx.stroke();
}

async function openAudioEditor({ timeline, scope, audio, options, editor, node, segmentSec }) {
    const w = words();
    let arrayBuffer;
    try {
        const response = await fetch(audioUrl(audio.item));
        if (!response.ok) throw new Error(String(response.status));
        arrayBuffer = await response.arrayBuffer();
    } catch (err) {
        window.alert?.(`${w.decodeFail}\n${err}`);
        return;
    }
    let context;
    let decoded;
    try {
        context = new (window.AudioContext || window.webkitAudioContext)();
        decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
        context?.close?.();
        window.alert?.(`${w.decodeFail}\n${err}`);
        return;
    }
    const duration = decoded.duration;
    setDiscoveredDuration(timeline, scope, audio, duration, options, editor, node);
    const cfg = getAudioRole(timeline, scope, audio.id, options);
    let trimStart = Math.max(0, Math.min(duration, Number(cfg.trimStart) || 0));
    let trimEnd = Math.max(trimStart, Math.min(duration, Number(cfg.trimEnd) > 0 ? Number(cfg.trimEnd) : duration));

    const backdrop = document.createElement("div");
    backdrop.className = "mmx-audio-editor-backdrop";
    backdrop.innerHTML = `
      <div class="mmx-audio-editor" role="dialog" aria-modal="true">
        <div class="mmx-audio-editor-head"><b>${w.editorTitle}</b><span></span></div>
        <div class="mmx-wave-wrap"><canvas></canvas><div class="mmx-trim-selection"><div class="mmx-trim-handle left"></div><div class="mmx-trim-handle right"></div></div></div>
        <div class="mmx-audio-editor-fields">
          <label>${w.trimStart}<input class="start" type="number" min="0" step="0.001"></label>
          <label>${w.trimEnd}<input class="end" type="number" min="0" step="0.001"></label>
          <label>${w.effective}<input class="effective" type="text" readonly></label>
        </div>
        <div class="mmx-audio-editor-controls"><button class="play">▶ ${w.play}</button><label><input class="loop" type="checkbox"> ${w.loop}</label><button class="reset">${w.reset}</button></div>
        <div class="mmx-audio-editor-actions"><button class="cancel">${w.cancel}</button><button class="save">${w.save}</button></div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".mmx-audio-editor-head span").textContent = basename(audio.item);
    const canvas = backdrop.querySelector("canvas");
    requestAnimationFrame(() => drawWaveform(canvas, decoded));
    const selection = backdrop.querySelector(".mmx-trim-selection");
    const startInput = backdrop.querySelector("input.start");
    const endInput = backdrop.querySelector("input.end");
    const effectiveInput = backdrop.querySelector("input.effective");
    const loopInput = backdrop.querySelector("input.loop");
    const playBtn = backdrop.querySelector("button.play");
    const player = new Audio(audioUrl(audio.item));
    player.preload = "auto";

    const sync = () => {
        trimStart = Math.max(0, Math.min(duration, trimStart));
        trimEnd = Math.max(trimStart, Math.min(duration, trimEnd));
        startInput.value = trimStart.toFixed(3);
        endInput.value = trimEnd.toFixed(3);
        effectiveInput.value = `${Math.max(0, trimEnd - trimStart).toFixed(3)} s`;
        const left = duration > 0 ? trimStart / duration * 100 : 0;
        const width = duration > 0 ? (trimEnd - trimStart) / duration * 100 : 0;
        selection.style.left = `${left}%`;
        selection.style.width = `${width}%`;
    };
    sync();

    const stop = () => { player.pause(); playBtn.textContent = `▶ ${w.play}`; };
    player.addEventListener("play", () => { playBtn.textContent = `⏸ ${w.pause}`; });
    player.addEventListener("pause", () => { playBtn.textContent = `▶ ${w.play}`; });
    player.addEventListener("timeupdate", () => {
        if (player.currentTime >= trimEnd - 0.01) {
            if (loopInput.checked && trimEnd > trimStart) { player.currentTime = trimStart; player.play().catch(() => {}); }
            else { stop(); player.currentTime = trimStart; }
        }
    });
    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (player.paused) {
            if (player.currentTime < trimStart || player.currentTime >= trimEnd) player.currentTime = trimStart;
            player.play().catch(() => {});
        } else stop();
    };
    backdrop.querySelector(".mmx-wave-wrap").addEventListener("click", (e) => {
        if (e.target.classList.contains("mmx-trim-handle")) return;
        const rect = e.currentTarget.getBoundingClientRect();
        player.currentTime = Math.max(0, Math.min(duration, (e.clientX - rect.left) / Math.max(1, rect.width) * duration));
    });
    const bindHandle = (handle, side) => {
        handle.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            const wrap = backdrop.querySelector(".mmx-wave-wrap");
            const rect = wrap.getBoundingClientRect();
            const move = (ev) => {
                const value = Math.max(0, Math.min(duration, (ev.clientX - rect.left) / Math.max(1, rect.width) * duration));
                if (side === "left") trimStart = Math.min(value, trimEnd);
                else trimEnd = Math.max(value, trimStart);
                sync();
            };
            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up, { once: true });
        });
    };
    bindHandle(selection.querySelector(".left"), "left");
    bindHandle(selection.querySelector(".right"), "right");
    const applyInputs = () => {
        trimStart = Number(startInput.value);
        trimEnd = Number(endInput.value);
        if (!Number.isFinite(trimStart)) trimStart = 0;
        if (!Number.isFinite(trimEnd)) trimEnd = duration;
        sync();
    };
    startInput.onchange = applyInputs;
    endInput.onchange = applyInputs;
    backdrop.querySelector("button.reset").onclick = () => { trimStart = 0; trimEnd = duration; sync(); player.currentTime = 0; };
    const close = () => { stop(); player.src = ""; context?.close?.(); backdrop.remove(); };
    backdrop.querySelector("button.cancel").onclick = close;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("button.save").onclick = () => {
        setAudioRole(timeline, scope, audio.id, { sourceDuration: duration, trimStart, trimEnd }, options);
        const updated = getAudioRole(timeline, scope, audio.id, options);
        const placement = audioPlacement(updated, segmentSec);
        commit(editor, node);
        close();
        if (placement.overrun > 0) window.alert?.(w.overrun);
        schedule(node);
    };
}

function decorateCard(card, ctx) {
    const { timeline, scope, audio, options, editor, node, segmentSec } = ctx;
    if (!card || !audio?.id) return;
    const binding = `${options.global ? "g" : "s"}:${scope}:${audio.id}`;
    if (card.dataset[CARD_BOUND] === binding && card.querySelector(".mmx-audio-role-select")) return;
    card.querySelectorAll(":scope > .mmx-audio-role-select,:scope > .mmx-audio-edit-btn,:scope > .mmx-audio-role-meta").forEach((el) => el.remove());
    card.dataset[CARD_BOUND] = binding;
    const cfg = getAudioRole(timeline, scope, audio.id, options);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "mmx-audio-edit-btn";
    edit.textContent = "✎";
    edit.title = words().edit;
    edit.addEventListener("pointerdown", (e) => e.stopPropagation());
    edit.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openAudioEditor(ctx); });
    card.appendChild(edit);

    const select = document.createElement("select");
    select.className = "mmx-audio-role-select";
    roleOptions(select, cfg.role);
    for (const event of ["click", "pointerdown"]) select.addEventListener(event, (e) => e.stopPropagation());
    select.addEventListener("change", (e) => {
        e.stopPropagation();
        const current = getAudioRole(timeline, scope, audio.id, options);
        const patch = { role: select.value };
        if (select.value !== AUDIO_ROLE_REFERENCE && Number(current.timelineStart) === 0) {
            const suggested = nextDriveStart(timeline, scope, audio.id, ctx.audios, segmentSec, options);
            const dur = effectiveAudioDuration(current);
            if (suggested > 0 && suggested + dur <= segmentSec + 0.0005) patch.timelineStart = suggested;
        }
        setAudioRole(timeline, scope, audio.id, patch, options);
        if (select.value !== AUDIO_ROLE_REFERENCE) forceGeneratedAudio(editor);
        commit(editor, node);
        schedule(node);
    });
    card.appendChild(select);

    const meta = document.createElement("div");
    meta.className = "mmx-audio-role-meta";
    meta.innerHTML = `<span class="mmx-audio-duration"></span>`;
    const durationEl = meta.querySelector(".mmx-audio-duration");
    if (Number(cfg.sourceDuration) > 0) durationEl.textContent = `${Number(cfg.sourceDuration).toFixed(2)}s`;
    card.appendChild(meta);
    discoverDuration(audio, timeline, scope, options, editor, node, (duration) => { durationEl.textContent = `${Number(duration).toFixed(2)}s`; schedule(node); });
}

function createCommonRoleRows(host, ctx, commonAudios) {
    let wrap = host.querySelector(":scope > .mmx-audio-common-roles");
    if (!commonAudios.length) { wrap?.remove(); return; }
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "mmx-audio-common-roles"; host.appendChild(wrap); }
    wrap.innerHTML = "";
    for (const audio of commonAudios) {
        const row = document.createElement("div");
        row.className = "mmx-audio-common-row";
        const name = document.createElement("span");
        name.textContent = `${words().common} · ${basename(audio.item)}`;
        const select = document.createElement("select");
        select.className = "mmx-audio-role-select";
        roleOptions(select, getAudioRole(ctx.timeline, ctx.scope, audio.id, ctx.options).role);
        select.onchange = () => {
            const current = getAudioRole(ctx.timeline, ctx.scope, audio.id, ctx.options);
            const patch = { role: select.value };
            if (select.value !== AUDIO_ROLE_REFERENCE && Number(current.timelineStart) === 0) {
                const suggested = nextDriveStart(ctx.timeline, ctx.scope, audio.id, ctx.audios, ctx.segmentSec, ctx.options);
                const dur = effectiveAudioDuration(current);
                if (suggested > 0 && suggested + dur <= ctx.segmentSec + 0.0005) patch.timelineStart = suggested;
            }
            setAudioRole(ctx.timeline, ctx.scope, audio.id, patch, ctx.options);
            if (select.value !== AUDIO_ROLE_REFERENCE) forceGeneratedAudio(ctx.editor);
            commit(ctx.editor, ctx.node); schedule(ctx.node);
        };
        const edit = document.createElement("button");
        edit.type = "button"; edit.className = "mmx-audio-edit-btn"; edit.textContent = "✎"; edit.title = words().edit;
        edit.onclick = (e) => { e.stopPropagation(); openAudioEditor({ ...ctx, audio }); };
        row.append(name, select, edit);
        wrap.appendChild(row);
        discoverDuration(audio, ctx.timeline, ctx.scope, ctx.options, ctx.editor, ctx.node, () => schedule(ctx.node));
    }
}

function renderTimeline(host, ctx) {
    if (!host) return;
    let panel = host.querySelector(`:scope > .${PANEL_CLASS}`);
    if (!panel) { panel = document.createElement("div"); panel.className = PANEL_CLASS; host.appendChild(panel); }
    const rows = activeItems(ctx.timeline, ctx.scope, ctx.audios, ctx.options)
        .filter((r) => r.role === AUDIO_ROLE_AUDIO_DRIVE || r.role === AUDIO_ROLE_DIALOGUE_DRIVE);
    if (!rows.length) { panel.hidden = true; return; }
    panel.hidden = false;
    const validation = validateAudioRoleIntervals(rows, ctx.segmentSec);
    const invalid = new Set();
    for (const error of validation.errors) {
        if (error.assetId) invalid.add(error.assetId);
        for (const id of error.assetIds || []) invalid.add(id);
    }
    const warning = validation.errors.some((e) => e.code === "drive_overlap") ? words().overlap
        : validation.errors.some((e) => e.code === "overrun") ? words().overrun : "";
    panel.innerHTML = `<div class="mmx-audio-timeline-head"><b>${words().timeline}</b><span class="mmx-audio-timeline-warning"></span></div><div class="mmx-audio-axis"></div><div class="mmx-audio-tracks"></div>`;
    panel.querySelector(".mmx-audio-timeline-warning").textContent = warning;
    const axis = panel.querySelector(".mmx-audio-axis");
    for (const ratio of [0, .25, .5, .75, 1]) {
        const span = document.createElement("span"); span.style.left = `${ratio * 100}%`; span.textContent = `${(ctx.segmentSec * ratio).toFixed(ratio === 0 || ratio === 1 ? 2 : 1)}s`; axis.appendChild(span);
    }
    const tracks = panel.querySelector(".mmx-audio-tracks");
    tracks.style.height = `${Math.max(30, rows.length * 28 + 4)}px`;
    rows.sort((a, b) => a.timelineStart - b.timelineStart || a.assetId.localeCompare(b.assetId));
    rows.forEach((row, track) => {
        const p = audioPlacement(row, ctx.segmentSec);
        const audio = ctx.audios.find((a) => a.id === row.assetId);
        const block = document.createElement("div");
        block.className = `mmx-audio-drive-block${invalid.has(row.assetId) ? " invalid" : ""}`;
        block.dataset.role = row.role;
        block.style.left = `${Math.max(0, Math.min(100, p.leftRatio * 100))}%`;
        block.style.width = `${Math.max(1.5, Math.min(100, p.widthRatio * 100))}%`;
        block.style.top = `${3 + track * 28}px`;
        block.innerHTML = `<span>${basename(audio?.item, row.assetId)}</span><span class="time">${p.start.toFixed(2)}–${p.end.toFixed(2)}s</span>`;
        block.title = `${basename(audio?.item)} · ${p.start.toFixed(3)} → ${p.end.toFixed(3)}s`;
        block.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            const rect = tracks.getBoundingClientRect();
            const initial = getAudioRole(ctx.timeline, ctx.scope, row.assetId, ctx.options);
            const startX = e.clientX;
            block.setPointerCapture?.(e.pointerId);
            const move = (ev) => {
                const deltaSec = (ev.clientX - startX) / Math.max(1, rect.width) * ctx.segmentSec;
                const moved = moveAudioRole(initial, Number(initial.timelineStart) + deltaSec, ctx.segmentSec);
                const placement = audioPlacement(moved, ctx.segmentSec);
                block.style.left = `${placement.leftRatio * 100}%`;
                block.querySelector(".time").textContent = `${placement.start.toFixed(2)}–${placement.end.toFixed(2)}s`;
                block._mmxPending = moved;
            };
            const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                const moved = block._mmxPending;
                delete block._mmxPending;
                if (moved) {
                    setAudioRole(ctx.timeline, ctx.scope, row.assetId, moved, ctx.options);
                    forceGeneratedAudio(ctx.editor);
                    commit(ctx.editor, ctx.node);
                    schedule(ctx.node);
                }
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up, { once: true });
        });
        tracks.appendChild(block);
    });
}

function r2vAudioList(timeline, segment) {
    return effectiveReferenceAssets(timeline.r2vCommon || {}, segment)
        .filter((a) => a.kind === "audio" && !a.paired && a.assetId && (a.item?.audioFile || a.item?.fileName))
        .map((a) => ({ id: String(a.assetId), tag: String(a.effectiveTag || a.officialTag || ""), item: a.item, common: a.origin === "common" || a.source === "common" }));
}

function rv2vAudioList(target) {
    return (target?.refAudios || []).filter((a) => a?.audioFile || a?.fileName).map((item, order) => {
        const slot = Number(item.index ?? item.slot ?? order);
        return { id: String(item.assetId || item.asset_id || ""), tag: `<Audio ${slot + 1}>`, item, slot };
    }).filter((a) => a.id);
}

function syncR2v(editor, node) {
    const timeline = editor.timeline;
    ensureR2vReferenceAssetSchema(timeline);
    ensureAudioRoleState(timeline);
    let changed = false;
    const cards = editor.batchPanel?.querySelectorAll?.('.bd-batch-card[data-segment-index]') || [];
    for (const card of cards) {
        const index = Number(card.dataset.segmentIndex);
        const segment = timeline.segments?.[index];
        if (!segment) continue;
        if (index !== Number(editor.selectedIndex || 0)) {
            card.querySelectorAll(".mmx-audio-role-select,.mmx-audio-edit-btn,.mmx-audio-role-meta,.mmx-audio-common-roles,.mmx-audio-role-panel").forEach((el) => el.remove());
            card.querySelectorAll(".bd-batch-audio").forEach((el) => delete el.dataset[CARD_BOUND]);
            continue;
        }
        const scope = audioRoleScopeKey(segment, index);
        const audios = r2vAudioList(timeline, segment);
        const knownAudioIds = allKnownReferenceAssets(timeline.r2vCommon || {}, segment)
            .filter((a) => a.kind === "audio" && !a.paired && a.assetId)
            .map((a) => String(a.assetId));
        if (clearStaleAudioRoles(timeline, scope, knownAudioIds)) changed = true;
        const sec = segmentDuration(editor, segment);
        const options = { global: false };
        const ctx = { timeline, scope, audios, options, editor, node, segmentSec: sec };
        const localCards = Array.from(card.querySelectorAll(".bd-batch-audio"));
        localCards.forEach((audioCard, slot) => {
            const local = (segment.refAudios || []).find((r) => Number(r.index ?? r.slot) === slot);
            if (!local?.assetId && !local?.asset_id) return;
            const audio = audios.find((a) => a.id === String(local.assetId || local.asset_id));
            if (audio) decorateCard(audioCard, { ...ctx, audio });
        });
        const audioSection = card.querySelector(".bd-batch-audios")?.parentElement;
        if (audioSection) {
            const localIds = new Set((segment.refAudios || []).map((r) => String(r.assetId || r.asset_id || "")));
            createCommonRoleRows(audioSection, ctx, audios.filter((a) => !localIds.has(a.id)));
            renderTimeline(audioSection, ctx);
        }
    }
    if (changed) commit(editor, node);
    return changed;
}

function syncRv2v(editor, node) {
    const timeline = editor.timeline;
    ensureReferenceAssetSchema(timeline);
    ensureAudioRoleState(timeline);
    const global = !!editor.isGlobalMode?.();
    const index = Number(editor.selectedIndex) || 0;
    const segment = timeline.segments?.[index];
    const target = global ? timeline.global : segment;
    if (!target) return false;
    const scope = global ? "global" : audioRoleScopeKey(segment, index);
    const options = { global };
    const audios = rv2vAudioList(target);
    const stale = clearStaleAudioRoles(timeline, scope, audios.map((a) => a.id), options);
    const host = editor.root?.querySelector?.(global ? '[data-r="global-ref-audios-wrap"]' : '[data-r="seg-ref-audios-wrap"]');
    if (!host) return stale;
    const sec = segmentDuration(editor, segment, { global });
    const ctx = { timeline, scope, audios, options, editor, node, segmentSec: sec };
    const cards = Array.from(host.querySelectorAll(".bd-ref-audio"));
    cards.forEach((card, slot) => {
        const item = (target.refAudios || []).find((r) => Number(r.index ?? r.slot) === slot);
        if (!item?.audioFile && !item?.fileName) return;
        const audio = audios.find((a) => a.id === String(item.assetId || item.asset_id || ""));
        if (audio) decorateCard(card, { ...ctx, audio });
    });
    renderTimeline(host, ctx);
    if (stale) commit(editor, node);
    return stale;
}

function syncAudioRoleUi(node) {
    const editor = node?._minimaxEditor;
    if (!editor?.timeline || !editor?.root) return false;
    ensureStyle();
    let changed = cleanOldDriveOutput(editor);
    const key = taskKey(editor);
    if (key === "r2v") changed = syncR2v(editor, node) || changed;
    else if (key === "rv2v") changed = syncRv2v(editor, node) || changed;
    else editor.root.querySelectorAll(`.${PANEL_CLASS},.mmx-audio-common-roles`).forEach((el) => el.remove());
    return changed;
}

function schedule(node) {
    for (const delay of [0, 80, 250, 800]) setTimeout(() => syncAudioRoleUi(node), delay);
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
        syncAudioRoleUi(this);
        return result;
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.AudioRoles",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === DIRECTOR_CLASS) wrap(nodeType);
    },
});
