import assert from "node:assert/strict";
import {faceRefineVisibility,globalRefineSummary,globalRefineVisibility,normalizePostprocessConfig,setGlobalUpscaleEnabled} from "../minimax_postprocess_ui.mjs";

let cfg=normalizePostprocessConfig({global_refine:{enabled:true,mode:"refine",seed_mode:"inherit",resolution_mode:"follow_director",upscale_method:"lanczos"}});
assert.equal(cfg.version,4);
assert.deepEqual(globalRefineVisibility(cfg),{upscaleEnabled:false,seedOffset:false,upscaleModel:false,vsr:false,aspectMegapixels:false,customSize:false});
assert.match(globalRefineSummary(cfg,1376,768,"zh"),/保持原 Seed/);
cfg=setGlobalUpscaleEnabled(cfg,true); cfg.global_refine.upscale_method="nvidia_rtx_vsr"; cfg.global_refine.vsr_quality="high"; cfg.global_refine.resolution_mode="aspect_megapixels";
assert.equal("vsr_source" in cfg.global_refine,false);
assert.match(globalRefineSummary(cfg,1376,768,"zh"),/RTX VSR High/);

const face=normalizePostprocessConfig({face_refine:{enabled:true,detector:"ultralytics",canvas_mode:"manual",mask_mode:"sam",identity_track:true,fallback_detector:"person_yolov8m-seg.pt"}});
assert.deepEqual(faceRefineVisibility(face),{detectorModel:true,manualCanvas:true,sam:true,identity:true,fallback:true});
assert.equal(face.face_refine.smooth_window,21); assert.equal(face.face_refine.size_smooth_window,51);
assert.equal(face.face_refine.base_denoise,0.45); assert.equal(face.face_refine.feather,24);
const migrated=normalizePostprocessConfig({version:3,face_refine:{smooth_window:9,size_smooth_window:13,base_denoise:0.22,feather:0.12}});
assert.equal(migrated.face_refine.smooth_window,21); assert.equal(migrated.face_refine.size_smooth_window,51);
assert.equal(migrated.face_refine.base_denoise,0.45); assert.equal(migrated.face_refine.feather,24);
console.log("postprocess UI state tests passed");
