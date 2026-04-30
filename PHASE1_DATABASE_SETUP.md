# Phase 1: Database & API Implementation Guide

## Overview
This guide provides step-by-step instructions for setting up the database, configuring authentication, and deploying the API routes created in Phase 1.

## Part 1: Supabase Setup

### 1. Create Supabase Project
1. Go to https://supabase.com and create an account
2. Create a new project (e.g., "stellar-marketplace")
3. Note down your Project URL and Anon Key from Settings > API

### 2. Create Database Tables

Execute the following SQL in Supabase SQL Editor:

#### Users Table (auto-created by Supabase Auth)
The `auth.users` table is created automatically by Supabase Auth. No action needed.

#### Creators Table
```sql
CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  discipline VARCHAR(50) NOT NULL,
  tagline VARCHAR(200),
  cover_image VARCHAR(500),
  skills TEXT[] DEFAULT ARRAY[]::TEXT[],
  hourly_rate DECIMAL(10,2),
  availability VARCHAR(20) DEFAULT 'available' CHECK (availability IN ('available', 'limited', 'unavailable')),
  rating DECIMAL(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_creators_discipline ON creators(discipline);
CREATE INDEX idx_creators_rating ON creators(rating DESC);
CREATE INDEX idx_creators_skills ON creators USING GIN(skills);
```

#### Bounties Table
```sql
CREATE TABLE bounties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  budget DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  deadline TIMESTAMP NOT NULL,
  difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'expert')),
  category VARCHAR(50) NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bounties_difficulty ON bounties(difficulty);
CREATE INDEX idx_bounties_category ON bounties(category);
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_budget ON bounties(budget);
CREATE INDEX idx_bounties_created_by ON bounties(created_by);
CREATE INDEX idx_bounties_tags ON bounties USING GIN(tags);
```

#### Bounty Applications Table
```sql
CREATE TABLE bounty_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  proposed_budget DECIMAL(12,2) NOT NULL,
  timeline_days INTEGER NOT NULL,
  proposal_text TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_applications_bounty_id ON bounty_applications(bounty_id);
CREATE INDEX idx_applications_creator_id ON bounty_applications(creator_id);
CREATE INDEX idx_applications_status ON bounty_applications(status);
```

#### Reviews Table
```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reviews_creator_id ON reviews(creator_id);
CREATE INDEX idx_reviews_reviewer_id ON reviews(reviewer_id);
```

### 3. Enable RLS (Row Level Security)

Execute in SQL Editor:

```sql
-- Enable RLS on all tables
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Creators: Users can read all, only creators can edit their own
CREATE POLICY "Creators are viewable by everyone" ON creators FOR SELECT USING (true);
CREATE POLICY "Users can create creator profile" ON creators FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON creators FOR UPDATE USING (auth.uid() = user_id);

-- Bounties: Everyone can read open bounties, only creator can edit
CREATE POLICY "Bounties are viewable by everyone" ON bounties FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create bounties" ON bounties FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update own bounties" ON bounties FOR UPDATE USING (auth.uid() = created_by);

-- Bounty Applications: Visible to applicant and bounty creator
CREATE POLICY "Applications visible to applicant and creator" ON bounty_applications FOR SELECT USING (
  auth.uid() = creator_id OR auth.uid() = (SELECT created_by FROM bounties WHERE id = bounty_id)
);
CREATE POLICY "Applicants can create applications" ON bounty_applications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Reviews: Public read, authenticated users can write
CREATE POLICY "Reviews are viewable by everyone" ON reviews FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create reviews" ON reviews FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

## Part 2: Environment Variables

### 1. Get API Keys from Supabase
1. In Supabase Dashboard, go to Settings > API
2. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Anon Key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Service Role Key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret, server-side only)

### 2. Create `.env.local` file
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxxxxxx
NEXTAUTH_SECRET=your_random_secret_here
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

## Part 3: Testing the API

### Test Creators Endpoint
```bash
# Get all creators
curl "http://localhost:3000/api/creators"

# Filter by discipline
curl "http://localhost:3000/api/creators?discipline=UI/UX%20Design"

# Search
curl "http://localhost:3000/api/creators?search=john"

# With pagination
curl "http://localhost:3000/api/creators?limit=5&offset=0"
```

### Test Bounties Endpoint
```bash
# Get all bounties
curl "http://localhost:3000/api/bounties"

# Filter by difficulty
curl "http://localhost:3000/api/bounties?difficulty=advanced"

# Filter by budget range
curl "http://localhost:3000/api/bounties?min_budget=1000&max_budget=5000"
```

### Test Search Endpoint
```bash
# Search all
curl "http://localhost:3000/api/search?q=design"

# Search creators only with operators
curl "http://localhost:3000/api/search?q=figma&type=creators"

# Search bounties by category
curl "http://localhost:3000/api/search?q=branding&type=bounties&category=Brand%20Strategy"
```

## Part 4: Integration with Frontend

### Update Creator Pages to Use API

Modify `app/creators/page.tsx`:
1. Import `fetch` utilities from `@/lib/api-client.ts` (create this file)
2. Replace static `creators` import with API call
3. Use `useEffect` for initial load and filter changes
4. Pass API data to existing components

Example pattern:
```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function CreatorsPage() {
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    const fetchCreators = async () => {
      const params = new URLSearchParams();
      
      if (searchParams.get('discipline')) {
        params.append('discipline', searchParams.get('discipline')!);
      }
      
      const res = await fetch(`/api/creators?${params}`);
      const data = await res.json();
      setCreators(data.data);
      setLoading(false);
    };

    fetchCreators();
  }, [searchParams]);

  // ... rest of component
}
```

## Part 5: Success Criteria

- [ ] All 5 database tables created with proper indexes
- [ ] RLS policies enabled and tested
- [ ] Environment variables configured correctly
- [ ] API endpoints responding with correct data
- [ ] Pagination working (limit/offset parameters)
- [ ] Filtering working (discipline, difficulty, etc.)
- [ ] Search functionality working across all entity types
- [ ] Error handling returning proper HTTP status codes
- [ ] Input validation working with Zod schemas
- [ ] Frontend pages updated to use API endpoints

## Next Steps

Once Phase 1 is complete:
1. Implement authentication system (Issue #3)
2. Add image optimization (Issue #1)
3. Enhance search UI (Issue #2)
4. Move to Phase 2: Core Functionality
