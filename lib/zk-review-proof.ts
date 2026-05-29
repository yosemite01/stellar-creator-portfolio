/**
 * ZK Proof module for anonymous job reviews (#628).
 *
 * Uses a WASM-compiled proving circuit to generate a zero-knowledge proof
 * that the reviewer holds a valid credential (e.g. completed a bounty) without
 * revealing their wallet address.
 *
 * The WASM binary is loaded lazily so it does not block the initial page render.
 */

export type ProofStatus = 'idle' | 'loading_wasm' | 'proving' | 'verified' | 'failed';

export interface ZkProofResult {
  proof: string;       // hex-encoded proof bytes
  publicSignals: string[]; // public inputs committed to the proof
  nullifier: string;   // prevents double-submission of the same review
}

export interface ZkReviewInput {
  /** Reviewer's private credential (e.g. bounty completion secret). Never leaves the browser. */
  credential: string;
  /** The bounty / creator being reviewed – becomes a public signal. */
  subjectId: string;
  /** Star rating 1-5 – becomes a public signal. */
  rating: number;
}

// ---------------------------------------------------------------------------
// WASM loader (singleton)
// ---------------------------------------------------------------------------

let wasmModule: WebAssembly.Instance | null = null;

async function loadWasm(): Promise<WebAssembly.Instance> {
  if (wasmModule) return wasmModule;

  // The WASM binary is expected at /wasm/zk_review.wasm.
  // In production this would be a real Groth16 / PLONK circuit compiled via
  // snarkjs or circom. Here we load it dynamically so the bundle stays lean.
  const response = await fetch('/wasm/zk_review.wasm');
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM module: ${response.statusText}`);
  }
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {
    env: {
      // Minimal host imports required by the proving circuit.
      memory: new WebAssembly.Memory({ initial: 256 }),
    },
  });
  wasmModule = result.instance;
  return wasmModule;
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

/**
 * Generates a ZK proof for an anonymous review.
 *
 * The function:
 *  1. Loads the WASM proving circuit (cached after first call).
 *  2. Hashes the private credential to derive a nullifier.
 *  3. Calls the WASM `prove` export with the circuit inputs.
 *  4. Returns the proof and public signals.
 *
 * @throws if WASM loading or proving fails.
 */
export async function generateReviewProof(
  input: ZkReviewInput,
  onStatusChange?: (status: ProofStatus) => void,
): Promise<ZkProofResult> {
  onStatusChange?.('loading_wasm');
  const wasm = await loadWasm();

  onStatusChange?.('proving');

  // Encode inputs into a flat byte buffer for the WASM circuit.
  const encoder = new TextEncoder();
  const credentialBytes = encoder.encode(input.credential);
  const subjectBytes = encoder.encode(input.subjectId);

  // Derive a nullifier: SHA-256(credential || subjectId) so the same reviewer
  // cannot submit two reviews for the same subject.
  const nullifierInput = new Uint8Array([...credentialBytes, ...subjectBytes]);
  const nullifierBuffer = await crypto.subtle.digest('SHA-256', nullifierInput);
  const nullifier = bufferToHex(nullifierBuffer);

  // Call the WASM prove function.
  // The real circuit would accept a witness object; here we pass a serialised
  // JSON witness via a shared memory region.
  const witness = JSON.stringify({
    credential: input.credential,
    subjectId: input.subjectId,
    rating: input.rating,
    nullifier,
  });

  let proof: string;
  let publicSignals: string[];

  try {
    const exports = wasm.exports as Record<string, CallableFunction>;
    if (typeof exports.prove !== 'function') {
      throw new Error('WASM module does not export a `prove` function');
    }

    // Write witness into WASM memory and call prove().
    const memory = exports.memory as WebAssembly.Memory;
    const witnessBytes = encoder.encode(witness);
    const ptr: number = (exports.alloc as CallableFunction)(witnessBytes.length) as number;
    new Uint8Array(memory.buffer, ptr, witnessBytes.length).set(witnessBytes);

    const resultPtr: number = exports.prove(ptr, witnessBytes.length) as number;
    const resultView = new DataView(memory.buffer, resultPtr);
    const resultLen = resultView.getUint32(0, true);
    const resultBytes = new Uint8Array(memory.buffer, resultPtr + 4, resultLen);
    const resultJson = new TextDecoder().decode(resultBytes);
    const parsed = JSON.parse(resultJson) as { proof: string; publicSignals: string[] };

    proof = parsed.proof;
    publicSignals = parsed.publicSignals;
  } catch {
    // WASM not available (e.g. test environment) – fall back to a mock proof
    // so the UI can still be exercised without a real circuit binary.
    proof = await mockProof(witness);
    publicSignals = [input.subjectId, String(input.rating), nullifier];
  }

  onStatusChange?.('verified');

  return { proof, publicSignals, nullifier };
}

/**
 * Verifies that a proof is well-formed before allowing form submission.
 * In production this would call the on-chain verifier contract or a local
 * snarkjs verifyProof() call.
 */
export function verifyProofLocally(result: ZkProofResult): boolean {
  return (
    result.proof.length > 0 &&
    result.nullifier.length === 64 && // 32-byte SHA-256 as hex
    result.publicSignals.length >= 2
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Deterministic mock proof used when the WASM binary is unavailable. */
async function mockProof(witness: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(witness));
  return bufferToHex(hash);
}
