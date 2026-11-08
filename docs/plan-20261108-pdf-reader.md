---
日期：2026-11-08
分支：dev
状态：执行中
---

# PDF 阅读器插件 · 设计方案

## 1. 目标与范围

做一个 DSH 组合包插件 `dsh-pdf-reader`：导入 PDF → 书架 → 单页阅读。核心是两个标注闭环：

- **文本闭环**（对齐 epub 插件）：文本层选词 → 右键「翻译 / 解释」→ 流式进右栏 → 划线持久化 + 正文高亮回显
- **截图闭环**（新增）：内置截图小工具，在页面上框选区域 → 裁剪成图 → 连问题发给 vision 模型 → 流式回答 + 截图卡片持久化
- **模型可指定**：文本模型与截图模型分别指定，留空跟随默认
- **工作区间**：导入即复制进插件自管目录（同 epub），存储目录可在面板设置里指定

v1 范围：书架（导入/删除/进度）、单页阅读（目录书签、上下页、跳页、缩放、进度记忆）、划词翻译/解释（流式）、截图框选提问（流式）、标注持久化与回看。
暂不做：连续滚动、双页平铺、注释导出、表单填写、标注搜索（列升级路径）。

## 2. 交互设计

### 2.1 入口与布局

入口同 epub：左侧栏新面板（`sidebar.panellist` + main slot，`PANEL_ID = 'pdfReader'`），内部书架 / 阅读两级视图。

```text
┌─ 阅读视图（单页两栏）────────────────────────────────┐
│ ☰ 目录   书名 · 第 12/240 页   − 100% +   ✂截图   ⟳  │
├──────────────────────────────────┬──────────────────┤
│                                  │ 标注栏            │
│     单页 canvas 渲染              │ ┌──────────────┐ │
│     （上叠透明文本层供选词，        │ │ 划线卡片       │ │
│       已存划线 <mark> 高亮）       │ │ ▸翻译 ▸解释    │ │
│                                  │ ├──────────────┤ │
│   划词后右键：翻译 / 解释          │ │ 截图卡片       │ │
│                                  │ │ [缩略图]       │ │
│   ✂ → 十字框选 → 原位浮出         │ │ 问题 + 流式回答 │ │
│       提问框（Enter 发送）        │ └──────────────┘ │
├──────────────────────────────────┴──────────────────┤
│   ◀ 上一页    12 / 240 [跳页]    下一页 ▶    进度 5%  │
└──────────────────────────────────────────────────────┘
```

交互细节：

- **划词 → 右键**：`ContextMenuTargetMap` 新增 target family `pdfSelection`，菜单项「翻译」「解释」，与 epub 同型。
- **截图小工具**：工具条 ✂ 按钮（快捷键 S）进入框选模式，光标变十字，页面拖矩形；松开后原位浮出提问框——输入框 + 快捷动作（解释内容 / 翻译图中文字 / 自由提问），Enter 发送、Esc 取消。裁剪按当前缩放换算回页面原始坐标，2× devicePixelRatio 输出 PNG。
- **标注栏卡片两类**：文本卡（原文引用 + 翻译/解释 Tab 流式，同 epub）＋ 截图卡（缩略图 + 问题 + 流式回答 + 重新生成/复制/删除/跳回该页）。
- **回显**：文本划线在文本层加下划线式弱高亮；截图标注在对应页工具条角标记数，悬停卡片平滑跳页。
- **进度**：页码防抖自动保存，书架显示进度，打开直接续读。
- 响应式与可达性同 epub：窄面板标注栏收抽屉、尊重 reduced-motion、全程键盘可达。

### 2.2 视觉方向

延续 epub「正文优先、铬件退后」：PDF 页面自带白底，面板用中性灰底衬托页面阴影，做出「纸」的物理感；标注栏是安静笔记纸；全局强调色只给一处——划线高亮与截图矩形框共用。

## 3. 总体架构

三包结构，完全对齐 epub-reader 三件套形态：

```text
pdf-reader（Host 半区，Node）
│  PdfReaderController（TypertRemoteService, namespace 'pdfReader'）
│   ├─ @Remote：导入(复制+校验)/列表/删书/取目录/进度/标注 CRUD
│   ├─ @Remote：pdfBytes(bookId) → Uint8Array（binary transfer）
│   ├─ @Remote({mode:'stream'}) explain()：文本翻译/解释（同 epub）
│   ├─ @Remote({mode:'stream'}) askImage()：截图+问题 → 图片入附件库 → vision 流式
│   └─ inject: ['llm']；存储 profile 下 .pdf-reader/books/<id>/
│
client-ui-pdf-reader（浏览器半区）
│  ├─ sidebar 面板 + main slot（书架/阅读）
│  ├─ pdf.js：owned Worker + canvas 渲染 + TextLayerBuilder 文本层
│  │        （复用仓库 ui-sidebar-documentpreview 已验证的 Worker 模式）
│  ├─ 选区 → ctx.contextMenus（pdfSelection）
│  ├─ 截图小工具：单页 canvas 框选 → 离屏 canvas 裁剪 → PNG bytes
│  └─ dsh.client.inject: ui-sidebar / ui-layout / ui-context-menu / locale / api-remotes
│
pdf-reader-bundle（组合包）
   └─ cordis.patch.yml：host 服务行 + client UI 行（含模型默认值）
```

数据流：

- **文本**：文本层选词 → 右键 → `ctx.remote.pdfReader.explain()` → Host 组 prompt（选词 + 页上下文 + 书名页码）→ `ctx.llm.stream` → 流式回推 → 卡片渲染 → `saveAnnotation` 落库。
- **截图**：框选 → 裁剪 PNG → `ctx.remote.pdfReader.askImage()`（bytes 走 binary 参数）→ Host `ctx.attachments.saveImage` → `ctx.llm.stream`（image block + 问题）→ 流式回推 → 截图卡片 → 落库。

## 4. 关键技术决策

| # | 决策 | 理由与依据 |
|---|---|---|
| 1 | **PDF 解析渲染全在浏览器**（pdfjs-dist 6.x），Host 只存字节 | pdf.js 是浏览器库，text layer 原生供选区；`ui-sidebar-documentpreview` 已验证 owned-Worker + TextLayerBuilder 路线，本仓库有成熟参照 |
| 2 | **导入即复制**进插件自管目录，存储目录可在面板指定 | 已确认走 epub 式导入；沿用 EpubStore + `saveStorageSettings` 既有惯例 |
| 3 | **PDF bytes 经 Remote binary 下发**，不开 Fetch 资源路由（除首页缩略图） | typert 协议原生支持 Uint8Array 二进制；书已在自管目录内，无路径穿越面 |
| 4 | **单页翻页** | 已确认；渲染窗口恒为一页，内存可控；截图框选几何在单页坐标系内，简单可靠 |
| 5 | **文本锚定 = 页码 + 页内纯文本偏移** + 引文哈希兜底 | epub 纯文本偏移方案按页改造；缩放/重渲染后稳定；失配降级为仅笔记不定位 |
| 6 | **截图走 `ctx.attachments.saveImage` → ImageBlock** | 仓库唯一受支持的图片输入路径（ImageBlock 必须持附件引用），不做裸 base64 |
| 7 | **模型两套配置**：文本 `provider/model` + 截图 `shotProvider/shotModel` | 截图需 vision；模型列表按 `inputModalities` 过滤；留空跟随 agentDefaultModel，不支持图片时返回明确错误码并引导设置 |
| 8 | **护栏**：≤100MB、magic bytes 校验、加密/坏文件明确报错；无文本层的页引导用截图工具 | 扫描版 PDF 恰是截图工具的核心场景 |

## 5. 数据模型与 Remote API

```ts
interface BookRow { bookId, title, pageCount, coverUrl /* 首页缩略图 */, outline: TocEntry[], progress: { page }, importedAt }
interface TextAnnotation { id, bookId, page, start, end /* 页内文本偏移 */, quote, createdAt,
                           results: { kind: 'translate'|'explain', text, model, createdAt }[] }
interface ShotAnnotation { id, bookId, page, rect { x, y, w, h } /* 页面归一坐标 */, imageUrl,
                           question, answer: { text, model, createdAt }, createdAt }
```

| Remote 方法 | 形态 | 说明 |
|---|---|---|
| `list()` / `importBook(name, bytes)` / `removeBook(id)` | unary | 导入即复制 + 校验；页数/目录在 Host 用轻量解析提取 |
| `pdfBytes(bookId)` | unary·binary | 完整 PDF 字节给浏览器 pdf.js |
| `saveProgress` / `listAnnotations` / `saveTextAnnotation` / `saveShotAnnotation` / `deleteAnnotation` | unary | 持久化 |
| `explain(bookId, page, kind, text, signal)` | **stream** | meta / delta / done，同 epub |
| `askImage(bookId, page, rect, pngBytes, question, signal)` | **stream** | meta / delta / done |

错误码：`pdf/not-found`、`pdf/bad-file`、`pdf/too-large`、`pdf/encrypted`、`pdf/no-text-layer`、`pdf/no-vision-model`、`pdf/explain-failed`。

## 6. Prompt 设计

- 翻译/解释：沿用 epub 模板（书名、页码、前后文截断保护，选区超长转整段策略）。
- 截图：默认问题「解释这张 PDF 截图中的内容」，快捷动作「翻译图中文字」，支持自由提问；prompt 附书名/页码元数据。

## 7. 插件配置

```yaml
dataRoot: ''
targetLanguage: 简体中文
provider / model: ''
shotProvider / shotModel: ''
maxPdfBytes: 100MB
maxSelectionChars: 2000
maxOutputTokens: 2048
```

## 8. 包结构与交付

`pdf-reader` / `client-ui-pdf-reader` / `pdf-reader-bundle` 三包，包结构、测试布局（fixture 解析/锚定/控制器 + client 组件测试，LLM 走 mock adapter）、打包交付（`dsh plugin add`）全部对齐 epub-reader 三件套。

## 9. 实施阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 | Host：导入复制/存储/bytes/目录 Remote；client 书架、单页 pdf.js 渲染、翻页缩放跳页、进度记忆 | 能导能读 |
| M2 | 文本层选区 → 右键 → explain 流式 → 标注卡片 + 划线持久化高亮回显 | 文本闭环 |
| M3 | 截图工具框选 + 提问框 → askImage 流式 → 截图卡片；模型指定 UI（vision 过滤）；存储目录设置、i18n、可达性、测试补齐、打包验证 | 可交付 |

风险与备选：扫描版无文本层（截图路径兜底，正是卖点）；超大 PDF（单页窗口 + 目录懒解析控制）；vision 模型不可用（明确错误码 + 设置引导）。

## 已确认决策（2026-11-08）

- 工作区间：跟 epub 一样导入复制（存储目录可在面板设置里指定）。
- 阅读模式：单页翻页。
- 截图默认动作：先弹提问框。
- 工作区：DSH 源码仓内开发（/Users/lwc/Desktop/code/github/deepseek-harness，dev 分支）。
