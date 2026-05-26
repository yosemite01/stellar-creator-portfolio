/**
 * Strict TypeScript interfaces for WebSocket messages and API payloads
 * Replaces any types with strongly typed models
 */

// API Response Envelope
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// Bounty Models
export interface BountyPayload {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  tags: string[];
  applicants: number;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  requiredSkills: string[];
  deliverables: string;
  createdAt: string;
  updatedAt: string;
}

export interface BountyUpdatePayload {
  id: string;
  title: string;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  applicants: number;
  updatedAt: string;
}

// Creator Models
export interface CreatorPayload {
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
  skills: string[];
  stats: {
    projects: number;
    clients: number;
    experience: number;
  };
  services?: ServicePayload[];
  hourlyRate?: number;
  responseTime?: string;
  availability: 'available' | 'limited' | 'unavailable';
  rating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorUpdatePayload {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  availability: 'available' | 'limited' | 'unavailable';
  updatedAt: string;
}

// Service Models
export interface ServicePayload {
  id: string;
  name: string;
  description: string;
  category: string;
  basePrice: number;
  deliveryTime: number;
  rating: number;
  reviewCount: number;
}

// Application Models
export interface ApplicationPayload {
  id: string;
  bountyId: string;
  creatorId: string;
  status: 'pending' | 'accepted' | 'rejected';
  proposedBudget?: number;
  message?: string;
  appliedAt: string;
  respondedAt?: string;
}

export interface ApplicationUpdatePayload {
  id: string;
  bountyId: string;
  creatorId: string;
  status: 'pending' | 'accepted' | 'rejected';
  appliedAt: string;
}

// Review Models
export interface ReviewPayload {
  id: string;
  creatorId: string;
  rating: number;
  comment: string;
  reviewer: string;
  createdAt: string;
}

// WebSocket Message Types
export type WebSocketEventPayload =
  | BountyUpdatePayload
  | CreatorUpdatePayload
  | ApplicationUpdatePayload;

export interface WebSocketMessage<T = WebSocketEventPayload> {
  type: 'bounty.updated' | 'creator.updated' | 'application.updated';
  data: T;
  timestamp: number;
}

// Error Models
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Pagination Models
export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Filter Models
export interface BountyFilterParams extends PaginationParams {
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: 'open' | 'in-progress' | 'completed' | 'cancelled';
  tags?: string[];
}

export interface CreatorFilterParams extends PaginationParams {
  discipline?: string;
  minRating?: number;
  availability?: 'available' | 'limited' | 'unavailable';
  skills?: string[];
}
