---
日期：2026-11-08
分支：dev
状态：已完成
---

# 网页快照 → PDF 阅读器 · 设计方案

需求原话：「能做一个扩展，结合当前的插件PDF，扩展把某个网页的快照整体发送到插件的pdf进行预览，需要还原该网页的布局和样式」

## 1. 一句话目标

做一个 Chrome 扩展：在任意网页点一下，把整页快照转成**还原布局与样式**的 PDF，自动送进 DSH 的 pdf-reader 书架并打开预览。

## 2. 先想清楚：真正的难点在哪

- **导入端零成本**：pdf-reader Host 已有 `importBook(fileName, pdfBase64)`（packages/experimental/pdf-reader/src/index.ts:191），默认上限 100MB，返回书架行——**不动 Host 就能入库**。
- **难点一（保真）**：浏览器原生"打印为 PDF"走 print 媒体，很多站点的 print CSS 会隐藏导航、重排布局，打出来和看到的完全两样。必须让浏览器按 **screen 媒体**渲染再出 PDF。
- **难点二（传输）**：扩展的 origin 是 `chrome-extension://`，不能直接 POST DSH 的 `/api`——连接层的信任栅栏会拒绝所有跨源浏览器请求（packages/client/connection/src/api-request-trust.ts:121：`sec-fetch-site: cross-site` 直接拒，Origin 必须同源）。改栅栏是动全局安全机制，否决；正确路径是**借道已打开的 GUI 页面**（同源）调既有 Remote。

## 3. 总体架构

```text
┌ 用户浏览器 ─────────────────────────────────────────────────────┐
│  目标网页 tab                  DSH GUI tab (127.0.0.1:3080)      │
│  ┌────────────────┐  PDF base64  ┌────────────────────────────┐ │
│  │ 快照扩展 MV3    │ ───────────▶ │ content-script 中继         │ │
│  │ CDP printToPDF │  tabs.send   │   ↕ window.postMessage     │ │
│  │ screen 媒体渲染 │  Message     │ client-ui-web-capture      │ │
│  └────────────────┘              │   (新客户端插件)            │ │
└──────────────────────────────────│   ↓ ctx.remote.pdfReader   │─┘
                                   │     .importBook()          │
                                   └────────────┬───────────────┘
                                                ↓ 既有 WS Remote 通道
        DSH Host pdf-reader 控制器 → 书架入库 → selectPanel('pdfReader') + 打开事件 → 预览
```

组件与改动面：

| 组件 | 性质 | 说明 |
|---|---|---|
| `web-capture-extension` | **新增** | Chromium MV3 扩展，负责捕获与出 PDF |
| `client-ui-web-capture` | **新增** | 客户端插件：收消息、验 token、入库、切面板 |
| `client-ui-pdf-reader` | 小改 2 处 | 监听"打开某书"事件；`importBook` 可选 meta 参数（M1 可零改动） |
| `web-capture-bundle` | 新增组合包 | cordis.patch.yml 组合上述插件，`dsh plugin add` 交付 |

## 4. 捕获怎么做才"还原布局和样式"

核心链路（`chrome.debugger` CDP）：

1. attach 目标 tab → `Emulation.setEmulatedMedia({media:'screen'})`——**关键一步**，让打印引擎按屏幕 CSS 渲染，保住布局、颜色、字体；
2. 注入补丁 CSS：`print-color-adjust: exact`；长页模式下把 `position:fixed/sticky` 转 static（避免分页重复/遮挡）；
3. `Page.printToPDF`：`paperWidth` = 视口宽（1440px → 15in，不回流换行）、margin 0、`printBackground`、`generateTaggedPDF`——**文本层完整保留，可选中、可划词翻译/解释**，正好接上 pdf-reader 的两个闭环；
4. **长页单页模式（默认）**：`paperHeight` = 整页高度，整页一张超长 PDF，版式 1:1 还原；上限约 200in ≈ 19200px，超出自动分段成多张长页；
5. 预处理（可选开关）：深度捕获先滚一遍触发懒加载；canvas → `toDataURL` 转 `<img>`；video 取当前帧；
6. detach → 拿到 base64 → 发给 GUI 标签页。

**为什么不是别的**（取舍）：

| 备选 | 否决理由 |
|---|---|
| 截图拼接 → 图片 PDF | 像素级还原但无文本层，划词翻译/解释全废，文件还大——只作 debugger 权限被拒时的降级 |
| html2canvas 重组 | CSS 兼容性差，复杂页面必走样 |
| 扩展直接 POST /api | 被信任栅栏拒绝（见 §2），不该为它改全局安全机制 |
| Host fetch HTML 自渲染 | 无登录态、动态内容渲染不出；"扩展捕获"天然带着用户会话——这是选浏览器扩展的根本理由（知乎登录态页面就是典型场景） |

## 5. 传输与安全

- 中继链：扩展 SW → `chrome.tabs.sendMessage` → GUI 页 content script → `window.postMessage`（约定 `source:'dsh-web-capture'`）→ 插件监听；应答原路返回。
- **自动配对**：插件启动生成随机 token 写 localStorage；content script 同源可读，随消息带给扩展；无 token 的消息一律拒——用户零配置。
- 护栏：字节数 ≤ `maxPdfBytes`（超限回明确错误）；>2MB 消息分片重组；GUI 未开时扩展自动开一个 GUI 标签（可配置）。
- 残余风险如实说明：GUI 页内脚本理论上可伪造消息，影响上限是"往自己书架塞一本 PDF"，无代码执行面；token + 大小限制兜底。

## 6. 入库与预览联动

- `importBook(title, base64)` → `BookRow`；成功后 `ctx.layout.selectPanel('pdfReader')`（packages/client/ui-layout/src/client/service.ts:36），书架最新在前；
- M2：`window` 派发 `dsh-pdf-reader:open {bookId}` 自定义事件，client-ui-pdf-reader 监听后直接进阅读视图（约 3 行改动）；
- 来源标记：M2 给 `importBook` 加可选第三参 `meta {sourceUrl, capturedAt}`，书架副标题显示"来自网页 · 日期"，向后兼容。

## 7. 实施阶段（定稿：双模式 M1 / 只要扩展入口 / Chromium 系）

定稿调整：

1. **双模式进 M1**：扩展 popup 提供「长页 / A4」切换（默认长页，记住上次选择）。
   - 长页：paperHeight = 整页高，版式 1:1，>200in 自动分段；
   - A4：screen 媒体 + A4 分页，注入 `break-inside: avoid` 类补丁，减少图片/代码块被切断。
2. **范围收敛**：只做浏览器扩展入口，不做 Host 侧 URL 直捕（以后有需要再按 Playwright 路线单独立项）。
3. **Chromium 系**：MV3 + `chrome.debugger`（CDP），不做 Safari/Firefox 适配；截图拼接降级模式列为远期备选，不在本次范围。

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 | 扩展：长页 + A4 双模式捕获、popup 选项（模式/捕获宽度）；中继链 + token 自动配对；`client-ui-web-capture` 插件 → `importBook` → 切面板书架置顶；vitest（协议/token/大小护栏） | 端到端可用 |
| M2 | 打开即读联动（`dsh-pdf-reader:open` 事件，client-ui-pdf-reader 约 3 行）；来源 meta（sourceUrl/capturedAt，书架副标题）；深度捕获滚动（懒加载）、canvas/video 帧替换；错误码、i18n、可达性、打包 `dsh plugin add` 验证 | 可交付 |

## 8. 边界条件

1. 超长页 >200in → 自动分段长页；2. 用户开着 DevTools 时 debugger attach 冲突 → 明确报错；3. 登录态页面 → 扩展侧天然带会话；4. 跨域 canvas 污染 → 转图失败保留占位并警告；5. 重复捕获 → 允许重复入库，去重列后续；6. 100MB 上限 → 明确错误提示。

## 9. 验证标准

三类页面实测对比（知乎登录态回答页 / MDN 类文档页 / 重动态 SPA）：布局、字体、颜色、图片位置人工 checklist + PDF 文本层可选中划词翻译；client 插件 vitest 覆盖协议、token、分片、大小护栏。
