import { NextRequest, NextResponse } from "next/server";
import { contractService } from "@/services/api/stellar/contract";

export async function POST(req: NextRequest) {
  try {
    const { contractId, key } = await req.json();

    if (!contractId || !key) {
      return NextResponse.json(
        { error: "contractId and key are required" },
        { status: 400 },
      );
    }

    const value = await contractService.getContractData(contractId, key);

    return NextResponse.json({ value });
  } catch (error: unknown) {
    console.error("Contract read error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read contract data",
      },
      { status: 500 },
    );
  }
}
