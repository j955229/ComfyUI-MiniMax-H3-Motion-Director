import { app } from "../../scripts/app.js";

const OVERLAY_SELECTOR = ".mmx-director-page-overlay";
const SHELL_SELECTOR = ".mmx-director-page-shell";

function desiredAriaModal(overlay) {
    return (
        overlay?.hidden !== true
        && overlay?.getAttribute?.("aria-hidden") !== "true"
    ) ? "true" : "false";
}

function syncOverlay(overlay) {
    if (!overlay?.matches?.(OVERLAY_SELECTOR)) return false;
    const shell = overlay.querySelector?.(SHELL_SELECTOR);
    if (!shell?.setAttribute) return false;

    const desired = desiredAriaModal(overlay);
    if (shell.getAttribute?.("aria-modal") === desired) return false;
    shell.setAttribute("aria-modal", desired);
    return true;
}

function syncTree(root = document) {
    let changed = false;
    if (root?.matches?.(OVERLAY_SELECTOR)) {
        changed = syncOverlay(root) || changed;
    }
    for (const overlay of root?.querySelectorAll?.(OVERLAY_SELECTOR) || []) {
        changed = syncOverlay(overlay) || changed;
    }
    return changed;
}

let observer = null;

function installGuard() {
    syncTree(document);
    if (observer || typeof MutationObserver !== "function") return;

    observer = new MutationObserver((records) => {
        for (const record of records) {
            if (
                record.type === "attributes"
                && (record.attributeName === "hidden" || record.attributeName === "aria-hidden")
            ) {
                syncOverlay(record.target);
                continue;
            }

            if (record.type === "childList") {
                for (const node of record.addedNodes || []) syncTree(node);
            }
        }
    });

    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden"],
    });

    queueMicrotask(() => syncTree(document));
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.ModalStateGuard",
    setup() {
        installGuard();
    },
});
