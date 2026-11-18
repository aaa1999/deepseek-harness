---
description: "Hold a realtime voice conversation with continuous capture and spoken replies."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-chat

English | [中文](README.zh.md)

## Summary

This optional browser plugin adds a call control to the composer. During a call the microphone stays open: each completed speech segment is transcribed and submitted automatically, replies are read aloud, and speaking interrupts playback and the active turn. A status row under the composer shows the current phase.

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

Enable the [voice chat bundle](../voice-chat-bundle/README.md) from Plugins. The call control is usable only while the selected recognizer and synthesizer report prepared; before that, it opens the bundle setup. Start a call with the control and end it with Stop.

Each spoken segment is transcribed, inserted into the draft and submitted as an ordinary message. A changed draft declines insertion and the call keeps listening. When a turn finishes, the newest assistant message that was not interrupted is read aloud once, truncated to 500 characters. Speaking again stops playback and cancels the running turn, so the next spoken message can submit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

One `VoiceChatSession` state machine per call moves through `off → ready → listening → transcribing → thinking → speaking`. `MediaRecorder` emits 250 ms frames; an adaptive energy detector above the tracked noise floor starts and ends speech, keeps pre-roll and caps a segment at 45 seconds; completed segments are resampled to 16 kHz PCM16 WAV. The plugin mounts the generated speech and synthesis Remotes itself and stays out of stable API Remotes. One reconnecting readiness mirror serves both directions, and browser `AudioContext` playback owns the spoken audio.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice chat subsystem](../../../docs/subsystems/voice-chat.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the ordinary composer submission of each transcript; replies it reads aloud are already-logged assistant text.

#### KV Cache effect

No direct effect; transcripts follow the conversation's ordinary message history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Browser energy endpointing depends on a quiet-enough environment; segments are capped at 45 seconds and replies are truncated to 500 characters per synthesis. There is no wake word, streaming captions or transcript editing before submission.
- Interrupted assistant messages are never read aloud, and recognition text is submitted without review; check the conversation transcript to verify what was sent.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details</summary>

None.

</details>
