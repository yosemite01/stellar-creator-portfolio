# Stellar Backend - Soroban Smart Contracts & Rust Services

This directory contains the backend infrastructure for Stellar platform, including Soroban smart contracts for bounties, escrow, and payments on Stellar blockchain, along with Rust-based backend services.

## Architecture

```
backend/
├── contracts/              # Soroban smart contracts
│   ├── bounty/            # Bounty management contract
│   ├── escrow/            # Payment escrow contract
│   ├── freelancer/        # Freelancer registry & ratings
│   └── governance/        # Platform governance
├── services/              # Rust backend services
│   ├── api/              # REST API service
│   ├── auth/             # Authentication service
│   ├── notifications/    # Email & notification service
│   └── indexer/          # Blockchain event indexer
├── tests/                 # Integration tests
└── Cargo.toml            # Workspace configuration
```

## Soroban Smart Contracts

### 1. Bounty Contract (`contracts/bounty/`)
Manages bounty creation, applications, and completion.

**Key Features:**
- Create bounties with budget and timeline
- Submit applications for bounties
- Accept/reject applications
- Release funds upon completion
- Dispute resolution

**Contract Interface:**
```rust
pub struct Bounty {
    id: u64,
    creator: Address,
    title: String,
    description: String,
    budget: i128,
    deadline: u64,
    status: BountyStatus,
    selected_freelancer: Option<Address>,
}

pub enum BountyStatus {
    Open,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}

#[contract]
pub trait BountyContract {
    fn create_bounty(
        env: Env,
        creator: Address,
        title: String,
        budget: i128,
        deadline: u64,
    ) -> u64;
    
    fn apply_for_bounty(
        env: Env,
        bounty_id: u64,
        applicant: Address,
        proposal: String,
    ) -> Result<u64, BountyError>;
    
    fn select_freelancer(
        env: Env,
        bounty_id: u64,
        application_id: u64,
    ) -> Result<(), BountyError>;
    
    fn complete_bounty(
        env: Env,
        bounty_id: u64,
    ) -> Result<(), BountyError>;
    
    fn get_bounty(env: Env, bounty_id: u64) -> Bounty;
}
```

### 2. Escrow Contract (`contracts/escrow/`)
Handles secure payment escrow between creators and clients.

**Key Features:**
- Hold payments in escrow
- Release funds on milestones
- Automated refunds if disputes occur
- Multi-signature support for high-value bounties

**Contract Interface:**
```rust
pub struct EscrowAccount {
    id: u64,
    payer: Address,
    payee: Address,
    amount: i128,
    release_condition: ReleaseCondition,
    status: EscrowStatus,
    created_at: u64,
}

pub enum ReleaseCondition {
    OnCompletion,
    OnMilestone(Vec<Milestone>),
    Timelock(u64),
}

#[contract]
pub trait EscrowContract {
    fn deposit_to_escrow(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        release_condition: ReleaseCondition,
    ) -> u64;
    
    fn release_funds(
        env: Env,
        escrow_id: u64,
    ) -> Result<(), EscrowError>;
    
    fn refund_escrow(
        env: Env,
        escrow_id: u64,
    ) -> Result<(), EscrowError>;
}
```

### 3. Freelancer Registry Contract (`contracts/freelancer/`)
Manages freelancer profiles, ratings, and verification.

**Key Features:**
- Register freelancers with credentials
- Track ratings and reviews
- Reputation system
- Skill verification badges

**Contract Interface:**
```rust
pub struct FreelancerProfile {
    address: Address,
    name: String,
    discipline: String,
    bio: String,
    rating: i128, // Fixed-point: 0-500 = 0-5 stars
    completed_projects: u32,
    total_earnings: i128,
    verified: bool,
}

#[contract]
pub trait FreelancerContract {
    fn register_freelancer(
        env: Env,
        freelancer: Address,
        name: String,
        discipline: String,
        bio: String,
    ) -> Result<(), RegistryError>;
    
    fn update_rating(
        env: Env,
        freelancer: Address,
        rating: i128,
    ) -> Result<(), RegistryError>;
    
    fn verify_freelancer(
        env: Env,
        freelancer: Address,
    ) -> Result<(), RegistryError>;
    
    fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile;
}
```

### 4. Governance Contract (`contracts/governance/`)
Platform governance and parameter management.

**Key Features:**
- Platform fee configuration
- Dispute resolution voting
- Feature proposals and voting
- Treasury management

## Rust Backend Services

### API Service
REST API for frontend integration with Soroban contracts.

**Key Endpoints:**
```
POST /api/bounties              # Create bounty
GET  /api/bounties              # List bounties
GET  /api/bounties/:id          # Get bounty details
POST /api/bounties/:id/apply    # Apply for bounty
POST /api/bounties/:id/select   # Select freelancer

GET  /api/freelancers           # List freelancers
GET  /api/freelancers/:address  # Get freelancer profile
POST /api/freelancers/register  # Register freelancer
POST /api/freelancers/:id/rate  # Rate freelancer

GET  /api/escrow/:id            # Get escrow details
POST /api/escrow/:id/release    # Release funds
POST /api/escrow/:id/refund     # Initiate refund

POST /api/auth/login            # User authentication
POST /api/auth/signup           # User registration
GET  /api/auth/verify           # Verify JWT token
```

### Authentication Service
Manages user authentication with JWT tokens and blockchain wallet integration.

**Key Features:**
- Wallet-based authentication (Stellar)
- Traditional email/password auth
- JWT token generation
- Refresh token management
- Rate limiting per user

### Notification Service
Sends notifications for bounty updates, applications, and payments.

**Supported Channels:**
- Email notifications
- SMS notifications
- Push notifications
- In-app notifications
- Webhook integrations

### Blockchain Indexer
Indexes Soroban contract events for real-time updates.

**Key Responsibilities:**
- Listen to contract events
- Index bounty/application state changes
- Track payment flows
- Update off-chain database

## Getting Started

### Prerequisites
- Rust 1.70+
- Stellar CLI
- Soroban CLI: `stellar contract`
- Node.js 18+ (for testing)

### Installation

1. **Setup Rust environment**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   rustup update
   ```

2. **Install Soroban CLI**
   ```bash
   cargo install stellar-cli --locked
   ```

3. **Clone and build**
   ```bash
   cd backend
   cargo build --release
   ```

4. **Run tests**
   ```bash
   cargo test
   ```

### Running Services

**API Server:**
```bash
cargo run --bin stellar-api -- --port 3001
```

**Blockchain Indexer:**
```bash
cargo run --bin stellar-indexer -- --network testnet
```

**Full backend stack with Docker:**
```bash
docker-compose -f docker-compose.yml up
```

## Development Guide

### Creating a New Soroban Contract

1. **Create contract directory**
   ```bash
   mkdir -p contracts/my-contract
   cd contracts/my-contract
   ```

2. **Initialize as Soroban contract**
   ```bash
   stellar contract init --template basic
   ```

3. **Implement contract trait**
   ```rust
   use soroban_sdk::{contract, contractimpl, Address, Env, String};

   #[contract]
   pub struct MyContract;

   #[contractimpl]
   impl MyContract {
       pub fn hello(env: Env, name: String) -> String {
           // Implementation
       }
   }
   ```

4. **Build and deploy**
   ```bash
   stellar contract build
   stellar contract deploy --network testnet
   ```

### Adding a New API Endpoint

1. **Add route to `services/api/src/routes/`**
   ```rust
   use actix_web::{web, HttpRequest, HttpResponse};

   pub async fn create_bounty(
       req: HttpRequest,
       body: web::Json<CreateBountyRequest>,
   ) -> HttpResponse {
       // Implementation
   }
   ```

2. **Register route in main.rs**
   ```rust
   web::scope("/api")
       .route("/bounties", web::post().to(create_bounty))
   ```

3. **Test endpoint**
   ```bash
   curl -X POST http://localhost:3001/api/bounties \
        -H "Content-Type: application/json" \
        -d '{"title": "My Bounty", "budget": 5000}'
   ```

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Bounties Table
```sql
CREATE TABLE bounties (
    id SERIAL PRIMARY KEY,
    creator_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL(18,2) NOT NULL,
    deadline TIMESTAMP,
    status VARCHAR(50) DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Applications Table
```sql
CREATE TABLE applications (
    id SERIAL PRIMARY KEY,
    bounty_id INT REFERENCES bounties(id),
    freelancer_address TEXT NOT NULL,
    proposal TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Escrow Accounts Table
```sql
CREATE TABLE escrow_accounts (
    id SERIAL PRIMARY KEY,
    payer_address TEXT NOT NULL,
    payee_address TEXT NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    release_condition TEXT,
    created_at TIMESTAMP,
    released_at TIMESTAMP
);
```

## Contract Deployment

### Testnet Deployment
```bash
# Build contract
cargo build --manifest-path contracts/bounty/Cargo.toml --target wasm32-unknown-unknown --release

# Deploy to Stellar Testnet
stellar contract deploy \
  --network testnet \
  --source account-name \
  contracts/bounty/target/wasm32-unknown-unknown/release/bounty.wasm
```

### Mainnet Deployment
```bash
stellar contract deploy \
  --network public \
  --source account-name \
  contracts/bounty/target/wasm32-unknown-unknown/release/bounty.wasm
```

## Performance Optimizations

1. **Contract Optimization**
   - Minimize storage reads/writes
   - Use efficient data structures
   - Batch operations where possible

2. **API Caching**
   - Redis for frequently accessed data
   - Cache bounty listings (5 min TTL)
   - Cache freelancer profiles (1 hour TTL)

3. **Indexer Optimization**
   - Batch event processing
   - Parallel block scanning
   - Connection pooling

## Security Considerations

1. **Smart Contracts**
   - Overflow/underflow checks
   - Access control validation
   - Re-entrancy guards
   - Upgrade mechanisms

2. **Backend Services**
   - Input validation
   - SQL injection prevention
   - Rate limiting
   - CORS configuration
   - API key authentication

3. **Deployment**
   - Secrets management (environment variables)
   - Regular security audits
   - Monitoring and alerting
   - Log aggregation

## Testing

### Unit Tests
```bash
cargo test --lib
```

### Integration Tests
```bash
cargo test --test '*' -- --test-threads=1
```

### Contract Testing
```bash
cargo test --manifest-path contracts/bounty/Cargo.toml
```

## Monitoring & Logging

### Logging Configuration
```rust
use tracing::{info, warn, error};

info!("Bounty created: {}", bounty_id);
error!("Failed to process payment: {}", error);
```

### Metrics
- Contract invocation count
- API response times
- Error rates
- Blockchain confirmation times

## Troubleshooting

### Contract Deployment Fails
- Verify Stellar network connectivity
- Check account balance and sequence number
- Ensure contract WASM is properly compiled

### API Service Won't Start
- Check port availability
- Verify database connection
- Review environment variables
- Check logs: `tail -f logs/api.log`

### Indexer Missing Events
- Verify network RPC endpoint
- Check database connection
- Review block range configuration

## Future Enhancements

- [ ] Multi-sig contract support
- [ ] Automated dispute resolution (arbitration)
- [ ] Milestone-based payments
- [ ] Reputation insurance
- [ ] DAO governance
- [ ] Liquidity pools for payments
- [ ] NFT-based credentials
- [ ] Cross-chain bridges

## Resources

- [Soroban Documentation](https://stellar.org/soroban)
- [Stellar Developer Guide](https://developers.stellar.org)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Actix-web Framework](https://actix.rs)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT License - See LICENSE file for details
