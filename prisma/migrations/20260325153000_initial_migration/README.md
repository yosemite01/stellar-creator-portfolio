# Initial Migration

This migration creates all database tables required for the Stellar Creator Portfolio platform.

## Tables Created

1. **Account** - NextAuth OAuth account linking
2. **Session** - NextAuth session management
3. **User** - User accounts with role-based access (USER, CREATOR, CLIENT, ADMIN)
4. **VerificationToken** - NextAuth email verification
5. **CreatorProfile** - Creator profiles with skills, portfolio, ratings
6. **ClientProfile** - Client/employer profiles
7. **Bounty** - Bounty listings with budget, deadline, status
8. **BountyApplication** - Applications from creators to bounties

## Enums

- `Role`: USER, CREATOR, CLIENT, ADMIN
- `BountyStatus`: OPEN, IN_PROGRESS, COMPLETED, CANCELLED
- `ApplicationStatus`: PENDING, ACCEPTED, REJECTED, WITHDRAWN

## Indexes

All foreign keys have corresponding indexes for query performance.
Unique constraints are enforced on:
- Account (provider, providerAccountId)
- Session (sessionToken)
- User (email)
- VerificationToken (identifier, token)
- CreatorProfile (userId)
- ClientProfile (userId)
- BountyApplication (bountyId, applicantId)
