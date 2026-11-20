import { NextResponse } from 'next/server';
import { exportJWK, getKeyId } from '@/lib/auth/keys';

/**
 * JWKS endpoint for token verification
 * Returns the public key in JSON Web Key Set format
 */
export async function GET(): Promise<NextResponse> {
  try {
    const jwk = exportJWK();
    
    const jwks = {
      keys: [
        {
          kty: jwk.kty,
          use: jwk.use,
          kid: jwk.kid,
          n: jwk.n,
          e: jwk.e,
        },
      ],
    };

    return NextResponse.json(jwks, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/jwk-set+json',
      },
    });
  } catch (error) {
    console.error('Failed to generate JWKS:', error);
    return NextResponse.json(
      { error: 'Failed to generate JWKS' },
      { status: 500 },
    );
  }
}
