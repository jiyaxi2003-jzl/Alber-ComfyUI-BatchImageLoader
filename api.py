"""Batch Image Loader - 后端 HTTP 接口。

提供：
  GET  /batch_image_loader/list    列出文件夹中的图片（含排序）
  GET  /batch_image_loader/browse  目录浏览器（选择文件夹）
  GET  /batch_image_loader/view    原图
  GET  /batch_image_loader/thumb   缩略图（带缓存）
  POST /batch_image_loader/rename  批量重命名
"""

import asyncio
import io
import os
import re
import uuid
from functools import lru_cache

from PIL import Image, ImageOps

from .utils import is_image_file, list_images, resolve_folder

try:
    from aiohttp import web
except Exception:  # pragma: no cover
    web = None

try:
    from server import PromptServer
except Exception:  # pragma: no cover
    PromptServer = None

_registered = False

_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_TEMPLATE_TOKEN = re.compile(r"\{(i|index0|n|name|ext)(?::0?(\d+)d)?\}")


# --------------------------------------------------------------------------- #
# 通用小工具
# --------------------------------------------------------------------------- #
def _error(message: str, status: int = 400):
    return web.json_response({"error": message}, status=status)


def _render_pattern(pattern: str, index: int, stem: str, ext: str) -> str:
    """把模板中的占位符替换成真实值。支持 {i} {i:03d} {index0} {n} {name} {ext}。"""

    def repl(match: "re.Match"):
        token, pad = match.group(1), match.group(2)
        if token in ("i", "n"):
            value = index
        elif token == "index0":
            value = index - 1
        elif token == "name":
            value = stem
        else:
            value = ext
        if pad and isinstance(value, int):
            return str(value).zfill(int(pad))
        return str(value)

    return _TEMPLATE_TOKEN.sub(repl, pattern)


def _sanitize(name: str) -> str:
    name = _BAD_CHARS.sub("_", name).strip()
    return name.rstrip(" .")


def _windows_drives():
    if os.name != "nt":
        return []
    import string

    drives = []
    for letter in string.ascii_uppercase:
        root = f"{letter}:\\"
        if os.path.exists(root):
            drives.append({"name": root, "path": root})
    return drives


@lru_cache(maxsize=4096)
def _thumb_bytes(path: str, mtime: float, size: int) -> bytes:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        im.thumbnail((size, size), Image.LANCZOS)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
        elif im.mode != "RGB":
            im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()


# --------------------------------------------------------------------------- #
# 路由处理
# --------------------------------------------------------------------------- #
async def list_handler(request):
    folder = request.query.get("folder", "")
    sort_by = request.query.get("sort_by", "filename")
    order = request.query.get("order", "ascending")
    recursive = request.query.get("recursive", "0") in ("1", "true", "True")
    try:
        root, entries = list_images(folder, sort_by, order, recursive)
    except Exception as exc:
        return _error(f"{exc}")
    return web.json_response({"folder": root, "files": entries})


async def browse_handler(request):
    raw = request.query.get("path", "")
    try:
        path = resolve_folder(raw)
    except Exception as exc:
        return _error(str(exc))

    if not os.path.isdir(path):
        parent = os.path.dirname(path)
        if parent and os.path.isdir(parent):
            path = parent
        else:
            return _error(f"目录不存在: {path}")

    dirs = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_dir() and not entry.name.startswith("."):
                        dirs.append({"name": entry.name, "path": os.path.abspath(entry.path)})
                except OSError:
                    continue
    except PermissionError:
        return _error(f"无权限访问: {path}")

    dirs.sort(key=lambda d: d["name"].lower())

    image_count = 0
    try:
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_file() and is_image_file(entry.name):
                        image_count += 1
                except OSError:
                    continue
    except PermissionError:
        pass

    parent = os.path.dirname(path)
    if parent == path:
        parent = None

    return web.json_response({
        "path": path,
        "parent": parent,
        "dirs": dirs,
        "image_count": image_count,
        "drives": _windows_drives() if parent is None else [],
    })


async def view_handler(request):
    raw = request.query.get("path", "")
    path = os.path.abspath(raw) if raw else ""
    if not path or not os.path.isfile(path) or not is_image_file(path):
        raise web.HTTPNotFound()
    response = web.FileResponse(path)
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response


async def thumb_handler(request):
    raw = request.query.get("path", "")
    path = os.path.abspath(raw) if raw else ""
    if not path or not os.path.isfile(path) or not is_image_file(path):
        raise web.HTTPNotFound()

    try:
        size = int(request.query.get("size", 96) or 96)
    except ValueError:
        size = 96
    size = max(24, min(size, 512))

    try:
        mtime = os.path.getmtime(path)
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, _thumb_bytes, path, mtime, size)
    except Exception:
        raise web.HTTPNotFound()

    return web.Response(
        body=data,
        content_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


async def rename_handler(request):
    try:
        payload = await request.json()
    except Exception:
        return _error("无效的请求数据")

    folder = resolve_folder(payload.get("folder", ""))
    names = payload.get("files") or []
    pattern = str(payload.get("pattern") or "").strip()
    try:
        start = int(payload.get("start", 1))
    except (TypeError, ValueError):
        start = 1

    if not os.path.isdir(folder):
        return _error(f"文件夹不存在: {folder}")
    if not names:
        return _error("没有要重命名的文件")
    if not pattern:
        return _error("重命名模板不能为空")

    plan = []          # [(src, target)]
    used_names = set()
    for name in names:
        src = name if os.path.isabs(str(name)) else os.path.join(folder, str(name))
        src = os.path.abspath(src)
        if os.path.normcase(os.path.dirname(src)) != os.path.normcase(folder):
            return _error(f"文件不在当前文件夹内，已跳过以策安全: {name}")
        if not os.path.isfile(src):
            continue

        stem, ext = os.path.splitext(os.path.basename(src))
        index = start + len(plan)
        new_name = _sanitize(_render_pattern(pattern, index, stem, ext.lstrip(".")))
        if not new_name:
            return _error("模板生成的文件名为空")
        # 模板里没写扩展名时自动补上原扩展名
        if not os.path.splitext(new_name)[1] and ext:
            new_name += ext

        key = new_name.lower()
        if key in used_names:
            return _error(f"模板产生了重复文件名: {new_name}（请检查是否包含 {{i}} 序号）")
        used_names.add(key)

        target = os.path.join(folder, new_name)
        if os.path.exists(target) and os.path.normcase(target) != os.path.normcase(src):
            return _error(f"目标文件已存在: {new_name}")
        plan.append((src, target))

    if not plan:
        return _error("没有可重命名的文件")

    # 两阶段重命名：先全部改成临时名，避免 A->B / B->A 互相覆盖
    moved = []
    try:
        for src, target in plan:
            if os.path.normcase(src) == os.path.normcase(target):
                moved.append((src, None, target))
                continue
            tmp = os.path.join(folder, f".__bil_tmp_{uuid.uuid4().hex}{os.path.splitext(src)[1]}")
            os.rename(src, tmp)
            moved.append((src, tmp, target))
        for src, tmp, target in moved:
            if tmp is not None:
                os.rename(tmp, target)
    except Exception as exc:
        # 尽力回滚
        for src, tmp, target in moved:
            try:
                if tmp is None:
                    continue
                if os.path.exists(tmp):
                    os.rename(tmp, src)
                elif os.path.exists(target) and not os.path.exists(src):
                    os.rename(target, src)
            except Exception:
                pass
        return _error(f"重命名失败且已尝试回滚: {exc}", status=500)

    renamed = [{"old": os.path.basename(s), "new": os.path.basename(t)} for s, _, t in moved]
    print(f"[ALBER] 已重命名 {len(renamed)} 个文件 @ {folder}")
    return web.json_response({"folder": folder, "renamed": renamed})


# --------------------------------------------------------------------------- #
# 注册
# --------------------------------------------------------------------------- #
def register_routes():
    global _registered
    if _registered or web is None or PromptServer is None:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return

    routes = instance.routes
    table = (
        ("get", "/batch_image_loader/list", list_handler),
        ("get", "/batch_image_loader/browse", browse_handler),
        ("get", "/batch_image_loader/view", view_handler),
        ("get", "/batch_image_loader/thumb", thumb_handler),
        ("post", "/batch_image_loader/rename", rename_handler),
    )
    for method, path, handler in table:
        try:
            getattr(routes, method)(path)(handler)
        except Exception as exc:  # 重复注册时忽略
            print(f"[ALBER] 注册路由 {path} 失败: {exc}")
    _registered = True
