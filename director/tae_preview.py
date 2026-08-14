# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Lightweight MiniMax H3 TAE / Latent2RGB previews during sampling.

Uses ``models/vae_approx/taeh3.safetensors`` when present (Kijai / madebyollin
flat TinyVAE, 24-ch). Falls back to Latent2RGB so the UI still updates.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageOps

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.tae_preview")

_DEFAULT_TAE_NAME = "taeh3.safetensors"
_lock = threading.Lock()
_decoder: Any | None = None
_decoder_failed = False


def _place(model, device, dtype):
    model = model.eval().to(device=device, dtype=dtype)
    if torch.device(device).type == "cuda":
        model.to(memory_format=torch.channels_last)
    return model


def _build_tae_decoder(sd: dict):
    # Mirror KJNodes TinyVAEDecoder layout recovery (flat indexed modules).
    from comfy.taesd.taesd import Block, Clamp, conv

    by_index: dict[int, dict] = {}
    for k, v in sd.items():
        head, _, rest = k.partition(".")
        if not head.isdigit():
            raise ValueError(f"not a flat TAE decoder state dict (unexpected key '{k}')")
        by_index.setdefault(int(head), {})[rest] = v

    modules = []
    for i in range(max(by_index) + 1):
        entry = by_index.get(i)
        if entry is None:
            modules.append(Clamp() if i == 0 else nn.ReLU() if i == 2 else nn.Upsample(scale_factor=2))
        elif "conv.0.weight" in entry:
            w = entry["conv.0.weight"]
            if "pool.0.weight" in entry:
                modules.append(Block(w.shape[1], w.shape[0], use_midblock_gn=True))
            else:
                modules.append(Block(w.shape[1], w.shape[0]))
        elif "weight" in entry:
            w = entry["weight"]
            modules.append(conv(w.shape[1], w.shape[0], bias="bias" in entry))
        else:
            raise ValueError(f"unrecognized TAE decoder module at index {i}: {sorted(entry)}")
    return nn.Sequential(*modules)


class _TinyVAEDecoder:
    def __init__(self, sd, device=None, dtype=None):
        import comfy.model_management as mm

        prefix = ""
        first = next(iter(sd))
        if not first.split(".")[0].isdigit():
            prefix = first.split(".")[0] + "."
            sd = {k[len(prefix):]: v for k, v in sd.items() if k.startswith(prefix)}

        self.device = device if device is not None else mm.vae_device()
        self.dtype = dtype if dtype is not None else mm.vae_dtype(
            self.device, [torch.float16, torch.bfloat16]
        )
        self.model = _build_tae_decoder(sd)
        self.model.load_state_dict(sd)
        self.model = _place(self.model, self.device, self.dtype)
        self.latent_channels = self.model[1].weight.shape[1]

    @torch.inference_mode()
    def decode_frame(self, latent_bchw: torch.Tensor) -> torch.Tensor:
        """[1,C,H,W] -> [H',W',3] float in 0..1"""
        out = self.model(latent_bchw.to(device=self.device, dtype=self.dtype))
        return out[0].movedim(0, -1).float().clamp(0, 1).cpu()


def get_tae_decoder(name: str = _DEFAULT_TAE_NAME):
    global _decoder, _decoder_failed
    if _decoder_failed:
        return None
    if _decoder is not None:
        return _decoder
    with _lock:
        if _decoder is not None or _decoder_failed:
            return _decoder
        try:
            import folder_paths
            import comfy.utils

            path = folder_paths.get_full_path("vae_approx", name)
            if path is None:
                log.info("TAE preview: %s not found in models/vae_approx — using Latent2RGB.", name)
                _decoder_failed = True
                return None
            sd = comfy.utils.load_torch_file(path, safe_load=True)
            if "decoder.1.weight" in sd:
                log.warning("TAE preview: temporal TAEHV weights not supported yet (%s).", name)
                _decoder_failed = True
                return None
            _decoder = _TinyVAEDecoder(sd)
            log.info("TAE preview: loaded %s (%d-ch).", name, _decoder.latent_channels)
            return _decoder
        except Exception as exc:
            log.warning("TAE preview: failed to load %s (%s) — using Latent2RGB.", name, exc)
            _decoder_failed = True
            return None


def _video_latent_from_x0(x0: Any) -> torch.Tensor | None:
    """Return video stream as [B,C,T,H,W] from NestedTensor / plain tensor."""
    try:
        # NestedTensor has unbind(); plain torch.Tensor also has unbind — do not use that.
        if not isinstance(x0, torch.Tensor) and hasattr(x0, "unbind"):
            parts = x0.unbind()
            if parts:
                x0 = parts[0]
        elif isinstance(x0, (tuple, list)) and x0:
            x0 = x0[0]
        if not isinstance(x0, torch.Tensor):
            return None
        if x0.ndim == 5:
            return x0
        if x0.ndim == 4:
            return x0.unsqueeze(2)
    except Exception as exc:
        log.debug("TAE preview: could not unpack x0: %s", exc)
    return None


def _latent2rgb_pil(video: torch.Tensor, temporal_index: int | None = None) -> Image.Image | None:
    try:
        from comfy.latent_formats import MiniMaxH3Video
        import latent_preview

        fmt = MiniMaxH3Video()
        previewer = latent_preview.Latent2RGBPreviewer(
            fmt.latent_rgb_factors,
            fmt.latent_rgb_factors_bias,
        )
        t = int(video.shape[2] // 2) if temporal_index is None else int(temporal_index)
        frame = video[:1, :, t]
        out = previewer.decode_latent_to_preview(frame)
        if isinstance(out, Image.Image):
            return out.convert("RGB")
    except Exception as exc:
        log.debug("Latent2RGB preview failed: %s", exc)
    return None


def x0_to_preview_pil(x0: Any, *, max_side: int = 512) -> Image.Image | None:
    frames = x0_to_preview_pils(x0, max_side=max_side, frame_count=1)
    return frames[0] if frames else None


def x0_to_preview_pils(
    x0: Any,
    *,
    max_side: int = 512,
    frame_count: int = 8,
) -> list[Image.Image]:
    video = _video_latent_from_x0(x0)
    if video is None or video.numel() == 0:
        return []
    count = max(1, min(int(frame_count), int(video.shape[2])))
    if count == 1:
        temporal_indices = [int(video.shape[2] // 2)]
    else:
        temporal_indices = torch.linspace(0, int(video.shape[2]) - 1, count).round().int().tolist()
    dec = get_tae_decoder()
    result = []
    for temporal_index in temporal_indices:
        pil = None
        if dec is not None and int(video.shape[1]) == int(dec.latent_channels):
            try:
                rgb = dec.decode_frame(video[:1, :, temporal_index])
                arr = (rgb.numpy() * 255.0).clip(0, 255).astype(np.uint8)
                pil = Image.fromarray(arr, mode="RGB")
            except Exception as exc:
                log.warning("TAE decode failed, falling back to Latent2RGB: %s", exc)
        if pil is None:
            pil = _latent2rgb_pil(video, temporal_index)
        if pil is None:
            continue
        min_side = 256
        longest = max(int(pil.width), int(pil.height))
        if longest > 0 and longest < min_side:
            scale = min_side / float(longest)
            pil = pil.resize(
                (max(1, int(round(pil.width * scale))), max(1, int(round(pil.height * scale)))),
                Image.Resampling.NEAREST if hasattr(Image, "Resampling") else Image.NEAREST,
            )
        if max_side and max_side > 0 and (pil.width > max_side or pil.height > max_side):
            pil = ImageOps.contain(pil, (max_side, max_side), Image.LANCZOS)
        result.append(pil)
    return result


def pil_to_jpeg_b64(pil: Image.Image, *, quality: int = 80) -> str:
    import base64
    import io

    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=int(quality))
    return base64.b64encode(buf.getvalue()).decode("ascii")
