---
description: "Enable experimental voice chat from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes speech recognition (SenseVoice), speech synthesis (vits-melo), authenticated Remotes and the voice-chat browser UI. Shipped profiles leave it disabled.

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

Open Plugins in the Web sidebar and enable Voice Chat. If models need preparation, a dialog offers Go to setup or Later; open the bundle details to download and prepare both models. Once ready, click the microphone call control between the model selector and Send. The call listens continuously: each spoken sentence is transcribed, inserted and submitted automatically, replies are read aloud, and speaking interrupts playback and the active turn. The status row under the composer shows the current phase; click Stop to end the call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

The static `cordis.patch.yml` inserts seven rows: the speech-to-text service with `sensevoice-local` selected, the SenseVoice provider with its `dshHomePath` cache directory, the recognition Remote, the speech synthesis service with `vits-melo-local` selected, the sherpa-onnx provider with its `dshHomePath` cache directory, the synthesis Remote, and the voice-chat browser UI. Optional-bundle installation makes the package available to management without selecting it in default profiles. Each row's package owns its behavior; the bundle adds no code.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice chat subsystem](../../../docs/subsystems/voice-chat.md)

[Manage optional plugins](../../client/ui-plugin-manager/README.md#use-this-package)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the composed voice-chat UI; transcribed speech auto-submits as ordinary user messages.

#### KV Cache effect

No direct effect; submitted transcripts follow the conversation's ordinary message history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- First use downloads roughly 240 MB of SenseVoice plus 170 MB of vits-melo model data; disk and time costs are reported during preparation.
- Browser energy endpointing depends on a quiet-enough environment; SenseVoice's internal Silero segments again for precision.
- Do not enable together with the voice-input bundle: both insert the same speech-to-text rows (identical configuration, so the composition stays valid).

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details</summary>

None.

</details>
