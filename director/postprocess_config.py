"""v10 postprocess compatibility facade.

The v9 implementation is preserved verbatim in ``postprocess_config_legacy``.
This facade keeps its public API stable while making Face Refine part of the
final segment/cache identity.
"""

from __future__ import annotations

import copy
import json
from typing import Any

from . import postprocess_config_legacy as _legacy
from .postprocess_config_legacy import *  # noqa: F401,F403

POSTPROCESS_CONFIG_VERSION = 10
DEFAULT_POSTPROCESS_CONFIG = copy.deepcopy(_legacy.DEFAULT_POSTPROCESS_CONFIG)
DEFAULT_POSTPROCESS_CONFIG["version"] = POSTPROCESS_CONFIG_VERSION


def normalize_postprocess_config(raw: Any) -> dict[str, Any]:
    result = _legacy.normalize_postprocess_config(raw)
    result["version"] = POSTPROCESS_CONFIG_VERSION
    return result


def serialize_postprocess_config(raw: Any) -> str:
    return json.dumps(
        normalize_postprocess_config(raw),
        ensure_ascii=False,
        separators=(",", ":"),
    )


def postprocess_cache_fingerprint(config: dict[str, Any]) -> dict[str, Any]:
    """Return the pixel/latent-producing postprocess identity.

    Face Refine now runs before segment/cache finalization on normal Motion
    Context chains, so its settings must invalidate stale segment/context
    caches. Result previews remain UI-only and are deliberately excluded.
    """
    normalized = normalize_postprocess_config(config)
    global_refine = dict(normalized["global_refine"])
    face_refine = dict(normalized["face_refine"])
    global_refine.pop("result_previews_enabled", None)
    return {
        "global_refine": global_refine if global_refine["enabled"] else False,
        "face_refine": face_refine if face_refine["enabled"] else False,
    }


def __getattr__(name: str):
    return getattr(_legacy, name)


__all__ = list(_legacy.__all__)
for _name in (
    "DEFAULT_POSTPROCESS_CONFIG",
    "POSTPROCESS_CONFIG_VERSION",
    "normalize_postprocess_config",
    "serialize_postprocess_config",
    "postprocess_cache_fingerprint",
):
    if _name not in __all__:
        __all__.append(_name)
