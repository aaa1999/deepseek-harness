# Voice chat details

This optional bundle composes speech recognition (SenseVoice), speech synthesis (vits-melo), their authenticated Remotes and the voice-chat browser UI. Shipped profiles leave it disabled.

Enable the bundle from Plugins in the Web sidebar, then open its details to download and prepare both models: the SenseVoice recognizer and the vits-melo synthesizer. Preparation downloads verified ONNX models once; subsequent use reuses the cache. The microphone control opens a voice call: speak continuously, each sentence is recognized and submitted automatically, replies are read aloud, and speaking interrupts the reading.
