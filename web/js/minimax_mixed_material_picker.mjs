import { listMaterialLibrary } from "./minimax_material_library_api.mjs";

function closestElement(target, selector) {
    return target?.closest?.(selector) || null;
}

/**
 * Pick one item through the already-mounted Director Material Library modal.
 *
 * Newer controllers may expose a native `pick()` method; keep that as the
 * preferred path. The fallback adapts the existing modal without constructing
 * a second picker: it opens the same layer, temporarily presents the R2V type
 * set (image/audio/video are all legal there), and captures a card choice
 * before the normal allocation click handler mutates standalone timeline state.
 */
export async function pickMixedMaterial(editor, { type }) {
    const controller = editor?._materialLibraryController;
    if (!controller) {
        throw new Error("Material Library is not mounted on this Director.");
    }
    if (typeof controller.pick === "function") {
        return controller.pick({ type, multiple: false, maxCount: 1 });
    }

    const layer = controller.layer;
    if (!layer || typeof controller.open !== "function") {
        throw new Error("Material Library controller does not expose its existing modal.");
    }

    const wantedType = ["image", "audio", "video"].includes(type) ? type : "image";
    const originalGetTaskKey = editor.getTaskKey;
    const originalClose = controller.close;
    let itemsById = new Map();

    try {
        const response = await listMaterialLibrary({ type: wantedType });
        itemsById = new Map((response?.items || []).map((item) => [String(item.id), item]));
    } catch {
        // The modal has its own error handling/reload path. Preserve the same
        // modal instead of silently falling back to a second UI.
    }

    return new Promise(async (resolve, reject) => {
        let settled = false;
        let closeWrapped = false;

        const cleanup = () => {
            layer.removeEventListener("click", onClick, true);
            if (closeWrapped) {
                if (originalClose) controller.close = originalClose;
                else delete controller.close;
                closeWrapped = false;
            }
        };

        const finish = (value) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value ?? null);
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const closeExistingModal = () => {
            if (typeof originalClose === "function") {
                originalClose.call(controller);
            }
        };

        const onClick = (event) => {
            const card = closestElement(event.target, ".mmx-ml-card");
            if (card && String(card.dataset.type || "") === wantedType) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const item = itemsById.get(String(card.dataset.id || ""));
                if (!item) return;
                // Resolve and restore the controller before closing it. That
                // prevents our temporary close wrapper from converting a real
                // selection into a cancellation.
                finish(item);
                closeExistingModal();
                return;
            }
            if (closestElement(event.target, '[data-ml="close"], [data-ml="cancel"]')) {
                // The existing modal buttons call a private `close` closure,
                // not necessarily controller.close(), so settle explicitly.
                queueMicrotask(() => finish(null));
            }
        };

        layer.addEventListener("click", onClick, true);
        if (typeof originalClose === "function") {
            controller.close = function (...args) {
                const result = originalClose.apply(this, args);
                finish(null);
                return result;
            };
            closeWrapped = true;
        }

        try {
            // The existing Material Library does not yet have a Mixed allocation
            // mode. R2V is used only while opening the picker because it exposes
            // all three media tabs; capture prevents allocation into standalone
            // timeline state.
            editor.getTaskKey = () => "r2v";
            if (controller.state) controller.state.activeType = wantedType;
            await controller.open();
            if (controller.state) controller.state.activeType = wantedType;
        } catch (error) {
            fail(error);
        } finally {
            if (originalGetTaskKey) editor.getTaskKey = originalGetTaskKey;
            else delete editor.getTaskKey;
        }
    });
}
