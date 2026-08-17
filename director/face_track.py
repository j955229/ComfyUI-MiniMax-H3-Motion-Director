# Algorithms adapted from Carasibana/ComfyUI-H3-FaceRefine commit 79a97ce.
# Copyright Carasibana. MIT License; see LICENSES/MIT-H3-FaceRefine.txt.

"""Lazy face detection, temporal tracking, smoothing, and H3 crop creation."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


class NoFaceDetected(RuntimeError):
    pass


@dataclass
class FaceTrackResult:
    crops: torch.Tensor
    transform: dict[str, Any]
    statistics: dict[str, Any]


def _to_bgr_u8(frame: torch.Tensor) -> np.ndarray:
    rgb = (frame[..., :3].detach().float().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return rgb[..., ::-1].copy()


def _detector_model_path(name: str) -> str:
    if not name:
        raise ValueError("Face detector is enabled but no detector model is selected.")
    import folder_paths

    for category in ("ultralytics_bbox", "ultralytics", "onnx"):
        resolver = getattr(folder_paths, "get_full_path", None)
        if resolver:
            path = resolver(category, name)
            if path:
                return path
    path = Path(name)
    if path.is_file():
        return str(path)
    raise FileNotFoundError(f"Face detector model not found: {name}")


def create_detector(config: dict[str, Any]) -> Callable[[torch.Tensor], list[list[float]]]:
    kind = str(config.get("detector") or "ultralytics")
    confidence = float(config.get("confidence") or 0.35)
    if kind == "ultralytics":
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ImportError("Face Refine YOLO detection requires the optional ultralytics package.") from exc
        model = YOLO(_detector_model_path(str(config.get("detector_model") or "")))

        def detect(frame: torch.Tensor) -> list[list[float]]:
            result = model.predict(_to_bgr_u8(frame), conf=confidence, verbose=False)[0]
            return result.boxes.xyxy.detach().cpu().tolist() if len(result.boxes) else []

        return detect
    if kind == "insightface":
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:
            raise ImportError("Face Refine InsightFace detection requires the optional insightface package.") from exc
        app = FaceAnalysis(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=(640, 640))

        def detect(frame: torch.Tensor) -> list[list[float]]:
            return [face.bbox.astype(float).tolist() for face in app.get(_to_bgr_u8(frame)) if float(face.det_score) >= confidence]

        return detect
    raise ValueError(f"Unsupported face detector: {kind}")


def _create_identity_matcher(config: dict[str, Any], images: torch.Tensor):
    if not config.get("identity_track"):
        return None
    try:
        from insightface.app import FaceAnalysis
    except ImportError as exc:
        raise ImportError("Identity tracking was selected but InsightFace is unavailable.") from exc
    app = FaceAnalysis(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    def embedding_from_bgr(image_bgr: np.ndarray):
        faces = app.get(image_bgr)
        if not faces:
            return None
        face = max(faces, key=lambda item: float((item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1])))
        vector = np.asarray(face.normed_embedding, dtype=np.float32)
        return vector / max(float(np.linalg.norm(vector)), 1e-8)

    reference = str(config.get("identity_reference") or "").strip()
    anchor = None
    if reference:
        import folder_paths

        path = getattr(folder_paths, "get_annotated_filepath", lambda value: value)(reference)
        rgb = np.asarray(Image.open(path).convert("RGB"))
        anchor = embedding_from_bgr(rgb[..., ::-1].copy())
        if anchor is None:
            raise RuntimeError("Identity reference contains no detectable face.")

    def choose(frame: torch.Tensor, boxes: list[list[float]]) -> list[float]:
        nonlocal anchor
        bgr = _to_bgr_u8(frame)
        candidates = []
        for box in boxes:
            x0, y0 = max(0, int(box[0])), max(0, int(box[1]))
            x1, y1 = min(bgr.shape[1], int(math.ceil(box[2]))), min(bgr.shape[0], int(math.ceil(box[3])))
            if x1 <= x0 or y1 <= y0:
                continue
            embedding = embedding_from_bgr(bgr[y0:y1, x0:x1])
            if embedding is not None:
                candidates.append((box, embedding))
        if not candidates:
            raise RuntimeError("Identity tracking could not embed any detected face; refusing to switch to largest.")
        if anchor is None:
            box, anchor = max(candidates, key=lambda item: max(1, item[0][3] - item[0][1]))
            return box
        scored = [(box, float(np.dot(anchor, embedding))) for box, embedding in candidates]
        box, score = max(scored, key=lambda item: item[1])
        if score < float(config.get("identity_threshold") or 0.35):
            raise RuntimeError(
                f"Identity tracking confidence {score:.3f} is below the selected threshold; refusing largest-face downgrade."
            )
        return box

    return choose


def _box_cost(box: list[float], last: tuple[float, float, float]) -> float:
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    size = max(1.0, box[3] - box[1])
    norm = max(8.0, last[2])
    distance = math.hypot(cx - last[0], cy - last[1]) / norm
    size_penalty = abs(math.log(size / norm))
    return distance + 0.75 * size_penalty


def _interp(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    indices = np.arange(len(values))
    known = indices[valid]
    if not len(known):
        raise NoFaceDetected("No face detected in any frame.")
    return np.interp(indices, known, values[valid])


def _smooth(values: np.ndarray, window: int, method: str) -> np.ndarray:
    window = max(1, min(int(window) | 1, max(1, len(values) * 2 - 1)))
    if window <= 1 or len(values) <= 2:
        return values.copy()
    if method == "savgol":
        try:
            from scipy.signal import savgol_filter
        except ImportError as exc:
            raise ImportError("Savitzky-Golay tracking was selected but scipy is unavailable.") from exc
        real_window = min(window, len(values) if len(values) % 2 else len(values) - 1)
        return savgol_filter(values, max(3, real_window), min(2, max(1, real_window - 1)), mode="interp")
    if method == "gaussian":
        radius = window // 2
        x = np.arange(-radius, radius + 1, dtype=np.float64)
        sigma = max(0.5, window / 6)
        kernel = np.exp(-(x * x) / (2 * sigma * sigma))
    else:
        radius = window // 2
        kernel = np.ones(window, dtype=np.float64)
    kernel /= kernel.sum()
    padded = np.pad(values, (radius, radius), mode="reflect")
    return np.convolve(padded, kernel, mode="valid")[: len(values)]


def _crop_frame(frame: torch.Tensor, box: tuple[float, float, float, float], width: int, height: int) -> torch.Tensor:
    source = frame[..., :3].permute(2, 0, 1).unsqueeze(0)
    _, _, src_h, src_w = source.shape
    x, y, w, h = box
    theta = source.new_tensor(
        [[[w / src_w, 0.0, (2 * (x + w / 2) / src_w) - 1],
          [0.0, h / src_h, (2 * (y + h / 2) / src_h) - 1]]]
    )
    grid = F.affine_grid(theta, (1, 3, int(height), int(width)), align_corners=False)
    return F.grid_sample(source, grid, mode="bilinear", padding_mode="border", align_corners=False)[0].permute(1, 2, 0)


def _resolve_canvas(max_crop: float, mode: str, requested: int) -> int:
    """Resolve the exact selected canvas policy without a hidden downscale."""
    if mode == "manual":
        return max(256, min(1536, int(round(requested / 32)) * 32))
    automatic = max(256, int(math.ceil(float(max_crop) / 32)) * 32)
    if mode == "auto_capped_768":
        return min(automatic, 768)
    # auto_no_downscale intentionally has no arbitrary 1536 clamp.  If the
    # chosen canvas is too large for the machine, the Face Refine stage fails
    # and returns ASSEMBLED_RESULT; it must not silently shrink the canvas.
    return automatic


def track_and_crop(
    images: torch.Tensor,
    config: dict[str, Any],
    *,
    detector: Callable[[torch.Tensor], list[list[float]]] | None = None,
) -> FaceTrackResult:
    if not isinstance(images, torch.Tensor) or images.ndim != 4 or int(images.shape[0]) < 1:
        raise ValueError("Face Refine needs a non-empty IMAGE batch.")
    detector = detector or create_detector(config)
    identity_choose = _create_identity_matcher(config, images)
    frame_count, source_h, source_w, _ = images.shape
    cx = np.zeros(frame_count)
    cy = np.zeros(frame_count)
    face_h = np.zeros(frame_count)
    face_w = np.zeros(frame_count)
    valid = np.zeros(frame_count, dtype=bool)
    last = None
    select = config.get("select") or "largest"
    for index in range(frame_count):
        boxes = detector(images[index])
        if not boxes:
            continue
        if identity_choose is not None and (last is None or len(boxes) > 1):
            box = identity_choose(images[index], boxes)
        elif last is not None:
            box = min(boxes, key=lambda value: _box_cost(value, last))
        elif select == "most_central":
            box = min(boxes, key=lambda value: ((value[0] + value[2]) / 2 - source_w / 2) ** 2 + ((value[1] + value[3]) / 2 - source_h / 2) ** 2)
        else:
            box = max(boxes, key=lambda value: max(0, value[3] - value[1]))
        cx[index] = (box[0] + box[2]) / 2
        cy[index] = (box[1] + box[3]) / 2
        face_w[index] = max(2.0, box[2] - box[0])
        face_h[index] = max(2.0, box[3] - box[1])
        valid[index] = True
        last = (cx[index], cy[index], face_h[index])
    if not valid.any():
        raise NoFaceDetected("No face detected in any frame.")

    fallback_name = str(config.get("fallback_detector") or "none")
    if fallback_name != "none" and (~valid).any():
        fallback = create_detector({
            **config,
            "detector": "ultralytics",
            "detector_model": fallback_name,
        })
        seeded_size = _interp(face_h, valid)
        head_fraction = float(config.get("fallback_head_frac") or 0.5)
        for index in np.flatnonzero(~valid):
            boxes = fallback(images[index])
            if not boxes:
                continue
            body = max(boxes, key=lambda value: max(0, value[2] - value[0]) * max(0, value[3] - value[1]))
            cx[index] = (body[0] + body[2]) / 2
            cy[index] = body[1] + head_fraction * max(8.0, seeded_size[index])
            face_h[index] = seeded_size[index]
            face_w[index] = seeded_size[index] * 0.8
            valid[index] = True

    raw_cx, raw_cy = _interp(cx, valid), _interp(cy, valid)
    raw_h, raw_w = _interp(face_h, valid), _interp(face_w, valid)
    method = str(config.get("smooth_method") or "gaussian")
    cx = _smooth(raw_cx, int(config.get("smooth_window") or 21), method)
    cy = _smooth(raw_cy, int(config.get("smooth_window") or 9), method)
    face_h = _smooth(raw_h, int(config.get("size_smooth_window") or 51), method)
    face_w = _smooth(raw_w, int(config.get("size_smooth_window") or 13), method)
    if config.get("size_mode") == "stable":
        face_h[:] = np.max(face_h)
        face_w[:] = np.max(face_w)

    factor = float(config.get("crop_factor") or 2.5)
    requested_canvas = int(config.get("canvas_size") or 768)
    canvas_mode = config.get("canvas_mode") or "auto_capped_768"
    max_crop = float(min(np.max(face_h) * factor, source_h, source_w))
    canvas = _resolve_canvas(max_crop, str(canvas_mode), requested_canvas)

    boxes = []
    face_rects = []
    crops = torch.empty((frame_count, canvas, canvas, 3), dtype=images.dtype, device=images.device)
    for index in range(frame_count):
        size = min(float(face_h[index] * factor), float(source_h), float(source_w))
        x = min(max(float(cx[index] - size / 2), 0.0), max(0.0, source_w - size))
        y = min(max(float(cy[index] - size / 2), 0.0), max(0.0, source_h - size))
        box = (x, y, size, size)
        boxes.append(box)
        crops[index] = _crop_frame(images[index], box, canvas, canvas)
        face_rects.append((
            canvas * 0.5 - 0.5 * face_w[index] / size * canvas,
            canvas * 0.5 - 0.5 * face_h[index] / size * canvas,
            face_w[index] / size * canvas,
            face_h[index] / size * canvas,
        ))
    weights = _smooth(valid.astype(float), max(3, int(config.get("smooth_window") or 9) // 2), "gaussian")
    weights = np.clip(weights, 0, 1)
    transform = {
        "boxes": boxes,
        "canvas": (canvas, canvas),
        "src_size": (int(source_w), int(source_h)),
        "frames": int(frame_count),
        "weights": weights.tolist(),
        "detected": valid.tolist(),
        "face_rect": face_rects,
        "face_heights": face_h.tolist(),
        "crop_factor": factor,
    }
    statistics = {
        "frames": int(frame_count),
        "detected": int(valid.sum()),
        "interpolated": int(frame_count - valid.sum()),
        "face_px_min": float(face_h.min()),
        "face_px_mean": float(face_h.mean()),
        "face_px_max": float(face_h.max()),
        "canvas": f"{canvas}x{canvas}",
    }
    return FaceTrackResult(crops=crops, transform=transform, statistics=statistics)


__all__ = ["FaceTrackResult", "NoFaceDetected", "create_detector", "track_and_crop"]
