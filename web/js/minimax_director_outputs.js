import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    copyReportText,
    refinePassOptions,
    reportResizeMaxHeight,
    staleDirectorOutputIndices,
} from "./minimax_director_outputs_core.mjs?boot=director_outputs_v3";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const REPORT_STYLE_ID = "mmx-director-report-tools";
const reportEnhancements = new Map();
const resultEnhancements = new Map();
const refineResults = new Map();
let reportMutationObserver = null;
let eventListenersStarted = false;
let capabilitiesPromise = null;

function stripStaleDirectorOutputs(node) {
    const stale = staleDirectorOutputIndices(node?.outputs || []);
    if (!stale.length) return false;

    for (const index of stale) {
        try {
            node.disconnectOutput?.(index);
        } catch {
            // removeOutput also severs stale serialized links in normal LiteGraph.
        }
        node.removeOutput?.(index);
    }

    node.setDirtyCanvas?.(true, true);
    return true;
}

function scheduleCleanup(node) {
    stripStaleDirectorOutputs(node);
    setTimeout(() => stripStaleDirectorOutputs(node), 0);
    setTimeout(() => stripStaleDirectorOutputs(node), 250);
}

function ensureReportStyles() {
    if (document.getElementById(REPORT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = REPORT_STYLE_ID;
    style.textContent = `
.mmx-report-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
.mmx-report-toolbar>h4{margin:0!important;min-width:0}
.mmx-report-copy{flex:0 0 auto;height:24px;padding:0 9px;border:1px solid #3d3d3d;border-radius:4px;background:#242424;color:#ccc;font-size:10px;cursor:pointer}
.mmx-report-copy:hover:not(:disabled){border-color:#4fff8f;color:#fff}
.mmx-report-copy:disabled{opacity:.4;cursor:not-allowed}
.mmx-output-report[data-mmx-report-resizable]{box-sizing:border-box;width:100%;max-width:100%;min-width:0;min-height:72px;resize:vertical;overflow:auto}
.mmx-refine-result-label{color:#aaa;font-size:11px;white-space:nowrap}
.mmx-refine-result-select{min-width:120px;max-width:180px;height:26px;border:1px solid #383838;border-radius:4px;background:#222;color:#ddd}
`;
    document.head.appendChild(style);
}

function reportIsEnglish(heading) {
    return String(heading?.textContent || "").trim().toLowerCase() === "report";
}

function postprocessIsEnglish(root) {
    const text = String(root?.querySelector('[data-post-text="sampling"]')?.textContent || "").toLowerCase();
    return text.includes("second sampling");
}

function syncCopyButton(button, report, heading) {
    const english = reportIsEnglish(heading);
    const copied = button.dataset.copyState === "copied";
    const label = copied ? (english ? "Copied" : "已复制") : (english ? "Copy" : "复制");
    const title = english ? "Copy report" : "复制报告";
    button.disabled = !report.dataset.hasReport;
    if (button.textContent !== label) button.textContent = label;
    if (button.title !== title) button.title = title;
    if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
}

function fallbackClipboardWrite(text) {
    const textarea = document.createElement("textarea");
    textarea.value = String(text || "");
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-10000px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard API unavailable");
}

async function writeClipboard(text) {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(String(text || ""));
            return;
        } catch {
            // Fall through to the legacy copy path when clipboard permission is denied.
        }
    }
    fallbackClipboardWrite(text);
}

function refreshReportMaxHeight(report) {
    if (!report?.isConnected) return;
    const page = report.closest(".mmx-director-page-content");
    if (!page) return;

    const reportRect = report.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const shellRect = report.closest(".mmx-director-page-shell")?.getBoundingClientRect();
    const containerBottom = shellRect
        ? Math.min(pageRect.bottom, shellRect.bottom - 8)
        : pageRect.bottom;
    const pageMaxHeight = Math.max(0, Math.floor(pageRect.height - 20));
    const reportIsVisible = reportRect.top >= pageRect.top && reportRect.top < pageRect.bottom;
    const remainingHeight = reportResizeMaxHeight(containerBottom, reportRect.top, 12);
    const maxHeight = reportIsVisible
        ? Math.min(pageMaxHeight, remainingHeight)
        : pageMaxHeight;
    report.style.maxHeight = `${maxHeight}px`;
}

function enhanceReport(report) {
    const existing = reportEnhancements.get(report);
    if (existing) {
        existing.sync();
        existing.refresh();
        return;
    }

    const card = report.closest(".mmx-output-card");
    if (!card) return;

    ensureReportStyles();
    report.dataset.mmxReportResizable = "1";

    const heading = Array.from(card.children).find(
        (element) => String(element.tagName || "").toUpperCase() === "H4",
    ) || null;
    const toolbar = document.createElement("div");
    toolbar.className = "mmx-report-toolbar";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "mmx-report-copy";
    copyButton.dataset.copyState = "idle";

    if (heading) {
        card.insertBefore(toolbar, heading);
        toolbar.append(heading, copyButton);
    } else {
        card.insertBefore(toolbar, report);
        toolbar.append(copyButton);
    }

    let feedbackTimer = null;
    const refresh = () => refreshReportMaxHeight(report);
    const sync = () => syncCopyButton(copyButton, report, heading);
    const handleCopy = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!report.dataset.hasReport) return;
        try {
            const copied = await copyReportText(report.textContent, writeClipboard);
            if (!copied) return;
            copyButton.dataset.copyState = "copied";
            sync();
            if (feedbackTimer != null) clearTimeout(feedbackTimer);
            feedbackTimer = setTimeout(() => {
                feedbackTimer = null;
                copyButton.dataset.copyState = "idle";
                sync();
            }, 1200);
        } catch (error) {
            console.warn("[MiniMax H3 Motion Director] report copy failed:", error);
        }
    };

    const page = report.closest(".mmx-director-page-content");
    const rightColumn = report.closest(".mmx-output-right");
    const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(refresh)
        : null;
    resizeObserver?.observe(report);

    report.addEventListener("pointerdown", refresh);
    page?.addEventListener("scroll", refresh, { passive: true });
    if (rightColumn && rightColumn !== page) {
        rightColumn.addEventListener("scroll", refresh, { passive: true });
    }
    window.addEventListener("resize", refresh);
    copyButton.addEventListener("click", handleCopy);

    const destroy = () => {
        if (feedbackTimer != null) clearTimeout(feedbackTimer);
        resizeObserver?.disconnect();
        report.removeEventListener("pointerdown", refresh);
        page?.removeEventListener("scroll", refresh);
        if (rightColumn && rightColumn !== page) {
            rightColumn.removeEventListener("scroll", refresh);
        }
        window.removeEventListener("resize", refresh);
        copyButton.removeEventListener("click", handleCopy);
    };

    reportEnhancements.set(report, { destroy, refresh, sync });
    requestAnimationFrame(refresh);
    sync();
}

function fetchCapabilities() {
    if (!capabilitiesPromise) {
        const requester = typeof api?.fetchApi === "function"
            ? (path) => api.fetchApi(path)
            : (path) => fetch(path);
        capabilitiesPromise = requester("/minimax/motion-director/postprocess_capabilities")
            .then((response) => response.json())
            .catch((error) => {
                console.warn("[MiniMax H3 Motion Director] refine model list unavailable:", error);
                return { diffusion_models: [] };
            });
    }
    return capabilitiesPromise;
}

function requestPostprocessRender(root) {
    const existing = root.querySelector('[data-path="global_refine.denoise"]')
        || root.querySelector("[data-path]");
    existing?.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncMultiPassLabels(root) {
    const english = postprocessIsEnglish(root);
    const modelLabel = root.querySelector("[data-mmx-refine-model-label]");
    const passesLabel = root.querySelector("[data-mmx-refine-passes-label]");
    const follow = root.querySelector('[data-path="global_refine.refine_model"] option[value=""]');
    if (modelLabel) modelLabel.textContent = english ? "Refine Model" : "二采模型";
    if (passesLabel) passesLabel.textContent = english ? "Passes" : "采样轮数";
    if (follow) follow.textContent = english ? "Follow First Pass" : "跟随一采";
}

function injectMultiPassControls(root) {
    const body = root?.querySelector?.("[data-second-sampling-body]");
    const grid = body?.querySelector?.(".mmx-post-grid");
    if (!grid) return false;

    let modelSelect = root.querySelector('[data-path="global_refine.refine_model"]');
    let passesInput = root.querySelector('[data-path="global_refine.passes"]');
    if (!modelSelect) {
        const modelField = document.createElement("label");
        modelField.className = "mmx-post-field";
        modelField.dataset.mmxRefineModelField = "";
        modelField.innerHTML = `
          <span data-mmx-refine-model-label>二采模型</span>
          <select data-path="global_refine.refine_model">
            <option value="">跟随一采</option>
          </select>`;

        const passesField = document.createElement("label");
        passesField.className = "mmx-post-field";
        passesField.dataset.mmxRefinePassesField = "";
        passesField.innerHTML = `
          <span data-mmx-refine-passes-label>采样轮数</span>
          <input type="number" min="1" max="9999" step="1" value="1" data-path="global_refine.passes">`;

        grid.prepend(modelField, passesField);
        modelSelect = modelField.querySelector("select");
        passesInput = passesField.querySelector("input");
        passesInput?.addEventListener("change", () => {
            const parsed = Math.trunc(Number(passesInput.value) || 1);
            const clamped = Math.max(1, Math.min(9999, parsed));
            if (String(clamped) !== passesInput.value) passesInput.value = String(clamped);
        });

        fetchCapabilities().then((caps) => {
            if (!modelSelect?.isConnected) return;
            const rows = Array.isArray(caps?.diffusion_models) ? caps.diffusion_models : [];
            modelSelect.innerHTML = '<option value="">跟随一采</option>'
                + rows.map((name) => {
                    const value = String(name);
                    const escaped = value
                        .replaceAll("&", "&amp;")
                        .replaceAll('"', "&quot;")
                        .replaceAll("<", "&lt;")
                        .replaceAll(">", "&gt;");
                    return `<option value="${escaped}">${escaped}</option>`;
                }).join("");
            syncMultiPassLabels(root);
            requestPostprocessRender(root);
            queueMicrotask(() => {
                if (passesInput?.isConnected && !passesInput.value) {
                    passesInput.value = "1";
                    passesInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });
        });
    }

    syncMultiPassLabels(root);
    return true;
}

function nodeResultStore(nodeId) {
    const key = String(nodeId || "");
    if (!refineResults.has(key)) refineResults.set(key, new Map());
    return refineResults.get(key);
}

function segmentResultStore(nodeId, segmentIndex) {
    const nodeStore = nodeResultStore(nodeId);
    const index = Number(segmentIndex || 0);
    if (!nodeStore.has(index)) {
        nodeStore.set(index, {
            variants: new Map(),
            passCount: 0,
            selected: "final",
        });
    }
    return nodeStore.get(index);
}

function activeResultsRoot() {
    return document.querySelector(
        ".mmx-director-page-overlay:not([hidden]) .mmx-results-output",
    );
}

function rootsForNode(nodeId) {
    const key = String(nodeId || "");
    return [...document.querySelectorAll(".mmx-results-output")]
        .filter((root) => String(root.dataset.mmxNodeId || "") === key);
}

function associateResultsRoot(nodeId) {
    const key = String(nodeId || "");
    if (!key) return [];
    let roots = rootsForNode(key);
    if (roots.length) return roots;

    const active = activeResultsRoot();
    if (active && (!active.dataset.mmxNodeId || active.dataset.mmxNodeId === key)) {
        active.dataset.mmxNodeId = key;
        return [active];
    }

    const all = [...document.querySelectorAll(".mmx-results-output")];
    if (all.length === 1 && !all[0].dataset.mmxNodeId) {
        all[0].dataset.mmxNodeId = key;
        return [all[0]];
    }
    return [];
}

function dispatchStoredResult(detail) {
    if (!detail || typeof api?.dispatchEvent !== "function") return false;
    const replay = {
        ...detail,
        live: false,
        result_kind: "segment",
        mmx_refine_replay: true,
    };
    api.dispatchEvent(new CustomEvent(
        "minimax_motion_director_preview",
        { detail: replay },
    ));
    return true;
}

function syncResultSelector(root, { replay = false } = {}) {
    const state = resultEnhancements.get(root);
    if (!state || !root.isConnected) return;
    const nodeId = String(root.dataset.mmxNodeId || "");
    const segmentIndex = Number(state.segmentSelect.value || 0);
    const record = refineResults.get(nodeId)?.get(segmentIndex) || null;
    const activeTab = root.querySelector('[data-result-tab].active')?.dataset?.resultTab || "segment";
    const hasPasses = !!record && record.passCount > 0 && record.variants.size > 0;

    state.label.hidden = activeTab !== "segment" || !hasPasses;
    state.select.hidden = activeTab !== "segment" || !hasPasses;
    if (!hasPasses) return;

    let options = refinePassOptions(record.passCount)
        .filter((row) => record.variants.has(row.value));
    if (!options.length) return;
    if (!options.some((row) => row.value === record.selected)) {
        record.selected = record.variants.has("final")
            ? "final"
            : options.at(-1).value;
    }

    const oldValue = state.select.value;
    state.select.innerHTML = options
        .map((row) => `<option value="${row.value}">${row.label}</option>`)
        .join("");
    state.select.value = record.selected;
    if (!state.select.value) state.select.value = oldValue || options.at(-1).value;

    const english = String(root.querySelector('[data-result-tab="final"]')?.textContent || "")
        .toLowerCase().includes("final");
    state.label.textContent = english ? "Result" : "结果";

    if (replay) {
        const stored = record.variants.get(record.selected);
        if (stored) dispatchStoredResult(stored);
    }
}

function enhanceResultsRoot(root) {
    const existing = resultEnhancements.get(root);
    if (existing) {
        syncResultSelector(root);
        return;
    }
    const source = root.querySelector(".mmx-result-source");
    const segmentSelect = root.querySelector("[data-segment-select]");
    if (!source || !segmentSelect) return;

    ensureReportStyles();
    const label = document.createElement("span");
    label.className = "mmx-refine-result-label";
    label.textContent = "结果";
    label.hidden = true;
    const select = document.createElement("select");
    select.className = "mmx-refine-result-select";
    select.dataset.refineResultSelect = "";
    select.hidden = true;
    segmentSelect.insertAdjacentElement("afterend", label);
    label.insertAdjacentElement("afterend", select);

    const handleResultChange = () => {
        const nodeId = String(root.dataset.mmxNodeId || "");
        const segmentIndex = Number(segmentSelect.value || 0);
        const record = refineResults.get(nodeId)?.get(segmentIndex);
        if (!record || !record.variants.has(select.value)) return;
        record.selected = select.value;
        dispatchStoredResult(record.variants.get(record.selected));
    };
    const handleSegmentChange = () => setTimeout(
        () => syncResultSelector(root, { replay: true }), 0,
    );
    const handleTabClick = () => setTimeout(
        () => syncResultSelector(root, { replay: true }), 0,
    );

    select.addEventListener("change", handleResultChange);
    segmentSelect.addEventListener("change", handleSegmentChange);
    root.querySelectorAll("[data-result-tab]").forEach((button) => {
        button.addEventListener("click", handleTabClick);
    });

    const destroy = () => {
        select.removeEventListener("change", handleResultChange);
        segmentSelect.removeEventListener("change", handleSegmentChange);
        root.querySelectorAll("[data-result-tab]").forEach((button) => {
            button.removeEventListener("click", handleTabClick);
        });
        label.remove();
        select.remove();
    };
    resultEnhancements.set(root, { destroy, label, select, segmentSelect });
    syncResultSelector(root);
}

function handlePreviewEvent(event) {
    const detail = event?.detail || {};
    if (detail.mmx_refine_replay || detail.live) return;
    const nodeId = String(detail.node_id || "");
    if (!nodeId) return;
    const kind = String(detail.result_kind || "segment");
    const segmentIndex = Number(detail.segment_index || 0);
    const record = segmentResultStore(nodeId, segmentIndex);

    if (kind === "refine_pass") {
        const variant = String(detail.result_variant || "");
        if (!variant) return;
        record.passCount = Math.max(record.passCount, Number(detail.pass_count || 0));
        record.variants.set(variant, { ...detail });
        if (!record.variants.has("final")) record.selected = variant;
    } else if (kind === "segment") {
        record.variants.set("final", { ...detail, result_variant: "final" });
        if (record.passCount > 0) record.selected = "final";
    } else {
        return;
    }

    const roots = associateResultsRoot(nodeId);
    roots.forEach((root) => {
        enhanceResultsRoot(root);
        syncResultSelector(root);
    });
}

function handleProgressEvent(event) {
    const detail = event?.detail || {};
    if (String(detail.phase || "") !== "plan") return;
    const nodeId = String(detail.node_id || "");
    if (!nodeId) return;
    refineResults.delete(nodeId);
    rootsForNode(nodeId).forEach((root) => syncResultSelector(root));
}

function startRefineEventListeners() {
    if (eventListenersStarted) return;
    eventListenersStarted = true;
    api.addEventListener?.("minimax_motion_director_preview", handlePreviewEvent);
    api.addEventListener?.("minimax_motion_director_progress", handleProgressEvent);
}

function scanReportEnhancements(root = document) {
    const reports = [];
    if (root?.matches?.(".mmx-output-report[data-report]")) reports.push(root);
    root?.querySelectorAll?.(".mmx-output-report[data-report]").forEach((report) => reports.push(report));
    reports.forEach(enhanceReport);

    const postRoots = [];
    if (root?.matches?.(".mmx-postprocess")) postRoots.push(root);
    root?.querySelectorAll?.(".mmx-postprocess").forEach((postRoot) => postRoots.push(postRoot));
    postRoots.forEach(injectMultiPassControls);

    const resultRoots = [];
    if (root?.matches?.(".mmx-results-output")) resultRoots.push(root);
    root?.querySelectorAll?.(".mmx-results-output").forEach((resultRoot) => resultRoots.push(resultRoot));
    resultRoots.forEach(enhanceResultsRoot);

    for (const [report, state] of reportEnhancements.entries()) {
        if (report.isConnected) {
            state.sync();
            continue;
        }
        state.destroy();
        reportEnhancements.delete(report);
    }
    for (const [resultRoot, state] of resultEnhancements.entries()) {
        if (resultRoot.isConnected) {
            syncResultSelector(resultRoot);
            continue;
        }
        state.destroy();
        resultEnhancements.delete(resultRoot);
    }
}

function startReportEnhancements() {
    if (reportMutationObserver) return;
    if (!document.body) {
        setTimeout(startReportEnhancements, 0);
        return;
    }

    scanReportEnhancements(document);
    reportMutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes?.forEach?.((node) => {
                if (node?.nodeType === 1) scanReportEnhancements(node);
            });
        }
        scanReportEnhancements(document);
    });
    reportMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["data-has-report", "class", "hidden"],
    });
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.PublicOutputs",

    setup() {
        startRefineEventListeners();
        startReportEnhancements();
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== DIRECTOR_CLASS) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            scheduleCleanup(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            scheduleCleanup(this);
            return result;
        };
    },
});
