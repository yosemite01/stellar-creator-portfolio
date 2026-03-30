import { NextRequest, NextResponse } from "next/server";
import { contractService } from "@/services/api/stellar/contract";
import { LocalSigner } from "@/services/api/stellar/types";
import { stellarClient } from "@/services/api/stellar/client";

/** Known failure modes surfaced by ContractService.invokeContractMethod */
function classifyContractError(err: unknown): { message: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.startsWith("Simulation failed:")) {
    return { message: msg, status: 422 };
  }
  if (msg.startsWith("Transaction submission failed:")) {
    return { message: msg, status: 502 };
  }
  if (msg.startsWith("Transaction failed:")) {
    return { message: msg, status: 422 };
  }
  if (msg.startsWith("Unknown transaction status:")) {
    return { message: msg, status: 502 };
  }
  // Network / RPC connectivity issues
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("network")) {
    return { message: "Stellar RPC node is unreachable", status: 503 };
  }

  return { message: msg || "Failed to invoke contract method", status: 500 };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("contractId" in body) ||
    !("method" in body) ||
    !("args" in body)
  ) {
    return NextResponse.json(
      { error: "contractId, method, and args are required" },
      { status: 400 },
    );
  }

  const { contractId, method, args } = body as {
    contractId: unknown;
    method: unknown;
    args: unknown;
  };

  if (typeof contractId !== "string" || !contractId) {
    return NextResponse.json({ error: "'contractId' must be a non-empty string" }, { status: 400 });
  }
  if (typeof method !== "string" || !method) {
    return NextResponse.json({ error: "'method' must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(args)) {
    return NextResponse.json({ error: "'args' must be an array" }, { status: 400 });
  }

  const adminSecret = stellarClient.config.adminSecret;
  if (!adminSecret) {
    return NextResponse.json(
      { error: "STELLAR_ADMIN_SECRET is not configured" },
      { status: 500 },
    );
  }

  try {
    const signer = new LocalSigner(adminSecret);
    const txHash = await contractService.invokeContractMethod(contractId, method, args, signer);
    return NextResponse.json({ txHash });
  } catch (err: unknown) {
    const { message, status } = classifyContractError(err);
    console.error("Contract invoke error [%d]:", status, err);
    return NextResponse.json({ error: message }, { status });
  }
}
