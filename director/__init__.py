# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""MiniMax H3 Motion Director orchestration (ComfyUI official MiniMax H3 path).

Based on ComfyUI MiniMax H3 support (PR #15224) and workflow templates (PR #15228).
"""

# Install before executor_core imports apply_exported_motion_context so every
# normal ComfyUI path and direct director.* import gets the same Audio Previous
# Context stabilization behavior.
from .audio_context_refresh import install_audio_context_refresh

install_audio_context_refresh()
