# Stellar Platform: Creator Portfolio, Bounty Marketplace & Freelancing Hub

A world-class platform connecting exceptional non-technical tech professionals across design, writing, marketing, product management, and 15+ other disciplines with opportunities, clients, and collaborators.

## Overview

Stellar is a comprehensive ecosystem designed specifically for non-technical talent in the tech industry. Whether you're a designer, writer, marketer, product manager, or specialist in any creative or strategic discipline, Stellar provides the infrastructure to showcase your work, discover opportunities, and grow your career.

### Key Features

- **Creator Portfolios**: Showcase your work with beautiful, customizable profiles featuring projects, testimonials, and social integration
- **Bounty Marketplace**: Post and apply for short-term, high-impact projects with transparent budgeting and timelines
- **Freelancer Directory**: Browse and hire verified professionals across 15+ non-technical tech disciplines
- **Advanced Filtering**: Find exactly what you need with powerful search, filtering by discipline, experience level, and skills
- **Direct Networking**: Connect directly with professionals via LinkedIn and Twitter integration
- **Dark/Light Mode**: Beautiful, responsive design optimized for all devices with automatic theme switching

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS v4
- **UI Components**: Shadcn/ui
- **Icons**: Lucide React
- **Theme Management**: next-themes
- **Language**: TypeScript

### Backend & Smart Contracts
- **Blockchain**: Stellar Network & Soroban
- **Smart Contracts**: Rust + Soroban SDK
- **API**: Rust + Actix-web
- **Database**: PostgreSQL (extensible)
- **Cache**: Redis
- **Event Indexing**: Custom Rust indexer

### Smart Contracts
1. **Bounty Contract** - Manages bounty creation, applications, and completion
2. **Escrow Contract** - Secure payment handling with milestone-based releases
3. **Freelancer Registry** - Profile management, ratings, and verification
4. **Governance Contract** - Platform fees, parameters, and DAO voting

## Project Structure

```
stellar-platform/
├── app/                         # Next.js 16 Frontend
│   ├── page.tsx                 # Landing page
│   ├── layout.tsx               # Root layout with theme provider
│   ├── globals.css              # Global styles & design tokens
│   ├── creators/
│   │   ├── page.tsx             # Creator directory with filtering
│   │   └── [id]/
│   │       ├── layout.tsx       # Creator profile layout
│   │       └── page.tsx         # Individual creator profile
│   ├── freelancers/
│   │   └── page.tsx             # Freelancer directory & hire interface
│   ├── bounties/
│   │   └── page.tsx             # Bounty marketplace with filters
│   └── about/
│       └── page.tsx             # About & mission page
├── components/
│   ├── header.tsx               # Navigation & theme toggle
│   ├── footer.tsx               # Footer with links & social
│   ├── creator-card.tsx         # Creator profile card component
│   ├── project-card.tsx         # Project showcase card
│   └── ui/                      # Shadcn/ui components
├── lib/
│   └── creators-data.ts         # Sample data, types, and utilities
├── public/
│   ├── avatars/                 # Creator avatars
│   ├── covers/                  # Creator cover images
│   └── projects/                # Project showcase images
│
└── backend/                     # Soroban Smart Contracts & Rust Services
    ├── contracts/              # Soroban smart contracts
    │   ├── bounty/            # Bounty management contract
    │   ├── escrow/            # Payment escrow contract
    │   ├── freelancer/        # Freelancer registry & ratings
    │   └── governance/        # Platform governance
    ├── services/              # Rust backend services
    │   ├── api/              # REST API service (Actix-web)
    │   ├── auth/             # Authentication service
    │   ├── notifications/    # Notification service
    │   └── indexer/          # Blockchain event indexer
    ├── Cargo.toml            # Rust workspace configuration
    ├── docker-compose.yml    # Full stack orchestration
    └── README.md             # Backend documentation
```

## Core Data Models

### Creator
```typescript
interface Creator {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  avatar: string;
  coverImage: string;
  tagline: string;
  linkedIn: string;
  twitter: string;
  portfolio?: string;
  projects: Project[];
  skills: string[];
  stats: {
    projects: number;
    clients: number;
    experience: number;
  };
  services?: Service[];
  hourlyRate?: number;
  responseTime?: string;
  availability?: 'available' | 'limited' | 'unavailable';
  rating?: number;
  reviewCount?: number;
}
```

### Bounty
```typescript
interface Bounty {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: Date;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  tags: string[];
  applicants: number;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  requiredSkills: string[];
  deliverables: string;
}
```

### Service
```typescript
interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  basePrice: number;
  deliveryTime: number; // in days
  rating: number;
  reviewCount: number;
}
```

## Supported Disciplines

Stellar supports talent across 15+ non-technical tech fields:

- **Creative & Design**: UI/UX Design, Brand Strategy
- **Content**: Writing, Content Creation
- **Growth & Marketing**: Marketing, Community Management, Brand Strategy
- **Product & Operations**: Product Management, Project Management, Business Development
- **Data & Analytics**: Data Analysis
- **Revenue & Sales**: Sales, Customer Success
- **People & Legal**: HR & Recruiting, Legal & Compliance

## Design System

### Color Palette

**Light Mode:**
- Primary: Deep Indigo-Blue (oklch(0.35 0.15 250)) - Trust & Professionalism
- Accent: Vibrant Teal (oklch(0.6 0.15 200)) - CTAs & Highlights
- Secondary: Soft Slate (oklch(0.5 0.05 240)) - Supporting Elements
- Muted: Light Grays (oklch(0.92 0 0)) - Subtle Elements

**Dark Mode:**
- Primary: Bright Indigo (oklch(0.65 0.18 255))
- Accent: Bright Cyan-Teal (oklch(0.7 0.18 190))
- Secondary: Soft Grayish-Blue (oklch(0.35 0.08 240))
- Muted: Dark Grays (oklch(0.28 0.02 240))

### Typography

- **Heading Font**: Geist (sans-serif)
- **Body Font**: Geist (sans-serif)
- **Line Height**: 1.4-1.6 (leading-relaxed)

### Spacing & Layout

- Uses Tailwind's spacing scale (4px base unit)
- Responsive breakpoints: sm (640px), md (768px), lg (1024px)
- Flexbox-first approach for layouts
- Max-width container: 7xl (80rem)

## Getting Started

### Prerequisites

- Node.js 18+ (recommended 20+)
- npm, pnpm, yarn, or bun

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/stellar-platform.git
   cd stellar-platform
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   # or npm install / yarn install / bun install
   ```

3. **Run development server**
   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Build for production**
   ```bash
   pnpm build
   pnpm start
   ```

## Customization

### Adding New Creators

Edit `/lib/creators-data.ts` and add entries to the `creators` array:

```typescript
{
  id: 'unique-id',
  name: 'Creator Name',
  title: 'Professional Title',
  discipline: 'UI/UX Design', // or any supported discipline
  bio: 'Brief bio about the creator...',
  avatar: '/avatars/image.jpg',
  coverImage: '/covers/image.jpg',
  tagline: 'Catchy tagline',
  linkedIn: 'https://linkedin.com/in/username',
  twitter: 'https://x.com/username',
  skills: ['Skill 1', 'Skill 2', 'Skill 3'],
  stats: {
    projects: 25,
    clients: 10,
    experience: 5,
  },
  projects: [...],
}
```

### Adding New Bounties

Edit `/lib/creators-data.ts` and add entries to the `bounties` array:

```typescript
{
  id: 'bounty-id',
  title: 'Bounty Title',
  description: 'Detailed description...',
  budget: 2000,
  currency: 'USD',
  deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  difficulty: 'intermediate',
  category: 'Brand Strategy',
  tags: ['tag1', 'tag2'],
  applicants: 5,
  status: 'open',
  requiredSkills: ['Skill 1', 'Skill 2'],
  deliverables: 'List of deliverables...',
}
```

### Updating Design Tokens

Edit `/app/globals.css` to customize the color scheme, spacing, and other design variables:

```css
:root {
  --primary: oklch(0.35 0.15 250);
  --accent: oklch(0.6 0.15 200);
  /* ... more tokens ... */
}
```

## Pages & Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page with hero, featured creators, and benefits |
| `/creators` | Directory of all creators with discipline filtering |
| `/creators/[id]` | Individual creator portfolio with projects & CTA |
| `/freelancers` | Browse freelancers by discipline with search |
| `/bounties` | Bounty marketplace with difficulty & category filters |
| `/about` | About page with mission and platform info |

## Features in Detail

### Creator Directory (`/creators`)
- Grid layout with responsive cards
- Filter by discipline (15+ available)
- View creator stats (projects, clients, experience)
- Quick access to social profiles
- Click-through to full portfolio

### Creator Profile (`/creators/[id]`)
- Hero banner with cover image
- Creator bio and tagline
- Skills showcase
- Complete project portfolio with descriptions
- CTA for collaboration
- Direct links to LinkedIn and Twitter profiles

### Freelancer Directory (`/freelancers`)
- Advanced search by name, skills, or expertise
- Filter by discipline
- View availability and response times (extendable)
- Service packages and rates (extendable)
- Direct hiring CTAs

### Bounty Marketplace (`/bounties`)
- Browse open bounties with full details
- Filter by difficulty level and category
- View budget, timeline, and required skills
- See application count and status
- Apply directly or post new bounties

### About Page (`/about`)
- Mission statement and platform values
- Impact metrics
- How the platform works
- Community guidelines
- Contact information

## Performance Optimizations

- Next.js Image Optimization
- Theme preference detection (system, light, dark)
- Sticky header with blur effect
- Smooth transitions and animations
- Responsive images and typography
- Mobile-first design approach

## Accessibility

- Semantic HTML structure
- ARIA labels for interactive elements
- Proper heading hierarchy
- Color contrast compliance (WCAG AA standard)
- Keyboard navigation support
- Screen reader friendly

## Future Enhancements

### Planned Features
- [ ] User authentication & accounts
- [ ] Creator dashboard for managing profiles
- [ ] Bounty application system with messaging
- [ ] Payment integration
- [ ] Reviews and ratings system
- [ ] Advanced search with saved filters
- [ ] Creator verification badges
- [ ] Portfolio analytics
- [ ] Email notifications
- [ ] Social sharing capabilities
- [ ] API for integrations
- [ ] Admin dashboard

### Database Integration
Currently using JSON data, but easily extensible to:
- Supabase (PostgreSQL + Auth)
- MongoDB
- Firebase
- Prisma ORM

### Real-time Features
- Live notifications for new bounties
- Chat/messaging between creators and clients
- Real-time application updates
- Live bidding for bounties

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Import repository on [Vercel](https://vercel.com)
3. Deploy automatically on every push

```bash
vercel --prod
```

### Deploy Elsewhere

Works with any Node.js hosting:
- Netlify
- AWS Amplify
- Railway
- Render
- DigitalOcean

```bash
pnpm build
NODE_ENV=production pnpm start
```

## Environment Variables

Currently, no environment variables are required for the base installation. Future integrations may require:

```env
DATABASE_URL=          # For database integration
NEXT_PUBLIC_API_URL=   # For API endpoints
AUTH_SECRET=           # For authentication
STRIPE_API_KEY=        # For payments
```

## API Routes (Extensible)

Structure for future API routes:

```
/api/
  ├── creators/
  │   ├── route.ts        # GET /api/creators
  │   └── [id]/route.ts   # GET /api/creators/[id]
  ├── bounties/
  │   ├── route.ts        # GET/POST bounties
  │   └── [id]/route.ts   # GET bounty details
  ├── applications/
  │   └── route.ts        # POST new applications
  └── auth/
      └── route.ts        # Authentication endpoints
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues, questions, or suggestions:

- Open an issue on GitHub
- Contact via LinkedIn
- Email: support@stellar.dev

## Acknowledgments

- Built with Next.js 16 and modern web technologies
- Design inspired by world-class creator platforms
- Icons from Lucide React
- UI components from shadcn/ui
- Color system from OKLCH color space

## Backend Services

The backend provides robust Soroban smart contracts and a Rust-based REST API for seamless frontend integration.

### Smart Contracts
Located in `backend/contracts/`, these Soroban contracts run on the Stellar blockchain:

**Bounty Contract** - Core bounty functionality
- Create bounties with budget and timeline
- Accept freelancer applications
- Track bounty status (open, in-progress, completed, disputed, cancelled)
- Manage freelancer selection

**Escrow Contract** - Secure payments
- Hold funds in escrow during project execution
- Release funds on milestones or timelock
- Refund capabilities for disputes
- Multi-condition release mechanisms

**Freelancer Contract** - Talent management
- Register and manage freelancer profiles
- Track ratings and review history
- Maintain verified status badges
- Aggregate earnings and project history

**Governance Contract** - Platform management
- Configure platform fees
- Set bounty budget limits
- Voting mechanism for proposals
- Treasury management

### API Service
REST API built with Actix-web for frontend integration:

```bash
# Run API server
cd backend
cargo run --bin stellar-api

# API will be available at http://localhost:3001
```

**Key Endpoints:**
- `POST /api/bounties` - Create bounty
- `GET /api/bounties` - List bounties with filters
- `POST /api/bounties/:id/apply` - Apply for bounty
- `POST /api/freelancers/register` - Register freelancer
- `GET /api/freelancers` - List freelancers
- `POST /api/escrow/:id/release` - Release escrowed funds

### Running Full Backend Stack

```bash
# Start all services with Docker Compose
cd backend
docker-compose up

# Services will be available:
# - API: http://localhost:3001
# - pgAdmin: http://localhost:5050 (admin/admin)
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
```

### Backend Development

```bash
# Build all contracts
cd backend
cargo build --release

# Run tests
cargo test

# Deploy to Stellar Testnet
cd contracts/bounty
stellar contract deploy --network testnet --source account-name
```

See [backend/README.md](./backend/README.md) for comprehensive backend documentation, deployment guides, and smart contract specifications.

## Roadmap

### Q1 2024
- [x] Frontend UI for creators and bounties
- [x] Soroban smart contracts (bounty, escrow, freelancer, governance)
- [ ] User authentication with Stellar wallets
- [ ] API integration with frontend

### Q2 2024
- [ ] Payment processing & escrow integration
- [ ] Ratings and reviews system
- [ ] Freelancer verification program
- [ ] Blockchain event indexing

### Q3 2024
- [ ] Mobile app (React Native)
- [ ] Real-time notifications via blockchain events
- [ ] Milestone-based payment releases
- [ ] Dispute resolution system

### Q4 2024
- [ ] Portfolio analytics dashboard
- [ ] Creator verification & reputation NFTs
- [ ] API for third-party integrations
- [ ] Decentralized governance voting

---

**Start your journey on Stellar today** - Where exceptional talent meets extraordinary opportunities.

Built with [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), and [shadcn/ui](https://ui.shadcn.com).
