"""Lazy Selective Run expansion for Mixed timelines.

The existing executor writes the complete sampling/context cache fingerprint to
``plan.cache_settings`` immediately before it consumes ``plan.run_indices``.
This set-like object deliberately resolves dependency cache status only at that
moment, so valid upstream results are reused while missing/stale prerequisites
are automatically added to the run.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Set
from typing import Any, Mapping, Sequence

from .mixed_schema import MixedSchemaError

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.mixed_selection")


class MixedRunSelection(Set[int]):
    def __init__(
        self,
        *,
        plan,
        segments: Sequence[Mapping[str, Any]],
        requested: set[int] | frozenset[int],
        node_id: str | None,
    ) -> None:
        self.plan = plan
        self.segments = list(segments)
        self.requested = frozenset(int(index) for index in requested)
        self.node_id = str(node_id) if node_id not in (None, "") else None
        self._resolved: frozenset[int] | None = None
        self._reasons: dict[int, list[str]] = {}

    def _runtime_ready(self) -> bool:
        return isinstance(getattr(self.plan, "cache_settings", None), dict)

    def _id_index(self) -> dict[str, int]:
        return {str(seg.get("id")): index for index, seg in enumerate(self.segments)}

    def _relations(self, consumer_index: int) -> list[tuple[int, str]]:
        if consumer_index < 0 or consumer_index >= len(self.segments):
            raise MixedSchemaError(f"Mixed consumer index out of range: {consumer_index}.")
        consumer = self.segments[consumer_index]
        ids = self._id_index()
        relations: list[tuple[int, str]] = []
        for ref in ((consumer.get("inputs") or {}).get("resultRefs") or []):
            origin = str(ref.get("origin") or "")
            if origin == "previous":
                if consumer_index <= 0:
                    raise MixedSchemaError("Missing Reference: first Mixed segment has no Previous Segment.")
                source_index = consumer_index - 1
            else:
                source_id = str(ref.get("segmentId") or "")
                source_index = ids.get(source_id, -1)
                if source_index < 0:
                    raise MixedSchemaError(
                        f"Missing Reference: Segment {consumer.get('id')} references {source_id!r}."
                    )
                if source_index >= consumer_index:
                    raise MixedSchemaError(
                        f"Invalid Reference: Segment {consumer.get('id')} references non-earlier {source_id!r}."
                    )
            relations.append((source_index, "result"))

        continuity = consumer.get("continuity") or {}
        if consumer_index > 0:
            if bool(continuity.get("visual")):
                relations.append((consumer_index - 1, "visual_context"))
            if bool(continuity.get("audio")):
                relations.append((consumer_index - 1, "audio_context"))
        return relations

    def _full_segment_hit(self, producer_index: int) -> bool:
        if not self.node_id:
            return False
        try:
            from .segment_cache import segment_cache_status

            return segment_cache_status(
                self.node_id,
                self.plan.segments[producer_index],
                self.plan,
            ) == "hit"
        except Exception:
            return False

    def _context_hit(self, producer_index: int, *, visual: bool, audio: bool) -> bool:
        if not self.node_id:
            return False
        producer = self.plan.segments[producer_index]
        settings = getattr(self.plan, "cache_settings", None) or {}
        try:
            from .context_cache import load_motion_context_cache
            from .latent_context_cache import load_latent_context_cache

            pixel = load_motion_context_cache(
                self.node_id,
                producer,
                self.plan,
                settings=settings,
                strict=False,
            )
            latent = load_latent_context_cache(
                self.node_id,
                producer,
                self.plan,
                settings=settings,
            )
        except Exception:
            return False

        if visual and pixel is None and latent is None:
            return False
        if audio:
            try:
                from .audio_trim import audio_has_samples

                if pixel is None or not audio_has_samples(pixel.audio):
                    return False
            except Exception:
                return False
        return True

    def _relation_cache_hit(self, producer_index: int, kinds: set[str]) -> bool:
        # Unselected generated segments must still be reconstructable in Final
        # output, so a full segment cache is the baseline reuse requirement.
        if not self._full_segment_hit(producer_index):
            return False
        visual = "visual_context" in kinds
        audio = "audio_context" in kinds
        if visual or audio:
            return self._context_hit(producer_index, visual=visual, audio=audio)
        return True

    def _resolve(self) -> frozenset[int]:
        if self._resolved is not None:
            return self._resolved
        if not self._runtime_ready():
            # Planning/UI code may ask len()/iterate before the executor has its
            # exact sampler/model fingerprint. Never guess cache validity early.
            return self.requested

        run = set(self.requested)
        queue = list(sorted(self.requested, reverse=True))
        examined: set[int] = set()
        reasons: dict[int, list[str]] = {}

        while queue:
            consumer_index = queue.pop()
            if consumer_index in examined:
                continue
            examined.add(consumer_index)
            grouped: dict[int, set[str]] = {}
            for producer_index, kind in self._relations(consumer_index):
                grouped.setdefault(producer_index, set()).add(kind)

            for producer_index, kinds in grouped.items():
                if producer_index in run:
                    queue.append(producer_index)
                    continue
                if self._relation_cache_hit(producer_index, kinds):
                    continue
                run.add(producer_index)
                queue.append(producer_index)
                human = []
                if "result" in kinds:
                    human.append("result still")
                if "visual_context" in kinds:
                    human.append("Visual MC")
                if "audio_context" in kinds:
                    human.append("Audio Context")
                reasons.setdefault(producer_index, []).append(
                    f"required by Segment {consumer_index + 1}: {', '.join(human) or 'dependency'} cache missing/stale"
                )

        self._resolved = frozenset(sorted(run))
        self._reasons = reasons
        self.plan.mixed_auto_run_indices = frozenset(self._resolved - self.requested)
        self.plan.mixed_auto_run_reasons = {
            int(index): list(values) for index, values in sorted(reasons.items())
        }
        if self.plan.mixed_auto_run_indices:
            detail = "; ".join(
                f"S{index + 1} ({' | '.join(reasons.get(index, []))})"
                for index in sorted(self.plan.mixed_auto_run_indices)
            )
            log.info("Mixed Selective Run auto-added prerequisites: %s", detail)
        return self._resolved

    def __contains__(self, value: object) -> bool:
        try:
            index = int(value)
        except (TypeError, ValueError):
            return False
        return index in self._resolve()

    def __iter__(self) -> Iterator[int]:
        return iter(sorted(self._resolve()))

    def __len__(self) -> int:
        return len(self._resolve())

    @property
    def reasons(self) -> dict[int, list[str]]:
        self._resolve()
        return {key: list(value) for key, value in self._reasons.items()}


__all__ = ["MixedRunSelection"]
