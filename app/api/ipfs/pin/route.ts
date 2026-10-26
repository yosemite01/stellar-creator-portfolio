import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { checkPinRateLimit } from '@/lib/rate-limit';
import { maxUploadBytes, validatePinnedBytes } from '@/lib/storage/upload-validation';
import { writeAuditLog } from '@/server/services/audit';

// nodejs runtime: session auth, in-memory quota and Prisma-backed audit log
// are unavailable on the edge runtime.
export const runtime = 'nodejs';

function sha256ToCid(sha256: string): string {
  return `bafy${sha256.slice(0, 52)}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkPinRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'Daily pin quota exceeded' }, { status: 429 });
  }

  // Reject early when a trustworthy Content-Length already exceeds the limit,
  // before buffering the whole body.
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxUploadBytes()) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }
  const file = form.get('file') as Blob | null;
  // Duck-type on arrayBuffer(): a Blob in the runtime realm, but jsdom/undici
  // hand back a File from a different realm, so `instanceof Blob` is unreliable.
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  // Wrap in Uint8Array so the digest and sniffing see a same-realm buffer, and
  // validate the actual bytes rather than trusting declared size or Content-Type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rejection = validatePinnedBytes(bytes);
  if (rejection) {
    return NextResponse.json({ error: rejection.error }, { status: rejection.status });
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expectedSha256 = String(form.get('sha256') ?? '');
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    return NextResponse.json({ error: 'Hash mismatch' }, { status: 422 });
  }

  const cid = sha256ToCid(sha256);
  const gatewayUrl = `https://ipfs.io/ipfs/${cid}`;

  // Best-effort, non-blocking audit trail of who pinned what.
  writeAuditLog({
    userId: session.user.id,
    resource: 'ipfs',
    action: 'pin',
    resourceId: cid,
    payload: { cid, size: bytes.byteLength },
  }).catch(() => {});

  return NextResponse.json({ cid, sha256, size: bytes.byteLength, gatewayUrl });
}
