// MiniMax H3 Motion Director — page-root editor modal and compact node launcher.

export const DIRECTOR_LAUNCHER_HEIGHT = 40;

const STYLE_ID = "mmx-director-modal-styles";
let activeDirectorModal = null;
const directorModalByHost = new WeakMap();

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITING_COMMAND_KEYS = new Set(["a", "c", "v", "x", "y", "z"]);

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
.mmx-director-launcher{display:flex;align-items:stretch;gap:6px;width:100%;height:${DIRECTOR_LAUNCHER_HEIGHT}px;padding:3px 4px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-director-launcher button{min-width:0;border:1px solid #3a3a3a;border-radius:6px;background:#232323;color:#ddd;font-size:12px;line-height:1;cursor:pointer;box-sizing:border-box}
.mmx-director-launcher button:hover{border-color:#5a5a5a;background:#2b2b2b;color:#fff}
.mmx-director-launcher-open{flex:1 1 auto;padding:0 12px;font-weight:600;text-align:left}
.mmx-director-launcher-lang{flex:0 0 58px;padding:0 7px;text-align:center}
.mmx-director-page-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(0,0,0,.72)}
.mmx-director-page-overlay[hidden]{display:none!important}
.mmx-director-page-shell{position:relative;width:92vw;height:90vh;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:visible;border:1px solid #3a3a3a;border-radius:9px;background:#141414;box-shadow:0 20px 70px rgba(0,0,0,.72);color:#e0e0e0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.mmx-director-page-header{flex:0 0 44px;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 8px 0 14px;border-bottom:1px solid #303030;background:#191919;box-sizing:border-box}
.mmx-director-page-title{min-width:0;margin:0;color:#eee;font-size:13px;font-weight:650;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mmx-director-page-close{flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#aaa;font-size:22px;line-height:28px;cursor:pointer}
.mmx-director-page-close:hover{border-color:#4a4a4a;background:#2a2a2a;color:#fff}
.mmx-director-page-content{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;padding:8px;box-sizing:border-box;overscroll-behavior:contain}
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
    shell.setAttribute("aria-modal", "true");

    const header = document.createElement("header");
    header.className = "mmx-director-page-header";

    const title = document.createElement("h2");
    title.className = "mmx-director-page-title";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mmx-director-page-close";
    closeButton.dataset.a = "close-director";
    closeButton.textContent = "×";

    const content = document.createElement("div");
    content.className = "mmx-director-page-content";

    const overlayLayer = document.createElement("div");
    overlayLayer.className = "mmx-director-overlay-layer";

    header.append(title, closeButton);
    shell.append(header, content, overlayLayer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);

    let isOpen = false;
    let destroyed = false;
    let restoreFocusEl = null;
    let resizeRaf = null;

    const updateLocale = () => {
        openButton.textContent = translate("toolbar.openDirector");
        languageButton.textContent = translate("toolbar.langToggle");
        languageButton.title = translate("toolbar.langToggleTitle");
        title.textContent = translate("modal.directorTitle");
        closeButton.title = translate("modal.close");
        closeButton.setAttribute("aria-label", translate("modal.close"));
        shell.setAttribute("aria-label", translate("modal.directorTitle"));
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
        overlayLayer,
        closeButton,
        keyHandler: null,
        get isOpen() { return isOpen; },
        updateLocale,
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
    overlay.addEventListener("click", handleBackdropClick);
    overlay.addEventListener("keydown", handleEditingEvent);
    overlay.addEventListener("paste", handleEditingEvent);
    overlay.addEventListener("beforeinput", handleEditingEvent);
    window.addEventListener("keydown", api.keyHandler, true);
    window.addEventListener("resize", scheduleResize);
    updateLocale();
    directorModalByHost.set(launcherHost, api);
    return api;
}

export function destroyDirectorModalForHost(launcherHost) {
    const modal = launcherHost ? directorModalByHost.get(launcherHost) : null;
    if (!modal) return false;
    modal.destroy();
    return true;
}
