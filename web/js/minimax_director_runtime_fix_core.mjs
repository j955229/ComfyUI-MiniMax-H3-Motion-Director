export const GENERATED_AUDIO_CONTINUITY_TASKS = Object.freeze([
    "t2v",
    "i2v",
    "r2v",
    "fl2v",
]);

const GENERATED_AUDIO_CONTINUITY_SET = new Set(
    GENERATED_AUDIO_CONTINUITY_TASKS,
);

export function generatedAudioContinuationShouldBeInteractive(
    taskKey,
    groupCount,
) {
    const task = String(taskKey || "")
        .trim()
        .toLowerCase();

    const count = Math.max(
        0,
        Math.trunc(Number(groupCount) || 0),
    );

    return (
        count > 1
        && GENERATED_AUDIO_CONTINUITY_SET.has(task)
    );
}
