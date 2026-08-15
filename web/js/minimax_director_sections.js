import { app } from "../../scripts/app.js";
import { getLocale } from "./minimax_i18n.js";
import { getSamplingConnectionState } from "./minimax_sampling_ui.js";
import {
    localizedWidgetLabel,
    samplingHeaderText,
    sectionTitle,
    shouldShowInternalSampling,
} from "./minimax_director_sections_core.mjs?boot=director_sections_v1";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const SYNC_MS = 250;
const SECTION_GAP = 9;

const INTERNAL_SAMPLING = Object.freeze([
    "steps",
    "sampler_name",
    "scheduler",
    "shift_video",
    "shift_audio",
]);

const PROXY_BY_SOURCE = Object.freeze({
    steps: "mmx_section_steps_proxy",
    sampler_name: "mmx_section_sampler_proxy",
    scheduler: "mmx_section_scheduler_proxy",
    shift_video: "mmx_section_shift_video_proxy",
    shift_audio: "mmx_section_shift_audio_proxy",
});

const SOURCE_BY_PROXY = Object.freeze(
    Object.fromEntries(
        Object.entries(PROXY_BY_SOURCE).map(([source, proxy]) => [proxy, source]),
    ),
);

const GAP_BEFORE = Object.freeze([
    ["bd_grp_motion", "mmx_section_gap_motion"],
    ["mmx_postprocess_group", "mmx_section_gap_postprocess"],
    ["bd_grp_perf", "mmx_section_gap_perf"],
]);

const FIXED_LABEL_WIDGETS = Object.freeze([
    "seed",
    "motion_context_enabled",
    "context_length",
    "source_overlap_frames",
    "audio_context_enabled",
    "color_reanchor_enabled",
    "pin_renorm_enabled",
    "mmx_pin_renorm_proxy",
    "mmx_global_refine_proxy",
    "mmx_face_refine_proxy",
    "clear_vram_between_segments",
]);

function widgetByName(node, name) {
    return node?.widgets?.find((widget) => widget?.name === name) || null;
}

function allNodeWidgets(node) {
    const widgets = [...(node?.widgets || [])];
    const seed = widgetByName(node, "seed");
    for (const linked of seed?.linkedWidgets || []) {
        if (linked && !widgets.includes(linked)) widgets.push(linked);
    }
    return widgets;
}

function rememberVisibility(widget, key) {
    if (!widget || widget[key]) return;
    widget[key] = {
        computeSize: widget.computeSize,
        hidden: widget.hidden,
        optionHidden: widget.options?.hidden,
        display: widget.element?.style?.display ?? "",
    };
}

function hideWidget(widget, key = "_mmxSectionHiddenState") {
    if (!widget) return false;
    rememberVisibility(widget, key);
    let changed = widget.hidden !== true || widget.options?.hidden !== true;
    widget.hidden = true;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.computeSize = () => [0, 0];
    if (widget.element?.style) {
        if (widget.element.style.display !== "none") changed = true;
        widget.element.style.display = "none";
    }
    return changed;
}

function setTransientVisible(widget, visible) {
    if (!widget) return false;
    const key = "_mmxSectionProxyVisibility";
    rememberVisibility(widget, key);
    const saved = widget[key];
    const currentlyVisible = widget.hidden !== true && widget.options?.hidden !== true;
    if (visible) {
        widget.computeSize = saved.computeSize;
        widget.hidden = false;
        widget.options = widget.options || {};
        delete widget.options.hidden;
        if (widget.element?.style) widget.element.style.display = saved.display || "";
    } else {
        widget.hidden = true;
        widget.options = widget.options || {};
        widget.options.hidden = true;
        widget.computeSize = () => [0, 0];
        if (widget.element?.style) widget.element.style.display = "none";
    }
    return currentlyVisible !== visible;
}

function setWidgetLabel(widget, label) {
    if (!widget || !label) return false;
    let changed = false;
    if (widget.label !== label) {
        widget.label = label;
        changed = true;
    }
    widget.options = widget.options || {};
    if (widget.options.label !== label) {
        widget.options.label = label;
        changed = true;
    }
    if (widget.element && widget.element.textContent !== label && widget._bdGroupHeader) {
        widget.element.textContent = label;
        changed = true;
    }
    return changed;
}

function setHeaderLabel(widget, label) {
    if (!widget || !label) return false;
    let changed = setWidgetLabel(widget, label);
    if (widget._mmxSamplingStatusText !== label) {
        widget._mmxSamplingStatusText = label;
        changed = true;
    }
    if (widget._bdGroupLabel !== label) {
        widget._bdGroupLabel = label;
        changed = true;
    }
    if (widget.value !== label) {
        widget.value = label;
        changed = true;
    }
    if (widget.element && widget.element.textContent !== label) {
        widget.element.textContent = label;
        changed = true;
    }
    return changed;
}

function proxyOptions(original) {
    const options = { ...(original?.options || {}) };
    options.serialize = false;
    delete options.hidden;
    return options;
}

function createSamplingProxy(node, sourceName) {
    const original = widgetByName(node, sourceName);
    if (!original || typeof node?.addWidget !== "function") return null;

    const proxyName = PROXY_BY_SOURCE[sourceName];
    let proxy = widgetByName(node, proxyName);
    if (proxy) return proxy;

    proxy = node.addWidget(
        original.type || "number",
        proxyName,
        original.value,
        (value) => {
            original.value = value;
            if (typeof original.callback === "function") {
                try {
                    original.callback.call(original, value);
                } catch {
                    // The five internal sampling widgets do not require callback side effects.
                }
            }
            node.setDirtyCanvas?.(true, true);
        },
        proxyOptions(original),
    );

    if (!proxy) return null;
    proxy.serialize = false;
    proxy.options = proxy.options || {};
    proxy.options.serialize = false;
    proxy._mmxSectionProxySource = sourceName;
    return proxy;
}

function ensureSamplingProxies(node) {
    const proxies = INTERNAL_SAMPLING
        .map((name) => createSamplingProxy(node, name))
        .filter(Boolean);

    if (!proxies.length || !Array.isArray(node?.widgets)) return proxies;

    for (const proxy of proxies) {
        const index = node.widgets.indexOf(proxy);
        if (index >= 0) node.widgets.splice(index, 1);
    }

    let insertIndex = node.widgets.findIndex((widget) => widget?.name === "bd_grp_motion");
    if (insertIndex < 0) {
        insertIndex = node.widgets.findIndex((widget) => widget?.name === "mmx_postprocess_group");
    }
    if (insertIndex < 0) {
        insertIndex = node.widgets.findIndex((widget) => widget?.name === "bd_grp_perf");
    }
    if (insertIndex < 0) insertIndex = node.widgets.length;

    node.widgets.splice(insertIndex, 0, ...proxies);
    return proxies;
}

function createGapWidget(name) {
    return {
        name,
        type: "MMX_SECTION_GAP",
        value: null,
        serialize: false,
        options: { serialize: false },
        computeSize() {
            return [0, SECTION_GAP];
        },
        draw() {},
    };
}

function ensureGapBefore(node, headerName, gapName) {
    if (!Array.isArray(node?.widgets)) return false;
    let gap = widgetByName(node, gapName);
    if (!gap) gap = createGapWidget(gapName);

    const oldIndex = node.widgets.indexOf(gap);
    if (oldIndex >= 0) node.widgets.splice(oldIndex, 1);

    const headerIndex = node.widgets.findIndex((widget) => widget?.name === headerName);
    if (headerIndex < 0) return false;
    node.widgets.splice(headerIndex, 0, gap);
    return true;
}

function syncSamplingValues(node, proxies) {
    let changed = false;
    for (const proxy of proxies) {
        const sourceName = SOURCE_BY_PROXY[proxy.name] || proxy._mmxSectionProxySource;
        const original = widgetByName(node, sourceName);
        if (!original) continue;
        if (proxy.value !== original.value) {
            proxy.value = original.value;
            changed = true;
        }
    }
    return changed;
}

function syncLocalizedLabels(node, locale, samplingState, proxies) {
    let changed = false;

    changed = setHeaderLabel(
        widgetByName(node, "bd_grp_sample"),
        samplingHeaderText(locale, samplingState),
    ) || changed;
    changed = setHeaderLabel(
        widgetByName(node, "bd_grp_motion"),
        sectionTitle(locale, "bd_grp_motion"),
    ) || changed;
    changed = setHeaderLabel(
        widgetByName(node, "mmx_postprocess_group"),
        sectionTitle(locale, "mmx_postprocess_group"),
    ) || changed;
    changed = setHeaderLabel(
        widgetByName(node, "bd_grp_perf"),
        sectionTitle(locale, "bd_grp_perf"),
    ) || changed;

    for (const name of FIXED_LABEL_WIDGETS) {
        changed = setWidgetLabel(
            widgetByName(node, name),
            localizedWidgetLabel(locale, name),
        ) || changed;
    }

    const seed = widgetByName(node, "seed");
    for (const linked of seed?.linkedWidgets || []) {
        const linkedName = String(linked?.name || linked?.label || "").toLowerCase();
        if (!/control[_\s]?after[_\s]?generate|生成后定制/.test(linkedName)) continue;
        changed = setWidgetLabel(
            linked,
            localizedWidgetLabel(locale, "control_after_generate"),
        ) || changed;
    }

    for (const proxy of proxies) {
        const sourceName = SOURCE_BY_PROXY[proxy.name] || proxy._mmxSectionProxySource;
        changed = setWidgetLabel(
            proxy,
            localizedWidgetLabel(locale, sourceName),
        ) || changed;
    }

    // The Chinese launcher label in the existing i18n table is "打开 Director".
    // Keep the node surface single-language without changing the shared modal title.
    for (const widget of node?.widgets || []) {
        const candidates = [widget?.label, widget?.value, widget?.name]
            .map((value) => String(value || ""));
        if (!candidates.some((value) => value === "打开 Director" || value === "Open Director" || value === "打开导演台")) {
            continue;
        }
        const label = locale === "en" ? "Open Director" : "打开导演台";
        changed = setWidgetLabel(widget, label) || changed;
        if (typeof widget.value === "string" && widget.value !== label) {
            widget.value = label;
            changed = true;
        }
    }

    return changed;
}

function widgetHeight(node, widget) {
    if (!widget || widget.hidden === true || widget.options?.hidden === true) return 0;
    try {
        const size = widget.computeSize?.(Number(node?.size?.[0]) || 320);
        const height = Number(Array.isArray(size) ? size[1] : 0);
        if (Number.isFinite(height) && height > 0) return height;
    } catch {
        // Fall through to the standard LiteGraph widget row height.
    }
    return 20;
}

function memberWidgets(node, names) {
    const all = allNodeWidgets(node);
    const wanted = new Set(names);
    return all.filter((widget) => wanted.has(widget?.name));
}

function groupBounds(node, names) {
    const rows = memberWidgets(node, names)
        .filter((widget) => Number.isFinite(Number(widget?.last_y)))
        .map((widget) => ({
            y: Number(widget.last_y),
            h: widgetHeight(node, widget),
        }))
        .filter((row) => row.h > 0);

    if (!rows.length) return null;
    const top = Math.min(...rows.map((row) => row.y));
    const bottom = Math.max(...rows.map((row) => row.y + row.h));
    if (!(bottom > top)) return null;
    return { top, bottom };
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        ctx.rect(x, y, width, height);
    }
}

function drawDirectorSectionFrames(node, ctx) {
    if (!ctx || node?.flags?.collapsed) return;

    const groups = [
        [
            "bd_grp_sample",
            "seed",
            "control_after_generate",
            "control after generate",
            ...Object.values(PROXY_BY_SOURCE),
        ],
        [
            "bd_grp_motion",
            "motion_context_enabled",
            "context_length",
            "source_overlap_frames",
            "audio_context_enabled",
            "color_reanchor_enabled",
            "pin_renorm_enabled",
            "mmx_pin_renorm_proxy",
        ],
        [
            "mmx_postprocess_group",
            "mmx_global_refine_proxy",
            "mmx_global_refine_summary",
            "mmx_face_refine_proxy",
            "mmx_face_refine_summary",
        ],
        [
            "bd_grp_perf",
            "clear_vram_between_segments",
        ],
    ];

    const width = Math.max(1, Number(node?.size?.[0]) || 320);
    ctx.save();
    for (const names of groups) {
        const bounds = groupBounds(node, names);
        if (!bounds) continue;
        const x = 8;
        const y = bounds.top - 3;
        const w = Math.max(1, width - 16);
        const h = Math.max(1, bounds.bottom - bounds.top + 6);
        roundedRect(ctx, x, y, w, h, 7);
        ctx.fillStyle = "rgba(12, 12, 12, 0.18)";
        ctx.fill();
        ctx.strokeStyle = "rgba(105, 105, 105, 0.72)";
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();
}

function syncDirectorSections(node) {
    if (!node || !Array.isArray(node.widgets)) return;

    const locale = getLocale() === "en" ? "en" : "zh";
    const samplingState = getSamplingConnectionState(node.inputs || []);
    const showInternal = shouldShowInternalSampling(samplingState);
    let changed = false;

    const proxies = ensureSamplingProxies(node);

    for (const name of INTERNAL_SAMPLING) {
        changed = hideWidget(widgetByName(node, name)) || changed;
    }
    changed = hideWidget(widgetByName(node, "bd_grp_advanced")) || changed;
    changed = hideWidget(widgetByName(node, "bd_grp_experimental")) || changed;

    const sourceImages = widgetByName(node, "export_source_images");
    if (sourceImages) {
        if (sourceImages.value !== false) {
            sourceImages.value = false;
            changed = true;
        }
        changed = hideWidget(sourceImages) || changed;
    }

    for (const proxy of proxies) {
        changed = setTransientVisible(proxy, showInternal) || changed;
    }

    changed = syncSamplingValues(node, proxies) || changed;
    changed = syncLocalizedLabels(node, locale, samplingState, proxies) || changed;

    for (const [headerName, gapName] of GAP_BEFORE) {
        ensureGapBefore(node, headerName, gapName);
    }

    const signature = `${locale}|${samplingState}|${showInternal ? 1 : 0}`;
    if (node._mmxSectionSignature !== signature) {
        node._mmxSectionSignature = signature;
        changed = true;
    }

    if (changed) {
        const computed = node.computeSize?.();
        if (computed && Array.isArray(node.size)) {
            node.setSize?.([
                Math.max(Number(node.size[0]) || 0, Number(computed[0]) || 0),
                Number(computed[1]) || Number(node.size[1]) || 100,
            ]);
        }
        node.setDirtyCanvas?.(true, true);
    }
}

function scheduleSync(node, delay = 0) {
    if (!node) return;
    clearTimeout(node._mmxSectionSyncTimeout);
    node._mmxSectionSyncTimeout = setTimeout(() => {
        node._mmxSectionSyncTimeout = null;
        syncDirectorSections(node);
    }, delay);
}

function wrapDirector(nodeType) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        clearInterval(this._mmxSectionPoll);
        this._mmxSectionPoll = setInterval(() => syncDirectorSections(this), SYNC_MS);
        scheduleSync(this, 0);
        scheduleSync(this, 120);
        return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        scheduleSync(this, 0);
        scheduleSync(this, 180);
        return result;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = onConnectionsChange?.apply(this, arguments);
        scheduleSync(this, 0);
        scheduleSync(this, 80);
        return result;
    };

    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
        const result = onDrawBackground?.apply(this, arguments);
        drawDirectorSectionFrames(this, ctx);
        return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        clearInterval(this._mmxSectionPoll);
        clearTimeout(this._mmxSectionSyncTimeout);
        this._mmxSectionPoll = null;
        this._mmxSectionSyncTimeout = null;
        return onRemoved?.apply(this, arguments);
    };
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.MainSections",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;
        wrapDirector(nodeType);
    },
});
