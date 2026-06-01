/**
 * #602 — On-Device Generative AI Prompt Suggestions
 *
 * Runs a quantised distilled SLM (ONNX) entirely on-device via
 * ONNX Runtime React Native. No API keys, no network calls.
 *
 * Model: a small GPT-2-distil / TinyLlama ONNX export bundled with the app.
 * The model file is expected at: assets/models/prompt-slm.onnx
 *
 * Usage:
 *   const engine = await PromptSuggestionEngine.getInstance()
 *   const suggestions = await engine.suggest("I want to build a")
 *   // → ["I want to build a mobile app", "I want to build a website", ...]
 */

import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'

// ── Tokeniser (minimal BPE-free whitespace tokeniser for demo) ────────────────
// In production swap this for a bundled tiktoken/sentencepiece WASM build.
const VOCAB_SIZE = 50257 // GPT-2 vocab size
const MAX_INPUT_TOKENS = 32
const MAX_NEW_TOKENS = 8
const TOP_K = 5

function naiveTokenise(text: string): number[] {
  // Deterministic char-code hash into vocab range – good enough for
  // demonstrating the pipeline; replace with real tokeniser in production.
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-MAX_INPUT_TOKENS)
    .map((word) => {
      let h = 5381
      for (let i = 0; i < word.length; i++) {
        h = ((h << 5) + h) ^ word.charCodeAt(i)
      }
      return Math.abs(h) % VOCAB_SIZE
    })
}

function naiveDetokenise(ids: number[]): string {
  // Reverse mapping placeholder – replace with real vocab lookup.
  const words = ['app', 'website', 'platform', 'tool', 'service',
    'feature', 'system', 'dashboard', 'portfolio', 'project']
  return ids.map((id) => words[id % words.length]).join(' ')
}

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits)
  const exps = logits.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((v) => v / sum) as unknown as Float32Array
}

function sampleTopK(probs: Float32Array, k: number): number {
  // Pick the top-k indices and sample proportionally.
  const indexed = Array.from(probs).map((p, i) => ({ p, i }))
  indexed.sort((a, b) => b.p - a.p)
  const topK = indexed.slice(0, k)
  const total = topK.reduce((s, x) => s + x.p, 0)
  let r = Math.random() * total
  for (const { p, i } of topK) {
    r -= p
    if (r <= 0) return i
  }
  return topK[0].i
}

// ── Engine ────────────────────────────────────────────────────────────────────
export class PromptSuggestionEngine {
  private static instance: PromptSuggestionEngine | null = null
  private session: InferenceSession | null = null
  private ready = false

  private constructor() {}

  static async getInstance(): Promise<PromptSuggestionEngine> {
    if (!PromptSuggestionEngine.instance) {
      PromptSuggestionEngine.instance = new PromptSuggestionEngine()
      await PromptSuggestionEngine.instance.load()
    }
    return PromptSuggestionEngine.instance
  }

  private async load(): Promise<void> {
    try {
      // Resolve the bundled ONNX model asset
      const [asset] = await Asset.loadAsync(
        require('../../assets/models/prompt-slm.onnx'),
      )
      const modelUri = asset.localUri ?? asset.uri
      this.session = await InferenceSession.create(modelUri, {
        executionProviders: ['nnapi', 'cpu'], // NNAPI on Android, CPU fallback
      })
      this.ready = true
    } catch (err) {
      console.warn('[PromptSuggestionEngine] Failed to load ONNX model:', err)
      // Graceful degradation – suggest() will return [] when not ready
    }
  }

  /**
   * Generate up to `count` prompt completions for the given partial text.
   * Operates entirely on-device; returns [] if the model is not loaded.
   */
  async suggest(partial: string, count = 3): Promise<string[]> {
    if (!this.ready || !this.session) return []

    const inputIds = naiveTokenise(partial)
    if (inputIds.length === 0) return []

    const suggestions: string[] = []

    for (let s = 0; s < count; s++) {
      const generated: number[] = []
      let currentIds = [...inputIds]

      for (let step = 0; step < MAX_NEW_TOKENS; step++) {
        const inputTensor = new Tensor(
          'int64',
          BigInt64Array.from(currentIds.map(BigInt)),
          [1, currentIds.length],
        )

        const feeds: Record<string, Tensor> = { input_ids: inputTensor }
        const results = await this.session.run(feeds)

        // Expect logits shape [1, seq_len, vocab_size]
        const logits = results['logits']?.data as Float32Array | undefined
        if (!logits) break

        const vocabSize = VOCAB_SIZE
        const lastLogits = logits.slice(
          logits.length - vocabSize,
          logits.length,
        )
        const probs = softmax(lastLogits)
        const nextToken = sampleTopK(probs, TOP_K)

        generated.push(nextToken)
        currentIds = [...currentIds, nextToken].slice(-MAX_INPUT_TOKENS)

        // Stop on EOS token (50256 for GPT-2)
        if (nextToken === 50256) break
      }

      if (generated.length > 0) {
        suggestions.push(`${partial} ${naiveDetokenise(generated)}`.trim())
      }
    }

    return suggestions
  }

  /** Release the ONNX session and allow GC. */
  dispose(): void {
    this.session?.release()
    this.session = null
    this.ready = false
    PromptSuggestionEngine.instance = null
  }
}
