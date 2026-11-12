---
description: "Local vits-melo ONNX synthesis provider."
kind: "package-provider"
---

# @deepseek-ai/dsh-text-to-speech-sherpaonnx

English | [中文](README.zh.md)

A local speech synthesis provider over sherpa-onnx's `OfflineTts` with the vits-melo zh/en model. It runs in a managed child process (loopback HTTP with a per-process token), downloads and verifies pinned ONNX assets on first use, and reuses warm models until the configured idle deadline.

The provider registers as `vits-melo-local` and accepts the language hints `auto`, `zh` and `en` (the model auto-detects between Chinese and English).
