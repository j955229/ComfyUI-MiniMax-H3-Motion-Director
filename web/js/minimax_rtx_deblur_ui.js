import { app } from "../../scripts/app.js";
import { getLocale, onLocaleChange } from "./minimax_i18n.js";

const ROOT_SELECTOR = ".mmx-postprocess";
const SECTION_SELECTOR = "[data-rtx-deblur-section]";
const boundRoots = new WeakSet();
let scanScheduled = false;
let stopLocaleSync = null;

function currentLanguage(root) {
    const locale = getLocale?.();
    if (locale === "en" || locale === "zh") return locale;
    const label = root.querySelector('[data-post-text="upscale"]')?.textContent || "";
    return label.includes("放大") ? "zh" : "en";
}

function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
}

function syncText(root, section) {
    const zh = currentLanguage(root) === "zh";
    setText(section.querySelector("[data-rtx-deblur-enabled-label]"), zh ? "开 / 关" : "ON / OFF");
    setText(section.querySelector("[data-rtx-deblur-quality-label]"), zh ? "质量" : "Quality");
    setText(section.querySelector("[data-rtx-deblur-strength-label]"), zh ? "强度" : "Strength");
}

function syncColumnState(root, section) {
    const column = root.querySelector('[data-section="global_refine"]');
    if (!column) return;
    const globalEnabled = !!root.querySelector('[data-path="global_refine.enabled"]')?.checked;
    const enabled = section.querySelector('[data-path="global_refine.rtx_deblur_enabled"]');
    const quality = section.querySelector('[data-path="global_refine.rtx_deblur_quality"]');
    const strength = section.querySelector('[data-path="global_refine.rtx_deblur_strength"]');
    const deblurEnabled = !!enabled?.checked;

    // RTX Deblur is a child stage of Global Refine. Keep its saved sub-toggle
    // value, but the master switch owns whether the stage can be configured or run.
    column.classList.toggle("mmx-post-disabled", !globalEnabled);
    section.classList.toggle("mmx-post-disabled", globalEnabled && !deblurEnabled);
    if (enabled) enabled.disabled = !globalEnabled;
    if (quality) quality.disabled = !globalEnabled || !deblurEnabled;
    if (strength) strength.disabled = !globalEnabled || !deblurEnabled;
}

function requestStoreRender(root) {
    const existingInput = root.querySelector('[data-path="global_refine.denoise"]')
        || root.querySelector('[data-path]');
    if (!existingInput) return;
    existingInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function bindRoot(root) {
    if (boundRoots.has(root)) return;
    boundRoots.add(root);
    root.addEventListener("change", () => {
        queueMicrotask(() => {
            const section = root.querySelector(SECTION_SELECTOR);
            if (section) syncColumnState(root, section);
        });
    });
}

function inject(root) {
    let section = root.querySelector(SECTION_SELECTOR);
    let created = false;
    if (!section) {
        const upscale = root.querySelector("[data-upscale-section]");
        if (!upscale) return false;

        section = document.createElement("div");
        section.className = "mmx-post-section mmx-rtx-deblur-section";
        section.dataset.rtxDeblurSection = "";
        section.innerHTML = `
          <div class="mmx-post-section-head">
            <h4>NVIDIA RTX Deblur</h4>
            <label class="mmx-post-subenable">
              <input type="checkbox" data-path="global_refine.rtx_deblur_enabled">
              <span data-rtx-deblur-enabled-label>ON / OFF</span>
            </label>
          </div>
          <div class="mmx-post-section-body">
            <div class="mmx-post-grid">
              <label class="mmx-post-field">
                <span data-rtx-deblur-quality-label>Quality</span>
                <select data-path="global_refine.rtx_deblur_quality">
                  <option value="" hidden>Medium</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </label>
              <label class="mmx-post-field">
                <span data-rtx-deblur-strength-label>Strength</span>
                <input type="number" min="0" max="3" step="0.05" data-path="global_refine.rtx_deblur_strength">
              </label>
            </div>
          </div>`;
        upscale.insertAdjacentElement("afterend", section);
        created = true;

        const enabled = section.querySelector('[data-path="global_refine.rtx_deblur_enabled"]');
        const quality = section.querySelector('[data-path="global_refine.rtx_deblur_quality"]');
        const strength = section.querySelector('[data-path="global_refine.rtx_deblur_strength"]');
        enabled?.addEventListener("change", () => {
            if (enabled.checked && quality && !quality.value) {
                quality.value = "medium";
                quality.dispatchEvent(new Event("change", { bubbles: true }));
            }
            if (enabled.checked && strength && !strength.value) {
                strength.value = "1";
                strength.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
    }

    bindRoot(root);
    syncText(root, section);
    if (created) requestStoreRender(root);
    syncColumnState(root, section);
    return true;
}

function scan() {
    document.querySelectorAll(ROOT_SELECTOR).forEach(inject);
}

function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(() => {
        scanScheduled = false;
        scan();
    });
}

function refreshAll() {
    scan();
    document.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
        const section = root.querySelector(SECTION_SELECTOR);
        if (!section) return;
        syncText(root, section);
        syncColumnState(root, section);
    });
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.RTXDeblurUI",
    setup() {
        if (!stopLocaleSync) stopLocaleSync = onLocaleChange(() => queueMicrotask(refreshAll));
        scheduleScan();
    },
    nodeCreated() {
        scheduleScan();
    },
    loadedGraphNode() {
        scheduleScan();
    },
});
