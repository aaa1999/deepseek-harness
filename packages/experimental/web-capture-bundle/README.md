# DSH Web Capture（网页快照 → PDF 书架）

把任意网页一键快照成 PDF，自动送进 DSH 的 PDF 阅读器书架并打开预览。PDF 按**屏幕媒体**渲染，布局、字体、颜色与你在浏览器里看到的一致，且保留可选中文本层，可继续使用划词翻译/解释。

## 组成

| 组件 | 位置 | 职责 |
|---|---|---|
| MV3 扩展 | `packages/experimental/client-ui-web-capture/extension/` | CDP `Page.printToPDF`（screen 媒体）捕获，经 GUI 标签页中继投递 |
| 客户端插件 | `packages/experimental/client-ui-web-capture` | 监听 `window.postMessage`，配对 token，重组分片，调 `pdfReader.importBook` 入库并切到 PDF 面板 |
| 组合包 | 本包 | 组装 pdf-reader 三件套 + 中继插件 |

与 `pdf-reader-bundle` 的插件行同 id：**二选一安装，不要同装**。

## 安装

1. 安装组合包：`dsh plugin add @deepseek-ai/dsh-web-capture-bundle`（或本地路径）。
2. Chrome 打开 `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选择 `client-ui-web-capture/extension/` 目录。
3. 打开 DSH GUI（默认 `http://127.0.0.1:3080`）。

## 使用

1. 在任意网页点扩展图标，选「长页 / A4」与捕获宽度；「深度捕获」默认开启，会先整页滚动一遍触发懒加载内容，再捕获。
2. 点「捕获并送入 PDF 书架」。浏览器顶部会短暂出现「正在调试此浏览器」横幅，属 CDP 附件的正常现象。
3. 成功后 DSH 自动切到 PDF 面板并直接打开这份快照；书架卡片显示「网页快照 · 日期」，悬停可见来源 URL。canvas/视频会冻结为当前帧一起进入 PDF。

配对零配置：插件启动时在 GUI 页 localStorage 写入随机 token，扩展的中继 content script 注入每条消息，token 不离开 GUI 源。

## 边界

- 页面过高（约 >19200 CSS px）时长页自动分成多张 200in 长页；固定定位元素可能在分段页重复。
- 目标页开着 DevTools 时无法附加调试器：先关 DevTools。
- 默认上限 100MB（`maxPdfBytes`），超出回明确错误。
- 需登录的页面：扩展在真实浏览器会话里捕获，天然带登录态。
- 扩展不做跨浏览器适配（Chromium 系）。
