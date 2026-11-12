---
description: "实时语音通话界面。"
kind: "package-ui"
---

# @deepseek-ai/dsh-client-ui-voice-chat

[English](README.md) | 中文

浏览器端语音通话组件：输入框工具行中的通话按钮与输入框下方的状态行。通话期间麦克风持续采集，能量断句检测切分语音段，每段识别后自动插入并提交，回复自动朗读，开口说话即打断朗读与当前回合。

该 UI 自行挂载生成的语音识别与合成 Remote，不进入稳定 API Remote。
