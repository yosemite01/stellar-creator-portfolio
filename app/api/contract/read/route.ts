import { NextRequest, NextResponse } from "next/server";
import { contractService } from "@/services/api/stellar/contract";

/** Known failure modes surfaced by ContractService.getContractData */
function classifyContractReadError(err: unknown): { message: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("network")) {
    return { message: "Stellar RPC node is unreachable", status: 503 };
  }
  if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("no entry")) {
    return { message: "Contract data entry not found", status: 404 };
  }
  if (msg.toLowerCase().includes("invalid contract") || msg.toLowerCase().includes("bad contract")) {
    return { message: "Invalid contract ID", status: 422 };
  }

  return { message: msg || "Failed to read contract data", status: 500 };
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
    !("key" in body)
  ) {
    return NextResponse.json(
      { error: "contractId and key are required" },
      { status: 400 },
    );
  }

  const { contractId, key } = body as { contractId: unknown; key: unknown };

  if (typeof contractId !== "string" || !contractId) {
    return NextResponse.json({ error: "'contractId' must be a non-empty string" }, { status: 400 });
  }
  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "'key' must be a non-empty string" }, { status: 400 });
  }

  try {
    const value = await contractService.getContractData(contractId, key);
    return NextResponse.json({ value });
  } catch (err: unknown) {
    const { message, status } = classifyContractReadError(err);
    console.error("Contract read error [%d]:", status, err);
    return NextResponse.json({ error: message }, { status });
  }
}
