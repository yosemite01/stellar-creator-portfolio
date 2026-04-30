# Contributing to Stellar Platform

Thank you for your interest in contributing to Stellar! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Welcome feedback and criticism
- Focus on the code, not the person
- Help others learn and grow

## Getting Started

### Prerequisites
- Node.js 18+ or 20+
- Rust 1.70+ (for backend work)
- Git

### Setup Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/stellar-platform.git
   cd stellar-platform
   ```

2. **Install Frontend Dependencies**
   ```bash
   pnpm install
   # or npm install
   ```

3. **Start Development Server**
   ```bash
   pnpm dev
   # Open http://localhost:3000
   ```

4. **Backend Setup (Optional)**
   ```bash
   cd backend
   cargo build --release
   docker-compose up  # Start full stack with services
   ```

## Project Structure

### Frontend (`app/`, `components/`, `lib/`)
- **Pages**: Route-based components in `app/`
- **Components**: Reusable UI components in `components/`
- **Utilities**: Helper functions and data in `lib/`
- **Styles**: Global and component styles

### Backend (`backend/`)
- **Contracts**: Soroban smart contracts in `contracts/`
- **Services**: Rust backend services in `services/`
- **Tests**: Unit and integration tests

## Development Workflow

### Creating a Feature

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # Use format: feature/*, bugfix/*, docs/*, etc.
   ```

2. **Make Changes**
   - Keep commits small and focused
   - Write descriptive commit messages
   - Test your changes thoroughly

3. **Commit & Push**
   ```bash
   git add .
   git commit -m "feat: Add new bounty filtering"
   git push origin feature/your-feature-name
   ```

4. **Create Pull Request**
   - Fill out PR template completely
   - Link related issues
   - Request reviewers
   - Allow time for feedback

### Commit Message Format

Follow conventional commits:
```
type(scope): description

[optional body]

[optional footer]
```

**Types**: feat, fix, docs, style, refactor, perf, test, chore

**Examples**:
```
feat(bounties): Add difficulty filter to bounties page
fix(freelancer-card): Correct margin spacing
docs(README): Update installation instructions
```

## Code Style

### Frontend (TypeScript/React)
```bash
# Format code (auto-format on save recommended)
pnpm format

# Run linter
pnpm lint

# Type checking
pnpm type-check
```

**Rules**:
- Use `const` by default, `let` if necessary, avoid `var`
- Prefer arrow functions
- Use functional components with hooks
- Keep components under 300 lines
- Extract reusable logic into custom hooks

### Backend (Rust)
```bash
# Format code
cargo fmt

# Lint code
cargo clippy

# Run tests
cargo test
```

**Rules**:
- Follow Rust naming conventions
- Use meaningful variable names
- Add documentation comments (`///`)
- Handle errors explicitly
- Write tests for new functionality

## Component Development

### Creating a New Component

```typescript
// components/my-component.tsx
'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MyComponentProps {
  children: ReactNode;
  className?: string;
  // ... other props
}

export function MyComponent({ 
  children, 
  className,
  // ... other props
}: MyComponentProps) {
  return (
    <div className={cn("base-styles", className)}>
      {children}
    </div>
  );
}
```

### Component Guidelines
- Export named exports from index files
- Use TypeScript interfaces for props
- Include JSDoc comments
- Keep components reusable
- Separate concerns (logic vs presentation)

## Smart Contract Development

### Creating a New Contract

```bash
cd backend/contracts
mkdir my-contract
cd my-contract
stellar contract init --template basic
```

### Contract Guidelines
- Write comprehensive unit tests
- Document contract functions
- Use enums for status values
- Implement proper error handling
- Include storage key documentation

## Testing
### CLI checks
1. Install Clippy (Rust):
```bash
rustup component add clippy
```
2. Frontend checks (Orbit-style lint):
```bash
pnpm run frontend:orbit-check
```
3. Backend checks (Clippy):
```bash
pnpm run backend:clippy
# or: cd backend && cargo clippy --workspace --all-targets --all-features -- -D warnings
```
4. Smart contract checks (Clippy in contracts):
```bash
pnpm run smart-contract:clippy
# or: cd backend/contracts && cargo clippy --workspace --all-targets --all-features -- -D warnings
```
5. All CLI checks (recommended before push):
```bash
pnpm run cli-checks
```

#### Quick pre-push checklist
- `pnpm run frontend:orbit-check`
- `pnpm run backend:clippy`
- `pnpm run smart-contract:clippy`
- `pnpm run cli-checks`

> NOTE: Do not push `.md` docs directly in feature branches. Any documentation updates must be included in a PR with code changes and reviewed as part of the standard workflow.
### Frontend Tests
```bash
# Unit tests (coming soon)
pnpm test

# E2E tests (coming soon)
pnpm test:e2e
```

### Backend Tests
```bash
cd backend

# Unit tests
cargo test --lib

# All tests
cargo test

# Specific test
cargo test bounty_creation
```

### Testing Best Practices
- Write tests as you code
- Test happy path and edge cases
- Use descriptive test names
- Keep tests focused and DRY
- Aim for >80% coverage on critical paths

## Documentation

### Code Comments
```typescript
// Use for explaining WHY, not WHAT
// ✅ Good
const timeout = 5000; // Allow 5 seconds for network timeout

// ❌ Avoid
const timeout = 5000; // Set timeout to 5000ms
```

### Function Documentation
```typescript
/**
 * Filters creators by discipline and search query
 * @param creators - Array of creator objects
 * @param discipline - Discipline filter value
 * @param query - Search query string
 * @returns Filtered array of creators
 */
function filterCreators(
  creators: Creator[],
  discipline: string,
  query: string
): Creator[] {
  // implementation
}
```

### README & Docs
- Update relevant docs with feature changes
- Include examples and usage instructions
- Keep formatting consistent
- Link to related documentation

## Pull Request Process

### Before Submitting
- [ ] Code follows style guidelines
- [ ] Self-reviewed code for clarity
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] Tests written and passing
- [ ] No console errors or warnings
- [ ] Changes don't break existing features

### PR Description
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Closes #123

## Testing
How were changes tested?

## Screenshots (if applicable)
Before/after screenshots

## Checklist
- [ ] Tests pass
- [ ] Docs updated
- [ ] No new warnings
```

### Review & Feedback
- Respond to review comments promptly
- Explain design decisions if questioned
- Make requested changes or discuss alternatives
- Mark conversations as resolved after addressing

## Branching Strategy

```
main (production-ready)
  ↓
develop (integration branch)
  ↓
feature/* (new features)
bugfix/* (bug fixes)
docs/* (documentation)
chore/* (maintenance)
```

## Release Process

1. **Version Bump** (semantic versioning)
   ```
   - MAJOR: Breaking changes
   - MINOR: New features
   - PATCH: Bug fixes
   ```

2. **Update CHANGELOG.md**

3. **Create Release Tag**
   ```bash
   git tag -a v0.2.0 -m "Release version 0.2.0"
   git push origin v0.2.0
   ```

## Common Issues & Solutions

### Issue: Port 3000 already in use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
# Restart
pnpm dev
```

### Issue: Node modules conflicts
```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Issue: TypeScript errors
```bash
# Regenerate types
pnpm type-check

# Clear cache
rm -rf .next
pnpm dev
```

### Issue: Cargo build fails
```bash
# Update dependencies
cargo update

# Clean build
cargo clean
cargo build --release
```

## Getting Help

- **Documentation**: See [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Issues**: Search existing issues before creating new ones
- **Discussions**: Join discussions for questions and brainstorming
- **Contact**: Reach out to maintainers via GitHub

## Resources

### Frontend
- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [TypeScript](https://www.typescriptlang.org)

### Backend
- [Soroban Docs](https://stellar.org/soroban)
- [Stellar SDK Rust](https://github.com/stellar/rs-soroban-sdk)
- [Actix-web Docs](https://actix.rs)
- [Tokio Docs](https://tokio.rs)

## Legacy Documentation Index (merged from DOCUMENTATION_INDEX.md)

# Stellar Platform - Documentation Index

Welcome to Stellar! This index will help you navigate all available documentation.

## 🚀 Getting Started

**New to Stellar?** Start here:

1. **[QUICKSTART.md](./QUICKSTART.md)** (5 min read)
   - Installation in 3 steps
   - Common tasks and file locations
   - Quick troubleshooting
   - Basic development commands

2. **[README.md](./README.md)** (15 min read)
   - Project overview
   - Features and tech stack
   - Setup and deployment
   - Data models and features
   - Roadmap and future plans

## 🏗️ Architecture & Design

**Understanding the system:**

3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** (20 min read)
   - System overview with diagrams
   - Frontend & backend architecture
   - Data flow and integration
   - Technology choices explained
   - Security considerations
   - Performance optimizations
   - Deployment strategies

4. **[backend/README.md](./backend/README.md)** (25 min read)
   - Smart contract specifications
   - Contract interfaces and usage
   - REST API documentation
   - Database schema
   - Development guides
   - Deployment instructions

## 🤝 Development

**Contributing and extending:**

5. **[CONTRIBUTING.md](./CONTRIBUTING.md)** (20 min read)
   - Development setup
   - Workflow guidelines
   - Code style standards
   - Testing best practices
   - PR process
   - Release procedures
   - Learning resources

## 📋 Project Status

**Current state:**

6. **[COMPLETION_SUMMARY.md](./COMPLETION_SUMMARY.md)** (10 min read)
   - Project overview
   - Completed features
   - Architecture highlights
   - Bug fixes applied
   - Implementation status
   - Known issues
   - Future roadmap

## 📁 Documentation Hierarchy

```
Documentation Index (you are here)
│
├── QUICKSTART.md                 # Start here! (5 min)
│   └── For: New users, quick setup
│
├── README.md                     # Main docs (15 min)
│   ├── Features & Tech Stack
│   ├── Setup & Deployment
│   ├── Data Models
│   └── Roadmap
│
├── ARCHITECTURE.md               # System design (20 min)
│   ├── System Overview
│   ├── Frontend & Backend
│   ├── Data Flow
│   └── Deployment
│
├── backend/README.md             # Backend specs (25 min)
│   ├── Smart Contracts
│   ├── API Documentation
│   ├── Database Schema
│   └── Deployment Guide
│
└── CONTRIBUTING.md               # Dev guidelines (20 min)
    ├── Setup & Workflow
    ├── Code Style
    ├── Testing
    └── Release Process
```

## 🎯 Find What You Need

### I want to...

**...understand the project**
- Read: QUICKSTART.md → README.md
- Time: 20 minutes

**...set up for development**
- Read: QUICKSTART.md
- Follow: Installation section
- Time: 5 minutes

**...understand the architecture**
- Read: ARCHITECTURE.md
- Review: Diagrams and data flows
- Time: 20 minutes

**...work on smart contracts**
- Read: backend/README.md
- Review: Contract specifications
- Time: 30 minutes

**...contribute to the project**
- Read: CONTRIBUTING.md
- Follow: Development workflow
- Time: 15 minutes

**...deploy to production**
- Read: README.md Deployment section
- Reference: ARCHITECTURE.md
- Time: 30 minutes

**...see what's been done**
- Read: COMPLETION_SUMMARY.md
- Time: 10 minutes

## 📚 Topic Guide

### Frontend Development
- **File**: README.md, QUICKSTART.md
- **Topics**: Pages, components, styling, dark mode
- **Tools**: Next.js 16, TypeScript, Tailwind CSS

### Backend Development  
- **File**: backend/README.md, ARCHITECTURE.md
- **Topics**: Smart contracts, API, database
- **Tools**: Rust, Soroban SDK, Actix-web, PostgreSQL

### Deployment
- **File**: README.md, ARCHITECTURE.md
- **Topics**: Vercel, cloud platforms, blockchain networks
- **Options**: Vercel, AWS, GCP, Digital Ocean, Railway

### Contributing
- **File**: CONTRIBUTING.md
- **Topics**: Setup, workflow, code style, testing
- **Process**: Fork, branch, commit, PR

### Architecture
- **File**: ARCHITECTURE.md
- **Topics**: System design, data flow, technology choices
- **Sections**: Frontend, backend, blockchain, integrations

## 🔗 External References

### Framework Documentation
- [Next.js](https://nextjs.org/docs)
- [React](https://react.dev)
- [TypeScript](https://www.typescriptlang.org/docs)

### Styling & UI
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com)
- [Lucide Icons](https://lucide.dev)

### Backend & Blockchain
- [Soroban](https://stellar.org/soroban)
- [Stellar](https://developers.stellar.org)
- [Rust](https://doc.rust-lang.org)
- [Actix-web](https://actix.rs)

### Tools
- [Vercel](https://vercel.com)
- [Docker](https://docs.docker.com)
- [PostgreSQL](https://www.postgresql.org/docs)

## 📊 Document Statistics

| Document | Type | Length | Time to Read |
|----------|------|--------|--------------|
| QUICKSTART.md | Guide | 349 lines | 5 min |
| README.md | Documentation | 550 lines | 15 min |
| ARCHITECTURE.md | Design | 434 lines | 20 min |
| CONTRIBUTING.md | Guidelines | 413 lines | 20 min |
| backend/README.md | Specification | 553 lines | 25 min |
| COMPLETION_SUMMARY.md | Status | 408 lines | 10 min |
| **Total** | | **2,707 lines** | **95 min** |

## 🎓 Learning Paths

### Path 1: Quick Start (15 minutes)
1. QUICKSTART.md
2. Start `pnpm dev`
3. Explore the app

### Path 2: Full Understanding (1 hour)
1. QUICKSTART.md (5 min)
2. README.md (15 min)
3. ARCHITECTURE.md (20 min)
4. Explore codebase (20 min)

### Path 3: Development Setup (1.5 hours)
1. QUICKSTART.md (5 min)
2. CONTRIBUTING.md (20 min)
3. Full stack setup (30 min)
4. First contribution (25 min)

### Path 4: Production Deployment (2 hours)
1. QUICKSTART.md (5 min)
2. ARCHITECTURE.md (20 min)
3. README.md Deployment (15 min)
4. backend/README.md (25 min)
5. Setup & deploy (55 min)

## 🚦 Quick Navigation

**By Experience Level:**

- **Beginners**: QUICKSTART → README
- **Intermediate**: README → ARCHITECTURE
- **Advanced**: ARCHITECTURE → backend/README → CONTRIBUTING

**By Role:**

- **Designer**: README (UI/features), QUICKSTART
- **Frontend Developer**: QUICKSTART → CONTRIBUTING → Code
- **Backend Developer**: backend/README → ARCHITECTURE
- **DevOps**: ARCHITECTURE → README deployment section
- **Manager**: README → COMPLETION_SUMMARY

## 💡 Tips

- Use Ctrl+F (Cmd+F) to search within documents
- Start with QUICKSTART for fastest onboarding
- Reference ARCHITECTURE when making system changes
- Check CONTRIBUTING before submitting PRs
- Keep README handy for deployment checklists

## ❓ FAQ

**Q: Where do I start?**
A: Read QUICKSTART.md (5 min), then `pnpm install && pnpm dev`

**Q: How do I contribute?**
A: Read CONTRIBUTING.md for full guidelines

**Q: How do I deploy?**
A: See README.md deployment section and ARCHITECTURE.md

**Q: Where are the smart contracts?**
A: In `backend/contracts/`, documented in backend/README.md

**Q: How do I report a bug?**
A: Open an issue on GitHub with details from CONTRIBUTING.md

**Q: Can I use this as a template?**
A: Yes! It's MIT licensed. See README.md

---

**Last Updated**: 2024
**Total Documentation**: 2,700+ lines
**Estimated Total Reading Time**: 95 minutes

Start with [QUICKSTART.md](./QUICKSTART.md) →

### Tools
- [ESLint](https://eslint.org)
- [Prettier](https://prettier.io)
- [Clippy](https://github.com/rust-lang/rust-clippy)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions help make Stellar better for everyone. We appreciate your time and effort! 🎉
