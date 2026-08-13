// Portions derived from ComfyUI_MiniMaxH3_Director
// Copyright AIMixer and contributors
// Originally licensed under Apache License 2.0
// Modified for MiniMax H3 Motion Director, 2026-08-09
// This derivative project is distributed under GPL-3.0.
// See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

/** Multi prompt-group UI for t2i / i2i / r2i / t2v / i2v / r2v (prompt batch mode). */

import { api } from "../../scripts/api.js";
import {
    DEFAULT_ASPECT_RATIO,
    DEFAULT_MEGAPIXELS,
    defaultDurationSec,
    defaultFrameCount,
    durationToClampedMiniMaxFrames,
    durationToMiniMaxFrames,
    framesToDurationSec,
    imageBatchVariant,
    isVideoBatchTask,
    MAX_GEN_FRAMES,
    MAX_REFERENCE_AUDIOS,
    MAX_REFERENCE_IMAGES,
    MAX_REFERENCE_VIDEOS,
    maxDurationSec,
    MINIMAX_CANVAS_MULTIPLE,
    minDurationSec,
    minFrameCount,
    newBatchSegment,
    preferredDurationSecFromFrames,
    refAudioLabel,
    refImageLabel,
    refVideoLabel,
    resolveTaskKey,
    roundDurationSec,
    sumFrameCounts,
} from "./minimax_gen_timeline.js";
import { wirePromptImageMentions } from "./minimax_prompt_mentions.js";
import {
    allKnownReferenceAssets,
    ensureR2vReferenceAssetSchema,
    ensureReferenceAssetSchema,
    moveReferenceAssetSlot,
    referenceAssetStates,
    replaceReferenceAssetAtSlot,
    setCommonAssetEnabled,
} from "./minimax_reference_assets.mjs";
import { syncR2vCommonToggleForTask } from "./minimax_r2v_common_ui.mjs";
import {
    formatR2vAssetStatusLabel,
    mountR2vCommonSelection,
    mountR2vMediaLayout,
} from "./minimax_r2v_reference_ui.mjs";
import {
    buildR2vCommonSections,
    createR2vCommonPopover,
    renderR2vCommonSections,
} from "./minimax_r2v_common_popover.mjs";
import { t } from "./minimax_i18n.js";

const _players = new WeakMap();
/** r2v picture grid: 9 slots in 3×3; reveal 3 → 6 → 9. */
const R2V_PICTURE_SLOTS = MAX_REFERENCE_IMAGES;
const R2V_PICTURE_STEP = 3;
let _activeR2vMedia = null;

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

export function formatMediaDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "--:--";
    const total = Math.max(0, Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function pauseActiveR2vMedia(except = null) {
    if (_activeR2vMedia && _activeR2vMedia !== except) {
        try {
            _activeR2vMedia.pause();
        } catch (_) { /* ignore */ }
        const btn = _activeR2vMedia._r2vPlayBtn;
        if (btn) btn.textContent = "▶";
    }
    if (_activeR2vMedia !== except) _activeR2vMedia = null;
}

export function bindR2vMediaPlayback(mediaEl, playBtn, progressWrap = null) {
    mediaEl.classList.add("bd-r2v-media");
    mediaEl._r2vPlayBtn = playBtn;
    const fill = progressWrap?.querySelector?.(".bd-r2v-progress-fill");
    const syncBtn = () => {
        playBtn.textContent = mediaEl.paused ? "▶" : "⏸";
    };
    const syncProgress = () => {
        if (!progressWrap || !fill) return;
        const dur = mediaEl.duration;
        const pct = Number.isFinite(dur) && dur > 0
            ? Math.min(100, Math.max(0, (mediaEl.currentTime / dur) * 100))
            : 0;
        fill.style.width = `${pct}%`;
        progressWrap.classList.toggle("active", !mediaEl.paused);
        progressWrap.classList.toggle("playing", !mediaEl.paused);
    };
    playBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mediaEl.paused) {
            pauseActiveR2vMedia(mediaEl);
            mediaEl.play().catch(() => {});
            _activeR2vMedia = mediaEl;
        } else {
            mediaEl.pause();
            if (_activeR2vMedia === mediaEl) _activeR2vMedia = null;
        }
        syncBtn();
        syncProgress();
    });
    mediaEl.addEventListener("play", () => {
        pauseActiveR2vMedia(mediaEl);
        _activeR2vMedia = mediaEl;
        syncBtn();
        syncProgress();
    });
    mediaEl.addEventListener("pause", () => {
        syncBtn();
        syncProgress();
    });
    mediaEl.addEventListener("timeupdate", syncProgress);
    mediaEl.addEventListener("ended", () => {
        if (_activeR2vMedia === mediaEl) _activeR2vMedia = null;
        mediaEl.currentTime = 0;
        syncBtn();
        syncProgress();
        progressWrap?.classList.remove("active", "playing");
        if (fill) fill.style.width = "0%";
    });
    if (progressWrap && fill) {
        progressWrap.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dur = mediaEl.duration;
            if (!Number.isFinite(dur) || dur <= 0) return;
            const rect = progressWrap.getBoundingClientRect();
            const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
            mediaEl.currentTime = Math.min(dur, Math.max(0, ratio * dur));
            syncProgress();
        });
    }
}

export function wireMediaDuration(mediaEl, durEl, onReady) {
    const apply = () => {
        if (!Number.isFinite(mediaEl.duration) || mediaEl.duration === Infinity) return;
        durEl.textContent = formatMediaDuration(mediaEl.duration);
        onReady?.(mediaEl.duration);
    };
    mediaEl.addEventListener("loadedmetadata", apply);
    if (mediaEl.readyState >= 1) apply();
}

/**
 * User-facing seconds (1 decimal). durationSec is the source of truth when set;
 * only fall back to frames for legacy rows that never stored durationSec.
 */
function resolveSegmentDurationSec(seg, defFc) {
    if (seg.durationSec != null && Number.isFinite(Number(seg.durationSec))) {
        const { durationSec } = durationToClampedMiniMaxFrames(seg.durationSec, 24);
        return durationSec;
    }
    const fc = parseInt(seg.frameCount ?? seg.length ?? seg._videoFrameCount ?? defFc, 10) || defFc;
    return preferredDurationSecFromFrames(fc, 24);
}

/** Apply seconds to a segment by index (avoids stale closures after normalize). */
function applyBatchSegmentDuration(editor, index, rawSec) {
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    const seg = editor.timeline.segments?.[index];
    if (!seg || !isVideoBatchTask(taskKey)) return null;
    const clamped = clamp(
        Number(rawSec) || defaultDurationSec(taskKey),
        minDurationSec(),
        maxDurationSec(),
    );
    const { frames, durationSec } = durationToClampedMiniMaxFrames(clamped, 24);
    seg.durationSec = durationSec;
    seg.frameCount = frames;
    seg.length = frames;
    seg._videoFrameCount = frames;
    // Stale drag preview must not override batch totals.
    if (editor._previewSegments) editor._previewSegments = null;
    normalizeImageBatchSegments(editor);
    return editor.timeline.segments[index] || null;
}

/** Flush visible 秒数 inputs into segments before a full card re-render. */
function flushBatchDurationInputs(editor) {
    const list = editor?.batchList;
    if (!list) return;
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    if (!isVideoBatchTask(taskKey)) return;
    for (const input of list.querySelectorAll("input[data-batch-sec-index]")) {
        const index = parseInt(input.getAttribute("data-batch-sec-index"), 10);
        if (!Number.isFinite(index)) continue;
        clearTimeout(input._t);
        input._t = null;
        const displayed = parseFloat(input.value);
        if (!Number.isFinite(displayed)) continue;
        const seg = editor.timeline.segments?.[index];
        const current = Number(seg?.durationSec);
        // Skip if already in sync (avoid churn while typing the same committed value).
        if (seg && Number.isFinite(current) && roundDurationSec(displayed) === roundDurationSec(current)
            && input !== document.activeElement) {
            continue;
        }
        applyBatchSegmentDuration(editor, index, displayed);
    }
}

function formatPreviewFps(value) {
    const fps = Math.round(Number(value) * 100) / 100;
    if (Number.isInteger(fps)) return String(fps);
    return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function stopPlayer(el) {
    const st = _players.get(el);
    if (!st) return;
    st.playing = false;
    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }
}

function stopAllPlayers(root) {
    root?.querySelectorAll(".bd-batch-vpreview")?.forEach((wrap) => stopPlayer(wrap));
    pauseActiveR2vMedia(null);
    root?.querySelectorAll("video.bd-r2v-media, audio.bd-r2v-media")?.forEach((m) => {
        try { m.pause(); } catch (_) { /* ignore */ }
    });
}

export const IMAGE_BATCH_STYLES = `
.bd-btn.bd-disabled,.bd-btn:disabled{opacity:.38;cursor:not-allowed;pointer-events:none}
.bd-mode button.bd-disabled,.bd-mode button:disabled{opacity:.38;cursor:not-allowed;pointer-events:none}
.bd-batch{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px}
.bd-batch-i2v-notice{display:none;color:#ffb74d;background:#3a2a12;border:1px solid #a67c00;border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.5}
.bd-batch-i2v-notice.visible{display:block}
.bd-batch-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bd-batch-run-select.active{background:#1a3a2a;color:#4fff8f;border-color:#4fff8f}
.bd-batch-run-all{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#aaa;cursor:pointer;user-select:none}
.bd-batch-run-all.hidden{display:none!important}
.bd-batch-run-all input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f}
/* max-height must stay in sync with BATCH_LIST_MAX_H in getImageBatchUiHeight(). */
.bd-batch-list{display:flex;flex-direction:column;gap:8px;width:100%;max-height:640px;overflow-y:auto;padding-right:2px}
.bd-context-link-row{display:flex;align-items:center;justify-content:center;gap:6px;min-height:28px;margin:-2px 0;color:#aaa}
.bd-context-link-line{height:1px;flex:1 1 auto;max-width:140px;background:#343434}
.bd-context-link-toggle,.bd-context-link-advanced-btn{border:1px solid #4a4a4a;border-radius:999px;background:#171717;color:#aaa;cursor:pointer;font-size:11px;line-height:1;padding:6px 10px}
.bd-context-link-toggle[data-mode="both"],.bd-context-link-toggle[data-mode="visual"],.bd-context-link-toggle[data-mode="audio"]{border-color:#4fff8f;color:#4fff8f;background:#163723}
.bd-context-link-toggle[data-mode="off"]{border-color:#555;color:#aaa;background:#252525}
.bd-context-link-advanced{display:none;align-items:center;gap:10px;padding:5px 9px;border:1px solid #333;border-radius:7px;background:#111;font-size:10px;color:#ccc}
.bd-context-link-row.advanced-open .bd-context-link-advanced{display:flex}
.bd-context-link-advanced label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}.bd-context-link-advanced input{accent-color:#4fff8f}
.bd-r2v-common-toggle.hidden,.bd-r2v-common-popover[hidden]{display:none!important}
.bd-r2v-common-popover{position:fixed;z-index:150;box-sizing:border-box;max-width:calc(100vw - 32px);overflow-y:auto;padding:14px;border:1px solid #46644f;border-radius:12px;background:linear-gradient(165deg,#172019 0%,#131713 58%,#101210 100%);box-shadow:0 18px 54px rgba(0,0,0,.65)}
.bd-r2v-common-popover-title{margin:0 0 12px;color:#f0f5f1;font-size:14px;font-weight:700}
.bd-r2v-common-popover-body{display:flex;flex-direction:column;gap:12px}
.bd-r2v-common-popover-section{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid #2d3b31;border-radius:10px;background:#0c100d}
.bd-r2v-common-popover-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#eaeaea;font-size:11px}
.bd-r2v-common-popover-section-head span{color:#7f9485;font-variant-numeric:tabular-nums}
.bd-r2v-common-popover-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px}
.bd-r2v-common-popover-asset{min-width:0}
.bd-r2v-common-popover-add{min-height:86px;border:1px dashed #46644f;border-radius:8px;background:#101711;color:#9dc9aa;cursor:pointer;font-size:11px}
.bd-r2v-common-popover-add:hover{border-color:#65a879;background:#152019;color:#d7f3df}
.bd-batch-card{background:linear-gradient(165deg,#1a1a1a 0%,#141414 55%,#111 100%);border:1px solid #2c2c2c;border-radius:10px;padding:12px 14px;display:grid;gap:10px;align-items:stretch;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
/* t2v: 提示词为主，预览收成右侧窄栏 */
.bd-batch-card.bd-batch-plain{grid-template-columns:minmax(0,1fr) minmax(132px,168px)}
/* i2v / r2i: 源图或参考 | 提示词 | 窄预览 */
.bd-batch-card.bd-batch-source,.bd-batch-card.bd-batch-refs:not(.bd-batch-r2v){grid-template-columns:auto minmax(0,1fr) minmax(132px,168px)}
.bd-batch-plain .bd-batch-head,.bd-batch-source .bd-batch-head,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-head{padding-bottom:2px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:2px}
.bd-batch-plain .bd-batch-head b,.bd-batch-source .bd-batch-head b,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-head b{color:#f0f0f0;font-size:12px;font-weight:650}
.bd-batch-plain .bd-batch-prompts,.bd-batch-source .bd-batch-prompts,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-prompts{background:#0c0c0c;border:1px solid #262626;border-radius:10px;padding:10px 12px;gap:6px}
.bd-batch-plain .bd-batch-prompts .bd-label,.bd-batch-source .bd-batch-prompts .bd-label,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-prompts .bd-label{color:#eaeaea;font-size:11px;font-weight:700;letter-spacing:.02em}
.bd-batch-plain .bd-batch-prompts textarea,.bd-batch-source .bd-batch-prompts textarea,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-prompts textarea{background:#101010;border-color:#2e2e2e;border-radius:8px;padding:10px;font-size:12px;line-height:1.45}
.bd-batch-plain .bd-batch-preview,.bd-batch-source .bd-batch-preview,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-preview{border-radius:10px;border-color:#262626;background:#0c0c0c}
/* ——— r2v asset stage (polished) ——— */
.bd-batch-card.bd-batch-r2v{display:flex;flex-direction:column;gap:12px;padding:14px 16px;background:linear-gradient(165deg,#1c1c1c 0%,#141414 52%,#111 100%);border:1px solid #2c2c2c;border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035);align-items:stretch}
.bd-r2v-common-select{display:flex;flex-direction:column;gap:7px;padding:9px 10px;border:1px solid #333;border-radius:8px;background:#121512}
.bd-r2v-common-select-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#aaa;font-size:11px;font-weight:650}
.bd-r2v-common-actions{display:flex;gap:6px}.bd-r2v-common-actions button{font-size:10px;padding:2px 7px}
.bd-r2v-common-items{display:flex;flex-wrap:wrap;gap:6px 10px}.bd-r2v-common-item{display:flex;align-items:center;gap:5px;color:#ccc;font-size:10px;max-width:190px}.bd-r2v-common-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-r2v-local-title{color:#8f9a92;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:-4px}
.bd-r2v-paired-audio{border:1px solid #4d5d51;background:#182019;color:#9fe0ad;border-radius:5px;padding:1px 5px;font-size:10px;cursor:pointer}
.bd-batch-card.running{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.25)}
.bd-batch-card.done{border-color:#3a5080}
.bd-batch-card.run-skipped{opacity:.42}
/* selected / run-on must win over .done so timeline ↔ card selection stays visible */
.bd-batch-card.selected,.bd-batch-card.selected.done{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-batch-card.run-on:not(.run-skipped){border-color:#3a7a55}
.bd-batch-card.selected.run-on,.bd-batch-card.selected.run-on.done{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.4)}
.bd-batch-head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.bd-batch-r2v .bd-batch-head{padding-bottom:2px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:2px}
.bd-batch-head b{color:#ccc;font-size:11px}
.bd-batch-r2v .bd-batch-head b{color:#f0f0f0;font-size:13px;font-weight:650;letter-spacing:.02em}
.bd-batch-run-check{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f;flex-shrink:0}
.bd-batch-head-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bd-batch-material-status{grid-column:1/-1;color:#8fd6ff;background:#102531;border:1px solid #28556a;border-radius:7px;padding:6px 9px;font-size:11px;line-height:1.35}
.bd-batch-material-status.required{color:#ffbd72;background:#332313;border-color:#725027}
.bd-batch-fc{display:flex;align-items:center;gap:6px;color:#aaa;font-size:12px}
.bd-batch-r2v .bd-batch-fc{color:#c8c8c8;font-size:12px;gap:8px;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:8px;padding:5px 10px}
.bd-batch-fc input{width:72px;background:#181818;border:1px solid #444;border-radius:5px;color:#eee;padding:5px 8px;font-size:13px}
.bd-batch-r2v .bd-batch-fc input{width:76px;background:#161616;border-color:#3a3a3a;border-radius:6px;padding:5px 8px;font-size:13px}
.bd-batch-del{background:transparent;border:1px solid #553;color:#f88;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer}
.bd-batch-r2v .bd-batch-del{border-radius:8px;padding:5px 10px;font-size:11px;border-color:#4a3030;color:#f0a0a0}
.bd-batch-del:hover{background:#3a1515}
.bd-batch-media{display:flex;flex-direction:column;gap:4px;min-width:88px;max-width:120px}
/* Left = assets (narrower) · Right = prompt + preview (wider) */
.bd-batch-r2v-body{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(0,1.4fr);gap:12px;width:100%;align-items:stretch}
.bd-batch-r2v-assets{display:flex;flex-direction:column;gap:10px;min-width:0}
.bd-batch-r2v-main{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
.bd-r2v-section{background:#0c0c0c;border:1px solid #262626;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0;box-sizing:border-box}
.bd-r2v-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.bd-r2v-section-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#eaeaea}
.bd-r2v-section-count{font-size:11px;color:#7d7d7d;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.bd-batch-src{width:88px;height:88px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;color:#666;font-size:9px;text-align:center;padding:4px;box-sizing:border-box}
.bd-batch-src.has-img{border-style:solid;border-color:#444}
.bd-batch-src img{width:100%;height:100%;object-fit:contain;background:#000}
.bd-batch-refs{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;width:108px}
.bd-batch-r2v .bd-batch-refs{grid-template-columns:repeat(3,minmax(0,1fr));width:100%;max-width:none;gap:6px}
.bd-batch-r2v .bd-batch-ref.bd-r2v-pic-hidden{display:none!important}
.bd-r2v-pics-toggle{align-self:stretch;margin-top:2px;background:transparent;border:1px dashed #333;border-radius:8px;color:#9a9a9a;font-size:11px;padding:6px 8px;cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.bd-r2v-pics-toggle:hover{border-color:#555;color:#ddd;background:#121212}
.bd-batch-ref{position:relative;aspect-ratio:1;border:1px dashed #555;border-radius:3px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;font-size:8px;color:#666}
.bd-batch-r2v .bd-batch-ref{aspect-ratio:1;min-height:0;border-radius:8px;border:1px dashed #333;background:#080808;color:#555;font-size:10px;transition:border-color .15s,background .15s,transform .12s}
.bd-batch-r2v .bd-batch-ref:hover{border-color:#5a5a5a;background:#101010}
.bd-batch-ref.has-img{border-style:solid}
.bd-batch-r2v .bd-batch-ref.has-img{border-color:#3a3a3a;background:#000}
.bd-batch-ref img{width:100%;height:100%;object-fit:cover}
.bd-batch-r2v .bd-batch-ref img{width:100%;height:100%;object-fit:contain;object-position:center;background:#000}
.bd-batch-r2v .bd-batch-ref .dot{position:absolute;left:6px;top:6px;width:7px;height:7px;border-radius:50%;background:#4fff8f;box-shadow:0 0 0 2px rgba(0,0,0,.5);z-index:2}
.bd-batch-r2v .bd-batch-ref .cap{position:absolute;left:0;right:0;bottom:0;padding:14px 6px 5px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.78));color:#ddd;font-size:10px;font-weight:600;text-align:center;pointer-events:none;z-index:2}
.bd-batch-r2v .bd-batch-ref:not(.has-img) .cap{position:static;padding:0;background:none;color:#666;font-weight:500}
.bd-batch-ref .x{position:absolute;top:0;right:2px;color:#f88;font-size:10px;display:none;line-height:1}
.bd-batch-r2v .bd-batch-ref .x{top:4px;right:4px;width:20px;height:20px;border-radius:6px;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);color:#ff9a9a;font-size:14px;font-weight:700;z-index:3}
.bd-batch-ref:hover .x{display:block}
.bd-batch-r2v .bd-batch-ref:hover .x,.bd-batch-r2v .bd-batch-ref:focus-within .x{display:flex}
.bd-batch-media-block{display:flex;flex-direction:column;gap:4px;min-width:0}
.bd-batch-media-block .bd-label{color:#888;font-size:10px}
.bd-batch-audios,.bd-batch-videos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;width:100%;max-width:420px}
.bd-batch-r2v .bd-batch-videos,.bd-batch-r2v .bd-batch-audios{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));max-width:none;gap:7px;width:100%}
.bd-batch-audio,.bd-batch-video{position:relative;min-height:44px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;padding:6px 4px;box-sizing:border-box;font-size:9px;color:#666;text-align:center;line-height:1.25}
.bd-batch-r2v .bd-batch-audio,.bd-batch-r2v .bd-batch-video{min-height:0;height:auto;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:6px;padding:6px;border-radius:8px;border:1px dashed #333;background:#080808;text-align:left;font-size:11px;color:#777;transition:border-color .15s,background .15s}
.bd-batch-r2v .bd-batch-audio:hover,.bd-batch-r2v .bd-batch-video:hover{border-color:#555;background:#101010}
.bd-batch-audio.has-audio,.bd-batch-video.has-video{border-style:solid;border-color:#4a6a4a;color:#cfe;background:#152015}
.bd-batch-r2v .bd-batch-audio.has-audio,.bd-batch-r2v .bd-batch-video.has-video{border-color:#2f4a38;background:#101812;color:#d8ebe0}
.bd-batch-audio:hover,.bd-batch-video:hover{border-color:#7a9cff}
.bd-r2v-thumb{position:relative;width:38px;height:38px;border-radius:7px;background:#1a1a1a;border:1px solid #2e2e2e;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;overflow:hidden}
.bd-batch-r2v .bd-batch-video .bd-r2v-thumb,.bd-r2v-thumb-video{width:100%;height:auto;aspect-ratio:16/9;border-radius:6px}
.bd-batch-r2v .bd-batch-audio .bd-r2v-thumb{width:100%;height:44px;border-radius:6px}
.bd-r2v-thumb-video video{width:100%;height:100%;object-fit:cover;display:block;background:#000;pointer-events:none}
.bd-r2v-play{position:absolute;inset:0;margin:auto;width:28px;height:28px;border:0;border-radius:50%;background:rgba(0,0,0,.62);color:#fff;font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2}
.bd-r2v-play:hover{background:rgba(20,20,20,.82);color:#4fff8f}
.bd-batch-r2v .has-audio .bd-r2v-thumb,.bd-batch-r2v .has-video .bd-r2v-thumb{border-color:#3a5a45;color:#8fdfb0;background:#152018}
.bd-r2v-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.bd-batch-r2v .bd-batch-video .bd-r2v-meta,.bd-batch-r2v .bd-batch-audio .bd-r2v-meta{flex-direction:row;align-items:center;justify-content:space-between;gap:4px}
.bd-r2v-meta .tag{color:#cfcfcf;font-size:11px;font-weight:650}
.bd-r2v-dur{flex-shrink:0;min-width:2.6em;text-align:right;font-size:11px;color:#8a9;font-variant-numeric:tabular-nums}
.bd-r2v-paired-audio{flex-shrink:0;color:#7dbaff;font-size:12px;line-height:1;padding:0 2px}
.bd-batch-r2v .bd-batch-audio .name,.bd-batch-r2v .bd-batch-video .name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8aa;font-size:10px;padding:0}
.bd-batch-r2v .bd-batch-video.has-video .name,.bd-batch-r2v .bd-batch-audio.has-audio .name{display:none}
.bd-batch-r2v .bd-batch-video:not(.has-video) .name,.bd-batch-r2v .bd-batch-audio:not(.has-audio) .name{display:block;color:#666}
.bd-batch-r2v .bd-batch-audio audio.bd-r2v-media{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.bd-r2v-progress{display:none;width:100%;height:3px;border-radius:99px;background:#222;overflow:hidden;cursor:pointer}
.bd-r2v-progress.active{display:block}
.bd-r2v-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#2a6b4a,#4fff8f);border-radius:99px;transition:width .08s linear}
.bd-r2v-progress.playing .bd-r2v-progress-fill{transition:none}
.bd-batch-audio .name,.bd-batch-video .name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ad;font-size:9px;padding:0 2px}
.bd-batch-audio .x,.bd-batch-video .x{position:absolute;top:1px;right:3px;color:#f88;font-size:12px;display:none;line-height:1}
.bd-batch-r2v .bd-batch-audio .x,.bd-batch-r2v .bd-batch-video .x{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:6px;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);color:#ff9a9a;font-size:14px;font-weight:700;z-index:3}
.bd-batch-audio:hover .x,.bd-batch-video:hover .x{display:block}
.bd-batch-r2v .bd-batch-audio:hover .x,.bd-batch-r2v .bd-batch-video:hover .x{display:flex}
.bd-batch-prompts{display:flex;flex-direction:column;gap:4px;min-width:0}
.bd-batch-prompts .bd-label{color:#888;font-size:10px}
.bd-batch-r2v .bd-batch-prompts{background:#0c0c0c;border:1px solid #262626;border-radius:10px;padding:10px 12px;gap:6px;flex:1 1 auto;min-height:260px;display:flex;flex-direction:column}
.bd-batch-r2v .bd-batch-prompts .bd-label{color:#eaeaea;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.bd-batch-prompts textarea{width:100%;min-height:88px;background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:6px;resize:vertical;font-size:11px;box-sizing:border-box;font-family:inherit;line-height:1.35}
.bd-batch-plain .bd-batch-prompts textarea,.bd-batch-source .bd-batch-prompts textarea{min-height:120px;height:100%;resize:vertical}
.bd-batch-r2v .bd-batch-prompts textarea{min-height:240px;height:100%;flex:1;resize:vertical;background:#101010;border-color:#2e2e2e;border-radius:8px;padding:10px;font-size:12px;line-height:1.45}
.bd-batch-preview{background:#0d0d0d;border:1px solid #333;border-radius:4px;min-height:100px;display:flex;flex-direction:column;align-items:stretch;justify-content:center;overflow:hidden;color:#555;font-size:10px;text-align:center;padding:4px;box-sizing:border-box}
.bd-batch-plain .bd-batch-preview,.bd-batch-source .bd-batch-preview,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-preview{width:100%;max-width:220px;min-height:160px;justify-self:end}
.bd-batch-r2v .bd-batch-preview{min-height:220px;flex:0 0 auto;height:auto;border-radius:10px;border-color:#262626;background:#0c0c0c;padding:8px;font-size:11px;color:#666}
.bd-batch-preview img{width:100%;max-width:100%;max-height:200px;object-fit:contain;display:block;margin:0 auto}
.bd-batch-plain .bd-batch-preview img,.bd-batch-source .bd-batch-preview img{max-height:180px}
.bd-batch-r2v .bd-batch-preview img{width:100%;max-height:280px}
.bd-batch-vpreview{width:100%;height:100%;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-height:0}
.bd-batch-vpreview canvas{width:100%;flex:1 1 auto;min-height:96px;max-height:200px;background:#000;border-radius:3px;display:block;object-fit:contain}
.bd-batch-r2v .bd-batch-vpreview canvas{border-radius:8px;max-height:280px;min-height:160px}
.bd-batch-plain .bd-batch-vpreview canvas,.bd-batch-source .bd-batch-vpreview canvas{max-height:180px;min-height:96px}
.bd-batch-vpreview-ctrl{display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0}
.bd-batch-vpreview-ctrl button{font-size:10px;padding:2px 8px}
.bd-batch-vpreview-meta{color:#666;font-size:9px;text-align:center;flex-shrink:0}
.bd-batch-live-preview{position:relative;width:100%;min-height:160px;flex:1 1 auto;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.bd-batch-r2v .bd-batch-live-preview{min-height:200px}
.bd-batch-live-preview img{width:100%;height:auto;max-width:100%;max-height:280px;object-fit:contain;display:block;border-radius:6px}
.bd-batch-r2v .bd-batch-live-preview img{max-height:280px}
.bd-batch-live-badge{position:absolute;left:8px;bottom:8px;padding:2px 7px;border-radius:999px;background:rgba(0,0,0,.72);color:#cfcfcf;font-size:10px;pointer-events:none}
@media(max-width:860px){
.bd-batch-r2v-body,.bd-batch-r2v-foot{grid-template-columns:1fr}
.bd-batch-r2v .bd-batch-preview{min-height:160px}
.bd-batch-card.bd-batch-plain{grid-template-columns:minmax(0,1fr) minmax(140px,180px)}
.bd-batch-card.bd-batch-source,.bd-batch-card.bd-batch-refs:not(.bd-batch-r2v){grid-template-columns:auto minmax(0,1fr) minmax(140px,180px)}
}
@media(max-width:720px){
.bd-batch-card,.bd-batch-card.bd-batch-plain,.bd-batch-card.bd-batch-source,.bd-batch-card.bd-batch-refs:not(.bd-batch-r2v){grid-template-columns:1fr}
.bd-batch-plain .bd-batch-preview,.bd-batch-source .bd-batch-preview,.bd-batch-refs:not(.bd-batch-r2v) .bd-batch-preview{max-width:none;justify-self:stretch;min-height:140px}
.bd-batch-r2v .bd-batch-refs{grid-template-columns:repeat(3,minmax(0,1fr))}
}
`;

const BATCH_CHUNK_SIZE = 8 * 1024 * 1024;
const BATCH_UPLOAD_SOFT_LIMIT = 95 * 1024 * 1024;

async function uploadImage(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "true");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) throw new Error(await resp.text() || `Upload failed (${resp.status})`);
    return resp.json();
}

async function uploadChunked(file) {
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / BATCH_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
        const start = i * BATCH_CHUNK_SIZE;
        const end = Math.min(start + BATCH_CHUNK_SIZE, file.size);
        const body = new FormData();
        body.append("upload_id", uploadId);
        body.append("chunk_index", String(i));
        body.append("total_chunks", String(totalChunks));
        body.append("filename", file.name);
        body.append("chunk", file.slice(start, end), `${file.name}.part`);
        const resp = await api.fetchApi("/minimax/motion-director/upload_chunk", { method: "POST", body });
        if (!resp.ok) throw new Error(await resp.text() || t("upload.chunkFailed", { status: resp.status }));
        const data = await resp.json();
        if (data.name) return data;
    }
    throw new Error(t("upload.chunkIncomplete"));
}

async function uploadMedia(file) {
    if (file.size <= BATCH_UPLOAD_SOFT_LIMIT) {
        try {
            return await uploadImage(file);
        } catch (err) {
            const msg = String(err?.message || err || "");
            if (!/too large|size|413/i.test(msg)) throw err;
        }
    }
    return uploadChunked(file);
}

function relPath(upload) {
    const name = upload.name || upload.filename;
    const sub = (upload.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
    return sub ? `${sub}/${name}` : name;
}

function viewUrl(imageFile) {
    const norm = String(imageFile || "").replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    const filename = slash >= 0 ? norm.slice(slash + 1) : norm;
    const subfolder = slash >= 0 ? norm.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

export function mountImageBatchPanel(root) {
    const panel = document.createElement("div");
    panel.className = "bd-batch hidden";
    panel.dataset.r = "batch-panel";
    panel.innerHTML = `
        <div class="bd-batch-toolbar">
            <button type="button" class="bd-btn bd-btn-primary" data-a="batch-add" data-i18n="batch.addPromptGroup">+ 添加提示词组</button>
            <button type="button" class="bd-btn bd-batch-run-select hidden" data-a="batch-run-select" data-i18n="toolbar.runSelect" data-i18n-title="tooltip.batchRunSelect">选择运行</button>
            <label class="bd-batch-run-all hidden" data-r="batch-run-all-wrap" data-i18n-title="tooltip.runSelectAll">
                <input type="checkbox" data-r="batch-run-all-cb">
                <span data-i18n="toolbar.selectAll">全选</span>
            </label>
            <span class="bd-meta" data-r="batch-hint" data-i18n="batch.hint.defaultImage">每组生成 1 张图片</span>
        </div>
        <div class="bd-batch-i2v-notice" data-r="batch-i2v-notice"></div>
        <div class="bd-batch-list" data-r="batch-list"></div>`;
    root.appendChild(panel);
    return {
        panel,
        list: panel.querySelector('[data-r="batch-list"]'),
        hint: panel.querySelector('[data-r="batch-hint"]'),
        i2vNotice: panel.querySelector('[data-r="batch-i2v-notice"]'),
        addBtn: panel.querySelector('[data-a="batch-add"]'),
        runSelectBtn: panel.querySelector('[data-a="batch-run-select"]'),
        runSelectAllWrap: panel.querySelector('[data-r="batch-run-all-wrap"]'),
        runSelectAllCb: panel.querySelector('[data-r="batch-run-all-cb"]'),
    };
}

export function wireBatchRunSelectControls(editor, batchUi) {
    editor.batchRunSelectBtn = batchUi.runSelectBtn;
    editor.batchRunSelectAllWrap = batchUi.runSelectAllWrap;
    editor.batchRunSelectAllCb = batchUi.runSelectAllCb;
    batchUi.runSelectBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        editor.toggleRunSelectMode?.();
    });
    batchUi.runSelectAllCb?.addEventListener("change", (e) => {
        e.stopPropagation();
        if (!editor.isRunSelectEnabled?.()) return;
        editor.setRunSelectionAll?.(batchUi.runSelectAllCb.checked);
    });
    if (editor.r2vCommonToggle && editor._directorOverlayLayer) {
        editor._r2vCommonPopover?.destroy?.();
        editor._r2vCommonPopover = createR2vCommonPopover({
            anchor: editor.r2vCommonToggle,
            overlayLayer: editor._directorOverlayLayer,
            onRender: (body) => renderR2vCommonPopoverContent(body, editor),
            onOpenChange: (expanded) => {
                syncR2vCommonToggleForTask(editor.r2vCommonToggle, {
                    taskKey: editor.getTaskKey?.(),
                    expanded,
                    label: t("batch.r2v.commonReferences"),
                    expandTitle: t("tooltip.r2vCommonExpand"),
                    collapseTitle: t("tooltip.r2vCommonCollapse"),
                });
            },
        });
        editor.r2vCommonToggle.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            editor._r2vCommonPopover?.toggle();
        });
    }
}

function cloneRefs(refs) {
    if (!Array.isArray(refs) || !refs.length) return [];
    try {
        return JSON.parse(JSON.stringify(refs));
    } catch {
        return refs.map((r) => ({ ...r }));
    }
}

/** Legacy R2I-only migration. R2V Common is never copied into Local. */
export function migrateGlobalRefsIntoBatchSegments(editor, taskKey) {
    const key = resolveTaskKey(taskKey || editor.getTaskKey?.() || "");
    // R2V Common lives in timeline.r2vCommon and must never be copied Local.
    if (key !== "r2i") return false;
    const globalRefs = editor.timeline?.global?.refs;
    if (!Array.isArray(globalRefs) || !globalRefs.length) return false;
    let moved = false;
    for (const seg of editor.timeline.segments || []) {
        if ((seg.refs || []).length) continue;
        seg.refs = cloneRefs(globalRefs);
        moved = true;
    }
    return moved;
}

export function ensureImageBatchTimeline(editor) {
    editor.timeline.editMode = "segment";
    editor.timeline.output = editor.timeline.output || {};
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    editor.timeline.output.mode = "fixed";
    if (!editor.timeline.output.aspectRatio) editor.timeline.output.aspectRatio = DEFAULT_ASPECT_RATIO;
    if (editor.timeline.output.megapixels == null) editor.timeline.output.megapixels = DEFAULT_MEGAPIXELS;
    if (editor.timeline.output.multiple == null) editor.timeline.output.multiple = MINIMAX_CANVAS_MULTIPLE;
    if (!isVideoBatchTask(taskKey)) {
        editor.timeline.output.exportMode = "all";
    }
    const defFc = defaultFrameCount(taskKey);
    if (taskKey === "i2v") {
        editor.timeline.video = {
            fileName: "",
            videoFile: "",
            subfolder: "",
            type: "input",
            frames: [],
            frameMap: [],
        };
        editor.timeline.videoClips = [];
    }
    if (!editor.timeline.segments?.length) {
        editor.timeline.segments = [newBatchSegment({ durationSec: defaultDurationSec(taskKey) })];
    }
    // Legacy R2I keeps its historical per-group migration. R2V is intentionally excluded.
    migrateGlobalRefsIntoBatchSegments(editor, taskKey);
    for (const seg of editor.timeline.segments) {
        if (isVideoBatchTask(taskKey)) {
            const { frames, durationSec } = durationToClampedMiniMaxFrames(
                resolveSegmentDurationSec(seg, defFc),
                24,
            );
            seg.durationSec = durationSec;
            seg.frameCount = frames;
            seg.length = frames;
            seg._videoFrameCount = frames;
        } else {
            const prevFc = parseInt(seg.frameCount ?? seg.length, 10) || 0;
            if (prevFc > 1) seg._videoFrameCount = prevFc;
            seg.frameCount = 1;
            seg.length = 1;
        }
        seg.negativePrompt = seg.negativePrompt ?? "";
        seg.genImage = seg.genImage || { imageFile: seg.imageFile || "" };
        // Do NOT clear refs for i2v — backend ignores them, but wiping here breaks
        // r2v → i2v → r2v (user loses uploaded reference images).
        seg.refs = seg.refs || [];
        seg.refAudios = seg.refAudios || seg.ref_audios || [];
        seg.refVideos = seg.refVideos || seg.ref_videos || [];
        seg.previewB64 = seg.previewB64 || "";
        seg.previewFrames = seg.previewFrames || [];
        seg.previewFps = seg.previewFps || parseFloat(editor.frameRateWidget?.value || 24);
        if (!seg.id) seg.id = newBatchSegment().id;
    }
    if (taskKey === "r2v") ensureR2vReferenceAssetSchema(editor.timeline);
    else ensureReferenceAssetSchema(editor.timeline);
    normalizeImageBatchSegments(editor);
}

export function normalizeImageBatchSegments(editor) {
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    const isVideo = isVideoBatchTask(taskKey);
    const defFc = defaultFrameCount(taskKey);
    const defSec = defaultDurationSec(taskKey);
    let start = 0;
    const fixed = [];
    for (const seg of editor.timeline.segments) {
        let fc = 1;
        let durationSec;
        if (isVideo) {
            const resolved = durationToClampedMiniMaxFrames(
                clamp(resolveSegmentDurationSec(seg, defFc) || defSec, minDurationSec(), maxDurationSec()),
                24,
            );
            fc = resolved.frames;
            durationSec = resolved.durationSec;
        }
        fixed.push({
            ...seg,
            start,
            length: fc,
            frameCount: fc,
            ...(isVideo ? { durationSec } : {}),
            negativePrompt: seg.negativePrompt ?? "",
            genImage: seg.genImage || { imageFile: "" },
            refs: seg.refs || [],
            refAudios: seg.refAudios || [],
            refVideos: seg.refVideos || [],
            _videoFrameCount: isVideo ? fc : seg._videoFrameCount,
            previewB64: seg.previewB64 || "",
            previewFrames: seg.previewFrames || [],
            previewFps: seg.previewFps || parseFloat(editor.frameRateWidget?.value || 24),
        });
        start += fc;
    }
    if (!fixed.length) fixed.push(newBatchSegment({ durationSec: defSec }));
    editor.timeline.segments = fixed;
    if (taskKey === "r2v") ensureR2vReferenceAssetSchema(editor.timeline);
    else ensureReferenceAssetSchema(editor.timeline);
    editor.timeline.totalFrames = start || fixed[0].frameCount;
}

export function addImageBatchGroup(editor) {
    if (editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.()) return;
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    editor.timeline.segments.push(newBatchSegment({
        durationSec: defaultDurationSec(taskKey),
        negativePrompt: "",
        useCommonAssets: true,
        excludedCommonAssetIds: [],
    }));
    normalizeImageBatchSegments(editor);
    editor.selectedIndex = Math.max(0, editor.timeline.segments.length - 1);
    commitBatchMutation(editor, { segmentStructureChanged: true });
    editor.updateVideoNameLabel?.();
    editor.updateDomWidgetHeight?.();
}

export function deleteImageBatchGroup(editor, index) {
    if (editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.()) return;
    if (editor.timeline.segments.length <= 1) return;
    editor.timeline.segments.splice(index, 1);
    normalizeImageBatchSegments(editor);
    editor.selectedIndex = clamp(
        editor.selectedIndex > index ? editor.selectedIndex - 1 : editor.selectedIndex,
        0,
        editor.timeline.segments.length - 1,
    );
    commitBatchMutation(editor, { segmentStructureChanged: true });
    editor.updateVideoNameLabel?.();
    editor.updateDomWidgetHeight?.();
}

function pickFile(accept, onFile) {
    // Keep input in DOM until change/cancel — otherwise some Chromium builds
    // drop the dialog result when the element is GC'd.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    const cleanup = () => {
        input.remove();
    };
    input.onchange = () => {
        const file = input.files?.[0];
        cleanup();
        if (file) onFile(file);
    };
    input.addEventListener("cancel", cleanup);
    document.body.appendChild(input);
    input.click();
}

async function uploadSegSource(editor, index) {
    const segId = editor.timeline.segments[index]?.id;
    pickFile("image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif", async (file) => {
        try {
            if (!file?.type?.startsWith("image/") && !/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name || "")) {
                throw new Error("Not an image file");
            }
            const uploaded = await uploadImage(file);
            const imageFile = relPath(uploaded);
            if (!imageFile) throw new Error("Upload returned empty filename");
            // Resolve by id — normalize may replace segment object references.
            const seg = (editor.timeline.segments || []).find((s) => s.id === segId)
                || editor.timeline.segments[index];
            if (!seg) return;
            // Write genImage immediately so UI updates even if dimension probe fails/hangs.
            seg.genImage = { imageFile, width: 0, height: 0 };
            seg.imageFile = imageFile;
            editor.updateOutputPreview?.();
            commitBatchMutation(editor);
            try {
                const dims = await readImageDimensions(file);
                const live = (editor.timeline.segments || []).find((s) => s.id === seg.id) || seg;
                if (live.genImage?.imageFile === imageFile) {
                    live.genImage = { imageFile, width: dims.width, height: dims.height };
                    editor.updateOutputPreview?.();
                    editor.scheduleTimelineSync?.();
                }
            } catch (dimErr) {
                console.warn("[MiniMax H3 Motion Director] batch source dims skipped:", dimErr);
            }
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] batch source upload failed:", err);
            alert(t("upload.alertFailed", { err: err?.message || err }));
        }
    });
}

function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const done = (fn, arg) => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            fn(arg);
        };
        const timer = setTimeout(() => done(reject, new Error("Image dimension timeout")), 8000);
        img.onload = () => done(resolve, { width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => done(reject, new Error("Failed to read image dimensions"));
        img.src = url;
    });
}

function batchAssetTarget(editor, index) {
    if (Number(index) === -1) {
        editor.timeline.r2vCommon = editor.timeline.r2vCommon || { refs: [], refVideos: [], refAudios: [] };
        return editor.timeline.r2vCommon;
    }
    return editor.timeline.segments?.[index] || null;
}

function ensureBatchAssetSchema(editor) {
    if (resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value) === "r2v") {
        ensureR2vReferenceAssetSchema(editor.timeline);
    } else {
        ensureReferenceAssetSchema(editor.timeline);
    }
}

function commitBatchMutation(editor, { segmentStructureChanged = false } = {}) {
    ensureBatchAssetSchema(editor);
    if (segmentStructureChanged && editor.commitSegmentStructureMutation) {
        editor.commitSegmentStructureMutation(true);
    } else {
        editor.commit(true, { syncTimeline: true });
    }
    editor.renderImageBatchGroups();
}

async function assignSegRefFromFile(editor, index, slot, file) {
    if (!file?.type?.startsWith("image/")) return;
    try {
        const uploaded = await uploadImage(file);
        const seg = batchAssetTarget(editor, index);
        if (!seg) return;
        replaceReferenceAssetAtSlot(seg, "refs", slot, {
            imageFile: relPath(uploaded), imageB64: "",
        });
        commitBatchMutation(editor);
    } catch (err) {
        console.error("[MiniMax H3 Motion Director] batch ref upload failed:", err);
    }
}

async function uploadSegRef(editor, index, slot) {
    pickFile("image/*", (file) => assignSegRefFromFile(editor, index, slot, file));
}

function moveBatchRefSlot(editor, segIndex, fromSlot, toSlot) {
    if (fromSlot === toSlot) return;
    const seg = batchAssetTarget(editor, segIndex);
    if (!seg) return;
    if (!moveReferenceAssetSlot(seg, "refs", fromSlot, toSlot)) return;
    commitBatchMutation(editor);
}

function bindBatchRefDrop(slot, editor, index, slotIndex) {
    const hasImg = slot.classList.contains("has-img");
    slot.draggable = hasImg;
    slot.addEventListener("dragstart", (e) => {
        if (!hasImg) {
            e.preventDefault();
            return;
        }
        editor._batchRefDragMoved = false;
        const payload = JSON.stringify({ segIndex: index, from: slotIndex });
        e.dataTransfer.setData("application/x-minimax-ref-slot", payload);
        e.dataTransfer.setData("text/plain", payload);
        e.dataTransfer.effectAllowed = "move";
    });
    slot.addEventListener("dragend", () => {
        setTimeout(() => { editor._batchRefDragMoved = false; }, 0);
    });
    slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const types = [...(e.dataTransfer?.types || [])];
        e.dataTransfer.dropEffect = types.includes("application/x-minimax-ref-slot")
            ? "move"
            : "copy";
    });
    slot.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const raw = e.dataTransfer.getData("application/x-minimax-ref-slot")
            || e.dataTransfer.getData("text/plain");
        if (raw) {
            try {
                const data = JSON.parse(raw);
                if (Number(data.segIndex) !== index) return;
                editor._batchRefDragMoved = true;
                moveBatchRefSlot(editor, index, Number(data.from), slotIndex);
                return;
            } catch (_) { /* fall through */ }
        }
        const f = e.dataTransfer.files?.[0];
        if (f) assignSegRefFromFile(editor, index, slotIndex, f);
    });
}

function removeSegRef(editor, index, slot) {
    const seg = batchAssetTarget(editor, index);
    if (!seg) return;
    seg.refs = (seg.refs || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    commitBatchMutation(editor);
}

async function uploadSegAudio(editor, index, slot) {
    pickFile("audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac", async (file) => {
        try {
            const uploaded = await uploadMedia(file);
            const seg = batchAssetTarget(editor, index);
            if (!seg) return;
            replaceReferenceAssetAtSlot(seg, "refAudios", slot, {
                audioFile: relPath(uploaded),
                fileName: uploaded?.name || file.name,
                type: "input",
                subfolder: uploaded?.subfolder || "",
            });
            commitBatchMutation(editor);
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] batch audio upload failed:", err);
            alert(t("upload.refAudioFailed", { err: err?.message || err }));
        }
    });
}

function removeSegAudio(editor, index, slot) {
    const seg = batchAssetTarget(editor, index);
    if (!seg) return;
    seg.refAudios = (seg.refAudios || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    commitBatchMutation(editor);
}

async function uploadSegVideo(editor, index, slot) {
    pickFile("video/*,.mp4,.mov,.webm,.mkv", async (file) => {
        try {
            const uploaded = await uploadMedia(file);
            const seg = batchAssetTarget(editor, index);
            if (!seg) return;
            const videoFile = relPath(uploaded);
            replaceReferenceAssetAtSlot(seg, "refVideos", slot, {
                videoFile,
                fileName: uploaded?.name || file.name,
                type: "input",
                subfolder: uploaded?.subfolder || "",
            });
            commitBatchMutation(editor);
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] batch video upload failed:", err);
            alert(t("upload.refVideoBatchFailed", { err: err?.message || err }));
        }
    });
}

async function uploadSegVideoAudio(editor, index, slot) {
    pickFile("audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac", async (file) => {
        try {
            const uploaded = await uploadMedia(file);
            const target = batchAssetTarget(editor, index);
            const ref = (target?.refVideos || []).find(
                (item) => Number(item.index ?? item.slot) === Number(slot),
            );
            if (!ref) return;
            ref.pairedAudioFile = relPath(uploaded);
            commitBatchMutation(editor);
        } catch (err) {
            console.error("[MiniMax H3 Motion Director] paired video audio upload failed:", err);
            alert(t("upload.refAudioFailed", { err: err?.message || err }));
        }
    });
}

function removeSegVideo(editor, index, slot) {
    const seg = batchAssetTarget(editor, index);
    if (!seg) return;
    seg.refVideos = (seg.refVideos || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    commitBatchMutation(editor);
}

function fileBaseName(path) {
    const s = String(path || "").replace(/\\/g, "/");
    return s.split("/").pop() || s;
}

function countFilledRefs(seg) {
    let imgs = 0;
    let videos = 0;
    let audios = 0;
    for (const r of seg.refs || []) {
        const idx = Number(r.index ?? r.slot);
        if (r?.imageFile && Number.isFinite(idx) && idx >= 0 && idx < R2V_PICTURE_SLOTS) imgs += 1;
    }
    for (const r of seg.refVideos || []) {
        if (r?.videoFile || r?.fileName || r?.previewImageFile || r?.previewImageUrl || r?.linked) {
            videos += 1;
        }
    }
    for (const r of seg.refAudios || []) if (r?.audioFile || r?.fileName) audios += 1;
    return { imgs, videos, audios };
}

function createR2vSection(title, countText) {
    const section = document.createElement("div");
    section.className = "bd-r2v-section";
    const head = document.createElement("div");
    head.className = "bd-r2v-section-head";
    head.innerHTML = `
        <span class="bd-r2v-section-title">${title}</span>
        <span class="bd-r2v-section-count">${countText}</span>`;
    section.appendChild(head);
    return section;
}

function r2vSlotLabel(editor, index, kind, slot, ref, file) {
    const local = Number(index) >= 0;
    if (!ref) {
        return t(local ? `batch.r2v.localSlot.${kind}` : `batch.r2v.commonSlot.${kind}`, { n: slot + 1 });
    }
    const seg = editor.timeline.segments?.[local ? index : editor.selectedIndex] || {
        useCommonAssets: true, excludedCommonAssetIds: [], refs: [], refVideos: [], refAudios: [],
    };
    const asset = referenceAssetStates(editor.timeline.r2vCommon || {}, seg)
        .find((item) => item.kind === kind && item.assetId === ref.assetId);
    const name = fileBaseName(file || ref.imageFile || ref.videoFile || ref.audioFile || ref.fileName || "");
    const fallback = name || t(`batch.r2v.assetKind.${kind}`);
    return asset
        ? formatR2vAssetStatusLabel({ ...asset, name: fallback }, t("batch.r2v.disabled"))
        : fallback;
}

function renderAudioSlot(el, ref, slot, index, editor, { r2v = false } = {}) {
    const label = r2v
        ? r2vSlotLabel(editor, index, "audio", slot, ref, ref?.audioFile || ref?.fileName)
        : refAudioLabel(slot);
    const file = ref?.audioFile || ref?.fileName || "";
    el.className = `bd-batch-audio${file ? " has-audio" : ""}`;
    el.title = file
        ? t("ref.audioTitleFilled", { label, file })
        : t("ref.clickUpload", { label });
    el.innerHTML = "";
    if (r2v) {
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
            audio.src = viewUrl(file);
            audio.className = "bd-r2v-media";
            el.appendChild(audio);
            bindR2vMediaPlayback(audio, playBtn, progress);
            wireMediaDuration(audio, dur, (sec) => {
                if (ref) ref.durationSec = sec;
            });
            const x = document.createElement("span");
            x.className = "x";
            x.textContent = "×";
            x.onclick = (e) => { e.stopPropagation(); removeSegAudio(editor, index, slot); };
            el.appendChild(x);
        } else {
            thumb.textContent = "♪";
            const hint = document.createElement("span");
            hint.className = "name";
            hint.textContent = t("batch.r2v.uploadHint");
            meta.appendChild(hint);
        }
        return;
    }
    if (file) {
        const tag = document.createElement("span");
        tag.textContent = label;
        el.appendChild(tag);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = fileBaseName(file);
        el.appendChild(name);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegAudio(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = t("ref.audioUpload", { label });
    }
}

function renderVideoSlot(el, ref, slot, index, editor, { r2v = false } = {}) {
    const label = r2v
        ? r2vSlotLabel(editor, index, "video", slot, ref, ref?.videoFile || ref?.fileName)
        : refVideoLabel(slot);
    const file = ref?.videoFile || "";
    const posterSrc = ref?.previewImageUrl
        || (ref?.previewImageFile ? viewUrl(ref.previewImageFile) : "");
    const hasMedia = !!(file || posterSrc || ref?.linked);
    const titleFile = file || ref?.fileName || ref?.previewImageFile || "";
    el.className = `bd-batch-video${hasMedia ? " has-video" : ""}`;
    el.title = hasMedia
        ? t("ref.videoTitleFilled", { label, file: titleFile || label })
        : t("ref.videoTitleEmpty", { label });
    el.innerHTML = "";
    if (r2v) {
        const thumb = document.createElement("div");
        thumb.className = "bd-r2v-thumb bd-r2v-thumb-video";
        const meta = document.createElement("div");
        meta.className = "bd-r2v-meta";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = label;
        meta.appendChild(tag);
        if (hasMedia) {
            const audioButton = document.createElement("button");
            audioButton.type = "button";
            audioButton.className = "bd-r2v-paired-audio";
            audioButton.title = ref?.pairedAudioFile
                ? `${t("batch.r2v.pairedAudio")}: ${ref.pairedAudioFile}`
                : t("batch.r2v.addPairedAudio");
            audioButton.textContent = ref?.pairedAudioFile ? "♪" : "+♪";
            audioButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                uploadSegVideoAudio(editor, index, slot);
            };
            meta.appendChild(audioButton);
        }
        el.appendChild(thumb);
        el.appendChild(meta);
        if (file) {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            video.playsInline = true;
            video.src = viewUrl(file);
            video.className = "bd-r2v-media";
            thumb.appendChild(video);
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
            bindR2vMediaPlayback(video, playBtn);
            playBtn.addEventListener("click", () => {
                video.muted = false;
            });
            wireMediaDuration(video, dur, (sec) => {
                if (ref) ref.durationSec = sec;
            });
            video.addEventListener("loadeddata", () => {
                if (video.readyState >= 2 && video.currentTime < 0.05) {
                    try { video.currentTime = Math.min(0.1, (video.duration || 1) * 0.05); } catch (_) { /* ignore */ }
                }
            }, { once: true });
            const x = document.createElement("span");
            x.className = "x";
            x.textContent = "×";
            x.onclick = (e) => { e.stopPropagation(); removeSegVideo(editor, index, slot); };
            el.appendChild(x);
        } else if (posterSrc) {
            // External IMAGE-batch video: show upstream first-frame poster (no file path).
            const img = document.createElement("img");
            img.className = "bd-r2v-media";
            img.src = posterSrc;
            img.alt = label;
            thumb.appendChild(img);
            const hint = document.createElement("span");
            hint.className = "name";
            hint.textContent = t("batch.r2v.externalPoster");
            meta.appendChild(hint);
        } else if (ref?.linked) {
            thumb.textContent = "▶";
            const hint = document.createElement("span");
            hint.className = "name";
            hint.textContent = t("batch.r2v.externalLinked");
            meta.appendChild(hint);
        } else {
            thumb.textContent = "▶";
            const hint = document.createElement("span");
            hint.className = "name";
            hint.textContent = t("batch.r2v.uploadHint");
            meta.appendChild(hint);
        }
        return;
    }
    if (file) {
        const tag = document.createElement("span");
        tag.textContent = label;
        el.appendChild(tag);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = fileBaseName(file);
        el.appendChild(name);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegVideo(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = t("ref.videoUpload", { label });
    }
}

function appendR2vAssetSections(assets, seg, index, editor) {
    const counts = countFilledRefs(seg);

    const imgSection = createR2vSection(
        t("batch.r2v.sectionPictures"),
        `${counts.imgs}/${R2V_PICTURE_SLOTS}`,
    );
    const refs = document.createElement("div");
    refs.className = "bd-batch-refs";
    if (!editor._r2vPicsVisible) editor._r2vPicsVisible = {};
    const segKey = String(seg.id ?? index);
    let highestFilled = -1;
    for (const r of seg.refs || []) {
        const idx = Number(r.index ?? r.slot);
        if (r?.imageFile && Number.isFinite(idx)) highestFilled = Math.max(highestFilled, idx);
    }
    const minVisible = highestFilled >= 0
        ? Math.min(R2V_PICTURE_SLOTS, Math.ceil((highestFilled + 1) / R2V_PICTURE_STEP) * R2V_PICTURE_STEP)
        : R2V_PICTURE_STEP;
    let visible = Number(editor._r2vPicsVisible[segKey]) || R2V_PICTURE_STEP;
    visible = Math.max(R2V_PICTURE_STEP, Math.min(R2V_PICTURE_SLOTS, visible));
    if (visible < minVisible) visible = minVisible;
    editor._r2vPicsVisible[segKey] = visible;

    const applyPicVisibility = () => {
        refs.querySelectorAll(".bd-batch-ref").forEach((el, i) => {
            el.classList.toggle("bd-r2v-pic-hidden", i >= visible);
        });
    };

    for (let i = 0; i < R2V_PICTURE_SLOTS; i++) {
        const ref = (seg.refs || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        slot.className = "bd-batch-ref";
        if (i >= visible) slot.classList.add("bd-r2v-pic-hidden");
        renderR2vRefSlot(slot, ref, i, index, editor);
        slot.onclick = () => {
            if (editor._batchRefDragMoved) {
                editor._batchRefDragMoved = false;
                return;
            }
            uploadSegRef(editor, index, i);
        };
        bindBatchRefDrop(slot, editor, index, i);
        refs.appendChild(slot);
    }
    imgSection.appendChild(refs);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bd-r2v-pics-toggle";
    const syncToggleLabel = () => {
        if (visible < R2V_PICTURE_SLOTS) {
            const next = Math.min(R2V_PICTURE_STEP, R2V_PICTURE_SLOTS - visible);
            toggle.textContent = t("batch.r2v.expandPics", { n: next });
        } else {
            toggle.textContent = t("batch.r2v.collapsePics");
        }
    };
    syncToggleLabel();
    toggle.onclick = (e) => {
        e.stopPropagation();
        if (visible < R2V_PICTURE_SLOTS) {
            visible = Math.min(R2V_PICTURE_SLOTS, visible + R2V_PICTURE_STEP);
        } else {
            visible = Math.max(R2V_PICTURE_STEP, minVisible);
        }
        editor._r2vPicsVisible[segKey] = visible;
        applyPicVisibility();
        syncToggleLabel();
        editor.updateDomWidgetHeight?.();
    };
    imgSection.appendChild(toggle);
    assets.appendChild(imgSection);

    const videoSection = createR2vSection(
        t("batch.r2v.sectionVideos"),
        `${counts.videos}/${MAX_REFERENCE_VIDEOS}`,
    );
    const videos = document.createElement("div");
    videos.className = "bd-batch-videos";
    for (let i = 0; i < MAX_REFERENCE_VIDEOS; i++) {
        const ref = (seg.refVideos || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        renderVideoSlot(slot, ref, i, index, editor, { r2v: true });
        slot.onclick = (e) => {
            if (e.target.closest?.(".bd-r2v-play, .bd-r2v-dur, .bd-r2v-progress, .x, video, audio")) return;
            if (ref && e.target.closest?.(".bd-r2v-thumb")) {
                slot.querySelector(".bd-r2v-play")?.click();
                return;
            }
            uploadSegVideo(editor, index, i);
        };
        videos.appendChild(slot);
    }
    videoSection.appendChild(videos);
    assets.appendChild(videoSection);

    const audioSection = createR2vSection(
        t("batch.r2v.sectionAudios"),
        `${counts.audios}/${MAX_REFERENCE_AUDIOS}`,
    );
    const audios = document.createElement("div");
    audios.className = "bd-batch-audios";
    for (let i = 0; i < MAX_REFERENCE_AUDIOS; i++) {
        const ref = (seg.refAudios || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        renderAudioSlot(slot, ref, i, index, editor, { r2v: true });
        slot.onclick = (e) => {
            if (e.target.closest?.(".bd-r2v-play, .bd-r2v-dur, .bd-r2v-progress, .x, video, audio")) return;
            if (ref && e.target.closest?.(".bd-r2v-thumb")) {
                slot.querySelector(".bd-r2v-play")?.click();
                return;
            }
            uploadSegAudio(editor, index, i);
        };
        audios.appendChild(slot);
    }
    audioSection.appendChild(audios);
    assets.appendChild(audioSection);
}

/**
 * Segment layout: assets on the left, prompt/preview in the returned main column.
 * @returns {HTMLElement} main column for prompt/preview
 */
function appendR2vMediaSections(card, seg, index, editor) {
    const { assets, main } = mountR2vMediaLayout(card);
    appendR2vAssetSections(assets, seg, index, editor);
    return main;
}

function appendCommonSelection(card, editor, seg) {
    const commonAssets = allKnownReferenceAssets(editor.timeline.r2vCommon || {});
    const states = new Map(
        referenceAssetStates(editor.timeline.r2vCommon || {}, seg)
            .map((asset) => [`${asset.kind}:${asset.assetId}`, asset]),
    );
    const displayedAssets = commonAssets.map((asset) => (
        states.get(`${asset.kind}:${asset.assetId}`) || { ...asset, status: "disabled" }
    ));
    mountR2vCommonSelection(card, {
        assets: displayedAssets,
        labels: {
            title: t("batch.r2v.commonAssets"),
            selectAll: t("batch.r2v.selectAll"),
            selectNone: t("batch.r2v.selectNone"),
            empty: t("batch.r2v.commonEmpty"),
            disabled: t("batch.r2v.disabled"),
            kind: (kind) => t(`batch.r2v.assetKind.${kind}`),
        },
        onSelectAll: () => {
            seg.useCommonAssets = true;
            seg.excludedCommonAssetIds = [];
            commitBatchMutation(editor);
        },
        onSelectNone: () => {
            seg.useCommonAssets = false;
            seg.excludedCommonAssetIds = [];
            commitBatchMutation(editor);
        },
        onToggle: (assetId, enabled) => {
            setCommonAssetEnabled(
                seg,
                commonAssets.map((item) => item.assetId),
                assetId,
                enabled,
            );
            commitBatchMutation(editor);
        },
    });
}

function renderR2vCommonPopoverContent(body, editor) {
    const common = editor.timeline.r2vCommon || (editor.timeline.r2vCommon = { refs: [], refVideos: [], refAudios: [] });
    editor._r2vCommonPopover?.setTitle(t("batch.r2v.commonReferences"));
    renderR2vCommonSections(body, buildR2vCommonSections(common), {
        labels: {
            section: (kind) => t("batch.r2v.section" + ({
                picture: "Pictures",
                video: "Videos",
                audio: "Audios",
            })[kind]),
            add: (kind) => t("batch.r2v.addCommon." + kind),
        },
        renderAsset: (section, item, card) => {
            if (section.kind === "picture") {
                card.classList.add("bd-batch-ref");
                renderR2vRefSlot(card, item, item.slot, -1, editor);
                card.onclick = () => uploadSegRef(editor, -1, item.slot);
                bindBatchRefDrop(card, editor, -1, item.slot);
                return;
            }
            if (section.kind === "video") {
                renderVideoSlot(card, item, item.slot, -1, editor, { r2v: true });
                card.onclick = (event) => {
                    if (event.target.closest?.(".bd-r2v-play, .bd-r2v-dur, .bd-r2v-progress, .x, video, audio")) return;
                    if (event.target.closest?.(".bd-r2v-thumb")) {
                        card.querySelector(".bd-r2v-play")?.click();
                        return;
                    }
                    uploadSegVideo(editor, -1, item.slot);
                };
                return;
            }
            renderAudioSlot(card, item, item.slot, -1, editor, { r2v: true });
            card.onclick = (event) => {
                if (event.target.closest?.(".bd-r2v-play, .bd-r2v-dur, .bd-r2v-progress, .x, video, audio")) return;
                if (event.target.closest?.(".bd-r2v-thumb")) {
                    card.querySelector(".bd-r2v-play")?.click();
                    return;
                }
                uploadSegAudio(editor, -1, item.slot);
            };
        },
        onAdd: (section, slot) => {
            if (section.kind === "picture") uploadSegRef(editor, -1, slot);
            else if (section.kind === "video") uploadSegVideo(editor, -1, slot);
            else uploadSegAudio(editor, -1, slot);
        },
    });
}

function renderR2vRefSlot(el, ref, slot, index, editor) {
    const label = r2vSlotLabel(editor, index, "picture", slot, ref, ref?.imageFile);
    const has = !!ref?.imageFile;
    el.classList.toggle("has-img", has);
    el.innerHTML = "";
    el.title = t("ref.clickUploadMove", { label });
    if (has) {
        const img = document.createElement("img");
        img.src = viewUrl(ref.imageFile);
        img.draggable = false;
        el.appendChild(img);
        const dot = document.createElement("span");
        dot.className = "dot";
        el.appendChild(dot);
        const cap = document.createElement("span");
        cap.className = "cap";
        cap.textContent = label;
        el.appendChild(cap);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegRef(editor, index, slot); };
        el.appendChild(x);
    } else {
        const cap = document.createElement("span");
        cap.className = "cap";
        cap.textContent = label;
        el.appendChild(cap);
    }
}

function renderSourceSlot(el, imageFile) {
    el.classList.toggle("has-img", !!imageFile);
    if (imageFile) {
        el.innerHTML = `<img src="${viewUrl(imageFile)}" alt="">`;
    } else {
        el.textContent = t("batch.uploadSource");
    }
}

function renderRefSlot(el, ref, slot, index, editor) {
    const label = refImageLabel(slot);
    el.classList.toggle("has-img", !!ref?.imageFile);
    el.innerHTML = "";
    el.title = t("ref.clickUploadMove", { label });
    if (ref?.imageFile) {
        const img = document.createElement("img");
        img.src = viewUrl(ref.imageFile);
        img.draggable = false;
        el.appendChild(img);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegRef(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = label;
    }
}

function frameSrc(b64) {
    if (!b64) return "";
    return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

function loadFrameImages(frames) {
    return Promise.all(frames.map((b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = frameSrc(b64);
    })));
}

function drawFrame(canvas, img) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !img) return;
    const cw = canvas.clientWidth || 160;
    const ch = canvas.clientHeight || 90;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

function mountLivePreview(el, seg, badgeText) {
    stopPlayer(el);
    el.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bd-batch-live-preview";
    const img = document.createElement("img");
    img.className = "bd-live-preview";
    img.alt = "live preview";
    img.src = frameSrc(seg.previewB64);
    const badge = document.createElement("div");
    badge.className = "bd-batch-live-badge";
    badge.textContent = badgeText || t("batch.generating");
    wrap.appendChild(img);
    wrap.appendChild(badge);
    el.appendChild(wrap);
}

function mountVideoPreview(el, seg, running, fps) {
    stopPlayer(el);
    el.innerHTML = "";
    if (running) {
        if (seg.previewB64) {
            const step = seg.previewStep;
            const total = seg.previewTotalSteps;
            const badge = (step && total)
                ? t("batch.generatingStep", { step, total })
                : t("batch.generating");
            mountLivePreview(el, seg, badge);
            return;
        }
        el.textContent = t("batch.generating");
        return;
    }
    const frames = (seg.previewFrames?.length ? seg.previewFrames : null)
        || (seg.previewB64 ? [seg.previewB64] : null);
    if (!frames?.length) {
        el.textContent = t("batch.previewVideoAfterRun");
        return;
    }
    const wrap = document.createElement("div");
    wrap.className = "bd-batch-vpreview";
    const canvas = document.createElement("canvas");
    canvas.height = 90;
    const ctrl = document.createElement("div");
    ctrl.className = "bd-batch-vpreview-ctrl";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "bd-btn";
    playBtn.textContent = t("batch.play");
    const meta = document.createElement("div");
    meta.className = "bd-batch-vpreview-meta";
    meta.textContent = t("batch.previewMeta", { n: frames.length, fps: formatPreviewFps(fps) });
    ctrl.appendChild(playBtn);
    wrap.appendChild(canvas);
    wrap.appendChild(ctrl);
    wrap.appendChild(meta);
    el.appendChild(wrap);

    const state = { playing: false, timer: null, idx: 0, images: null };
    _players.set(wrap, state);

    loadFrameImages(frames).then((images) => {
        state.images = images;
        drawFrame(canvas, images[0]);
    }).catch(() => {
        meta.textContent = t("batch.previewLoadFailed");
    });

    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (!state.images?.length) return;
        if (state.playing) {
            state.playing = false;
            if (state.timer) clearInterval(state.timer);
            state.timer = null;
            playBtn.textContent = t("batch.play");
            return;
        }
        state.playing = true;
        playBtn.textContent = t("batch.pause");
        const interval = Math.max(20, 1000 / Math.max(1, fps));
        state.timer = setInterval(() => {
            if (!state.images?.length) return;
            state.idx = (state.idx + 1) % state.images.length;
            drawFrame(canvas, state.images[state.idx]);
        }, interval);
    };
}

function renderImagePreview(el, seg, running) {
    stopPlayer(el);
    el.innerHTML = "";
    if (running) {
        if (seg.previewB64) {
            const step = seg.previewStep;
            const total = seg.previewTotalSteps;
            const badge = (step && total)
                ? t("batch.generatingStep", { step, total })
                : t("batch.generating");
            mountLivePreview(el, seg, badge);
            return;
        }
        el.textContent = t("batch.generating");
        return;
    }
    if (seg.previewB64) {
        const img = document.createElement("img");
        img.src = frameSrc(seg.previewB64);
        img.alt = "preview";
        el.appendChild(img);
        return;
    }
    el.textContent = t("batch.previewAfterRun");
}

function renderPreview(el, seg, running, isVideo, fps) {
    if (isVideo) mountVideoPreview(el, seg, running, fps);
    else renderImagePreview(el, seg, running);
}

function buildContextLinkConnector(editor, index) {
    if (index <= 0) return null;
    const row = document.createElement("div");
    row.className = "bd-context-link-row";
    row.dataset.contextBoundary = String(index);
    const left = document.createElement("span");
    left.className = "bd-context-link-line";
    const right = left.cloneNode();
    const link = editor.getSegmentContextLink?.(index) || {};
    const mode = editor.getSegmentContextMode?.(index) || "off";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "bd-context-link-toggle";
    main.dataset.mode = mode;
    main.textContent = ({ both: "↔", visual: "V", audio: "A", off: "×" })[mode] || "×";
    main.title = t(mode === "off" ? "contextLink.connectTooltip" : "contextLink.disconnectTooltip");
    main.setAttribute("aria-pressed", mode === "off" ? "false" : "true");
    main.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        editor.toggleSegmentContextLink?.(index);
    };

    const advancedButton = document.createElement("button");
    advancedButton.type = "button";
    advancedButton.className = "bd-context-link-advanced-btn";
    advancedButton.textContent = "⋯";
    advancedButton.title = t("contextLink.advancedTooltip");
    const advanced = document.createElement("span");
    advanced.className = "bd-context-link-advanced";
    const channel = (name, checked, labelKey) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!checked;
        input.dataset.contextChannel = name;
        input.onchange = (event) => {
            event.stopPropagation();
            const visual = advanced.querySelector('[data-context-channel="visual"]')?.checked;
            const audio = advanced.querySelector('[data-context-channel="audio"]')?.checked;
            editor.setSegmentContextChannels?.(index, { visual, audio });
        };
        label.append(input, document.createTextNode(t(labelKey)));
        return label;
    };
    advanced.append(
        channel("visual", link.visual, "contextLink.visual"),
        channel("audio", link.audio, "contextLink.audio"),
    );
    advancedButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.toggle("advanced-open");
    };
    row.append(left, main, advancedButton, advanced, right);
    return row;
}

export function renderImageBatchGroups(editor) {
    const list = editor.batchList;
    if (!list) return;
    for (const controller of editor._batchPromptMentionControllers || []) controller?.destroy?.();
    editor._batchPromptMentionControllers = [];
    flushBatchDurationInputs(editor);
    stopAllPlayers(list);
    const key = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    const variant = imageBatchVariant(key);
    const isVideo = isVideoBatchTask(key);
    const runningIdx = editor._runHighlightSeg;
    const fps = parseFloat(editor.frameRateWidget?.value || editor.timeline?.frameRate || 24);
    const motionOn = !!editor.isMotionContextEnabled?.();
    const hasI2vSource = (seg) => !!(
        seg?.genImage?.imageFile || seg?.genImage?.imageB64 || seg?.imageFile
    );
    const hasR2vMaterial = (seg) => !!(
        (seg?.refs || []).some((r) => r?.imageFile || r?.imageB64)
        || (seg?.refAudios || []).some((r) => r?.audioFile || r?.fileName)
        || (seg?.refVideos || []).some((r) => (
            r?.videoFile || r?.fileName || r?.previewImageFile
            || r?.previewImageUrl || r?.linked || r?.pairedAudioFile
        ))
    );

    if (editor.batchHint) {
        const hintKey = `batch.hint.${key}`;
        editor.batchHint.textContent = t(hintKey) !== hintKey
            ? t(hintKey)
            : t(isVideo ? "batch.hint.defaultVideo" : "batch.hint.defaultImage");
    }
    const externalLocked = !!(editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.());
    if (editor.batchI2vNotice) {
        const needsRefs = key === "r2i" || key === "r2v";
        const hasAnyMedia = (editor.timeline.segments || []).some((s) => (
            (s.refs || []).some((r) => r?.imageFile)
            || (s.refAudios || []).some((r) => r?.audioFile || r?.fileName)
            || (s.refVideos || []).some((r) => (
                r?.videoFile || r?.fileName || r?.previewImageFile || r?.previewImageUrl || r?.linked
            ))
        ));
        // External graph media may exist as tensors even when UI path sync failed —
        // don't scare users with a false "will degrade to t2v" notice.
        if (needsRefs && !hasAnyMedia && !externalLocked && !motionOn) {
            editor.batchI2vNotice.textContent = t(key === "r2v" ? "batch.notice.r2vNoRefs" : "batch.notice.r2iNoRefs");
            editor.batchI2vNotice.classList.add("visible");
        } else {
            editor.batchI2vNotice.classList.remove("visible");
            editor.batchI2vNotice.textContent = "";
        }
    }
    const addBtn = editor.batchPanel?.querySelector('[data-a="batch-add"]');
    if (addBtn) {
        addBtn.textContent = t(key === "r2v" ? "batch.addRefGroup" : "batch.addPromptGroup");
        addBtn.setAttribute("data-i18n", key === "r2v" ? "batch.addRefGroup" : "batch.addPromptGroup");
        // r2v: add from toolbar (left of task select), like fl2v.
        // External groups: never add UI cards (graph is source of truth).
        addBtn.classList.toggle("hidden", key === "r2v" || externalLocked);
        addBtn.disabled = externalLocked;
    }

    list.innerHTML = "";
    syncR2vCommonToggleForTask(editor.r2vCommonToggle, {
        taskKey: key,
        expanded: !!editor._r2vCommonPopover?.isOpen,
        label: t("batch.r2v.commonReferences"),
        expandTitle: t("tooltip.r2vCommonExpand"),
        collapseTitle: t("tooltip.r2vCommonCollapse"),
    });
    if (key === "r2v") {
        ensureR2vReferenceAssetSchema(editor.timeline);
        if (editor._r2vCommonPopover?.isOpen) editor._r2vCommonPopover.render();
    } else {
        editor._r2vCommonPopover?.close();
    }
    editor.timeline.segments.forEach((seg, index) => {
        const connector = buildContextLinkConnector(editor, index);
        if (connector) list.appendChild(connector);
        const isR2v = key === "r2v";
        const card = document.createElement("div");
        const layoutClass = isR2v
            ? "bd-batch-r2v"
            : (variant === "source" ? "bd-batch-source"
                : (variant === "refs" ? "bd-batch-refs" : "bd-batch-plain"));
        card.className = `bd-batch-card ${layoutClass}`;
        card.dataset.segmentIndex = String(index);
        const runSelectOn = !!(editor.isRunSelectEnabled?.() && editor.supportsRunSelect?.());
        const runEnabled = !runSelectOn || !!editor.isSegmentRunEnabled?.(index);
        // r2v: always show focus selected. t2v/i2v: only run-select participation chrome.
        if (isR2v && index === editor.selectedIndex) card.classList.add("selected");
        if (index === runningIdx) card.classList.add("running");
        if (runSelectOn && runEnabled) card.classList.add("run-on");
        if (runSelectOn && !runEnabled) card.classList.add("run-skipped");
        card.onclick = (e) => {
            if (e.target.closest?.("button, input, textarea, select, .bd-batch-ref, .bd-batch-audio, .bd-batch-video, .bd-batch-src, .bd-r2v-section, .bd-r2v-play, .x, video, audio")) {
                return;
            }
            if (editor.selectedIndex === index) return;
            editor.selectedIndex = index;
            editor._syncR2vCardSelection?.();
            editor.scheduleRender?.();
            editor.updateVideoNameLabel?.();
        };
        const hasPreview = isVideo
            ? (seg.previewFrames?.length > 0 || seg.previewB64)
            : !!seg.previewB64;
        if (hasPreview && index !== runningIdx) card.classList.add("done");

        const head = document.createElement("div");
        head.className = "bd-batch-head";
        // Timeline + cards stay in sync for run-select (incl. r2v).
        if (runSelectOn) {
            const runCb = document.createElement("input");
            runCb.type = "checkbox";
            runCb.className = "bd-batch-run-check";
            runCb.checked = runEnabled;
            runCb.title = t("tooltip.batchRunCheck");
            runCb.onclick = (e) => {
                e.stopPropagation();
                editor.toggleSegmentRun(index);
            };
            head.appendChild(runCb);
        }
        const title = document.createElement("b");
        title.textContent = t(isR2v ? "batch.groupTitle.asset" : "batch.groupTitle.prompt", { n: index + 1 });
        head.appendChild(title);
        const meta = document.createElement("div");
        meta.className = "bd-batch-head-meta";
        if (isVideo) {
            const secRow = document.createElement("label");
            secRow.className = "bd-batch-fc";
            const curSec = resolveSegmentDurationSec(seg, defaultFrameCount(key));
            const { frames, durationSec: syncedSec } = durationToClampedMiniMaxFrames(curSec, 24);
            const playSec = framesToDurationSec(frames, 24);
            seg.durationSec = syncedSec;
            seg.frameCount = frames;
            seg.length = frames;
            seg._videoFrameCount = frames;
            secRow.innerHTML = `${t("batch.seconds")} <input type="number" data-batch-sec-index="${index}" min="${minDurationSec()}" max="${maxDurationSec()}" step="0.1" value="${seg.durationSec}" title="${t("batch.durationTooltip", { frames, play: playSec })}">`;
            const secInput = secRow.querySelector("input");
            const applySec = () => {
                const updated = applyBatchSegmentDuration(editor, index, secInput.value);
                if (!updated) return;
                const play = framesToDurationSec(updated.frameCount, 24);
                secInput.value = String(updated.durationSec);
                secInput.title = t("batch.durationTooltip", {
                    frames: updated.frameCount,
                    play,
                });
                editor.scheduleTimelineSync();
                editor.scheduleRender?.();
                editor.updateVideoNameLabel?.();
                editor.updateOutputPreview?.();
                // Keep total_frames widget in sync with sum of group frames.
                if (editor.totalFramesWidget) {
                    editor.totalFramesWidget.value = sumFrameCounts(editor.timeline.segments);
                }
            };
            if (externalLocked) {
                secInput.readOnly = true;
                secInput.disabled = true;
                secInput.title = t("external.durationLocked");
            } else {
                secInput.onchange = applySec;
                secInput.oninput = () => {
                    clearTimeout(secInput._t);
                    secInput._t = setTimeout(applySec, 200);
                };
                secInput.onblur = () => {
                    clearTimeout(secInput._t);
                    secInput._t = null;
                    applySec();
                };
            }
            meta.appendChild(secRow);
        }
        if (!externalLocked) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "bd-batch-del";
            del.textContent = t("batch.delete");
            del.disabled = editor.timeline.segments.length <= 1;
            del.onclick = (e) => { e.stopPropagation(); deleteImageBatchGroup(editor, index); };
            meta.appendChild(del);
        }
        head.appendChild(meta);
        card.appendChild(head);

        if (isR2v) appendCommonSelection(card, editor, seg);

        if (key === "i2v") {
            const hasExplicitMaterial = hasI2vSource(seg);
            let statusKey = "";
            let required = false;
            if (!hasExplicitMaterial && !motionOn) {
                statusKey = "batch.material.i2vMissing";
                required = true;
            } else if (!hasExplicitMaterial && index === 0) {
                statusKey = "batch.material.i2vRequired";
                required = true;
            } else if (!hasExplicitMaterial && index > 0) {
                statusKey = "batch.material.i2vContinuation";
            }
            if (statusKey) {
                const status = document.createElement("div");
                status.className = `bd-batch-material-status${required ? " required" : ""}`;
                status.textContent = t(statusKey);
                card.appendChild(status);
            }
        }

        if (variant === "source") {
            const media = document.createElement("div");
            media.className = "bd-batch-media";
            const src = document.createElement("div");
            src.className = "bd-batch-src";
            renderSourceSlot(src, seg.genImage?.imageFile);
            src.onclick = () => uploadSegSource(editor, index);
            media.appendChild(src);
            card.appendChild(media);
        }
        let r2vMain = null;
        if (variant === "refs" && isR2v) {
            const localTitle = document.createElement("div");
            localTitle.className = "bd-r2v-local-title";
            localTitle.textContent = t("batch.r2v.localAssets");
            card.appendChild(localTitle);
            r2vMain = appendR2vMediaSections(card, seg, index, editor);
        } else if (variant === "refs") {
            const media = document.createElement("div");
            media.className = "bd-batch-media";
            const refs = document.createElement("div");
            refs.className = "bd-batch-refs";
            for (let i = 0; i < MAX_REFERENCE_IMAGES; i++) {
                const ref = (seg.refs || []).find((r) => Number(r.index ?? r.slot) === i);
                const slot = document.createElement("div");
                slot.className = "bd-batch-ref";
                renderRefSlot(slot, ref, i, index, editor);
                slot.onclick = () => {
                    if (editor._batchRefDragMoved) {
                        editor._batchRefDragMoved = false;
                        return;
                    }
                    uploadSegRef(editor, index, i);
                };
                bindBatchRefDrop(slot, editor, index, i);
                refs.appendChild(slot);
            }
            media.appendChild(refs);
            card.appendChild(media);
        }

        const prompts = document.createElement("div");
        prompts.className = "bd-batch-prompts";
        const ph = t(isR2v ? "placeholder.batchR2v" : "placeholder.batchDefault");
        prompts.innerHTML = `
            <span class="bd-label">${t("batch.prompt")}</span>
            <textarea data-f="prompt" placeholder=""></textarea>`;
        prompts.querySelector("textarea").placeholder = ph;
        prompts.querySelector("textarea").value = seg.prompt || "";
        const promptEl = prompts.querySelector('[data-f="prompt"]');
        const getLiveSeg = () => editor.timeline.segments?.[index] || seg;
        promptEl.oninput = (e) => {
            const liveSeg = getLiveSeg();
            liveSeg.prompt = e.target.value;
            liveSeg.negativePrompt = "";
            editor.scheduleTimelineSync();
        };
        if (isR2v) {
            const controller = wirePromptImageMentions(editor, promptEl, () => {
                const liveSeg = getLiveSeg();
                return {
                    assets: referenceAssetStates(editor.timeline.r2vCommon || {}, liveSeg),
                    refs: liveSeg.refs || [],
                    audios: liveSeg.refAudios || [],
                    videos: liveSeg.refVideos || [],
                };
            }, {
                overlayLayer: editor._directorOverlayLayer,
                onEnableAsset: (item) => {
                    if (item?.source !== "common") return null;
                    const liveSeg = getLiveSeg();
                    const common = editor.timeline.r2vCommon || {};
                    const commonIds = allKnownReferenceAssets(common).map((asset) => asset.assetId);
                    if (!setCommonAssetEnabled(liveSeg, commonIds, item.assetId, true)) return null;
                    // Do not rebuild the prompt editor here. Keep the current DOM,
                    // selection, and mention range alive until the semantic token is
                    // inserted and serialized.
                    return referenceAssetStates(common, liveSeg).find((asset) => (
                        asset.kind === item.kind && asset.assetId === item.assetId
                    ));
                },
                onMentionInserted: (_item, { wasDisabled }) => {
                    if (!wasDisabled) return;
                    // syncTextarea() has already written the semantic token through
                    // promptEl.oninput into the current normalized segment. Commit
                    // both the enabled Common asset and Prompt atomically, but do not
                    // destroy/rebuild the active contenteditable editor.
                    editor.commit(true, { syncTimeline: true });
                },
            });
            if (controller) editor._batchPromptMentionControllers.push(controller);
        }

        const preview = document.createElement("div");
        preview.className = "bd-batch-preview";
        renderPreview(preview, seg, index === runningIdx, isVideo, seg.previewFps || fps);

        if (isR2v && r2vMain) {
            r2vMain.appendChild(prompts);
            r2vMain.appendChild(preview);
        } else {
            card.appendChild(prompts);
            card.appendChild(preview);
        }

        list.appendChild(card);
    });
    // Batch list is scroll-capped; refresh node/widget height after card count changes.
    editor.updateDomWidgetHeight?.();
}

export function setImageBatchPreview(editor, segmentIndex, imageB64, extra = {}) {
    const seg = editor.timeline.segments[segmentIndex];
    if (!seg) return;
    seg.previewB64 = imageB64 || "";
    if (extra.step != null) seg.previewStep = extra.step;
    if (extra.total_steps != null) seg.previewTotalSteps = extra.total_steps;
    if (Array.isArray(extra.frames) && extra.frames.length) {
        seg.previewFrames = extra.frames;
        seg.previewFps = extra.fps || seg.previewFps || 24;
        seg.previewLive = false;
    } else if (imageB64) {
        if (extra.live) {
            // Keep final multi-frame playback until a real final payload arrives.
            if (!Array.isArray(seg.previewFrames) || seg.previewFrames.length <= 1) {
                seg.previewFrames = [imageB64];
            }
            seg.previewLive = true;
        } else {
            seg.previewFrames = [imageB64];
            seg.previewLive = false;
        }
    }

    // Live sampling updates: patch the card preview in-place (avoid full re-render thrash).
    if (extra.live && imageB64) {
        const card = editor.batchList?.querySelector?.(`[data-segment-index="${segmentIndex}"]`);
        const preview = card?.querySelector?.(".bd-batch-preview");
        if (preview) {
            const step = seg.previewStep;
            const total = seg.previewTotalSteps;
            const badgeText = (step && total)
                ? t("batch.generatingStep", { step, total })
                : t("batch.generating");
            let img = preview.querySelector("img.bd-live-preview");
            let badge = preview.querySelector(".bd-batch-live-badge");
            if (!img) {
                mountLivePreview(preview, seg, badgeText);
            } else {
                img.src = frameSrc(imageB64);
                if (badge) badge.textContent = badgeText;
            }
            return;
        }
    }
    editor.renderImageBatchGroups();
}

export function bindImageBatchEvents(editor) {
    editor.batchAddBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        addImageBatchGroup(editor);
    });
}

/** Keep in sync with `.bd-batch-list { max-height: 640px }` above. */
const BATCH_LIST_MAX_H = 640;
const BATCH_LIST_GAP = 8;
const BATCH_TOOLBAR_H = 48;
const BATCH_PANEL_CHROME = 28;

export function getImageBatchUiHeight(editor) {
    const n = Math.max(1, editor?.timeline?.segments?.length || 1);
    const key = resolveTaskKey(editor?.getTaskKey?.() || editor?.taskTypeWidget?.value);
    // r2v cards are tall; list scrolls inside BATCH_LIST_MAX_H — do NOT sum full card
    // heights into node size or the DOM widget grows a huge empty region below.
    const rowH = key === "r2v" ? 420 : (isVideoBatchTask(key) ? 155 : 130);
    const listContentH = n * rowH + Math.max(0, n - 1) * BATCH_LIST_GAP;
    const listH = Math.min(listContentH, BATCH_LIST_MAX_H);
    return BATCH_TOOLBAR_H + BATCH_PANEL_CHROME + listH;
}

export function setToolbarDisabledForBatch(editor, disabled) {
    const btns = [
        editor.btnVideo,
        editor.btnVideoAppend,
        editor.root?.querySelector('[data-a="split"]'),
        editor.root?.querySelector('[data-a="smart-split"]'),
        editor.root?.querySelector('[data-a="equal"]'),
        editor.root?.querySelector('[data-a="del"]'),
        editor.root?.querySelector('[data-a="mode-global"]'),
        editor.root?.querySelector('[data-a="mode-segment"]'),
    ];
    for (const btn of btns) {
        if (!btn) continue;
        // Batch / t2v / i2v: fully hide video-editing controls (not just disable).
        btn.classList.toggle("hidden", disabled);
        btn.disabled = disabled;
        btn.classList.toggle("bd-disabled", disabled);
    }
    if (editor.equalCountInput) {
        editor.equalCountInput.classList.toggle("hidden", disabled);
        editor.equalCountInput.disabled = disabled;
        editor.equalCountInput.classList.toggle("bd-disabled", disabled);
    }
    editor.root?.querySelector('[data-r="equal-n"]')?.classList.toggle("hidden", disabled);
    editor.root?.querySelector(".bd-mode")?.classList.toggle("hidden", disabled);
}

/** r2v: fl2v-like toolbar — timeline visible; add group sits left of task select. */
export function setR2vToolbar(editor, enabled) {
    const hide = [
        editor.btnVideo,
        editor.btnVideoAppend,
        editor.root?.querySelector('[data-a="split"]'),
        editor.root?.querySelector('[data-a="smart-split"]'),
        editor.root?.querySelector('[data-a="equal"]'),
        editor.root?.querySelector('[data-a="mode-global"]'),
        editor.root?.querySelector('[data-a="mode-segment"]'),
    ];
    for (const btn of hide) {
        if (!btn) continue;
        btn.classList.toggle("hidden", enabled);
        btn.disabled = enabled;
        btn.classList.toggle("bd-disabled", enabled);
    }
    if (editor.equalCountInput) {
        editor.equalCountInput.classList.toggle("hidden", enabled);
        editor.equalCountInput.disabled = enabled;
        editor.equalCountInput.classList.toggle("bd-disabled", enabled);
    }
    editor.root?.querySelector('[data-r="equal-n"]')?.classList.toggle("hidden", enabled);
    editor.root?.querySelector(".bd-mode")?.classList.toggle("hidden", enabled);

    const externalLocked = !!(editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.());
    const del = editor.root?.querySelector('[data-a="del"]');
    if (del) {
        if (externalLocked) {
            del.classList.add("hidden");
            del.disabled = true;
        } else {
            del.disabled = false;
            del.classList.remove("bd-disabled", "hidden");
            del.textContent = enabled ? t("toolbar.deleteSelectedGroup") : t("toolbar.deleteSegment");
            del.setAttribute("data-i18n", enabled ? "toolbar.deleteSelectedGroup" : "toolbar.deleteSegment");
            del.setAttribute("data-i18n-title", enabled ? "tooltip.deleteSelectedFl2vGroup" : "tooltip.deleteSegment");
            del.title = enabled
                ? t("tooltip.deleteSelectedFl2vGroup")
                : t("tooltip.deleteSegment");
        }
    }
    const addBtn = editor.root?.querySelector('[data-a="r2v-add-group"]');
    if (addBtn) {
        addBtn.classList.toggle("hidden", !enabled || externalLocked);
        addBtn.disabled = !enabled || externalLocked;
    }
    const batchAdd = editor.batchPanel?.querySelector('[data-a="batch-add"]');
    if (batchAdd) batchAdd.classList.toggle("hidden", enabled || externalLocked);
    updateR2vToolbarBtns(editor);
}

export function updateR2vToolbarBtns(editor) {
    const addBtn = editor?.root?.querySelector?.('[data-a="r2v-add-group"]');
    if (!addBtn) return;
    const externalLocked = !!(editor?.hasExternalI2vGroups?.() || editor?.hasExternalR2vGroups?.());
    const show = !!editor?.isR2vBatch?.() && !externalLocked;
    addBtn.classList.toggle("hidden", !show);
    addBtn.disabled = !show;
    const deleteBtn = editor?.root?.querySelector?.('[data-a="del"]');
    if (deleteBtn && editor?.isR2vBatch?.()) {
        const lastGroup = (editor.timeline?.segments?.length || 0) <= 1;
        deleteBtn.disabled = externalLocked || lastGroup;
        deleteBtn.title = lastGroup ? t("batch.r2v.keepOneGroup") : t("tooltip.deleteSegment");
    }
}
