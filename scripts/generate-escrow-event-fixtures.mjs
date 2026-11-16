#!/usr/bin/env node
/**
 * Escrow Events Test Fixtures Generator
 *
 * Generates deterministic, versioned fixtures representing a complete
 * testnet escrow contract lifecycle. Matches the exact Soroban contract
 * event schema defined in `backend/contracts/escrow/src/lib.rs` and the
 * frontend API responses defined in `lib/api-models.ts`.
 *
 * Usage:
 *   node scripts/generate-escrow-event-fixtures.mjs           # Generate fixtures
 *   node scripts/generate-escrow-event-fixtures.mjs --check   # Verify fixtures match without drift
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixturesDir = path.join(rootDir, 'fixtures', 'escrow-events', 'v1');
const fixturesPath = path.join(fixturesDir, 'lifecycle.json');

// Canonical deterministic testnet addresses & identifiers
const CONTRACT_ID = 'CA3D5KRYMCMCZWATHGHAGH274G3T5OXZP36ENXVDL43G5X2O64ZTX4B6';
const PAYER_ADDRESS = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYEE_ADDRESS = 'GB5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ADMIN_ADDRESS = 'GC5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TOKEN_ADDRESS = 'GUSDC789MCMCZWATHGHAGH274G3T5OXZP36ENXVDL43G5X2O64ZTX4B6';

/**
 * Builds the canonical deterministic escrow event lifecycle
 */
export function buildEscrowLifecycleFixtures() {
  return {
    version: '1.0.0',
    generatedAt: '2026-04-23T12:00:00.000Z',
    contractId: CONTRACT_ID,
    network: 'testnet',
    description: 'Deterministic testnet escrow contract lifecycle events for testing TS and Rust parsers',
    events: [
      {
        id: 'evt-001-deposited',
        name: 'escrow_deposited',
        operation: 'deposit',
        ledger: 1042010,
        txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        timestamp: '2026-04-23T12:00:00.000Z',
        topics: ['escrow', 'deposited'],
        contractData: {
          escrowId: 1,
          bountyId: 101,
          payer: PAYER_ADDRESS,
          payee: PAYEE_ADDRESS,
          netAmount: 2438,
          fee: 62,
          grossAmount: 2500,
          token: TOKEN_ADDRESS
        },
        apiResponse: {
          escrowId: '1',
          txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
          operation: 'deposit',
          status: 'confirmed',
          timestamp: '2026-04-23T12:00:00.000Z'
        }
      },
      {
        id: 'evt-002-released',
        name: 'escrow_released',
        operation: 'release',
        ledger: 1042050,
        txHash: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01a',
        timestamp: '2026-04-23T13:00:00.000Z',
        topics: ['escrow', 'released'],
        contractData: {
          escrowId: 1,
          bountyId: 101,
          payee: PAYEE_ADDRESS,
          amount: 2438
        },
        apiResponse: {
          escrowId: '1',
          txHash: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01a',
          operation: 'release',
          status: 'confirmed',
          timestamp: '2026-04-23T13:00:00.000Z'
        }
      },
      {
        id: 'evt-003-refunded',
        name: 'escrow_refunded',
        operation: 'refund',
        ledger: 1042100,
        txHash: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012ab',
        timestamp: '2026-04-23T14:00:00.000Z',
        topics: ['escrow', 'refunded'],
        contractData: {
          escrowId: 2,
          bountyId: 102,
          payer: PAYER_ADDRESS,
          amount: 1000
        },
        apiResponse: {
          escrowId: '2',
          txHash: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012ab',
          operation: 'refund',
          status: 'confirmed',
          timestamp: '2026-04-23T14:00:00.000Z'
        }
      },
      {
        id: 'evt-004-disputed',
        name: 'escrow_disputed',
        operation: 'dispute',
        ledger: 1042150,
        txHash: 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123abc',
        timestamp: '2026-04-23T15:00:00.000Z',
        topics: ['escrow', 'disputed'],
        contractData: {
          escrowId: 3,
          bountyId: 103,
          authorizer: PAYER_ADDRESS,
          expiresAt: 1777032000
        },
        apiResponse: {
          escrowId: '3',
          txHash: 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123abc',
          operation: 'dispute',
          status: 'pending',
          timestamp: '2026-04-23T15:00:00.000Z'
        }
      },
      {
        id: 'evt-005-resolved',
        name: 'escrow_resolved',
        operation: 'resolve',
        ledger: 1042200,
        txHash: 'e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01234abcd',
        timestamp: '2026-04-23T16:00:00.000Z',
        topics: ['escrow', 'resolved'],
        contractData: {
          escrowId: 3,
          bountyId: 103,
          recipient: PAYEE_ADDRESS,
          releaseToPayee: true
        },
        apiResponse: {
          escrowId: '3',
          txHash: 'e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01234abcd',
          operation: 'release',
          status: 'confirmed',
          timestamp: '2026-04-23T16:00:00.000Z'
        }
      },
      {
        id: 'evt-006-settled-by-timeout',
        name: 'settled_by_timeout',
        operation: 'timeout',
        ledger: 1042250,
        txHash: 'f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012345abcde',
        timestamp: '2026-04-23T17:00:00.000Z',
        topics: ['escrow', 'auto_res'],
        contractData: {
          escrowId: 4,
          bountyId: 104,
          payeeAmount: 1200,
          payerAmount: 1200
        },
        apiResponse: {
          escrowId: '4',
          txHash: 'f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012345abcde',
          operation: 'refund',
          status: 'confirmed',
          timestamp: '2026-04-23T17:00:00.000Z'
        }
      },
      {
        id: 'evt-007-milestone-released',
        name: 'milestone_released',
        operation: 'milestone_release',
        ledger: 1042300,
        txHash: '0718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456abcdef',
        timestamp: '2026-04-23T18:00:00.000Z',
        topics: ['escrow', 'ms_rel'],
        contractData: {
          escrowId: 5,
          index: 0,
          payee: PAYEE_ADDRESS,
          amount: 500
        },
        apiResponse: {
          escrowId: '5',
          txHash: '0718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456abcdef',
          operation: 'release',
          status: 'confirmed',
          timestamp: '2026-04-23T18:00:00.000Z'
        }
      }
    ]
  };
}

function main() {
  const isCheck = process.argv.includes('--check');
  const data = buildEscrowLifecycleFixtures();
  const serialized = JSON.stringify(data, null, 2) + '\n';

  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  if (isCheck) {
    if (!fs.existsSync(fixturesPath)) {
      console.error(`Check failed: ${fixturesPath} does not exist.`);
      process.exit(1);
    }
    const current = fs.readFileSync(fixturesPath, 'utf-8');
    if (current !== serialized) {
      console.error(`Check failed: ${fixturesPath} has drifted from generator.`);
      process.exit(1);
    }
    console.log(`✓ Fixtures match generator perfectly (${fixturesPath})`);
    process.exit(0);
  }

  fs.writeFileSync(fixturesPath, serialized, 'utf-8');
  console.log(`✓ Generated ${data.events.length} versioned escrow event fixtures to ${fixturesPath}`);
}

main();
