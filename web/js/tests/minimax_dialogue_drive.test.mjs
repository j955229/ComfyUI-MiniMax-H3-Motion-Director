import assert from "node:assert/strict";
import test from "node:test";
import * as roles from "../minimax_dialogue_drive_core.mjs";

test("audio roles expose three per-asset roles and stable scope storage", () => {
    assert.equal(typeof roles.ensureAudioRoleState, "function");
    const timeline = {};
    const scope = roles.audioRoleScopeKey({ id: "seg-42" }, 3);
    assert.equal(scope, "seg-42");
    roles.setAudioRole(timeline, scope, "a1", { role: "audio_drive", sourceDuration: 5, timelineStart: 0 });
    roles.setAudioRole(timeline, scope, "a2", { role: "dialogue_drive", sourceDuration: 5, timelineStart: 5 });
    assert.equal(roles.getAudioRole(timeline, scope, "a1").role, "audio_drive");
    assert.equal(roles.getAudioRole(timeline, scope, "a2").role, "dialogue_drive");
    assert.equal(roles.getAudioRole(timeline, scope, "missing").role, "reference");
});

test("legacy one-audio Dialogue Drive migrates into audioRoles", () => {
    const timeline = {
        dialogueDrive: { global_asset_id: "g", segment_asset_ids: { s1: "a1" } },
    };
    roles.ensureAudioRoleState(timeline);
    assert.equal(roles.getAudioRole(timeline, "ignored", "g", { global: true }).role, "dialogue_drive");
    assert.equal(roles.getAudioRole(timeline, "s1", "a1").role, "dialogue_drive");
});

test("trim is non-destructive metadata and placement width follows effective duration", () => {
    const timeline = {};
    roles.setAudioRole(timeline, "s1", "a1", {
        role: "dialogue_drive",
        sourceDuration: 8,
        trimStart: 1.25,
        trimEnd: 6.05,
        timelineStart: 5,
    });
    const cfg = roles.getAudioRole(timeline, "s1", "a1");
    assert.equal(roles.effectiveAudioDuration(cfg), 4.8);
    assert.deepEqual(roles.audioPlacement(cfg, 15), {
        start: 5,
        end: 9.8,
        duration: 4.8,
        leftRatio: 1 / 3,
        widthRatio: 4.8 / 15,
        overrun: 0,
    });
});

test("drag changes only timelineStart and clamps to segment bounds", () => {
    const cfg = { role: "audio_drive", sourceDuration: 4, trimStart: 0, trimEnd: 4, timelineStart: 1 };
    const moved = roles.moveAudioRole(cfg, 9, 10);
    assert.equal(moved.timelineStart, 6);
    assert.equal(moved.trimStart, 0);
    assert.equal(moved.trimEnd, 4);
});

test("drive intervals may sequence but active drive intervals may not overlap", () => {
    const ok = roles.validateAudioRoleIntervals([
        { assetId: "a", role: "dialogue_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 0 },
        { assetId: "b", role: "audio_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 5 },
    ], 10);
    assert.deepEqual(ok.errors, []);

    const bad = roles.validateAudioRoleIntervals([
        { assetId: "a", role: "dialogue_drive", sourceDuration: 6, trimStart: 0, trimEnd: 6, timelineStart: 0 },
        { assetId: "b", role: "audio_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 5 },
    ], 10);
    assert.equal(bad.errors[0].code, "drive_overlap");
});

test("stale role entries are removed without touching valid assets", () => {
    const timeline = {};
    roles.setAudioRole(timeline, "s1", "keep", { role: "audio_drive", sourceDuration: 3 });
    roles.setAudioRole(timeline, "s1", "drop", { role: "dialogue_drive", sourceDuration: 3 });
    assert.equal(roles.clearStaleAudioRoles(timeline, "s1", ["keep"]), true);
    assert.equal(roles.getAudioRole(timeline, "s1", "keep").role, "audio_drive");
    assert.equal(roles.getAudioRole(timeline, "s1", "drop").role, "reference");
});

test("discovering source duration initializes an unknown full-range trim", () => {
    const timeline = { dialogueDrive: { segmentAssetIds: { s1: "a1" } } };
    roles.ensureAudioRoleState(timeline);
    roles.setAudioRole(timeline, "s1", "a1", { sourceDuration: 7.42 });
    const cfg = roles.getAudioRole(timeline, "s1", "a1");
    assert.equal(cfg.trimStart, 0);
    assert.equal(cfg.trimEnd, 7.42);
    assert.equal(roles.effectiveAudioDuration(cfg), 7.42);
});
