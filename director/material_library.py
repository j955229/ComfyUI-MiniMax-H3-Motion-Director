# MiniMax H3 Motion Director — persistent Material Library storage.
# Distributed under GNU GPL v3.0. See repository LICENSE.

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import folder_paths

SCHEMA_VERSION = 2
_LIBRARY_DIRNAME = "minimax_h3_motion_director"
_LIBRARY_SUBDIR = "material_library"
_INPUT_SUBDIR = "minimax_material_library"
_SAFE_EXT = re.compile(r"^\.[A-Za-z0-9]{1,10}$")

DEFAULT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "image": ("人物", "场景", "道具", "其他"),
    "audio": ("音色", "台词", "音效", "音乐", "其他"),
    "video": ("人物", "场景", "动作", "镜头", "其他"),
    "prompt": ("人物", "场景", "动作", "运镜", "风格", "对白", "其他"),
}

ALLOWED_EXTENSIONS: dict[str, set[str]] = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"},
    "audio": {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".wma"},
    "video": {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"},
}


class MaterialLibraryError(ValueError):
    pass


def _now_ms() -> int:
    return int(time.time() * 1000)


def _user_directory() -> Path:
    getter = getattr(folder_paths, "get_user_directory", None)
    if callable(getter):
        try:
            value = getter()
            if value:
                return Path(value)
        except Exception:
            pass
    value = getattr(folder_paths, "user_directory", None)
    if value:
        return Path(value)
    base = getattr(folder_paths, "base_path", None)
    return Path(base or os.getcwd()) / "user"


def library_root() -> Path:
    return _user_directory() / _LIBRARY_DIRNAME / _LIBRARY_SUBDIR


def library_index_path() -> Path:
    return library_root() / "library.json"


def library_files_root() -> Path:
    return library_root() / "files"


def library_upload_root() -> Path:
    return library_root() / ".uploads"


def _resolve_under(root: Path, candidate: Path) -> Path:
    root_resolved = root.resolve()
    candidate_resolved = candidate.resolve()
    try:
        candidate_resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise MaterialLibraryError("Unsafe material-library path.") from exc
    return candidate_resolved


def _normalize_kind(value: Any) -> str:
    kind = str(value or "").strip().lower()
    if kind not in DEFAULT_CATEGORIES:
        raise MaterialLibraryError("Unsupported material type.")
    return kind


def _normalize_title(value: Any, fallback: str = "未命名素材") -> str:
    title = str(value or "").replace("\x00", "").strip()
    if not title:
        title = fallback
    return title[:240]


def _normalize_category_name(value: Any) -> str:
    name = str(value or "").replace("\x00", "").strip()
    if not name:
        raise MaterialLibraryError("Category name is required.")
    return name[:80]


def _safe_extension(filename: str, kind: str) -> str:
    ext = Path(str(filename or "")).suffix.lower()
    if not _SAFE_EXT.match(ext) or ext not in ALLOWED_EXTENSIONS.get(kind, set()):
        raise MaterialLibraryError(f"Unsupported {kind} file extension: {ext or '(none)'}")
    return ext


def _default_categories_document() -> dict[str, list[str]]:
    return {kind: list(values) for kind, values in DEFAULT_CATEGORIES.items()}


def _default_document() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "categories": _default_categories_document(), "items": []}


def _ensure_categories_document(data: dict[str, Any]) -> dict[str, list[str]]:
    raw = data.get("categories")
    categories: dict[str, list[str]] = {}
    for kind, defaults in DEFAULT_CATEGORIES.items():
        names = []
        if isinstance(raw, dict):
            maybe = raw.get(kind)
            if isinstance(maybe, list):
                for value in maybe:
                    try:
                        name = _normalize_category_name(value)
                    except MaterialLibraryError:
                        continue
                    if name not in names:
                        names.append(name)
        if not names:
            names = list(defaults)
        categories[kind] = names
    data["categories"] = categories
    return categories


def _categories_for(data: dict[str, Any], kind: str) -> list[str]:
    categories = _ensure_categories_document(data)
    return categories.get(kind, list(DEFAULT_CATEGORIES[kind]))


def _normalize_category(data: dict[str, Any], kind: str, value: Any) -> str:
    category = str(value or "").strip() or "其他"
    if category not in _categories_for(data, kind):
        raise MaterialLibraryError("Unsupported material category.")
    return category


class MaterialLibraryStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    def ensure_dirs(self) -> None:
        library_root().mkdir(parents=True, exist_ok=True)
        library_files_root().mkdir(parents=True, exist_ok=True)
        library_upload_root().mkdir(parents=True, exist_ok=True)

    def _load_unlocked(self) -> dict[str, Any]:
        self.ensure_dirs()
        path = library_index_path()
        if not path.is_file():
            return _default_document()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise MaterialLibraryError(f"Material library index is unreadable: {exc}") from exc
        if not isinstance(data, dict):
            raise MaterialLibraryError("Material library index has invalid root data.")
        items = data.get("items")
        if not isinstance(items, list):
            raise MaterialLibraryError("Material library index has invalid items data.")
        result = {"schema_version": SCHEMA_VERSION, "items": items}
        result["categories"] = _ensure_categories_document(data)
        return result

    def _save_unlocked(self, data: dict[str, Any]) -> None:
        self.ensure_dirs()
        path = library_index_path()
        temp = path.with_suffix(".json.tmp")
        payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
        temp.write_text(payload, encoding="utf-8")
        os.replace(temp, path)

    @staticmethod
    def _public_item(item: dict[str, Any]) -> dict[str, Any]:
        return dict(item)

    def list_categories(self, *, kind: str | None = None) -> dict[str, list[str]] | list[str]:
        with self._lock:
            data = self._load_unlocked()
            categories = _ensure_categories_document(data)
            if kind:
                normalized_kind = _normalize_kind(kind)
                return list(categories[normalized_kind])
            return {name: list(values) for name, values in categories.items()}

    def create_category(self, *, kind: Any, name: Any) -> list[str]:
        normalized_kind = _normalize_kind(kind)
        category_name = _normalize_category_name(name)
        with self._lock:
            data = self._load_unlocked()
            categories = _ensure_categories_document(data)
            current = categories[normalized_kind]
            if category_name in current:
                raise MaterialLibraryError("Category already exists.")
            current.append(category_name)
            self._save_unlocked(data)
            return list(current)

    def rename_category(self, *, kind: Any, old_name: Any, name: Any) -> list[str]:
        normalized_kind = _normalize_kind(kind)
        source = _normalize_category_name(old_name)
        target = _normalize_category_name(name)
        with self._lock:
            data = self._load_unlocked()
            categories = _ensure_categories_document(data)
            current = categories[normalized_kind]
            if source not in current:
                raise MaterialLibraryError("Category not found.")
            if source != target and target in current:
                raise MaterialLibraryError("Category already exists.")
            index = current.index(source)
            current[index] = target
            for item in data["items"]:
                if isinstance(item, dict) and item.get("type") == normalized_kind and item.get("category") == source:
                    item["category"] = target
                    item["updated_at"] = _now_ms()
            self._save_unlocked(data)
            return list(current)

    def list_items(self, *, kind: str | None = None, category: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            data = self._load_unlocked()
            normalized_kind = _normalize_kind(kind) if kind else None
            normalized_category = _normalize_category(data, normalized_kind, category) if category and normalized_kind else str(category or "").strip()
            needle = str(query or "").strip().casefold()
            out: list[dict[str, Any]] = []
            for raw in data["items"]:
                if not isinstance(raw, dict):
                    continue
                if normalized_kind and raw.get("type") != normalized_kind:
                    continue
                if normalized_category and raw.get("category") != normalized_category:
                    continue
                if needle:
                    haystack = f"{raw.get('title', '')}\n{raw.get('content', '')}".casefold()
                    if needle not in haystack:
                        continue
                out.append(self._public_item(raw))
            out.sort(key=lambda item: (-int(item.get("updated_at") or 0), str(item.get("title") or "")))
            return out

    def get_item(self, item_id: str) -> dict[str, Any]:
        identity = str(item_id or "").strip()
        with self._lock:
            data = self._load_unlocked()
            for item in data["items"]:
                if isinstance(item, dict) and str(item.get("id")) == identity:
                    return self._public_item(item)
        raise MaterialLibraryError("Material not found.")

    def create_prompt(self, *, title: Any, category: Any, content: Any) -> dict[str, Any]:
        kind = "prompt"
        with self._lock:
            data = self._load_unlocked()
            cat = _normalize_category(data, kind, category)
            text = str(content or "")
            now = _now_ms()
            item = {
                "id": f"mat_{uuid.uuid4().hex}",
                "type": kind,
                "category": cat,
                "title": _normalize_title(title, "未命名 Prompt"),
                "content": text,
                "created_at": now,
                "updated_at": now,
            }
            data["items"].append(item)
            self._save_unlocked(data)
        return self._public_item(item)

    def create_media_from_temp(self, temp_path: str | Path, *, kind: Any, category: Any, title: Any, filename: str, mime_type: str | None = None) -> dict[str, Any]:
        normalized_kind = _normalize_kind(kind)
        if normalized_kind == "prompt":
            raise MaterialLibraryError("Prompt items do not accept media files.")
        ext = _safe_extension(filename, normalized_kind)
        source = Path(temp_path)
        if not source.is_file():
            raise MaterialLibraryError("Uploaded material file is missing.")
        self.ensure_dirs()
        identity = f"mat_{uuid.uuid4().hex}"
        destination = _resolve_under(library_files_root(), library_files_root() / f"{identity}{ext}")
        now = _now_ms()
        original_name = Path(str(filename or f"material{ext}")).name
        with self._lock:
            data = self._load_unlocked()
            cat = _normalize_category(data, normalized_kind, category)
            item = {
                "id": identity,
                "type": normalized_kind,
                "category": cat,
                "title": _normalize_title(title, Path(original_name).stem or "未命名素材"),
                "relative_file": destination.relative_to(library_root().resolve()).as_posix(),
                "original_name": original_name,
                "mime_type": str(mime_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"),
                "size": int(source.stat().st_size),
                "created_at": now,
                "updated_at": now,
            }
            try:
                os.replace(source, destination)
            except OSError:
                shutil.copy2(source, destination)
                source.unlink(missing_ok=True)
            data["items"].append(item)
            try:
                self._save_unlocked(data)
            except Exception:
                destination.unlink(missing_ok=True)
                raise
        return self._public_item(item)

    def update_item(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        identity = str(item_id or "").strip()
        if not isinstance(patch, dict):
            raise MaterialLibraryError("Invalid material update.")
        with self._lock:
            data = self._load_unlocked()
            found: dict[str, Any] | None = None
            for item in data["items"]:
                if isinstance(item, dict) and str(item.get("id")) == identity:
                    found = item
                    break
            if found is None:
                raise MaterialLibraryError("Material not found.")
            kind = _normalize_kind(found.get("type"))
            if "title" in patch:
                found["title"] = _normalize_title(patch.get("title"), found.get("title") or "未命名素材")
            if "category" in patch:
                found["category"] = _normalize_category(data, kind, patch.get("category"))
            if "content" in patch:
                if kind != "prompt":
                    raise MaterialLibraryError("Only Prompt items have editable content.")
                found["content"] = str(patch.get("content") or "")
            found["updated_at"] = _now_ms()
            self._save_unlocked(data)
            return self._public_item(found)

    def delete_item(self, item_id: str) -> dict[str, Any]:
        identity = str(item_id or "").strip()
        with self._lock:
            data = self._load_unlocked()
            index = next((i for i, item in enumerate(data["items"]) if isinstance(item, dict) and str(item.get("id")) == identity), -1)
            if index < 0:
                raise MaterialLibraryError("Material not found.")
            item = data["items"].pop(index)
            relative = str(item.get("relative_file") or "").strip()
            if relative:
                media_path = _resolve_under(library_root(), library_root() / relative)
                media_path.unlink(missing_ok=True)
            self._save_unlocked(data)
            return self._public_item(item)

    def content_path(self, item_id: str) -> Path:
        item = self.get_item(item_id)
        if item.get("type") == "prompt":
            raise MaterialLibraryError("Prompt items do not have media content.")
        relative = str(item.get("relative_file") or "").strip()
        if not relative:
            raise MaterialLibraryError("Material file is missing.")
        path = _resolve_under(library_root(), library_root() / relative)
        if not path.is_file():
            raise MaterialLibraryError("Material file is missing.")
        return path

    def materialize(self, item_id: str) -> dict[str, Any]:
        item = self.get_item(item_id)
        if item.get("type") == "prompt":
            raise MaterialLibraryError("Prompt items cannot be materialized as files.")
        source = self.content_path(item_id)
        input_root = Path(folder_paths.get_input_directory())
        destination_dir = _resolve_under(input_root, input_root / _INPUT_SUBDIR)
        destination_dir.mkdir(parents=True, exist_ok=True)
        ext = source.suffix.lower()
        destination = _resolve_under(destination_dir, destination_dir / f"{item['id']}{ext}")
        if not destination.is_file() or destination.stat().st_size != source.stat().st_size:
            temp = destination.with_suffix(destination.suffix + ".tmp")
            shutil.copy2(source, temp)
            os.replace(temp, destination)
        return {
            "name": destination.name,
            "filename": destination.name,
            "subfolder": _INPUT_SUBDIR,
            "type": "input",
            "relative_path": f"{_INPUT_SUBDIR}/{destination.name}",
            "library_item": self._public_item(item),
        }


STORE = MaterialLibraryStore()


__all__ = [
    "ALLOWED_EXTENSIONS",
    "DEFAULT_CATEGORIES",
    "MaterialLibraryError",
    "MaterialLibraryStore",
    "SCHEMA_VERSION",
    "STORE",
    "library_root",
    "library_upload_root",
]
