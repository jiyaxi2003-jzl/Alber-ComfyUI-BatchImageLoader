# ALBER-Batch Image Loader

[![CI](https://github.com/jiyaxi2003-jzl/ComfyUI-BatchImageLoader/actions/workflows/ci.yml/badge.svg)](https://github.com/jiyaxi2003-jzl/ComfyUI-BatchImageLoader/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)

ALBER 系列的 **批量图片输入** 节点（ComfyUI 自定义节点）：左侧图片列表（自动序号 + 缩略图），右侧大图预览，
支持文件夹选择、批量改名、多种排序，输出标准 `IMAGE` batch，可直接连到图生视频 / 批量处理等节点。

```
┌──────────────────────────────────────────────┐
│ [选择文件夹] [批量改名]                       │   ← 节点上的按钮
│ folder            [D:/shots/2026-11-03     ] │
│ sort_by                [created_time    ▾]   │   ← 排序下拉
│ order                  [ascending       ▾]   │
│ start_index            [1               ]    │   ← 起始序号
│ mode                   [batch           ▾]   │
│ resize_mode            [first_image     ▾]   │
├──────────────────────────────────────────────┤
│ 8 张  [过滤名称…]                     ⟳       │
│ ┌───────────────────┬──────────────────────┐ │
│ │ 1 [缩] img_001.png│                      │ │
│ │ 2 [缩] img_002.png│      图片预览        │ │
│ │ 3 [缩] img_003.png│                      │ │
│ │ 4 [缩] img_004.png│  img_002.png         │ │
│ │ ...               │  1.2 MB · 2026-11-03 │ │
│ └───────────────────┴──────────────────────┘ │
│ 共 128 张 · D:\shots\2026-11-03      ● image │
└──────────────────────────────────────────────┘
```

## 特性

- **左侧列表 + 右侧预览**：序号自动递增，支持关键字过滤，缩略图懒加载（后端 PIL 生成 + LRU 缓存）
- **选择文件夹**：内置目录浏览器（单击选中、双击进入、可粘贴绝对路径），确认后立即批量列出全部图片
- **批量改名**：模板化重命名，实时预览，重名拦截，两阶段改名避免 `A→B、B→A` 互相覆盖
- **四种排序**：文件名（自然排序，`img2` 在 `img10` 前）、创建时间、修改时间、文件大小，支持升降序
- **起始序号可调**：同时控制列表序号与改名起始号
- **两种输出模式**：`batch` 全部图片叠成一个 batch；`single` 只输出点选的那张
- **顺序一致性**：界面看到的顺序 = 实际输出的顺序
- **纯本地**：只新增 5 个只读/改名接口，不修改 ComfyUI 本体

## 安装

### 方式一：ComfyUI Manager（推荐）

在 ComfyUI Manager 中搜索 `ALBER-Batch Image Loader` 安装，或通过 *Install via Git URL* 填入仓库地址。

### 方式二：git clone

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/jiyaxi2003-jzl/ComfyUI-BatchImageLoader.git
```

### 方式三：下载 ZIP

下载仓库压缩包，解压到 `ComfyUI/custom_nodes/ComfyUI-BatchImageLoader/`（确保 `__init__.py` 就在这一层）。

安装后**重启 ComfyUI**，并刷新浏览器页面（Ctrl+F5）。节点位置：右键菜单 → `ALBER/batch` →
**ALBER-批量图片加载器 (Batch Image Loader)**。

依赖：`Pillow`（ComfyUI 已自带）、`numpy`、`aiohttp`（后两者 ComfyUI 已自带）。

## 使用说明

| 控件 | 作用 |
| --- | --- |
| **选择文件夹** | 打开目录浏览器，确认后扫描并列图片 |
| **批量改名** | 按模板成批重命名列表中的图片 |
| `folder` | 图片文件夹。留空 = ComfyUI 的 `input` 目录；相对路径 = 相对 `input` 目录；也支持直接粘贴绝对路径 |
| `sort_by` | `filename` 自然排序 / `created_time` / `modified_time` / `size` |
| `order` | `ascending` 升序 / `descending` 降序 |
| `start_index` | 列表序号的起始值，也是批量改名的默认起始序号 |
| `mode` | `batch` 全部输出；`single` 只输出 `index` 指定的那一张 |
| `index` | `single` 模式下取第几张（0 开始）。在列表中点某张图会自动同步 |
| `max_images` | 最多读取几张，0 = 不限制 |
| `resize_mode` | 尺寸不一致时：`first_image` 对齐第一张 / `largest_image` 对齐最大尺寸 / `none` 不处理（不一致报错） |

### 输出

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `image` | `IMAGE` | `[N, H, W, 3]` float32，0~1，多张图叠成一个 batch |
| `count` | `INT` | 实际加载的张数 |
| `filenames` | `STRING` | 按输出顺序排列的文件名，换行分隔 |

### 改名模板

| 变量 | 含义 | 示例 |
| --- | --- | --- |
| `{i}` | 当前序号 | 5 |
| `{i:03d}` | 补零序号 | 005 |
| `{index0}` | 从 0 开始的序号 | 4 |
| `{name}` | 原文件名（不含扩展名） | img_001 |
| `{ext}` | 原扩展名 | png |

模板 `shot_{i:03d}` + 起始序号 5 → `shot_005.png`、`shot_006.png` …

- 模板没写扩展名时自动沿用原扩展名
- 产生重复文件名、或目标文件已存在时拒绝执行并提示
- 先全部改成临时名再改成目标名，互换命名也不会丢文件

## 实现要点

- **Python 侧**：`nodes.py` 定义节点（读图、统一尺寸、输出 batch）；`api.py` 通过
  `PromptServer.instance.routes` 注册 5 个本地接口
  （`/batch_image_loader/list|browse|view|thumb|rename`）；`utils.py` 负责扫描与自然排序。
- **JS 侧**：`web/batch_image_loader.js` 用 `beforeRegisterNodeDef` 注入 UI，
  `addDOMWidget` 渲染列表 + 预览，两个 `button` widget 挂按钮。
- **顺序一致性**：前端把当前列表顺序写入隐藏 widget `files_json`（附带 folder 指纹），
  节点执行时优先按它取文件；文件夹变动时该列表自动失效并重扫。
- **缩略图**：PIL 生成 + `lru_cache` + 线程池，避免阻塞事件循环。

## 开发与测试

```bash
# 后端逻辑测试（mock 掉 torch 与 ComfyUI 环境，无需安装 ComfyUI）
pip install pillow numpy aiohttp
python tests/test_batch_image_loader.py

# 前端界面测试（jsdom 模拟 ComfyUI 前端）
cd tests && npm install && npm test
```

CI 会在 Ubuntu + Python 3.9/3.12 上跑后端测试，在 Node 20 上跑前端测试。

## 常见问题

**图片太多 / 显存不够？**
用 `max_images` 限制张数，或改用 `single` 模式逐张处理。`batch` 模式会把所有图一次性读进内存。

**留空 folder 显示的是一堆陌生图片？**
留空时会扫描 ComfyUI 的 `input` 目录。

**改名后节点报错找不到文件？**
点节点上的 `⟳` 重新扫描，或刷新页面。

**支持子文件夹吗？**
界面只列当前这一层；需要递归时直接把 `folder` 指向更深的目录。

## 目录结构

```
ComfyUI-BatchImageLoader/
├── __init__.py                  # 入口：注册节点 + 路由 + WEB_DIRECTORY
├── nodes.py                     # ALBER-BatchImageLoader 节点
├── api.py                       # 5 个本地 HTTP 接口
├── utils.py                     # 扫描 / 自然排序 / 路径解析
├── web/batch_image_loader.js    # 前端界面
├── tests/                       # 后端 + 前端测试
├── .github/workflows/ci.yml     # CI
├── pyproject.toml               # 包元数据（ComfyUI Manager 读取）
├── requirements.txt
└── LICENSE
```

## License

[MIT](LICENSE)
