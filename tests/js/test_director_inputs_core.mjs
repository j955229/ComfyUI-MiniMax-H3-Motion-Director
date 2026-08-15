import test from "node:test";
import assert from "node:assert/strict";
import {
  desiredDirectorInputSockets,
  directorGroupCount,
  resolveDirectorTaskKey,
  timelineGroupHasInternalMedia,
} from "../../web/js/minimax_director_inputs_core.mjs";

test("task key resolves the six Director video modes", () => {
  assert.equal(resolveDirectorTaskKey("t2v — 文生视频"), "t2v");
  assert.equal(resolveDirectorTaskKey("RV2V"), "rv2v");
  assert.equal(resolveDirectorTaskKey("unknown"), "t2v");
});

test("desired sockets are one-based and Director-count controlled", () => {
  assert.deepEqual(desiredDirectorInputSockets("t2v", 3), [
    { name: "text_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "text_prompt_2", kind: "prompt", group: 2, type: "STRING" },
    { name: "text_prompt_3", kind: "prompt", group: 3, type: "STRING" },
  ]);

  assert.deepEqual(desiredDirectorInputSockets("r2v", 2), [
    { name: "ref_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "ref_assets_1", kind: "assets", group: 1, type: "MMX_MOTION_DIR_ASSETS" },
    { name: "ref_prompt_2", kind: "prompt", group: 2, type: "STRING" },
    { name: "ref_assets_2", kind: "assets", group: 2, type: "MMX_MOTION_DIR_ASSETS" },
  ]);
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

test("v2v remains prompt-only while rv2v gets one assets bundle per group", () => {
  assert.deepEqual(desiredDirectorInputSockets("v2v", 1), [
    { name: "video_prompt_1", kind: "prompt", group: 1, type: "STRING" },
  ]);
  assert.deepEqual(desiredDirectorInputSockets("rv2v", 1), [
    { name: "rv_prompt_1", kind: "prompt", group: 1, type: "STRING" },
    { name: "rv_assets_1", kind: "assets", group: 1, type: "MMX_MOTION_DIR_ASSETS" },
  ]);
});

test("Director common reference media blocks external assets for the group", () => {
  const timeline = {
    segments: [{ prompt: "one" }],
    r2vCommon: { refVideos: [{ videoFile: "common.mp4" }] },
  };
  assert.equal(timelineGroupHasInternalMedia(timeline, 1, "r2v"), true);
});
