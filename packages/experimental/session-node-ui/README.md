---
description: "Browser surfaces for saving session nodes and forking sessions from them."
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-node-ui

English | [中文](README.zh.md)

## Summary

Session Node UI adds four browser surfaces over the host Session Node service: a dock above the composer that saves the current session and forks from a saved node, a pin in assistant message actions that saves that turn, a sidebar manager for saved nodes, and a New Session chip that starts from a node. Every list shows only the current project's nodes. Install it together with the `dsh-session-node` bundle; forking opens the new session immediately.

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

The verified install path — the host bundle provides the service this surface calls:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node-ui
```

### What you get

- **Composer dock**: type a title and select Save to save the current session's latest completed node. The chip menu lists this workspace's saved nodes; the fork button starts a new session from the selected node, and the delete button removes it.
- **Turn pin**: the pin in an assistant message's action row saves that turn's inclusive boundary, titled after the session's display title and the turn number, for example `Fix login #3`. The glyph shows a check for two seconds after saving.
- **Sidebar manager**: **Saved nodes** in the sidebar lists this workspace's nodes. Select a row's title to fork from it; hover for rename (an inline editor, Enter saves) and delete. In the collapsed rail the section renders one expand control.
- **New Session picker**: when the staged session's workspace has saved nodes, the **From a node** chip in New Session offers them; picking one forks and opens the child session immediately.

Every node-addressing surface shows only the nodes of its session's workspace; nodes saved without a resolved workspace appear only while the current context has no workspace either. Failures report inline beside the control that triggered them, and every verb disables while one is running.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The host half of the plugin is an empty `apply` that only makes the row visible to the Loader; the browser half ships through the package's `dsh.client` declaration and its `./client` export. It mounts the generated `sessionNodes` Remote itself, then registers the four slot entries — `sidebar.sections`, `conversation.chat.assistant-actions`, `conversation.hero.options`, and `conversation.input.dock` — in a scope that resolves `remote.sessionNodes`.

A registry-revision counter bumps after every successful save, rename, or delete from any surface so every other surface refreshes; it is a hand-rolled subscribe/getSnapshot pair, because a full snapshot store would pull a state engine into the bundle for one number. A successful fork opens the child through `ctx.uiWorkspace.openSession`. Workspace scoping lives in one shared filter: a node matches its surface's workspace id, and a workspace-less node matches only a workspace-less context.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Session Node service and commands](../session-node/README.md#use-this-package)

[Manage optional plugins](../../client/ui-plugin-manager/README.md#use-this-package)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host `sessionNodes` Remote the four surfaces drive; `dsh-session-node` owns the saved nodes and the inherited history a forked child session later submits.

#### KV Cache effect

None; the browser surfaces never assemble or send provider requests. A forked child session's requests are owned by `dsh-session-node`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The surfaces need the host `@deepseek-ai/dsh-session-node` bundle in the same profile; without it, every verb fails with a Remote error.
- The sidebar list follows the main-view session's workspace; while a global panel covers the conversation, it shows only nodes saved without a resolved workspace.
- The turn pin appears only on the closing message of a turn that records a settled turn tail, and only with the `sessionNodes/save` access grant.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
