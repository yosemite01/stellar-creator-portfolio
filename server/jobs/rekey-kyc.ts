#!/usr/bin/env node
/**
 * Background job to re-encrypt KYC fields with a new key version.
 *
 * Usage:
 *   node server/jobs/rekey-kyc.js [--batch-size N] [--cursor C]
 *
 * Options:
 *   --batch-size N  Number of records to process per batch (default: 100)
 *   --cursor C      Cursor for pagination (default: null)
 *
 * This job:
 * 1. Fetches KYC submissions encrypted with old key versions
 * 2. Decrypts each record with the old key
 * 3. Re-encrypts each field with the new key version
 * 4. Updates the key metadata in the database
 * 5. Progressively updates the cursor for resumability
 */

import { prisma } from '@/lib/prisma';
import { decryptFieldWithEnvelope, encryptFieldWithEnvelope } from '@/lib/kyc-envelope-encryption';
import { createHash } from 'crypto';

// Current key version
const CURRENT_KEY_VERSION = 'v1';

async function rekeyBatch(batchSize: number, cursor?: string) {
  console.log(`Starting rekey job: batchSize=${batchSize}, cursor=${cursor || 'null'}`);

  // Find records to re-key
  const records = await prisma.kYCSubmission.findMany({
    where: {
      keyVersion: { lt: CURRENT_KEY_VERSION },
    },
    take: batchSize,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: 'asc' },
  });

  console.log(`Found ${records.length} records to re-key`);

  for (const record of records) {
    console.log(`Processing record ${record.id} for user ${record.userId}`);

    try {
      // Decrypt with old key
      const decryptedFields = await decryptFieldsWithEnvelope(
        {
          name: record.encryptedName,
          dateOfBirth: record.encryptedDOB,
          idNumber: record.encryptedIdNumber,
        },
        record.userId,
      );

      // Re-encrypt with new key version
      const reencryptedFields = await encryptFieldsWithEnvelope(
        {
          name: decryptedFields.name!,
          dateOfBirth: decryptedFields.dateOfBirth!,
          idNumber: decryptedFields.idNumber!,
        },
        record.userId,
      );

      // Update record with new encryption
      await prisma.kYCSubmission.update({
        where: { id: record.id },
        data: {
          encryptedName: reencryptedFields.name!,
          encryptedDOB: reencryptedFields.dateOfBirth!,
          encryptedIdNumber: reencryptedFields.idNumber!,
          keyVersion: CURRENT_KEY_VERSION,
        },
      });

      console.log(`Successfully re-keyed record ${record.id}`);
    } catch (error) {
      console.error(`Failed to re-key record ${record.id}:`, (error instanceof Error ? error.message : String(error)));
      // Continue with next record
    }
  }

  // Return the last record's ID for cursor pagination
  if (records.length > 0) {
    return records[records.length - 1].id;
  }
  return null;
}

// Decrypt multiple fields
async function decryptFieldsWithEnvelope<T extends Record<string, string | undefined>>(
  fields: T,
  userId: string,
): Promise<{ [K in keyof T]: string | undefined }> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([key, value]) => {
      if (value === undefined || value === '') {
        return [key, value] as const;
      }
      try {
        const decrypted = await decryptFieldWithEnvelope(value as string, userId, key);
        return [key, decrypted] as const;
      } catch (error) {
        throw new Error(`Failed to decrypt field ${key}: ${(error instanceof Error ? error.message : String(error))}`);
      }
    }),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: string | undefined };
}

// Encrypt multiple fields
async function encryptFieldsWithEnvelope<T extends Record<string, string | undefined>>(
  fields: T,
  userId: string,
): Promise<{ [K in keyof T]: string | undefined }> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([key, value]) => {
      if (value === undefined || value === '') {
        return [key, value] as const;
      }
      return [key, await encryptFieldWithEnvelope(value, userId, key)] as const;
    }),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: string | undefined };
}

// Parse command line arguments
function parseArgs(): { batchSize: number; cursor?: string } {
  const args = process.argv.slice(2);
  const result: { batchSize: number; cursor?: string } = { batchSize: 100 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      result.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--cursor' && args[i + 1]) {
      result.cursor = args[i + 1];
      i++;
    }
  }

  return result;
}

// Main execution
async function main() {
  const { batchSize, cursor } = parseArgs();

  try {
    const nextCursor = await rekeyBatch(batchSize, cursor);
    console.log(`Rekey job complete. Next cursor: ${nextCursor || 'done'}`);

    // Output for cron/scheduler
    process.exit(0);
  } catch (error) {
    console.error('Rekey job failed:', (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

main();
