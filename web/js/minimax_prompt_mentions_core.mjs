/** DOM-independent prompt mention behavior used by Node regression tests. */

export function moveMentionActiveIndex(current, delta, length) {
    if (!length) return 0;
    return (Number(current || 0) + Number(delta || 0) + length) % length;
}

export function isImmediateMentionTriggerEvent(event, {
    destroyed = false,
    composing = false,
} = {}) {
    return !destroyed
        && !composing
        && !event?.isComposing
        && event?.inputType === "insertText"
        && event?.data === "@";
}

export async function activateMentionItem(item, {
    enableItem,
    getItems,
} = {}) {
    if (!item || item.status === "missing") {
        throw new Error("Reference asset is unavailable.");
    }
    if (item.status !== "disabled") return item;
    if (typeof enableItem !== "function") {
        throw new Error("Disabled Common reference cannot be enabled.");
    }
    const returned = await enableItem(item);
    const candidates = typeof getItems === "function" ? (getItems() || []) : [];
    const resolved = returned?.status === "active"
        ? returned
        : candidates.find((candidate) => (
            candidate?.kind === item.kind
            && String(candidate?.assetId || "") === String(item.assetId || "")
        ));
    if (!resolved || resolved.status !== "active" || !resolved.effectiveTag) {
        throw new Error("Disabled Common reference could not be enabled.");
    }
    return {
        ...resolved,
        kind: item.kind,
        assetId: item.assetId,
        token: item.token,
    };
}

export async function resolveMentionInsertion(item, {
    target,
    activateItem,
    cloneTarget = (value) => value?.cloneRange?.() || value || null,
} = {}) {
    // Enabling a disabled Common asset serializes state asynchronously. The
    // click event can close the menu during that await, so capture an
    // independent insertion range before activation yields to the event loop.
    const capturedTarget = cloneTarget(target);
    if (!capturedTarget || typeof activateItem !== "function") return null;
    return {
        target: capturedTarget,
        item: await activateItem(item),
    };
}

export function computeMentionMenuPosition(anchorRect = {}, menuRect = {}, viewport = {}) {
    const margin = 8;
    const gap = 4;
    const viewportWidth = Math.max(1, Number(viewport.width) || 1);
    const viewportHeight = Math.max(1, Number(viewport.height) || 1);
    const availableWidth = Math.max(1, viewportWidth - margin * 2);
    const availableHeight = Math.max(1, viewportHeight - margin * 2);
    const desiredWidth = Math.max(
        230,
        Number(anchorRect.width) || 0,
        Number(menuRect.width) || 0,
    );
    const width = Math.min(340, desiredWidth, availableWidth);
    const height = Math.min(240, Math.max(1, Number(menuRect.height) || 240), availableHeight);
    const anchorTop = Number(anchorRect.top) || 0;
    const anchorBottom = Number(anchorRect.bottom) || anchorTop;
    const spaceBelow = viewportHeight - anchorBottom - gap - margin;
    const spaceAbove = anchorTop - gap - margin;
    const opensAbove = spaceBelow < height && spaceAbove > spaceBelow;
    const preferredTop = opensAbove
        ? anchorTop - gap - height
        : anchorBottom + gap;
    const top = Math.min(
        Math.max(margin, preferredTop),
        Math.max(margin, viewportHeight - height - margin),
    );
    const left = Math.min(
        Math.max(margin, Number(anchorRect.left) || margin),
        Math.max(margin, viewportWidth - width - margin),
    );
    return { left, top, width, height, opensAbove };
}

export function filterMentionPickerItems(items, query = "") {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return (items || []).filter((item) => {
        if (!item || !["active", "disabled"].includes(item.status || "active")) return false;
        if (!normalizedQuery) return true;
        const searchable = [
            item.kind,
            item.label,
            item.name,
            item.authoringTag,
            item.effectiveTag,
        ].join(" ").toLowerCase();
        return searchable.includes(normalizedQuery);
    });
}

export function shouldCloseMentionForScroll(menu, eventTarget, keepOpenRoot = null) {
    if (!menu || !eventTarget) return true;
    if (eventTarget === menu || menu.contains?.(eventTarget)) return false;
    if (
        keepOpenRoot
        && (eventTarget === keepOpenRoot || keepOpenRoot.contains?.(eventTarget))
    ) {
        return false;
    }
    return true;
}

export function isPromptEditingKey(key) {
    return [
        "Backspace", "Delete", " ", "Spacebar", "ArrowLeft", "ArrowRight",
        "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
    ].includes(key);
}

const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"]);

/** True for native controls and rich editors, including nested/inherited contenteditable nodes. */
export function isEditableTarget(target) {
    let current = target && typeof target === "object" ? target : null;
    if (current?.nodeType === 3) current = current.parentElement;
    if (!current) return false;
    if (FORM_TAGS.has(String(current.tagName || "").toUpperCase())) return true;
    if (current.isContentEditable) return true;
    if (current.classList?.contains?.("bd-prompt-editor")) return true;
    if (current.closest?.("input, textarea, select, button, [contenteditable], .bd-prompt-editor")) return true;
    while (current) {
        if (FORM_TAGS.has(String(current.tagName || "").toUpperCase())) return true;
        if (current.isContentEditable || current.classList?.contains?.("bd-prompt-editor")) return true;
        const attr = current.getAttribute?.("contenteditable");
        if (attr != null && String(attr).toLowerCase() !== "false") return true;
        current = current.parentElement;
    }
    return false;
}

/** Timeline shortcuts are valid only while the canvas owns the keyboard context. */
export function shouldHandleTimelineShortcut(event, { activeElement, timelineElement } = {}) {
    if (!event || event.defaultPrevented || event.isComposing) return false;
    if (isEditableTarget(event.target) || isEditableTarget(activeElement)) return false;
    if (!timelineElement) return false;
    return event.target === timelineElement || activeElement === timelineElement;
}

export function createTimelineShortcutHandler(options = {}) {
    return (event) => {
        const timelineElement = typeof options.timelineElement === "function"
            ? options.timelineElement() : options.timelineElement;
        const activeElement = options.getActiveElement?.();
        if (!shouldHandleTimelineShortcut(event, { activeElement, timelineElement })) return false;
        if (event.key === "Delete" || event.key === "Backspace") {
            if (options.hasSelectedSplit?.()) {
                event.preventDefault?.();
                return true;
            }
            if (!options.canDelete?.()) return false;
            options.onDelete?.();
            event.preventDefault?.();
            return true;
        }
        if (event.code === "Space") {
            options.onTogglePlay?.();
            event.preventDefault?.();
            return true;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            options.onStepFrame?.(direction * (event.shiftKey ? 10 : 1));
            event.preventDefault?.();
            return true;
        }
        return false;
    };
}

export function createListenerRegistry() {
    const listeners = [];
    return {
        add(target, type, handler, options) {
            target?.addEventListener?.(type, handler, options);
            listeners.push([target, type, handler, options]);
        },
        destroy() {
            for (const [target, type, handler, options] of listeners.splice(0)) {
                target?.removeEventListener?.(type, handler, options);
            }
        },
        get size() { return listeners.length; },
    };
}

export function promptValueNeedsRender(hiddenValue, richValue, nextValue) {
    const next = String(nextValue || "");
    return String(hiddenValue || "") !== next || String(richValue || "") !== next;
}

export function referenceChipPresentation(item = {}, formatters = {}) {
    const state = item.status || (item.assetId ? "active" : "missing");
    const identity = String(item.assetId || "");
    const name = String(item.name || item.label || identity);
    if (state === "active") {
        return {
            state,
            text: String(item.effectiveTag || item.officialTag || item.label || identity),
            title: name || String(item.effectiveTag || item.officialTag || ""),
        };
    }
    if (state === "disabled") {
        return {
            state,
            text: formatters.formatDisabled?.(name) || name,
            title: formatters.formatDisabledTitle?.(String(item.authoringTag || ""), name) || name,
        };
    }
    return {
        state: "missing",
        text: formatters.formatMissing?.(name) || name,
        title: formatters.formatMissingTitle?.(name) || name,
    };
}

export function mentionQueryFromText(text, cursor = String(text || "").length) {
    const before = String(text || "").slice(0, Math.max(0, Number(cursor) || 0));
    const match = before.match(/@([^\s@]*)$/);
    if (!match) return null;
    return { start: before.length - match[0].length, query: match[1] };
}
