from pathlib import Path

from director.cache_path import cache_node_dir_name, cache_root


def test_subgraph_compound_id_is_windows_safe(tmp_path: Path):
    assert cache_node_dir_name("105:815") == "105_815"
    root = cache_root(tmp_path, "minimax_seg_cache", "105:815")
    assert root == tmp_path / "minimax_seg_cache" / "105_815"
    assert root.is_dir()


def test_nested_compound_id_replaces_every_colon():
    assert cache_node_dir_name("12:105:815") == "12_105_815"


def test_regular_node_id_is_unchanged():
    assert cache_node_dir_name("815") == "815"
