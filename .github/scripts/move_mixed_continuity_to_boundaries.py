from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

path = 'web/js/minimax_mixed_ui_v2.mjs'

# Boundary layout styles: vertical separator between horizontal segment cards.
replace_once(
    path,
    '.mmx-mixed-cards{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;min-height:0;padding:2px;align-items:stretch}.mmx-mixed-card{flex:1 0 190px;min-width:190px;min-height:112px;cursor:pointer;position:relative}.mmx-mixed-card.selected{outline:1px solid #4fff8f}.mmx-mixed-card.invalid{outline:1px solid #e46d6d}.mmx-mixed-card-head{display:flex;align-items:center;gap:6px}.mmx-mixed-card-head b{white-space:nowrap}.mmx-mixed-card-prompt{min-height:34px;max-height:38px;overflow:hidden;white-space:pre-wrap}.mmx-mixed-card-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:auto}.mmx-mixed-card-actions .bd-btn{padding:3px 6px;font-size:10px}\n.mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.mmx-mixed-editor-panel{min-height:0;overflow:visible}.mmx-mixed-continuity-panel{min-height:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 8px!important;overflow:visible}.mmx-mixed-continuity-panel>b{font-size:11px;color:#999;font-weight:500}.mmx-mixed-continuity-panel .mmx-mixed-toggle{border:1px solid #444;border-radius:999px;padding:5px 9px;background:#171717}.mmx-mixed-field{display:flex;flex-direction:column;gap:4px}',
    '.mmx-mixed-cards{display:flex;gap:0;overflow-x:auto;overflow-y:hidden;min-height:0;padding:2px;align-items:stretch}.mmx-mixed-card{flex:1 0 190px;min-width:190px;min-height:112px;cursor:pointer;position:relative}.mmx-mixed-card.selected{outline:1px solid #4fff8f}.mmx-mixed-card.invalid{outline:1px solid #e46d6d}.mmx-mixed-card-head{display:flex;align-items:center;gap:6px}.mmx-mixed-card-head b{white-space:nowrap}.mmx-mixed-card-prompt{min-height:34px;max-height:38px;overflow:hidden;white-space:pre-wrap}.mmx-mixed-card-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:auto}.mmx-mixed-card-actions .bd-btn{padding:3px 6px;font-size:10px}\n.mmx-mixed-boundary{flex:0 0 58px;min-width:58px;position:relative;display:flex;align-items:center;justify-content:center;align-self:stretch;min-height:112px}.mmx-mixed-boundary::before{content:"";position:absolute;left:50%;top:5px;bottom:5px;width:1px;background:#3d3d3d;transform:translateX(-50%)}.mmx-mixed-boundary-controls{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:4px 3px;background:#121212;border:1px solid #333;border-radius:16px}.mmx-mixed-boundary-label{font-size:9px;line-height:1;color:#777;white-space:nowrap;padding:0 2px}.mmx-mixed-boundary-btn{width:28px;height:28px;min-width:28px;padding:0;border-radius:50%;border:1px solid #4a4a4a;background:#1b1b1b;color:#aaa;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer}.mmx-mixed-boundary-btn:hover{border-color:#777;color:#ddd}.mmx-mixed-boundary-btn.active{border-color:#4fff8f;background:#153922;color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.12)}\n.mmx-mixed-editor-grid{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.mmx-mixed-editor-panel{min-height:0;overflow:visible}.mmx-mixed-field{display:flex;flex-direction:column;gap:4px}'
)

# Insert a renderer for the per-boundary continuity controls immediately before timeline rendering.
replace_once(
    path,
    '    function renderTimeline(panel) {\n',
    '''    function renderBoundaryConnector(container, leftIndex) {\n        const rightIndex = leftIndex + 1;\n        const rightSeg = state.segments[rightIndex];\n        if (!rightSeg) return;\n        rightSeg.continuity = rightSeg.continuity || { visual: false, audio: false };\n\n        const boundary = document.createElement("div");\n        boundary.className = "mmx-mixed-boundary";\n        boundary.dataset.mmxBoundary = `${leftIndex}-${rightIndex}`;\n\n        const controls = document.createElement("div");\n        controls.className = "mmx-mixed-boundary-controls";\n\n        const edge = document.createElement("div");\n        edge.className = "mmx-mixed-boundary-label";\n        edge.textContent = `S${leftIndex + 1}→S${rightIndex + 1}`;\n        controls.appendChild(edge);\n\n        for (const [key, textKey, glyph] of [\n            ["visual", "mixed.visualContext", "↔"],\n            ["audio", "mixed.audioContext", "♪"],\n        ]) {\n            const button = document.createElement("button");\n            button.type = "button";\n            button.className = `mmx-mixed-boundary-btn${rightSeg.continuity?.[key] ? " active" : ""}`;\n            button.textContent = glyph;\n            button.title = mt(textKey);\n            button.setAttribute("aria-label", mt(textKey));\n            button.setAttribute("aria-pressed", rightSeg.continuity?.[key] ? "true" : "false");\n            button.addEventListener("click", (event) => {\n                event.preventDefault();\n                event.stopPropagation();\n                mutate(() => {\n                    rightSeg.continuity = rightSeg.continuity || {};\n                    rightSeg.continuity[key] = !rightSeg.continuity[key];\n                });\n            });\n            controls.appendChild(button);\n        }\n\n        boundary.appendChild(controls);\n        container.appendChild(boundary);\n    }\n\n    function renderTimeline(panel) {\n'''
)

# Append a connector after each card except the last.
replace_once(
    path,
    '            card.append(head, prompt, actions);\n            cards.appendChild(card);\n        });\n',
    '            card.append(head, prompt, actions);\n            cards.appendChild(card);\n            if (index < state.segments.length - 1) renderBoundaryConnector(cards, index);\n        });\n'
)

# Editor no longer receives/owns continuity controls; warnings stay with the selected editor.
replace_once(path, '    function renderEditor(panel, continuityPanel) {\n', '    function renderEditor(panel) {\n')

old_block = '''        const continuityTitle = document.createElement("b");\n        setI18n(continuityTitle, "mixed.continuity");\n        continuityPanel.appendChild(continuityTitle);\n        if (selectedIndex === 0) {\n            const note = document.createElement("div");\n            note.className = "bd-meta";\n            setI18n(note, "mixed.rootNoContinuity");\n            continuityPanel.appendChild(note);\n        } else {\n            for (const [key, textKey] of [["visual", "mixed.visualContext"], ["audio", "mixed.audioContext"]]) {\n                const label = document.createElement("label");\n                label.className = "mmx-mixed-toggle";\n                const input = document.createElement("input");\n                input.type = "checkbox";\n                input.checked = !!seg.continuity?.[key];\n                input.onchange = () => mutate(() => {\n                    seg.continuity = seg.continuity || {};\n                    seg.continuity[key] = input.checked;\n                });\n                const text = document.createElement("span");\n                setI18n(text, textKey);\n                label.append(input, text);\n                continuityPanel.appendChild(label);\n            }\n        }\n        const errors = validateMixedReferences(state.segments, state.frameRate || 24).filter((error) => String(error.consumerId) === String(seg.id));\n        for (const _error of errors) {\n            const warning = document.createElement("div");\n            warning.className = "bd-meta mmx-mixed-warning";\n            setI18n(warning, "mixed.referenceMissing");\n            continuityPanel.appendChild(warning);\n        }\n'''
new_block = '''        const errors = validateMixedReferences(state.segments, state.frameRate || 24).filter((error) => String(error.consumerId) === String(seg.id));\n        for (const _error of errors) {\n            const warning = document.createElement("div");\n            warning.className = "bd-meta mmx-mixed-warning";\n            setI18n(warning, "mixed.referenceMissing");\n            panel.appendChild(warning);\n        }\n'''
replace_once(path, old_block, new_block)

replace_once(
    path,
    '''        const editorPanel = document.createElement("section");\n        editorPanel.className = "bd-panel mmx-mixed-editor-panel";\n        const continuityPanel = document.createElement("section");\n        continuityPanel.className = "bd-panel mmx-mixed-continuity-panel";\n        renderEditor(editorPanel, continuityPanel);\n        if (selectedIndex > 0) grid.appendChild(continuityPanel);\n        grid.appendChild(editorPanel);\n''',
    '''        const editorPanel = document.createElement("section");\n        editorPanel.className = "bd-panel mmx-mixed-editor-panel";\n        renderEditor(editorPanel);\n        grid.appendChild(editorPanel);\n'''
)

# Bump Mixed UI module boot keys so the browser cannot keep the old layout module.
replace_once(
    'web/js/minimax_mixed_ui.mjs',
    'from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v6";',
    'from "./minimax_mixed_ui_v2.mjs?boot=mixed_native_v7";'
)
replace_once(
    'web/js/minimax_timeline.js',
    'from "./minimax_mixed_ui.mjs?boot=mixed_native_v6";',
    'from "./minimax_mixed_ui.mjs?boot=mixed_native_v7";'
)
