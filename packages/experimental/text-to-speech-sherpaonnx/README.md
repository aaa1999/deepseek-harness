---
description: "Local vits-melo speech synthesis in a managed process."
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech-sherpaonnx

English | [中文](README.zh.md)

## Summary

This provider synthesizes Chinese and English speech locally through sherpa-onnx `OfflineTts` with the vits-melo model, registered as `vits-melo-local`. First use downloads and verifies the pinned model; later syntheses reuse the warm worker process until it idles out. Synthesis runs on the Host machine.

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

Load through the [voice chat bundle](../voice-chat-bundle/README.md), or compose with the speech synthesis Service Definition and the `subprocess` service. `dataRoot` is a required absolute directory for verified model files; the bundle supplies one under the DSH home. `modelDirectory` supplies an existing absolute directory with the model, lexicon and tokens and skips the download; its contents remain the deployer's responsibility.

Preparation downloads the release-pinned archive, trying configured `archiveUrls` mirrors before the pinned GitHub Releases URL, and every candidate must match the pinned size and SHA-256 hash. The archive is extracted with the platform `tar`, and the model files publish atomically. Verified caches restore readiness without downloading again. Language hints are `auto`, `zh` and `en`; the model auto-detects between Chinese and English. `threads`, `speed`, `noiseScale`, `noiseScaleW` and `lengthScale` tune CPU use and pronunciation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

Inference runs in a managed child process reached over loopback HTTP with a per-process token; the worker publishes its port on stdout before serving one JSON request per synthesis. Activation inspects disk caches without downloading or loading models. The first synthesis wakes the worker; `idleTimeoutMs` (default 5 minutes) stops it again, `maxPending` (default 4) bounds the queue, and disposal joins accepted work. `maxTextBytes`, `maxAudioBytes`, `prepareTimeoutMs`, `synthesisTimeoutMs` and `graceMs` bound intake, output and process lifetimes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice chat subsystem](../../../docs/subsystems/voice-chat.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as local synthesis turns caller-supplied text into audio without adding model requests or Session events.

#### KV Cache effect

No direct effect; synthesized audio never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- CPU only. Native packages target macOS arm64/x64, Linux glibc arm64/x64 and Windows x64; other platforms fail at activation. First-use preparation downloads a 167 MB archive containing a 170 MB model, a 6.8 MB lexicon and tokens; setup estimates 400 MB of disk and memory and 1 to 10 minutes. Disabling the plugin retains model caches.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details</summary>

None.

</details>
