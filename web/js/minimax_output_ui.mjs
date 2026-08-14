const STYLE_ID = "mmx-output-styles";
const OUTPUT_TEXT = {
    en: {
        live: "Live", segment: "Segment", multi: "Multi Segment", final: "Final Result",
        sampling_result: "Sampling result", generated_segment: "Generated Segment", available_range: "Available generated range",
        final_pipeline: "Final pipeline result", waiting: "Waiting for generated result…", idle: "Idle", play: "▶ Play", pause: "⏸ Pause",
        volume: "Volume", current_run: "Current Run · Idle", task_detail: "Task / Segment / Stage / Step",
        pipeline_status: "Pipeline Status", pipeline_path: "Generation → Global Refine → Assemble → Face Refine → Finalize / Export",
        preview_settings: "Preview Settings", director_preview: "Director Preview", suppressed: "ComfyUI Default Preview: SUPPRESSED",
        final_info: "Final Result Info", not_completed: "Not completed", report: "Report", waiting_report: "Waiting for report…",
        overall_progress: "Overall Progress", stage_progress: "Current Stage Progress",
        preview_frames: "preview_frames", preview_fps: "preview_fps", max_resolution: "max_resolution",
        jpeg_quality: "jpeg_quality", preview_every: "preview_every",
        no_valid: "No valid segments", frame: "Frame", frames: "frames", step: "Step", segment_word: "Segment",
        generation: "Generation", global_refine: "Global Refine", face_refine: "Face Refine", assemble: "Assemble", finalize: "Finalize / Export", upscale: "Upscale",
    },
    zh: {
        live: "实时", segment: "分段", multi: "多段", final: "最终结果",
        sampling_result: "采样成果", generated_segment: "已生成片段", available_range: "当前有效片段范围",
        final_pipeline: "最终管线成果", waiting: "等待模型生成成果…", idle: "待命", play: "▶ 播放", pause: "⏸ 暂停",
        volume: "音量", current_run: "当前运行 · 待命", task_detail: "任务 / 片段 / 阶段 / 步数",
        pipeline_status: "管线状态", pipeline_path: "生成 → 全局精修 → 组合 → 人脸精修 → 最终处理 / 导出",
        preview_settings: "预览设置", director_preview: "Director 预览", suppressed: "ComfyUI 默认采样预览：已抑制",
        final_info: "最终成果信息", not_completed: "尚未完成", report: "报告", waiting_report: "等待报告…",
        overall_progress: "总体进度", stage_progress: "当前阶段进度",
        preview_frames: "预览帧数", preview_fps: "预览帧率", max_resolution: "最大分辨率",
        jpeg_quality: "JPEG 品质", preview_every: "预览间隔",
        no_valid: "没有有效片段", frame: "帧", frames: "帧", step: "步", segment_word: "片段",
        generation: "生成", global_refine: "全局精修", face_refine: "人脸精修", assemble: "组合", finalize: "最终处理 / 导出", upscale: "放大",
    },
};
function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-output{display:grid;grid-template-columns:minmax(0,65fr) minmax(320px,35fr);gap:10px;height:100%;min-height:0}.mmx-output-left,.mmx-output-right{min-width:0;min-height:0}
.mmx-output-left{display:flex;flex-direction:column;gap:7px}.mmx-result-tabs{display:flex;gap:5px}.mmx-result-tabs button{height:29px;min-width:72px;border:1px solid #383838;border-radius:5px;background:#222;color:#aaa}.mmx-result-tabs button.active{border-color:#4fff8f;background:#163723;color:#4fff8f}
.mmx-result-viewer{position:relative;flex:1 1 auto;min-height:260px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #343434;border-radius:8px;background:#0d0d0d}.mmx-result-viewer img,.mmx-result-viewer video{display:block;max-width:100%;max-height:100%;object-fit:contain}.mmx-result-viewer [hidden]{display:none!important}.mmx-result-empty{color:#777;font-size:12px}.mmx-result-badge{position:absolute;left:8px;top:8px;padding:4px 7px;border-radius:4px;background:rgba(0,0,0,.72);font-size:11px;color:#ddd}
.mmx-result-source{display:flex;align-items:center;gap:7px;min-height:28px;font-size:11px;color:#aaa}.mmx-result-source select,.mmx-result-source input{height:26px;border:1px solid #383838;border-radius:4px;background:#222;color:#ddd}.mmx-result-controls{display:grid;grid-template-columns:auto minmax(100px,1fr) auto auto auto;align-items:center;gap:7px}.mmx-result-controls button{height:28px;min-width:58px;border:1px solid #3a3a3a;border-radius:5px;background:#242424;color:#ddd}.mmx-result-controls input[type=range]{width:100%}.mmx-result-info{font-size:11px;color:#999}
.mmx-result-controls{grid-template-columns:auto minmax(150px,1fr) max-content max-content minmax(150px,auto);min-height:32px}.mmx-result-controls>span{white-space:nowrap;font-variant-numeric:tabular-nums;color:#ddd}.mmx-result-controls>label{display:grid;grid-template-columns:max-content minmax(84px,140px);align-items:center;gap:7px;margin:0;white-space:nowrap}.mmx-result-controls>label input{min-width:84px}
.mmx-output-right{display:flex;flex-direction:column;gap:7px;overflow:auto}.mmx-output-card{border:1px solid #333;border-radius:7px;background:#191919;padding:8px}.mmx-output-card h4{margin:0 0 6px;font-size:12px}.mmx-output-card>div:not(.mmx-output-report){font-size:11px;line-height:1.45;color:#bbb}.mmx-output-card label{display:grid;grid-template-columns:minmax(125px,1fr) minmax(0,1fr);align-items:center;gap:8px;margin:5px 0;font-size:11px;color:#aaa}.mmx-output-card input{min-width:0;width:100%;height:25px;border:1px solid #393939;border-radius:4px;background:#242424;color:#ddd;box-sizing:border-box}.mmx-output-card input[type=checkbox]{justify-self:start;width:16px;height:16px;accent-color:#4fff8f}.mmx-output-report{white-space:pre-wrap;max-height:190px;overflow:auto;font:10px/1.4 ui-monospace,monospace;color:#aaa}
.bd-run-status{border:1px solid #333;border-radius:7px;background:#191919;padding:8px}.bd-run-title{font-size:12px;font-weight:650}.bd-run-detail{margin:4px 0;color:#999;font-size:10px}.bd-run-bars{display:grid;gap:4px}.bd-run-bar{height:6px;overflow:hidden;border-radius:4px;background:#292929}.bd-run-bar-fill{height:100%;background:#4fff8f}.bd-run-bar-sub .bd-run-bar-fill{background:#69b8ff}
@media(max-width:1100px){.mmx-result-controls{grid-template-columns:auto minmax(120px,1fr) max-content max-content}.mmx-result-controls>label{grid-column:1/-1;justify-self:end}}
@media(max-width:980px){.mmx-output{grid-template-columns:1fr}.mmx-output-right{overflow:visible}.mmx-result-viewer{min-height:220px}}
`;
    document.head.appendChild(style);
}

function dataUrl(b64, mediaType = "image/jpeg") { return b64?.startsWith("data:") ? b64 : `data:${mediaType};base64,${b64 || ""}`; }

export function mountOutputUI(container, store, { locale = () => "zh" } = {}) {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "mmx-output";
    root.innerHTML = `
      <section class="mmx-output-left">
        <div class="mmx-result-tabs">
          <button type="button" data-result-tab="live" class="active" data-output-text="live">实时</button>
          <button type="button" data-result-tab="segment" data-output-text="segment">分段</button>
          <button type="button" data-result-tab="multi" data-output-text="multi">多段</button>
          <button type="button" data-result-tab="final" data-output-text="final">最终结果</button>
        </div>
        <div class="mmx-result-source">
          <span data-source-label data-output-text="sampling_result">Sampling result</span>
          <select data-segment-select hidden></select>
          <span data-range-label hidden></span>
        </div>
        <div class="mmx-result-viewer">
          <img data-result-image hidden alt="Director result preview">
          <video data-result-video hidden playsinline controls></video>
          <div class="mmx-result-empty" data-output-text="waiting">等待模型生成成果…</div>
          <div class="mmx-result-badge" data-result-badge data-output-text="idle">Idle</div>
        </div>
        <audio data-result-audio hidden></audio>
        <div class="mmx-result-controls">
          <button type="button" data-result-play data-output-text="play">▶ Play</button>
          <input type="range" data-result-seek min="0" max="0" value="0" step="1">
          <span data-result-time>0.00 / 0.00</span>
          <span data-result-frame>Frame 0 / 0</span>
          <label><span data-output-text="volume">Volume</span> <input type="range" data-result-volume min="0" max="1" value="1" step="0.05" disabled></label>
        </div>
        <div class="mmx-result-info" data-result-info>—</div>
      </section>
      <aside class="mmx-output-right">
        <div class="bd-run-status idle" data-r="run-status">
          <div class="bd-run-title" data-r="run-title" data-output-text="current_run">Current Run · Idle</div>
          <div class="bd-run-detail" data-r="run-detail" data-output-text="task_detail">Task / Segment / Stage / Step</div>
          <div class="bd-run-select-bar hidden" data-r="run-select-bar"><span data-r="run-select-summary"></span></div>
          <div class="bd-run-bars">
            <div class="bd-run-bar" data-output-title="overall_progress"><div class="bd-run-bar-fill" data-r="run-overall" style="width:0%"></div></div>
            <div class="bd-run-bar bd-run-bar-sub" data-output-title="stage_progress"><div class="bd-run-bar-fill" data-r="run-phase" style="width:0%"></div></div>
          </div>
        </div>
        <section class="mmx-output-card"><h4 data-output-text="pipeline_status">Pipeline Status</h4><div data-pipeline-status data-output-text="pipeline_path">Generation → Global Refine → Assemble → Face Refine → Finalize / Export</div></section>
        <section class="mmx-output-card"><h4 data-output-text="preview_settings">Preview Settings</h4>
          <label><span data-output-text="director_preview">Director Preview</span><input type="checkbox" data-preview="enabled"></label>
          <label><span data-output-text="preview_frames">preview_frames</span><input type="number" min="1" max="32" data-preview="preview_frames"></label>
          <label><span data-output-text="preview_fps">preview_fps</span><input type="number" min="1" max="60" data-preview="preview_fps"></label>
          <label><span data-output-text="max_resolution">max_resolution</span><input type="number" min="128" max="4096" data-preview="max_resolution"></label>
          <label><span data-output-text="jpeg_quality">jpeg_quality</span><input type="number" min="20" max="100" data-preview="jpeg_quality"></label>
          <label><span data-output-text="preview_every">preview_every</span><input type="number" min="1" max="100" data-preview="preview_every"></label>
          <div class="mmx-result-info" data-output-text="suppressed">ComfyUI Default Preview: SUPPRESSED</div>
        </section>
        <section class="mmx-output-card"><h4 data-output-text="final_info">Final Result Info</h4><div data-final-info data-output-text="not_completed">Not completed</div></section>
        <section class="mmx-output-card"><h4 data-output-text="report">Report</h4><div class="mmx-output-report" data-report data-output-text="waiting_report">Waiting for report…</div></section>
      </aside>`;
    container.replaceChildren(root);

    const state = { tab: "live", live: null, segments: new Map(), final: null, frames: [], index: 0, playing: false, timer: null };
    const image = root.querySelector("[data-result-image]");
    const video = root.querySelector("[data-result-video]");
    const empty = root.querySelector(".mmx-result-empty");
    const badge = root.querySelector("[data-result-badge]");
    const seek = root.querySelector("[data-result-seek]");
    const segmentSelect = root.querySelector("[data-segment-select]");
    const audio = root.querySelector("[data-result-audio]");
    const volume = root.querySelector("[data-result-volume]");
    const tx = (key) => OUTPUT_TEXT[locale() === "en" ? "en" : "zh"][key] || key;
    const stageText = (value) => {
        const raw = String(value || "");
        const lower = raw.toLowerCase();
        if (lower.includes("global") && lower.includes("refine")) return `${tx("global_refine")}${lower.includes("upscale") ? ` · ${tx("upscale")}` : ""}`;
        if (lower.includes("face") && lower.includes("refine")) return tx("face_refine");
        if (lower.includes("assemble")) return tx("assemble");
        if (lower.includes("final")) return tx("finalize");
        if (lower.includes("multi")) return tx("multi");
        if (lower.includes("generation")) return tx("generation");
        return raw || tx("generation");
    };

    const activeResult = () => {
        if (state.tab === "live") return state.live;
        if (state.tab === "final") return state.final;
        if (state.tab === "segment") return state.segments.get(Number(segmentSelect.value || 0)) || null;
        const ordered = [...state.segments.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
        const frames = ordered.flatMap((item) => item.frames || (item.image_b64 ? [item.image_b64] : []));
        return frames.length ? { frames, fps: ordered[0]?.fps || 24, width: ordered[0]?.width, height: ordered[0]?.height, stage: "Multi Segment" } : null;
    };
    const stop = () => { state.playing = false; clearInterval(state.timer); state.timer = null; audio.pause(); root.querySelector("[data-result-play]").textContent = tx("play"); };
    const renderFrame = () => {
        const result = activeResult();
        const frames = result?.frames?.length ? result.frames : result?.image_b64 ? [result.image_b64] : [];
        state.frames = frames;
        state.index = Math.max(0, Math.min(state.index, Math.max(0, frames.length - 1)));
        const mediaType = result?.media_type || "image/jpeg";
        const isVideo = mediaType.startsWith("video/") && result?.image_b64;
        video.hidden = !isVideo; image.hidden = isVideo || !frames.length; empty.hidden = isVideo || !!frames.length;
        if (isVideo) video.src = dataUrl(result.image_b64, mediaType);
        else if (frames.length) image.src = dataUrl(
            frames[state.index],
            frames[state.index]?.startsWith?.("data:") ? "" : (result?.frames?.length ? "image/jpeg" : mediaType),
        );
        seek.max = Math.max(0, frames.length - 1); seek.value = state.index;
        const fps = Number(result?.fps || 24);
        root.querySelector("[data-result-time]").textContent = `${(state.index / fps).toFixed(2)} / ${(Math.max(0, frames.length - 1) / fps).toFixed(2)}`;
        root.querySelector("[data-result-frame]").textContent = `${tx("frame")} ${frames.length ? state.index + 1 : 0} / ${frames.length}`;
        root.querySelector("[data-result-info]").textContent = result ? `${result.width || "—"}×${result.height || "—"} · ${fps} fps · ${frames.length || (isVideo ? "video" : 0)} ${tx("frames")}` : "—";
        badge.textContent = result ? `${stageText(result.stage)}${result.step ? ` · ${tx("step")} ${result.step}/${result.total_steps || "?"}` : ""}` : tx("idle");
    };
    const setTab = (tab) => {
        stop(); state.tab = tab; state.index = 0;
        root.querySelectorAll("[data-result-tab]").forEach((button) => button.classList.toggle("active", button.dataset.resultTab === tab));
        segmentSelect.hidden = tab !== "segment";
        root.querySelector("[data-range-label]").hidden = tab !== "multi";
        root.querySelector("[data-source-label]").textContent = tx(tab === "live" ? "sampling_result" : tab === "segment" ? "generated_segment" : tab === "multi" ? "available_range" : "final_pipeline");
        renderFrame();
    };
    root.querySelectorAll("[data-result-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.resultTab)));
    segmentSelect.addEventListener("change", () => { state.index = 0; renderFrame(); });
    seek.addEventListener("input", () => { state.index = Number(seek.value); renderFrame(); });
    volume.addEventListener("input", () => { audio.volume = Number(volume.value); });
    root.querySelector("[data-result-play]").addEventListener("click", () => {
        if (state.playing) { stop(); return; }
        if (state.frames.length < 2) return;
        state.playing = true; root.querySelector("[data-result-play]").textContent = tx("pause");
        const fps = Number(activeResult()?.fps || 24);
        if (audio.src) {
            audio.currentTime = state.index / fps;
            audio.play().catch(() => {});
        }
        state.timer = setInterval(() => { state.index = (state.index + 1) % state.frames.length; renderFrame(); }, Math.max(30, 1000 / fps));
    });

    const refreshSettings = (config) => root.querySelectorAll("[data-preview]").forEach((input) => {
        const value = config.preview[input.dataset.preview];
        if (input.type === "checkbox") input.checked = !!value; else input.value = value;
    });
    root.querySelectorAll("[data-preview]").forEach((input) => input.addEventListener("change", () => {
        store.patch("preview", input.dataset.preview, input.type === "checkbox" ? input.checked : Number(input.value));
    }));
    const unsubscribe = store.subscribe(refreshSettings); refreshSettings(store.get());

    const consumePreview = (detail = {}) => {
        const item = { ...detail, frames: detail.frames || [], image_b64: detail.image_b64 || detail.imageB64 || "" };
        if (detail.result_kind === "final") {
            state.final = item;
            root.querySelector("[data-final-info]").textContent = `${item.width || "—"}×${item.height || "—"} · ${item.frames.length} ${tx("frames")} · ${item.fps || 24} fps`;
            root.querySelector("[data-final-info]").dataset.hasResult = "1";
        } else if (detail.live) {
            state.live = item;
            root.querySelector("[data-pipeline-status]").textContent = `${tx("segment_word")} ${Number(detail.segment_index || 0) + 1} · ${stageText(detail.stage)}${detail.step ? ` · ${tx("step")} ${detail.step}/${detail.total_steps || "?"}` : ""}`;
        }
        else {
            state.segments.set(Number(detail.segment_index || 0), item);
            segmentSelect.innerHTML = [...state.segments.keys()].sort((a, b) => a - b).map((index) => `<option value="${index}">${tx("segment_word")} ${index + 1}</option>`).join("");
            const keys = [...state.segments.keys()].sort((a, b) => a - b);
            root.querySelector("[data-range-label]").textContent = keys.length ? `S${keys[0] + 1} → S${keys.at(-1) + 1}` : tx("no_valid");
        }
        renderFrame();
    };
    const clear = () => {
        stop(); state.live = null; state.segments.clear(); state.final = null; state.frames = []; state.index = 0;
        segmentSelect.replaceChildren(); audio.removeAttribute("src"); volume.disabled = true;
        const finalInfo = root.querySelector("[data-final-info]");
        delete finalInfo.dataset.hasResult; finalInfo.textContent = tx("not_completed");
        const report = root.querySelector("[data-report]");
        delete report.dataset.hasReport; report.textContent = tx("waiting_report");
        renderFrame();
    };
    const setReport = (text) => {
        const report = root.querySelector("[data-report]");
        report.textContent = String(text || "");
        report.dataset.hasReport = text ? "1" : "";
    };
    const setAudio = (detail = {}) => {
        if (!detail.audio_b64) return;
        audio.src = dataUrl(detail.audio_b64, detail.media_type || "audio/wav");
        audio.volume = Number(volume.value);
        volume.disabled = false;
    };
    const setPipelineStatus = (detail = {}) => {
        const phase = String(detail.phase || "plan");
        const stage = phase === "global_upscale" || phase === "global_refine" ? tx("global_refine")
            : phase === "face_refine" ? tx("face_refine")
            : phase === "assemble" ? tx("assemble")
            : phase === "finalize" || phase === "finish" ? tx("finalize")
            : tx("generation");
        const step = detail.phase_max > 1 ? ` · ${tx("step")} ${detail.phase_value}/${detail.phase_max}` : "";
        const segment = detail.timeline_segment || detail.segment || 1;
        const total = detail.timeline_segment_total || detail.segment_total || 1;
        root.querySelector("[data-pipeline-status]").textContent = `${tx("segment_word")} ${segment}/${total} · ${stage}${step}`;
    };
    const updateLocale = () => {
        root.querySelectorAll("[data-output-text]").forEach((element) => {
            const key = element.dataset.outputText;
            if (key === "not_completed" && element.dataset.hasResult) return;
            if (key === "waiting_report" && element.dataset.hasReport) return;
            if (key && OUTPUT_TEXT[locale() === "en" ? "en" : "zh"][key]) element.textContent = tx(key);
        });
        root.querySelectorAll("[data-output-title]").forEach((element) => { element.title = tx(element.dataset.outputTitle); });
        root.querySelector("[data-source-label]").textContent = tx(state.tab === "live" ? "sampling_result" : state.tab === "segment" ? "generated_segment" : state.tab === "multi" ? "available_range" : "final_pipeline");
        for (const option of segmentSelect.options) option.textContent = `${tx("segment_word")} ${Number(option.value) + 1}`;
        renderFrame();
    };
    updateLocale();
    return {
        root, state, consumePreview, clear, setReport, setAudio, setPipelineStatus, setTab, updateLocale,
        runStatusEl: root.querySelector('[data-r="run-status"]'),
        runTitleEl: root.querySelector('[data-r="run-title"]'),
        runDetailEl: root.querySelector('[data-r="run-detail"]'),
        runOverallEl: root.querySelector('[data-r="run-overall"]'),
        runPhaseEl: root.querySelector('[data-r="run-phase"]'),
        runSelectBar: root.querySelector('[data-r="run-select-bar"]'),
        runSelectSummary: root.querySelector('[data-r="run-select-summary"]'),
        destroy() { stop(); unsubscribe(); },
    };
}
