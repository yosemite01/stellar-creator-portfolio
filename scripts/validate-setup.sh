#!/bin/bash

# Stellar Platform - Setup Validation Script
# This script validates the entire platform setup

set -e

echo "🚀 Stellar Platform - Setup Validation"
echo "======================================"
echo ""

# Check Node.js
echo "✓ Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi
echo "  Node.js $(node --version) found"
echo ""

# Check npm/pnpm
echo "✓ Checking package manager..."
if command -v pnpm &> /dev/null; then
    echo "  pnpm $(pnpm --version) found"
    PKG_MANAGER="pnpm"
elif command -v npm &> /dev/null; then
    echo "  npm $(npm --version) found"
    PKG_MANAGER="npm"
else
    echo "❌ No package manager found (npm or pnpm required)"
    exit 1
fi
echo ""

# Check Rust (for backend)
echo "✓ Checking Rust installation..."
if command -v cargo &> /dev/null; then
    echo "  Rust $(rustc --version) found"
    RUST_AVAILABLE=true
else
    echo "  ⚠️  Rust not found (optional, only needed for backend)"
    RUST_AVAILABLE=false
fi
echo ""

# Validate project structure
echo "✓ Validating project structure..."
REQUIRED_FILES=(
    "app/layout.tsx"
    "app/page.tsx"
    "app/globals.css"
    "components/header.tsx"
    "components/footer.tsx"
    "lib/creators-data.ts"
    "README.md"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ❌ Missing: $file"
        exit 1
    fi
done
echo ""

# Check backend structure (if Rust available)
if [ "$RUST_AVAILABLE" = true ]; then
    echo "✓ Validating backend structure..."
    BACKEND_FILES=(
        "backend/Cargo.toml"
        "backend/contracts/bounty/Cargo.toml"
        "backend/contracts/escrow/Cargo.toml"
        "backend/services/api/Cargo.toml"
    )

    for file in "${BACKEND_FILES[@]}"; do
        if [ -f "$file" ]; then
            echo "  ✓ $file"
        else
            echo "  ⚠️  Missing: $file (non-critical)"
        fi
    done
    echo ""
fi

# Summary
echo "======================================"
echo "✅ Setup validation complete!"
echo ""
echo "Next steps:"
echo "1. Install dependencies: $PKG_MANAGER install"
echo "2. Start dev server: $PKG_MANAGER dev"
echo "3. Open http://localhost:3000"
echo ""
if [ "$RUST_AVAILABLE" = true ]; then
    echo "Backend setup:"
    echo "1. cd backend && cargo build --release"
    echo "2. docker-compose up (for full stack)"
    echo ""
fi
echo "For more info, see README.md"
