---
description: "Tweet Host Remote: a personal microblog panel whose posts, images, and comments live inside the chosen workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-tweet

English | [中文](README.zh.md)

## Summary

The experimental Tweet panel: publish personal takes as plain text with separately laid out images, Weibo style, and comment under any post without a count limit. Every request names a registered Workspace, and all data — post records (text, images, comments) plus content-addressed image bytes — lives inside that Workspace at `.dsh/tweet/`, so the feed travels with the directory. Posts carry their publish time, the feed shows the newest first, long text folds to three lines, and the composer accepts pasted screenshots. Enable it through the [tweet bundle](../tweet-bundle/README.md); shipped profiles leave it disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Every request names a registered Workspace by id; an unknown id fails loudly as `tweet/unknown-workspace`. Publishing needs text or at least one image (`tweet/empty-post` otherwise) and accepts PNG, JPEG, WebP, and GIF images. Commenting under a post needs non-empty text (`tweet/empty-comment` otherwise) and has no count limit. The panel offers a Workspace selector, a composer with image staging and clipboard paste, text folding to three lines with an expand control, a scrolling feed with the newest post first, an unlimited oldest-first comment list (folded to the newest three until expanded) with an input under every post, in-place text editing, and deletion with confirmation. There is no configuration: image admission keeps the panel's own media-type allowlist and stores bytes as-is.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The store keeps one directory per Workspace: `posts/<tweetId>.json` records — text, image references, and the post's comments — `objects/<sha256>.<ext>` image bytes, and `index.json` holding publish order. Every file replace is write-temp-then-rename, and every mutation of one root runs through a per-root promise chain, so concurrent Remote calls cannot interleave writes. Reads treat the directory as the source of truth — a post file missing from `index.json` after a crash between its two writes still lists — while the index only breaks `createdAt` ties in publish order. Invalid post files are skipped and kept on disk; an invalid index fails the read as `tweet/corrupt-store`. Text and images are separate record fields and the page renders them as separate blocks, so no mixing path exists. Comments are one more record field: appending one atomically rewrites the post record, the list has no count limit and stays oldest first, deleting the post removes its comments with it, and a legacy record without the field reads as zero comments.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel and its Remote serve the human publisher only: they add no tool, prompt section, or Session event, and nothing here changes the model's request context.

#### KV Cache effect

None; every Remote method serves the human panel only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Owner-only access — the panel installs under one `tweet/list` remote-access key; no resource-grant model exists for sharing a Workspace's feed yet.
- Single sort order — the feed always shows `createdAt` descending; no ascending, tag, or search views exist.
- Orphaned image objects — deleting a post removes its record but leaves stored objects for future posts to reuse; no retention pass collects them.
- No pagination — `list` reads every record of the Workspace; personal-scale feeds are the design point.
- Bytes stored as-is — images are neither decoded nor normalized at publish; a corrupt upload renders as a broken image in the browser.

<a id="dev-note"></a>
### Dev Note

One ordering decision worth keeping: publish writes the post record first and prepends the index entry second, and reads treat the directory as the source of truth — so a crash between the two writes orphans a post (still listed) instead of hiding it behind an index entry whose record never landed.
