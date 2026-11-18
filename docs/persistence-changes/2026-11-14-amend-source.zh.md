---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-14-amend-source

[English](2026-11-14-amend-source.md) | 中文

## 概述

新增 'amend' 用户消息 source kind：对已发送消息的修订，以 user/message surface 替换落盘。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-14-amend-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "75f4c93b44a5a231de6c57857be01b1140dcac5fd045b51f7c7948979e496a45"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "78d59e50904fa0771d231bfe54c131c5753e2dc3d60f2e854ba26e430b695892"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "b451ec63ddb35802cc6f47df1d3a18622157bab598c815579aee39e8e55ad125"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "0c392ac299d07b4d77d68c320e9ece80fd30637a1f150d7cbc121a3096026b80"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧读取者只会在携带 replace surfaceOp 的替换型 user/message 中遇到该 kind；不理解该 source kind 的读取者仍按事件封套折叠 surface 替换，拒绝未知 source 形状的读取者也只拒绝这一条修订事件，不影响更早记录。既有记录不携带该 kind，双向读取均安全，无需提升版本：旧写入者的日志保持原样，新写入者的 amend 事件可按封套忽略或仅在单事件处显式拒绝。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/core/agent-loop/tests/amend.spec.ts packages/api/session-controller/tests/commands-amend.host.spec.ts packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts：amend 相关 17 个测试与既有套件全部通过。

<a id="dev-note"></a>
## 开发备注

无。
