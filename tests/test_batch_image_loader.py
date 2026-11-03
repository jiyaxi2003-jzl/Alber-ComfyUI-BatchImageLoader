"""离线验证 BatchImageLoader 的后端逻辑（mock 掉 torch / ComfyUI 的 server 模块）。"""

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types

import numpy as np
from PIL import Image

# 仓库根目录就是节点包目录
PKG_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TMP_ROOT = tempfile.mkdtemp(prefix="bil_test_")
INPUT_DIR = os.path.join(_TMP_ROOT, "inputs")
WORK_DIR = os.path.join(_TMP_ROOT, "work")

# ---------------- mock torch ----------------
torch = types.ModuleType("torch")


class _Tensor:
    def __init__(self, arr):
        self.arr = arr

    @property
    def shape(self):
        return self.arr.shape


torch.Tensor = _Tensor
torch.from_numpy = lambda a: _Tensor(a)
torch.stack = lambda tensors, dim=0: _Tensor(np.stack([t.arr for t in tensors], axis=dim))
sys.modules["torch"] = torch

# ---------------- mock folder_paths ----------------
folder_paths = types.ModuleType("folder_paths")
folder_paths.get_input_directory = lambda: INPUT_DIR
sys.modules["folder_paths"] = folder_paths

# ---------------- mock server ----------------
server_mod = types.ModuleType("server")


class _PromptServer:
    instance = None


server_mod.PromptServer = _PromptServer
sys.modules["server"] = server_mod

# ---------------- 加载包 ----------------
spec = importlib.util.spec_from_file_location(
    "bil_pkg", os.path.join(PKG_DIR, "__init__.py"),
    submodule_search_locations=[PKG_DIR],
)
pkg = importlib.util.module_from_spec(spec)
sys.modules["bil_pkg"] = pkg
spec.loader.exec_module(pkg)

from bil_pkg import api as bil_api          # noqa: E402
from bil_pkg import utils as bil_utils      # noqa: E402
from bil_pkg.nodes import BatchImageLoader  # noqa: E402

for d in (INPUT_DIR, WORK_DIR):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)

# 命名故意用 1/2/10 检验自然排序；尺寸故意不同
sizes = {
    "img1.png": (320, 240),
    "img2.png": (320, 240),
    "img3.png": (200, 100),
    "img10.png": (320, 240),
    "b.png": (64, 64),
    "A.JPG": (100, 300),
    "note.txt": None,
}
for name, size in sizes.items():
    path = os.path.join(WORK_DIR, name)
    if size is None:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("not an image")
        continue
    color = (int(name[0].encode()[0]) % 255, 90, 40)
    Image.new("RGB", size, color).save(path)

# 加一张带透明通道的
Image.new("RGBA", (50, 50), (10, 20, 30, 128)).save(os.path.join(WORK_DIR, "alpha.png"))

print("\n=== 1. list_images: filename / ascending ===")
root, entries = bil_utils.list_images(WORK_DIR, "filename", "ascending")
names = [e["name"] for e in entries]
print(names)
assert names == ["A.JPG", "alpha.png", "b.png", "img1.png", "img2.png", "img3.png", "img10.png"], names
assert "note.txt" not in names

print("\n=== 2. list_images: size / descending ===")
_, entries = bil_utils.list_images(WORK_DIR, "size", "descending")
print([(e["name"], e["size"]) for e in entries])
sizes_sorted = [e["size"] for e in entries]
assert sizes_sorted == sorted(sizes_sorted, reverse=True)

print("\n=== 3. list_images: created_time / ascending ===")
_, entries = bil_utils.list_images(WORK_DIR, "created_time", "ascending")
print([e["name"] for e in entries])
assert len(entries) == 7

print("\n=== 4. 相对路径（相对 input 目录） ===")
rel_root, rel_entries = bil_utils.list_images(os.path.join("..", "work"), "filename", "ascending")
assert rel_root == WORK_DIR, rel_root
print("ok:", rel_root, len(rel_entries), "张")

node = BatchImageLoader()

print("\n=== 4.5 节点注册信息（ALBER- 前缀） ===")
from bil_pkg.nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS  # noqa: E402

assert "ALBER-BatchImageLoader" in NODE_CLASS_MAPPINGS, list(NODE_CLASS_MAPPINGS)
display = NODE_DISPLAY_NAME_MAPPINGS["ALBER-BatchImageLoader"]
assert display.startswith("ALBER-"), display
assert BatchImageLoader.CATEGORY == "ALBER/batch", BatchImageLoader.CATEGORY
assert BatchImageLoader.DESCRIPTION.startswith("ALBER-"), BatchImageLoader.DESCRIPTION
print("ok:", list(NODE_CLASS_MAPPINGS), "|", display, "|", BatchImageLoader.CATEGORY)

print("\n=== 5. load_images: batch + first_image ===")
image, count, filenames = node.load_images(
    folder=WORK_DIR, sort_by="filename", order="ascending", start_index=1,
    mode="batch", index=0, max_images=0, resize_mode="first_image", files_json="",
)
print("shape:", image.shape, "count:", count)
print(filenames.split("\n"))
assert count == 7
assert image.arr.shape == (7, 300, 100, 3), image.arr.shape   # A.JPG 是 100x300，第一张
assert image.arr.dtype == np.float32 and image.arr.max() <= 1.0

print("\n=== 6. load_images: batch + largest_image ===")
image, count, _ = node.load_images(
    folder=WORK_DIR, sort_by="filename", order="ascending", start_index=1,
    mode="batch", index=0, max_images=0, resize_mode="largest_image", files_json="",
)
print("shape:", image.shape)
assert image.arr.shape == (7, 300, 320, 3), image.arr.shape
assert np.isfinite(image.arr).all()

print("\n=== 7. load_images: single + index ===")
image, count, filenames = node.load_images(
    folder=WORK_DIR, sort_by="filename", order="ascending", start_index=1,
    mode="single", index=3, max_images=0, resize_mode="first_image", files_json="",
)
print("shape:", image.shape, "->", filenames)
assert image.arr.shape == (1, 240, 320, 3)   # index=3 -> img1.png (320x240)
assert filenames == "img1.png"

print("\n=== 8. load_images: files_json 指定子集与顺序 ===")
subset = json.dumps({"files": ["img10.png", "b.png"]})
image, count, filenames = node.load_images(
    folder=WORK_DIR, sort_by="filename", order="ascending", start_index=1,
    mode="batch", index=0, max_images=0, resize_mode="first_image", files_json=subset,
)
print("count:", count, "->", filenames.split("\n"))
assert count == 2 and filenames.split("\n") == ["img10.png", "b.png"]

print("\n=== 9. load_images: max_images ===")
image, count, _ = node.load_images(
    folder=WORK_DIR, sort_by="filename", order="ascending", start_index=1,
    mode="batch", index=0, max_images=3, resize_mode="first_image", files_json="",
)
assert count == 3, count

print("\n=== 10. load_images: 空目录报错 ===")
try:
    node.load_images(folder=os.path.join(WORK_DIR, "nope"), sort_by="filename",
                     order="ascending", start_index=1, mode="batch", index=0,
                     max_images=0, resize_mode="first_image", files_json="")
    raise AssertionError("应当抛出异常")
except (RuntimeError, FileNotFoundError) as exc:
    print("ok:", exc)


# ---------------- API 测试 ----------------
class FakeRequest:
    def __init__(self, query=None, payload=None):
        self.query = query or {}
        self._payload = payload

    async def json(self):
        return self._payload


async def api_tests():
    print("\n=== 11. /list ===")
    resp = await bil_api.list_handler(FakeRequest({"folder": WORK_DIR, "sort_by": "filename"}))
    data = json.loads(resp.body)
    print(data["folder"], len(data["files"]))
    assert len(data["files"]) == 7

    print("\n=== 12. /browse ===")
    resp = await bil_api.browse_handler(FakeRequest({"path": WORK_DIR}))
    data = json.loads(resp.body)
    print(data["path"], data["image_count"], data["parent"])
    assert data["image_count"] == 7 and data["dirs"] == []

    print("\n=== 13. /rename 正常 + 起始序号 ===")
    resp = await bil_api.rename_handler(FakeRequest(payload={
        "folder": WORK_DIR,
        "files": ["A.JPG", "alpha.png", "b.png"],
        "pattern": "shot_{i:03d}",
        "start": 5,
    }))
    data = json.loads(resp.body)
    print(data)
    assert "renamed" in data, data
    assert sorted(os.listdir(WORK_DIR)) == sorted(
        ["shot_005.JPG", "shot_006.png", "shot_007.png", "img1.png", "img2.png",
         "img3.png", "img10.png", "note.txt"]
    ), sorted(os.listdir(WORK_DIR))

    print("\n=== 14. /rename 冲突检测 ===")
    resp = await bil_api.rename_handler(FakeRequest(payload={
        "folder": WORK_DIR,
        "files": ["img1.png", "img2.png"],
        "pattern": "same",
        "start": 1,
    }))
    data = json.loads(resp.body)
    print("ok:", data.get("error"))
    assert "error" in data

    print("\n=== 15. /rename 目标已存在 ===")
    resp = await bil_api.rename_handler(FakeRequest(payload={
        "folder": WORK_DIR,
        "files": ["img1.png"],
        "pattern": "img2",
        "start": 1,
    }))
    data = json.loads(resp.body)
    print("ok:", data.get("error"))
    assert "error" in data

    print("\n=== 16. /rename 唯一模板变量 {name} ===")
    resp = await bil_api.rename_handler(FakeRequest(payload={
        "folder": WORK_DIR,
        "files": ["img1.png", "img2.png"],
        "pattern": "{name}_v2",
        "start": 1,
    }))
    data = json.loads(resp.body)
    print(data)
    assert os.path.exists(os.path.join(WORK_DIR, "img1_v2.png"))
    assert os.path.exists(os.path.join(WORK_DIR, "img2_v2.png"))

    print("\n=== 17. 目录外文件被拒绝 ===")
    resp = await bil_api.rename_handler(FakeRequest(payload={
        "folder": WORK_DIR,
        "files": [os.path.join(INPUT_DIR, "x.png")],
        "pattern": "y_{i}",
        "start": 1,
    }))
    data = json.loads(resp.body)
    print("ok:", data.get("error"))
    assert "error" in data


asyncio.run(api_tests())
shutil.rmtree(_TMP_ROOT, ignore_errors=True)
print("\n*** 全部测试通过 ***")
