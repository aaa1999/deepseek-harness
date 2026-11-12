---
description: "Enable experimental voice chat from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes speech recognition (SenseVoice), speech synthesis (vits-melo), authenticated Remotes and the voice-chat browser UI. Shipped profiles leave it disabled.

## Use this package

Open Plugins in the Web sidebar and enable Voice Chat. If models need preparation, a dialog offers Go to setup or Later; open the bundle details to download and prepare both models. Once ready, click the microphone call control between the model selector and Send. The call listens continuously: each spoken sentence is transcribed, inserted and submitted automatically, replies are read aloud, and speaking interrupts playback and the active turn. The status row under the composer shows the current phase; click Stop to end the call.

## Known Limitations

- First use downloads roughly 240 MB of SenseVoice plus 170 MB of vits-melo model data; disk and time costs are reported during preparation.
- Browser energy endpointing depends on a quiet-enough environment; SenseVoice's internal Silero segments again for precision.
- Do not enable together with the voice-input bundle: both insert the same speech-to-text rows (identical configuration, so the composition stays valid).
