"""Batch Image Loader - 节点定义。"""

import json
import os

import numpy as np
import torch
from PIL import Image, ImageFile, ImageOps

from .utils import is_image_file, list_images, resolve_folder

ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

RESIZE_MODES = ["first_image", "largest_image", "none"]


# --------------------------------------------------------------------------- #
# 图片处理
# --------------------------------------------------------------------------- #
def _pil_to_rgb(im: Image.Image) -> Image.Image:
    """统一转 RGB：处理 EXIF 方向、透明通道（合成为黑底）。"""
    im = ImageOps.exif_transpose(im)
    if im.mode == "RGB":
        return im
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        background = Image.new("RGB", im.size, (0, 0, 0))
        background.paste(im, mask=im.split()[-1])
        return background
    return im.convert("RGB")


def _resize(im: Image.Image, width: int, height: int) -> Image.Image:
    if im.size == (width, height):
        return im
    return im.resize((width, height), Image.LANCZOS)


def _to_tensor(im: Image.Image) -> torch.Tensor:
    array = np.array(im, dtype=np.float32) / 255.0
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=-1)
    return torch.from_numpy(array)


# --------------------------------------------------------------------------- #
# 节点
# --------------------------------------------------------------------------- #
class BatchImageLoader:
    """从文件夹批量读取图片，按 UI 中选定的顺序输出为一个 IMAGE batch。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "图片文件夹。留空 = ComfyUI 的 input 目录；相对路径 = 相对 input 目录。",
                }),
                "sort_by": (["filename", "created_time", "modified_time", "size"], {
                    "default": "filename",
                    "tooltip": "排序方式：文件名（自然序）/ 创建时间 / 修改时间 / 文件大小",
                }),
                "order": (["ascending", "descending"], {
                    "default": "ascending",
                    "tooltip": "升序或降序",
                }),
                "start_index": ("INT", {
                    "default": 1, "min": 0, "max": 999999, "step": 1,
                    "tooltip": "列表左侧序号的起始值，也会作为批量改名的起始序号",
                }),
                "mode": (["batch", "single"], {
                    "default": "batch",
                    "tooltip": "batch = 全部图片合成一个 batch；single = 只输出 index 指定的那一张",
                }),
                "index": ("INT", {
                    "default": 0, "min": 0, "max": 99999, "step": 1,
                    "tooltip": "single 模式下取列表中的第几张（从 0 开始）",
                }),
                "max_images": ("INT", {
                    "default": 0, "min": 0, "max": 100000, "step": 1,
                    "tooltip": "最多读取多少张，0 = 不限制",
                }),
                "resize_mode": (RESIZE_MODES, {
                    "default": "first_image",
                    "tooltip": "尺寸不一致时的处理：对齐第一张 / 对齐最大尺寸 / 不处理（不一致会报错）",
                }),
                # 前端维护：当前列表中的文件名（有序）。由 JS 自动写入，界面上被隐藏。
                "files_json": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("image", "count", "filenames")
    FUNCTION = "load_images"
    CATEGORY = "ALBER/batch"
    DESCRIPTION = "ALBER-批量加载文件夹中的图片，顺序 / 起始序号可在节点界面里调整。"

    # ------------------------------------------------------------------ #
    def _collect_paths(self, folder, sort_by, order, files_json):
        """优先使用前端传回的文件列表，保证与界面显示顺序完全一致。"""
        root = resolve_folder(folder)
        names = []
        if files_json and files_json.strip():
            try:
                data = json.loads(files_json)
            except Exception:
                data = None
            if isinstance(data, dict):
                saved_folder = str(data.get("folder") or "")
                names = [str(x) for x in (data.get("files") or [])]
                # 前端保存的列表所属的文件夹已经变了，这份列表就作废
                if saved_folder and os.path.normcase(os.path.abspath(saved_folder)) != os.path.normcase(root):
                    names = []
            elif isinstance(data, list):
                names = [str(x) for x in data]

        paths = []
        for name in names:
            path = name if os.path.isabs(name) else os.path.join(root, name)
            if os.path.isfile(path) and is_image_file(path):
                paths.append(os.path.abspath(path))
        if paths:
            return paths

        _, entries = list_images(folder, sort_by, order)
        return [entry["path"] for entry in entries]

    # ------------------------------------------------------------------ #
    def load_images(self, folder, sort_by, order, start_index, mode, index,
                    max_images, resize_mode, files_json=""):
        paths = self._collect_paths(folder, sort_by, order, files_json)

        if not paths:
            raise RuntimeError(
                f"没有找到图片。文件夹: {resolve_folder(folder)} —— "
                "请检查路径是否正确，或在节点上点击「选择文件夹」。"
            )

        if str(mode).startswith("single"):
            position = max(0, min(int(index), len(paths) - 1))
            paths = [paths[position]]
            if position != int(index):
                print(f"[ALBER] index={index} 超出范围，已修正为 {position}")
        elif max_images and max_images > 0:
            paths = paths[:max_images]

        images = []
        loaded_paths = []
        for path in paths:
            try:
                with Image.open(path) as im:
                    images.append(_pil_to_rgb(im))
                loaded_paths.append(path)
            except Exception as exc:
                print(f"[ALBER] 跳过无法读取的图片 {path}: {exc}")

        if not images:
            raise RuntimeError("列表中的图片全部读取失败，请检查文件是否损坏。")

        if resize_mode == "first_image":
            width, height = images[0].size
            images = [_resize(im, width, height) for im in images]
        elif resize_mode == "largest_image":
            width = max(im.width for im in images)
            height = max(im.height for im in images)
            images = [_resize(im, width, height) for im in images]
        else:
            sizes = {im.size for im in images}
            if len(sizes) > 1:
                raise RuntimeError(
                    f"图片尺寸不一致 {sorted(sizes)}，请把 resize_mode 改为 first_image 或 largest_image。"
                )

        tensor = torch.stack([_to_tensor(im) for im in images], dim=0)
        names = [os.path.basename(p) for p in loaded_paths]

        print(f"[ALBER] 已加载 {len(names)} 张图片 -> {tensor.shape}")
        return (tensor, len(names), "\n".join(names))


NODE_CLASS_MAPPINGS = {"ALBER-BatchImageLoader": BatchImageLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ALBER-BatchImageLoader": "ALBER-批量图片加载器 (Batch Image Loader)"
}
