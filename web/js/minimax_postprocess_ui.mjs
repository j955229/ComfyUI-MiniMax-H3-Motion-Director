const DEFAULT_CONFIG = Object.freeze({
    version: 1,
    global_refine: {
        enabled: false, mode: "refine", denoise: 0.25, steps: 0,
        seed_mode: "inherit", seed_offset: 1, skip_fl2v: false,
        upscale_method: "lanczos", upscale_model: "",
        resolution_mode: "follow_director", aspect: "16:9", megapixels: 1,
        width: 1376, height: 768,
    },
    face_refine: {
        enabled: false, detector: "ultralytics", detector_model: "", confidence: 0.35,
        select: "largest", crop_factor: 2, canvas_mode: "auto_capped_768", canvas_size: 768,
        smooth_method: "gaussian", smooth_window: 9, size_smooth_window: 13, size_mode: "adaptive",
        adaptive: true, base_denoise: 0.22, strength_small_face: 0.35,
        strength_large_face: 0.16, face_px_small: 96, face_px_large: 320,
        mask_mode: "rect", paste_region: "face_rect", feather: 0.12,
        colour_match: true, blend: 1, undetected_frames: "fade",
        identity_reference: "", identity_track: false, identity_threshold: 0.35,
        fallback_detector: "none", fallback_head_frac: 0.34, gamma: 1,
        denoise_smooth: 5, mask_dilation: 0.06, feather_scales_with_crop: true,
        sam_model: "", sam_threshold: 0.5, sam_dilation: 0.04, sam_temporal_smooth: 5,
    },
    preview: { enabled: true, preview_frames: 8, preview_fps: 12, max_resolution: 1024, jpeg_quality: 80, preview_every: 1 },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const POST_TEXT = {
    en: {
        global_title: "Global Refine", face_title: "Face Refine", sampling: "Second Sampling",
        upscale: "Upscale", detection_canvas: "Detection / Canvas", tracking_denoise: "Tracking / Per-frame Denoise",
        stitch: "Stitch", advanced: "Advanced Tracking / SAM", enabled: "ON / OFF", disabled: "Disabled",
        ready: "Ready", missing_no_downgrade: "Not installed (stage will fail without downgrade)",
    },
    zh: {
        global_title: "全局精修", face_title: "人脸精修", sampling: "二次采样",
        upscale: "放大", detection_canvas: "检测 / 画布", tracking_denoise: "跟踪 / 逐帧降噪",
        stitch: "回贴", advanced: "高级跟踪 / SAM", enabled: "开 / 关", disabled: "已停用",
        ready: "可用", missing_no_downgrade: "未安装（此阶段会失败，不会自动降级）",
    },
};

const POST_LABELS = {
    "global_refine.mode": ["Mode", "模式"], "global_refine.denoise": ["Denoise", "降噪强度"],
    "global_refine.steps": ["Steps (0=Auto)", "步数（0=自动）"], "global_refine.seed_mode": ["Seed Mode", "种子模式"],
    "global_refine.skip_fl2v": ["Skip FL2V", "跳过 FL2V"], "global_refine.upscale_method": ["Method", "放大方法"],
    "global_refine.upscale_model": ["Model", "模型"], "global_refine.resolution_mode": ["Resolution", "分辨率模式"],
    "global_refine.aspect": ["Aspect", "画幅比"], "global_refine.megapixels": ["Megapixels", "百万像素"],
    "global_refine.width": ["Width", "宽度"], "global_refine.height": ["Height", "高度"],
    "face_refine.detector": ["Detector", "检测器"], "face_refine.detector_model": ["Model", "模型"],
    "face_refine.confidence": ["Confidence", "置信度"], "face_refine.select": ["Select", "目标选择"],
    "face_refine.crop_factor": ["Crop Factor", "裁切倍率"], "face_refine.canvas_mode": ["Canvas", "画布模式"],
    "face_refine.canvas_size": ["Canvas Size", "画布尺寸"], "face_refine.smooth_method": ["Smooth", "平滑方法"],
    "face_refine.smooth_window": ["Centre Window", "中心平滑窗口"], "face_refine.size_smooth_window": ["Size Window", "尺寸平滑窗口"],
    "face_refine.size_mode": ["Size Mode", "尺寸模式"], "face_refine.adaptive": ["Adaptive", "自适应"],
    "face_refine.base_denoise": ["Base Denoise", "基础降噪"], "face_refine.strength_small_face": ["Small Face", "小脸强度"],
    "face_refine.strength_large_face": ["Large Face", "大脸强度"], "face_refine.face_px_small": ["Face px Small", "小脸像素阈值"],
    "face_refine.face_px_large": ["Face px Large", "大脸像素阈值"], "face_refine.mask_mode": ["Mask", "遮罩"],
    "face_refine.paste_region": ["Paste", "回贴区域"], "face_refine.feather": ["Feather", "羽化"],
    "face_refine.colour_match": ["Colour Match", "颜色匹配"], "face_refine.blend": ["Blend", "混合"],
    "face_refine.undetected_frames": ["Undetected", "未检测帧"], "face_refine.identity_reference": ["Identity Reference", "身份参考图"],
    "face_refine.identity_track": ["Identity Track", "身份跟踪"], "face_refine.identity_threshold": ["Identity Threshold", "身份阈值"],
    "face_refine.fallback_detector": ["Fallback Detector", "备用检测器"], "face_refine.fallback_head_frac": ["Fallback Head Frac", "备用头部比例"],
    "face_refine.gamma": ["Gamma", "伽马"], "face_refine.denoise_smooth": ["Denoise Smooth", "降噪平滑"],
    "face_refine.mask_dilation": ["Mask Dilation", "遮罩扩张"], "face_refine.feather_scales_with_crop": ["Feather scales", "羽化随裁切缩放"],
    "face_refine.sam_model": ["SAM Model", "SAM 模型"], "face_refine.sam_threshold": ["SAM Threshold", "SAM 阈值"],
    "face_refine.sam_dilation": ["SAM Dilation", "SAM 扩张"], "face_refine.sam_temporal_smooth": ["SAM Temporal", "SAM 时序平滑"],
};

const POST_OPTION_LABELS = {
    "global_refine.mode": { refine: ["Refine", "精修"], upscale: ["Upscale", "放大"] },
    "global_refine.seed_mode": { inherit: ["Inherit", "继承"], offset: ["Offset", "偏移"] },
    "global_refine.upscale_method": {
        lanczos: ["Lanczos", "Lanczos"], upscale_model: ["Upscale Model", "放大模型"],
        nvidia_rtx_vsr: ["NVIDIA RTX VSR", "NVIDIA RTX VSR"],
    },
    "global_refine.resolution_mode": {
        follow_director: ["Follow Director", "跟随 Director"],
        aspect_megapixels: ["Aspect + Megapixels", "画幅比 + 百万像素"], custom: ["Custom", "自定义"],
    },
    "face_refine.select": { largest: ["Largest", "最大脸"], most_central: ["Most central", "最靠近中心"] },
    "face_refine.canvas_mode": {
        manual: ["Manual", "手动"], auto_no_downscale: ["Auto, no downscale", "自动、不缩小"],
        auto_capped_768: ["Auto, capped at 768", "自动、上限 768"],
    },
    "face_refine.smooth_method": {
        gaussian: ["Gaussian", "高斯"], savgol: ["Savitzky–Golay", "Savitzky–Golay"],
        moving_average: ["Moving average", "移动平均"],
    },
    "face_refine.size_mode": { adaptive: ["Adaptive", "自适应"], stable: ["Stable", "稳定"] },
    "face_refine.mask_mode": { rect: ["Rectangle", "矩形"], ellipse: ["Ellipse", "椭圆"], sam: ["SAM", "SAM"] },
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
    for (const key of ["global_refine", "face_refine", "preview"]) {
        const legacy = key === "global_refine" ? raw.globalRefine : key === "face_refine" ? raw.faceRefine : null;
        Object.assign(result[key], legacy || {}, raw[key] || {});
    }
    if (raw.liveTaePreview === false || raw.live_tae_preview === false) result.preview.enabled = false;
    result.global_refine.enabled = !!result.global_refine.enabled;
    result.face_refine.enabled = !!result.face_refine.enabled;
    result.preview.enabled = result.preview.enabled !== false;
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

export function globalRefineSummary(config, width = 864, height = 480, locale = "en") {
    const global = normalizePostprocessConfig(config).global_refine;
    const zh = locale === "zh";
    if (!global.enabled) return POST_TEXT[zh ? "zh" : "en"].disabled;
    const steps = Number(global.steps) > 0 ? `${global.steps} ${zh ? "步" : "Steps"}` : (zh ? "自动步数" : "Auto Steps");
    if (global.mode === "upscale") {
        const [targetW, targetH] = resolveGlobalTarget(config, width, height);
        const methods = { lanczos: "Lanczos", upscale_model: global.upscale_model || "Upscale Model", nvidia_rtx_vsr: "NVIDIA RTX VSR" };
        return `${zh ? "放大" : "Upscale"} · ${targetW}×${targetH} · ${methods[global.upscale_method] || global.upscale_method} · D${Number(global.denoise).toFixed(2)} · ${steps}`;
    }
    return `${zh ? "精修" : "Refine"} · D${Number(global.denoise).toFixed(2)} · ${steps} · ${global.seed_mode === "offset" ? (zh ? "种子偏移" : "Seed Offset") : (zh ? "继承种子" : "Seed Inherit")}`;
}

export function faceRefineSummary(config, locale = "en") {
    const face = normalizePostprocessConfig(config).face_refine;
    const zh = locale === "zh";
    if (!face.enabled) return POST_TEXT[zh ? "zh" : "en"].disabled;
    const canvas = face.canvas_mode === "manual" ? `${face.canvas_size}` : face.canvas_mode === "auto_capped_768" ? (zh ? "自动 768" : "Auto 768") : (zh ? "自动" : "Auto");
    const detector = face.detector === "ultralytics" ? "YOLO" : "InsightFace";
    const adaptive = face.adaptive ? (zh ? "自适应" : "Adaptive") : `D${Number(face.base_denoise).toFixed(2)}`;
    const mask = face.mask_mode === "sam" ? "SAM" : face.mask_mode === "ellipse" ? (zh ? "椭圆" : "Ellipse") : (zh ? "矩形" : "Rect");
    return `${detector} · ${canvas} · ${adaptive} · ${mask}`;
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
                // A third-party widget callback must never prevent the
                // Director launcher/modal from mounting.  The serialized
                // widget value is already the workflow source of truth.
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
.mmx-post-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.mmx-post-head h3{margin:0;font-size:15px}
.mmx-post-enable{display:flex;align-items:center;gap:6px;color:#4fff8f;font-weight:650}.mmx-post-summary{min-height:18px;margin:0 0 8px;color:#aaa;font-size:11px}
.mmx-post-section{margin:7px 0;padding:7px;border:1px solid #2d2d2d;border-radius:6px;background:#1d1d1d}.mmx-post-section>h4{margin:0 0 6px;font-size:12px;color:#ddd}
.mmx-post-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 8px}.mmx-post-field{display:grid;grid-template-columns:minmax(82px,.9fr) minmax(0,1.2fr);align-items:center;gap:6px;min-width:0;font-size:11px;color:#aaa}
.mmx-post-field input,.mmx-post-field select{min-width:0;width:100%;height:26px;border:1px solid #3b3b3b;border-radius:4px;background:#242424;color:#ddd;padding:2px 5px;box-sizing:border-box}
.mmx-post-field input[type=checkbox]{width:auto;height:auto;justify-self:start}.mmx-post-wide{grid-column:1/-1}.mmx-post-advanced>summary{cursor:pointer;color:#bbb;font-size:12px;font-weight:650;padding:3px}
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

export function mountPostprocessUI(container, store, { fetchApi, directorSize = () => [864, 480], locale = () => "zh" } = {}) {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "mmx-postprocess";
    root.innerHTML = `
      <section class="mmx-post-column" data-section="global_refine">
        <div class="mmx-post-head"><h3 data-post-text="global_title">全局精修</h3><label class="mmx-post-enable"><input type="checkbox" data-path="global_refine.enabled"> <span data-post-text="enabled">ON / OFF</span></label></div>
        <p class="mmx-post-summary" data-summary="global_refine"></p>
        <div class="mmx-post-section"><h4 data-post-text="sampling">二次采样</h4><div class="mmx-post-grid">
          ${field("Mode", "global_refine.mode", "select", options([["refine","Refine"],["upscale","Upscale"]]))}
          ${field("Denoise", "global_refine.denoise", "number", 'min="0.01" max="1" step="0.01"')}
          ${field("Steps (0=Auto)", "global_refine.steps", "number", 'min="0" max="200" step="1"')}
          ${field("Seed Mode", "global_refine.seed_mode", "select", options([["inherit","Inherit"],["offset","Offset"]]))}
          ${field("Skip FL2V", "global_refine.skip_fl2v", "checkbox")}
        </div></div>
        <div class="mmx-post-section" data-upscale><h4 data-post-text="upscale">Upscale</h4><div class="mmx-post-grid">
          ${field("Method", "global_refine.upscale_method", "select", options([["lanczos","Lanczos"],["upscale_model","Upscale Model"],["nvidia_rtx_vsr","NVIDIA RTX VSR"]]))}
          ${field("Model", "global_refine.upscale_model", "select", '<option value="">—</option>')}
          ${field("Resolution", "global_refine.resolution_mode", "select", options([["follow_director","Follow Director"],["aspect_megapixels","Aspect + Megapixels"],["custom","Custom"]]))}
          ${field("Aspect", "global_refine.aspect", "select", options([["1:1","1:1"],["4:3","4:3"],["3:4","3:4"],["16:9","16:9"],["9:16","9:16"],["21:9","21:9"]]))}
          ${field("Megapixels", "global_refine.megapixels", "number", 'min="0.1" max="16" step="0.1"')}
          ${field("Width", "global_refine.width", "number", 'min="32" max="8192" step="32"')}
          ${field("Height", "global_refine.height", "number", 'min="32" max="8192" step="32"')}
          <div class="mmx-post-field mmx-post-wide"><span data-field-label="resolved_target">Resolved Target</span><b data-resolved-target></b></div>
          <div class="mmx-post-capability mmx-post-wide" data-capability="nvidia_rtx_vsr"></div>
        </div></div>
      </section>
      <section class="mmx-post-column" data-section="face_refine">
        <div class="mmx-post-head"><h3 data-post-text="face_title">人脸精修</h3><label class="mmx-post-enable"><input type="checkbox" data-path="face_refine.enabled"> <span data-post-text="enabled">ON / OFF</span></label></div>
        <p class="mmx-post-summary" data-summary="face_refine"></p>
        <div class="mmx-post-section"><h4 data-post-text="detection_canvas">Detection / Canvas</h4><div class="mmx-post-grid">
          ${field("Detector", "face_refine.detector", "select", options([["ultralytics","YOLO"],["insightface","InsightFace"]]))}
          ${field("Model", "face_refine.detector_model", "select", '<option value="">—</option>')}
          ${field("Confidence", "face_refine.confidence", "number", 'min="0.01" max="1" step="0.01"')}
          ${field("Select", "face_refine.select", "select", options([["largest","largest"],["most_central","most_central"]]))}
          ${field("Crop Factor", "face_refine.crop_factor", "number", 'min="1.05" max="5" step="0.05"')}
          ${field("Canvas", "face_refine.canvas_mode", "select", options([["manual","manual"],["auto_no_downscale","auto_no_downscale"],["auto_capped_768","auto_capped_768"]]))}
          ${field("Canvas Size", "face_refine.canvas_size", "number", 'min="256" max="1536" step="32"')}
        </div></div>
        <div class="mmx-post-section"><h4 data-post-text="tracking_denoise">Tracking / Per-frame Denoise</h4><div class="mmx-post-grid">
          ${field("Smooth", "face_refine.smooth_method", "select", options([["gaussian","gaussian"],["savgol","savgol"],["moving_average","moving_average"]]))}
          ${field("Centre Window", "face_refine.smooth_window", "number", 'min="1" max="101" step="2"')}
          ${field("Size Window", "face_refine.size_smooth_window", "number", 'min="1" max="101" step="2"')}
          ${field("Size Mode", "face_refine.size_mode", "select", options([["adaptive","adaptive"],["stable","stable"]]))}
          ${field("Adaptive", "face_refine.adaptive", "checkbox")}
          ${field("Base Denoise", "face_refine.base_denoise", "number", 'min="0.01" max="1" step="0.01"')}
          ${field("Small Face", "face_refine.strength_small_face", "number", 'min="0" max="1" step="0.01"')}
          ${field("Large Face", "face_refine.strength_large_face", "number", 'min="0" max="1" step="0.01"')}
          ${field("Face px Small", "face_refine.face_px_small", "number", 'min="8" max="4096" step="1"')}
          ${field("Face px Large", "face_refine.face_px_large", "number", 'min="8" max="8192" step="1"')}
        </div></div>
        <div class="mmx-post-section"><h4 data-post-text="stitch">Stitch</h4><div class="mmx-post-grid">
          ${field("Mask", "face_refine.mask_mode", "select", options([["rect","Rect"],["ellipse","Ellipse"],["sam","SAM"]]))}
          ${field("Paste", "face_refine.paste_region", "select", options([["face_rect","face_rect"],["full_crop","full_crop"]]))}
          ${field("Feather", "face_refine.feather", "number", 'min="0" max="1" step="0.01"')}
          ${field("Colour Match", "face_refine.colour_match", "checkbox")}
          ${field("Blend", "face_refine.blend", "number", 'min="0" max="1" step="0.01"')}
          ${field("Undetected", "face_refine.undetected_frames", "select", options([["fade","fade"],["skip","skip"]]))}
        </div></div>
        <details class="mmx-post-section mmx-post-advanced"><summary data-post-text="advanced">高级跟踪 / SAM</summary><div class="mmx-post-grid">
          ${field("Identity Reference", "face_refine.identity_reference", "text")}
          ${field("Identity Track", "face_refine.identity_track", "checkbox")}
          ${field("Identity Threshold", "face_refine.identity_threshold", "number", 'min="0" max="1" step="0.01"')}
          ${field("Fallback Detector", "face_refine.fallback_detector", "select", options([["none","none"]]))}
          ${field("Fallback Head Frac", "face_refine.fallback_head_frac", "number", 'min="0" max="1" step="0.01"')}
          ${field("Gamma", "face_refine.gamma", "number", 'min="0.1" max="4" step="0.1"')}
          ${field("Denoise Smooth", "face_refine.denoise_smooth", "number", 'min="1" max="51" step="2"')}
          ${field("Mask Dilation", "face_refine.mask_dilation", "number", 'min="0" max="1" step="0.01"')}
          ${field("Feather scales", "face_refine.feather_scales_with_crop", "checkbox")}
          ${field("SAM Model", "face_refine.sam_model", "select", '<option value="">—</option>')}
          ${field("SAM Threshold", "face_refine.sam_threshold", "number", 'min="0" max="1" step="0.01"')}
          ${field("SAM Dilation", "face_refine.sam_dilation", "number", 'min="0" max="1" step="0.01"')}
          ${field("SAM Temporal", "face_refine.sam_temporal_smooth", "number", 'min="1" max="51" step="2"')}
        </div></details>
      </section>`;
    container.replaceChildren(root);

    const readInput = (element) => element.type === "checkbox" ? element.checked
        : element.type === "number" ? Number(element.value) : element.value;
    root.addEventListener("change", (event) => {
        const input = event.target.closest?.("[data-path]") || event.target;
        const path = input?.dataset?.path;
        if (!path) return;
        const [section, key] = path.split(".");
        store.patch(section, key, readInput(input));
    });
    let capabilities = null;
    const updateLocale = (language = locale()) => {
        const lang = language === "en" ? "en" : "zh";
        root.querySelectorAll("[data-post-text]").forEach((element) => {
            element.textContent = POST_TEXT[lang][element.dataset.postText] || element.textContent;
        });
        root.querySelectorAll("[data-field-label]").forEach((element) => {
            const pair = element.dataset.fieldLabel === "resolved_target" ? ["Resolved Target", "解析目标尺寸"] : POST_LABELS[element.dataset.fieldLabel];
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
            vsr.textContent = `RTX VSR: ${POST_TEXT[lang][ready ? "ready" : "missing_no_downgrade"]}`;
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
        const [w, h] = directorSize();
        root.querySelector('[data-summary="global_refine"]').textContent = globalRefineSummary(config, w, h, locale());
        root.querySelector('[data-summary="face_refine"]').textContent = faceRefineSummary(config, locale());
        const [tw, th] = resolveGlobalTarget(config, w, h);
        root.querySelector("[data-resolved-target]").textContent = `${tw}×${th}`;
        root.querySelector("[data-upscale]").hidden = config.global_refine.mode !== "upscale";
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
        capabilities = caps;
        const vsr = root.querySelector('[data-capability="nvidia_rtx_vsr"]');
        vsr.textContent = caps.dependencies?.nvidia_rtx_vsr ? "RTX VSR dependency: Ready" : "RTX VSR dependency: Not installed (stage will fail without downgrade)";
        vsr.classList.toggle("bad", !caps.dependencies?.nvidia_rtx_vsr);
        updateLocale(locale());
    }).catch(() => {});
    return { root, render, updateLocale, destroy: unsubscribe };
}

export { DEFAULT_CONFIG };
