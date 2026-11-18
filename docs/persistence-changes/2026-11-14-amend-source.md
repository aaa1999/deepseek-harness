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
## Compatibility

Older readers meet the new kind only inside a replacement user/message whose surfaceOp already declares a replace range; readers that do not understand the source kind still fold the surface replacement by its envelope, and any reader that refuses unknown source shapes refuses only that revision turn, never earlier records. Existing records never carry the kind, so both reader directions are safe without a version bump: an old writer's logs stay exactly as before, and a new writer's amend events are ignorable-by-envelope or refused loudly at the single event.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/agent-loop/tests/amend.spec.ts packages/api/session-controller/tests/commands-amend.host.spec.ts packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts: 17 amend tests passed beside the unchanged suites.

<a id="dev-note"></a>
## Dev Note

None.
