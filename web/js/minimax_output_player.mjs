export function frameIndexAtTime(seconds, fps, frameCount) {
    const count = Math.max(0, Math.floor(Number(frameCount) || 0));
    if (!count) return 0;
    const rate = Math.max(0.001, Number(fps) || 24);
    const index = Math.floor(Math.max(0, Number(seconds) || 0) * rate);
    return Math.max(0, Math.min(count - 1, index));
}

function hasAudioSource(audio) {
    return !!String(audio?.currentSrc || audio?.src || "").trim();
}

/** One clock for the visible frame sequence. Audio is authoritative when present. */
export class ResultPlaybackController {
    constructor({
        audio,
        getFps,
        getFrameCount,
        onFrame,
        onPlaying = () => {},
        now = () => performance.now(),
        requestFrame = (callback) => requestAnimationFrame(callback),
        cancelFrame = (id) => cancelAnimationFrame(id),
    }) {
        this.audio = audio;
        this.getFps = getFps;
        this.getFrameCount = getFrameCount;
        this.onFrame = onFrame;
        this.onPlaying = onPlaying;
        this.now = now;
        this.requestFrame = requestFrame;
        this.cancelFrame = cancelFrame;
        this.playing = false;
        this.rafId = null;
        this.anchorMs = 0;
        this.anchorSeconds = 0;
        this.index = 0;
        this.tick = this.tick.bind(this);
    }

    fps() { return Math.max(0.001, Number(this.getFps?.()) || 24); }
    frameCount() { return Math.max(0, Math.floor(Number(this.getFrameCount?.()) || 0)); }
    hasAudio() { return hasAudioSource(this.audio); }

    seek(index) {
        const count = this.frameCount();
        this.index = count ? Math.max(0, Math.min(count - 1, Math.round(Number(index) || 0))) : 0;
        const seconds = this.index / this.fps();
        if (this.hasAudio()) this.audio.currentTime = seconds;
        this.anchorSeconds = seconds;
        this.anchorMs = this.now();
        this.onFrame(this.index);
        return this.index;
    }

    play(index = this.index) {
        if (this.frameCount() < 2) return false;
        this.cancelLoop();
        this.seek(index);
        this.playing = true;
        this.onPlaying(true);
        if (this.hasAudio()) {
            const promise = this.audio.play?.();
            promise?.catch?.(() => {});
        }
        this.rafId = this.requestFrame(this.tick);
        return true;
    }

    clockSeconds() {
        if (this.hasAudio()) return Math.max(0, Number(this.audio.currentTime) || 0);
        return this.anchorSeconds + Math.max(0, this.now() - this.anchorMs) / 1000;
    }

    tick() {
        if (!this.playing) return;
        const count = this.frameCount();
        if (!count) { this.pause(); return; }
        const seconds = this.clockSeconds();
        const rawIndex = Math.floor(seconds * this.fps());
        this.index = frameIndexAtTime(seconds, this.fps(), count);
        this.onFrame(this.index);
        if (this.audio?.ended || rawIndex >= count) {
            this.pause();
            return;
        }
        this.rafId = this.requestFrame(this.tick);
    }

    cancelLoop() {
        if (this.rafId != null) this.cancelFrame(this.rafId);
        this.rafId = null;
    }

    pause() {
        const wasPlaying = this.playing;
        this.playing = false;
        this.cancelLoop();
        this.audio?.pause?.();
        if (wasPlaying) this.onPlaying(false);
    }

    stop() { this.pause(); }
    destroy() { this.pause(); }
}
