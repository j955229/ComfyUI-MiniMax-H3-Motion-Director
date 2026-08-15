import test from "node:test";
import assert from "node:assert/strict";
import {
  desiredAssetSockets,
  desiredDirectorInputSockets,
  directorGroupCount,
  resolveDirectorTaskKey,
  timelineGroupHasInternalMedia,
  timelineGroupHasInternalPrompt,
} from "../../web/js/minimax_director_inputs_core.mjs";

test("task key resolves the six Director video modes", () => {
  assert.equal(resolveDirectorTaskKey("t2v — 文生视频"), "t2v");
  assert.equal(resolveDirectorTaskKey("RV2V"), "rv2v");
  assert.equal(resolveDirectorTaskKey("unknown"), "t2v");
});

test("Director Inputs sockets are one-based and mode-specific", () => {
  assert.deepEqual(desiredDirectorInputSockets("t2v", 2), [
    { name: "text_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "text_prompt_2", kind: "prompt", group: 2, type: "STRING" },
  ]);

  assert.deepEqual(desiredDirectorInputSockets("i2v", 2), [
    { name: "image_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "image_1", kind: "image", group: 1, type: "IMAGE" },
    { name: "image_prompt_2", kind: "prompt", group: 2, type: "STRING" },
    { name: "image_2", kind: "image", group: 2, type: "IMAGE" },
  ]);

  assert.deepEqual(desiredDirectorInputSockets("fl2v", 1), [
    { name: "fl_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "fl_assets_1", kind: "assets", group: 1, type: "MMX_MOTION_DIR_ASSETS" },
  ]);

  assert.deepEqual(desiredDirectorInputSockets("r2v", 1), [
    { name: "ref_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "ref_assets_1", kind: "assets", group: 1, type: "MMX_MOTION_DIR_ASSETS" },
  ]);
});

test("Assets node profile is dynamic instead of fixed 9/3/3", () => {
  assert.deepEqual(desiredAssetSockets("fl2v"), [
    { name: "first_image", type: "IMAGE" },
    { name: "last_image", type: "IMAGE" },
  ]);

  assert.equal(desiredAssetSockets("r2v").length, 15);
  assert.deepEqual(desiredAssetSockets("r2v").slice(0, 2), [
    { name: "image_1", type: "IMAGE" },
    { name: "image_2", type: "IMAGE" },
  ]);
  assert.deepEqual(desiredAssetSockets("r2v").slice(-3), [
    { name: "audio_1", type: "AUDIO" },
    { name: "audio_2", type: "AUDIO" },
    { name: "audio_3", type: "AUDIO" },
  ]);

  assert.equal(desiredAssetSockets("rv2v").some((item) => item.name.startsWith("video_")), false);
  assert.deepEqual(desiredAssetSockets("i2v"), []);
  assert.deepEqual(desiredAssetSockets("t2v"), []);
});

test("group count follows shots for fl2v and segments otherwise", () => {
  assert.equal(directorGroupCount({ segments: [{}, {}, {}] }, "r2v"), 3);
  assert.equal(directorGroupCount({ segments: [{}], shots: [{}, {}] }, "fl2v"), 2);
  assert.equal(directorGroupCount({}, "t2v"), 1);
});

test("whole-group internal media is detected", () => {
  const timeline = {
    segments: [
      { prompt: "one" },
      { refs: [{ imageFile: "inside.png" }] },
      { refAudios: [{ audioFile: "voice.wav" }] },
    ],
  };
  assert.equal(timelineGroupHasInternalMedia(timeline, 1, "r2v"), false);
  assert.equal(timelineGroupHasInternalMedia(timeline, 2, "r2v"), true);
  assert.equal(timelineGroupHasInternalMedia(timeline, 3, "r2v"), true);
});

test("prompt ownership is detected separately from media ownership", () => {
  const timeline = {
    segments: [
      { prompt: "inside prompt" },
      { prompt: "" },
    ],
    shots: [
      { prompt: "fl prompt" },
      { prompt: "" },
    ],
  };
  assert.equal(timelineGroupHasInternalPrompt(timeline, 1, "r2v"), true);
  assert.equal(timelineGroupHasInternalPrompt(timeline, 2, "r2v"), false);
  assert.equal(timelineGroupHasInternalPrompt(timeline, 1, "fl2v"), true);
  assert.equal(timelineGroupHasInternalPrompt(timeline, 2, "fl2v"), false);
});

test("v2v remains prompt-only while rv2v gets reference assets", () => {
  assert.deepEqual(desiredDirectorInputSockets("v2v", 1), [
    { name: "video_prompt_1", kind: "prompt", group: 1, type: "STRING" },
  ]);
  assert.deepEqual(desiredDirectorInputSockets("rv2v", 1), [
    { name: "rv_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "rv_assets_1", kind: "assets", group: 1, type: "MMX_MOTION_DIR_ASSETS" },
  ]);
});
