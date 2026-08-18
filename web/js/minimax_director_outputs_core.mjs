export const DIRECTOR_PUBLIC_OUTPUTS = Object.freeze([
    "images",
    "audio",
    "fps",
]);

const PUBLIC_OUTPUT_SET = new Set(DIRECTOR_PUBLIC_OUTPUTS);

export function staleDirectorOutputIndices(outputs = []) {
    const stale = [];
    for (let index = 0; index < outputs.length; index += 1) {
        const name = String(outputs[index]?.name || "");
        if (!PUBLIC_OUTPUT_SET.has(name)) stale.push(index);
    }
    return stale.sort((a, b) => b - a);
}

export function reportResizeMaxHeight(containerBottom, reportTop, padding = 12) {
    const bottom = Number(containerBottom);
    const top = Number(reportTop);
    const safePadding = Math.max(0, Number(padding) || 0);
    if (!Number.isFinite(bottom) || !Number.isFinite(top)) return 0;
    return Math.max(0, Math.floor(bottom - top - safePadding));
}

export async function copyReportText(text, writeText) {
    const value = String(text || "");
    if (!value) return false;
    if (typeof writeText !== "function") return false;
    await writeText(value);
    return true;
}

export function refinePassOptions(passCount) {
    const count = Math.max(0, Math.trunc(Number(passCount) || 0));
    if (count <= 0) return [{ value: "final", label: "Final" }];
    const rows = [{ value: "first", label: "First Pass" }];
    for (let index = 1; index <= count; index += 1) {
        rows.push({ value: `pass:${index}`, label: `Pass ${index}` });
    }
    rows.push({ value: "final", label: "Final" });
    return rows;
}
