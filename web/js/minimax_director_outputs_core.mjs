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
