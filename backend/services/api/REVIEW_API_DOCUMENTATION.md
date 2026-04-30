# Review Filtering and Sorting API Documentation

## Overview

This document describes the API endpoints for filtering and sorting reviews in the Stellar Creator Portfolio platform. The implementation provides comprehensive review management capabilities with pagination, filtering, and sorting support.

## Endpoints

### 1. Get Creator Reviews (Filtered)

**Endpoint:** `GET /api/v1/creators/{id}/reviews`

**Description:** Retrieve reviews for a specific creator with advanced filtering, sorting, and pagination options.

**Path Parameters:**
- `id` (string, required): Creator ID

**Query Parameters:**

| Parameter | Type | Description | Default | Validation |
|-----------|------|-------------|---------|------------|
| `minRating` | integer | Minimum rating (1-5) | none | 1 ≤ value ≤ 5 |
| `maxRating` | integer | Maximum rating (1-5) | none | 1 ≤ value ≤ 5, ≥ minRating |
| `dateFrom` | string | Start date (ISO format) | none | ISO date string |
| `dateTo` | string | End date (ISO format) | none | ISO date string |
| `verifiedOnly` | boolean | Show only high-quality reviews (≥4 stars) | false | true/false |
| `sortBy` | string | Sort field | "createdAt" | "createdAt", "rating", "reviewerName" |
| `sortOrder` | string | Sort direction | "desc" | "asc", "desc" |
| `page` | integer | Page number | 1 | ≥ 1 |
| `limit` | integer | Items per page | 10 | 1 ≤ value ≤ 100 |

**Example Request:**
```
GET /api/v1/creators/alex-studio/reviews?minRating=4&sortBy=rating&sortOrder=desc&page=1&limit=5
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "creatorId": "alex-studio",
    "aggregation": {
      "averageRating": 4.67,
      "totalReviews": 3,
      "stars5": 2,
      "stars4": 1,
      "stars3": 0,
      "stars2": 0,
      "stars1": 0,
      "isVerified": true
    },
    "filteredAggregation": {
      "averageRating": 4.67,
      "totalReviews": 3,
      "stars5": 2,
      "stars4": 1,
      "stars3": 0,
      "stars2": 0,
      "stars1": 0,
      "isVerified": true
    },
    "reviews": {
      "reviews": [
        {
          "id": "r-alex-1",
          "rating": 5,
          "title": "Exceptional design partner",
          "body": "Delivered a full design system on time; communication was clear throughout.",
          "reviewerName": "Sam K.",
          "createdAt": "2025-08-12"
        }
      ],
      "totalCount": 3,
      "page": 1,
      "limit": 5,
      "totalPages": 1,
      "hasNext": false,
      "hasPrev": false
    },
    "appliedFilters": {
      "minRating": 4,
      "maxRating": null,
      "dateFrom": null,
      "dateTo": null,
      "verifiedOnly": null,
      "sortBy": "rating",
      "sortOrder": "desc",
      "page": 1,
      "limit": 5
    }
  },
  "error": null
}
```

### 2. List All Reviews (Filtered)

**Endpoint:** `GET /api/v1/reviews`

**Description:** Retrieve reviews across all creators with filtering, sorting, and pagination.

**Query Parameters:** Same as creator-specific endpoint above.

**Example Request:**
```
GET /api/v1/reviews?verifiedOnly=true&sortBy=createdAt&sortOrder=desc&page=1&limit=10
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "reviews": {
      "reviews": [
        {
          "id": "r-sophia-1",
          "rating": 5,
          "title": "Research excellence",
          "body": "Usability study findings directly shaped our roadmap.",
          "reviewerName": "HealthApp",
          "createdAt": "2025-10-01"
        }
      ],
      "totalCount": 6,
      "page": 1,
      "limit": 10,
      "totalPages": 1,
      "hasNext": false,
      "hasPrev": false
    },
    "overallAggregation": {
      "averageRating": 4.33,
      "totalReviews": 9,
      "stars5": 5,
      "stars4": 2,
      "stars3": 2,
      "stars2": 0,
      "stars1": 0,
      "isVerified": false
    },
    "filteredAggregation": {
      "averageRating": 4.83,
      "totalReviews": 6,
      "stars5": 5,
      "stars4": 1,
      "stars3": 0,
      "stars2": 0,
      "stars1": 0,
      "isVerified": true
    },
    "appliedFilters": {
      "minRating": null,
      "maxRating": null,
      "dateFrom": null,
      "dateTo": null,
      "verifiedOnly": true,
      "sortBy": "createdAt",
      "sortOrder": "desc",
      "page": 1,
      "limit": 10
    }
  },
  "error": null
}
```

### 3. Get Creator Reputation (Legacy)

**Endpoint:** `GET /api/v1/creators/{id}/reputation`

**Description:** Legacy endpoint that returns basic reputation data with recent reviews (maintained for backward compatibility).

**Response Format:**
```json
{
  "success": true,
  "data": {
    "creatorId": "alex-studio",
    "aggregation": {
      "averageRating": 4.67,
      "totalReviews": 3,
      "stars5": 2,
      "stars4": 1,
      "stars3": 0,
      "stars2": 0,
      "stars1": 0,
      "isVerified": true
    },
    "recentReviews": [
      {
        "id": "r-alex-1",
        "rating": 5,
        "title": "Exceptional design partner",
        "body": "Delivered a full design system on time; communication was clear throughout.",
        "reviewerName": "Sam K.",
        "createdAt": "2025-08-12"
      }
    ]
  },
  "error": null
}
```

## Error Handling

### Validation Errors (422 Unprocessable Entity)

When invalid query parameters are provided:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "fieldErrors": [
      {
        "field": "query_param_0",
        "message": "minRating must be between 1 and 5"
      },
      {
        "field": "query_param_1",
        "message": "sortBy must be one of: createdAt, rating, reviewerName"
      }
    ]
  }
}
```

### Not Found (404)

When a creator doesn't exist (for creator-specific endpoints):

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Creator alex-nonexistent not found"
  }
}
```

## Filtering Logic

### Rating Filters
- `minRating`: Include only reviews with rating ≥ specified value
- `maxRating`: Include only reviews with rating ≤ specified value
- Both can be used together to create a rating range

### Date Filters
- `dateFrom`: Include only reviews created on or after this date
- `dateTo`: Include only reviews created on or before this date
- Uses lexicographic string comparison (ISO date format required)

### Verified Filter
- `verifiedOnly=true`: Include only reviews with rating ≥ 4 stars
- Useful for showing high-quality feedback only

## Sorting Options

### Sort Fields (`sortBy`)
- `createdAt`: Sort by review creation date
- `rating`: Sort by review rating (1-5 stars)
- `reviewerName`: Sort alphabetically by reviewer name

### Sort Orders (`sortOrder`)
- `asc`: Ascending order (oldest first, lowest rating first, A-Z)
- `desc`: Descending order (newest first, highest rating first, Z-A)

## Pagination

### Parameters
- `page`: 1-based page number (minimum: 1)
- `limit`: Items per page (range: 1-100, default: 10)

### Response Fields
- `totalCount`: Total number of items matching filters
- `page`: Current page number
- `limit`: Items per page
- `totalPages`: Total number of pages
- `hasNext`: Whether there are more pages after current
- `hasPrev`: Whether there are pages before current

## Aggregation Data

### Overall Aggregation
- Computed from all reviews for the creator/platform
- Always present for context

### Filtered Aggregation
- Computed only from reviews matching the applied filters
- Only present when filters are applied and result in a subset
- Useful for understanding the quality distribution of filtered results

### Verification Logic
- A creator is "verified" when they have ≥3 reviews AND average rating ≥4.5
- Verification status is computed separately for overall and filtered aggregations

## Performance Considerations

### Current Implementation
- Uses in-memory seed data for development/testing
- All filtering and sorting performed in application layer
- Suitable for small datasets (hundreds of reviews)

### Production Recommendations
- Migrate to database-backed implementation using PostgreSQL
- Add database indexes on commonly filtered/sorted fields:
  - `creator_id` (for creator-specific queries)
  - `rating` (for rating filters)
  - `created_at` (for date filters and sorting)
- Consider implementing database-level pagination for large datasets
- Add caching for frequently accessed aggregation data

## Usage Examples

### Common Use Cases

1. **Show recent high-quality reviews:**
   ```
   GET /api/v1/creators/alex-studio/reviews?verifiedOnly=true&sortBy=createdAt&sortOrder=desc&limit=5
   ```

2. **Browse all reviews by rating:**
   ```
   GET /api/v1/reviews?sortBy=rating&sortOrder=desc&page=1&limit=20
   ```

3. **Filter reviews by date range:**
   ```
   GET /api/v1/reviews?dateFrom=2025-01-01&dateTo=2025-12-31&sortBy=createdAt&sortOrder=asc
   ```

4. **Find reviews in specific rating range:**
   ```
   GET /api/v1/creators/maya-writes/reviews?minRating=3&maxRating=4&sortBy=rating&sortOrder=desc
   ```

### Frontend Integration

The API is designed to support common UI patterns:

- **Review listing pages** with pagination controls
- **Filter sidebars** with rating sliders and date pickers
- **Sort dropdowns** with multiple criteria
- **Quality badges** based on verification status
- **Statistics dashboards** using aggregation data

### Rate Limiting

Currently no rate limiting is implemented. For production deployment, consider:
- Rate limiting by IP address or user authentication
- Caching frequently requested data
- Implementing request throttling for expensive operations

## Testing

The implementation includes comprehensive test coverage:

- **Unit tests** for all filtering and sorting functions
- **Integration tests** for API endpoints
- **Validation tests** for query parameter handling
- **Edge case tests** for boundary conditions

Run tests with:
```bash
cargo test --manifest-path stellar-creator-portfolio/backend/services/api/Cargo.toml
```