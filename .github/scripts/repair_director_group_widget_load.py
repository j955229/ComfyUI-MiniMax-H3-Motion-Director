from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

sampling = "web/js/minimax_sampling_ui.js"
anchor = '''function widgetIndexBefore(inputs, inputIndex) {\n    let index = 0;\n    for (let i = 0; i < inputIndex; i += 1) {\n        if (inputs[i]?.widget) index += 1;\n    }\n    return index;\n}\n\n'''
helper = anchor + '''const DIRECTOR_GROUP_INPUT_NAMES = new Set([\n    "bd_grp_sample",\n    "bd_grp_motion",\n    "bd_grp_advanced",\n    "bd_grp_perf",\n    "bd_grp_experimental",\n]);\n\n// Current Director widget serialization order. BDBROUP widgets are real widgets\n// when the frontend extension is loaded. If the extension fails during a graph\n// load, ComfyUI can persist them as input sockets instead, shifting every later\n// widget value by one slot. Repair that graph shape before node construction.\nconst DIRECTOR_GROUP_WIDGET_LAYOUT = Object.freeze([\n    [2, "采样设置"],\n    [12, "Motion Context"],\n    [18, "高级采样"],\n    [24, "性能"],\n    [27, "Experimental"],\n]);\n\nfunction isDirectorWorkflowNode(node) {\n    return String(node?.type || node?.comfyClass || "") === "MiniMaxH3MotionDirector";\n}\n\nfunction removePersistedDirectorGroupInputs(node) {\n    if (!Array.isArray(node?.inputs)) return [];\n    const removed = [];\n    node.inputs.forEach((input, index) => {\n        if (DIRECTOR_GROUP_INPUT_NAMES.has(String(input?.name || ""))) removed.push(index);\n    });\n    if (!removed.length) return removed;\n    const removeSet = new Set(removed);\n    node.inputs = node.inputs.filter((_, index) => !removeSet.has(index));\n    return removed;\n}\n\nfunction restoreMissingDirectorGroupWidgetValues(node) {\n    const values = node?.widgets_values;\n    if (!Array.isArray(values)) return 0;\n    let inserted = 0;\n    for (const [index, fallback] of DIRECTOR_GROUP_WIDGET_LAYOUT) {\n        // Every BDBROUP value is a string; the widget immediately following each\n        // group is numeric/boolean. This makes a missing group slot unambiguous.\n        if (index <= values.length && typeof values[index] !== "string") {\n            values.splice(index, 0, fallback);\n            inserted += 1;\n        }\n    }\n    return inserted;\n}\n\nexport function repairDirectorGroupWidgetWorkflow(graphData) {\n    if (!graphData || !Array.isArray(graphData.nodes)) return 0;\n    const removedByNode = new Map();\n    let repaired = 0;\n    for (const node of graphData.nodes) {\n        if (!isDirectorWorkflowNode(node)) continue;\n        const removed = removePersistedDirectorGroupInputs(node);\n        if (removed.length) {\n            removedByNode.set(String(node.id), removed);\n            repaired += removed.length;\n        }\n        repaired += restoreMissingDirectorGroupWidgetValues(node);\n    }\n    if (!removedByNode.size || !Array.isArray(graphData.links)) return repaired;\n\n    const adjustedSlot = (nodeId, slot) => {\n        const removed = removedByNode.get(String(nodeId));\n        if (!removed?.length) return slot;\n        const original = Number(slot);\n        if (!Number.isFinite(original)) return slot;\n        return original - removed.filter((index) => index < original).length;\n    };\n\n    for (const link of graphData.links) {\n        if (Array.isArray(link)) {\n            link[4] = adjustedSlot(link[3], link[4]);\n            continue;\n        }\n        if (!link || typeof link !== "object") continue;\n        const targetIdKey = "target_id" in link ? "target_id" : "targetId";\n        const targetSlotKey = "target_slot" in link ? "target_slot" : "targetSlot";\n        link[targetSlotKey] = adjustedSlot(link[targetIdKey], link[targetSlotKey]);\n    }\n    return repaired;\n}\n\n'''
replace_once(sampling, anchor, helper, "insert Director BDBROUP load repair")

# Import the repair helper into the Director extension.
timeline = "web/js/minimax_timeline.js"
replace_once(
    timeline,
    '''    migrateLegacySamplingControlNode,\n    migrateLegacySamplingControlWorkflow,\n    seedControlModeFromWidgets,\n''',
    '''    migrateLegacySamplingControlNode,\n    migrateLegacySamplingControlWorkflow,\n    repairDirectorGroupWidgetWorkflow,\n    seedControlModeFromWidgets,\n''',
    "import Director group workflow repair",
)
replace_once(
    timeline,
    '''    async beforeConfigureGraph(graphData) {\n        migrateLegacySamplingControlWorkflow(graphData);\n    },\n''',
    '''    async beforeConfigureGraph(graphData) {\n        migrateLegacySamplingControlWorkflow(graphData);\n        repairDirectorGroupWidgetWorkflow(graphData);\n    },\n''',
    "run Director group workflow repair before configure",
)

print("Director group widget load repair applied")
