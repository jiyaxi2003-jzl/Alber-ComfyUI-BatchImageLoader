"""ComfyUI Batch Image Loader

批量图片输入节点：左侧列表（自动序号）、右侧预览、文件夹选择、批量改名、多维度排序。
"""

from .api import register_routes
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# 注册后端 HTTP 接口（list / browse / view / thumb / rename）
register_routes()

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
