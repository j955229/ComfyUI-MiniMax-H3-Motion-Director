from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Mixed continuity requests remain authoritative at schema level.
replace_once(
    'director/mixed_schema.py',
'''    # A newly uploaded/static I2V start image is an explicit visual reset.\n    # A Mixed Segment Result start frame is different: it is sampled from an\n    # earlier generated segment and may intentionally be combined with that\n    # previous segment's Motion Context. Runtime materialization clears\n    # ``source_clip`` for result-backed I2V, so the executor preserves the\n    # requested visual ContextLink for that continuation case.\n    if normalize_mixed_mode(segment.get("mode")) == "i2v":\n        inputs = segment.get("inputs") or {}\n        has_static_start = bool(inputs.get("startFrame") or inputs.get("start_frame"))\n        if has_static_start:\n            visual = False\n\n    return {"visual": visual, "audio": audio}\n''',
'''    # Preserve the user's per-boundary request here. Runtime owns task-specific\n    # compatibility decisions so REPORT can distinguish requested ON from actual\n    # OFF. In particular, result-backed I2V may combine the predecessor's last\n    # frame with Motion Context, while an independently uploaded I2V start image\n    # is reported as an explicit visual reset by resolve_context_link().\n    return {"visual": visual, "audio": audio}\n'''
)

# 2) Mixed derives the old global masters from its per-boundary links.
replace_once(
    'nodes/director.py',
'''        if bool(getattr(plan, "mixed_mode", False)):\n            bind_mixed_runtime_node(plan, unique_id)\n            source_overlap_frames = 0\n''',
'''        if bool(getattr(plan, "mixed_mode", False)):\n            bind_mixed_runtime_node(plan, unique_id)\n            source_overlap_frames = 0\n            # Mixed per-boundary toggles are authoritative. The legacy node-level\n            # masters are hidden in Mixed mode and must never silently gate a link.\n            links = [getattr(segment, "context_link", None) for segment in plan.segments]\n            motion_context_enabled = any(\n                bool(link and link.visual_enabled) for link in links\n            )\n            audio_context_enabled = any(\n                bool(link and link.audio_enabled) for link in links\n            )\n'''
)

replace_once(
    'nodes/director.py',
'''                    frame_count=outputs[3],\n                    save_config=save_config,\n                    prompt=prompt,\n                    extra_pnginfo=extra_pnginfo,\n''',
'''                    frame_count=outputs[3],\n                    save_config=save_config,\n                    prompt=prompt,\n                    extra_pnginfo=extra_pnginfo,\n                    segment_indices=[\n                        int(getattr(segment, "timeline_index", segment.index))\n                        for segment in (\n                            plan.segments\n                            if plan.export_mode == "all"\n                            else [\n                                plan.segments[index]\n                                for index in sorted(\n                                    plan.run_indices\n                                    if plan.run_indices is not None\n                                    else range(len(plan.segments))\n                                )\n                            ]\n                        )\n                    ],\n                    segment_frame_counts=[\n                        int(segment.frame_count)\n                        for segment in (\n                            plan.segments\n                            if plan.export_mode == "all"\n                            else [\n                                plan.segments[index]\n                                for index in sorted(\n                                    plan.run_indices\n                                    if plan.run_indices is not None\n                                    else range(len(plan.segments))\n                                )\n                            ]\n                        )\n                    ],\n'''
)

# 3) Node-level continuity facade: Mixed shows global tuning only, never old masters.
replace_once(
    'web/js/minimax_continuity_ui.mjs',
'''    const bridgeTask = BRIDGE_TASKS.has(task);\n    const motionTask = MOTION_CONTEXT_TASKS.has(task);\n''',
'''    const bridgeTask = BRIDGE_TASKS.has(task);\n    const motionTask = MOTION_CONTEXT_TASKS.has(task);\n    const mixedTask = task === "mixed";\n'''
)
replace_once(
    'web/js/minimax_continuity_ui.mjs',
'''    let mode = "unsupported";\n    if (!multiSegment) mode = "single";\n    else if (motionTask) mode = "motion_context_task";\n    else if (bridgeTask) mode = "video_strategy";\n''',
'''    let mode = "unsupported";\n    if (!multiSegment) mode = "single";\n    else if (mixedTask) mode = "mixed";\n    else if (motionTask) mode = "motion_context_task";\n    else if (bridgeTask) mode = "video_strategy";\n'''
)
replace_once(
    'web/js/minimax_continuity_ui.mjs',
'''    const supportedVisualTask = VISUAL_MOTION_CONTEXT_TASKS.has(task);\n    const showColorReanchor = multiSegment && supportedVisualTask;\n    const showContextFrames = generatedMotionUi || videoMotionUi;\n    const showAudioContinuation = multiSegment && supportedVisualTask;\n''',
'''    const supportedVisualTask = VISUAL_MOTION_CONTEXT_TASKS.has(task);\n    const showColorReanchor = multiSegment && (supportedVisualTask || mixedTask);\n    const showContextFrames = generatedMotionUi || videoMotionUi || (mixedTask && multiSegment);\n    const showAudioContinuation = multiSegment && supportedVisualTask;\n'''
)
replace_once(
    'web/js/minimax_continuity_ui.mjs',
'''        contextFramesControlEnabled: motionActive,\n        audioContextControlEnabled: audioContinuationActive,\n        colorReanchorControlEnabled: showColorReanchor && motionActive,\n        colorReanchorEnabled: boolValue(colorReanchorEnabled),\n        pinRenormControlEnabled: multiSegment && supportedVisualTask && motionActive,\n''',
'''        contextFramesControlEnabled: mixedTask ? multiSegment : motionActive,\n        audioContextControlEnabled: audioContinuationActive,\n        colorReanchorControlEnabled: mixedTask ? multiSegment : (showColorReanchor && motionActive),\n        colorReanchorEnabled: boolValue(colorReanchorEnabled),\n        pinRenormControlEnabled: mixedTask\n            ? multiSegment\n            : (multiSegment && supportedVisualTask && motionActive),\n'''
)

# 4) Range-capable FinalVideo registry without duplicating frame tensors.
replace_once(
    'director/video_export.py',
'''    frame_count: int\n    prompt: Any = None\n''',
'''    frame_count: int\n    images: torch.Tensor | None = None\n    audio: dict[str, Any] | None = None\n    segment_indices: tuple[int, ...] = ()\n    segment_frame_counts: tuple[int, ...] = ()\n    prompt: Any = None\n'''
)
replace_once(
    'director/video_export.py',
'''        save_config: Any,\n        prompt: Any = None,\n        extra_pnginfo: dict[str, Any] | None = None,\n''',
'''        save_config: Any,\n        prompt: Any = None,\n        extra_pnginfo: dict[str, Any] | None = None,\n        segment_indices: list[int] | tuple[int, ...] | None = None,\n        segment_frame_counts: list[int] | tuple[int, ...] | None = None,\n'''
)
replace_once(
    'director/video_export.py',
'''            video = self.video_factory(images, audio, float(fps))\n            record = FinalVideoRecord(\n                node, run_id, video, float(fps), int(frame_count), prompt, extra_pnginfo\n            )\n''',
'''            final_images = _combine_images(images)\n            final_audio = _combine_audio(audio)\n            video = self.video_factory(final_images, final_audio, float(fps))\n            record = FinalVideoRecord(\n                node_id=node,\n                run_id=run_id,\n                video=video,\n                fps=float(fps),\n                frame_count=int(frame_count),\n                images=final_images,\n                audio=final_audio,\n                segment_indices=tuple(int(value) for value in (segment_indices or ())),\n                segment_frame_counts=tuple(int(value) for value in (segment_frame_counts or ())),\n                prompt=prompt,\n                extra_pnginfo=extra_pnginfo,\n            )\n'''
)
replace_once(
    'director/video_export.py',
'''    def save(self, node_id: Any, run_id: Any, config: Any) -> dict[str, Any]:\n        record = self.get(node_id, run_id)\n        with record.lock:\n            return self.saver(record, normalize_save_config(config))\n''',
'''    def _range_record(self, record: FinalVideoRecord, start: int, end: int) -> FinalVideoRecord:\n        if start < 0 or end < start:\n            raise ValueError("Invalid segment range")\n        indices = list(record.segment_indices)\n        counts = list(record.segment_frame_counts)\n        if not indices or len(indices) != len(counts):\n            raise FinalVideoUnavailable("Segment range metadata is unavailable for this Final Result")\n        expected = list(range(start, end + 1))\n        positions = [pos for pos, index in enumerate(indices) if start <= index <= end]\n        actual = [indices[pos] for pos in positions]\n        if actual != expected:\n            missing = [index + 1 for index in expected if index not in actual]\n            raise FinalVideoUnavailable(\n                f"Requested segment range contains unavailable segment(s): {missing}"\n            )\n        if record.images is None:\n            raise FinalVideoUnavailable("Final Result image frames are unavailable")\n        offsets = [0]\n        for count in counts:\n            offsets.append(offsets[-1] + max(0, int(count)))\n        first_pos, last_pos = positions[0], positions[-1]\n        frame_start = offsets[first_pos]\n        frame_end = offsets[last_pos + 1]\n        if frame_end > int(record.images.shape[0]):\n            raise FinalVideoUnavailable("Segment range exceeds Final Result frame count")\n        images = record.images[frame_start:frame_end]\n        audio = None\n        if isinstance(record.audio, dict) and isinstance(record.audio.get("waveform"), torch.Tensor):\n            sample_rate = int(record.audio.get("sample_rate") or 0)\n            if sample_rate > 0:\n                sample_start = max(0, int(round(frame_start / record.fps * sample_rate)))\n                sample_end = max(sample_start, int(round(frame_end / record.fps * sample_rate)))\n                waveform = record.audio["waveform"][..., sample_start:sample_end]\n                audio = {**record.audio, "waveform": waveform}\n        metadata = dict(record.extra_pnginfo or {})\n        metadata["motion_director_result_range"] = {\n            "start_segment": start + 1,\n            "end_segment": end + 1,\n        }\n        return FinalVideoRecord(\n            node_id=record.node_id,\n            run_id=record.run_id,\n            video=self.video_factory(images, audio, record.fps),\n            fps=record.fps,\n            frame_count=int(images.shape[0]),\n            images=images,\n            audio=audio,\n            segment_indices=tuple(expected),\n            segment_frame_counts=tuple(counts[pos] for pos in positions),\n            prompt=record.prompt,\n            extra_pnginfo=metadata,\n        )\n\n    def save(\n        self,\n        node_id: Any,\n        run_id: Any,\n        config: Any,\n        segment_range: Any = None,\n    ) -> dict[str, Any]:\n        record = self.get(node_id, run_id)\n        with record.lock:\n            save_config = normalize_save_config(config)\n            target = record\n            if isinstance(segment_range, dict):\n                start = int(segment_range.get("start", 0))\n                end = int(segment_range.get("end", start))\n                target = self._range_record(record, start, end)\n                save_config["filename_prefix"] = (\n                    f"{save_config['filename_prefix']}_segments_{start + 1}-{end + 1}"\n                )\n            return self.saver(target, save_config)\n'''
)

# 5) HTTP route forwards the requested segment range.
replace_once(
    'director/http_routes.py',
'''        result = FINAL_VIDEO_REGISTRY.save(node_id, run_id, body.get("save") or body)\n''',
'''        result = FINAL_VIDEO_REGISTRY.save(\n            node_id,\n            run_id,\n            body.get("save") or body,\n            segment_range=body.get("segment_range"),\n        )\n'''
)

# 6) Results UI: start/end selectors, range preview, and range save.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        available_range: "Available generated range",\n        final_pipeline: "Final pipeline result",\n''',
'''        available_range: "Available generated range",\n        range_start: "Start Segment",\n        range_end: "End Segment",\n        final_pipeline: "Final pipeline result",\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        available_range: "当前有效片段范围",\n        final_pipeline: "最终管线成果",\n''',
'''        available_range: "当前有效片段范围",\n        range_start: "起始段",\n        range_end: "结束段",\n        final_pipeline: "最终管线成果",\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''.mmx-result-source select,\n.mmx-result-source input{\n''',
'''.mmx-result-source select,\n.mmx-result-source input{\n'''
)
# Insert dedicated range layout immediately after the shared source control rule.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''    color:#ddd\n}\n\n.mmx-result-controls{\n''',
'''    color:#ddd\n}\n\n.mmx-result-range{\n    display:flex;\n    align-items:center;\n    gap:6px\n}\n\n.mmx-result-range label{\n    display:flex;\n    align-items:center;\n    gap:5px;\n    white-space:nowrap\n}\n\n.mmx-result-range select{\n    min-width:82px\n}\n\n.mmx-result-controls{\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''          <select\n            data-segment-select\n          ></select>\n\n          <span\n            data-range-label\n            hidden\n          ></span>\n''',
'''          <select\n            data-segment-select\n          ></select>\n\n          <div\n            class="mmx-result-range"\n            data-multi-range\n            hidden\n          >\n            <label>\n              <span data-output-text="range_start">起始段</span>\n              <select data-range-start></select>\n            </label>\n            <span>→</span>\n            <label>\n              <span data-output-text="range_end">结束段</span>\n              <select data-range-end></select>\n            </label>\n          </div>\n\n          <span\n            data-range-label\n            hidden\n          ></span>\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        tab: "segment",\n\n        segments: new Map(),\n''',
'''        tab: "segment",\n        multiStart: null,\n        multiEnd: null,\n        multiRangeUserSet: false,\n\n        segments: new Map(),\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''    const segmentSelect =\n        resultsRoot.querySelector("[data-segment-select]");\n\n    const audio =\n''',
'''    const segmentSelect =\n        resultsRoot.querySelector("[data-segment-select]");\n\n    const multiRange =\n        resultsRoot.querySelector("[data-multi-range]");\n\n    const rangeStart =\n        resultsRoot.querySelector("[data-range-start]");\n\n    const rangeEnd =\n        resultsRoot.querySelector("[data-range-end]");\n\n    const rangeLabel =\n        resultsRoot.querySelector("[data-range-label]");\n\n    const audio =\n'''
)
# Add helper before activeResult.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''    const activeResult = () => {\n''',
'''    const availableSegmentIndices = () =>\n        [...state.segments.keys()].sort((a, b) => a - b);\n\n    const syncMultiRangeControls = () => {\n        const keys = availableSegmentIndices();\n        if (!keys.length) {\n            state.multiStart = null;\n            state.multiEnd = null;\n            rangeStart.replaceChildren();\n            rangeEnd.replaceChildren();\n            rangeLabel.textContent = tx("no_valid");\n            return;\n        }\n        const first = keys[0];\n        const last = keys.at(-1);\n        if (!state.multiRangeUserSet) {\n            state.multiStart = first;\n            state.multiEnd = last;\n        } else {\n            if (!keys.includes(state.multiStart)) state.multiStart = first;\n            if (!keys.includes(state.multiEnd)) state.multiEnd = last;\n            if (state.multiStart > state.multiEnd) state.multiEnd = state.multiStart;\n        }\n        const options = keys.map(\n            (index) => `<option value="${index}">${tx("segment_word")} ${index + 1}</option>`,\n        ).join("");\n        rangeStart.innerHTML = options;\n        rangeEnd.innerHTML = options;\n        rangeStart.value = String(state.multiStart);\n        rangeEnd.value = String(state.multiEnd);\n        rangeLabel.textContent = `S${state.multiStart + 1} → S${state.multiEnd + 1}`;\n    };\n\n    const activeResult = () => {\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        const ordered =\n            [...state.segments.entries()]\n                .sort(\n                    (a, b) =>\n                        a[0] - b[0],\n                )\n                .map(\n                    (entry) =>\n                        entry[1],\n                );\n\n        const frames =\n            ordered.flatMap(\n                (item) =>\n                    item.frames\n                    || (\n                        item.image_b64\n                            ? [item.image_b64]\n                            : []\n                    ),\n            );\n\n        return frames.length\n            ? {\n                frames,\n                fps:\n                    ordered[0]?.fps\n                    || 24,\n                width:\n                    ordered[0]?.width,\n                height:\n                    ordered[0]?.height,\n                stage:\n                    "Multi Segment",\n            }\n            : null;\n''',
'''        const entries =\n            [...state.segments.entries()]\n                .sort((a, b) => a[0] - b[0])\n                .filter(([index]) => (\n                    state.multiStart == null\n                    || state.multiEnd == null\n                    || (index >= state.multiStart && index <= state.multiEnd)\n                ));\n        const ordered = entries.map((entry) => entry[1]);\n\n        const frames =\n            ordered.flatMap(\n                (item) =>\n                    item.frames\n                    || (\n                        item.image_b64\n                            ? [item.image_b64]\n                            : []\n                    ),\n            );\n\n        return frames.length\n            ? {\n                frames,\n                fps:\n                    ordered[0]?.fps\n                    || 24,\n                width:\n                    ordered[0]?.width,\n                height:\n                    ordered[0]?.height,\n                stage:\n                    `Multi Segment S${(state.multiStart ?? entries[0]?.[0] ?? 0) + 1}-S${(state.multiEnd ?? entries.at(-1)?.[0] ?? 0) + 1}`,\n            }\n            : null;\n'''
)
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        segmentSelect.hidden =\n            tab !== "segment";\n\n        resultsRoot\n            .querySelector(\n                "[data-range-label]",\n            )\n            .hidden =\n                tab !== "multi";\n\n        saveCard.hidden =\n            tab !== "final";\n''',
'''        segmentSelect.hidden =\n            tab !== "segment";\n\n        multiRange.hidden =\n            tab !== "multi";\n\n        rangeLabel.hidden = true;\n\n        if (tab === "multi") syncMultiRangeControls();\n\n        saveCard.hidden =\n            !["multi", "final"].includes(tab);\n'''
)
# Range change events.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''    seek.addEventListener(\n''',
'''    rangeStart.addEventListener("change", () => {\n        stop();\n        state.multiRangeUserSet = true;\n        state.multiStart = Number(rangeStart.value);\n        if (state.multiEnd == null || state.multiStart > state.multiEnd) {\n            state.multiEnd = state.multiStart;\n        }\n        state.index = 0;\n        syncMultiRangeControls();\n        renderFrame();\n    });\n\n    rangeEnd.addEventListener("change", () => {\n        stop();\n        state.multiRangeUserSet = true;\n        state.multiEnd = Number(rangeEnd.value);\n        if (state.multiStart == null || state.multiEnd < state.multiStart) {\n            state.multiStart = state.multiEnd;\n        }\n        state.index = 0;\n        syncMultiRangeControls();\n        renderFrame();\n    });\n\n    seek.addEventListener(\n'''
)
# Segment preview arrival refreshes range controls instead of fixed label only.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''            resultsRoot\n                .querySelector(\n                    "[data-range-label]",\n                )\n                .textContent =\n                    keys.length\n                        ? `S${keys[0] + 1} → S${keys.at(-1) + 1}`\n                        : tx("no_valid");\n''',
'''            rangeLabel.textContent =\n                keys.length\n                    ? `S${keys[0] + 1} → S${keys.at(-1) + 1}`\n                    : tx("no_valid");\n            syncMultiRangeControls();\n'''
)
# Reset range state on clear.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        state.segments.clear();\n\n        state.final =\n''',
'''        state.segments.clear();\n        state.multiStart = null;\n        state.multiEnd = null;\n        state.multiRangeUserSet = false;\n        syncMultiRangeControls();\n\n        state.final =\n'''
)
# Range save request.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''                                    save:\n                                        store.get().save,\n''',
'''                                    save:\n                                        store.get().save,\n                                    segment_range:\n                                        state.tab === "multi"\n                                            ? {\n                                                start: state.multiStart,\n                                                end: state.multiEnd,\n                                            }\n                                            : null,\n'''
)
# Keep range option labels localized.
replace_once(
    'web/js/minimax_output_ui.mjs',
'''        for (\n            const option\n            of segmentSelect.options\n        ) {\n            option.textContent =\n                `${tx("segment_word")} ${Number(option.value) + 1}`;\n        }\n\n        playButton.textContent =\n''',
'''        for (const select of [segmentSelect, rangeStart, rangeEnd]) {\n            for (const option of select.options) {\n                option.textContent =\n                    `${tx("segment_word")} ${Number(option.value) + 1}`;\n            }\n        }\n\n        playButton.textContent =\n'''
)

# 7) Bust the output UI module cache after the new range controls.
replace_once(
    'web/js/minimax_timeline.js',
'''import { mountOutputUI } from "./minimax_output_ui.mjs?boot=live_results_v1";\n''',
'''import { mountOutputUI } from "./minimax_output_ui.mjs?boot=live_results_v2";\n'''
)

print('Applied Mixed authoritative continuity + result range changes')
