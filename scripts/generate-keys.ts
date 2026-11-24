#!/usr/bin/env tsx

import { generateKeys } from '@/lib/auth/keys';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  console.log('Generating RSA keys for JWT signing...');

  // Generate keys
  await generateKeys();

  // Verify keys were created
  const KEYS_DIR = path.join(process.cwd(), '.auth-keys');
  const privateKeyPath = path.join(KEYS_DIR, 'auth-private-key.pem');
  const publicKeyPath = path.join(KEYS_DIR, 'auth-public-key.pem');

  try {
    await fs.access(privateKeyPath);
    await fs.access(publicKeyPath);
    console.log('✓ RSA keys generated successfully');
    console.log(`  Private key: ${privateKeyPath}`);
    console.log(`  Public key: ${publicKeyPath}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Start the Next.js development server');
    console.log('2. Test the JWKS endpoint: http://localhost:3000/api/jwks');
    console.log('3. Update .env.local with:');
    console.log('   NEXTAUTH_URL=http://localhost:3000');
    console.log('4. Update Rust service config with:');
    console.log('   JWKS_URL=http://localhost:3000/api/jwks');
  } catch (error) {
    console.error('✗ Failed to verify keys');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
