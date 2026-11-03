/** Browser-owned WAV playback with immediate stop. */

/** One cancellable audio playback. */
export class SpeechPlayer {
  private context: AudioContext | undefined
  private source: AudioBufferSourceNode | undefined

  /**
   * Decode and play complete PCM16 WAV bytes.
   * @param bytes - canonical WAV bytes.
   * @returns when playback finishes or is stopped.
   */
  async play(bytes: Uint8Array): Promise<void> {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
    const copy = bytes.slice().buffer
    const buffer = await this.context.decodeAudioData(copy)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    this.source = source
    await new Promise<void>((resolve) => {
      source.onended = () => { resolve() }
      source.start()
    })
  }

  /** Stop the current playback immediately; a pending play() settles. */
  stop(): void {
    const source = this.source
    this.source = undefined
    if (source) try { source.stop() } catch (_error) { /* already stopped */ }
  }

  /** Release the shared AudioContext. */
  async dispose(): Promise<void> {
    this.stop()
    const context = this.context
    this.context = undefined
    try { if (context && context.state !== 'closed') await context.close() } catch (_error) { /* closing is best effort */ }
  }
}
