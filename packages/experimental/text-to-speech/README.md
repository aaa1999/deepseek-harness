---
description: "Experimental speech synthesis service."
kind: "package-service"
---

# @deepseek-ai/dsh-text-to-speech

English | [中文](README.zh.md)

The speech synthesis Service Definition: a provider registry that lets one Host composition own several selectable synthesizers. `SpeechSynthesizer.synthesize(text, signal)` turns one text into canonical PCM16 WAV bytes; preparation, selection and cancellation mirror the speech-to-text service. Synthesis never activates or submits to an Agent.

See the [voice chat subsystem](../../../docs/subsystems/voice-chat.md) for the composed behavior.
