// MiniMax H3 Motion Director — Material Library HTTP client.

import { api } from "../../scripts/api.js";

const BASE = "/minimax/motion-director/material-library";
const CHUNK_BYTES = 8 * 1024 * 1024;
const CHUNK_THRESHOLD = 80 * 1024 * 1024;

async function responseError(resp) {
    try {
        const data = await resp.json();
        return data?.error || data?.message || `HTTP ${resp.status}`;
    } catch {
        try { return (await resp.text()) || `HTTP ${resp.status}`; }
        catch { return `HTTP ${resp.status}`; }
    }
}

async function checked(resp) {
    if (!resp.ok) throw new Error(await responseError(resp));
    return resp.json();
}

function makeUploadId() {
    if (globalThis.crypto?.randomUUID) return `ml_${crypto.randomUUID()}`;
    return `ml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function libraryApiUrl(path) {
    if (typeof api.apiURL === "function") return api.apiURL(path);
    return path;
}

export async function listMaterialLibrary({ type = "", category = "", query = "" } = {}) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    const suffix = params.size ? `?${params.toString()}` : "";
    const data = await checked(await api.fetchApi(`${BASE}${suffix}`));
    return {
        items: Array.isArray(data?.items) ? data.items : [],
        categories: data?.categories && typeof data.categories === "object" ? data.categories : {},
    };
}

export async function createPromptMaterial({ title, category, content }) {
    const data = await checked(await api.fetchApi(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "prompt", title, category, content }),
    }));
    return data.item;
}

async function uploadSmallMedia(file, { type, category, title }) {
    const body = new FormData();
    body.append("type", type);
    body.append("category", category);
    body.append("title", title || file.name);
    body.append("file", file, file.name);
    const data = await checked(await api.fetchApi(BASE, { method: "POST", body }));
    return data.item;
}

async function uploadChunkedMedia(file, { type, category, title, onProgress }) {
    const uploadId = makeUploadId();
    const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    let last = null;
    for (let index = 0; index < total; index += 1) {
        const start = index * CHUNK_BYTES;
        const end = Math.min(file.size, start + CHUNK_BYTES);
        const body = new FormData();
        body.append("upload_id", uploadId);
        body.append("filename", file.name);
        body.append("mime_type", file.type || "application/octet-stream");
        body.append("type", type);
        body.append("category", category);
        body.append("title", title || file.name);
        body.append("chunk_index", String(index));
        body.append("total_chunks", String(total));
        body.append("chunk", file.slice(start, end), `${file.name}.${index}.part`);
        last = await checked(await api.fetchApi(`${BASE}/upload_chunk`, { method: "POST", body }));
        onProgress?.((index + 1) / total, index + 1, total);
    }
    return last?.item;
}

export async function uploadMediaMaterial(file, options) {
    if (!(file instanceof Blob)) throw new Error("Invalid media file.");
    if (file.size > CHUNK_THRESHOLD) return uploadChunkedMedia(file, options);
    return uploadSmallMedia(file, options);
}

export async function updateMaterial(itemId, patch) {
    const data = await checked(await api.fetchApi(`${BASE}/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch || {}),
    }));
    return data.item;
}

export async function deleteMaterial(itemId) {
    return checked(await api.fetchApi(`${BASE}/${encodeURIComponent(itemId)}`, { method: "DELETE" }));
}

export async function materializeMaterial(itemId) {
    return checked(await api.fetchApi(`${BASE}/${encodeURIComponent(itemId)}/materialize`, { method: "POST" }));
}

export function materialContentUrl(item) {
    const stamp = encodeURIComponent(String(item?.updated_at || item?.id || ""));
    return libraryApiUrl(`${BASE}/${encodeURIComponent(item?.id || "")}/content?v=${stamp}`);
}

export async function fetchMaterialAsFile(item) {
    const resp = await fetch(materialContentUrl(item), { credentials: "same-origin" });
    if (!resp.ok) throw new Error(await responseError(resp));
    const blob = await resp.blob();
    const fallback = `${item?.title || "material"}${extensionFromName(item?.original_name || "")}`;
    const name = item?.original_name || fallback || "material.bin";
    return new File([blob], name, { type: item?.mime_type || blob.type || "application/octet-stream" });
}

function extensionFromName(name) {
    const match = String(name || "").match(/(\.[A-Za-z0-9]{1,10})$/);
    return match?.[1] || "";
}

export function inputRelativePath(materialized) {
    if (materialized?.relative_path) return String(materialized.relative_path).replace(/\\/g, "/");
    const name = materialized?.name || materialized?.filename || "";
    const sub = String(materialized?.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return sub ? `${sub}/${name}` : name;
}

export async function createMaterialCategory({ type, name }) {
    const data = await checked(await api.fetchApi(`${BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name }),
    }));
    return Array.isArray(data?.categories) ? data.categories : [];
}

export async function renameMaterialCategory({ type, oldName, name }) {
    const data = await checked(await api.fetchApi(`${BASE}/categories`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, old_name: oldName, name }),
    }));
    return Array.isArray(data?.categories) ? data.categories : [];
}
