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
## Compatibility

Older readers meet the new kind only inside a replacement user/message whose surfaceOp already declares a replace range; readers that do not understand the source kind still fold the surface replacement by its envelope, and any reader that refuses unknown source shapes refuses only that revision turn, never earlier records. Existing records never carry the kind, so both reader directions are safe without a version bump: an old writer's logs stay exactly as before, and a new writer's amend events are ignorable-by-envelope or refused loudly at the single event.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/agent-loop/tests/amend.spec.ts packages/api/session-controller/tests/commands-amend.host.spec.ts packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts: 17 amend tests passed beside the unchanged suites.

<a id="dev-note"></a>
## Dev Note

None.
