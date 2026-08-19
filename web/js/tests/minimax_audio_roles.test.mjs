import assert from "node:assert/strict";
import test from "node:test";
import * as roles from "../minimax_audio_roles_core.mjs";

test("audio role model exposes only normal reference and exact audio drive", () => {
    assert.equal(typeof roles.ensureAudioRoleState, "function");
    assert.equal("AUDIO_ROLE_DIALOGUE_DRIVE" in roles, false);
    assert.deepEqual([...roles.AUDIO_DRIVE_ROLES], ["audio_drive"]);
    const timeline = {};
    const scope = roles.audioRoleScopeKey({ id: "seg-42" }, 3);
    roles.setAudioRole(timeline, scope, "a1", { role: "audio_drive", sourceDuration: 5, timelineStart: 1 });
    roles.setAudioRole(timeline, scope, "a2", { role: "dialogue_drive", sourceDuration: 5, timelineStart: 5 });
    assert.equal(roles.getAudioRole(timeline, scope, "a1").role, "audio_drive");
    assert.equal(roles.getAudioRole(timeline, scope, "a2").role, "reference");
    assert.equal(roles.getAudioRole(timeline, scope, "a2").timelineStart, 0);
});

test("retired dialogue role state becomes normal reference while preserving editor trim", () => {
    const timeline = {
        dialogueDrive: { globalAssetId: "legacy" },
        audioRoles: { version: 1, global: {}, segments: { s1: {
            a1: { role: "dialogue_drive", sourceDuration: 8, trimStart: 1.25, trimEnd: 6.05, timelineStart: 5 },
        } } },
    };
    roles.ensureAudioRoleState(timeline);
    const cfg = roles.getAudioRole(timeline, "s1", "a1");
    assert.equal(cfg.role, "reference");
    assert.equal(cfg.trimStart, 1.25);
    assert.equal(cfg.trimEnd, 6.05);
    assert.equal(cfg.timelineStart, 0);
    assert.equal("dialogueDrive" in timeline, false);
    assert.equal(timeline.audioRoles.version, 2);
});

test("trim metadata and exact-drive placement follow effective duration", () => {
    const timeline = {};
    roles.setAudioRole(timeline, "s1", "a1", {
        role: "audio_drive", sourceDuration: 8, trimStart: 1.25, trimEnd: 6.05, timelineStart: 5,
    });
    const cfg = roles.getAudioRole(timeline, "s1", "a1");
    assert.equal(roles.effectiveAudioDuration(cfg), 4.8);
    assert.deepEqual(roles.audioPlacement(cfg, 15), {
        start: 5, end: 9.8, duration: 4.8, leftRatio: 1 / 3, widthRatio: 4.8 / 15, overrun: 0,
    });
});

test("drag changes only exact-drive timelineStart and clamps to segment bounds", () => {
    const cfg = { role: "audio_drive", sourceDuration: 4, trimStart: 0, trimEnd: 4, timelineStart: 1 };
    const moved = roles.moveAudioRole(cfg, 9, 10);
    assert.equal(moved.timelineStart, 6);
    assert.equal(moved.trimStart, 0);
    assert.equal(moved.trimEnd, 4);
});

test("exact drive intervals may touch but may not overlap", () => {
    const ok = roles.validateAudioRoleIntervals([
        { assetId: "a", role: "audio_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 0 },
        { assetId: "b", role: "audio_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 5 },
    ], 10);
    assert.deepEqual(ok.errors, []);
    const bad = roles.validateAudioRoleIntervals([
        { assetId: "a", role: "audio_drive", sourceDuration: 6, trimStart: 0, trimEnd: 6, timelineStart: 0 },
        { assetId: "b", role: "audio_drive", sourceDuration: 5, trimStart: 0, trimEnd: 5, timelineStart: 5 },
    ], 10);
    assert.equal(bad.errors[0].code, "drive_overlap");
});

test("stale role entries are removed without touching valid assets", () => {
    const timeline = {};
    roles.setAudioRole(timeline, "s1", "keep", { role: "audio_drive", sourceDuration: 3 });
    roles.setAudioRole(timeline, "s1", "drop", { role: "reference", sourceDuration: 3, trimStart: 1, trimEnd: 2 });
    assert.equal(roles.clearStaleAudioRoles(timeline, "s1", ["keep"]), true);
    assert.equal(roles.getAudioRole(timeline, "s1", "keep").role, "audio_drive");
    assert.equal(roles.getAudioRole(timeline, "s1", "drop").sourceDuration, 0);
});

import { readFileSync } from "node:fs";
const uiSource = readFileSync(new URL("../zz_minimax_audio_drive_ui.js", import.meta.url), "utf8");

test("audio UI exposes only Normal reference and Original Audio Drive", () => {
    assert.equal(uiSource.includes("AUDIO_ROLE_DIALOGUE_DRIVE"), false);
    assert.equal(uiSource.includes("对白驱动"), false);
    assert.equal(uiSource.includes("Dialogue Drive"), false);
    assert.equal(uiSource.includes("minimax_audio_roles_core.mjs"), true);
    assert.equal(uiSource.includes("[AUDIO_ROLE_AUDIO_DRIVE, w.audioDrive]"), true);
});
