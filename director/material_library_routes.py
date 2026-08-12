# MiniMax H3 Motion Director — Material Library HTTP routes.
# Distributed under GNU GPL v3.0. See repository LICENSE.

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

import folder_paths
from aiohttp import web

from .material_library import MaterialLibraryError, STORE, library_upload_root

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.material-library")
_SAFE_UPLOAD_ID = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")
_CHUNK_SIZE = 1024 * 1024


def _json_error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": str(message)}, status=status)


def _route(routes, method: str, path: str, handler) -> None:
    if hasattr(routes, "add_route"):
        routes.add_route(method, path, handler)
    elif method == "POST" and hasattr(routes, "post"):
        routes.post(path)(handler)
    elif method == "GET" and hasattr(routes, "get"):
        routes.get(path)(handler)
    elif method == "PATCH" and hasattr(routes, "patch"):
        routes.patch(path)(handler)
    elif method == "DELETE" and hasattr(routes, "delete"):
        routes.delete(path)(handler)
    else:
        raise AttributeError("Unsupported ComfyUI route table API")


def _temp_upload_path(suffix: str = ".upload") -> Path:
    root = library_upload_root()
    root.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="incoming_", suffix=suffix, dir=root)
    os.close(fd)
    return Path(name)


async def _read_json(request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise MaterialLibraryError(f"Invalid JSON: {exc}") from exc
    if not isinstance(body, dict):
        raise MaterialLibraryError("JSON body must be an object.")
    return body


async def material_library_list(request):
    try:
        items = STORE.list_items(
            kind=request.query.get("type") or None,
            category=request.query.get("category") or None,
            query=request.query.get("q") or None,
        )
        return web.json_response({"items": items, "categories": STORE.list_categories()})
    except MaterialLibraryError as exc:
        return _json_error(str(exc))


async def material_library_create(request):
    temp_path: Path | None = None
    try:
        if request.content_type == "application/json":
            body = await _read_json(request)
            if str(body.get("type") or "").strip().lower() != "prompt":
                raise MaterialLibraryError("JSON creation is only for Prompt items.")
            item = STORE.create_prompt(
                title=body.get("title"),
                category=body.get("category"),
                content=body.get("content"),
            )
            return web.json_response({"item": item})

        reader = await request.multipart()
        fields: dict[str, str] = {}
        filename = ""
        mime_type = ""
        async for part in reader:
            if part.name == "file":
                filename = part.filename or "material.bin"
                mime_type = part.headers.get("Content-Type", "")
                temp_path = _temp_upload_path(Path(filename).suffix or ".upload")
                with temp_path.open("wb") as out:
                    while True:
                        chunk = await part.read_chunk(size=_CHUNK_SIZE)
                        if not chunk:
                            break
                        out.write(chunk)
            else:
                fields[str(part.name or "")] = (await part.text()).strip()
        if temp_path is None or not filename:
            raise MaterialLibraryError("Missing material file.")
        item = STORE.create_media_from_temp(
            temp_path,
            kind=fields.get("type"),
            category=fields.get("category"),
            title=fields.get("title"),
            filename=filename,
            mime_type=mime_type,
        )
        temp_path = None
        return web.json_response({"item": item})
    except MaterialLibraryError as exc:
        return _json_error(str(exc))
    except Exception as exc:
        log.exception("Material Library create failed")
        return _json_error(str(exc), 500)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


async def material_library_update(request):
    try:
        item = STORE.update_item(request.match_info.get("item_id", ""), await _read_json(request))
        return web.json_response({"item": item})
    except MaterialLibraryError as exc:
        return _json_error(str(exc), 404 if "not found" in str(exc).lower() else 400)


async def material_library_delete(request):
    try:
        item = STORE.delete_item(request.match_info.get("item_id", ""))
        return web.json_response({"deleted": item.get("id")})
    except MaterialLibraryError as exc:
        return _json_error(str(exc), 404 if "not found" in str(exc).lower() else 400)


async def material_library_content(request):
    try:
        item_id = request.match_info.get("item_id", "")
        item = STORE.get_item(item_id)
        path = STORE.content_path(item_id)
        response = web.FileResponse(path)
        response.headers["Content-Type"] = str(item.get("mime_type") or "application/octet-stream")
        response.headers["Cache-Control"] = "private, max-age=3600"
        return response
    except MaterialLibraryError as exc:
        return _json_error(str(exc), 404 if "not found" in str(exc).lower() or "missing" in str(exc).lower() else 400)


async def material_library_materialize(request):
    try:
        result = STORE.materialize(request.match_info.get("item_id", ""))
        return web.json_response(result)
    except MaterialLibraryError as exc:
        return _json_error(str(exc), 404 if "not found" in str(exc).lower() or "missing" in str(exc).lower() else 400)


async def material_library_upload_chunk(request):
    try:
        post = await request.post()
        upload_id = str(post.get("upload_id") or "").strip()
        if not _SAFE_UPLOAD_ID.match(upload_id):
            raise MaterialLibraryError("Invalid upload_id.")
        try:
            chunk_index = int(post.get("chunk_index", 0))
            total_chunks = int(post.get("total_chunks", 1))
        except (TypeError, ValueError) as exc:
            raise MaterialLibraryError("Invalid chunk index.") from exc
        if total_chunks < 1 or chunk_index < 0 or chunk_index >= total_chunks:
            raise MaterialLibraryError("Chunk index out of range.")
        chunk_field = post.get("chunk")
        if chunk_field is None:
            raise MaterialLibraryError("Missing chunk.")
        chunk_root = Path(folder_paths.get_temp_directory()) / "minimax_material_library_chunks" / upload_id
        chunk_root.mkdir(parents=True, exist_ok=True)
        part_path = chunk_root / f"{chunk_index:06d}.part"
        with part_path.open("wb") as out:
            while True:
                data = chunk_field.file.read(_CHUNK_SIZE)
                if not data:
                    break
                out.write(data)
        if chunk_index + 1 < total_chunks:
            return web.json_response({"status": "ok", "chunk_index": chunk_index})

        filename = str(post.get("filename") or "material.bin")
        suffix = Path(filename).suffix or ".upload"
        assembled = _temp_upload_path(suffix)
        try:
            with assembled.open("wb") as out:
                for index in range(total_chunks):
                    current = chunk_root / f"{index:06d}.part"
                    if not current.is_file():
                        raise MaterialLibraryError(f"Missing chunk {index}.")
                    with current.open("rb") as src:
                        shutil.copyfileobj(src, out)
            item = STORE.create_media_from_temp(
                assembled,
                kind=post.get("type"),
                category=post.get("category"),
                title=post.get("title"),
                filename=filename,
                mime_type=str(post.get("mime_type") or ""),
            )
            assembled = None
        finally:
            if assembled is not None:
                assembled.unlink(missing_ok=True)
            shutil.rmtree(chunk_root, ignore_errors=True)
        return web.json_response({"item": item})
    except MaterialLibraryError as exc:
        return _json_error(str(exc))
    except Exception as exc:
        log.exception("Material Library chunk upload failed")
        return _json_error(str(exc), 500)


async def material_library_category_create(request):
    try:
        body = await _read_json(request)
        categories = STORE.create_category(kind=body.get("type"), name=body.get("name"))
        return web.json_response({"categories": categories})
    except MaterialLibraryError as exc:
        return _json_error(str(exc), 400)


async def material_library_category_rename(request):
    try:
        body = await _read_json(request)
        categories = STORE.rename_category(kind=body.get("type"), old_name=body.get("old_name"), name=body.get("name"))
        return web.json_response({"categories": categories})
    except MaterialLibraryError as exc:
        message = str(exc)
        return _json_error(message, 404 if "not found" in message.lower() else 400)


def register_material_library_routes(routes) -> None:
    base = "/minimax/motion-director/material-library"
    _route(routes, "GET", base, material_library_list)
    _route(routes, "POST", base, material_library_create)
    _route(routes, "PATCH", base + "/{item_id}", material_library_update)
    _route(routes, "POST", base + "/categories", material_library_category_create)
    _route(routes, "PATCH", base + "/categories", material_library_category_rename)
    _route(routes, "DELETE", base + "/{item_id}", material_library_delete)
    _route(routes, "GET", base + "/{item_id}/content", material_library_content)
    _route(routes, "POST", base + "/{item_id}/materialize", material_library_materialize)
    _route(routes, "POST", base + "/upload_chunk", material_library_upload_chunk)


__all__ = ["register_material_library_routes"]
