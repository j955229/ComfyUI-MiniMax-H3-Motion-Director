from pathlib import Path


def test_sam_ui_render_is_idempotent_under_document_mutation_observer():
    source = Path("web/js/minimax_sam_ui.js").read_text(encoding="utf-8")
    assert 'if (note.textContent !== text) note.textContent = text;' in source
    assert 'note.textContent = ready ? "" : TEXT[language()];' not in source
