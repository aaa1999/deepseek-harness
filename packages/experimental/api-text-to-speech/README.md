---
description: "Authenticated experimental speech synthesis for browser clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

English | [中文](README.zh.md)

## Summary

This Remote serves the synthesis capability to authenticated browser clients through `ctx.speechSynthesisController`. Clients read the provider catalog, follow readiness, save preferences, control preparation, and synthesize text to base64 WAV within configured limits. Calls never activate or submit to an Agent.

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

Compose with the speech synthesis Service Definition and Typert. `maxTextBytes` and `maxAudioBytes` limit accepted text and returned audio. The browser UI mounts this package's generated `/remote` contribution when enabled.

Empty text and oversized text fail with `speech/invalid-text`; provider failures surface as `speech/synthesis-failed`. `prepare(providerId, { downloadSource })` forwards one advertised source to the provider; omission keeps its configured policy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

`catalog()` and `follow()` merge the service snapshot with the configured limits, so one subscription reports providers, selection and bounds together. `synthesize()` validates text before resolving through the service and returns canonical base64 WAV with audio and synthesis durations. Cancellation through the Remote signal or contribution disposal propagates to the provider.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice chat subsystem](../../../docs/subsystems/voice-chat.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis transports caller-supplied text without adding model requests or Session events.

#### KV Cache effect

No direct effect; synthesized audio never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No streaming protocol or persistent synthesis history is exposed. Base64 adds transport overhead; text and audio remain bounded by the configured limits.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details</summary>

None.

</details>
