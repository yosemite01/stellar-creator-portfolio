#!/usr/bin/env node
/**
 * Background job to sanitize KYC images by re-encoding them.
 *
 * Usage:
 *   node server/jobs/sanitize-kyc-images.js [--batch-size N] [--cursor C]
 *
 * Options:
 *   --batch-size N   Number of records to process per batch (default: 100)
 *   --cursor C       Cursor for pagination (default: null)
 *
 * This job:
 * 1. Finds KYC uploads that need sanitization
 * 2. Re-encodes images, stripping metadata
 * 3. Updates the file in S3
 */

import { prisma } from '@/lib/prisma';
import { getObject, uploadObject, deleteObject } from '@/lib/storage/s3';
import { inspectUpload } from '@/lib/storage/upload-validation';
import { randomUUID } from 'crypto';

const BATCH_SIZE = parseInt(process.env.KYC_SANITIZE_BATCH_SIZE || '100', 10);
const MAX_IMAGE_PIXELS = 40000000; // 40MP

async function sanitizeBatch(batchSize: number, cursor?: string) {
  console.log(`Starting sanitization job: batchSize=${batchSize}`);

  // Find uploads that need sanitization
  const uploads = await prisma.kYCSubmission.findMany({
    where: {
      NOT: {
        status: 'REJECTED',
      },
    },
    take: batchSize,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      userId: true,
      encryptedName: true,
      encryptedDOB: true,
      encryptedIdNumber: true,
      encryptedDocumentImage: true,
      documentImageKey: true,
    },
  });

  console.log(`Found ${uploads.length} uploads to sanitize`);

  let sanitizedCount = 0;
  let failedCount = 0;

  for (const upload of uploads) {
    try {
      if (!upload.documentImageKey) {
        console.log(`Skipping ${upload.id}: no document image`);
        continue;
      }

      console.log(`Processing upload ${upload.id}: ${upload.documentImageKey}`);

      // Get the file from S3
      const object = await getObject(upload.documentImageKey);
      const bytes = object.body;

      // Inspect and sanitize the image
      const check = await inspectUpload(bytes, object.contentType || 'application/octet-stream');

      if (!check.ok) {
        console.log(`  Sanitization failed: ${check.error}`);
        failedCount++;
        continue;
      }

      // Re-upload sanitized file
      const sanitizedKey = `${upload.documentImageKey}.sanitized`;
      await uploadObject({
        key: sanitizedKey,
        body: check.body,
        contentType: check.type,
        metadata: {
          ...object.metadata,
          sanitizedAt: new Date().toISOString(),
          sanitizedBy: 'background-job',
        },
      });

      // Delete original file
      await deleteObject(upload.documentImageKey);

      // Update database with sanitized key
      await prisma.kYCSubmission.update({
        where: { id: upload.id },
        data: {
          documentImageKey: sanitizedKey,
          sanitizedAt: new Date(),
        },
      });

      console.log(`  Sanitized and updated: ${sanitizedKey}`);
      sanitizedCount++;

      // Update audit log
      await prisma.auditLog.create({
        data: {
          userId: upload.userId,
          resource: 'kyc_upload',
          action: 'sanitized',
          resourceId: upload.id,
          payload: {
            originalKey: upload.documentImageKey,
            sanitizedKey,
            sanitizedAt: new Date().toISOString(),
          },
          httpMethod: 'POST',
          requestPath: '/api/kyc/sanitize',
          status: 'SUCCESS',
        },
      });
    } catch (error) {
      console.error(`  Failed to sanitize upload ${upload.id}:`, error.message);
      failedCount++;
    }
  }

  console.log(`\nSanitization complete.`);
  console.log(`  Processed: ${uploads.length} uploads`);
  console.log(`  Sanitized: ${sanitizedCount}`);
  console.log(`  Failed: ${failedCount}`);

  if (uploads.length > 0) {
    return uploads[uploads.length - 1].id;
  }
  return null;
}

// Parse command line arguments
function parseArgs(): { batchSize: number; cursor?: string } {
  const args = process.argv.slice(2);
  const result = { batchSize: BATCH_SIZE, cursor: undefined };

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
    const nextCursor = await sanitizeBatch(batchSize, cursor);
    console.log(`\nSanitization job complete. Next cursor: ${nextCursor || 'done'}`);
    process.exit(0);
  } catch (error) {
    console.error(`Sanitization job failed:`, error.message);
    process.exit(1);
  }
}

main();
