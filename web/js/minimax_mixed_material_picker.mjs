import { listMaterialLibrary } from "./minimax_material_library_api.mjs";

function closestElement(target, selector) {
    return target?.closest?.(selector) || null;
}

/**
 * Pick one item through the already-mounted Director Material Library modal.
 *
 * Newer controllers may expose a native `pick()` method; keep that as the
 * preferred path.  The fallback adapts the existing modal without constructing
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
    let itemsById = new Map();

    try {
        const response = await listMaterialLibrary({ type: wantedType });
        itemsById = new Map((response?.items || []).map((item) => [String(item.id), item]));
    } catch {
        // The modal has its own error handling/reload path.  A card can still be
        // resolved by id below only if the listing succeeds, so preserve the
        // same window instead of silently opening a second UI.
    }

    return new Promise(async (resolve, reject) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            layer.removeEventListener("click", onClick, true);
            resolve(value || null);
        };

        const onClick = (event) => {
            const card = closestElement(event.target, ".mmx-ml-card");
            if (card && String(card.dataset.type || "") === wantedType) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const item = itemsById.get(String(card.dataset.id || ""));
                if (!item) return;
                controller.close?.();
                finish(item);
                return;
            }
            if (closestElement(event.target, '[data-ml="close"], [data-ml="cancel"]')) {
                queueMicrotask(() => finish(null));
            }
        };

        layer.addEventListener("click", onClick, true);
        try {
            // The existing Material Library does not yet have a Mixed allocation
            // mode.  R2V is used only while opening the picker because it exposes
            // all three media tabs; the capture handler prevents its allocation
            // click from touching the standalone timeline.
            editor.getTaskKey = () => "r2v";
            if (controller.state) controller.state.activeType = wantedType;
            await controller.open();
            if (controller.state) controller.state.activeType = wantedType;
        } catch (error) {
            layer.removeEventListener("click", onClick, true);
            reject(error);
        } finally {
            if (originalGetTaskKey) editor.getTaskKey = originalGetTaskKey;
            else delete editor.getTaskKey;
        }
    });
}
