// Portions derived from ComfyUI_MiniMaxH3_Director
// Copyright AIMixer and contributors
// Originally licensed under Apache License 2.0
// Modified for MiniMax H3 Motion Director, 2026-08-12
// This derivative project is distributed under GPL-3.0.

/** Asset-aware prompt chips and @ picker for MiniMax H3 references. */

import { api } from "../../scripts/api.js";
import {
    refAudioLabel,
    refAudioPromptTag,
    refImageLabel,
    refImagePromptTag,
    refVideoLabel,
    refVideoPromptTag,
} from "./minimax_gen_timeline.js";
import {
    hydrateOfficialReferenceTags,
    SEMANTIC_REFERENCE_RE,
    semanticReferenceToken,
} from "./minimax_reference_assets.mjs";
import { t } from "./minimax_i18n.js";
import {
    activateMentionItem,
    computeMentionMenuPosition,
    createListenerRegistry,
    filterMentionPickerItems,
    isImmediateMentionTriggerEvent,
    isPromptEditingKey,
    moveMentionActiveIndex,
    promptValueNeedsRender,
    referenceChipPresentation,
    resolveMentionInsertion,
    shouldCloseMentionForScroll,
} from "./minimax_prompt_mentions_core.mjs?boot=director_ui_v2";
export {
    isPromptEditingKey,
    mentionQueryFromText,
    moveMentionActiveIndex,
    shouldCloseMentionForScroll,
} from "./minimax_prompt_mentions_core.mjs?boot=director_ui_v2";

const MENTION_STYLES = `
.bd-prompt-editor{width:100%;min-height:64px;box-sizing:border-box;background:#141414;border:1px solid #333;border-radius:5px;color:#eee;padding:7px;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 inherit;outline:none}
.bd-prompt-editor:focus{border-color:#4d7b5b;box-shadow:0 0 0 1px rgba(79,255,143,.12)}
.bd-prompt-chip{display:inline-flex;align-items:center;max-width:190px;margin:0 2px;padding:1px 6px;border:1px solid #45604d;border-radius:999px;background:#1a2b20;color:#8ff0aa;font-weight:700;white-space:nowrap;vertical-align:baseline;user-select:all}
.bd-prompt-chip[data-state="disabled"]{border-color:#9a622e;background:#302318;color:#ffb66e}
.bd-prompt-chip[data-state="missing"]{border-color:#8b4b4b;background:#301b1b;color:#ff9c9c}
.bd-prompt-chip-picture:before{content:"▣";margin-right:4px}.bd-prompt-chip-video:before{content:"▶";margin-right:4px}.bd-prompt-chip-audio:before{content:"♪";margin-right:4px}
.bd-mention-menu{position:fixed;z-index:160;min-width:0;overflow:auto;background:#252525;border:1px solid #444;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:4px 0}
.bd-mention-menu.hidden{display:none!important}.bd-mention-title{padding:6px 10px 4px;font-size:10px;color:#888;user-select:none}
.bd-mention-kind-title{padding:6px 10px 3px;border-top:1px solid #343434;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#777;user-select:none}
.bd-mention-item{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:11px;color:#ddd}.bd-mention-item:hover{background:#333;color:#fff}.bd-mention-item.active{background:#163723;color:#4fff8f}
.bd-mention-item[data-state="disabled"] .bd-mention-label{color:#ffb66e}
.bd-mention-item img{width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0;background:#111;border:1px solid #333}.bd-mention-item .bd-mention-label{font-weight:650;color:#4fff8f}.bd-mention-item .bd-mention-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa}
.bd-mention-empty{padding:10px 12px;font-size:11px;color:#888;text-align:center;line-height:1.4}
`;

let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const el = document.createElement("style");
    el.textContent = MENTION_STYLES;
    document.head.appendChild(el);
}

function inputViewUrl(filename, type = "input") {
    const normalized = String(filename || "").replace(/\\/g, "/");
    const subfolder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const base = subfolder ? normalized.slice(subfolder.length + 1) : normalized;
    const params = new URLSearchParams({ filename: base, type });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

function refThumbUrl(ref) {
    if (ref?.imageFile) return inputViewUrl(ref.imageFile, "input");
    if (ref?.imageB64) return ref.imageB64.startsWith("data:") ? ref.imageB64 : `data:image/png;base64,${ref.imageB64}`;
    return "";
}

function legacyMentionItems(refs, audios, videos) {
    const items = [];
    for (const ref of [...(refs || [])].filter((x) => x?.imageFile || x?.imageB64)
        .sort((a, b) => Number(a.index ?? a.slot ?? 0) - Number(b.index ?? b.slot ?? 0))) {
        const index = Number(ref.index ?? ref.slot ?? 0);
        items.push({ kind: "picture", label: refImageLabel(index), officialTag: refImagePromptTag(index), token: refImagePromptTag(index), thumb: refThumbUrl(ref), name: "" });
    }
    for (const ref of [...(videos || [])].filter((x) => x?.videoFile || x?.fileName)
        .sort((a, b) => Number(a.index ?? a.slot ?? 0) - Number(b.index ?? b.slot ?? 0))) {
        const index = Number(ref.index ?? ref.slot ?? 0);
        items.push({ kind: "video", label: refVideoLabel(index), officialTag: refVideoPromptTag(index), token: refVideoPromptTag(index), thumb: "", name: "" });
    }
    for (const ref of [...(audios || [])].filter((x) => x?.audioFile || x?.fileName)
        .sort((a, b) => Number(a.index ?? a.slot ?? 0) - Number(b.index ?? b.slot ?? 0))) {
        const index = Number(ref.index ?? ref.slot ?? 0);
        items.push({ kind: "audio", label: refAudioLabel(index), officialTag: refAudioPromptTag(index), token: refAudioPromptTag(index), thumb: "", name: "" });
    }
    return items;
}

export function mentionItemsFromMedia(media = {}) {
    if (Array.isArray(media.assets)) {
        return media.assets.map((asset) => ({
            kind: asset.kind,
            assetId: asset.assetId,
            source: asset.source || "",
            label: asset.effectiveTag || asset.authoringTag,
            authoringTag: asset.authoringTag || "",
            effectiveTag: asset.effectiveTag || asset.officialTag || "",
            officialTag: asset.effectiveTag || asset.officialTag || "",
            token: semanticReferenceToken(asset.kind, asset.assetId),
            thumb: asset.kind === "picture" ? refThumbUrl(asset.item) : "",
            name: asset.label || "",
            status: asset.status || "active",
        }));
    }
    return legacyMentionItems(media.refs, media.audios, media.videos);
}

function positionMenu(menu, editorEl) {
    const rect = editorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const position = computeMentionMenuPosition(rect, menuRect, {
        width: window.innerWidth,
        height: window.innerHeight,
    });
    menu.style.left = String(position.left) + "px";
    menu.style.top = String(position.top) + "px";
    menu.style.width = String(position.width) + "px";
    menu.style.maxWidth = String(position.width) + "px";
    menu.style.maxHeight = String(position.height) + "px";
}

function semanticRegex() {
    return new RegExp(SEMANTIC_REFERENCE_RE.source, "gi");
}

function serializeRich(root) {
    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.data;
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        if (node.classList?.contains("bd-prompt-chip")) return node.dataset.semanticToken || node.textContent || "";
        if (node.tagName === "BR") return "\n";
        let text = "";
        for (const child of node.childNodes) text += walk(child);
        if (node !== root && node.tagName === "DIV" && !text.endsWith("\n")) text += "\n";
        return text;
    };
    return walk(root).replace(/\n$/, "");
}

function normalizeCaretToTextNode(root) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return null;

    const current = selection.getRangeAt(0);
    if (
        !current.collapsed
        || !(current.startContainer === root || root.contains(current.startContainer))
    ) {
        return null;
    }

    if (current.startContainer.nodeType === Node.TEXT_NODE) {
        return current;
    }

    const container = current.startContainer;
    const offset = current.startOffset;
    const previous = container.childNodes?.[offset - 1];

    // 浏览器经常把 caret 放成：
    // <div contenteditable> ... TextNode | </div>
    // 把它重新锚定到前一个真实文字节点末尾。
    if (previous?.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(previous, previous.data.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
    }

    // 如果当前位置根本没有文字节点，主动建立一个稳定的 caret host。
    const textNode = document.createTextNode("");
    const reference = container.childNodes?.[offset] || null;
    container.insertBefore(textNode, reference);

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
}

function caretMentionRange(root) {
    const caret = normalizeCaretToTextNode(root);
    if (!caret) return null;

    const node = caret.startContainer;
    const before = node.data.slice(0, caret.startOffset);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) return null;

    const range = document.createRange();
    range.setStart(node, caret.startOffset - match[0].length);
    range.setEnd(node, caret.startOffset);

    return {
        range,
        query: match[1],
    };
}

function previousChipAtCaret(root) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !root.contains(range.startContainer)) return null;
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
        return node.previousSibling?.classList?.contains("bd-prompt-chip") ? node.previousSibling : null;
    }
    if (node === root && range.startOffset > 0) {
        const prev = root.childNodes[range.startOffset - 1];
        return prev?.classList?.contains("bd-prompt-chip") ? prev : null;
    }
    return null;
}

/** Replace a textarea with a contenteditable semantic-chip editor. */
export function wirePromptImageMentions(editor, textarea, getMedia, options = {}) {
    if (!textarea) return null;
    if (textarea._mmxMentionController) return textarea._mmxMentionController;
    textarea.dataset.mentionWired = "1";
    injectStyles();

    const rich = document.createElement("div");
    rich.className = "bd-prompt-editor";
    rich.contentEditable = "true";
    rich.setAttribute("role", "textbox");
    rich.setAttribute("aria-multiline", "true");
    rich.dataset.promptEditor = "1";
    textarea.insertAdjacentElement("afterend", rich);
    textarea.style.display = "none";

    let menu = null;
    let mentionRange = null;
    let activeIndex = 0;
    let filtered = [];

    let destroyed = false;
    let composing = false;
    const listeners = createListenerRegistry();
    const mediaItems = () => mentionItemsFromMedia(
        typeof getMedia === "function" ? (getMedia() || {}) : {},
    ).filter((item) => item.status !== "missing");
    const mapping = () => new Map(mediaItems().map((item) => [item.token, item]));

    const makeChip = (token, item = null) => {
        const chip = document.createElement("span");
        const parsed = token.match(/^\{\{mmx-ref:(picture|video|audio):([^}]+)\}\}$/i);
        const kind = item?.kind || parsed?.[1]?.toLowerCase() || "picture";
        chip.className = `bd-prompt-chip bd-prompt-chip-${kind}`;
        chip.contentEditable = "false";
        chip.dataset.semanticToken = token;
        const id = parsed?.[2] || "";
        const presentation = referenceChipPresentation(item || {
            assetId: id,
            status: "missing",
            name: id,
        }, {
            formatDisabled: (name) => t("mention.disabledLabel", { name }),
            formatMissing: (name) => t("mention.missingLabel", { name }),
            formatDisabledTitle: (authoringTag, name) => [
                t("mention.disabledAsset"),
                authoringTag ? `${authoringTag} · ${name}` : "",
            ].filter(Boolean).join("\n"),
            formatMissingTitle: (name) => t("mention.missingAsset", { name }),
        });
        chip.dataset.state = presentation.state;
        chip.dataset.missing = presentation.state === "missing" ? "1" : "0";
        chip.textContent = presentation.text;
        chip.title = presentation.title;
        return chip;
    };

    const renderRich = () => {
        const items = mapping();
        const fragment = document.createDocumentFragment();
        const text = String(textarea.value || "");
        const re = semanticRegex();
        let cursor = 0;
        let match;
        while ((match = re.exec(text))) {
            if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            fragment.appendChild(makeChip(match[0], items.get(match[0])));
            cursor = match.index + match[0].length;
        }
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        rich.replaceChildren(fragment);
    };

    // Bind pasted/typed official tags to the asset that currently owns the tag.
    const hydrateOfficialTags = () => {
        const before = String(textarea.value || "");
        textarea.value = hydrateOfficialReferenceTags(before, mediaItems());
        return textarea.value !== before;
    };
    const initiallyHydrated = hydrateOfficialTags();
    renderRich();
    if (initiallyHydrated) textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const syncTextarea = ({ hydrate = false } = {}) => {
        textarea.value = serializeRich(rich);
        const hydrated = hydrate ? hydrateOfficialTags() : false;
        if (hydrated) renderRich();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return hydrated;
    };

    const ensureMenu = () => {
        if (menu) return menu;
        menu = document.createElement("div");
        menu.className = "bd-mention-menu hidden";
        menu.setAttribute("role", "listbox");
        menu.addEventListener("mousedown", (event) => event.preventDefault());
        const portal = options.overlayLayer || editor?._directorOverlayLayer || document.body;
        portal.appendChild(menu);
        return menu;
    };

    const closeMenu = () => {
        mentionRange = null;
        filtered = [];
        activeIndex = 0;
        menu?.classList.add("hidden");
    };

    const updateActiveRow = () => {
        const rows = [...(menu?.querySelectorAll(".bd-mention-item") || [])];
        rows.forEach((row, index) => row.classList.toggle("active", index === activeIndex));
        rows[activeIndex]?.scrollIntoView?.({ block: "nearest" });
    };

    let insertingMention = false;
    const insertMention = async (item) => {
        if (!mentionRange) return;
        if (insertingMention) return;
        insertingMention = true;
        const wasDisabled = item.status === "disabled";
        let prepared = null;
        try {
            prepared = await resolveMentionInsertion(item, {
                target: mentionRange,
                activateItem: (candidate) => activateMentionItem(candidate, {
                    enableItem: options.onEnableAsset,
                    getItems: mediaItems,
                }),
            });
        } catch (error) {
            console.error("[MiniMax H3 Motion Director] reference mention activation failed:", error);
            insertingMention = false;
            return;
        }
        if (destroyed || !prepared?.target || !rich.isConnected) {
            insertingMention = false;
            return;
        }
        const resolved = prepared.item;
        const insertionRange = prepared.target;
        insertionRange.deleteContents();
        const chip = makeChip(resolved.token, resolved);
        const space = document.createTextNode(" ");
        insertionRange.insertNode(space);
        insertionRange.insertNode(chip);
        const selection = window.getSelection();
        const caret = document.createRange();
        // Keep the caret inside the trailing text node instead of at a DOM boundary.
        // This makes the next typed @ immediately detectable by caretMentionRange().
        caret.setStart(space, space.data.length);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        closeMenu();
        syncTextarea();
        rich.focus();
        insertingMention = false;
        options.onMentionInserted?.(resolved, { wasDisabled });
    };

    const renderMenu = (query) => {
        const m = ensureMenu();
        const all = mediaItems();
        filtered = filterMentionPickerItems(all, query);
        activeIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
        m.replaceChildren();
        const title = document.createElement("div");
        title.className = "bd-mention-title";
        title.textContent = t("mention.title");
        m.appendChild(title);
        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "bd-mention-empty";
            empty.textContent = all.length ? t("mention.emptyFilter") : t("mention.emptyNoUpload");
            m.appendChild(empty);
        }
        let lastKind = "";
        filtered.forEach((item, index) => {
            if (item.kind !== lastKind) {
                lastKind = item.kind;
                const kindTitle = document.createElement("div");
                kindTitle.className = "bd-mention-kind-title";
                kindTitle.textContent = t("batch.r2v.assetKind." + item.kind);
                m.appendChild(kindTitle);
            }
            const row = document.createElement("div");
            row.className = `bd-mention-item${index === activeIndex ? " active" : ""}`;
            row.dataset.state = item.status || "active";
            if (item.thumb) {
                const img = document.createElement("img");
                img.src = item.thumb;
                img.alt = item.label;
                row.appendChild(img);
            }
            const tag = document.createElement("span");
            tag.className = "bd-mention-label";
            tag.textContent = item.status === "disabled"
                ? t("mention.disabledPicker")
                : item.label;
            row.appendChild(tag);
            if (item.name) {
                const name = document.createElement("span");
                name.className = "bd-mention-name";
                name.textContent = item.name;
                row.appendChild(name);
            }
            row.onmousedown = (event) => {
                event.preventDefault();
                void insertMention(item);
            };
            m.appendChild(row);
        });
        m.classList.remove("hidden");
        m.style.visibility = "hidden";
        positionMenu(m, rich);
        m.style.visibility = "";
    };

    const openIfMention = () => {
        const found = caretMentionRange(rich);
        if (!found) {
            closeMenu();
            return;
        }
        mentionRange = found.range;
        activeIndex = 0;
        renderMenu(found.query);
    };

    const onRichInput = () => {
        const hydrated = syncTextarea({ hydrate: true });
        if (!composing && !hydrated) {
            // Let the browser finish updating Selection before reading the caret.
            queueMicrotask(() => {
                if (!destroyed && !composing) openIfMention();
            });
        }
    };

    const onRichBeforeInput = (event) => {
        if (!isImmediateMentionTriggerEvent(event, { destroyed, composing })) return;

        const selection = window.getSelection?.();
        if (!selection?.rangeCount) return;

        const current = selection.getRangeAt(0);
        if (
            !current.collapsed
            || !(current.startContainer === rich || rich.contains(current.startContainer))
        ) {
            return;
        }

        // Own @ insertion so one physical key press can create exactly one trigger.
        // This also guarantees that the caret lands in a real text node.
        event.preventDefault();
        current.deleteContents();

        const trigger = document.createTextNode("@");
        current.insertNode(trigger);

        const caret = document.createRange();
        caret.setStart(trigger, trigger.data.length);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);

        // preventDefault() means rich itself will not emit the normal input event,
        // so synchronize the hidden textarea explicitly.
        syncTextarea();

        queueMicrotask(() => {
            if (!destroyed && !composing) openIfMention();
        });
    };
    const onCompositionStart = () => { composing = true; closeMenu(); };
    const onCompositionEnd = () => {
        composing = false;
        syncTextarea({ hydrate: true });
        // IME/composition can suppress the normal beforeinput/input mention-open path.
        // Re-check after the browser finalizes both content and Selection.
        queueMicrotask(() => {
            if (!destroyed && !composing) openIfMention();
        });
    };
    const onPaste = () => queueMicrotask(() => {
        if (destroyed || composing) return;
        syncTextarea({ hydrate: true });
    });
    const onRichKeydown = (event) => {
        if (event.isComposing || composing) {
            event.stopPropagation();
            return;
        }
        if (isPromptEditingKey(event.key)) {
            // Never bubble to Director's segment/group delete shortcuts.
            event.stopPropagation();
            if (event.key === "Backspace") {
                const chip = previousChipAtCaret(rich);
                if (chip) {
                    event.preventDefault();
                    chip.remove();
                    syncTextarea();
                    return;
                }
            }
        }
        if (!menu || menu.classList.contains("hidden") || !filtered.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = moveMentionActiveIndex(activeIndex, event.key === "ArrowDown" ? 1 : -1, filtered.length);
            updateActiveRow();
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            void insertMention(filtered[activeIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
        }
    };
    listeners.add(rich, "beforeinput", onRichBeforeInput);
    listeners.add(rich, "input", onRichInput);
    listeners.add(rich, "click", openIfMention);
    listeners.add(rich, "keydown", onRichKeydown);
    listeners.add(rich, "compositionstart", onCompositionStart);
    listeners.add(rich, "compositionend", onCompositionEnd);
    listeners.add(rich, "paste", onPaste);

    const onDocumentMouseDown = (event) => {
        if (!menu || menu.classList.contains("hidden")) return;
        if (event.target === rich || rich.contains(event.target) || menu.contains(event.target)) return;
        closeMenu();
    };
    const onWindowScroll = (event) => {
        const modalContent = editor?._directorModalContent || null;
        // Scroll events retarget inconsistently across Chromium versions: a
        // Director content scroll may arrive with content, document or window
        // as its target. While the page-root Director is open, keep the picker
        // alive and reposition it instead of treating that retargeting as an
        // outside scroll.
        if (modalContent && editor?._directorModalOpen) {
            requestAnimationFrame(() => {
                if (!destroyed && menu && !menu.classList.contains("hidden")) {
                    positionMenu(menu, rich);
                }
            });
            return;
        }
        if (!shouldCloseMentionForScroll(menu, event.target, modalContent)) {
            return;
        }
        closeMenu();
    };
    listeners.add(document, "mousedown", onDocumentMouseDown);
    listeners.add(window, "scroll", onWindowScroll, true);
    listeners.add(window, "resize", closeMenu);

    const controller = {
        rich,
        textarea,
        get isMenuOpen() {
            return !!menu && !menu.classList.contains("hidden");
        },
        getValue() {
            if (!destroyed) textarea.value = serializeRich(rich);
            return String(textarea.value || "");
        },
        setValue(value) {
            if (destroyed) return;
            const next = String(value || "");
            if (!promptValueNeedsRender(textarea.value, serializeRich(rich), next)) return;
            textarea.value = next;
            const hydrated = hydrateOfficialTags();
            renderRich();
            if (hydrated) textarea.dispatchEvent(new Event("input", { bubbles: true }));
        },
        refresh() {
            if (destroyed || composing) return;
            const value = serializeRich(rich);
            textarea.value = value;
            renderRich();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            closeMenu();
            listeners.destroy();
            menu?.remove();
            menu = null;
            rich.remove();
            textarea.style.display = "";
            delete textarea.dataset.mentionWired;
            delete textarea._mmxMentionController;
        },
    };
    textarea._mmxMentionController = controller;
    return controller;
}

/** Legacy/global editors keep direct official-tag behavior outside R2V Common cards. */
export function mountPromptImageMentions(editor) {
    if (!editor) return [];
    const controllers = [];
    const globalController = wirePromptImageMentions(editor, editor.globalPrompt, () => ({
        refs: editor.timeline?.global?.refs || [],
        audios: editor.timeline?.global?.refAudios || [],
        videos: editor.timeline?.global?.refVideos || [],
    }));
    if (globalController) controllers.push(globalController);
    const segmentController = wirePromptImageMentions(editor, editor.segPrompt, () => {
        const seg = editor.timeline?.segments?.[editor.selectedIndex];
        return { refs: seg?.refs || [], audios: seg?.refAudios || [], videos: seg?.refVideos || [] };
    });
    if (segmentController) controllers.push(segmentController);
    return controllers;
}
