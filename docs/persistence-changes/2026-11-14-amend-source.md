---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-14-amend-source

English | [中文](2026-11-14-amend-source.zh.md)

## Summary

Adds the 'amend' user-message source kind: a revision of an earlier sent message that lands as a user/message surface replacement.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-14-amend-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "64e7d6d0894e22bcdd549e97e960f6666eb40476665b821d50c3eca083cb14fd"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "03a5b58a9e4aba42cc0a05e6d59591a65b31d29e8c5b9fa2b337a77a84ceefa1"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "3261154bfda7f9ba63ad422ae663f683bff164c9a1b15285d8720cfd1d324883"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "b00947979c6e2af072c702ff37cc1cc09aacfa87a70a14a07da4570463122faa"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Older readers meet the new kind only inside a replacement user/message whose surfaceOp already declares a replace range; readers that do not understand the source kind still fold the surface replacement by its envelope, and any reader that refuses unknown source shapes refuses only that revision turn, never earlier records. Existing records never carry the kind, so both reader directions are safe without a version bump: an old writer's logs stay exactly as before, and a new writer's amend events are ignorable-by-envelope or refused loudly at the single event.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/agent-loop/tests/amend.spec.ts packages/api/session-controller/tests/commands-amend.host.spec.ts packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts: 17 amend tests passed beside the unchanged suites.

<a id="dev-note"></a>
## Dev Note

None.
