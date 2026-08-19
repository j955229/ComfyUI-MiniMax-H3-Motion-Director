"""Native MiniMax H3 learned-latent upscaler runtime used by Director.

The runtime loads compatible 24-channel H3 latent-upscaler checkpoints directly
from ComfyUI's ``models/latent_upscale_models`` folder. It intentionally does
not import or require any third-party ComfyUI custom node package.
"""

from __future__ import annotations

import os
import re
from typing import Callable, Iterable

import torch
import torch.nn as nn
import torch.nn.functional as F

_MODEL_FOLDER = "latent_upscale_models"
_GROUPS = 32
_EMBED = 64

_LATENT_MEAN = (
    0.858090341091156, -0.9606591463088989, 1.0661640167236328, -0.5090325474739075,
    -0.2727581858634949, -1.3675414323806763, -0.2553254961967468, -0.26907554268836975,
    -0.5376840829849243, -0.0464097298681736, 0.6657370328903198, 0.19690127670764923,
    -0.5460608005523682, -0.4035342037677765, -0.23683024942874908, 0.25928452610969543,
    -0.30133944749832153, 0.211341992020607, -1.1206848621368408, 0.3581933379173279,
    -0.04225143790245056, 0.2604829967021942, 0.22864092886447906, 0.7056031823158264,
)
_LATENT_STD = (
    1.2223774194717407, 1.2767263650894165, 1.6831774711608887, 1.7549455165863037,
    1.5636216402053833, 2.194143533706665, 0.9653137922286987, 1.0569885969161987,
    0.841948926448822, 0.7729952931404114, 1.8955937623977661, 0.946841835975647,
    0.7996809482574463, 0.44988900423049927, 0.7197399735450745, 0.6936293244361877,
    2.961095094680786, 2.7694199085235596, 3.0496184825897217, 2.1088054180145264,
    3.276226282119751, 3.1627357006073, 2.2816812992095947, 2.6127843856811523,
)


def _norm(channels: int) -> nn.GroupNorm:
    if channels % _GROUPS:
        raise ValueError(f"H3 latent upscaler channels must be divisible by {_GROUPS}; got {channels}.")
    return nn.GroupNorm(_GROUPS, channels)


class _ScaleShiftRes2D(nn.Module):
    def __init__(self, channels: int, *, dropout: float = 0.1):
        super().__init__()
        self.in_layers = nn.Sequential(_norm(channels), nn.SiLU(), nn.Conv2d(channels, channels, 3, padding=1))
        self.emb_layers = nn.Sequential(nn.SiLU(), nn.Linear(_EMBED, 2 * channels))
        self.out_norm = _norm(channels)
        self.out_layers = nn.Sequential(nn.SiLU(), nn.Dropout(dropout), nn.Conv2d(channels, channels, 3, padding=1))
        self.skip = nn.Identity()

    def forward(self, x: torch.Tensor, emb: torch.Tensor) -> torch.Tensor:
        h = self.in_layers(x)
        scale, shift = self.emb_layers(emb).to(h.dtype).chunk(2, dim=1)
        h = self.out_norm(h) * (1 + scale[..., None, None]) + shift[..., None, None]
        return x + self.out_layers(h)


class _ScaleShiftRes3D(nn.Module):
    def __init__(self, channels: int, *, dropout: float = 0.1):
        super().__init__()
        self.in_layers = nn.Sequential(_norm(channels), nn.SiLU(), nn.Conv3d(channels, channels, 3, padding=1))
        self.emb_layers = nn.Sequential(nn.SiLU(), nn.Linear(_EMBED, 2 * channels))
        self.out_norm = _norm(channels)
        self.out_layers = nn.Sequential(nn.SiLU(), nn.Dropout(dropout), nn.Conv3d(channels, channels, 3, padding=1))
        self.skip = nn.Identity()

    def forward(self, x: torch.Tensor, emb: torch.Tensor) -> torch.Tensor:
        h = self.in_layers(x)
        scale, shift = self.emb_layers(emb).to(h.dtype).chunk(2, dim=1)
        h = self.out_norm(h) * (1 + scale[..., None, None, None]) + shift[..., None, None, None]
        return x + self.out_layers(h)


class _TemporalResidual2D(nn.Module):
    def __init__(self, channels: int, kernel_size: int):
        super().__init__()
        self.norm = _norm(channels)
        self.dwconv = nn.Conv3d(
            channels, channels, (kernel_size, 1, 1),
            padding=(kernel_size // 2, 0, 0), groups=channels,
        )
        self.pwconv = nn.Conv3d(channels, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, t, h, w = x.shape
        flat = x.permute(0, 2, 1, 3, 4).reshape(b * t, c, h, w)
        flat = self.norm(flat)
        y = flat.reshape(b, t, c, h, w).permute(0, 2, 1, 3, 4)
        return x + self.pwconv(self.dwconv(F.silu(y)))


class _TemporalResidual3D(nn.Module):
    def __init__(self, channels: int, kernel_size: int):
        super().__init__()
        self.norm = _norm(channels)
        self.dwconv = nn.Conv3d(
            channels, channels, (kernel_size, 1, 1),
            padding=(kernel_size // 2, 0, 0), groups=channels,
        )
        self.pwconv = nn.Conv3d(channels, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pwconv(self.dwconv(F.silu(self.norm(x))))


class _Attention2D(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.norm = _norm(channels)
        self.q = nn.Conv2d(channels, channels, 1)
        self.k = nn.Conv2d(channels, channels, 1)
        self.v = nn.Conv2d(channels, channels, 1)
        self.proj_out = nn.Conv2d(channels, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, h, w = x.shape
        z = self.norm(x)
        q = self.q(z).flatten(2).transpose(1, 2).unsqueeze(1)
        k = self.k(z).flatten(2).transpose(1, 2).unsqueeze(1)
        v = self.v(z).flatten(2).transpose(1, 2).unsqueeze(1)
        y = F.scaled_dot_product_attention(q, k, v).squeeze(1).transpose(1, 2).reshape(b, c, h, w)
        return x + self.proj_out(y)


class _Attention3D(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.norm = _norm(channels)
        self.q = nn.Conv3d(channels, channels, 1)
        self.k = nn.Conv3d(channels, channels, 1)
        self.v = nn.Conv3d(channels, channels, 1)
        self.proj_out = nn.Conv3d(channels, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, t, h, w = x.shape
        z = self.norm(x)
        q = self.q(z).flatten(2).transpose(1, 2).unsqueeze(1)
        k = self.k(z).flatten(2).transpose(1, 2).unsqueeze(1)
        v = self.v(z).flatten(2).transpose(1, 2).unsqueeze(1)
        y = F.scaled_dot_product_attention(q, k, v).squeeze(1).transpose(1, 2).reshape(b, c, t, h, w)
        return x + self.proj_out(y)


def _make_layout_modules(layout: Iterable[str], channels: int, *, dims: int, temporal_kernel: int) -> nn.ModuleList:
    modules: list[nn.Module] = []
    for kind in layout:
        if kind == "res":
            modules.append(_ScaleShiftRes2D(channels) if dims == 2 else _ScaleShiftRes3D(channels))
        elif kind == "temporal":
            if dims != 3:
                raise ValueError("Temporal ModuleList entries are only valid in the full 3D checkpoint layout.")
            modules.append(_TemporalResidual3D(channels, temporal_kernel))
        elif kind == "attn":
            modules.append(_Attention2D(channels) if dims == 2 else _Attention3D(channels))
        else:
            raise ValueError(f"Unknown learned-latent block kind: {kind}")
    return nn.ModuleList(modules)


class _Compat2DBackbone(nn.Module):
    def __init__(self, in_channels: int, channels: int, in_layout: list[str], out_layout: list[str]):
        super().__init__()
        self.conv_in = nn.Conv2d(in_channels, channels, 3, padding=1)
        self.embed = nn.Sequential(nn.Linear(1, _EMBED), nn.SiLU(), nn.Linear(_EMBED, _EMBED))
        self.in_blocks = _make_layout_modules(in_layout, channels, dims=2, temporal_kernel=1)
        self.out_blocks = _make_layout_modules(out_layout, channels, dims=2, temporal_kernel=1)
        self.norm_out = _norm(channels)
        self.conv_out = nn.Conv2d(channels, in_channels, 3, padding=1)


class _Compat2DTemporalResizer(nn.Module):
    def __init__(
        self,
        *,
        in_channels: int = 24,
        channels: int = 640,
        in_blocks: int = 12,
        out_blocks: int = 12,
        temporal_kernel: int = 5,
        temporal_every: int = 2,
        use_temporal: bool = True,
        in_layout: list[str] | None = None,
        out_layout: list[str] | None = None,
    ):
        super().__init__()
        in_layout = list(in_layout or (["res"] * int(in_blocks)))
        out_layout = list(out_layout or (["res"] * int(out_blocks)))
        self.resizer = _Compat2DBackbone(in_channels, channels, in_layout, out_layout)
        self.temporal_blocks = nn.ModuleList(
            [_TemporalResidual2D(channels, temporal_kernel), _TemporalResidual2D(channels, temporal_kernel)]
            if use_temporal else []
        )
        self.temporal_every = max(1, int(temporal_every))

    @staticmethod
    def _flat_to_video(x: torch.Tensor, b: int, t: int) -> torch.Tensor:
        bt, c, h, w = x.shape
        if bt != b * t:
            raise RuntimeError("Invalid frame-flattened latent batch.")
        return x.reshape(b, t, c, h, w).permute(0, 2, 1, 3, 4)

    @staticmethod
    def _video_to_flat(x: torch.Tensor) -> torch.Tensor:
        b, c, t, h, w = x.shape
        return x.permute(0, 2, 1, 3, 4).reshape(b * t, c, h, w)

    def forward(self, x: torch.Tensor, *, scale: float, target_hw: tuple[int, int], on_progress: Callable[[float], None] | None = None) -> torch.Tensor:
        b, _c, t, _h, _w = x.shape
        flat = self._video_to_flat(x)
        emb = self.resizer.embed(x.new_tensor([[float(scale) - 1.0]])).expand(b * t, -1)
        total=max(1,len(self.resizer.in_blocks)+len(self.resizer.out_blocks)+3); done=0
        def advance():
            nonlocal done
            done += 1
            if on_progress is not None: on_progress(min(1.0, done/total))
        flat = self.resizer.conv_in(flat); advance()
        for index, block in enumerate(self.resizer.in_blocks):
            flat = block(flat, emb) if isinstance(block, _ScaleShiftRes2D) else block(flat)
            if self.temporal_blocks and index % self.temporal_every == 0:
                flat = self._video_to_flat(self.temporal_blocks[0](self._flat_to_video(flat, b, t)))
            advance()
        flat = F.interpolate(flat, size=tuple(map(int, target_hw)), mode="bilinear", align_corners=False); advance()
        for index, block in enumerate(self.resizer.out_blocks):
            flat = block(flat, emb) if isinstance(block, _ScaleShiftRes2D) else block(flat)
            if self.temporal_blocks and index % self.temporal_every == 0:
                flat = self._video_to_flat(self.temporal_blocks[1](self._flat_to_video(flat, b, t)))
            advance()
        flat = self.resizer.conv_out(F.silu(self.resizer.norm_out(flat))); advance()
        return self._flat_to_video(flat, b, t)


class _Compat3DResizer(nn.Module):
    def __init__(
        self,
        *,
        in_channels: int = 24,
        channels: int = 512,
        in_layout: list[str] | None = None,
        out_layout: list[str] | None = None,
        temporal_kernel: int = 5,
    ):
        super().__init__()
        self.conv_in = nn.Conv3d(in_channels, channels, 3, padding=1)
        self.embed = nn.Sequential(nn.Linear(1, _EMBED), nn.SiLU(), nn.Linear(_EMBED, _EMBED))
        self.in_blocks = _make_layout_modules(list(in_layout or ["res"] * 12), channels, dims=3, temporal_kernel=temporal_kernel)
        self.out_blocks = _make_layout_modules(list(out_layout or ["res"] * 12), channels, dims=3, temporal_kernel=temporal_kernel)
        self.norm_out = _norm(channels)
        self.conv_out = nn.Conv3d(channels, in_channels, 3, padding=1)

    def forward(self, x: torch.Tensor, *, scale: float, target_size: tuple[int, int, int], on_progress: Callable[[float], None] | None = None) -> torch.Tensor:
        emb = self.embed(x.new_tensor([[float(scale) - 1.0]])).expand(x.shape[0], -1)
        total=max(1,len(self.in_blocks)+len(self.out_blocks)+3); done=0
        def advance():
            nonlocal done
            done += 1
            if on_progress is not None: on_progress(min(1.0, done/total))
        x = self.conv_in(x); advance()
        for block in self.in_blocks:
            x = block(x, emb) if isinstance(block, _ScaleShiftRes3D) else block(x)
            advance()
        x = F.interpolate(x, size=tuple(map(int, target_size)), mode="trilinear", align_corners=False); advance()
        for block in self.out_blocks:
            x = block(x, emb) if isinstance(block, _ScaleShiftRes3D) else block(x)
            advance()
        x = self.conv_out(F.silu(self.norm_out(x))); advance()
        return x


def _strip_upscaler_prefix(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    if any(key.startswith("upscaler.") for key in state):
        return {key[9:]: value for key, value in state.items() if key.startswith("upscaler.")}
    return state


def detect_checkpoint_variant(state: dict[str, torch.Tensor]) -> str:
    state = _strip_upscaler_prefix(state)
    if "resizer.conv_in.weight" in state:
        return "2d"
    if "conv_in.weight" in state:
        return "3d"
    raise ValueError("Checkpoint is not a recognized MiniMax H3 learned-latent upscaler.")


def _layout_from_state(state: dict[str, torch.Tensor], prefix: str) -> list[str]:
    indices: set[int] = set()
    pattern = re.compile(rf"^{re.escape(prefix)}\.(\d+)\.")
    for key in state:
        match = pattern.match(key)
        if match:
            indices.add(int(match.group(1)))
    layout: list[str] = []
    for index in range(max(indices) + 1 if indices else 0):
        stem = f"{prefix}.{index}."
        keys = [key[len(stem):] for key in state if key.startswith(stem)]
        if any(key.startswith("in_layers.") for key in keys):
            layout.append("res")
        elif any(key.startswith("dwconv.") for key in keys):
            layout.append("temporal")
        elif any(key.startswith("q.") or key.startswith("proj_out.") for key in keys):
            layout.append("attn")
        else:
            raise ValueError(f"Unsupported checkpoint block layout at {stem}")
    return layout


def _temporal_kernel(state: dict[str, torch.Tensor], default: int = 5) -> int:
    for key, value in state.items():
        if key.endswith("dwconv.weight") and isinstance(value, torch.Tensor) and value.ndim == 5:
            return int(value.shape[2])
    return int(default)


def build_model_for_checkpoint(state: dict[str, torch.Tensor], *, variant: str | None = None) -> nn.Module:
    state = _strip_upscaler_prefix(state)
    detected = detect_checkpoint_variant(state)
    selected = str(variant or detected).lower()
    if selected != detected:
        raise ValueError(f"Selected {selected.upper()} upscaler but checkpoint layout is {detected.upper()}.")
    if selected == "2d":
        weight = state["resizer.conv_in.weight"]
        in_channels, channels = int(weight.shape[1]), int(weight.shape[0])
        in_layout = _layout_from_state(state, "resizer.in_blocks")
        out_layout = _layout_from_state(state, "resizer.out_blocks")
        use_temporal = any(key.startswith("temporal_blocks.") for key in state)
        return _Compat2DTemporalResizer(
            in_channels=in_channels,
            channels=channels,
            in_blocks=max(1, sum(kind == "res" for kind in in_layout)),
            out_blocks=max(1, sum(kind == "res" for kind in out_layout)),
            temporal_kernel=_temporal_kernel(state),
            temporal_every=2,
            use_temporal=use_temporal,
            in_layout=in_layout,
            out_layout=out_layout,
        )
    weight = state["conv_in.weight"]
    in_channels, channels = int(weight.shape[1]), int(weight.shape[0])
    return _Compat3DResizer(
        in_channels=in_channels,
        channels=channels,
        in_layout=_layout_from_state(state, "in_blocks"),
        out_layout=_layout_from_state(state, "out_blocks"),
        temporal_kernel=_temporal_kernel(state),
    )


def _checkpoint_path(model_name: str) -> str:
    import folder_paths

    name = str(model_name or "").strip()
    if not name:
        raise ValueError("H3 learned latent upscale requires a checkpoint filename.")
    try:
        paths = list(folder_paths.get_folder_paths(_MODEL_FOLDER) or [])
    except Exception:
        paths = []
    if not paths:
        models_dir = getattr(folder_paths, "models_dir", None)
        if not models_dir:
            raise RuntimeError("ComfyUI models directory is unavailable.")
        target = os.path.join(models_dir, _MODEL_FOLDER)
        os.makedirs(target, exist_ok=True)
        add = getattr(folder_paths, "add_model_folder_path", None)
        if callable(add):
            add(_MODEL_FOLDER, target)
        paths = [target]
    for directory in paths:
        candidate = os.path.join(directory, name)
        if os.path.isfile(candidate):
            return candidate
    raise FileNotFoundError(
        f"H3 learned latent checkpoint not found: {name}. Place it in "
        f"ComfyUI/models/{_MODEL_FOLDER}/."
    )


def list_h3_latent_models() -> list[str]:
    try:
        import folder_paths
    except ImportError:
        return []
    try:
        paths = list(folder_paths.get_folder_paths(_MODEL_FOLDER) or [])
    except Exception:
        models_dir = getattr(folder_paths, "models_dir", None)
        paths = [os.path.join(models_dir, _MODEL_FOLDER)] if models_dir else []
    names: set[str] = set()
    for directory in paths:
        if not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            if name.lower().endswith((".safetensors", ".pth", ".pt")):
                names.add(name)
    return sorted(names)


def _load_checkpoint(path: str) -> dict[str, torch.Tensor]:
    if path.lower().endswith(".safetensors"):
        from safetensors.torch import load_file
        raw = load_file(path, device="cpu")
    else:
        try:
            raw = torch.load(path, map_location="cpu", weights_only=True)
        except TypeError:
            raw = torch.load(path, map_location="cpu")
    if isinstance(raw, dict) and isinstance(raw.get("model"), dict):
        raw = raw["model"]
    if not isinstance(raw, dict) or not raw:
        raise ValueError("H3 learned latent checkpoint does not contain a state_dict.")
    state = {str(key): value for key, value in raw.items() if isinstance(value, torch.Tensor)}
    if not state:
        raise ValueError("H3 learned latent checkpoint contains no tensor weights.")
    float8 = getattr(torch, "float8_e4m3fn", None)
    if float8 is not None:
        state = {key: (value.to(torch.float16) if value.dtype == float8 else value) for key, value in state.items()}
    return _strip_upscaler_prefix(state)


def _dtype(name: str) -> torch.dtype:
    selected = str(name or "fp16").lower()
    mapping = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}
    if selected not in mapping:
        raise ValueError(f"Unsupported H3 learned latent precision: {name}")
    return mapping[selected]


def _device(name: str) -> torch.device:
    selected = str(name or "cuda").lower()
    if selected == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("H3 learned latent upscale requested CUDA but CUDA is unavailable.")
        return torch.device("cuda")
    if selected == "cpu":
        return torch.device("cpu")
    raise ValueError(f"Unsupported H3 learned latent device: {name}")


def _stats(device: torch.device, dtype: torch.dtype) -> tuple[torch.Tensor, torch.Tensor]:
    mean = torch.tensor(_LATENT_MEAN, device=device, dtype=dtype).view(1, 24, 1, 1, 1)
    std = torch.tensor(_LATENT_STD, device=device, dtype=dtype).view(1, 24, 1, 1, 1)
    return mean, std


def run_h3_latent_upscaler(
    video: torch.Tensor,
    *,
    model_name: str,
    variant: str,
    target_h: int,
    target_w: int,
    precision: str,
    device: str,
    on_progress: Callable[[float], None] | None = None,
) -> torch.Tensor:
    if not isinstance(video, torch.Tensor) or video.ndim not in {4, 5}:
        raise ValueError("H3 learned latent runtime expects a 4D/5D video latent tensor.")
    was_4d = video.ndim == 4
    source = video.unsqueeze(2) if was_4d else video
    if int(source.shape[1]) != 24:
        raise ValueError(f"H3 learned latent runtime requires 24 video channels; got {source.shape[1]}.")
    source_h, source_w = int(source.shape[-2]), int(source.shape[-1])
    target_h, target_w = int(target_h), int(target_w)
    if target_h < source_h or target_w < source_w:
        raise ValueError("H3 learned latent runtime supports upscale only.")

    scale_h = target_h / float(source_h)
    scale_w = target_w / float(source_w)

    if on_progress is not None: on_progress(0.0)

    # The checkpoint layout is the architecture source of truth. Older saved
    # Director configs may still contain an independent 2d/3d UI value; that
    # value must never override the actual state_dict layout.
    path = _checkpoint_path(model_name)
    state = _load_checkpoint(path)
    selected = detect_checkpoint_variant(state)
    if on_progress is not None: on_progress(0.10)

    uniform_scale = None
    if selected == "2d":
        # Integer latent dimensions independently round a common uniform scale.
        # Accept only targets for which one such scale can produce both H and W;
        # this allows normal grid snapping without permitting real AR changes.
        lower = max(
            (target_h - 0.5) / float(source_h),
            (target_w - 0.5) / float(source_w),
        )
        upper = min(
            (target_h + 0.5) / float(source_h),
            (target_w + 0.5) / float(source_w),
        )
        if lower > upper + 1e-12:
            raise ValueError(
                "2D + Temporal learned latent upscale uses one uniform scale; use a Full 3D checkpoint for aspect-ratio changes."
            )
        uniform_scale = (lower + upper) * 0.5

    model = build_model_for_checkpoint(state)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        raise RuntimeError("H3 learned latent checkpoint is missing required weights: " + ", ".join(missing[:8]))
    invalid_unexpected = [key for key in unexpected if not any(token in key for token in (".q.", ".k.", ".v.", ".proj_out."))]
    if invalid_unexpected:
        raise RuntimeError("H3 learned latent checkpoint has unsupported weights: " + ", ".join(invalid_unexpected[:8]))
    if on_progress is not None: on_progress(0.20)

    dev = _device(device)
    dtype = _dtype(precision)
    original_dtype = source.dtype
    model = model.to(device=dev, dtype=dtype).eval().requires_grad_(False)
    x = source.to(device=dev, dtype=dtype, copy=True)
    mean, std = _stats(dev, dtype)
    if on_progress is not None: on_progress(0.25)
    def model_progress(value: float):
        if on_progress is not None: on_progress(0.25 + 0.65 * max(0.0,min(1.0,float(value))))
    try:
        with torch.inference_mode():
            x.sub_(mean).div_(std)
            if selected == "2d":
                out = model(x, scale=float(uniform_scale), target_hw=(target_h, target_w), on_progress=model_progress)
            else:
                scale = (scale_h + scale_w) * 0.5
                out = model(x, scale=scale, target_size=(int(x.shape[2]), target_h, target_w), on_progress=model_progress)
            out = out.mul(std).add(mean)
            out = out.to(device="cpu", dtype=original_dtype)
            if on_progress is not None: on_progress(0.98)
    finally:
        del model
        if dev.type == "cuda":
            del x
            torch.cuda.empty_cache()
    if on_progress is not None: on_progress(1.0)
    return out.squeeze(2) if was_4d else out


__all__ = [
    "build_model_for_checkpoint",
    "detect_checkpoint_variant",
    "list_h3_latent_models",
    "run_h3_latent_upscaler",
]
