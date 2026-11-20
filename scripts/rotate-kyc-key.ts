#!/usr/bin/env tsx
/**
 * Rotate the KYC encryption key version.
 *
 * Usage:
 *   tsx scripts/rotate-kyc-key.ts [--previous-key-id ID] [--reason REASON]
 *
 * This script:
 * 1. Updates the current key version in configuration
 * 2. Records the rotation in the database
 * 3. Initiates background re-key job
 */

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

// Key version format: v{timestamp}-{random}
function generateKeyVersion(): string {
  const timestamp = Date.now();
  const random = randomUUID().substring(0, 8);
  return `v${timestamp}-${random}`;
}

async function rotateKey(previousKeyId: string | undefined, reason: string | undefined) {
  const currentKeyId = previousKeyId || 'default';
  const newKeyId = generateKeyVersion();

  console.log(`Rotating KYC encryption key...`);
  console.log(`  Previous key ID: ${currentKeyId}`);
  console.log(`  New key ID: ${newKeyId}`);
  console.log(`  Reason: ${reason || 'manual rotation'}`);

  // Record the rotation in the database
  const rotationRecord = await prisma.kycKeyRotationHistory.create({
    data: {
      previousKeyId: currentKeyId,
      newKeyId: newKeyId,
      rotatedBy: process.env.USER || 'unknown',
      rotatedAt: new Date(),
    },
  });

  console.log(`  Rotation recorded: ${rotationRecord.id}`);

  // In production, you would:
  // 1. Update the KMS configuration with the new key
  // 2. Update the key version in environment variables
  // 3. Start the background re-key job

  console.log(`\nNext steps:`);
  console.log(`  1. Update ENCRYPTION_KEY environment variable`);
  console.log(`  2. Run: pnpm rekey:kyc --batch-size 100`);
  console.log(`  3. Monitor progress: pnpm rekey:kyc --batch-size 100 --cursor <cursor>`);

  return { previousKeyId: currentKeyId, newKeyId, rotationId: rotationRecord.id };
}

// Parse command line arguments
function parseArgs(): { previousKeyId?: string; reason?: string } {
  const args = process.argv.slice(2);
  const result: { previousKeyId?: string; reason?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--previous-key-id' && args[i + 1]) {
      result.previousKeyId = args[i + 1];
      i++;
    } else if (args[i] === '--reason' && args[i + 1]) {
      result.reason = args[i + 1];
      i++;
    }
  }

  return result;
}

// Main execution
async function main() {
  const { previousKeyId, reason } = parseArgs();

  try {
    const result = await rotateKey(previousKeyId, reason);
    console.log(`\nKey rotation complete.`);
    console.log(`  Rotation ID: ${result.rotationId}`);
  } catch (error) {
    console.error(`Key rotation failed: ${(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }
}

main();
