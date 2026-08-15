export const DIRECTOR_SECTION_IDS = Object.freeze([
    "bd_grp_sample",
    "bd_grp_motion",
    "mmx_postprocess_group",
    "bd_grp_perf",
]);

const COPY = Object.freeze({
    zh: {
        sections: {
            bd_grp_sample: "采样设置",
            bd_grp_motion: "跨段接续",
            mmx_postprocess_group: "后期处理",
            bd_grp_perf: "性能",
        },
        samplingStates: {
            internal: "内部",
            external: "外部",
            incomplete: "连接不完整",
        },
        widgets: {
            seed: "种子",
            control_after_generate: "生成后定制",
            "control after generate": "生成后定制",
            steps: "采样步数",
            sampler_name: "内置采样器",
            scheduler: "调度器",
            shift_video: "视频 Sigma Shift",
            shift_audio: "音频 Sigma Shift",
            motion_context_enabled: "运动上下文",
            context_length: "上下文帧数",
            pin_renorm_enabled: "潜变量尺度锁定",
            mmx_pin_renorm_proxy: "潜变量尺度锁定",
            source_overlap_frames: "源视频桥接",
            audio_context_enabled: "延续生成音频",
            color_reanchor_enabled: "颜色重锚定",
            mmx_global_refine_proxy: "全局精修",
            mmx_face_refine_proxy: "人脸精修",
            clear_vram_between_segments: "段间清理显存",
        },
    },
    en: {
        sections: {
            bd_grp_sample: "Sampling Settings",
            bd_grp_motion: "Cross-Segment Continuity",
            mmx_postprocess_group: "Post Processing",
            bd_grp_perf: "Performance",
        },
        samplingStates: {
            internal: "Internal",
            external: "External",
            incomplete: "Incomplete",
        },
        widgets: {
            seed: "Seed",
            control_after_generate: "Control After Generate",
            "control after generate": "Control After Generate",
            steps: "Sampling Steps",
            sampler_name: "Internal Sampler",
            scheduler: "Scheduler",
            shift_video: "Video Sigma Shift",
            shift_audio: "Audio Sigma Shift",
            motion_context_enabled: "Motion Context",
            context_length: "Context Frames",
            pin_renorm_enabled: "Latent Scale Lock",
            mmx_pin_renorm_proxy: "Latent Scale Lock",
            source_overlap_frames: "Source Video Bridge",
            audio_context_enabled: "Continue Generated Audio",
            color_reanchor_enabled: "Color Re-anchor",
            mmx_global_refine_proxy: "Global Refine",
            mmx_face_refine_proxy: "Face Refine",
            clear_vram_between_segments: "Clear VRAM Between Segments",
        },
    },
});

function localeKey(locale) {
    return String(locale || "").toLowerCase() === "en" ? "en" : "zh";
}

export function sectionTitle(locale, sectionId) {
    const lang = localeKey(locale);
    return COPY[lang].sections[sectionId] || String(sectionId || "");
}

export function samplingHeaderText(locale, state) {
    const lang = localeKey(locale);
    const normalized = ["internal", "external", "incomplete"].includes(state)
        ? state
        : "internal";
    return `${COPY[lang].sections.bd_grp_sample}  [${COPY[lang].samplingStates[normalized]}]`;
}

export function localizedWidgetLabel(locale, name) {
    const lang = localeKey(locale);
    return COPY[lang].widgets[String(name || "")] || String(name || "");
}

export function shouldShowInternalSampling(state) {
    return state !== "external";
}
