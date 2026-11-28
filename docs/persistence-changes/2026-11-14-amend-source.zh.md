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
    previous: "2026-11-19-cua-input-notices"
    after: "dedc5e5861ebce3d34bf730897a1a89953485f39c893aefffec6b8c89f2f1c5d"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-19-cua-input-notices"
    after: "da0640ce2ea79de2b71ff682e63c8d096448bb2977d63cd7e4ef376c646a4826"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-19-cua-input-notices"
    after: "0c07cc9b3f0dad09403b3093791afb0b80556455fa571ae59c926f25fb302761"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-19-cua-input-notices"
    after: "150e301dbc68b105a6a52d1aef5d088562dd82a32e79b483e7225a8249b599cc"
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
