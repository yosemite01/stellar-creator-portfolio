import { buildSchema } from 'graphql';

export const typeDefs = buildSchema(`
  type Query {
    bounties(take: Int = 10, cursor: String, status: BountyStatus): BountyConnection!
    bounty(id: String!): Bounty
    creators(take: Int = 10, cursor: String, discipline: String, search: String): CreatorConnection!
    creator(id: String!): Creator
    projects(take: Int = 10, cursor: String, creatorId: String): ProjectConnection!
    myBounties(take: Int = 10, cursor: String): BountyConnection!
    analytics: AnalyticsDashboard
  }

  type Mutation {
    createBounty(
      title: String!
      description: String!
      budget: Int!
      deadline: String!
      category: String!
      tags: [String!]!
      difficulty: Difficulty!
    ): Bounty!

    createProject(
      title: String!
      category: String!
      description: String!
      tags: [String!]!
      year: Int!
      link: String
    ): Project!
  }

  type BountyConnection {
    bounties: [Bounty!]!
    nextCursor: String
    hasNextPage: Boolean!
  }

  type Bounty {
    id: String!
    title: String!
    description: String!
    budget: Int!
    deadline: String!
    status: BountyStatus!
    category: String
    tags: [String!]!
    difficulty: Difficulty
    creator: User!
    createdAt: String!
    updatedAt: String!
  }

  type CreatorConnection {
    creators: [Creator!]!
    nextCursor: String
    hasNextPage: Boolean!
  }

  type Creator {
    id: String!
    name: String
    displayName: String
    discipline: String
    bio: String
    avatar: String
    skills: [String!]!
    hourlyRate: Int
    rating: Float!
    reviewCount: Int
    verified: Boolean!
    verificationTier: VerificationTier!
    projects: [Project!]!
    reviews: [Review!]!
    createdAt: String!
  }

  type ProjectConnection {
    projects: [Project!]!
    nextCursor: String
    hasNextPage: Boolean!
  }

  type Project {
    id: String!
    title: String!
    category: String!
    description: String!
    tags: [String!]!
    year: Int!
    link: String
    creator: User!
    createdAt: String!
  }

  type Review {
    id: String!
    rating: Int!
    title: String!
    body: String!
    isVerifiedPurchase: Boolean!
    createdAt: String!
  }

  type BountyApplication {
    id: String!
    bountyId: String!
    applicantId: String!
    proposal: String!
    proposedBudget: Int!
    timeline: Int!
    status: ApplicationStatus!
    createdAt: String!
  }

  type User {
    id: String!
    name: String
    email: String
  }

  type AnalyticsDashboard {
    totalBounties: Int!
    totalCreators: Int!
    totalProjects: Int!
    averageRating: Float!
  }

  enum BountyStatus {
    OPEN
    IN_PROGRESS
    COMPLETED
    CANCELLED
  }

  enum ApplicationStatus {
    PENDING
    ACCEPTED
    REJECTED
    WITHDRAWN
  }

  enum Difficulty {
    beginner
    intermediate
    advanced
    expert
  }

  enum VerificationTier {
    NONE
    VERIFIED
    TRUSTED
    ELITE
  }
`);
