"""Batch Image Loader - 共用工具函数（扫描 / 排序 / 路径解析）。"""

import os
import re

# 支持读取的图片扩展名（PIL 能解码的常见格式）
IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp",
    ".gif", ".tif", ".tiff", ".avif", ".heic", ".heif",
}

# 下拉列表可选的排序方式
SORT_OPTIONS = ["filename", "created_time", "modified_time", "size"]
ORDER_OPTIONS = ["ascending", "descending"]

_NUM_RE = re.compile(r"(\d+)")


def is_image_file(path: str) -> bool:
    """根据扩展名判断是否为图片。"""
    return os.path.splitext(path)[1].lower() in IMAGE_EXTENSIONS


def get_input_dir() -> str:
    """ComfyUI 的 input 目录；脱离 ComfyUI 运行时退化为当前目录。"""
    try:
        import folder_paths

        return folder_paths.get_input_directory()
    except Exception:
        return os.getcwd()


def resolve_folder(folder: str) -> str:
    """
    把用户输入的文件夹解析成绝对路径：
      - 空字符串 -> ComfyUI input 目录
      - 相对路径 -> 相对 input 目录
      - 支持 ~ 与环境变量、去除首尾引号
    """
    folder = (folder or "").strip()
    if len(folder) >= 2 and folder[0] == folder[-1] and folder[0] in "\"'":
        folder = folder[1:-1].strip()
    if folder:
        folder = os.path.expanduser(os.path.expandvars(folder))
    if not folder:
        return os.path.abspath(get_input_dir())
    if not os.path.isabs(folder):
        folder = os.path.join(get_input_dir(), folder)
    return os.path.abspath(folder)


def natural_key(text: str):
    """
    自然排序 key：img2.png 排在 img10.png 前面。
    每段返回统一的 (kind, number, text) 三元组，避免 int 与 str 比较报错。
    """
    key = []
    for i, part in enumerate(_NUM_RE.split(text)):
        if i % 2 == 1:
            key.append((0, int(part), ""))
        else:
            key.append((1, 0, part.lower()))
    return key


_SORT_KEYS = {
    "filename": lambda e: natural_key(e["name"]),
    "created_time": lambda e: e["ctime"],
    "modified_time": lambda e: e["mtime"],
    "size": lambda e: e["size"],
}


def list_images(folder: str, sort_by: str = "filename", order: str = "ascending",
                recursive: bool = False):
    """
    扫描文件夹中的图片，返回 (解析后的绝对路径, 文件信息列表)。
    每项包含: name / path / size / ctime / mtime / rel。
    """
    root = resolve_folder(folder)
    if not os.path.isdir(root):
        raise FileNotFoundError(f"文件夹不存在: {root}")

    entries = []

    def _add(path: str, name: str, rel: str):
        try:
            st = os.stat(path)
        except OSError:
            return
        entries.append({
            "name": name,
            "rel": rel,
            "path": path,
            "size": st.st_size,
            "ctime": st.st_ctime,
            "mtime": st.st_mtime,
        })

    if recursive:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in filenames:
                if not is_image_file(name):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, root).replace("\\", "/")
                _add(full, rel, rel)
    else:
        try:
            with os.scandir(root) as it:
                for entry in it:
                    if not entry.is_file():
                        continue
                    name = entry.name
                    if name.startswith(".__bil_tmp_") or not is_image_file(name):
                        continue
                    _add(os.path.join(root, name), name, name)
        except PermissionError as exc:
            raise PermissionError(f"无权限读取文件夹: {root} ({exc})")

    # 先按文件名做稳定次级排序，再按主排序键排序
    entries.sort(key=lambda e: natural_key(e["name"]))
    primary = _SORT_KEYS.get(sort_by, _SORT_KEYS["filename"])
    entries.sort(key=primary, reverse=(str(order).lower() == "descending"))

    return root, entries
