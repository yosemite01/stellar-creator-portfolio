#!/usr/bin/env node
/**
 * Audit Chain Verifier Tool
 * 
 * Verifies the integrity of the audit hash chain and reports any tampered entries.
 * Can optionally anchor the chain head on Stellar.
 * 
 * Usage:
 *   node scripts/verify-audit-chain.mjs [--anchor] [--json]
 * 
 * Options:
 *   --anchor  Anchor the chain head hash on Stellar (requires STELLAR_ADMIN_SECRET)
 *   --json    Output results as JSON for CI integration
 */

import 'dotenv/config';
import { verifyAuditChain, anchorChainHeadOnStellar } from '../server/services/audit.js';
import { getStellarClient } from '../server/stellar/client.js';

const args = process.argv.slice(2);
const shouldAnchor = args.includes('--anchor');
const jsonOutput = args.includes('--json');

async function main() {
  console.log('🔍 Verifying audit hash chain integrity...\n');

  const result = await verifyAuditChain();

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.isValid) {
      console.log('✅ Chain verification PASSED');
      console.log(`   ${result.message}`);
    } else {
      console.log('❌ Chain verification FAILED');
      console.log(`   ${result.message}`);
      console.log(`\n   Tampered entry IDs:`);
      for (const id of result.tamperedEntries) {
        console.log(`   - ${id}`);
      }
    }
  }

  if (shouldAnchor) {
    console.log('\n🔗 Anchoring chain head on Stellar...');
    
    let stellarClient;
    try {
      stellarClient = await getStellarClient();
    } catch (err) {
      console.error('❌ Failed to initialize Stellar client:', err.message);
      process.exit(1);
    }

    const txHash = await anchorChainHeadOnStellar(stellarClient);
    
    if (txHash) {
      console.log(`✅ Anchored on Stellar: ${txHash}`);
    } else {
      console.log('⚠️  Failed to anchor on Stellar (see logs for details)');
    }
  }

  process.exit(result.isValid ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});