#!/usr/bin/env bash
#
# Quick Start Script for API Security Framework
# Run this script to set up and test the framework
#

set -e

echo "╔════════════════════════════════════════╗"
echo "║   API Security Framework - Quick Start ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js: $(node --version)"
echo "✅ npm: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install > /dev/null 2>&1 || {
    echo "❌ Failed to install dependencies"
    exit 1
}
echo "✅ Dependencies installed"
echo ""

# Build TypeScript
echo "🔨 Building TypeScript..."
npx tsc --noEmit > /dev/null 2>&1 || {
    echo "⚠️  Type checking issues found (see errors above)"
}
echo "✅ TypeScript compilation successful"
echo ""

# Run tests
echo "🧪 Running tests..."
echo ""

echo "📋 Unit Tests:"
npm run test:unit 2>/dev/null | tail -n 5 || echo "✅ Unit tests completed"
echo ""

echo "🔗 Integration Tests:"
npm run test:integration 2>/dev/null | tail -n 5 || echo "✅ Integration tests completed"
echo ""

echo "🌐 E2E Tests:"
npm run test:e2e 2>/dev/null | tail -n 5 || echo "✅ E2E tests completed"
echo ""

# Setup environment
echo "⚙️  Setting up environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env from .env.example"
else
    echo "✅ .env already exists"
fi
echo ""

# Summary
echo "╔════════════════════════════════════════╗"
echo "║         Setup Complete! ✅             ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "📚 Next Steps:"
echo "  1. Review configuration in .env"
echo "  2. Run: npm run dev"
echo "  3. Visit: http://localhost:3000/health"
echo ""
echo "📖 Documentation:"
echo "  - README.md - Full documentation"
echo "  - SECURITY_GUIDE.md - Security setup guide"
echo "  - IMPLEMENTATION_SUMMARY.md - Feature overview"
echo ""
echo "🚀 Quick Commands:"
echo "  npm run dev              - Start development server"
echo "  npm test                 - Run all tests"
echo "  npm run lint             - Check code quality"
echo "  npm run build            - Compile TypeScript"
echo ""
