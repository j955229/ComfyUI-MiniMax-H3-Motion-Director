import { app } from "../../scripts/app.js";

const ROOT_SELECTOR = ".mmx-postprocess";
const SECTION_SELECTOR = "[data-rtx-deblur-section]";
const observedRoots = new WeakSet();

function isZh(root) {
    const label = root.querySelector('[data-post-text="upscale"]')?.textContent || "";
    return label.includes("放大");
}

function syncText(root, section) {
    const zh = isZh(root);
    const enabled = section.querySelector("[data-rtx-deblur-enabled-label]");
    const quality = section.querySelector("[data-rtx-deblur-quality-label]");
    if (enabled) enabled.textContent = zh ? "开 / 关" : "ON / OFF";
    if (quality) quality.textContent = zh ? "质量" : "Quality";
}

function syncColumnState(root, section) {
    const column = root.querySelector('[data-section="global_refine"]');
    const enabled = section.querySelector('[data-path="global_refine.rtx_deblur_enabled"]');
    if (column && enabled?.checked) column.classList.remove("mmx-post-disabled");
}

function inject(root) {
    let section = root.querySelector(SECTION_SELECTOR);
    if (!section) {
        const upscale = root.querySelector("[data-upscale-section]");
        if (!upscale) return;

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
            </div>
          </div>`;
        upscale.insertAdjacentElement("afterend", section);

        const enabled = section.querySelector('[data-path="global_refine.rtx_deblur_enabled"]');
        const quality = section.querySelector('[data-path="global_refine.rtx_deblur_quality"]');
        enabled?.addEventListener("change", () => {
            if (quality && !quality.value) {
                quality.value = "medium";
                quality.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        root.addEventListener("change", () => {
            queueMicrotask(() => syncColumnState(root, section));
        });
    }

    syncText(root, section);
    syncColumnState(root, section);

    if (!observedRoots.has(root)) {
        observedRoots.add(root);
        const localeObserver = new MutationObserver(() => {
            const liveSection = root.querySelector(SECTION_SELECTOR);
            if (liveSection) {
                syncText(root, liveSection);
                syncColumnState(root, liveSection);
            }
        });
        localeObserver.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class"],
        });
    }
}

function scan() {
    document.querySelectorAll(ROOT_SELECTOR).forEach(inject);
}

app.registerExtension({
    name: "MiniMaxH3.MotionDirector.RTXDeblurUI",
    async setup() {
        let scheduled = false;
        const scheduleScan = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                scan();
            });
        };
        const observer = new MutationObserver(scheduleScan);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scan();
    },
});
