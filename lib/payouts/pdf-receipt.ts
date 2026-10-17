import { PayoutReceipt } from './types';

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a valid standard PDF-1.4 binary document for a payout receipt.
 * Contains platform fee breakdown, freelancer/client metadata, and Stellar tx link.
 */
export function generateReceiptPdf(receipt: PayoutReceipt): Uint8Array {
  const lines: string[] = [];

  // Helper to draw text in stream
  const contentOps: string[] = [];

  // Header band
  contentOps.push('0.1 0.15 0.25 rg');
  contentOps.push('50 710 512 40 re f'); // dark blue banner

  contentOps.push('BT');
  contentOps.push('/F2 16 Tf');
  contentOps.push('1 1 1 rg'); // white text
  contentOps.push(`65 725 Td (${escapePdfText('TAMGORA - OFFICIAL PAYOUT RECEIPT')}) Tj`);
  contentOps.push('ET');

  // Subheader / Receipt meta
  contentOps.push('BT');
  contentOps.push('0.2 0.2 0.2 rg');
  contentOps.push('/F1 10 Tf');
  contentOps.push(`50 680 Td (${escapePdfText(`Receipt Number: ${receipt.receiptNumber}`)}) Tj`);
  contentOps.push(`0 -16 Td (${escapePdfText(`Issue Date: ${new Date(receipt.issuedAt).toUTCString()}`)}) Tj`);
  contentOps.push(`0 -16 Td (${escapePdfText(`Status: ${receipt.status.toUpperCase()}`)}) Tj`);
  contentOps.push(`0 -16 Td (${escapePdfText(`Payout Type: ${receipt.payoutType.toUpperCase()}`)}) Tj`);
  contentOps.push('ET');

  // Divider
  contentOps.push('0.8 0.8 0.8 RG');
  contentOps.push('1 w');
  contentOps.push('50 610 m 562 610 l S');

  // Parties section
  contentOps.push('BT');
  contentOps.push('/F2 12 Tf');
  contentOps.push('0.1 0.2 0.4 rg');
  contentOps.push('50 585 Td (PARTIES) Tj');
  contentOps.push('/F1 10 Tf');
  contentOps.push('0.2 0.2 0.2 rg');
  contentOps.push(`0 -18 Td (${escapePdfText(`Freelancer: ${receipt.freelancer.name} (ID: ${receipt.freelancer.userId})`)}) Tj`);
  if (receipt.freelancer.stellarAddress) {
    contentOps.push(`0 -15 Td (${escapePdfText(`Stellar Address: ${receipt.freelancer.stellarAddress}`)}) Tj`);
  }
  contentOps.push(`0 -15 Td (${escapePdfText(`Client: ${receipt.client.name} (ID: ${receipt.client.userId})`)}) Tj`);
  contentOps.push(`0 -15 Td (${escapePdfText(`Bounty / Project: ${receipt.bounty.title} (ID: ${receipt.bounty.id})`)}) Tj`);
  contentOps.push('ET');

  // Divider
  contentOps.push('50 495 m 562 495 l S');

  // Financial breakdown box
  contentOps.push('0.96 0.97 0.99 rg');
  contentOps.push('50 365 512 110 re f'); // light box
  contentOps.push('0.8 0.85 0.9 RG');
  contentOps.push('50 365 512 110 re S');

  contentOps.push('BT');
  contentOps.push('/F2 12 Tf');
  contentOps.push('0.1 0.2 0.4 rg');
  contentOps.push('65 450 Td (PAYMENT & PLATFORM FEE BREAKDOWN) Tj');

  contentOps.push('/F1 10 Tf');
  contentOps.push('0.2 0.2 0.2 rg');
  contentOps.push(`0 -20 Td (${escapePdfText(`Gross Bounty Amount: ${receipt.feeBreakdown.grossAmount.toFixed(2)} ${receipt.currency}`)}) Tj`);
  contentOps.push(`0 -16 Td (${escapePdfText(`Platform Fee Rate: ${(receipt.feeBreakdown.platformFeeRate * 100).toFixed(1)}%`)}) Tj`);
  contentOps.push(`0 -16 Td (${escapePdfText(`Platform Fee Deducted: -${receipt.feeBreakdown.platformFeeAmount.toFixed(2)} ${receipt.currency}`)}) Tj`);

  contentOps.push('/F2 11 Tf');
  contentOps.push('0.05 0.5 0.2 rg');
  contentOps.push(`0 -20 Td (${escapePdfText(`Net Freelancer Payout: ${receipt.feeBreakdown.netPayoutAmount.toFixed(2)} ${receipt.currency}`)}) Tj`);
  contentOps.push('ET');

  // Stellar on-chain transaction section (if available)
  if (receipt.stellarTxHash) {
    contentOps.push('BT');
    contentOps.push('/F2 11 Tf');
    contentOps.push('0.1 0.2 0.4 rg');
    contentOps.push('50 330 Td (STELLAR BLOCKCHAIN TRANSACTION VERIFICATION) Tj');
    contentOps.push('/F1 9 Tf');
    contentOps.push('0.3 0.3 0.3 rg');
    contentOps.push(`0 -16 Td (${escapePdfText(`Transaction Hash: ${receipt.stellarTxHash}`)}) Tj`);
    if (receipt.stellarExplorerUrl) {
      contentOps.push(`0 -14 Td (${escapePdfText(`Explorer Link: ${receipt.stellarExplorerUrl}`)}) Tj`);
    }
    contentOps.push('ET');
  }

  // Footer notes & legal notice
  contentOps.push('BT');
  contentOps.push('/F1 8 Tf');
  contentOps.push('0.5 0.5 0.5 rg');
  contentOps.push('50 120 Td (LEGAL & TAX NOTICE:) Tj');
  contentOps.push(`0 -12 Td (${escapePdfText(receipt.notes)}) Tj`);
  contentOps.push('0 -12 Td (Tamgora Decentralized Freelance Platform • Built on Stellar Network) Tj');
  contentOps.push('ET');

  const streamContent = contentOps.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf-8');

  // Assemble PDF document objects
  const objects: string[] = [];

  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Object 3: Page
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n'
  );

  // Object 4: Content Stream
  objects.push(
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`
  );

  // Object 5: Standard Font Helvetica
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Object 6: Standard Font Helvetica-Bold
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  // Calculate offsets for xref table
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf-8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf-8');
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return new Uint8Array(Buffer.from(pdf, 'utf-8'));
}
