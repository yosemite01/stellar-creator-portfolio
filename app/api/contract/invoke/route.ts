import { NextRequest, NextResponse } from 'next/server';
import { contractService } from '@/services/api/stellar/contract';
import { LocalSigner } from '@/services/api/stellar/types';
import { stellarClient } from '@/services/api/stellar/client';

export async function POST(req: NextRequest) {
  try {
    const { contractId, method, args } = await req.json();

    if (!contractId || !method || !args) {
      return NextResponse.json(
        { error: 'contractId, method, and args are required' },
        { status: 400 }
      );
    }

    const adminSecret = stellarClient.config.adminSecret;
    if (!adminSecret) {
      return NextResponse.json(
        { error: 'STELLAR_ADMIN_SECRET is not configured' },
        { status: 500 }
      );
    }

    const signer = new LocalSigner(adminSecret);
    const txHash = await contractService.invokeContractMethod(
      contractId,
      method,
      args,
      signer
    );

    return NextResponse.json({ txHash });
  } catch (error: any) {
    console.error('Contract invoke error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to invoke contract method' },
      { status: 500 }
    );
  }
}
