// MiniMax H3 Motion Director — page-root editor modal and compact node launcher.

export const DIRECTOR_LAUNCHER_HEIGHT = 34;

const STYLE_ID = "mmx-director-modal-styles";
let activeDirectorModal = null;
const directorModalByHost = new WeakMap();

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITING_COMMAND_KEYS = new Set(["a", "c", "v", "x", "y", "z"]);
export const DIRECTOR_PAGES = [
    "generation",
    "postprocess",
    "live",
    "results",
];

export function isDirectorEditableTarget(target, overlay) {
    let current = target?.nodeType === 3 ? target.parentElement : target;
    if (!current || (overlay && !overlay.contains?.(current))) return false;
    while (current && current !== overlay) {
        if (EDITABLE_TAGS.has(String(current.tagName || "").toUpperCase())) return true;
        if (current.isContentEditable) return true;
        const attr = current.getAttribute?.("contenteditable");
        if (attr != null && String(attr).toLowerCase() !== "false") return true;
        if (current.classList?.contains?.("bd-prompt-editor")) return true;
        current = current.parentElement;
    }
    return false;
}

export function shouldIsolateDirectorEditingEvent(event, overlay, isOpen = true) {
    if (!isOpen || !event || event.isComposing) return false;
    if (!isDirectorEditableTarget(event.target, overlay)) return false;
    if (event.type === "paste" || event.type === "beforeinput") return true;
    if (event.type !== "keydown") return false;
    if (event.key === "Backspace" || event.key === "Delete") return true;
    if (!(event.ctrlKey || event.metaKey)) return false;
    return EDITING_COMMAND_KEYS.has(String(event.key || "").toLowerCase());
}

export function isolateDirectorEditingEvent(event, overlay, isOpen = true) {
    if (!shouldIsolateDirectorEditingEvent(event, overlay, isOpen)) return false;
    // Preserve the browser/editor default. The event is stopped at the modal
    // bubble boundary only after the focused editor has handled it.
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    return true;
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.mmx-director-launcher-host{width:100%;height:${DIRECTOR_LAUNCHER_HEIGHT}px;min-height:${DIRECTOR_LAUNCHER_HEIGHT}px;box-sizing:border-box;overflow:hidden}
.mmx-director-launcher{display:flex;align-items:stretch;gap:6px;width:100%;height:${DIRECTOR_LAUNCHER_HEIGHT}px;padding:3px 0;box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-director-launcher button{min-width:0;border:1px solid #555;border-radius:5px;background:#252525;color:#d8dce8;font-size:11px;line-height:1;cursor:pointer;box-sizing:border-box}
.mmx-director-launcher button:hover{border-color:#4fff8f;background:#2b2b2b;color:#fff}
.mmx-director-launcher-open{flex:1 1 auto;padding:0 10px;font-weight:600;text-align:left}
.mmx-director-launcher-lang{flex:0 0 58px;padding:0 7px;text-align:center}
.mmx-director-page-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(0,0,0,.72)}
.mmx-director-page-overlay[hidden]{display:none!important}
.mmx-director-page-shell{position:relative;width:92vw;height:90vh;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:visible;border:1px solid #3a3a3a;border-radius:9px;background:#141414;box-shadow:0 20px 70px rgba(0,0,0,.72);color:#e0e0e0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-director-page-header{flex:0 0 44px;min-height:44px;display:grid;grid-template-columns:minmax(120px,1fr) auto minmax(120px,1fr);align-items:center;gap:12px;padding:0 8px 0 14px;border-bottom:1px solid #303030;background:#191919;box-sizing:border-box}
.mmx-director-page-title{min-width:0;margin:0;color:#eee;font-size:13px;font-weight:650;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mmx-director-page-navigation{display:flex;align-items:center;justify-content:center;gap:6px}
.mmx-director-page-arrow,.mmx-director-page-tab{height:30px;border:1px solid #393939;border-radius:6px;background:#222;color:#bbb;cursor:pointer}
.mmx-director-page-arrow{width:34px;font-size:17px}
.mmx-director-page-tab{min-width:104px;padding:0 14px;font-size:12px;font-weight:650}
.mmx-director-page-tab.active{border-color:#4fff8f;background:#163723;color:#4fff8f}
.mmx-director-page-actions{display:flex;justify-content:flex-end}
.mmx-director-page-close{flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#aaa;font-size:22px;line-height:28px;cursor:pointer}
.mmx-director-page-close:hover{border-color:#4a4a4a;background:#2a2a2a;color:#fff}
.mmx-director-page-stack{flex:1 1 auto;min-width:0;min-height:0;position:relative;overflow:hidden}
.mmx-director-page-content{position:absolute;inset:0;min-width:0;min-height:0;overflow:auto;padding:8px;box-sizing:border-box;overscroll-behavior:contain}
.mmx-director-page-content[hidden]{display:none!important}
.mmx-director-page-content>.bd-wrap{width:100%;max-width:none}
.mmx-director-overlay-layer{position:absolute;inset:44px 0 0;z-index:150;pointer-events:none;overflow:visible}
.mmx-director-overlay-layer>*{pointer-events:auto}
`;
    document.head.appendChild(style);
}

/**
 * Build one compact launcher and one persistent page-root modal for an editor.
 * The editor DOM is mounted by the caller into `content`; closing only hides it.
 */
export function createDirectorModal({
    launcherHost,
    translate,
    toggleLanguage,
    hasInternalDialog,
    onOpen,
    onClose,
    onResize,
    onPageChange,
}) {
    if (!launcherHost) throw new Error("Director launcher host is required");
    directorModalByHost.get(launcherHost)?.destroy?.();
    ensureStyles();

    launcherHost.classList.add("mmx-director-launcher-host");

    const launcher = document.createElement("div");
    launcher.className = "mmx-director-launcher";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "mmx-director-launcher-open";
    openButton.dataset.a = "open-director";

    const languageButton = document.createElement("button");
    languageButton.type = "button";
    languageButton.className = "mmx-director-launcher-lang";
    languageButton.dataset.a = "lang-toggle";

    launcher.append(openButton, languageButton);
    launcherHost.replaceChildren(launcher);

    const overlay = document.createElement("div");
    overlay.className = "mmx-director-page-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const shell = document.createElement("section");
    shell.className = "mmx-director-page-shell";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "false");

    const header = document.createElement("header");
    header.className = "mmx-director-page-header";

    const title = document.createElement("h2");
    title.className = "mmx-director-page-title";

    const navigation = document.createElement("nav");
    navigation.className = "mmx-director-page-navigation";
    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "mmx-director-page-arrow";
    previousButton.dataset.a = "page-previous";
    previousButton.textContent = "◀";
    const pageTabs = DIRECTOR_PAGES.map((page) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mmx-director-page-tab";
        button.dataset.page = page;
        return button;
    });
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "mmx-director-page-arrow";
    nextButton.dataset.a = "page-next";
    nextButton.textContent = "▶";
    navigation.append(previousButton, ...pageTabs, nextButton);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mmx-director-page-close";
    closeButton.dataset.a = "close-director";
    closeButton.textContent = "×";

    const pageStack = document.createElement("div");
    pageStack.className = "mmx-director-page-stack";
    const pages = Object.fromEntries(DIRECTOR_PAGES.map((page, index) => {
        const element = document.createElement("div");
        element.className = `mmx-director-page-content mmx-director-page-${page}`;
        element.dataset.page = page;
        element.hidden = index !== 0;
        pageStack.appendChild(element);
        return [page, element];
    }));
    const content = pages.generation;

    const overlayLayer = document.createElement("div");
    overlayLayer.className = "mmx-director-overlay-layer";

    const actions = document.createElement("div");
    actions.className = "mmx-director-page-actions";
    actions.appendChild(closeButton);
    header.append(title, navigation, actions);
    shell.append(header, pageStack, overlayLayer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);

    let isOpen = false;
    let destroyed = false;
    let restoreFocusEl = null;
    let resizeRaf = null;
    let currentPage = "generation";

    const updateLocale = () => {
        openButton.textContent = translate("toolbar.openDirector");
        languageButton.textContent = translate("toolbar.langToggle");
        languageButton.title = translate("toolbar.langToggleTitle");
        title.textContent = translate("modal.directorTitle");
        closeButton.title = translate("modal.close");
        closeButton.setAttribute("aria-label", translate("modal.close"));
        shell.setAttribute("aria-label", translate("modal.directorTitle"));
        const labels = {
            generation: translate("modal.page.generation"),
            postprocess: translate("modal.page.postprocess"),
            live: translate("modal.page.live"),
            results: translate("modal.page.results"),
        };
        pageTabs.forEach((button) => { button.textContent = labels[button.dataset.page]; });
        previousButton.title = translate("modal.page.previous");
        nextButton.title = translate("modal.page.next");
    };

    const scheduleResize = () => {
        if (!isOpen || destroyed || resizeRaf != null) return;
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = null;
            onResize?.();
        });
    };

    const reportLifecycleError = (phase, error) => {
        console.error(`[MiniMax H3 Motion Director] modal ${phase} failed:`, error);
    };

    const api = {
        launcher,
        openButton,
        languageButton,
        overlay,
        shell,
        content,
        pages,
        pageTabs,
        previousButton,
        nextButton,
        overlayLayer,
        closeButton,
        keyHandler: null,
        get isOpen() { return isOpen; },
        get currentPage() { return currentPage; },
        updateLocale,
        setPage(page) {
            if (!DIRECTOR_PAGES.includes(page)) return false;
            currentPage = page;
            for (const name of DIRECTOR_PAGES) {
                pages[name].hidden = name !== page;
            }
            pageTabs.forEach((button) => {
                const active = button.dataset.page === page;
                button.classList.toggle?.("active", active);
                button.setAttribute("aria-selected", String(active));
            });

            onPageChange?.(page);
            scheduleResize();
            return true;
        },
        cyclePage(direction = 1) {
            const index = DIRECTOR_PAGES.indexOf(currentPage);
            return api.setPage(DIRECTOR_PAGES[(index + direction + DIRECTOR_PAGES.length) % DIRECTOR_PAGES.length]);
        },
        open() {
            if (destroyed || isOpen) return false;
            if (activeDirectorModal && activeDirectorModal !== api) {
                activeDirectorModal.close({ restoreFocus: false });
            }
            activeDirectorModal = api;
            restoreFocusEl = document.activeElement;
            isOpen = true;
            overlay.hidden = false;
            overlay.setAttribute("aria-hidden", "false");
            shell.setAttribute("aria-modal", "true");
            try {
                onOpen?.();
            } catch (error) {
                reportLifecycleError("open", error);
                api.close({ restoreFocus: false });
                return false;
            }
            scheduleResize();
            requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
            return true;
        },
        close({ restoreFocus = true } = {}) {
            if (destroyed || !isOpen) return false;
            // Hide before cleanup. A cleanup error must never leave the page
            // blocked by an undismissable Director overlay.
            isOpen = false;
            overlay.hidden = true;
            overlay.setAttribute("aria-hidden", "true");
            shell.setAttribute("aria-modal", "false");
            if (activeDirectorModal === api) activeDirectorModal = null;
            try {
                onClose?.();
            } catch (error) {
                reportLifecycleError("close", error);
            }
            if (restoreFocus && restoreFocusEl?.isConnected) {
                restoreFocusEl.focus?.({ preventScroll: true });
            }
            restoreFocusEl = null;
            return true;
        },
        destroy() {
            if (destroyed) return;
            if (isOpen) api.close({ restoreFocus: false });
            destroyed = true;
            if (activeDirectorModal === api) activeDirectorModal = null;
            if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
            window.removeEventListener("keydown", api.keyHandler, true);
            window.removeEventListener("resize", scheduleResize);
            openButton.removeEventListener("click", handleOpenClick);
            languageButton.removeEventListener("click", handleLanguageClick);
            closeButton.removeEventListener("click", handleCloseClick);
            previousButton.removeEventListener("click", handlePreviousPage);
            nextButton.removeEventListener("click", handleNextPage);
            pageTabs.forEach((button) => button.removeEventListener("click", handlePageTab));
            overlay.removeEventListener("click", handleBackdropClick);
            overlay.removeEventListener("keydown", handleEditingEvent);
            overlay.removeEventListener("paste", handleEditingEvent);
            overlay.removeEventListener("beforeinput", handleEditingEvent);
            overlay.remove();
            launcher.remove();
            launcherHost.classList.remove("mmx-director-launcher-host");
            if (directorModalByHost.get(launcherHost) === api) {
                directorModalByHost.delete(launcherHost);
            }
        },
    };

    const stopLauncherEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const handleOpenClick = (event) => {
        stopLauncherEvent(event);
        api.open();
    };
    const handleLanguageClick = (event) => {
        stopLauncherEvent(event);
        toggleLanguage?.();
    };
    const handleCloseClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        api.close();
    };
    const handleBackdropClick = (event) => {
        if (event.target === overlay) api.close();
    };
    const handlePreviousPage = (event) => {
        event.preventDefault();
        event.stopPropagation();
        api.cyclePage(-1);
    };
    const handleNextPage = (event) => {
        event.preventDefault();
        event.stopPropagation();
        api.cyclePage(1);
    };
    const handlePageTab = (event) => {
        event.preventDefault();
        event.stopPropagation();
        api.setPage(event.currentTarget?.dataset?.page || event.target?.dataset?.page);
    };
    const handleEditingEvent = (event) => {
        isolateDirectorEditingEvent(event, overlay, isOpen);
    };
    api.keyHandler = (event) => {
        if (!isOpen || event.key !== "Escape") return;
        // The editor's own confirmation/file dialogs own the first Escape.
        if (hasInternalDialog?.()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        api.close();
    };

    openButton.addEventListener("click", handleOpenClick);
    languageButton.addEventListener("click", handleLanguageClick);
    closeButton.addEventListener("click", handleCloseClick);
    previousButton.addEventListener("click", handlePreviousPage);
    nextButton.addEventListener("click", handleNextPage);
    pageTabs.forEach((button) => button.addEventListener("click", handlePageTab));
    overlay.addEventListener("click", handleBackdropClick);
    overlay.addEventListener("keydown", handleEditingEvent);
    overlay.addEventListener("paste", handleEditingEvent);
    overlay.addEventListener("beforeinput", handleEditingEvent);
    window.addEventListener("keydown", api.keyHandler, true);
    window.addEventListener("resize", scheduleResize);
    updateLocale();
    api.setPage("generation");
    directorModalByHost.set(launcherHost, api);
    return api;
}

export function destroyDirectorModalForHost(launcherHost) {
    const modal = launcherHost ? directorModalByHost.get(launcherHost) : null;
    if (!modal) return false;
    modal.destroy();
    return true;
}

export function getDirectorModalForHost(launcherHost) {
    return launcherHost ? directorModalByHost.get(launcherHost) || null : null;
}
