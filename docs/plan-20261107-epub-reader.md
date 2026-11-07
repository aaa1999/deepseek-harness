---
日期：2026-11-07
分支：dev
状态：已完成
---

# EPUB 阅读器插件 · 设计方案

## 1. 目标与范围

做一个 DSH 组合包插件 `dsh-epub-reader`：导入 EPUB → 书架 → 沉浸阅读；左栏读书、右栏笔记。核心闭环是**划词 → 右键「翻译 / 解释」→ 结果流式进右栏，并沉淀为可回看的划线笔记**。

v1 范围：书架（导入/删除/进度）、章节阅读（目录 + 上下章 + 进度记忆）、划词翻译/解释（LLM 流式输出）、划线持久化并在正文中高亮回显。
暂不做：书内 CSS 完整还原、双页平铺分页、TTS、导出笔记（列为升级路径）。

## 2. 交互设计

### 2.1 入口与布局

入口是左侧栏的一个新面板（与 Files / Plugins 同级，注册进 `sidebar.panellist`，宽面板模式）。面板内部两级视图：

```text
┌─ 书架 ──────────────────────────────────────────────┐
│  ＋导入 EPUB（点击/拖拽）                              │
│  ┌────┐ ┌────┐ ┌────┐                                 │
│  │封面 │ │封面 │ │封面 │   书名 · 作者 · 进度% · 继续读    │
│  └────┘ └────┘ └────┘                                 │
└──────────────────────────────────────────────────────┘

┌─ 阅读视图（两栏）─────────────────────────────────────┐
│ ☰ 目录   书名 / 章节名              ⟳ ⟶ 返回书架        │
├──────────────────────────────┬──────────────────────┤
│                              │ 笔记栏                │
│   正文阅读栏                  │ ┌──────────────────┐ │
│   （衬线字体，行长 ≤ 72 字符，   │ │ 原文引用          │ │
│     段落呼吸感，可调字号）       │ │ ▸ 翻译（流式…）    │ │
│                              │ │ ▸ 解释            │ │
│   划词后右键：                 │ └──────────────────┘ │
│   ┌───────────────┐          │ ┌──────────────────┐ │
│   │ 翻译    解释    │ ←菜单     │ │ 更早的划线…       │ │
│   └───────────────┘          │ └──────────────────┘ │
│                              │ 悬停卡片 → 正文滚动定位  │
├──────────────────────────────┴──────────────────────┤
│  ◀ 上一章   第 3 / 42 章   下一章 ▶      阅读进度 37%   │
└──────────────────────────────────────────────────────┘
```

交互细节：

- **划词 → 右键**：接入现有 ui-context-menu，新增一个 target family `epubSelection`（通过 `ContextMenuTargetMap` declaration merge），菜单项「翻译」「解释」。同一选区也可在鼠标释放后弹轻量浮动按钮（次路径，v1.1）。
- **右栏卡片**：一条划线 = 一张卡片，含原文引用 + Tab（翻译 / 解释）+ 流式正文 + 操作（重新生成、复制、删除、跳回原文）。生成中显示流式增量；失败显示可重试的错误行。
- **高亮回显**：已保存的划线在左栏以 `<mark>`（下划线式弱高亮，不抢阅读）渲染；悬停右栏卡片时正文平滑滚动到锚点并闪烁一次。
- **进度**：章节号 + 章内滚动比例自动保存（防抖 2s），书架显示进度，打开书直接续读。
- **响应式**：面板窄时笔记栏收为右侧抽屉（覆盖式），≥768px 恢复并排；尊重 reduced-motion；键盘可达（目录、菜单、卡片操作全部可 Tab/Enter）。

### 2.2 视觉方向

阅读器是「长时间注视的面」，视觉策略是**正文优先、铬件退后**：

- 阅读栏用衬线字体栈（`Songti SC / Noto Serif CJK / Georgia, serif`），UI 铬件（工具条、卡片、目录）沿用宿主界面字体与 `--dsh` 主题变量，跟暗色模式走；正文区额外提供「纸面」阅读底色开关（米白非纯白 / 暗面非纯黑，降低长阅读疲劳）。
- 右栏卡片是安静的笔记纸：无重阴影、单一圆角层级、分隔靠间距而非框线；正在流式生成的卡片用一条顶部细进度线表达「在写」，不用跳动动画。
- 全局只在两处花心思：封面书架的排布节奏，和划线高亮的颜色（唯一的强调色，翻译与解释共用一种，避免花）。

## 3. 总体架构

完全走 DSH 的正规扩展点，一个包、两个运行半区：

```text
dsh-epub-reader（一个 bundle 包）
│
├─ index.ts ──────── Host 半区（Node）
│   ├─ EpubLibraryService（TypertRemoteService, namespace 'epubReader'）
│   │    ├─ @Remote 方法：导入/列表/删书/取章节/进度/划线 CRUD
│   │    ├─ @Remote({mode:'stream'}) explain()：翻译与解释
│   │    └─ exact Fetch route：/api/epub-reader/resource（图片/字体）
│   ├─ EPUB 解析：fflate 解压 + fast-xml-parser 读 OPF/spine/TOC
│   ├─ 存储：profile 数据目录（.epub-reader/books/<id>/…）
│   └─ inject: ['llm']，经 ctx.llm.stream 调模型
│
└─ client（浏览器半区，package.json 声明 dsh.client）
    ├─ 注册 sidebar.panellist 面板（书架 + 阅读视图）
    ├─ 章节渲染：净化后的 XHTML 注入受控容器 + 自带阅读排版样式
    ├─ 选区处理 → ctx.contextMenus（epubSelection target family）
    ├─ 调 ctx.remote.epubReader.*（api-remotes 生成的客户端面）
    └─ dsh.client.inject: ui-sidebar / ui-layout / ui-context-menu /
       ui-primitives / locale / api-remotes
```

数据流：浏览器选词 → context menu → client 调 `ctx.remote.epubReader.explain()` → Host 组 prompt（选词 + 所在段落上下文 + 书名章节）→ `ctx.llm.stream` → Remote stream 逐块回推 → 右栏卡片流式渲染 → 完成后 client 调 `saveAnnotation` 持久化。

## 4. 关键技术决策

| # | 决策 | 理由与依据 |
|---|---|---|
| 1 | **EPUB 解析放 Host**，客户端只收净化后的章节文档 | 解压/OPF/TOC 解析一次性在 Node 完成；二进制不进浏览器；`Uint8Array` 可走 binary Remote transfer，资源图片走 exact Fetch route |
| 2 | **v1 自定义渲染**：净化后 XHTML 注入主文档容器，应用插件自己的阅读排版，**不加载书内 CSS** | 选区、Range 锚定、右键菜单（`getTriggerProps`）、`<mark>` 高亮全部走原生 DOM，集成成本最低；外语学习场景以文字书为主。书内 CSS 完整还原列为 v2（sandboxed iframe + postMessage 桥） |
| 3 | **净化用白名单**（标签/属性），Host 出净化文档，客户端再过一遍 DOMPurify 双保险 | EPUB 是任意外部文件，必须当不可信内容处理 |
| 4 | **划线锚定 = 章节纯文本偏移**（拼接文本节点算 offset）+ 文本哈希兜底 | 比 EPUB CF 简单一个量级，满足 v1；字号变化/重排后仍稳定；失配时按原文回退搜索 |
| 5 | **LLM 只经 `ctx.llm.stream`**，默认取 `ctx.agentDefaultModel`，插件配置可覆盖 provider/model | 这是仓库明文规定的唯一受支持调用路径；不引入任何自有 API key |
| 6 | **翻译/解释用 `@Remote({mode:'stream'})`** | 右栏逐 token 流式，体验对齐主对话；流结束由 client 主动落库 |
| 7 | **存储用 profile 目录下插件自管目录**（`profileContext.dir` + `.epub-reader/`），JSON 元数据 + 原始 epub 分文件存 | 沿用 plugin-manager 在 profile 内自管 `.plugin-manager/` 的既有惯例；不引入 sqlite 依赖 |
| 8 | **资源路由带护栏**：路径必须解析在书籍目录内（防穿越）、Content-Type 白名单、`CSP: sandbox` + `nosniff` + 私有缓存 | 对齐 plugin-manager detail-file 路由的安全模式 |

## 5. 数据模型与 Remote API

```ts
// 书
interface BookRow { bookId, title, author, language, coverPath?, chapterCount, progress: { chapterIndex, ratio }, importedAt }
// 章（净化后）
interface ChapterDoc { bookId, chapterIndex, title, html /* sanitized, 资源已改写为路由 URL */ }
// 划线
interface Annotation { id, bookId, chapterIndex, start, end /* 纯文本偏移 */, quote, createdAt,
                       results: { kind: 'translate' | 'explain', text, model, createdAt }[] }
```

| Remote 方法 | 形态 | 说明 |
|---|---|---|
| `list()` / `importBook(name, bytes)` / `removeBook(id)` | unary | 导入即解析 + 提取元数据，≤100MB |
| `chapter(bookId, index)` | unary | 返回净化 ChapterDoc |
| `saveProgress` / `listAnnotations` / `saveAnnotation` / `deleteAnnotation` | unary | 持久化 |
| `explain(bookId, chapterIndex, kind, text, signal)` | **stream** | 逐块吐文本增量，终块带 usage/model |

错误码走统一 `RemoteError` 码表：`epub/not-found`、`epub/bad-file`、`epub/too-large`、`epub/anchor-mismatch`、`epub/no-model`。

## 6. Prompt 设计（Host 侧模板，可配置覆盖）

- **翻译**：给书名、章节、原文所在段落（上下文各 ≤1 段、截断保护），指令为「忠实文学翻译，保留语气与修辞，只输出译文」。目标语言默认中文，可配。
- **解释**：同上下文，输出结构为「逐词/短语释义 → 语法结构 → 用法与语域 → 必要的文化背景」，面向语言学习者，使用目标语言书写。
- 选区超长（>2000 字符）时提示改为整段翻译策略，防 token 爆炸。

## 7. 插件配置（Schema）

```yaml
targetLanguage: zh      # 目标语言
provider / model: ''    # 留空跟随 agentDefaultModel
contextParagraphs: 1    # 送入 prompt 的前后段落
maxSelectionChars: 2000
paperMode: auto         # 纸面底色: auto | off
```

## 8. 包结构与开发/交付形态

```text
dsh-epub-reader/
├─ package.json          # dsh.bundle + dsh.client.inject + engines.dsh
├─ cordis.patch.yml      # 两行：host 服务行 + 浏览器行
├─ locale/zh.json en.json
├─ src/
│  ├─ host/  (service.ts, epub/parse.ts, sanitize.ts, store.ts, prompts.ts)
│  └─ client/ (index.ts, Library.tsx, Reader.tsx, NotesPanel.tsx, anchor.ts, store.ts)
└─ tests/ (fixture.epub 解析/净化/锚定单测 + client 组件测试)
```

- 开发：checkout 根 `pnpm dsh web --patch ./dsh-epub-reader/cordis.yml` 起 3080 端口；配合 `pnpm run dev:web` 时 client 插件改动免刷新热更。
- 交付：`dsh plugin add ./dsh-epub-reader`（或发布 npm / GitHub 安装），装进 profile 即全局面板生效。
- 测试：Host 单测（fixture 书解析、净化白名单、路径穿越攻击用例、锚定重定位）；client 用 `@deepseek-ai/dsh-client-test-runtime`；LLM 路径 mock adapter。

## 9. 实施阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 | Host：解析/存储/Remote + client 书架与阅读视图、进度记忆 | 能导书能读 |
| M2 | 选区 → 右键菜单 → explain 流式 → 右栏卡片 + 划线持久化与高亮回显 | 核心闭环 |
| M3 | 目录抽屉、纸面模式、i18n、键盘可达、测试补齐、打包安装验证 | 可交付 |

风险与备选：复杂排版书籍在 v1 自定义渲染下观感降级（备选 v2 iframe 桥）；纯文本偏移锚定在跨段落大范围选区重排后可能失配（哈希 + 搜索兜底，失配卡片降级为「仅笔记不定位」）。

## 已确认决策（2026-11-07）

- 工作区：DSH 源码仓内开发（/Users/lwc/Desktop/code/github/deepseek-harness，dev 分支）。
- v1 渲染：接受「净化 + 自带排版、不加载书籍自带 CSS」。
- 入口：左侧栏新面板（与 Files/Plugins 同级，全局可用）。
