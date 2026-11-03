/**
 * 用 jsdom 模拟 ComfyUI 前端，验证 BatchImageLoader 的界面逻辑。
 */
const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (err) {
  console.error("缺少依赖 jsdom，请先执行： cd tests && npm install");
  process.exit(1);
}

const JS_PATH = path.join(__dirname, "..", "web", "batch_image_loader.js");

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error("断言失败: " + msg);
  console.log("  ✓ " + msg);
};

/* ---------------- mock ComfyUI 的 app / api ---------------- */
const FILES = [
  { name: "a.png", path: "C:/fake/a.png", size: 1024, ctime: 1700000000, mtime: 1700000001 },
  { name: "b.png", path: "C:/fake/b.png", size: 2048, ctime: 1700000100, mtime: 1700000101 },
  { name: "c.png", path: "C:/fake/c.png", size: 4096, ctime: 1700000200, mtime: 1700000201 },
];

const calls = [];

async function fetchApi(url, init) {
  calls.push({ url, init });
  if (url.includes("/list")) {
    return { json: async () => ({ folder: "C:/fake", files: FILES }) };
  }
  if (url.includes("/browse")) {
    return {
      json: async () => ({
        path: "C:/fake", parent: "C:/", image_count: 3,
        dirs: [{ name: "sub", path: "C:/fake/sub" }], drives: [],
      }),
    };
  }
  if (url.includes("/rename")) {
    return { json: async () => ({ folder: "C:/fake", renamed: [] }) };
  }
  throw new Error("未知请求: " + url);
}

const extensions = [];
globalThis.__app = { registerExtension: (ext) => extensions.push(ext) };
globalThis.__api = { fetchApi };

/* ---------------- 执行插件脚本（替换掉 import） ---------------- */
let source = fs.readFileSync(JS_PATH, "utf8");
source = source
  .replace(/^import \{ app \} from .*$/m, "const app = globalThis.__app;")
  .replace(/^import \{ api \} from .*$/m, "const api = globalThis.__api;");
assert(!/^import /m.test(source), "import 已替换");
new Function(source)();

/* ---------------- 假的 LGraphNode ---------------- */
class FakeNode {
  constructor() {
    this.widgets = [];
    this.size = [300, 300];
    this.properties = {};
    this.dirty = 0;
    const w = (name, type, value) => ({
      name, type, value,
      computeSize: (width) => [width, 22],
    });
    this.widgets.push(
      w("folder", "text", "C:/fake"),
      w("sort_by", "combo", "filename"),
      w("order", "combo", "ascending"),
      w("start_index", "number", 1),
      w("mode", "combo", "batch"),
      w("index", "number", 0),
      w("max_images", "number", 0),
      w("resize_mode", "combo", "first_image"),
      w("files_json", "text", ""),
    );
  }
  addWidget(type, name, value, callback, options) {
    const widget = { type, name, value, callback, options, computeSize: (width) => [width, 22] };
    this.widgets.push(widget);
    return widget;
  }
  addDOMWidget(name, type, element, options) {
    const widget = {
      name, type, element, options,
      computeSize: (width) => [width, element.offsetHeight || 0],
    };
    this.widgets.push(widget);
    this.__domEl = element;
    document.body.appendChild(element);
    return widget;
  }
  setSize(size) { this.size = size; }
  setDirtyCanvas() { this.dirty += 1; }
}

const widgetOf = (node, name) => node.widgets.find((w) => w.name === name);

(async () => {
  console.log("\n=== A. 注册与节点初始化 ===");
  const ext = extensions[0];
  assert(!!ext && ext.name === "ALBER-BatchImageLoader.UI", "扩展已注册");
  await ext.beforeRegisterNodeDef(FakeNode, { name: "ALBER-BatchImageLoader" });

  const node = new FakeNode();
  node.onNodeCreated();
  assert(node.widgets.some((w) => w.type === "button" && w.name.includes("选择文件夹")), "添加了「选择文件夹」按钮");
  assert(node.widgets.some((w) => w.type === "button" && w.name.includes("批量改名")), "添加了「批量改名」按钮");
  assert(node.size[0] === 540 && node.size[1] === 720, `节点尺寸已设置为 ${node.size}`);
  assert(!!node.__domEl && node.__domEl.classList.contains("bil-root"), "面板 DOM 已挂载");

  console.log("\n=== B. files_json 被隐藏 ===");
  const fj = widgetOf(node, "files_json");
  assert(fj.type === "hidden", "files_json type = hidden");
  assert(fj.computeSize(200)[1] === -4, "files_json 高度为 -4（不占位）");

  console.log("\n=== C. batch 模式下 index 隐藏 ===");
  const indexWidget = widgetOf(node, "index");
  assert(indexWidget.type === "hidden", "batch 模式 index 隐藏");
  widgetOf(node, "mode").value = "single";
  widgetOf(node, "mode").callback("single");
  assert(indexWidget.type === "number", "single 模式 index 恢复可见");

  console.log("\n=== D. 刷新后列表渲染 ===");
  await sleep(400);
  assert(calls.some((c) => c.url.includes("/list?")), "调用了 /list 接口");
  const items = [...node.__domEl.querySelectorAll(".bil-item")];
  assert(items.length === 3, `渲染了 ${items.length} 个列表项`);
  assert(
    items.map((li) => li.querySelector(".bil-idx").textContent).join(",") === "1,2,3",
    "序号从 start_index=1 开始：" + items.map((li) => li.querySelector(".bil-idx").textContent).join(",")
  );
  assert(items[0].classList.contains("bil-item-selected"), "首项默认选中");
  assert(items[0].querySelector(".bil-thumb").src.includes("/batch_image_loader/thumb?path="), "缩略图 URL 正确");
  assert(
    items.map((li) => li.querySelector(".bil-name").textContent).join("|") === "a.png|b.png|c.png",
    "文件名正确"
  );

  console.log("\n=== E. 右侧预览 ===");
  const previewImg = node.__domEl.querySelector(".bil-preview-img");
  assert(previewImg.src.includes("/batch_image_loader/view?path="), "预览图 URL 正确");
  assert(previewImg.style.display === "block", "预览图可见");
  assert(node.__domEl.querySelector(".bil-preview-meta").textContent.includes("a.png"), "预览信息显示文件名");

  console.log("\n=== F. files_json 同步 ===");
  assert(JSON.parse(fj.value).files.join(",") === "a.png,b.png,c.png", "files_json = " + fj.value);

  console.log("\n=== G. 点击第二项 ===");
  items[1].click();
  assert(items[1].classList.contains("bil-item-selected"), "第二项选中");
  assert(!items[0].classList.contains("bil-item-selected"), "首项取消选中");
  assert(previewImg.src.includes("b.png"), "预览切换到 b.png");
  assert(widgetOf(node, "index").value === 1, "single 模式下 index 同步为 1");

  console.log("\n=== H. 修改起始序号 ===");
  widgetOf(node, "start_index").value = 5;
  widgetOf(node, "start_index").callback(5);
  const idxText = [...node.__domEl.querySelectorAll(".bil-idx")].map((e) => e.textContent).join(",");
  assert(idxText === "5,6,7", "序号变为 5,6,7 -> " + idxText);

  console.log("\n=== I. 过滤 ===");
  const filterEl = node.__domEl.querySelector(".bil-filter");
  filterEl.value = "b.";
  filterEl.dispatchEvent(new dom.window.Event("input"));
  const visible = [...node.__domEl.querySelectorAll(".bil-item")];
  assert(visible.length === 1 && visible[0].dataset.index === "1", "过滤后只剩 b.png");
  assert(node.__domEl.querySelector(".bil-count").textContent === "1/3 张", "计数显示 1/3 张");
  filterEl.value = "";
  filterEl.dispatchEvent(new dom.window.Event("input"));

  console.log("\n=== J. 排序下拉触发重新请求 ===");
  const before = calls.length;
  widgetOf(node, "sort_by").value = "size";
  widgetOf(node, "sort_by").callback("size");
  await sleep(300);
  assert(calls.length > before, "排序变化后重新请求列表");
  assert(calls[calls.length - 1].url.includes("sort_by=size"), "请求带上 sort_by=size");

  console.log("\n=== K. 选择文件夹对话框 ===");
  node.widgets.find((w) => w.type === "button" && w.name.includes("选择文件夹")).callback();
  await sleep(120);
  const mask = document.querySelector(".bil-mask");
  assert(!!mask, "对话框已打开");
  const rows = [...mask.querySelectorAll(".bil-dir-row")];
  assert(rows.length === 2, `目录列表 ${rows.length} 项（上级 + sub）`);
  assert(mask.querySelector(".bil-dir-path").value === "C:/fake", "路径框显示当前目录");
  const okBtn = mask.querySelector(".bil-dialog-ok");
  assert(!okBtn.disabled, "确认按钮可用");
  okBtn.click();
  await sleep(300);
  assert(!document.querySelector(".bil-mask"), "确认后对话框关闭");
  assert(widgetOf(node, "folder").value === "C:/fake", "folder 已写入");

  console.log("\n=== L. 批量改名对话框 ===");
  node.widgets.find((w) => w.type === "button" && w.name.includes("批量改名")).callback();
  await sleep(120);
  const renameMask = document.querySelector(".bil-mask");
  assert(!!renameMask, "改名对话框已打开");
  const pattern = renameMask.querySelector(".bil-rename-pattern");
  const startInput = renameMask.querySelector(".bil-rename-start");
  pattern.value = "shot_{i:03d}";
  startInput.value = "7";
  pattern.dispatchEvent(new dom.window.Event("input"));
  const previewText = renameMask.querySelector(".bil-preview-lines").textContent;
  console.log("    " + previewText.split("\n").join("\n    "));
  assert(previewText.includes("shot_007.png"), "预览含 shot_007.png");
  assert(previewText.includes("shot_008.png"), "预览含 shot_008.png");
  assert(previewText.includes("shot_009.png"), "预览含 shot_009.png");

  startInput.value = "1";
  pattern.value = "same";
  pattern.dispatchEvent(new dom.window.Event("input"));
  assert(renameMask.querySelector(".bil-dialog-ok").disabled, "重复文件名时禁用确认");
  assert(renameMask.querySelector(".bil-dialog-hint").textContent.includes("重复"), "提示重复文件名");

  pattern.value = "shot_{i:03d}";
  pattern.dispatchEvent(new dom.window.Event("input"));
  assert(!renameMask.querySelector(".bil-dialog-ok").disabled, "模板合法时允许提交");

  renameMask.querySelector(".bil-dialog-ok").click();
  await sleep(300);
  const renameCall = calls.find((c) => c.url.includes("/rename"));
  assert(!!renameCall && renameCall.init.method === "POST", "发起 POST /rename");
  const body = JSON.parse(renameCall.init.body);
  assert(body.pattern === "shot_{i:03d}" && body.start === 1, "请求体：" + renameCall.init.body);
  assert(!document.querySelector(".bil-mask"), "提交后关闭对话框");

  console.log("\n*** 前端逻辑测试全部通过 ***");
})().catch((err) => {
  console.error("\n测试失败:", err);
  process.exit(1);
});
