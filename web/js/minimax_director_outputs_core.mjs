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
