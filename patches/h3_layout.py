# Portions derived from ComfyUI-H3-Motion-Context
# Copyright (C) 2026 NikoDemon80 and contributors
# Modified for MiniMax H3 Motion Director, 2026-08-16
# Licensed under GNU GPL v3.0. See LICENSE and NOTICE.

"""MiniMax H3 Motion Context layout compatibility across ComfyUI H3 APIs."""

import inspect
import logging
import torch
import comfy.ldm.minimax.model as mm

from .markers import MC_AUDIO_KEY, MC_KEY

_LOG = logging.getLogger("h3_motion_context")
_orig_init = None
_applied = False
_failure_reason = None
_native_guides = False


def _frame_count(latent_t):
    p = mm.FRAME_PER_TOKEN
    return sum(p[i % len(p)] for i in range(int(latent_t)))


def _target_origin(layout):
    if not layout.segments:
        raise RuntimeError("PackedLayout has no segments")
    a, b, kind = layout.segments[-1]
    if kind != "video" or b <= a:
        raise RuntimeError("PackedLayout target video is not the final segment")
    return float(layout.position_ids[a, 0])


def _native_keyframes(keyframes):
    if not _native_guides or not keyframes:
        return keyframes
    out = []
    for kf in keyframes:
        marker = kf.get(MC_KEY)
        if marker is None:
            out.append(kf)
        else:
            item = dict(kf)
            item["resolved_frame_index"] = int(marker)
            out.append(item)
    return out


def _legacy_fixup(layout, text_len, latent_t, frame_count, keyframes, refs):
    spans = [(a, b) for a, b, kind in layout.segments if kind == "cond"]
    guides = list(keyframes or [])
    if len(spans) != len(guides):
        raise RuntimeError("legacy MiniMax H3 guide segment count changed")
    offset = _target_origin(layout) - float(text_len)
    if refs and offset and any(kf.get(MC_KEY) is None for kf in guides):
        raise RuntimeError("legacy H3 cannot safely mix unmarked guides and Motion Context refs")
    for (a, b), kf in zip(spans, guides):
        marker = kf.get(MC_KEY)
        if marker is None:
            continue
        p = int(marker)
        if p == 0:
            t = float(text_len)
        elif p == int(frame_count) - 1:
            t = float(text_len) + sum(mm._video_t_spans(latent_t)) - mm.FRAME_RESCALE
        else:
            t = float(text_len) + mm.FRAME_RESCALE * float(p)
        layout.position_ids[a:b, 0] = t + offset


def _emitted_ref_kinds(block):
    kind = block.get("kind")
    rt = int(block.get("ref_audio_t", 0))
    if kind == "image":
        return ("ref_img",)
    if kind == "audio":
        return ("ref_audio",) if rt > 0 else ()
    if kind in ("video", "video_audio"):
        return (("ref_audio",) if rt > 0 else ()) + ("ref_img",)
    raise RuntimeError("unknown MiniMax H3 reference kind %r" % (kind,))


def _ref_map(layout, refs):
    actual = [(a, b, k) for a, b, k in layout.segments if k in ("ref_img", "ref_audio")]
    expected = [(i, k) for i, ref in enumerate(refs or []) for k in _emitted_ref_kinds(ref)]
    if len(actual) != len(expected):
        raise RuntimeError("MiniMax H3 reference layout segment count changed")
    out = {}
    for (index, wanted), (a, b, got) in zip(expected, actual):
        if wanted != got:
            raise RuntimeError("MiniMax H3 reference layout order changed")
        out.setdefault(index, {})[wanted] = (a, b)
    return out


def _fixup_motion_audio(layout, refs):
    marked = [i for i, r in enumerate(refs or []) if r.get(MC_AUDIO_KEY) is not None]
    if len(marked) != 1:
        raise RuntimeError("expected exactly one marked Motion Audio Context ref")
    index = marked[0]
    ref = refs[index]
    if ref.get("kind") != "audio":
        raise RuntimeError("Motion Audio Context marker must be on an audio ref")
    steps = int(ref.get("ref_audio_t", 0))
    segment = _ref_map(layout, refs).get(index, {}).get("ref_audio")
    if steps <= 0 or segment is None:
        raise RuntimeError("Motion Audio Context emitted no audio rows")
    a, b = segment
    if b - a != steps * 2:
        raise RuntimeError("Motion Audio Context row count changed")
    desired = _target_origin(layout) + mm.FRAME_RESCALE * float(ref[MC_AUDIO_KEY]) - steps
    current = float(layout.position_ids[a, 0])
    layout.position_ids[a:b, 0] += desired - current


def _call_orig(self, text_len, latent_t, latent_h, latent_w, audio_t, keyframes=None, refs=None, frame_count=None):
    if _native_guides:
        return _orig_init(
            self, text_len, latent_t, latent_h, latent_w, audio_t,
            keyframes=_native_keyframes(keyframes), refs=refs,
        )
    return _orig_init(
        self, text_len, latent_t, latent_h, latent_w, audio_t,
        keyframes=keyframes, refs=refs, frame_count=frame_count,
    )


def _patched_init(self, text_len, latent_t, latent_h, latent_w, audio_t, keyframes=None, refs=None, frame_count=None):
    fc = int(frame_count) if frame_count is not None else _frame_count(latent_t)
    _call_orig(self, text_len, latent_t, latent_h, latent_w, audio_t, keyframes, refs, fc)
    if not _native_guides and keyframes and any(k.get(MC_KEY) is not None for k in keyframes):
        _legacy_fixup(self, text_len, latent_t, fc, keyframes, refs)
    if refs and any(r.get(MC_AUDIO_KEY) is not None for r in refs):
        _fixup_motion_audio(self, refs)


def _self_test():
    fc = _frame_count(7)
    dummy = torch.zeros((1, 1, 1, 1, 1))
    refs = [{"kind": "audio", "ref_audio_t": 8}]
    marker = 3
    kf = [{"resolved_frame_index": 0, MC_KEY: marker, "latent": dummy}]
    layout = mm.PackedLayout.__new__(mm.PackedLayout)
    _patched_init(layout, 7, 7, 22, 38, 16, keyframes=kf, refs=refs, frame_count=fc)
    cond = [(a, b) for a, b, kind in layout.segments if kind == "cond"]
    if len(cond) != 1:
        raise RuntimeError("Motion Context guide self-test emitted wrong row count")
    a, _ = cond[0]
    expected = _target_origin(layout) + mm.FRAME_RESCALE * marker
    if abs(float(layout.position_ids[a, 0]) - expected) > 1e-6:
        raise RuntimeError("Motion Context guide self-test position mismatch")

    motion_ref = [{"kind": "audio", "ref_audio_t": 8, MC_AUDIO_KEY: 4.0}]
    audio_layout = mm.PackedLayout.__new__(mm.PackedLayout)
    _patched_init(audio_layout, 7, 7, 22, 38, 16, refs=motion_ref, frame_count=fc)
    a, b = _ref_map(audio_layout, motion_ref)[0]["ref_audio"]
    wanted = _target_origin(audio_layout) + mm.FRAME_RESCALE * 4.0 - 8.0
    if b - a != 16 or abs(float(audio_layout.position_ids[a, 0]) - wanted) > 1e-6:
        raise RuntimeError("Motion Audio Context self-test position mismatch")


def apply_patch():
    global _orig_init, _applied, _failure_reason, _native_guides
    if _applied:
        return True
    for name in ("PackedLayout", "FRAME_RESCALE", "FRAME_PER_TOKEN"):
        if not hasattr(mm, name):
            _failure_reason = "MiniMax H3 model module is missing %s" % name
            return False

    _orig_init = mm.PackedLayout.__init__
    try:
        params = inspect.signature(_orig_init).parameters
        _native_guides = "frame_count" not in params
        _self_test()
    except Exception as exc:
        _failure_reason = str(exc)
        _orig_init = None
        _LOG.warning("h3_motion_context: layout compatibility self-test failed (%s)", exc)
        return False

    mm.PackedLayout.__init__ = _patched_init
    _applied = True
    _failure_reason = None
    _LOG.info(
        "h3_motion_context: layout compatibility enabled (%s H3 guides)",
        "native" if _native_guides else "legacy",
    )
    return True


def is_applied():
    return _applied


def failure_reason():
    return _failure_reason


def native_guides_available():
    return bool(_native_guides)
