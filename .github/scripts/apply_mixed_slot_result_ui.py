from pathlib import Path
import re

path = Path('web/js/minimax_mixed_native_inputs.mjs')
s = path.read_text(encoding='utf-8')

def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    s = s.replace(old, new, 1)

replace_once(
    'const pictureVisibility = new Map();\n',
    '''const pictureVisibility = new Map();
const resultAdvancedVisibility = new Map();
const NATIVE_STYLE_ID = "mmx-mixed-native-input-overrides-v2";

function ensureNativeStyles() {
    if (document.getElementById(NATIVE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NATIVE_STYLE_ID;
    style.textContent = `
.mmx-mixed-root .mmx-mixed-continuity-panel{width:100%;box-sizing:border-box;display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;flex-wrap:nowrap!important;gap:14px!important;min-height:0!important;height:auto!important;padding:6px 10px!important;margin:0!important;overflow:visible!important}
.mmx-mixed-root .mmx-mixed-continuity-panel>b{margin:0!important;white-space:nowrap}
.mmx-mixed-root .mmx-mixed-continuity-panel .mmx-mixed-toggle{display:inline-flex!important;align-items:center!important;gap:6px!important;margin:0!important;padding:4px 8px!important;white-space:nowrap}
.bd-batch-src.mmx-mixed-native-slot,.bd-fl2v-slot.mmx-mixed-native-slot{position:relative!important}
.mmx-mixed-slot-tools{position:absolute;left:7px;right:7px;bottom:7px;z-index:8;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto}
.mmx-mixed-slot-tools .bd-btn{padding:3px 8px;font-size:10px;background:rgba(18,18,18,.88);backdrop-filter:blur(2px)}
.mmx-mixed-slot-tools .bd-btn.active{border-color:#4fff8f;color:#4fff8f;background:rgba(22,56,35,.92)}
.mmx-mixed-result-summary{display:inline-flex;align-items:center;justify-content:center;max-width:calc(100% - 22px);padding:5px 8px;border:1px solid rgba(79,255,143,.55);border-radius:5px;background:rgba(12,30,20,.78);color:#bfffd4;font-size:11px;text-align:center;pointer-events:none}
.mmx-mixed-result-advanced{position:absolute;left:7px;right:7px;bottom:38px;z-index:9;display:grid;grid-template-columns:minmax(110px,1fr) auto minmax(70px,110px) auto;gap:5px;align-items:center;padding:6px;border:1px solid #46515a;border-radius:6px;background:rgba(18,21,23,.96);box-shadow:0 4px 16px rgba(0,0,0,.45)}
.mmx-mixed-result-advanced .bd-select,.mmx-mixed-result-advanced input{min-width:0;width:100%;box-sizing:border-box}
.mmx-mixed-result-advanced input{background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:5px 7px}
@media(max-width:760px){.mmx-mixed-root .mmx-mixed-continuity-panel{gap:7px!important}.mmx-mixed-result-advanced{grid-template-columns:1fr 90px}.mmx-mixed-result-advanced .bd-btn{grid-column:auto}}
`;
    document.head.appendChild(style);
}
''',
    'native style bootstrap',
)

replace_once(
    '''function addResultRef(seg, role, sourceId) {
    const inputs = ensureInputs(seg);
    if (role !== "identity") removeRoleRefs(seg, role);
    inputs.resultRefs.push({ role, origin: "segment", segmentId: sourceId, frame: "last" });
}
''',
    '''function addResultRef(seg, role, sourceId) {
    const inputs = ensureInputs(seg);
    if (role !== "identity") removeRoleRefs(seg, role);
    inputs.resultRefs.push({ role, origin: "segment", segmentId: sourceId, frame: "last" });
}

function resultAdvancedKey(seg, role) {
    return `${seg?.id || "segment"}:${role}`;
}

function resultSourceIndex(ref, segmentIndex, segments) {
    const index = segments.findIndex((segment, i) => i < segmentIndex && String(segment?.id) === String(ref?.segmentId));
    return index >= 0 ? index : Math.max(0, segmentIndex - 1);
}

function resultSummary(ref, segmentIndex, segments, tr) {
    const sourceIndex = resultSourceIndex(ref, segmentIndex, segments);
    if (ref?.frame === "last" || ref?.frame == null) {
        return tr("mixed.resultSummaryLast", { n: sourceIndex + 1 });
    }
    return tr("mixed.resultSummaryFrame", { n: sourceIndex + 1, frame: ref.frame });
}
''',
    'result summary helpers',
)

# The old standalone Segment Result row beneath I2V/FL2V slots is removed.
pattern = re.compile(r'''\nfunction appendSingleResultAction\(parent, seg, role, staticKey, segmentIndex, segments, mutate, tr\) \{.*?\n\}\n\nfunction renderT2v''', re.S)
replacement = '''
function appendIntegratedResultControls(slot, ctx, { role, staticKey }) {
    const { seg, segmentIndex, segments, mutate, upload, status, tr } = ctx;
    const ref = refsFor(seg, role)[0] || null;
    const advancedKey = resultAdvancedKey(seg, role);
    const tools = document.createElement("div");
    tools.className = "mmx-mixed-slot-tools";

    const uploadButton = button(tr("mixed.upload"), () => {
        void chooseAndStore({ seg, kind: "image", key: staticKey, role, upload, mutate, status, tr });
    });
    const resultButton = button(tr("mixed.segmentResult"), () => mutate(() => {
        if (segmentIndex <= 0) return;
        delete ensureInputs(seg)[staticKey];
        addResultRef(seg, role, segments[segmentIndex - 1].id);
        resultAdvancedVisibility.set(advancedKey, false);
    }), { disabled: segmentIndex <= 0 });
    resultButton.classList.toggle("active", !!ref);
    tools.append(uploadButton, resultButton);

    if (ref) {
        const advancedButton = button(tr("mixed.resultAdvanced"), () => {
            resultAdvancedVisibility.set(advancedKey, !resultAdvancedVisibility.get(advancedKey));
            mutate(() => {});
        });
        advancedButton.classList.toggle("active", !!resultAdvancedVisibility.get(advancedKey));
        tools.appendChild(advancedButton);
    }
    slot.appendChild(tools);

    if (!ref || !resultAdvancedVisibility.get(advancedKey)) return;
    const panel = document.createElement("div");
    panel.className = "mmx-mixed-result-advanced";

    const source = document.createElement("select");
    source.className = "bd-select";
    source.title = tr("mixed.resultSource");
    for (let index = 0; index < segmentIndex; index += 1) {
        const option = document.createElement("option");
        option.value = segments[index].id;
        option.textContent = tr("mixed.segment", { n: index + 1 });
        source.appendChild(option);
    }
    source.value = ref.segmentId || segments[Math.max(0, segmentIndex - 1)]?.id || "";
    source.onchange = () => mutate(() => { ref.segmentId = source.value; });

    const frameMode = document.createElement("select");
    frameMode.className = "bd-select";
    const last = document.createElement("option");
    last.value = "last";
    last.textContent = tr("mixed.resultLast");
    const indexedFrame = document.createElement("option");
    indexedFrame.value = "index";
    indexedFrame.textContent = tr("mixed.resultFrameIndex");
    frameMode.append(last, indexedFrame);
    frameMode.value = ref.frame === "last" || ref.frame == null ? "last" : "index";
    frameMode.onchange = () => mutate(() => {
        ref.frame = frameMode.value === "last" ? "last" : (ref.frame === "last" || ref.frame == null ? 0 : Math.max(0, Number.parseInt(ref.frame, 10) || 0));
    });

    const frameIndex = document.createElement("input");
    frameIndex.type = "number";
    frameIndex.min = "0";
    frameIndex.step = "1";
    frameIndex.title = tr("mixed.resultFrameIndex");
    frameIndex.disabled = frameMode.value === "last";
    frameIndex.value = frameMode.value === "last" ? "" : String(Math.max(0, Number.parseInt(ref.frame, 10) || 0));
    frameIndex.onchange = () => mutate(() => {
        ref.frame = Math.max(0, Number.parseInt(frameIndex.value, 10) || 0);
    });

    const remove = button(tr("mixed.remove"), () => mutate(() => {
        removeRoleRefs(seg, role);
        resultAdvancedVisibility.delete(advancedKey);
    }));
    panel.append(source, frameMode, frameIndex, remove);
    slot.appendChild(panel);
}

function renderT2v'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'remove external result action: expected 1 match, got {count}')

pattern = re.compile(r'''function renderI2v\(container, ctx\) \{.*?\n\}\n\nfunction renderFl2vSlot''', re.S)
replacement = '''function renderI2v(container, ctx) {
    const { seg, segmentIndex, segments, mutate, upload, viewUrl, status, onPromptInput, tr } = ctx;
    const inputs = ensureInputs(seg);
    const card = document.createElement("div");
    card.className = "bd-batch-card bd-batch-source mmx-mixed-native-card";
    appendCardHead(card, seg, segmentIndex, mutate, tr);

    const media = document.createElement("div");
    media.className = "bd-batch-media";
    const source = document.createElement("div");
    source.className = "bd-batch-src mmx-mixed-native-slot";
    const item = inputs.startFrame || null;
    const ref = refsFor(seg, "i2v_start")[0] || null;
    if (item?.imageFile) {
        source.classList.add("has-img");
        const img = document.createElement("img");
        img.src = viewUrl(item);
        img.alt = descriptorName(item, tr("mixed.startFrame"));
        source.appendChild(img);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => { delete ensureInputs(seg).startFrame; });
        };
        source.appendChild(x);
    } else if (ref) {
        const summary = document.createElement("span");
        summary.className = "mmx-mixed-result-summary";
        summary.textContent = resultSummary(ref, segmentIndex, segments, tr);
        source.appendChild(summary);
    } else {
        source.textContent = tr("mixed.startFrame");
    }
    source.onclick = (event) => {
        if (event.target.closest?.(".x, .mmx-mixed-slot-tools, .mmx-mixed-result-advanced")) return;
        void chooseAndStore({ seg, kind: "image", key: "startFrame", role: "i2v_start", upload, mutate, status, tr });
    };
    appendIntegratedResultControls(source, ctx, { role: "i2v_start", staticKey: "startFrame" });
    media.appendChild(source);
    card.appendChild(media);
    appendPrompt(card, seg, onPromptInput, tr);
    container.appendChild(card);
}

function renderFl2vSlot'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'replace I2V integrated source slot: expected 1 match, got {count}')

pattern = re.compile(r'''function renderFl2vSlot\(wrap, ctx, \{ role, staticKey, labelKey, tagClass \}\) \{.*?\n\}\n\nfunction renderFl2v\(''', re.S)
replacement = '''function renderFl2vSlot(wrap, ctx, { role, staticKey, labelKey, tagClass }) {
    const { seg, segmentIndex, segments, mutate, upload, viewUrl, status, tr } = ctx;
    const inputs = ensureInputs(seg);
    const slot = document.createElement("div");
    slot.className = "bd-fl2v-slot mmx-mixed-native-slot";
    slot.dataset.slot = tagClass === "start" ? "start" : "end";
    const item = inputs[staticKey] || null;
    const ref = refsFor(seg, role)[0] || null;
    if (item?.imageFile) {
        slot.classList.add("has-img");
        const img = document.createElement("img");
        img.src = viewUrl(item);
        img.alt = descriptorName(item, tr(labelKey));
        const tag = document.createElement("span");
        tag.className = `tag ${tagClass}`;
        tag.textContent = tr(labelKey);
        slot.append(img, tag);
        wrap.classList.add("has-img");
        const x = document.createElement("button");
        x.type = "button";
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => { delete ensureInputs(seg)[staticKey]; });
        };
        wrap.appendChild(x);
    } else {
        const ph = document.createElement("span");
        ph.className = ref ? "mmx-mixed-result-summary" : "ph";
        ph.textContent = ref ? resultSummary(ref, segmentIndex, segments, tr) : tr(labelKey);
        slot.appendChild(ph);
    }
    slot.onclick = (event) => {
        if (event.target.closest?.(".x, .mmx-mixed-slot-tools, .mmx-mixed-result-advanced")) return;
        void chooseAndStore({ seg, kind: "image", key: staticKey, role, upload, mutate, status, tr });
    };
    appendIntegratedResultControls(slot, ctx, { role, staticKey });
    wrap.appendChild(slot);
}

function renderFl2v('''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'replace FL2V integrated source slot: expected 1 match, got {count}')

replace_once(
    '''}) {
    if (!container || !seg) return;
    ensureInputs(seg);
''',
    '''}) {
    if (!container || !seg) return;
    ensureNativeStyles();
    ensureInputs(seg);
''',
    'activate native override styles',
)

path.write_text(s, encoding='utf-8')
print('Integrated I2V/FL2V Segment Result UI patch applied.')
