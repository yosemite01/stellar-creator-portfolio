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

### Tools
- [ESLint](https://eslint.org)
- [Prettier](https://prettier.io)
- [Clippy](https://github.com/rust-lang/rust-clippy)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions help make Stellar better for everyone. We appreciate your time and effort! 🎉
