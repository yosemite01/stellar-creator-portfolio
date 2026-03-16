# Stellar Platform - Quick Start Guide

Get up and running with Stellar in minutes!

## Prerequisites
- Node.js 18+ ([Download](https://nodejs.org))
- Git
- A code editor (VS Code recommended)

## Installation (2 minutes)

```bash
# 1. Clone the repository
git clone https://github.com/stellar/stellar-platform.git
cd stellar-platform

# 2. Install dependencies
pnpm install
# (or: npm install / yarn install / bun install)

# 3. Start development server
pnpm dev

# 4. Open browser
# → http://localhost:3000 ✨
```

## Key Files & Where to Find Things

| What | Where |
|------|-------|
| **Landing Page** | `app/page.tsx` |
| **Creator Directory** | `app/creators/page.tsx` |
| **Creator Profile** | `app/creators/[id]/page.tsx` |
| **Freelancer Hub** | `app/freelancers/page.tsx` |
| **Bounty Marketplace** | `app/bounties/page.tsx` |
| **Creator Data** | `lib/creators-data.ts` |
| **Header Component** | `components/header.tsx` |
| **Footer Component** | `components/footer.tsx` |
| **Styling** | `app/globals.css` |
| **Theme Config** | `tailwind.config.ts` |

## Common Tasks

### 🎨 Customize Colors
Edit `app/globals.css`:
```css
:root {
  --primary: oklch(0.35 0.15 250);  /* Change this */
  --accent: oklch(0.6 0.15 200);    /* Change this */
  /* ... more colors ... */
}
```

### 👤 Add a New Creator
Edit `lib/creators-data.ts` and add to `creators` array:
```typescript
{
  id: 'unique-id',
  name: 'John Doe',
  title: 'Product Designer',
  discipline: 'UI/UX Design',
  bio: 'Passionate about user-centered design...',
  // ... other fields
}
```

### 🎯 Add a New Bounty
Edit `lib/creators-data.ts` and add to `bounties` array:
```typescript
{
  id: 'bounty-id',
  title: 'Design Landing Page',
  description: '...',
  budget: 3000,
  // ... other fields
}
```

### 🔧 Modify Navigation
Edit `components/header.tsx` in the `<nav>` section:
```typescript
<Link href="/your-new-page">Your Link</Link>
```

### 📱 Change Typography
Edit `app/layout.tsx` to import different fonts and `globals.css` to apply them:
```typescript
import { YourFont } from 'next/font/google'
const yourFont = YourFont({ subsets: ['latin'] })
```

## Folder Structure

```
project/
├── app/              # Pages (create new pages here)
├── components/       # Reusable components
├── lib/              # Data & utilities
├── public/           # Static assets
├── styles/           # Global styles
└── backend/          # Smart contracts & API (optional)
```

## Navigation & Pages

```
/ (Home)
  ├── /creators (All creators)
  ├── /creators/[id] (Creator profile)
  ├── /freelancers (Hire freelancers)
  ├── /bounties (Browse bounties)
  └── /about (About page)
```

## Development Commands

```bash
# Start dev server
pnpm dev

# Build for production
pnpm build

# Run production build locally
pnpm start

# Format code
pnpm format

# Check types
pnpm type-check

# Lint code (when available)
pnpm lint
```

## Troubleshooting

### Port 3000 in use?
```bash
# Find process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Styles not applying?
```bash
# Clear Next.js cache
rm -rf .next
pnpm dev
```

### TypeScript errors?
```bash
# Regenerate types
pnpm type-check
```

### Changes not showing?
1. Hard refresh: `Ctrl+Shift+R` (Cmd+Shift+R on Mac)
2. Clear browser cache
3. Restart dev server

## Backend Setup (Optional)

### Prerequisites
- Rust 1.70+ ([Install](https://rustup.rs))
- Docker & Docker Compose

### Quick Start
```bash
cd backend

# Build contracts
cargo build --release

# Start full stack
docker-compose up

# API at http://localhost:3001
# pgAdmin at http://localhost:5050 (admin/admin)
```

## Deployment

### Deploy Frontend
```bash
# Vercel (Recommended)
npm install -g vercel
vercel

# Or use GitHub integration in Vercel dashboard
```

### Deploy Backend
```bash
# AWS, GCP, DigitalOcean, etc.
# See ARCHITECTURE.md for details
```

## File Navigation Tips

### Create a new page
1. Create `app/your-page/page.tsx`
2. Add route to header navigation
3. Import components as needed

### Create a new component
1. Create `components/your-component.tsx`
2. Use client/server directive as needed
3. Export from component file
4. Import where needed

### Style a component
1. Add className with Tailwind classes
2. Or use CSS modules (CSS in JS also works)
3. Reference design tokens from globals.css

## Design System

### Colors (predefined)
```
Primary: Deep Indigo-Blue (trust)
Accent: Vibrant Teal (CTAs)
Secondary: Soft Slate (support)
Muted: Light Grays (subtle)
```

### Typography
- Headings: Geist Bold
- Body: Geist Regular
- Code: Monospace

### Spacing
- Uses Tailwind scale: 4px, 8px, 12px, 16px, etc.
- Use classes: `p-4`, `m-2`, `gap-6`, etc.

### Shadows & Borders
- Use Tailwind utilities: `shadow-md`, `border`, `border-border`
- Radius: `rounded-lg` (preset in design tokens)

## Quick Links

- 📖 [Full Documentation](./README.md)
- 🏗️ [Architecture Details](./ARCHITECTURE.md)
- 🤝 [Contributing Guide](./CONTRIBUTING.md)
- 🚀 [Backend Setup](./backend/README.md)
- 💬 [GitHub Issues](https://github.com/stellar/stellar-platform/issues)

## Database (if using backend)

### Connect Frontend to API
Replace data imports with API calls:
```typescript
// Old: import { creators } from '@/lib/creators-data'
// New: const { data: creators } = await fetch('/api/creators')
```

### Run Migrations
```bash
cd backend
sqlx migrate run
```

## Environment Variables

### Frontend
No required env vars for basic setup.

Optional:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=Stellar
```

### Backend
```env
DATABASE_URL=postgres://user:password@localhost:5432/db
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
```

## Learning Resources

- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript](https://www.typescriptlang.org/docs)
- [Soroban](https://stellar.org/soroban)
- [Rust Book](https://doc.rust-lang.org/book/)

## Common Patterns

### Fetch Data
```typescript
const data = await fetch('/api/endpoint')
const result = await data.json()
```

### Navigate Programmatically
```typescript
'use client'
import { useRouter } from 'next/navigation'

const router = useRouter()
router.push('/path')
```

### Use State
```typescript
'use client'
import { useState } from 'react'

const [count, setCount] = useState(0)
```

### Dark Mode
Already configured! Toggle in header.
- Automatic based on system preference
- Manual toggle in header component
- Styled via CSS variables

## Getting Help

1. **Check docs**: README.md, ARCHITECTURE.md
2. **Search issues**: GitHub Issues
3. **Ask questions**: GitHub Discussions
4. **Report bugs**: Open an issue with details

## Pro Tips

💡 **Use TypeScript** - Get autocomplete & type safety

💡 **Component composition** - Keep components small & focused

💡 **Semantic HTML** - Use `<header>`, `<main>`, `<footer>` etc.

💡 **Accessible design** - Add `aria-labels` and test with screen readers

💡 **Environment variables** - Use for configuration, never hardcode

💡 **Git commit messages** - Use conventional commits (feat:, fix:, docs:)

---

**Happy coding! 🚀 Start editing and see changes immediately!**

For more details, see [README.md](./README.md)
