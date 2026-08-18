import { app } from "../../scripts/app.js";
import {
    copyReportText,
    reportResizeMaxHeight,
    staleDirectorOutputIndices,
} from "./minimax_director_outputs_core.mjs?boot=director_outputs_v2";

const DIRECTOR_CLASS = "MiniMaxH3MotionDirector";
const REPORT_STYLE_ID = "mmx-director-report-tools";
const reportEnhancements = new Map();
let reportMutationObserver = null;

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
`;
    document.head.appendChild(style);
}

function reportIsEnglish(heading) {
    return String(heading?.textContent || "").trim().toLowerCase() === "report";
}

function syncCopyButton(button, report, heading) {
    const english = reportIsEnglish(heading);
    const copied = button.dataset.copyState === "copied";
    button.disabled = !report.dataset.hasReport;
    button.textContent = copied ? (english ? "Copied" : "已复制") : (english ? "Copy" : "复制");
    button.title = english ? "Copy report" : "复制报告";
    button.setAttribute("aria-label", button.title);
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
    const maxHeight = reportResizeMaxHeight(containerBottom, reportRect.top, 12);
    report.style.maxHeight = `${maxHeight}px`;
    if (maxHeight > 0 && reportRect.height > maxHeight) {
        report.style.height = `${maxHeight}px`;
    }
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

function scanReportEnhancements(root = document) {
    const reports = [];
    if (root?.matches?.(".mmx-output-report[data-report]")) reports.push(root);
    root?.querySelectorAll?.(".mmx-output-report[data-report]").forEach((report) => reports.push(report));
    reports.forEach(enhanceReport);

    for (const [report, state] of reportEnhancements.entries()) {
        if (report.isConnected) {
            state.sync();
            continue;
        }
        state.destroy();
        reportEnhancements.delete(report);
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
        attributeFilter: ["data-has-report"],
    });
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.PublicOutputs",

    setup() {
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
