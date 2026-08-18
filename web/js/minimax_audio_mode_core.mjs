export const AUDIO_MODE_DRIVE = "drive";

function canonicalAudioMode(value) {
    const raw = String(value || "generate").trim().toLowerCase();
    if (raw === "source" || raw === "original" || raw === "passthrough") return "source";
    if (raw === "mute" || raw === "silent" || raw === "silence") return "mute";
    return "generate";
}

export function visibleAudioMode(output = {}) {
    if (output?.audioDrive === true || output?.audio_drive === true) return AUDIO_MODE_DRIVE;
    const raw = String(output?.audioMode ?? output?.audio_mode ?? "").trim().toLowerCase();
    if (["drive", "audio_drive", "source_drive", "driven"].includes(raw)) return AUDIO_MODE_DRIVE;
    return canonicalAudioMode(raw);
}

export function applyVisibleAudioMode(output = {}, value = "generate") {
    const mode = String(value || "generate").trim().toLowerCase();
    if (mode === AUDIO_MODE_DRIVE) {
        output.audioMode = "source";
        output.audioDrive = true;
        delete output.audio_drive;
        return output;
    }
    output.audioMode = canonicalAudioMode(mode);
    output.audioDrive = false;
    delete output.audio_drive;
    return output;
}
