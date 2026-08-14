# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Lightweight MiniMax H3 TAE / Latent2RGB previews during sampling.

Uses ``models/vae_approx/taeh3.safetensors`` when present.  Both flat 2D TinyVAE
and madebyollin's temporal TAEHV checkpoint are supported.  Falls back to
Latent2RGB so the UI still updates.

The temporal decoder and packed-latent handling follow the current GPL-3.0
ComfyUI-KJNodes implementation, adapted to the Director preview side channel.
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

    @torch.inference_mode()
    def decode_video(self, latent: torch.Tensor, frame_indices: list[int]) -> torch.Tensor:
        return torch.stack([self.decode_frame(latent[:1, :, index]) for index in frame_indices])


def is_temporal_taehv_state_dict(sd: dict[str, Any]) -> bool:
    """Return true for the madebyollin temporal TAEHV layout used by taeh3."""
    return "decoder.1.weight" in sd and "decoder.22.bias" in sd


class _TAEHVDecoder:
    """Decode-only temporal TAEHV with MiniMax H3's 24-channel/patch-size-2 layout."""

    def __init__(self, sd, device=None, dtype=None):
        import comfy.model_management as mm
        from comfy.taesd.taehv import TAEHV, conv

        self.latent_channels = int(sd["decoder.1.weight"].shape[1])
        patch_size = max(1, int(round((int(sd["decoder.22.bias"].shape[0]) / 3) ** 0.5)))
        model = TAEHV(latent_channels=self.latent_channels)
        if model.patch_size != patch_size:
            model.patch_size = patch_size
            model.encoder[0] = conv(3 * patch_size**2, model.encoder[0].out_channels)
            model.decoder[-1] = conv(model.decoder[-1].in_channels, 3 * patch_size**2)
        model.load_state_dict(sd)
        del model.encoder

        self.device = device if device is not None else mm.vae_device()
        self.dtype = dtype if dtype is not None else mm.vae_dtype(
            self.device, [torch.float16, torch.bfloat16]
        )
        self.model = _place(model, self.device, self.dtype)
        self.is_h3 = self.latent_channels == 24 and patch_size == 2

    @torch.inference_mode()
    def _decode(self, latent: torch.Tensor) -> torch.Tensor:
        out = self.model.decode(latent.to(device=self.device, dtype=self.dtype))
        return out.to(dtype=torch.float32)

    @torch.inference_mode()
    def decode_video(self, latent: torch.Tensor, frame_indices: list[int]) -> torch.Tensor:
        """Return a bounded temporal prefix as CPU ``[N,H,W,3]`` true-RGB frames.

        TAEHV MemBlocks carry temporal state, so arbitrary latent tokens cannot be
        decoded independently.  A short prefix is decoded and evenly sampled from
        its resulting pixel frames instead.
        """
        count = max(1, min(len(frame_indices), int(latent.shape[2])))
        out = self._decode(latent[:1, :, :count])[0].movedim(0, -1)
        if int(out.shape[0]) > count:
            indices = torch.linspace(0, int(out.shape[0]) - 1, count, device=out.device).round().long()
            out = out[indices]
        return out.float().clamp(0, 1).cpu().contiguous()


def _decoder_from_state_dict(sd: dict[str, Any]):
    if is_temporal_taehv_state_dict(sd):
        return _TAEHVDecoder(sd)
    return _TinyVAEDecoder(sd)


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
            _decoder = _decoder_from_state_dict(sd)
            log.info(
                "TAE preview: loaded %s using %s (%d-ch).",
                name,
                type(_decoder).__name__,
                _decoder.latent_channels,
            )
            return _decoder
        except Exception as exc:
            log.warning("TAE preview: failed to load %s (%s) — using Latent2RGB.", name, exc)
            _decoder_failed = True
            return None


def normalize_preview_latent(x0: Any, latent_shapes: Any = None) -> torch.Tensor | None:
    """Restore the first (video) stream from ComfyUI's packed nested sampler tensor."""
    if not isinstance(x0, torch.Tensor):
        return None
    try:
        shapes = list(latent_shapes or [])
        if shapes and x0.ndim == 3:
            target = tuple(int(value) for value in shapes[0])
            if len(target) >= 3:
                expected = 1
                for value in target[1:]:
                    expected *= value
                if int(x0.shape[2]) < expected:
                    log.warning(
                        "TAE preview: packed x0 is shorter than video latent_shapes (%d < %d).",
                        int(x0.shape[2]), expected,
                    )
                    return None
                return x0[:, :, :expected].reshape((int(x0.shape[0]),) + target[1:])
    except Exception as exc:
        log.warning("TAE preview: could not restore packed x0 using latent_shapes: %s", exc)
        return None
    return x0


def _video_latent_from_x0(x0: Any, latent_shapes: Any = None) -> torch.Tensor | None:
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
        x0 = normalize_preview_latent(x0, latent_shapes)
        if x0 is None:
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


def x0_to_preview_pil(
    x0: Any, *, max_side: int = 512, latent_shapes: Any = None
) -> Image.Image | None:
    frames = x0_to_preview_pils(
        x0, max_side=max_side, frame_count=1, latent_shapes=latent_shapes
    )
    return frames[0] if frames else None


def x0_to_preview_pils(
    x0: Any,
    *,
    max_side: int = 512,
    frame_count: int = 8,
    latent_shapes: Any = None,
) -> list[Image.Image]:
    video = _video_latent_from_x0(x0, latent_shapes)
    if video is None or video.numel() == 0:
        return []
    count = max(1, min(int(frame_count), int(video.shape[2])))
    if count == 1:
        temporal_indices = [int(video.shape[2] // 2)]
    else:
        temporal_indices = torch.linspace(0, int(video.shape[2]) - 1, count).round().int().tolist()
    dec = get_tae_decoder()
    result: list[Image.Image] = []
    decoded: torch.Tensor | None = None
    if dec is not None:
        if int(video.shape[1]) != int(dec.latent_channels):
            log.warning(
                "TAE preview: decoder has %d channels but H3 video latent has %d; using Latent2RGB.",
                int(dec.latent_channels), int(video.shape[1]),
            )
        else:
            try:
                decoded = dec.decode_video(video, temporal_indices)
            except Exception as exc:
                log.warning("TAE preview decode failed; using Latent2RGB for this step: %s", exc)

    for output_index, temporal_index in enumerate(temporal_indices):
        pil = None
        if decoded is not None and output_index < int(decoded.shape[0]):
            try:
                rgb = decoded[output_index]
                arr = (rgb.numpy() * 255.0).clip(0, 255).astype(np.uint8)
                pil = Image.fromarray(arr, mode="RGB")
            except Exception as exc:
                log.warning("TAE preview frame conversion failed; using Latent2RGB: %s", exc)
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
