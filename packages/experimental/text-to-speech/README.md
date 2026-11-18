---
description: "Named experimental speech synthesis providers and cancellation ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition selects named speech synthesizers through `ctx.textToSpeech`. Consumers resolve their text to one provider before execution; providers register independently. Synthesis turns text into WAV audio and never activates or submits to an Agent.

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

Load through the [voice chat bundle](../voice-chat-bundle/README.md), or compose the service with a provider and consumer. `defaultProvider` is required and selects an exact registered id; the bundle supplies `vits-melo-local`. `language` supplies the omitted language hint and defaults to `auto`. A missing or duplicate provider fails explicitly.

Providers advertise preparation origins through `downloadSources`. `prepare(id, options)` starts or joins provider-owned preparation, and `cancelPreparation(id)` cancels it without tying it to a browser connection. `configure(patch)` persists the selected provider and language through the `settings` service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

`resolve()` captures the provider instance, text and language. `synthesize()` rejects a withdrawn or replaced registration. A registration disposer closes admission, aborts accepted requests and joins provider settlement; providers must honor cancellation. No fallback selects a different synthesizer or sends text elsewhere.

`defaultProvider` and `language` are volatile Config fields: `configure()` writes the supplied fields into this plugin's profile entry through the `settings` service, and the running instance reads the updated values without remounting; composition defaults apply until an override is saved. Settings addresses the entry by its configured id (`entry.options.id`), without the Loader's Include path. `configure()` fails without `settings` or a profile entry, and rejects a language unsupported by the selected provider before saving. Provider-owned preparation is observed through complete `SynthesisSnapshot` values; closing an observer never cancels preparation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice chat subsystem](../../../docs/subsystems/voice-chat.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis consumes caller-supplied text without adding model requests or Session events.

#### KV Cache effect

No direct effect; synthesized audio never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only complete-text synthesis is supported. The service has no streaming synthesis or recognition methods.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details</summary>

None.

</details>
