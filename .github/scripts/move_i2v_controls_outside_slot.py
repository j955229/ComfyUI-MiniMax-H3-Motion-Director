from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

native = "web/js/minimax_mixed_native_inputs.mjs"
replace_once(
    native,
    'import { mixedSegmentVisibleFrameCount } from "./minimax_mixed_state.mjs?boot=mixed_native_v5";',
    'import { mixedSegmentVisibleFrameCount } from "./minimax_mixed_state.mjs?boot=mixed_native_v6";',
    "bump native state boot",
)
replace_once(
    native,
    'const NATIVE_STYLE_ID = "mmx-mixed-native-input-overrides-v2";',
    'const NATIVE_STYLE_ID = "mmx-mixed-native-input-overrides-v3";',
    "bump native style id",
)
replace_once(
    native,
    '.mmx-mixed-slot-tools .bd-btn.active{border-color:#4fff8f;color:#4fff8f;background:rgba(22,56,35,.92)}\n',
    '.mmx-mixed-slot-tools .bd-btn.active{border-color:#4fff8f;color:#4fff8f;background:rgba(22,56,35,.92)}\n'
    '.mmx-mixed-i2v-controls{display:flex;flex-direction:column;gap:5px;margin:0 0 6px;min-width:0}\n'
    '.mmx-mixed-i2v-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex-wrap:wrap;min-height:28px}\n'
    '.mmx-mixed-i2v-actions .mmx-mixed-slot-tools{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;display:flex;justify-content:flex-start;gap:8px;flex-wrap:wrap;width:auto}\n'
    '.mmx-mixed-i2v-actions .mmx-mixed-slot-tools .bd-btn{flex:0 0 auto;min-width:86px;padding:4px 10px;font-size:11px}\n'
    '.mmx-mixed-i2v-advanced-host:empty{display:none}\n'
    '.mmx-mixed-i2v-advanced-host .mmx-mixed-result-advanced{position:static;left:auto;right:auto;bottom:auto;width:100%;box-sizing:border-box;margin:0}\n',
    "add external I2V control layout",
)
replace_once(
    native,
    '    parent.appendChild(prompts);\n    return textarea;\n}',
    '    parent.appendChild(prompts);\n    return { textarea, prompts };\n}',
    "return prompt wrapper",
)
replace_once(
    native,
    'function appendIntegratedResultControls(slot, ctx, { role, staticKey }) {',
    'function appendIntegratedResultControls(slot, ctx, { role, staticKey, controlsHost = null, advancedHost = null }) {',
    "allow external control hosts",
)
replace_once(
    native,
    '    tools.append(uploadButton, resultButton);\n    slot.appendChild(tools);',
    '    tools.append(uploadButton, resultButton);\n    (controlsHost || slot).appendChild(tools);',
    "mount tools outside slot",
)
replace_once(
    native,
    '    panel.append(source, frameMode, frameIndex, range, remove);\n    slot.appendChild(panel);',
    '    panel.append(source, frameMode, frameIndex, range, remove);\n    (advancedHost || slot).appendChild(panel);',
    "mount advanced panel outside slot",
)
old_i2v = '''    source.onclick = (event) => {\n        if (event.target.closest?.(".x, .mmx-mixed-slot-tools, .mmx-mixed-result-advanced")) return;\n        void chooseAndStore({ seg, kind: "image", key: "startFrame", role: "i2v_start", upload, mutate, status, tr });\n    };\n    appendIntegratedResultControls(source, ctx, { role: "i2v_start", staticKey: "startFrame" });\n    media.appendChild(source);\n    card.appendChild(media);\n    appendPrompt(card, seg, onPromptInput, tr);\n    container.appendChild(card);\n}'''
new_i2v = '''    source.onclick = (event) => {\n        if (event.target.closest?.(".x, .mmx-mixed-result-summary")) return;\n        void chooseAndStore({ seg, kind: "image", key: "startFrame", role: "i2v_start", upload, mutate, status, tr });\n    };\n    media.appendChild(source);\n    card.appendChild(media);\n\n    const { prompts } = appendPrompt(card, seg, onPromptInput, tr);\n    prompts.classList.add("mmx-mixed-i2v-prompts");\n    const controls = document.createElement("div");\n    controls.className = "mmx-mixed-i2v-controls";\n    const actions = document.createElement("div");\n    actions.className = "mmx-mixed-i2v-actions";\n    const advanced = document.createElement("div");\n    advanced.className = "mmx-mixed-i2v-advanced-host";\n    controls.append(actions, advanced);\n    prompts.insertBefore(controls, prompts.firstChild);\n    appendIntegratedResultControls(source, ctx, {\n        role: "i2v_start",\n        staticKey: "startFrame",\n        controlsHost: actions,\n        advancedHost: advanced,\n    });\n    container.appendChild(card);\n}'''
replace_once(native, old_i2v, new_i2v, "move I2V controls beside preview")

# Keep the whole Mixed import graph on one cache generation so browsers cannot
# combine stale UI modules with the new native-input renderer.
replace_once(
    "web/js/minimax_mixed_ui_v2.mjs",
    '} from "./minimax_mixed_state.mjs?boot=mixed_native_v5";',
    '} from "./minimax_mixed_state.mjs?boot=mixed_native_v6";',
    "bump ui-v2 state boot",
)
replace_once(
    "web/js/minimax_mixed_ui_v2.mjs",
    'from "./minimax_mixed_native_inputs.mjs?boot=mixed_native_v5";',
    'from "./minimax_mixed_native_inputs.mjs?boot=mixed_native_v6";',
    "bump ui-v2 native boot",
)
replace_once(
    "web/js/minimax_mixed_ui.mjs",
    '} from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v5";',
    '} from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v6";',
    "bump mixed ui boot",
)
replace_once(
    "web/js/minimax_timeline.js",
    '} from "./minimax_mixed_ui.mjs?boot=mixed_native_v5";',
    '} from "./minimax_mixed_ui.mjs?boot=mixed_native_v6";',
    "bump timeline mixed ui boot",
)
replace_once(
    "web/js/minimax_timeline.js",
    'import { normalizeMixedTimeline } from "./minimax_mixed_state.mjs?boot=mixed_native_v5";',
    'import { normalizeMixedTimeline } from "./minimax_mixed_state.mjs?boot=mixed_native_v6";',
    "bump timeline mixed state boot",
)

print("I2V controls moved outside the narrow source slot")
