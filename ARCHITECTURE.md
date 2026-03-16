# Stellar Platform - Architecture Documentation

## System Overview

Stellar is a two-tier platform combining a modern Next.js frontend with a Soroban smart contract backend on the Stellar blockchain, complemented by Rust microservices.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 16)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Landing → Creators → Freelancers → Bounties → About     │   │
│  │              Dark/Light Mode • Responsive                │   │
│  │              TypeScript • Tailwind CSS • Shadcn/ui       │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                        API Gateway (Rust)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Actix-web REST API Server                              │   │
│  │  - /api/bounties (CRUD)                                 │   │
│  │  - /api/freelancers (Query & Management)               │   │
│  │  - /api/escrow (Payment Management)                    │   │
│  │  - Authentication & Authorization                       │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                   Soroban Smart Contracts                        │
│  ┌─────────────────┐ ┌──────────────┐ ┌───────────────────┐   │
│  │   Bounty        │ │   Escrow     │ │  Freelancer       │   │
│  │  - Create       │ │  - Deposit   │ │  - Register       │   │
│  │  - Apply        │ │  - Release   │ │  - Rate           │   │
│  │  - Complete     │ │  - Refund    │ │  - Verify         │   │
│  │  - Status       │ │  - Conditions│ │  - Stats          │   │
│  └─────────────────┘ └──────────────┘ └───────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │    Governance - Platform Fees, Limits & Voting          │   │
│  └───────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                   Supporting Services                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │  PostgreSQL  │  │    Redis     │  │ Event Indexer    │      │
│  │              │  │              │  │                  │      │
│  │  - Users     │  │  - Cache     │  │  - Blockchain    │      │
│  │  - Bounties  │  │  - Sessions  │  │    Events        │      │
│  │  - Escrow    │  │  - Queues    │  │  - Notifications │      │
│  │  - Profiles  │  │              │  │                  │      │
│  └──────────────┘  └──────────────┘  └──────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│                    Stellar Blockchain                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  - Network: Testnet (development) / Public (production) │   │
│  │  - Native Assets: XLM (Stellar Lumens)                  │   │
│  │  - Custom Assets: STELLAR (Utility Token)              │   │
│  │  - Consensus: Stellar Consensus Protocol (SCP)         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Architecture

### Pages & Routes

```
app/
├── /                    # Landing page with hero & featured creators
├── /creators            # Creators directory (filterable)
├── /creators/[id]       # Individual creator profile
├── /freelancers         # Freelancer marketplace (searchable)
├── /bounties            # Bounties marketplace (filterable)
└── /about               # Platform information & mission
```

### Component Hierarchy

```
Layout (Root)
├── Header
│   ├── Logo
│   ├── Navigation
│   ├── Theme Toggle
│   └── Mobile Menu
├── Main Content
│   ├── (Page-specific components)
│   └── CreatorCard / ProjectCard
└── Footer
    ├── Links
    ├── Social
    └── Copyright
```

### Data Flow

```
Users Interact
    ↓
Next.js Pages/Components (Client-side rendering)
    ↓
useRouter (Client-side navigation)
    ↓
API Calls to Backend
    ↓
Smart Contracts (Soroban)
    ↓
Stellar Blockchain
    ↓
Return Results
    ↓
Update Component State
    ↓
Re-render UI
```

## Backend Architecture

### Smart Contracts Flow

#### Bounty Creation & Completion
```
Creator → Create Bounty (Bounty Contract)
    ↓
  Store on Blockchain
    ↓
Freelancer → Apply (Submit Proposal)
    ↓
  Store Application
    ↓
Creator → Select Freelancer
    ↓
  Update Status → In Progress
    ↓
Funds Released via Escrow Contract
    ↓
Creator → Mark Complete
    ↓
  Freelancer Profile Updated
    ↓
  Transaction Complete
```

#### Payment Flow
```
Payer → Deposit to Escrow
    ↓
  Funds Locked (Escrow Contract)
    ↓
Freelancer → Complete Work
    ↓
Payer/Freelancer → Release Funds
    ↓
  Validate Conditions Met
    ↓
  Transfer to Payee
    ↓
  Update Status → Released
```

### API Service Architecture

```
Request → Middleware (Auth, Logging)
  ↓
Route Handler
  ↓
Business Logic Layer
  ↓
Smart Contract Interface
  ↓
Blockchain Interaction
  ↓
Database Operations (optional)
  ↓
Response Formatting
  ↓
Client Response
```

### Database Schema (PostgreSQL)

```sql
-- Users & Profiles
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    stellar_address TEXT UNIQUE NOT NULL,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    discipline TEXT,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bounties (indexed from blockchain)
CREATE TABLE bounties (
    id SERIAL PRIMARY KEY,
    bounty_id BIGINT UNIQUE NOT NULL,  -- Soroban contract ID
    creator_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL(18,2),
    deadline TIMESTAMP,
    status VARCHAR(50),
    selected_freelancer_address TEXT,
    created_at TIMESTAMP,
    FOREIGN KEY (creator_address) REFERENCES users(stellar_address)
);

-- Bounty Applications (indexed from blockchain)
CREATE TABLE applications (
    id SERIAL PRIMARY KEY,
    app_id BIGINT UNIQUE NOT NULL,     -- Soroban contract ID
    bounty_id BIGINT REFERENCES bounties(bounty_id),
    freelancer_address TEXT NOT NULL,
    proposal TEXT,
    proposed_budget DECIMAL(18,2),
    timeline SMALLINT,  -- days
    status VARCHAR(50),
    created_at TIMESTAMP
);

-- Escrow Accounts (indexed from blockchain)
CREATE TABLE escrow_accounts (
    id SERIAL PRIMARY KEY,
    escrow_id BIGINT UNIQUE NOT NULL,  -- Soroban contract ID
    payer_address TEXT,
    payee_address TEXT,
    amount DECIMAL(18,2),
    status VARCHAR(50),
    condition VARCHAR(50),
    created_at TIMESTAMP,
    released_at TIMESTAMP
);

-- Freelancer Ratings (indexed from blockchain)
CREATE TABLE ratings (
    id SERIAL PRIMARY KEY,
    freelancer_address TEXT,
    rater_address TEXT,
    rating SMALLINT,  -- 1-5
    review TEXT,
    bounty_id BIGINT,
    created_at TIMESTAMP
);
```

## Data Flow & Integration

### Frontend to Backend
```
1. User interaction in Next.js component
2. Component calls API endpoint (via fetch or SWR)
3. API Server (Rust) receives request
4. Validates & authenticates request
5. Interacts with Soroban contract
6. Contract updates blockchain state
7. API returns result to frontend
8. Frontend updates component state & re-renders
```

### Blockchain Events to Database
```
1. Event occurs on Stellar blockchain
2. Indexer service listens to events
3. Indexer parses & validates event
4. Stores normalized data in PostgreSQL
5. Sends notification via message queue
6. Frontend polls API or receives websocket update
7. Frontend refreshes relevant data
```

## Key Design Decisions

### 1. Hybrid On-Chain/Off-Chain Architecture
- **On-Chain**: Critical business logic (bounties, escrow, payments)
- **Off-Chain**: User profiles, analytics, notifications, search indexing

**Rationale**: 
- Immutability and transparency for financial transactions
- Cost efficiency for non-critical data
- Better scalability for user experience

### 2. Soroban Smart Contracts
- **Why Soroban**: Native Stellar blockchain, WASM-based, Rust support
- **Contract Design**: Each domain has its own contract (separation of concerns)
- **State Management**: Persistent storage on blockchain

### 3. REST API Gateway
- **Why Actix-web**: High-performance, async Rust framework
- **Purpose**: Bridge between frontend and smart contracts
- **Benefits**: Type-safety, error handling, request validation

### 4. PostgreSQL + Redis
- **PostgreSQL**: Persistent storage for indexed blockchain data
- **Redis**: Caching frequently accessed data, session management, queues

### 5. JSON-Based Frontend Data
- **Currently**: Hardcoded JSON in `creators-data.ts`
- **Migration Path**: Connect to API with full database backend
- **Benefit**: Can demo without infrastructure dependencies

## Technology Choices

### Frontend
- **Next.js 16**: Latest App Router, server components, edge functions
- **TypeScript**: Type safety across components
- **Tailwind CSS v4**: Utility-first styling with design tokens
- **shadcn/ui**: Accessible, customizable components
- **next-themes**: Dark mode implementation

### Backend
- **Rust**: Performance, memory safety, great for contracts
- **Soroban SDK**: Stellar blockchain integration
- **Actix-web**: High-concurrency HTTP server
- **Tokio**: Async runtime for all services
- **SQLx**: Type-safe SQL queries with compile-time checking

### Blockchain
- **Stellar Network**: Fast, low-cost transactions
- **XLM**: Native asset for fees & value transfer
- **STELLAR Token**: Custom utility token (future)

## Security Considerations

### Smart Contracts
- Address validation for all external callers
- Authorization checks via `require_auth()`
- Overflow/underflow protection (Rust built-in)
- No recursive calls (re-entrancy safe by design)

### API Server
- JWT token-based authentication
- Rate limiting per IP/user
- HTTPS/TLS encryption required
- Input validation & sanitization
- SQL injection prevention (SQLx compile-time checks)
- CORS configuration per environment

### Frontend
- No sensitive keys in client-side code
- Environment variables for API endpoints
- Secure cookie handling
- XSS protection (React built-in)
- CSRF tokens for state-changing operations

## Performance Optimization

### Frontend
- Next.js Image Optimization for assets
- Code splitting & lazy loading
- Server-side rendering where beneficial
- Static generation for non-dynamic pages
- Theme detection (system preference)

### Backend
- PostgreSQL query optimization with indexes
- Redis caching with TTL
- Connection pooling (SQLx default)
- Async/await throughout (Tokio)
- Batch processing for indexer

### Blockchain
- Contract storage optimization (minimize I/O)
- Efficient data structures (Maps, Vectors)
- Ledger entry compaction

## Deployment Architecture

### Development
```
localhost:3000  → Next.js dev server
localhost:3001  → API server (Rust)
localhost:5432  → PostgreSQL
localhost:6379  → Redis
```

### Production
```
Frontend    → Vercel (Next.js edge)
API Server  → Cloud Run / AWS / Digital Ocean
Database    → Managed PostgreSQL
Cache       → Managed Redis
Blockchain  → Stellar Public Network
```

## Monitoring & Observability

### Logging
- Tracing span for each request
- Structured JSON logging
- Log aggregation to external service

### Metrics
- API response times
- Contract invocation counts
- Blockchain confirmation times
- Database query performance
- Cache hit rates

### Alerts
- Contract call failures
- API error rates > threshold
- Database connection issues
- Indexer lag detection

## Future Architecture Improvements

1. **Real-time Updates**
   - WebSocket connections for live bounty feeds
   - Blockchain event subscriptions
   - Bi-directional communication

2. **Scalability**
   - Microservices per domain
   - Message queues for async processing
   - GraphQL layer for efficient queries

3. **Advanced Features**
   - Multi-chain support (Ethereum via Stellar bridges)
   - Layer 2 scaling
   - Decentralized storage (IPFS) for large files
   - Reputation system with NFTs

4. **Developer Experience**
   - GraphQL API alongside REST
   - SDK for JavaScript/Python clients
   - Contract testing framework
   - Development sandbox environment

## References

- [Soroban Documentation](https://stellar.org/soroban)
- [Stellar Developer Guide](https://developers.stellar.org)
- [Next.js Architecture](https://nextjs.org/docs/architecture/nextjs-compiler)
- [Rust Best Practices](https://doc.rust-lang.org/book/)
- [Actix-web](https://actix.rs)
