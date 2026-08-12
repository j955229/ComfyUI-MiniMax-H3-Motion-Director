// MiniMax H3 Motion Director — Material Library localized copy.

import { getLocale, onLocaleChange } from "./minimax_i18n.js";

const ZH = {
    button: "素材库", title: "素材库", close: "关闭", cancel: "关闭", apply: "应用", applying: "应用中…",
    image: "图片", audio: "音频", video: "视频", prompt: "Prompt", add: "新增素材", search: "搜索标题…",
    allCategories: "全部分类", empty: "这里还没有素材", emptySearch: "没有符合条件的素材",
    selected: "已选择", preview: "分配预览", previewEmpty: "尚未选择素材", target: "应用到", common: "公共素材",
    targetRequired: "请先选择应用目标", promptCommonBlocked: "Prompt 只能应用到 Segment，不能应用到公共素材",
    append: "追加", replace: "替换", promptMode: "Prompt 应用方式", first: "首帧", last: "尾帧", fl2vRole: "图片用途",
    leftRightHint: "左键添加一次 · 右键撤销最后一次", edit: "编辑", delete: "删除", rename: "标题",
    category: "分类", content: "Prompt 正文", save: "保存", confirmDelete: "确定删除「{title}」？",
    upload: "从电脑加入素材库", uploading: "正在保存 {name}…", saved: "已保存", applied: "素材已应用到 Director",
    error: "错误：{message}", sourceLocalOnly: "RV2V 的 Source Video 仍只能从电脑本地上传；当前 RV2V 素材库仅提供图片、音频和 Prompt。",
    promptNoShot: "FL2V 只有 Prompt、没有任何镜头/首尾帧，无法自动创建空镜头。",
    v2vNoVideo: "V2V 没有 Source Video，只有 Prompt 时无法创建可运行片段。",
    noFreeSlot: "{type} 已达到当前目标的素材上限，后续同类素材未加入。",
    createSegment: "将自动创建 S{n}", itemTo: "{type} {order} → {target}", promptJoined: "多个 Prompt 会按编号顺序组合后应用。",
    firstFrame: "首帧", lastFrame: "尾帧", sourceVideo: "Source Video", refPicture: "Reference Picture",
    refAudio: "Reference Audio", refVideo: "Reference Video", picture: "Picture", segment: "S{n}",
    categories_image: ["人物", "场景", "道具", "其他"],
    categories_audio: ["音色", "台词", "音效", "音乐", "其他"],
    categories_video: ["人物", "场景", "动作", "镜头", "其他"],
    categories_prompt: ["人物", "场景", "动作", "运镜", "风格", "对白", "其他"],
};

const EN = {
    button: "Library", title: "Material Library", close: "Close", cancel: "Close", apply: "Apply", applying: "Applying…",
    image: "Images", audio: "Audio", video: "Video", prompt: "Prompt", add: "Add material", search: "Search titles…",
    allCategories: "All categories", empty: "No materials yet", emptySearch: "No matching materials",
    selected: "Selected", preview: "Allocation preview", previewEmpty: "Nothing selected", target: "Apply to", common: "Common",
    targetRequired: "Choose an apply target first", promptCommonBlocked: "Prompts can only be applied to a Segment, not Common References.",
    append: "Append", replace: "Replace", promptMode: "Prompt mode", first: "First frame", last: "Last frame", fl2vRole: "Image role",
    leftRightHint: "Left-click adds · right-click removes the last occurrence", edit: "Edit", delete: "Delete", rename: "Title",
    category: "Category", content: "Prompt content", save: "Save", confirmDelete: "Delete “{title}”?",
    upload: "Add from computer", uploading: "Saving {name}…", saved: "Saved", applied: "Materials applied to Director",
    error: "Error: {message}", sourceLocalOnly: "RV2V Source Video stays local-upload only; the current RV2V library offers Images, Audio and Prompt only.",
    promptNoShot: "FL2V cannot create an anchorless shot from Prompt alone.",
    v2vNoVideo: "V2V cannot create runnable segments from Prompt without Source Video.",
    noFreeSlot: "{type} reached the current target limit; later items were skipped.",
    createSegment: "Will create S{n}", itemTo: "{type} {order} → {target}", promptJoined: "Multiple Prompts are joined in queue order before applying.",
    firstFrame: "First Frame", lastFrame: "Last Frame", sourceVideo: "Source Video", refPicture: "Reference Picture",
    refAudio: "Reference Audio", refVideo: "Reference Video", picture: "Picture", segment: "S{n}",
    categories_image: ["人物", "场景", "道具", "其他"],
    categories_audio: ["音色", "台词", "音效", "音乐", "其他"],
    categories_video: ["人物", "场景", "动作", "镜头", "其他"],
    categories_prompt: ["人物", "场景", "动作", "运镜", "风格", "对白", "其他"],
};

function dict() { return String(getLocale?.() || "zh").toLowerCase().startsWith("en") ? EN : ZH; }

export function mlT(key, vars = {}) {
    let value = dict()[key];
    if (value == null) value = ZH[key] ?? key;
    if (Array.isArray(value)) return [...value];
    return String(value).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

export function materialCategories(kind) {
    return mlT(`categories_${kind}`);
}

export function onMaterialLocaleChange(callback) {
    return onLocaleChange(callback);
}
