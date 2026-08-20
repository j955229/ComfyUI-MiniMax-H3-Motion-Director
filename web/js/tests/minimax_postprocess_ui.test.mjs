import assert from "node:assert/strict";
import fs from "node:fs";
import {faceRefineVisibility,globalRefineSummary,globalRefineVisibility,normalizePostprocessConfig,setGlobalUpscaleEnabled} from "../minimax_postprocess_ui.mjs";

let cfg=normalizePostprocessConfig({global_refine:{enabled:true,mode:"refine",seed_mode:"inherit",resolution_mode:"follow_director",upscale_method:"lanczos"}});
assert.equal(cfg.version,9);
assert.deepEqual(globalRefineVisibility(cfg),{secondSampling:true,upscaleEnabled:false,seedOffset:false,upscaleModel:false,learnedLatent:false,vsr:false,aspectMegapixels:false,customSize:false});
assert.match(globalRefineSummary(cfg,1376,768,"zh"),/保持原 Seed/);
cfg=setGlobalUpscaleEnabled(cfg,true); cfg.global_refine.upscale_method="nvidia_rtx_vsr"; cfg.global_refine.vsr_quality="high"; cfg.global_refine.resolution_mode="aspect_megapixels";
assert.equal("vsr_source" in cfg.global_refine,false);
assert.match(globalRefineSummary(cfg,1376,768,"zh"),/RTX VSR High/);

const latent=normalizePostprocessConfig({global_refine:{enabled:true,mode:"upscale",upscale_method:"h3_learned_latent",latent_upscale_model:"h3.safetensors",latent_upscale_variant:"3D",latent_upscale_precision:"BF16",latent_upscale_device:"CPU"}});
assert.equal(latent.global_refine.upscale_method,"h3_learned_latent");
assert.equal(latent.global_refine.latent_upscale_model,"h3.safetensors");
assert.equal("latent_upscale_variant" in latent.global_refine,false);
assert.equal(latent.global_refine.latent_upscale_precision,"bf16");
assert.equal(latent.global_refine.latent_upscale_device,"cpu");
assert.equal(globalRefineVisibility(latent).learnedLatent,true);
assert.match(globalRefineSummary(latent,1376,768,"zh"),/H3 Learned Latent →/);
assert.doesNotMatch(globalRefineSummary(latent,1376,768,"zh"),/\b2D\b|\b3D\b/);

const uiSource=fs.readFileSync(new URL("../minimax_postprocess_ui.mjs",import.meta.url),"utf8");
assert.doesNotMatch(uiSource,/Requires the separately installed LBH|需要另外安装 LBH/);
assert.match(uiSource,/No separate LBH custom node is required/);
assert.match(uiSource,/无需另装 LBH 自定义节点/);
assert.match(uiSource,/architecture is detected from the weights/);
assert.match(uiSource,/架构会直接从权重自动识别/);
assert.doesNotMatch(uiSource,/field\("Latent Variant",\s*"global_refine\.latent_upscale_variant"/);
assert.doesNotMatch(uiSource,/2D \+ Temporal \(recommended\)|2D \+ Temporal（推荐）/);
assert.match(uiSource,/field\("Face Detector Model",\s*"face_refine\.detector_model"/);

const face=normalizePostprocessConfig({face_refine:{enabled:true,detector:"ultralytics",canvas_mode:"manual",mask_mode:"sam",identity_track:true,fallback_detector:"person_yolov8m-seg.pt"}});
assert.deepEqual(faceRefineVisibility(face),{detectorModel:true,manualCanvas:true,sam:true,identity:true,fallback:true});
assert.equal(face.face_refine.smooth_window,21); assert.equal(face.face_refine.size_smooth_window,51);
assert.equal(face.face_refine.base_denoise,0.45); assert.equal(face.face_refine.feather,24);
const migrated=normalizePostprocessConfig({version:3,face_refine:{smooth_window:9,size_smooth_window:13,base_denoise:0.22,feather:0.12}});
assert.equal(migrated.face_refine.smooth_window,21); assert.equal(migrated.face_refine.size_smooth_window,51);
assert.equal(migrated.face_refine.base_denoise,0.45); assert.equal(migrated.face_refine.feather,24);
console.log("postprocess UI state tests passed");
