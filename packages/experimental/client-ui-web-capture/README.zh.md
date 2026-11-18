---
description: "浏览器中继与配套 Chromium 扩展：把网页快照归档进 PDF 阅读书架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-capture

[English](README.md) | 中文

## 概述

把任意网页变成 PDF 存入 Harness 书架。随包的 Chromium 扩展按屏幕观感抓取页面并保留可选中的文字层，浏览器中继把快照归档进 PDF 书库并在那里打开。配对零配置：中继在 GUI 页面的 localStorage 中保存令牌，扩展的 content script 只在 GUI 源上注入令牌。Host 书库服务 `dsh-pdf-reader` 存储结果；`dsh-web-capture-bundle` 组合整套能力。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

把 [`dsh-web-capture-bundle`](../web-capture-bundle/README.zh.md) 安装进 Web profile，让中继与 PDF 阅读器一起运行，再在 Chrome 中一次性加载配套扩展：打开 `chrome://extensions`，开启开发者模式，以解压方式加载本包的 `extension/` 目录。中继为实验性插件，只在 PDF 阅读器的 Remote 命名空间挂载期间应答。

### 抓取网页

点击扩展图标，选择长页或 A4 纸张与可选的宽度覆盖，然后抓取。深度捕获默认开启，会在打印前整页滚动一遍触发懒加载内容；canvas 和视频元素冻结为当前帧。调试器附加期间浏览器会显示「正在调试此浏览器」横幅。成功后 GUI 切换到 PDF 面板并直接打开快照；书架卡片显示快照日期并保留来源 URL。模式、宽度、深度捕获和 GUI 地址在扩展中持久保存。

### 配对原理

中继在 GUI 页面的 localStorage 中生成一个随机令牌并跨刷新保留。扩展的 content script 只注册在 `127.0.0.1` 和 `localhost` 源上，在扩展与 GUI 页面之间转发抓取信封并在穿越时注入令牌，因此令牌不离开 GUI 源。应答按原路返回：每个分片一条回执，最后一条终态结果。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口注入已挂载的 `remote.pdfReader` 命名空间和布局服务，随后在插件运行期间应答标记为 `dsh-web-capture` 的 `window.postMessage` 信封。`CaptureRelay` 类不依赖传输和框架：校验类型化的 begin 和 chunk 信封，重组 base64 主体，并通过 `pdfReader.importBook` 以页面 URL 和抓取时间作为来源记录归档完成的 PDF。它严格一次应答一个抓取，并以扩展映射为文案的类型化错误码报告失败。

扩展的 service worker 通过 Chrome DevTools 协议完成抓取：可选的设备宽度覆盖、最多 40 屏的深度滚动、把 canvas 和视频替换为 PNG 帧的媒体冻结、模拟 `screen` 媒体，以及带背景、零边距并输出带标签 PDF 以保留可选文字的 `Page.printToPDF`。长页模式打印一张按 Chromium 200 英寸边长钳位的 1:1 页面，更高的内容分页到后续长页；A4 模式为媒体和表格追加 break-inside 避免。base64 主体分片投递并逐片回执；纯规划逻辑位于共享模块，本包的测试在纯 Node 下运行。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：中继作用域与消息接线 |
| [`src/client/relay.ts`](src/client/relay.ts) | 抓取重组与书库导入 |
| [`src/client/protocol.ts`](src/client/protocol.ts) | 信封词汇与错误码 |
| [`extension/background.js`](extension/background.js) | CDP 抓取、冻结、打印与投递 |
| [`extension/shared/capture-params.js`](extension/shared/capture-params.js) | 纯粹的纸张、分片与滚动规划 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [网页快照 Bundle](../web-capture-bundle/README.zh.md) — 组合出的 profile 层。
- [PDF 书库服务](../pdf-reader/README.zh.md) — 快照的存储位置。
- [浏览器阅读面板](../client-ui-pdf-reader/README.zh.md) — 接收快照的书架。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

无，因为中继只重组扩展快照并归档进 PDF 书库；之后的处理请求属于 Host 阅读服务。

#### KV 缓存影响

没有影响；归档快照写入的是存储，不是模型请求。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 配套扩展仅支持 Chromium 系（Manifest V3，Chrome 116 及以上）；抓取需附加 Chrome DevTools 协议调试器，目标页开着 DevTools 时无法附加，抓取期间浏览器会显示调试横幅。
- 长页模式超过 Chromium 200 英寸纸边的页面会分成多张长页，固定定位元素可能在分页上重复。
- 中继一次只应答一个抓取，拒绝超过 100 MiB 或 2048 个分片的抓取，并在 60 秒无活动后丢弃未完成的抓取。
- 扩展只能到达 `127.0.0.1` 和 `localhost` 上的 GUI 源；中继没有通往其他源的路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
