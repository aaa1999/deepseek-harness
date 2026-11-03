---
description: "Realtime voice conversation UI."
kind: "package-ui"
---

# @deepseek-ai/dsh-experimental-client-ui-voice-chat

English | [中文](README.zh.md)

The browser voice-chat contribution: a call toggle in the composer tool row and a status row under the composer. While a call runs, the microphone captures continuously, an energy endpoint detector splits speech segments, each segment is transcribed, inserted and submitted automatically, replies are read aloud, and speech onset interrupts playback and the active turn.

The UI mounts the generated speech recognition and synthesis Remotes itself and stays out of stable API Remotes.
