/**
 * Admin API: Verify audit chain integrity
 * 
 * GET  /api/admin/audit/verify      - Verify chain and return status
 * POST /api/admin/audit/anchor      - Anchor chain head on Stellar
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuditChain, anchorChainHeadOnStellar } from '@/server/services/audit';
import { getAdminSession } from '@/lib/auth/admin-auth';

/**
 * Verify the audit hash chain integrity.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await verifyAuditChain();

    return NextResponse.json({
      success: true,
      ...result,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Admin API] Audit verification error:', err);
    return NextResponse.json({ 
      success: false,
      error: 'Failed to verify audit chain',
    }, { status: 500 });
  }
}

/**
 * Anchor the audit chain head on Stellar.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const txHash = await anchorChainHeadOnStellar();

    if (!txHash) {
      return NextResponse.json({
        success: false,
        error: 'No entries to anchor or anchoring failed',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      transactionHash: txHash,
      anchoredAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Admin API] Audit anchoring error:', err);
    return NextResponse.json({ 
      success: false,
      error: 'Failed to anchor audit chain',
    }, { status: 500 });
  }
}