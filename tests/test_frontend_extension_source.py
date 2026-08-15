import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "js" / "minimax_director_inputs.js"


def test_frontend_extension_handles_migrations_dynamic_assets_and_separate_locks():
    text = SOURCE.read_text(encoding="utf-8")
    assert 'name: "MiniMaxH3.MotionDirector.UnifiedInputs"' in text
    assert 'MiniMaxH3MotionDirectorInputs' in text
    assert 'MiniMaxH3MotionDirectorAssets' in text
    assert 'director_inputs' in text
    assert 'desiredDirectorInputSockets' in text
    assert 'desiredAssetSockets' in text
    assert 'timelineGroupHasInternalMedia' in text
    assert 'timelineGroupHasInternalPrompt' in text
    assert 'stripLegacyDirectorInputs' in text
    assert 'i2v_groups' in text
    assert 'r2v_groups' in text
    assert 'mmx-external-media-locked' in text
    assert 'mmx-external-prompt-locked' in text
    assert 'disconnectInput' in text
