/** Generation speed is an estimate from text deltas, not billable token usage. */
export class OutputRateTracker {
  private samples: { at: number; tokens: number }[] = []

  reset() { this.samples = [] }

  record(text: string, now = performance.now()) {
    if (!text || !Number.isFinite(now)) return
    const last = this.samples.at(-1)?.at
    if (last !== undefined && (now < last || now - last > 2_000)) this.reset()
    let tokens = 0
    for (const char of text) {
      tokens += /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u.test(char) ? 0.75 : 0.25
    }
    // One sample per short time bucket bounds memory even with tiny deltas.
    const previous = this.samples.at(-1)
    if (previous && now - previous.at < 50) previous.tokens += tokens
    else this.samples.push({ at: now, tokens })
    this.prune(now)
  }

  rate(now = performance.now()): number | null {
    this.prune(now)
    const first = this.samples[0]
    const last = this.samples.at(-1)
    if (!first || !last || now < last.at || now - last.at > 1_500) return null
    const span = last.at - first.at
    if (span < 600) return null
    // The first delta establishes the start; its arrival has no measured duration.
    return this.samples.slice(1).reduce((sum, sample) => sum + sample.tokens, 0) * 1_000 / span
  }

  private prune(now: number) {
    this.samples = this.samples.filter((sample) => now - sample.at <= 5_000)
  }
}
