#!/usr/bin/env node
/**
 * Background job to delete expired KYC uploads.
 *
 * Usage:
 *   node server/jobs/cleanup-kyc-uploads.js [--batch-size N] [--dry-run]
 *
 * Options:
 *   --batch-size N   Number of records to process per batch (default: 100)
 *   --dry-run        Show what would be deleted without deleting
 *
 * This job:
 * 1. Finds uploads older than retention period
 * 2. Deletes files from S3
 * 3. Logs deletions for audit trail
 */

import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage/upload-security';
import { parseArgs } from 'node:util';

// Configuration
const RETENTION_DAYS = parseInt(process.env.KYC_RETENTION_DAYS || '90', 10);
const BATCH_SIZE = parseInt(process.env.KYC_CLEANUP_BATCH_SIZE || '100', 10);

async function cleanupBatch(batchSize: number, dryRun: boolean = false) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  console.log(`Cleaning up KYC uploads older than ${RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

  // Find uploads older than retention period
  const expiredUploads = await prisma.auditLog.findMany({
    where: {
      resource: 'kyc_upload',
      status: 'SUCCESS',
      action: 'promoted',
      createdAt: { lt: cutoffDate },
    },
    take: batchSize,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      resourceId: true,
      payload: true,
      userId: true,
      createdAt: true,
    },
  });

  console.log(`Found ${expiredUploads.length} expired uploads`);

  let deletedCount = 0;
  let failedCount = 0;

  for (const upload of expiredUploads) {
    try {
      // Extract finalKey from payload
      const finalKey = (upload.payload as any)?.finalKey;
      
      if (finalKey) {
        console.log(`Processing upload ${upload.resourceId}: ${finalKey}`);

        if (dryRun) {
          console.log(`  [DRY RUN] Would delete: ${finalKey}`);
        } else {
          await deleteFile(finalKey);
          console.log(`  Deleted: ${finalKey}`);
        }

        deletedCount++;
      } else {
        console.log(`  No finalKey found for upload ${upload.resourceId}`);
      }

      // Log deletion
      if (!dryRun) {
        await prisma.auditLog.create({
          data: {
            userId: upload.userId,
            resource: 'kyc_upload',
            action: 'deleted_expired',
            resourceId: upload.resourceId,
            payload: {
              finalKey: finalKey || 'unknown',
              deletedAt: new Date().toISOString(),
              retentionDays: RETENTION_DAYS,
              originalUploadId: upload.resourceId,
            },
            httpMethod: 'POST',
            requestPath: '/api/kyc/cleanup',
            status: 'SUCCESS',
          },
        });
      }
    } catch (error) {
      console.error(`  Failed to cleanup upload ${upload.resourceId}:`, error.message);
      failedCount++;
    }
  }

  console.log(`\nCleanup complete.`);
  console.log(`  Processed: ${expiredUploads.length} uploads`);
  console.log(`  Deleted: ${deletedCount}`);
  console.log(`  Failed: ${failedCount}`);

  return { processed: expiredUploads.length, deleted: deletedCount, failed: failedCount };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { batchSize: BATCH_SIZE, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      result.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    }
  }

  return result;
}

async function main() {
  const { batchSize, dryRun } = parseArgs();

  try {
    await cleanupBatch(batchSize, dryRun);
    console.log(`\nCleanup job complete.`);
    process.exit(0);
  } catch (error) {
    console.error(`Cleanup job failed:`, error.message);
    process.exit(1);
  }
}

main();
