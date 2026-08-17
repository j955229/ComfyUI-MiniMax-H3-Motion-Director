const DEFAULT_CONFIG = Object.freeze({
    version: 4,
    global_refine: {
        enabled: false, mode: "refine", denoise: 0.25, steps: 0,
        seed_mode: "inherit", seed_offset: 1, skip_fl2v: false,
        upscale_method: "lanczos", upscale_model: "",
        vsr_quality: "high",
        resolution_mode: "follow_director", aspect: "16:9", megapixels: 1,
        width: 1376, height: 768,
    },
    face_refine: {
        enabled: false, detector: "ultralytics", detector_model: "", confidence: 0.35,
        select: "largest", crop_factor: 2.5, canvas_mode: "auto_capped_768", canvas_size: 768,
        smooth_method: "gaussian", smooth_window: 21, size_smooth_window: 51, size_mode: "adaptive",
        adaptive: true, base_denoise: 0.45, strength_small_face: 0.8,
        strength_large_face: 0.35, face_px_small: 30, face_px_large: 120,
        mask_mode: "rect", paste_region: "face_rect", feather: 24,
        colour_match: true, blend: 1, undetected_frames: "fade",
        identity_reference: "", identity_track: false, identity_threshold: 0.28,
        fallback_detector: "none", fallback_head_frac: 0.5, gamma: 1,
        denoise_smooth: 9, mask_dilation: 24, feather_scales_with_crop: false,
        sam_model: "", sam_threshold: 0.93, sam_dilation: 0, sam_temporal_smooth: 5,
    },
    preview: { enabled: true, preview_frames: 8, preview_fps: 12, max_resolution: 1024, jpeg_quality: 80, preview_every: 1 },
    save: {
        auto_save: false, filename_prefix: "video/MiniMaxH3_Director",
        format: "auto", codec: "auto", encoding: "auto", crf: 23,
    },
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const inChoice = (value, choices, fallback) => choices.includes(value) ? value : fallback;

const POST_TEXT = {
    en: {
        global_title: "Global Refine", face_title: "Face Refine", sampling: "Second Sampling",
        upscale: "Upscale", output_resolution: "Output Resolution",
        detection_canvas: "Detection", tracking_denoise: "Refine",
        stitch: "Stitch", advanced: "Advanced Settings", enabled: "ON / OFF", disabled: "Disabled",
        detection_note: "Choose a face detector model. Lower 0.35 only when faces are missed.",
        refine_note: "Adaptive mode strengthens small faces and backs off on large faces.",
        stitch_note: "Rectangle is recommended. Use SAM only when a tighter face-shaped edge is needed.",
        no_face_detector: "No face detector model found. face_yolov8m.pt is recommended.",
        runtime_detected: "Runtime detected (validated when generation starts)",
        missing_no_downgrade: "Not installed (stage will fail without downgrade)",
    },
    zh: {
        global_title: "全局精修", face_title: "人脸精修", sampling: "二次采样",
        upscale: "放大", output_resolution: "输出分辨率",
        detection_canvas: "检测", tracking_denoise: "精修",
        stitch: "回贴", advanced: "高级设置", enabled: "开 / 关", disabled: "已停用",
        detection_note: "通常只需选择人脸检测模型。置信度 0.35 可直接使用，漏脸时再降低。",
        refine_note: "自适应会加强远处小脸、减弱近处大脸，避免重写已有细节。",
        stitch_note: "推荐矩形遮罩；只有确实需要更贴脸的边缘时再使用 SAM。",
        no_face_detector: "未找到人脸检测模型，建议放入 face_yolov8m.pt。",
        runtime_detected: "已检测到运行库（生成时验证）",
        missing_no_downgrade: "未安装（此阶段会失败，不会自动降级）",
    },
};

const POST_LABELS = {
    "global_refine.denoise": ["Denoise", "降噪强度"],
    "global_refine.steps": ["Steps (0=Auto)", "步数（0=自动）"],
    "global_refine.seed_mode": ["Refine Randomness", "精修随机性"],
    "global_refine.seed_offset": ["Seed Offset", "Seed 偏移"],
    "global_refine.skip_fl2v": ["Skip FL2V", "跳过 FL2V"],
    "global_refine.upscale_method": ["Method", "放大方法"],
    "global_refine.upscale_model": ["Model", "模型"],
    "global_refine.vsr_quality": ["VSR Quality", "VSR 质量"],
    "global_refine.resolution_mode": ["Resolution", "分辨率模式"],
    "global_refine.aspect": ["Aspect", "画幅比"],
    "global_refine.megapixels": ["Megapixels", "百万像素"],
    "global_refine.width": ["Width", "宽度"],
    "global_refine.height": ["Height", "高度"],
    "face_refine.detector": ["Detector Engine", "检测引擎"], "face_refine.detector_model": ["Face Detector Model", "人脸检测模型"],
    "face_refine.confidence": ["Confidence", "置信度"], "face_refine.select": ["Target Face", "目标人脸"],
    "face_refine.crop_factor": ["Crop Factor", "裁切倍率"], "face_refine.canvas_mode": ["Canvas Quality", "画布质量"],
    "face_refine.canvas_size": ["Canvas Size", "画布尺寸"], "face_refine.smooth_method": ["Smooth", "平滑方法"],
    "face_refine.smooth_window": ["Centre Window", "中心平滑窗口"], "face_refine.size_smooth_window": ["Size Window", "尺寸平滑窗口"],
    "face_refine.size_mode": ["Size Mode", "尺寸模式"], "face_refine.adaptive": ["Adaptive Strength", "自适应强度"],
    "face_refine.base_denoise": ["Refine Strength", "精修强度"], "face_refine.strength_small_face": ["Small Face", "小脸强度"],
    "face_refine.strength_large_face": ["Large Face", "大脸强度"], "face_refine.face_px_small": ["Face px Small", "小脸像素阈值"],
    "face_refine.face_px_large": ["Face px Large", "大脸像素阈值"], "face_refine.mask_mode": ["Mask", "遮罩"],
    "face_refine.paste_region": ["Paste", "回贴区域"], "face_refine.feather": ["Feather (source px)", "羽化（源画面 px）"],
    "face_refine.colour_match": ["Colour Match", "颜色匹配"], "face_refine.blend": ["Blend", "混合"],
    "face_refine.undetected_frames": ["Undetected", "未检测帧"], "face_refine.identity_reference": ["Identity Reference", "身份参考图"],
    "face_refine.identity_track": ["Identity Track", "身份跟踪"], "face_refine.identity_threshold": ["Identity Threshold", "身份阈值"],
    "face_refine.fallback_detector": ["Fallback Detector", "备用检测器"], "face_refine.fallback_head_frac": ["Fallback Head Frac", "备用头部比例"],
    "face_refine.gamma": ["Gamma", "伽马"], "face_refine.denoise_smooth": ["Denoise Smooth", "降噪平滑"],
    "face_refine.mask_dilation": ["Mask Dilation (canvas px)", "遮罩扩张（画布 px）"], "face_refine.feather_scales_with_crop": ["Legacy canvas feather", "旧式画布羽化"],
    "face_refine.sam_model": ["SAM Model", "SAM 模型"], "face_refine.sam_threshold": ["SAM Threshold", "SAM 阈值"],
    "face_refine.sam_dilation": ["SAM Dilation", "SAM 扩张"], "face_refine.sam_temporal_smooth": ["SAM Temporal", "SAM 时序平滑"],
};

const POST_OPTION_LABELS = {
    "global_refine.seed_mode": {
        inherit: ["Keep original Seed (recommended)", "保持原 Seed（推荐）"],
        offset: ["Use Seed offset", "使用 Seed 偏移"],
    },
    "global_refine.upscale_method": {
        lanczos: ["Lanczos", "Lanczos"], upscale_model: ["Upscale Model", "放大模型"],
        nvidia_rtx_vsr: ["NVIDIA RTX VSR", "NVIDIA RTX VSR"],
    },
    "global_refine.vsr_quality": {
        low: ["Low", "Low"], medium: ["Medium", "Medium"], high: ["High", "High"], ultra: ["Ultra", "Ultra"],
    },
    "global_refine.resolution_mode": {
        follow_director: ["Follow Director", "跟随 Director"],
        aspect_megapixels: ["Aspect + Megapixels", "画幅比 + 百万像素"], custom: ["Custom", "自定义"],
    },
    "face_refine.select": { largest: ["Largest", "最大脸"], most_central: ["Most central", "最靠近中心"] },
    "face_refine.canvas_mode": {
        manual: ["Manual", "手动"], auto_no_downscale: ["Preserve source detail", "保留原始细节"],
        auto_capped_768: ["Auto (recommended, max 768)", "自动（推荐，上限 768）"],
    },
    "face_refine.smooth_method": {
        gaussian: ["Gaussian", "高斯"], savgol: ["Savitzky–Golay", "Savitzky–Golay"],
        moving_average: ["Moving average", "移动平均"],
    },
    "face_refine.size_mode": { adaptive: ["Adaptive", "自适应"], stable: ["Stable", "稳定"] },
    "face_refine.mask_mode": { rect: ["Rectangle (recommended)", "矩形（推荐）"], ellipse: ["Ellipse", "椭圆"], sam: ["SAM (optional)", "SAM（可选）"] },
    "face_refine.paste_region": { face_rect: ["Face rectangle", "人脸区域"], full_crop: ["Full crop", "完整裁切区"] },
    "face_refine.undetected_frames": { fade: ["Fade", "淡出"], skip: ["Skip", "跳过"] },
    "face_refine.fallback_detector": { none: ["None", "无"] },
};

export function normalizePostprocessConfig(raw) {
    if (typeof raw === "string") {
        try { raw = raw.trim() ? JSON.parse(raw) : {}; } catch { raw = {}; }
    }
    raw = raw && typeof raw === "object" ? raw : {};
    const result = clone(DEFAULT_CONFIG);
    for (const key of ["global_refine", "face_refine", "preview", "save"]) {
        const legacy = key === "global_refine" ? raw.globalRefine : key === "face_refine" ? raw.faceRefine : null;
        Object.assign(result[key], legacy || {}, raw[key] || {});
    }
    if (raw.liveTaePreview === false || raw.live_tae_preview === false) result.preview.enabled = false;
    const rawVersion=Number(raw.version||0);
    if(rawVersion>0&&rawVersion<4){
        const m={crop_factor:[2,2.5],smooth_window:[9,21],size_smooth_window:[13,51],base_denoise:[0.22,0.45],strength_small_face:[0.35,0.8],strength_large_face:[0.16,0.35],face_px_small:[96,30],face_px_large:[320,120],feather:[0.12,24],identity_threshold:[0.35,0.28],fallback_head_frac:[0.34,0.5],denoise_smooth:[5,9],mask_dilation:[0.06,24],feather_scales_with_crop:[true,false],sam_threshold:[0.5,0.93],sam_dilation:[0.04,0]};
        for(const [k,[a,b]] of Object.entries(m)) if(result.face_refine[k]===a) result.face_refine[k]=b;
    }
    const global = result.global_refine;
    global.enabled = !!global.enabled;
    global.mode = inChoice(global.mode, ["refine", "upscale"], "refine");
    global.seed_mode = inChoice(global.seed_mode, ["inherit", "offset"], "inherit");
    const seedOffset = Number(global.seed_offset);
    global.seed_offset = Number.isFinite(seedOffset)
        ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(seedOffset)))
        : 1;
    global.upscale_method = inChoice(global.upscale_method, ["lanczos", "upscale_model", "nvidia_rtx_vsr"], "lanczos");
    global.vsr_quality = inChoice(global.vsr_quality, ["low", "medium", "high", "ultra"], "high");
    global.resolution_mode = inChoice(global.resolution_mode, ["follow_director", "aspect_megapixels", "custom"], "follow_director");
    const face=result.face_refine;
    face.enabled=!!face.enabled;
    face.detector=inChoice(face.detector,["ultralytics","insightface"],"ultralytics");
    face.select=inChoice(face.select,["largest","most_central"],"largest");
    face.canvas_mode=inChoice(face.canvas_mode,["manual","auto_no_downscale","auto_capped_768"],"auto_capped_768");
    face.smooth_method=inChoice(face.smooth_method,["gaussian","savgol","moving_average"],"gaussian");
    face.size_mode=inChoice(face.size_mode,["adaptive","stable"],"adaptive");
    face.mask_mode=inChoice(face.mask_mode,["rect","ellipse","sam"],"rect");
    face.paste_region=inChoice(face.paste_region,["face_rect","full_crop"],"face_rect");
    face.undetected_frames=inChoice(face.undetected_frames,["fade","skip"],"fade");
    face.adaptive=face.adaptive!==false;
    face.identity_track=!!face.identity_track;
    face.feather_scales_with_crop=!!face.feather_scales_with_crop;
    result.preview.enabled = result.preview.enabled !== false;
    result.save.auto_save = !!result.save.auto_save;
    result.save.filename_prefix = String(result.save.filename_prefix || "video/MiniMaxH3_Director").trim().slice(0, 512) || "video/MiniMaxH3_Director";
    result.save.format = String(result.save.format || "auto").trim().toLowerCase().slice(0, 32) || "auto";
    result.save.codec = String(result.save.codec || "auto").trim().toLowerCase().slice(0, 64) || "auto";
    result.save.encoding = result.save.encoding === "re-encode" ? "re-encode" : "auto";
    result.save.crf = Math.max(0, Math.min(51, Math.round(Number(result.save.crf) || 23)));
    result.version = 4;
    return result;
}

export function serializePostprocessConfig(raw) {
    return JSON.stringify(normalizePostprocessConfig(raw));
}

function snap(value) { return Math.max(32, Math.round(Number(value || 32) / 32) * 32); }

export function resolveGlobalTarget(config, directorWidth = 864, directorHeight = 480) {
    const global = normalizePostprocessConfig(config).global_refine;
    if (global.resolution_mode === "follow_director") return [snap(directorWidth), snap(directorHeight)];
    if (global.resolution_mode === "custom") return [snap(global.width), snap(global.height)];
    const match = String(global.aspect || "16:9").match(/^(\d+):(\d+)$/);
    const aw = Number(match?.[1] || 16), ah = Number(match?.[2] || 9);
    const scale = Math.sqrt(Math.max(0.1, Number(global.megapixels || 1)) * 1024 * 1024 / (aw * ah));
    return [snap(aw * scale), snap(ah * scale)];
}

export function setGlobalUpscaleEnabled(config, enabled) {
    const next = normalizePostprocessConfig(config);
    next.global_refine.mode = enabled ? "upscale" : "refine";
    return next;
}

export function globalRefineVisibility(config) {
    const global = normalizePostprocessConfig(config).global_refine;
    const upscaleEnabled = global.mode === "upscale";
    return {
        upscaleEnabled,
        seedOffset: global.seed_mode === "offset",
        upscaleModel: upscaleEnabled && global.upscale_method === "upscale_model",
        vsr: upscaleEnabled && global.upscale_method === "nvidia_rtx_vsr",
        aspectMegapixels: upscaleEnabled && global.resolution_mode === "aspect_megapixels",
        customSize: upscaleEnabled && global.resolution_mode === "custom",
    };
}

export function faceRefineVisibility(config){
    const f=normalizePostprocessConfig(config).face_refine;
    return {detectorModel:f.detector==="ultralytics",manualCanvas:f.canvas_mode==="manual",sam:f.mask_mode==="sam",identity:!!f.identity_track,fallback:String(f.fallback_detector||"none")!=="none"};
}

export function globalRefineSummary(config, width = 864, height = 480, locale = "en") {
    const global = normalizePostprocessConfig(config).global_refine;
    const zh = locale === "zh";
    if (!global.enabled) return POST_TEXT[zh ? "zh" : "en"].disabled;
    const steps = Number(global.steps) > 0 ? `${global.steps} ${zh ? "步" : "Steps"}` : (zh ? "自动步数" : "Auto Steps");
    const seed = global.seed_mode === "offset"
        ? `${zh ? "Seed 偏移" : "Seed Offset"} ${Number(global.seed_offset) >= 0 ? "+" : ""}${Number(global.seed_offset)}`
        : (zh ? "保持原 Seed" : "Keep original Seed");
    const parts = [zh ? "二次采样" : "Second Sampling", `D${Number(global.denoise).toFixed(2)}`, steps, seed];
    if (global.mode === "upscale") {
        const [targetW, targetH] = resolveGlobalTarget(config, width, height);
        let method = global.upscale_method === "upscale_model" ? (global.upscale_model || (zh ? "放大模型" : "Upscale Model")) : "Lanczos";
        if (global.upscale_method === "nvidia_rtx_vsr") {
            const quality = String(global.vsr_quality || "high");
            method = `RTX VSR ${quality.charAt(0).toUpperCase()}${quality.slice(1)}`;
        }
        parts.push(`${method} → ${targetW}×${targetH}`);
    }
    return parts.join(" · ");
}

export function faceRefineSummary(config, locale = "en") {
    const face = normalizePostprocessConfig(config).face_refine;
    const zh = locale === "zh";
    if (!face.enabled) return POST_TEXT[zh ? "zh" : "en"].disabled;
    const canvas=face.canvas_mode==="manual"?`${face.canvas_size}`:face.canvas_mode==="auto_capped_768"?(zh?"自动 768":"Auto 768"):(zh?"保留细节":"Preserve detail");
    const target=face.select==="most_central"?(zh?"中心脸":"Central face"):(zh?"最大脸":"Largest face");
    const strength=`${face.adaptive?(zh?"自适应":"Adaptive"):(zh?"固定":"Fixed")} D${Number(face.base_denoise).toFixed(2)}`;
    const mask=face.mask_mode==="sam"?"SAM":face.mask_mode==="ellipse"?(zh?"椭圆":"Ellipse"):(zh?"矩形":"Rect");
    return `${target} · ${canvas} · ${strength} · ${mask}`;
}

export class PostprocessConfigStore {
    constructor(widget, { onChange } = {}) {
        this.widget = widget;
        this.onChange = onChange;
        this.listeners = new Set();
        this.value = normalizePostprocessConfig(widget?.value);
    }
    get() { return clone(this.value); }
    set(next, { notify = true } = {}) {
        this.value = normalizePostprocessConfig(next);
        const serialized = serializePostprocessConfig(this.value);
        if (this.widget) {
            this.widget.value = serialized;
            try {
                this.widget.callback?.(serialized);
            } catch (error) {
                console.warn("[MiniMax H3 Motion Director] postprocess widget callback failed:", error);
            }
        }
        if (notify) {
            try { this.onChange?.(this.get()); }
            catch (error) { console.warn("[MiniMax H3 Motion Director] postprocess onChange failed:", error); }
            this.listeners.forEach((listener) => {
                try { listener(this.get()); }
                catch (error) { console.warn("[MiniMax H3 Motion Director] postprocess listener failed:", error); }
            });
        }
        return this.get();
    }
    patch(section, key, value) {
        const next = this.get();
        next[section][key] = value;
        return this.set(next);
    }
    toggle(section) { return this.patch(section, "enabled", !this.value[section].enabled); }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    reload() {
        this.value = normalizePostprocessConfig(this.widget?.value);
        this.listeners.forEach((fn) => {
            try { fn(this.get()); }
            catch (error) { console.warn("[MiniMax H3 Motion Director] postprocess reload listener failed:", error); }
        });
    }
}

const STYLE_ID = "mmx-postprocess-styles";
function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-postprocess{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;height:100%;min-height:0;box-sizing:border-box}
.mmx-post-column{min-width:0;overflow:auto;border:1px solid #343434;border-radius:8px;background:#181818;padding:10px;box-sizing:border-box}
.mmx-post-head,.mmx-post-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.mmx-post-head{margin-bottom:8px}.mmx-post-head h3{margin:0;font-size:15px}
.mmx-post-section-head h4{margin:0;font-size:12px;color:#ddd}.mmx-post-enable,.mmx-post-subenable{display:flex;align-items:center;gap:6px;color:#4fff8f;font-weight:650}
.mmx-post-summary{min-height:18px;margin:0 0 8px;color:#aaa;font-size:11px}.mmx-post-note{margin:0 0 7px;color:#888;font-size:10px;line-height:1.45}
.mmx-post-section{margin:7px 0;padding:7px;border:1px solid #2d2d2d;border-radius:6px;background:#1d1d1d}.mmx-post-section>h4{margin:0 0 6px;font-size:12px;color:#ddd}
.mmx-post-section-body{margin-top:7px}.mmx-post-divider-title{margin:10px 0 6px;padding-top:8px;border-top:1px solid #303030;font-size:11px;font-weight:650;color:#bbb}
.mmx-post-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 8px}.mmx-post-field{display:grid;grid-template-columns:minmax(82px,.9fr) minmax(0,1.2fr);align-items:center;gap:6px;min-width:0;font-size:11px;color:#aaa}
.mmx-post-field input,.mmx-post-field select{min-width:0;width:100%;height:26px;border:1px solid #3b3b3b;border-radius:4px;background:#242424;color:#ddd;padding:2px 5px;box-sizing:border-box}
.mmx-post-field input[type=checkbox]{width:auto;height:auto;justify-self:start}.mmx-post-wide{grid-column:1/-1}.mmx-post-conditional{min-width:0}.mmx-post-conditional[hidden],.mmx-post-section-body[hidden]{display:none!important}
.mmx-post-result{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 7px;border-radius:4px;background:#202020}.mmx-post-result b{color:#ddd;font-size:12px}
.mmx-post-advanced>summary{cursor:pointer;color:#bbb;font-size:12px;font-weight:650;padding:3px}
.mmx-post-disabled{opacity:.52}.mmx-post-capability{font-size:10px;color:#999}.mmx-post-capability.bad{color:#ff8d8d}
@media(max-width:980px){.mmx-postprocess{grid-template-columns:1fr}.mmx-post-column{overflow:visible}.mmx-post-grid{grid-template-columns:1fr}}
`;
    document.head.appendChild(style);
}

function options(rows) { return rows.map(([value, label]) => `<option value="${value}">${label}</option>`).join(""); }
function field(label, path, type = "number", extra = "") {
    if (type === "select") return `<label class="mmx-post-field"><span data-field-label="${path}">${label}</span><select data-path="${path}">${extra}</select></label>`;
    if (type === "checkbox") return `<label class="mmx-post-field"><span data-field-label="${path}">${label}</span><input type="checkbox" data-path="${path}"></label>`;
    return `<label class="mmx-post-field"><span data-field-label="${path}">${label}</span><input type="${type}" data-path="${path}" ${extra}></label>`;
}
function conditional(name, content) { return `<div class="mmx-post-conditional" data-conditional="${name}">${content}</div>`; }

export function mountPostprocessUI(container, store, { fetchApi, directorSize = () => [864, 480], locale = () => "zh" } = {}) {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "mmx-postprocess";
    root.innerHTML = `
      <section class="mmx-post-column" data-section="global_refine">
        <div class="mmx-post-head"><h3 data-post-text="global_title">全局精修</h3><label class="mmx-post-enable"><input type="checkbox" data-path="global_refine.enabled"> <span data-post-text="enabled">ON / OFF</span></label></div>
        <p class="mmx-post-summary" data-summary="global_refine"></p>
        <div class="mmx-post-section"><h4 data-post-text="sampling">二次采样</h4><div class="mmx-post-grid">
          ${field("Denoise", "global_refine.denoise", "number", 'min="0.01" max="1" step="0.01"')}
          ${field("Steps (0=Auto)", "global_refine.steps", "number", 'min="0" max="200" step="1"')}
          ${field("Refine Randomness", "global_refine.seed_mode", "select", options([["inherit","Keep original Seed (recommended)"],["offset","Use Seed offset"]]))}
          ${conditional("seed_offset", field("Seed Offset", "global_refine.seed_offset", "number", 'min="-2147483648" max="2147483647" step="1"'))}
          ${field("Skip FL2V", "global_refine.skip_fl2v", "checkbox")}
        </div></div>
        <div class="mmx-post-section" data-upscale-section>
          <div class="mmx-post-section-head"><h4 data-post-text="upscale">Upscale</h4><label class="mmx-post-subenable"><input type="checkbox" data-upscale-enabled> <span data-post-text="enabled">ON / OFF</span></label></div>
          <div class="mmx-post-section-body" data-upscale-body>
            <div class="mmx-post-grid">
              ${field("Method", "global_refine.upscale_method", "select", options([["lanczos","Lanczos"],["upscale_model","Upscale Model"],["nvidia_rtx_vsr","NVIDIA RTX VSR"]]))}
              ${conditional("upscale_model", field("Model", "global_refine.upscale_model", "select", '<option value="">—</option>'))}
              ${conditional("vsr_quality", field("VSR Quality", "global_refine.vsr_quality", "select", options([["low","Low"],["medium","Medium"],["high","High"],["ultra","Ultra"]])))}
              <div class="mmx-post-capability mmx-post-wide" data-conditional="vsr_status" data-capability="nvidia_rtx_vsr"></div>
            </div>
            <div class="mmx-post-divider-title" data-post-text="output_resolution">Output Resolution</div>
            <div class="mmx-post-grid">
              ${field("Resolution", "global_refine.resolution_mode", "select", options([["follow_director","Follow Director"],["aspect_megapixels","Aspect + Megapixels"],["custom","Custom"]]))}
              ${conditional("aspect", field("Aspect", "global_refine.aspect", "select", options([["1:1","1:1"],["4:3","4:3"],["3:4","3:4"],["16:9","16:9"],["9:16","9:16"],["21:9","21:9"]])))}
              ${conditional("megapixels", field("Megapixels", "global_refine.megapixels", "number", 'min="0.1" max="16" step="0.1"'))}
              ${conditional("width", field("Width", "global_refine.width", "number", 'min="32" max="8192" step="32"'))}
              ${conditional("height", field("Height", "global_refine.height", "number", 'min="32" max="8192" step="32"'))}
              <div class="mmx-post-result mmx-post-wide"><span data-field-label="resolved_target">Resolved Target</span><b data-resolved-target></b></div>
            </div>
          </div>
        </div>
      </section>
      <section class="mmx-post-column" data-section="face_refine">
        <div class="mmx-post-head"><h3 data-post-text="face_title">Face Refine</h3><label class="mmx-post-enable"><input type="checkbox" data-path="face_refine.enabled"> <span data-post-text="enabled">ON / OFF</span></label></div>
        <p class="mmx-post-summary" data-summary="face_refine"></p>
        <div class="mmx-post-section"><h4 data-post-text="detection_canvas">Detection</h4><p class="mmx-post-note" data-post-text="detection_note"></p><div class="mmx-post-grid">
          ${conditional("face_detector_model", field("Face Detector Model", "face_refine.detector_model", "select", '<option value="">—</option>'))}
          ${field("Confidence", "face_refine.confidence", "number", 'min="0.05" max="0.95" step="0.05"')}
          ${field("Target Face", "face_refine.select", "select", options([["largest","largest"],["most_central","most_central"]]))}
          <div class="mmx-post-capability mmx-post-wide" data-capability="face_detector"></div>
        </div></div>
        <div class="mmx-post-section"><h4 data-post-text="tracking_denoise">Refine</h4><p class="mmx-post-note" data-post-text="refine_note"></p><div class="mmx-post-grid">
          ${field("Adaptive Strength", "face_refine.adaptive", "checkbox")}
          ${field("Refine Strength", "face_refine.base_denoise", "number", 'min="0.01" max="1" step="0.01"')}
          ${field("Canvas Quality", "face_refine.canvas_mode", "select", options([["auto_capped_768","Auto (recommended, max 768)"],["auto_no_downscale","Preserve source detail"],["manual","Manual"]]))}
          ${conditional("face_canvas_size", field("Canvas Size", "face_refine.canvas_size", "number", 'min="256" max="1536" step="32"'))}
        </div></div>
        <div class="mmx-post-section"><h4 data-post-text="stitch">Stitch</h4><p class="mmx-post-note" data-post-text="stitch_note"></p><div class="mmx-post-grid">
          ${field("Mask", "face_refine.mask_mode", "select", options([["rect","Rectangle (recommended)"],["ellipse","Ellipse"],["sam","SAM (optional)"]]))}
          ${conditional("face_sam_model", field("SAM Model", "face_refine.sam_model", "select", '<option value="">—</option>'))}
          ${field("Colour Match", "face_refine.colour_match", "checkbox")}
          ${field("Blend", "face_refine.blend", "number", 'min="0" max="1" step="0.05"')}
        </div></div>
        <details class="mmx-post-section mmx-post-advanced"><summary data-post-text="advanced">Advanced Settings</summary>
          <div class="mmx-post-divider-title">Tracking</div><div class="mmx-post-grid">
            ${field("Detector Engine", "face_refine.detector", "select", options([["ultralytics","YOLO"],["insightface","InsightFace"]]))}
            ${field("Crop Factor", "face_refine.crop_factor", "number", 'min="1.2" max="5" step="0.1"')}
            ${field("Smooth", "face_refine.smooth_method", "select", options([["gaussian","gaussian"],["savgol","savgol"],["moving_average","moving_average"]]))}
            ${field("Centre Window", "face_refine.smooth_window", "number", 'min="1" max="201" step="2"')}
            ${field("Size Window", "face_refine.size_smooth_window", "number", 'min="1" max="201" step="2"')}
            ${field("Size Mode", "face_refine.size_mode", "select", options([["adaptive","adaptive"],["stable","stable"]]))}
          </div>
          <div class="mmx-post-divider-title">Adaptive Denoise</div><div class="mmx-post-grid">
            ${field("Small Face", "face_refine.strength_small_face", "number", 'min="0" max="1" step="0.05"')}
            ${field("Large Face", "face_refine.strength_large_face", "number", 'min="0" max="1" step="0.05"')}
            ${field("Face px Small", "face_refine.face_px_small", "number", 'min="4" max="400" step="1"')}
            ${field("Face px Large", "face_refine.face_px_large", "number", 'min="8" max="800" step="1"')}
            ${field("Gamma", "face_refine.gamma", "number", 'min="0.1" max="4" step="0.1"')}
            ${field("Denoise Smooth", "face_refine.denoise_smooth", "number", 'min="1" max="51" step="2"')}
          </div>
          <div class="mmx-post-divider-title">Identity / Fallback</div><div class="mmx-post-grid">
            ${field("Identity Track", "face_refine.identity_track", "checkbox")}
            ${conditional("face_identity", field("Identity Reference", "face_refine.identity_reference", "text"))}
            ${conditional("face_identity", field("Identity Threshold", "face_refine.identity_threshold", "number", 'min="0" max="1" step="0.01"'))}
            ${field("Fallback Detector", "face_refine.fallback_detector", "select", options([["none","none"]]))}
            ${conditional("face_fallback", field("Fallback Head Frac", "face_refine.fallback_head_frac", "number", 'min="0" max="1.5" step="0.05"'))}
          </div>
          <div class="mmx-post-divider-title">Stitch</div><div class="mmx-post-grid">
            ${field("Paste", "face_refine.paste_region", "select", options([["face_rect","face_rect"],["full_crop","full_crop"]]))}
            ${field("Feather", "face_refine.feather", "number", 'min="0" max="256" step="2"')}
            ${field("Mask Dilation", "face_refine.mask_dilation", "number", 'min="0" max="256" step="2"')}
            ${field("Undetected", "face_refine.undetected_frames", "select", options([["fade","fade"],["skip","skip"]]))}
            ${field("Legacy canvas feather", "face_refine.feather_scales_with_crop", "checkbox")}
          </div>
          <div class="mmx-post-divider-title">SAM</div><div class="mmx-post-grid">
            ${conditional("face_sam_advanced", field("SAM Threshold", "face_refine.sam_threshold", "number", 'min="0" max="1" step="0.01"'))}
            ${conditional("face_sam_advanced", field("SAM Dilation", "face_refine.sam_dilation", "number", 'min="0" max="256" step="1"'))}
            ${conditional("face_sam_advanced", field("SAM Temporal", "face_refine.sam_temporal_smooth", "number", 'min="1" max="51" step="2"'))}
          </div>
        </details>
      </section>`;
    container.replaceChildren(root);

    const readInput = (element) => element.type === "checkbox" ? element.checked
        : element.type === "number" ? Number(element.value) : element.value;
    root.addEventListener("change", (event) => {
        const target = event.target;
        if (target?.matches?.("[data-upscale-enabled]")) {
            store.set(setGlobalUpscaleEnabled(store.get(), target.checked));
            return;
        }
        const input = target?.closest?.("[data-path]") || target;
        const path = input?.dataset?.path;
        if (!path) return;
        const [section, key] = path.split(".");
        store.patch(section, key, readInput(input));
    });
    let capabilities = null;
    const setConditional = (name, hidden) => {
        root.querySelectorAll(`[data-conditional="${name}"]`).forEach((element) => { element.hidden = hidden; });
    };
    const updateLocale = (language = locale()) => {
        const lang = language === "en" ? "en" : "zh";
        root.querySelectorAll("[data-post-text]").forEach((element) => {
            element.textContent = POST_TEXT[lang][element.dataset.postText] || element.textContent;
        });
        root.querySelectorAll("[data-field-label]").forEach((element) => {
            const pair = element.dataset.fieldLabel === "resolved_target" ? ["Final Size", "最终尺寸"] : POST_LABELS[element.dataset.fieldLabel];
            if (pair) element.textContent = pair[lang === "zh" ? 1 : 0];
        });
        root.querySelectorAll("select[data-path]").forEach((select) => {
            const labels = POST_OPTION_LABELS[select.dataset.path];
            if (!labels) return;
            for (const option of select.options) {
                const pair = labels[option.value];
                if (pair) option.textContent = pair[lang === "zh" ? 1 : 0];
            }
        });
        const vsr = root.querySelector('[data-capability="nvidia_rtx_vsr"]');
        if (vsr && capabilities) {
            const ready = !!capabilities.dependencies?.nvidia_rtx_vsr;
            vsr.textContent = `RTX VSR: ${POST_TEXT[lang][ready ? "runtime_detected" : "missing_no_downgrade"]}`;
        }
        render(store.get());
    };
    const render = (config) => {
        root.querySelectorAll("[data-path]").forEach((input) => {
            const [section, key] = input.dataset.path.split(".");
            const value = config[section]?.[key];
            if (input.type === "checkbox") input.checked = !!value;
            else if (String(input.value) !== String(value ?? "")) input.value = value ?? "";
        });
        const visible = globalRefineVisibility(config);
        root.querySelector("[data-upscale-enabled]").checked = visible.upscaleEnabled;
        root.querySelector("[data-upscale-body]").hidden = !visible.upscaleEnabled;
        setConditional("seed_offset", !visible.seedOffset);
        setConditional("upscale_model", !visible.upscaleModel);
        setConditional("vsr_quality", !visible.vsr);
        setConditional("vsr_status", !visible.vsr);
        setConditional("aspect", !visible.aspectMegapixels);
        setConditional("megapixels", !visible.aspectMegapixels);
        setConditional("width", !visible.customSize);
        setConditional("height", !visible.customSize);
        const fv=faceRefineVisibility(config);
        setConditional("face_detector_model",!fv.detectorModel);
        setConditional("face_canvas_size",!fv.manualCanvas);
        setConditional("face_sam_model",!fv.sam);
        setConditional("face_sam_advanced",!fv.sam);
        setConditional("face_identity",!fv.identity);
        setConditional("face_fallback",!fv.fallback);
        const [w, h] = directorSize();
        root.querySelector('[data-summary="global_refine"]').textContent = globalRefineSummary(config, w, h, locale());
        root.querySelector('[data-summary="face_refine"]').textContent = faceRefineSummary(config, locale());
        const [tw, th] = resolveGlobalTarget(config, w, h);
        root.querySelector("[data-resolved-target]").textContent = `${tw}×${th}`;
        root.querySelector('[data-section="global_refine"]').classList.toggle("mmx-post-disabled", !config.global_refine.enabled);
        root.querySelector('[data-section="face_refine"]').classList.toggle("mmx-post-disabled", !config.face_refine.enabled);
    };
    const unsubscribe = store.subscribe(render);
    render(store.get());
    updateLocale(locale());

    if (fetchApi) fetchApi("/minimax/motion-director/postprocess_capabilities").then((response) => response.json()).then((caps) => {
        const fill = (path, rows) => {
            const select = root.querySelector(`[data-path="${path}"]`);
            const current = select.value;
            select.innerHTML = '<option value="">—</option>' + (rows || []).map((name) => `<option value="${name}">${name}</option>`).join("");
            select.value = current;
        };
        fill("global_refine.upscale_model", caps.upscale_models);
        fill("face_refine.detector_model", caps.face_detectors);
        fill("face_refine.fallback_detector", ["none", ...(caps.face_detectors || [])]);
        fill("face_refine.sam_model", caps.sam_models);
        const detectors=caps.face_detectors||[];
        const currentFace=store.get().face_refine;
        if(!currentFace.detector_model&&detectors.length){
            const preferred=detectors.find((name)=>/face.*yolo/i.test(String(name)))||detectors[0];
            store.patch("face_refine","detector_model",preferred);
        }
        capabilities = caps;
        const ds=root.querySelector('[data-capability="face_detector"]');
        if(ds){ds.textContent=detectors.length?"":POST_TEXT[locale()==="en"?"en":"zh"].no_face_detector;ds.classList.toggle("bad",!detectors.length);}
        const vsr = root.querySelector('[data-capability="nvidia_rtx_vsr"]');
        const ready = !!caps.dependencies?.nvidia_rtx_vsr;
        vsr.classList.toggle("bad", !ready);
        updateLocale(locale());
    }).catch(() => {});
    return { root, render, updateLocale, destroy: unsubscribe };
}

export { DEFAULT_CONFIG };
