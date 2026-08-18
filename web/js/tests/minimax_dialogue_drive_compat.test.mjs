import assert from "node:assert/strict";
import test from "node:test";
import { clearStaleDialogueDriveAsset, dialogueDriveScopeKey, ensureDialogueDriveState, getDialogueDriveAsset, setDialogueDriveAsset } from "../minimax_dialogue_drive_core.mjs";

test("legacy Dialogue Drive API remains compatible", () => {
  const timeline = {};
  setDialogueDriveAsset(timeline, "unused", "global-audio", { global: true });
  setDialogueDriveAsset(timeline, "seg-a", "local-audio");
  assert.equal(getDialogueDriveAsset(timeline, "unused", { global: true }), "global-audio");
  assert.equal(getDialogueDriveAsset(timeline, "seg-a"), "local-audio");
  assert.equal(ensureDialogueDriveState(timeline).version, 1);
  const key = dialogueDriveScopeKey({id:"seg-42"}, 3);
  setDialogueDriveAsset(timeline, key, "audio-1");
  assert.equal(clearStaleDialogueDriveAsset(timeline, key, ["audio-2"]), true);
  assert.equal(getDialogueDriveAsset(timeline, key), "");
});

test("legacy snake_case state migrates", () => {
  const timeline = {dialogueDrive:{global_asset_id:"g",segment_asset_ids:{s1:"a1"}}};
  const state=ensureDialogueDriveState(timeline);
  assert.equal(state.globalAssetId,"g");
  assert.equal(state.segmentAssetIds.s1,"a1");
});
