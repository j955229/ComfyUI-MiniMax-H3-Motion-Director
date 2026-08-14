/** R2V Common References output-bar button DOM contract. */

export function mountR2vCommonToggle(outputBar, documentRef = globalThis.document) {
    if (!outputBar?.querySelector || !documentRef?.createElement) {
        throw new Error("R2V Common toggle requires an output bar and document.");
    }
    const existing = outputBar.querySelector('[data-a="r2v-common-toggle"]');
    if (existing) return existing;
    const livePreview = outputBar.querySelector('[data-a="live-tae-preview"]');
    let buttonGroup = livePreview?.parentElement
        || outputBar.querySelector(".bd-output-button-group");
    if (!buttonGroup?.classList?.contains("bd-output-button-group")) {
        buttonGroup = documentRef.createElement("span");
        buttonGroup.className = "bd-output-button-group";
        buttonGroup.classList?.add?.("bd-output-button-group");
        if (livePreview) {
            livePreview.replaceWith(buttonGroup);
            buttonGroup.appendChild(livePreview);
        } else {
            outputBar.appendChild(buttonGroup);
        }
    }
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "bd-btn bd-r2v-common-toggle hidden";
    button.setAttribute("data-a", "r2v-common-toggle");
    button.setAttribute("data-i18n", "batch.r2v.commonReferences");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "公共素材";
    if (livePreview) {
        if (!livePreview.insertAdjacentElement("afterend", button)) {
            throw new Error("Unable to mount R2V Common toggle beside live preview.");
        }
    } else {
        buttonGroup.appendChild(button);
    }
    return button;
}

export function syncR2vCommonToggle(button, options = {}) {
    if (!button) return;
    const visible = !!options.visible;
    const expanded = !!options.expanded;
    button.classList.toggle("hidden", !visible);
    button.classList.toggle("active", visible && expanded);
    button.textContent = String(options.label || "");
    button.title = expanded
        ? String(options.collapseTitle || "")
        : String(options.expandTitle || "");
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("data-i18n", "batch.r2v.commonReferences");
    button.removeAttribute?.("data-i18n-title");
}

export function syncR2vCommonToggleForTask(button, options = {}) {
    syncR2vCommonToggle(button, {
        ...options,
        visible: String(options.taskKey || "").toLowerCase() === "r2v",
    });
}
