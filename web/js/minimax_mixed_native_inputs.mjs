// Mixed segment input renderer using the Director's existing visual language.
// Deliberately uses the same bd-batch-*, bd-fl2v-* and bd-r2v-* classes as
// the standalone modes. Mixed-specific controls are limited to Segment Result.

const MAX_PICTURES = 9;
const MAX_VIDEOS = 3;
const MAX_AUDIOS = 3;
const pictureVisibility = new Map();

function ensureInputs(seg) {
    seg.inputs = seg.inputs && typeof seg.inputs === "object" ? seg.inputs : {};
    seg.inputs.resultRefs = Array.isArray(seg.inputs.resultRefs) ? seg.inputs.resultRefs : [];
    return seg.inputs;
}

function identityKey(seg) {
    return seg.mode === "source_video" ? "identityPictures" : "pictures";
}

function descriptorName(item, fallback = "") {
    return String(item?.fileName || item?.name || item?.imageFile || item?.videoFile || item?.audioFile || fallback || "");
}

function indexed(items) {
    return (items || []).filter(Boolean).map((item, index) => ({ ...item, index }));
}

function refsFor(seg, role) {
    return ensureInputs(seg).resultRefs.filter((ref) => ref?.role === role);
}

function removeRoleRefs(seg, role) {
    ensureInputs(seg).resultRefs = seg.inputs.resultRefs.filter((ref) => ref?.role !== role);
}

function addResultRef(seg, role, sourceId) {
    const inputs = ensureInputs(seg);
    if (role !== "identity") removeRoleRefs(seg, role);
    inputs.resultRefs.push({ role, origin: "segment", segmentId: sourceId, frame: "last" });
}

function button(text, handler, { disabled = false } = {}) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "bd-btn";
    el.textContent = text;
    el.disabled = disabled;
    el.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler?.();
    };
    return el;
}

function appendDuration(head, seg, mutate, tr) {
    if (seg.mode === "source_video") return;
    const meta = document.createElement("div");
    meta.className = "bd-batch-head-meta";
    const row = document.createElement("label");
    row.className = "bd-batch-fc";
    const label = document.createElement("span");
    label.textContent = tr("mixed.duration");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0.1";
    input.step = "0.1";
    input.value = String(seg.duration ?? 5);
    input.onchange = () => mutate(() => {
        seg.duration = Math.max(0.1, Number(input.value) || 5);
    });
    row.append(label, input);
    meta.appendChild(row);
    head.appendChild(meta);
}

function appendCardHead(card, seg, segmentIndex, mutate, tr) {
    const head = document.createElement("div");
    head.className = "bd-batch-head";
    const title = document.createElement("b");
    title.textContent = tr("mixed.segment", { n: segmentIndex + 1 });
    head.appendChild(title);
    appendDuration(head, seg, mutate, tr);
    card.appendChild(head);
}

function appendPrompt(parent, seg, onPromptInput, tr) {
    const prompts = document.createElement("div");
    prompts.className = "bd-batch-prompts";
    const label = document.createElement("span");
    label.className = "bd-label";
    label.textContent = tr("mixed.prompt");
    const textarea = document.createElement("textarea");
    textarea.value = seg.prompt || "";
    textarea.placeholder = "";
    textarea.oninput = () => {
        seg.prompt = textarea.value;
        onPromptInput?.(textarea.value);
    };
    prompts.append(label, textarea);
    parent.appendChild(prompts);
    return textarea;
}

function resultSelector(ref, segmentIndex, segments, mutate, tr) {
    const row = document.createElement("div");
    row.className = "mmx-mixed-native-result-row";
    const select = document.createElement("select");
    select.className = "bd-select";
    for (let index = 0; index < segmentIndex; index += 1) {
        const option = document.createElement("option");
        option.value = segments[index].id;
        option.textContent = tr("mixed.segment", { n: index + 1 });
        select.appendChild(option);
    }
    select.value = ref.segmentId || "";
    select.onchange = () => mutate(() => { ref.segmentId = select.value; });
    const frame = document.createElement("input");
    frame.type = "text";
    frame.value = String(ref.frame ?? "last");
    frame.title = tr("mixed.frameLast");
    frame.onchange = () => mutate(() => {
        const raw = String(frame.value || "last").trim().toLowerCase();
        ref.frame = raw === "last" ? "last" : Math.max(0, Number.parseInt(raw, 10) || 0);
    });
    const remove = button(tr("mixed.remove"), () => mutate(() => {
        ensureInputs(ref._segment || {}).resultRefs = [];
    }));
    // Caller replaces remove.onclick because ref alone does not own the segment.
    row.append(select, frame, remove);
    return { row, remove };
}

function appendResultRow(parent, seg, ref, segmentIndex, segments, mutate, tr) {
    const { row, remove } = resultSelector(ref, segmentIndex, segments, mutate, tr);
    remove.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        mutate(() => {
            ensureInputs(seg).resultRefs = seg.inputs.resultRefs.filter((item) => item !== ref);
        });
    };
    parent.appendChild(row);
}

async function chooseAndStore({ seg, kind, key, role, upload, mutate, status, tr }) {
    try {
        const descriptor = await upload(kind);
        if (!descriptor) return;
        mutate(() => {
            ensureInputs(seg)[key] = descriptor;
            if (role) removeRoleRefs(seg, role);
        });
        status?.(tr("mixed.ready"), "ok");
    } catch (error) {
        status?.(tr("mixed.error", { message: error?.message || error }), "error");
    }
}

function appendSingleResultAction(parent, seg, role, staticKey, segmentIndex, segments, mutate, tr) {
    const actions = document.createElement("div");
    actions.className = "mmx-mixed-native-slot-actions";
    const existing = refsFor(seg, role)[0] || null;
    actions.appendChild(button(tr("mixed.segmentResult"), () => mutate(() => {
        if (segmentIndex <= 0) return;
        delete ensureInputs(seg)[staticKey];
        addResultRef(seg, role, segments[segmentIndex - 1].id);
    }), { disabled: segmentIndex <= 0 }));
    if (existing) appendResultRow(actions, seg, existing, segmentIndex, segments, mutate, tr);
    parent.appendChild(actions);
}

function renderT2v(container, ctx) {
    const { seg, segmentIndex, mutate, onPromptInput, tr } = ctx;
    const card = document.createElement("div");
    card.className = "bd-batch-card bd-batch-plain mmx-mixed-native-card";
    appendCardHead(card, seg, segmentIndex, mutate, tr);
    appendPrompt(card, seg, onPromptInput, tr);
    container.appendChild(card);
}

function renderI2v(container, ctx) {
    const { seg, segmentIndex, segments, mutate, upload, viewUrl, status, onPromptInput, tr } = ctx;
    const inputs = ensureInputs(seg);
    const card = document.createElement("div");
    card.className = "bd-batch-card bd-batch-source mmx-mixed-native-card";
    appendCardHead(card, seg, segmentIndex, mutate, tr);

    const media = document.createElement("div");
    media.className = "bd-batch-media";
    const source = document.createElement("div");
    source.className = "bd-batch-src";
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
        source.textContent = tr("mixed.segmentResult");
    } else {
        source.textContent = tr("mixed.startFrame");
    }
    source.onclick = (event) => {
        if (event.target.closest?.(".x")) return;
        void chooseAndStore({ seg, kind: "image", key: "startFrame", role: "i2v_start", upload, mutate, status, tr });
    };
    media.appendChild(source);
    appendSingleResultAction(media, seg, "i2v_start", "startFrame", segmentIndex, segments, mutate, tr);
    card.appendChild(media);
    appendPrompt(card, seg, onPromptInput, tr);
    container.appendChild(card);
}

function renderFl2vSlot(wrap, ctx, { role, staticKey, labelKey, tagClass }) {
    const { seg, segmentIndex, segments, mutate, upload, viewUrl, status, tr } = ctx;
    const inputs = ensureInputs(seg);
    const slot = document.createElement("div");
    slot.className = "bd-fl2v-slot";
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
        ph.className = "ph";
        ph.textContent = ref ? tr("mixed.segmentResult") : tr(labelKey);
        slot.appendChild(ph);
    }
    slot.onclick = (event) => {
        if (event.target.closest?.(".x")) return;
        void chooseAndStore({ seg, kind: "image", key: staticKey, role, upload, mutate, status, tr });
    };
    wrap.appendChild(slot);
    appendSingleResultAction(wrap, seg, role, staticKey, segmentIndex, segments, mutate, tr);
}

function renderFl2v(container, ctx) {
    const { seg, segmentIndex, mutate, onPromptInput, tr } = ctx;
    const detail = document.createElement("div");
    detail.className = "bd-fl2v-detail mmx-mixed-native-card";
    const head = document.createElement("div");
    head.className = "bd-fl2v-shot-row";
    const title = document.createElement("b");
    title.textContent = tr("mixed.segment", { n: segmentIndex + 1 });
    head.appendChild(title);
    const durLabel = document.createElement("span");
    durLabel.textContent = tr("mixed.duration");
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = "0.1";
    duration.step = "0.1";
    duration.value = String(seg.duration ?? 5);
    duration.onchange = () => mutate(() => { seg.duration = Math.max(0.1, Number(duration.value) || 5); });
    head.append(durLabel, duration);
    detail.appendChild(head);

    const slots = document.createElement("div");
    slots.className = "bd-fl2v-slots";
    const first = document.createElement("div");
    first.className = "bd-fl2v-slot-wrap";
    renderFl2vSlot(first, ctx, { role: "fl2v_first", staticKey: "firstFrame", labelKey: "mixed.firstFrame", tagClass: "start" });
    const last = document.createElement("div");
    last.className = "bd-fl2v-slot-wrap";
    renderFl2vSlot(last, ctx, { role: "fl2v_last", staticKey: "lastFrame", labelKey: "mixed.lastFrame", tagClass: "end" });
    slots.append(first, last);
    detail.appendChild(slots);
    appendPrompt(detail, seg, onPromptInput, tr);
    container.appendChild(detail);
}

function r2vSection(titleText, countText) {
    const section = document.createElement("div");
    section.className = "bd-r2v-section";
    const head = document.createElement("div");
    head.className = "bd-r2v-section-head";
    const title = document.createElement("span");
    title.className = "bd-r2v-section-title";
    title.textContent = titleText;
    const count = document.createElement("span");
    count.className = "bd-r2v-section-count";
    count.textContent = countText;
    head.append(title, count);
    section.appendChild(head);
    return section;
}

function pictureSlot(ctx, key, item, slotIndex) {
    const { seg, mutate, upload, viewUrl, status, tr } = ctx;
    const el = document.createElement("div");
    el.className = "bd-batch-ref";
    if (item?.imageFile) {
        el.classList.add("has-img");
        const img = document.createElement("img");
        img.src = viewUrl(item);
        img.draggable = false;
        const cap = document.createElement("span");
        cap.className = "cap";
        cap.textContent = descriptorName(item, `${tr("mixed.identity")} ${slotIndex + 1}`);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => {
                const values = Array.isArray(ensureInputs(seg)[key]) ? [...seg.inputs[key]] : [];
                values.splice(slotIndex, 1);
                seg.inputs[key] = indexed(values);
            });
        };
        el.append(img, cap, x);
    } else {
        const cap = document.createElement("span");
        cap.className = "cap";
        cap.textContent = `${tr("mixed.identity")} ${slotIndex + 1}`;
        el.appendChild(cap);
    }
    el.onclick = (event) => {
        if (event.target.closest?.(".x")) return;
        if ((Array.isArray(ensureInputs(seg)[key]) ? seg.inputs[key].length : 0) >= MAX_PICTURES && !item) return;
        void (async () => {
            try {
                const descriptor = await upload("image");
                if (!descriptor) return;
                mutate(() => {
                    const values = Array.isArray(ensureInputs(seg)[key]) ? [...seg.inputs[key]] : [];
                    if (slotIndex < values.length) values[slotIndex] = descriptor;
                    else values.push(descriptor);
                    seg.inputs[key] = indexed(values.slice(0, MAX_PICTURES));
                });
                status?.(tr("mixed.ready"), "ok");
            } catch (error) { status?.(tr("mixed.error", { message: error?.message || error }), "error"); }
        })();
    };
    return el;
}

function renderPictureSection(assets, ctx) {
    const { seg, segmentIndex, segments, mutate, tr } = ctx;
    const inputs = ensureInputs(seg);
    const key = identityKey(seg);
    inputs[key] = Array.isArray(inputs[key]) ? inputs[key] : [];
    const dynamic = refsFor(seg, "identity");
    const total = Math.min(MAX_PICTURES, inputs[key].length + dynamic.length);
    const section = r2vSection(tr("mixed.identity"), `${total}/${MAX_PICTURES}`);
    let visible = pictureVisibility.get(seg.id) || 3;
    visible = Math.max(3, Math.min(MAX_PICTURES, visible));
    pictureVisibility.set(seg.id, visible);
    const grid = document.createElement("div");
    grid.className = "bd-batch-refs";
    for (let index = 0; index < visible; index += 1) grid.appendChild(pictureSlot(ctx, key, inputs[key][index] || null, index));
    section.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "mmx-mixed-native-section-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bd-r2v-pics-toggle";
    toggle.textContent = visible < MAX_PICTURES ? tr("mixed.expandMore", { n: Math.min(3, MAX_PICTURES - visible) }) : tr("mixed.collapse");
    toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        pictureVisibility.set(seg.id, visible < MAX_PICTURES ? Math.min(MAX_PICTURES, visible + 3) : 3);
        mutate(() => {});
    };
    actions.appendChild(toggle);
    actions.appendChild(button(tr("mixed.segmentResult"), () => mutate(() => {
        if (segmentIndex <= 0 || total >= MAX_PICTURES) return;
        addResultRef(seg, "identity", segments[segmentIndex - 1].id);
    }), { disabled: segmentIndex <= 0 || total >= MAX_PICTURES }));
    section.appendChild(actions);
    for (const ref of dynamic) appendResultRow(section, seg, ref, segmentIndex, segments, mutate, tr);
    assets.appendChild(section);
}

function renderVideoAssetSlot(ctx, key, index) {
    const { seg, mutate, upload, viewUrl, status, tr } = ctx;
    const inputs = ensureInputs(seg);
    inputs[key] = Array.isArray(inputs[key]) ? inputs[key] : [];
    const item = inputs[key][index] || null;
    const el = document.createElement("div");
    el.className = `bd-batch-video${item?.videoFile ? " has-video" : ""}`;
    const thumb = document.createElement("div");
    thumb.className = "bd-r2v-thumb bd-r2v-thumb-video";
    const meta = document.createElement("div");
    meta.className = "bd-r2v-meta";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${tr("mixed.referenceVideo")} ${index + 1}`;
    meta.appendChild(tag);
    if (item?.videoFile) {
        const video = document.createElement("video");
        video.src = viewUrl(item);
        video.preload = "metadata";
        video.muted = true;
        video.controls = true;
        video.className = "bd-r2v-media";
        thumb.appendChild(video);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => {
                const values = [...(ensureInputs(seg)[key] || [])];
                values.splice(index, 1);
                seg.inputs[key] = indexed(values);
            });
        };
        el.appendChild(x);
    } else {
        thumb.textContent = "▶";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = tr("mixed.upload");
        meta.appendChild(name);
    }
    el.append(thumb, meta);
    el.onclick = (event) => {
        if (event.target.closest?.("video, .x")) return;
        void (async () => {
            try {
                const descriptor = await upload("video");
                if (!descriptor) return;
                mutate(() => {
                    const values = [...(ensureInputs(seg)[key] || [])];
                    if (index < values.length) values[index] = descriptor; else values.push(descriptor);
                    seg.inputs[key] = indexed(values.slice(0, MAX_VIDEOS));
                });
                status?.(tr("mixed.ready"), "ok");
            } catch (error) { status?.(tr("mixed.error", { message: error?.message || error }), "error"); }
        })();
    };
    return el;
}

function renderAudioAssetSlot(ctx, key, index) {
    const { seg, mutate, upload, status, tr } = ctx;
    const inputs = ensureInputs(seg);
    inputs[key] = Array.isArray(inputs[key]) ? inputs[key] : [];
    const item = inputs[key][index] || null;
    const el = document.createElement("div");
    el.className = `bd-batch-audio${item?.audioFile ? " has-audio" : ""}`;
    const thumb = document.createElement("div");
    thumb.className = "bd-r2v-thumb";
    thumb.textContent = "♪";
    const meta = document.createElement("div");
    meta.className = "bd-r2v-meta";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${tr("mixed.referenceAudio")} ${index + 1}`;
    meta.appendChild(tag);
    if (item?.audioFile) {
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = descriptorName(item, tr("mixed.referenceAudio"));
        meta.appendChild(name);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => {
                const values = [...(ensureInputs(seg)[key] || [])];
                values.splice(index, 1);
                seg.inputs[key] = indexed(values);
            });
        };
        el.appendChild(x);
    } else {
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = tr("mixed.upload");
        meta.appendChild(name);
    }
    el.append(thumb, meta);
    el.onclick = (event) => {
        if (event.target.closest?.(".x")) return;
        void (async () => {
            try {
                const descriptor = await upload("audio");
                if (!descriptor) return;
                mutate(() => {
                    const values = [...(ensureInputs(seg)[key] || [])];
                    if (index < values.length) values[index] = descriptor; else values.push(descriptor);
                    seg.inputs[key] = indexed(values.slice(0, MAX_AUDIOS));
                });
                status?.(tr("mixed.ready"), "ok");
            } catch (error) { status?.(tr("mixed.error", { message: error?.message || error }), "error"); }
        })();
    };
    return el;
}

function renderReferenceVideoSection(assets, ctx) {
    const { seg, tr } = ctx;
    const items = Array.isArray(ensureInputs(seg).referenceVideos) ? seg.inputs.referenceVideos : [];
    const section = r2vSection(tr("mixed.referenceVideo"), `${items.length}/${MAX_VIDEOS}`);
    const grid = document.createElement("div");
    grid.className = "bd-batch-videos";
    for (let index = 0; index < MAX_VIDEOS; index += 1) grid.appendChild(renderVideoAssetSlot(ctx, "referenceVideos", index));
    section.appendChild(grid);
    assets.appendChild(section);
}

function renderReferenceAudioSection(assets, ctx) {
    const { seg, tr } = ctx;
    const items = Array.isArray(ensureInputs(seg).referenceAudios) ? seg.inputs.referenceAudios : [];
    const section = r2vSection(tr("mixed.referenceAudio"), `${items.length}/${MAX_AUDIOS}`);
    const grid = document.createElement("div");
    grid.className = "bd-batch-audios";
    for (let index = 0; index < MAX_AUDIOS; index += 1) grid.appendChild(renderAudioAssetSlot(ctx, "referenceAudios", index));
    section.appendChild(grid);
    assets.appendChild(section);
}

function renderSourceVideoSection(assets, ctx) {
    const { seg, mutate, upload, probeVideo, viewUrl, status, tr } = ctx;
    const inputs = ensureInputs(seg);
    const source = inputs.sourceVideo || null;
    const section = r2vSection(tr("mixed.sourceVideo"), source?.videoFile ? "1/1" : "0/1");
    const grid = document.createElement("div");
    grid.className = "bd-batch-videos";
    const el = document.createElement("div");
    el.className = `bd-batch-video${source?.videoFile ? " has-video" : ""}`;
    const thumb = document.createElement("div");
    thumb.className = "bd-r2v-thumb bd-r2v-thumb-video";
    const meta = document.createElement("div");
    meta.className = "bd-r2v-meta";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = tr("mixed.sourceVideo");
    meta.appendChild(tag);
    if (source?.videoFile) {
        const video = document.createElement("video");
        video.src = viewUrl(source);
        video.preload = "metadata";
        video.muted = true;
        video.controls = true;
        video.className = "bd-r2v-media";
        thumb.appendChild(video);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (event) => {
            event.stopPropagation();
            mutate(() => { delete ensureInputs(seg).sourceVideo; });
        };
        el.appendChild(x);
    } else {
        thumb.textContent = "▶";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = tr("mixed.uploadSourceVideo");
        meta.appendChild(name);
    }
    el.append(thumb, meta);
    el.onclick = (event) => {
        if (event.target.closest?.("video, .x")) return;
        void (async () => {
            try {
                const descriptor = await upload("video");
                if (!descriptor) return;
                const info = await probeVideo(descriptor.videoFile).catch(() => ({}));
                const duration = Math.max(0.1, Number(info?.duration_sec || info?.duration || 5) || 5);
                descriptor.range = { startSec: 0, endSec: duration };
                descriptor.durationSec = duration;
                mutate(() => { ensureInputs(seg).sourceVideo = descriptor; });
                status?.(tr("mixed.ready"), "ok");
            } catch (error) { status?.(tr("mixed.error", { message: error?.message || error }), "error"); }
        })();
    };
    grid.appendChild(el);
    section.appendChild(grid);
    if (source) {
        const range = document.createElement("div");
        range.className = "bd-fl2v-shot-row mmx-mixed-source-range";
        const startLabel = document.createElement("span");
        startLabel.textContent = tr("mixed.sourceStart");
        const start = document.createElement("input");
        start.type = "number";
        start.min = "0";
        start.step = "0.01";
        start.value = String(source.range?.startSec ?? 0);
        const endLabel = document.createElement("span");
        endLabel.textContent = tr("mixed.sourceEnd");
        const end = document.createElement("input");
        end.type = "number";
        end.min = "0.01";
        end.step = "0.01";
        end.value = String(source.range?.endSec ?? source.durationSec ?? 5);
        const commit = () => mutate(() => {
            const startSec = Math.max(0, Number(start.value) || 0);
            const endSec = Math.max(startSec + 0.01, Number(end.value) || startSec + 0.01);
            ensureInputs(seg).sourceVideo.range = { startSec, endSec };
        });
        start.onchange = commit;
        end.onchange = commit;
        range.append(startLabel, start, endLabel, end);
        section.appendChild(range);
    }
    assets.appendChild(section);
}

function renderR2vLike(container, ctx, { sourceVideo = false } = {}) {
    const { seg, segmentIndex, mutate, onPromptInput, tr } = ctx;
    const card = document.createElement("div");
    card.className = "bd-batch-card bd-batch-r2v mmx-mixed-native-card";
    appendCardHead(card, seg, segmentIndex, mutate, tr);
    const localTitle = document.createElement("div");
    localTitle.className = "bd-r2v-local-title";
    localTitle.textContent = sourceVideo ? tr("mixed.sourceVideo") : tr("mixed.identity");
    card.appendChild(localTitle);
    const body = document.createElement("div");
    body.className = "bd-batch-r2v-body";
    const assets = document.createElement("div");
    assets.className = "bd-batch-r2v-assets";
    const main = document.createElement("div");
    main.className = "bd-batch-r2v-main";
    if (sourceVideo) renderSourceVideoSection(assets, ctx);
    renderPictureSection(assets, ctx);
    if (!sourceVideo) renderReferenceVideoSection(assets, ctx);
    renderReferenceAudioSection(assets, ctx);
    appendPrompt(main, seg, onPromptInput, tr);
    body.append(assets, main);
    card.appendChild(body);
    container.appendChild(card);
}

export function renderMixedNativeModeCard({
    container,
    segment: seg,
    segmentIndex,
    segments,
    mutate,
    upload,
    probeVideo,
    viewUrl,
    status,
    onPromptInput,
    tr,
}) {
    if (!container || !seg) return;
    ensureInputs(seg);
    const ctx = { seg, segmentIndex, segments, mutate, upload, probeVideo, viewUrl, status, onPromptInput, tr };
    if (seg.mode === "t2v") renderT2v(container, ctx);
    else if (seg.mode === "i2v") renderI2v(container, ctx);
    else if (seg.mode === "fl2v") renderFl2v(container, ctx);
    else if (seg.mode === "r2v") renderR2vLike(container, ctx, { sourceVideo: false });
    else if (seg.mode === "source_video") renderR2vLike(container, ctx, { sourceVideo: true });
}
