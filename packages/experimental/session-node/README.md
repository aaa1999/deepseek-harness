---
description: "Save a session checkpoint under its project and fork a new session from it later."
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-node

English | [中文](README.zh.md)

## Summary

Session Node saves a named checkpoint of a session — its history through the latest completed turn — under the session's project (workspace), and forks a new session from that checkpoint later. The `/save-node`, `/nodes`, `/fork-node`, `/rename-node`, and `/delete-node` commands work in every session of a profile that installs the bundle. Saved nodes survive restarts in global storage, each recording its source session, boundary, title, and optional note. The browser surfaces in `dsh-session-node-ui` and any host plugin drive the same `ctx.sessionNodes` service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

The verified install path:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node
dsh plugin --profile <name> remove @deepseek-ai/dsh-session-node
```

The patch inserts two rows — the `ctx.sessionNodes` service and the command plugin — as a global layer, so both load in every profile that installs the bundle and the commands are available in every session and project.

### What you get

Type the commands in an interactive client's message box:

- `/save-node [title]` saves the current session's latest completed-turn prefix under its project. An omitted title defaults to `node-<timestamp>`; an optional note and an exact boundary (`atSeq`) can be supplied by a programmatic caller.
- `/nodes` lists every saved node: id, title, source session and boundary seq, project, and note.
- `/fork-node <id-or-title>` creates a child session that inherits the saved prefix exactly, attaches it to the source's project, and prints the new session id.
- `/rename-node <id-or-title> <new-title>` renames a saved node.
- `/delete-node <id-or-title>` deletes a saved node.

A selector matches by exact id, id prefix, or case-insensitive title; the first — most recently saved — match wins. Host plugins call `ctx.sessionNodes` in-process; GUI clients reach the same operations through the `ctx.remote.sessionNodes` namespace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Saved nodes are global registry state, so they persist through a durable storage domain (`session_nodes`, version 1) — one `nodes` table keyed by node id plus an `order` global listing ids newest first — not through a session event log. Startup opens the domain and rebuilds an in-memory cache; reads are synchronous from the cache and every mutation persists through the domain write chain.

Save resolves the owning workspace by registry membership, then by the source header's `cwd`. The omitted boundary defaults to the latest completed-turn prefix, including standalone events before the next turn begins, so a saved node is always a stable between-turn position. Fork composes the child agent from the source session's preset — mirroring the session controller — inherits the prefix through `inheritedEventCount` with synthetic closers for an open turn, and attaches the child to the workspace.

The service is also the Remote owner of `ctx.remote.sessionNodes`; the wire export is `delete` because `remove` is reserved by the client's Remote namespace service.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Commands registry](../../interaction/commands/README.md)

[Browser surfaces](../session-node-ui/README.md#use-this-package)

[Session log and fork](../../core/session/README.md)

[Manage optional plugins](../../client/ui-plugin-manager/README.md#use-this-package)

-----

<a id="model-experience"></a>
## Model Experience

### Human node commands

#### What the model sees

`/save-node`, `/nodes`, `/fork-node`, `/rename-node`, and `/delete-node` run in the human command plane: neither the slash input nor the direct success or error text enters a model request. Each admitted run is recorded as `command/run` and `command/done` lifecycle events in the source session's log. [dsh-commands](../../interaction/commands/README.md) owns dispatch and admission.

#### Token effect

None. Command discovery, node mutations, and direct output add no model tokens.

#### KV Cache effect

None. Node registry state lives in the storage domain and command records are log-only; neither ever enters a request, so nothing here can invalidate cache reuse.

### Forked session history

#### What the model sees

A fork creates a child session whose conversation prefix is the saved boundary's prefix: the source session's message events through `atSeq`, then the inherited-cut marker and synthetic closers for an open turn. The child's requests carry that prefix as ordinary history; the source session's requests are unchanged.

#### Token effect

Forking adds no tokens by itself. The child pays the inherited prefix as ordinary conversation tokens on its own requests; saving, listing, renaming, and deleting nodes add none.

#### KV Cache effect

The inherited prefix is stable message history in the child session and grows append-only as the child continues. The source session's reusable request prefixes are untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A node outlives its source session. Deleting the source session leaves the node listed, and a later fork fails with `SESSION_NODE_SESSION_NOT_FOUND`; a boundary no longer present in the source log fails with `SESSION_NODE_STALE`.
- Saving needs a completed turn. A session without `turn/end` fails with `SESSION_NODE_INVALID_BOUNDARY`, and an explicit `atSeq` must address an existing event seq.
- `/fork-node` prints the new session id and opens nothing; opening the child session belongs to a UI such as [session-node-ui](../session-node-ui/README.md#use-this-package).
- Command selectors take the first match by exact id, id prefix, or case-insensitive title; an ambiguous title resolves to the most recently saved node.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
