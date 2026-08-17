# Algorithms adapted from Carasibana/ComfyUI-H3-FaceRefine commit 79a97ce.
# Copyright Carasibana. MIT License; see LICENSES/MIT-H3-FaceRefine.txt.

"""Face-region masks and sub-pixel stitching into the assembled result."""

from __future__ import annotations

from typing import Any

import numpy as np
import torch
import torch.nn.functional as F


def _gaussian_blur(mask: torch.Tensor, radius: int) -> torch.Tensor:
    radius = max(0, int(radius))
    if radius <= 0:
        return mask
    kernel_size = radius * 2 + 1
    sigma = max(0.5, kernel_size / 6)
    x = torch.arange(kernel_size, device=mask.device, dtype=torch.float32) - radius
    kernel = torch.exp(-(x * x) / (2 * sigma * sigma))
    kernel = (kernel / kernel.sum()).to(mask.dtype)
    work = F.conv2d(F.pad(mask, (radius, radius, 0, 0), mode="replicate"), kernel.view(1, 1, 1, -1))
    return F.conv2d(F.pad(work, (0, 0, radius, radius), mode="replicate"), kernel.view(1, 1, -1, 1))


def _canvas_feather_radius(transform: dict[str, Any], config: dict[str, Any], index: int) -> int:
    """Convert a final-frame/source-pixel feather width into canvas pixels."""
    feather=float(config.get("feather") or 0.0)
    if feather <= 0: return 0
    canvas_w,canvas_h=transform["canvas"]
    if config.get("feather_scales_with_crop"):
        return max(0,min(int(round(feather)),min(canvas_w,canvas_h)//3))
    crop_h=float(transform["boxes"][index][3])
    radius=int(round(feather*(canvas_h/max(crop_h,1.0))))
    return max(1,min(radius,canvas_h//3))


def build_rect_masks(transform: dict[str, Any], config: dict[str, Any], device, dtype) -> torch.Tensor:
    canvas_w,canvas_h=transform["canvas"]
    count=int(transform["frames"])
    result=torch.zeros((count,1,canvas_h,canvas_w),device=device,dtype=dtype)
    paste_region=config.get("paste_region") or "face_rect"
    mode=config.get("mask_mode") or "rect"
    dilation=float(config.get("mask_dilation") or 0.0)
    for index in range(count):
        mask=torch.zeros((1,1,canvas_h,canvas_w),device=device,dtype=torch.float32)
        if paste_region == "full_crop":
            mask.fill_(1.0)
        else:
            x,y,width,height=transform["face_rect"][index]
            x-=dilation; y-=dilation; width+=dilation*2; height+=dilation*2
            if mode == "ellipse":
                yy=torch.arange(canvas_h,device=device).view(-1,1)
                xx=torch.arange(canvas_w,device=device).view(1,-1)
                rx,ry=max(1.0,width/2),max(1.0,height/2)
                mask[0,0]=((((xx-(x+width/2))/rx)**2+((yy-(y+height/2))/ry)**2)<=1).float()
            else:
                x0,y0=max(0,round(x)),max(0,round(y))
                x1,y1=min(canvas_w,round(x+width)),min(canvas_h,round(y+height))
                if x1>x0 and y1>y0: mask[0,0,y0:y1,x0:x1]=1.0
        result[index:index+1]=_gaussian_blur(mask,_canvas_feather_radius(transform,config,index)).clamp(0,1).to(dtype)
    return result


def build_sam_masks(crops: torch.Tensor, transform: dict[str, Any], config: dict[str, Any]) -> torch.Tensor:
    """Build source-derived SAM masks only when explicitly selected."""
    model_name=str(config.get("sam_model") or "")
    if not model_name: raise ValueError("SAM mask mode was selected but no internal SAM model was selected.")
    import folder_paths
    try:
        from ultralytics import SAM
    except ImportError as exc:
        raise ImportError("SAM mask mode requires the optional ultralytics SAM dependency.") from exc
    path=None
    for category in ("sams","sam","ultralytics_segm"):
        path=getattr(folder_paths,"get_full_path",lambda *_:None)(category,model_name)
        if path: break
    if not path: raise FileNotFoundError(f"SAM model not found: {model_name}")
    model=SAM(path); masks=[]
    threshold=float(config.get("sam_threshold") or 0.93)
    for index,frame in enumerate(crops):
        rgb=(frame.detach().float().cpu().numpy()*255).clip(0,255).astype(np.uint8)
        x,y,width,height=transform["face_rect"][index]
        result=model.predict(rgb,bboxes=[[x,y,x+width,y+height]],verbose=False)[0]
        if result.masks is None or len(result.masks.data)<1:
            raise RuntimeError(f"SAM produced no face mask for frame {index+1}.")
        mask=result.masks.data[0].float()
        mask=F.interpolate(mask[None,None],size=frame.shape[:2],mode="bilinear",align_corners=False)[0,0]
        masks.append((mask>=threshold).float())
    stack=torch.stack(masks).to(device=crops.device,dtype=crops.dtype).unsqueeze(1)
    dilation=max(0,int(round(float(config.get("sam_dilation") or 0.0))))
    if dilation>0: stack=F.max_pool2d(stack,dilation*2+1,stride=1,padding=dilation)
    temporal=max(1,int(config.get("sam_temporal_smooth") or 5)|1)
    if temporal>1 and int(stack.shape[0])>1:
        radius=temporal//2
        work=stack.permute(2,3,1,0).reshape(-1,1,int(stack.shape[0]))
        work=F.avg_pool1d(F.pad(work,(radius,radius),mode="replicate"),temporal,stride=1)
        stack=work.reshape(stack.shape[2],stack.shape[3],1,stack.shape[0]).permute(3,2,0,1)
    out=torch.empty_like(stack)
    for index in range(int(stack.shape[0])):
        out[index:index+1]=_gaussian_blur(stack[index:index+1],_canvas_feather_radius(transform,config,index))
    return out.clamp(0,1)


def stitch_faces(
    base_images: torch.Tensor,
    refined_crops: torch.Tensor,
    transform: dict[str, Any],
    config: dict[str, Any],
    *,
    masks: torch.Tensor | None = None,
) -> torch.Tensor:
    count, source_h, source_w, _ = base_images.shape
    if int(refined_crops.shape[0]) != count or int(transform.get("frames", 0)) != count:
        raise ValueError("Face Stitch frame counts do not match the assembled result.")
    device, dtype = refined_crops.device, refined_crops.dtype
    if masks is None:
        masks = build_rect_masks(transform, config, device, dtype)
    result = base_images[..., :3].to(device=device, dtype=dtype).clone()
    yy, xx = torch.meshgrid(
        torch.arange(source_h, device=device, dtype=dtype),
        torch.arange(source_w, device=device, dtype=dtype),
        indexing="ij",
    )
    blend = float(config.get("blend") or 1.0)
    weights = transform.get("weights") or [1.0] * count
    for index in range(count):
        x, y, width, height = transform["boxes"][index]
        grid = torch.stack((((xx - x) / max(width, 1e-6)) * 2 - 1, ((yy - y) / max(height, 1e-6)) * 2 - 1), dim=-1).unsqueeze(0)
        crop = refined_crops[index].permute(2, 0, 1).unsqueeze(0)
        warped = F.grid_sample(crop, grid, mode="bilinear", padding_mode="zeros", align_corners=False)[0].permute(1, 2, 0)
        mask = F.grid_sample(masks[index:index + 1], grid, mode="bilinear", padding_mode="zeros", align_corners=False)[0, 0].clamp(0, 1)
        alpha = (mask * float(weights[index]) * blend).clamp(0, 1).unsqueeze(-1)
        if config.get("undetected_frames") == "skip" and not transform["detected"][index]:
            alpha.zero_()
        if config.get("colour_match") and float(alpha.sum()) > 1:
            weight = alpha / alpha.sum()
            base_mean = (result[index] * weight).sum(dim=(0, 1))
            crop_mean = (warped * weight).sum(dim=(0, 1))
            base_var = (((result[index] - base_mean) ** 2) * weight).sum(dim=(0, 1))
            crop_var = (((warped - crop_mean) ** 2) * weight).sum(dim=(0, 1))
            warped = (warped - crop_mean) * torch.sqrt((base_var + 1e-6) / (crop_var + 1e-6)) + base_mean
        result[index] = result[index] * (1 - alpha) + warped.clamp(0, 1) * alpha
    return result.clamp(0, 1)


__all__ = ["build_rect_masks", "build_sam_masks", "stitch_faces"]
