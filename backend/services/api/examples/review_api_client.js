/**
 * Example client for the Review Filtering and Sorting API
 * 
 * This demonstrates how to interact with the new review endpoints
 * from a frontend application or other client.
 */

class ReviewApiClient {
    constructor(baseUrl = 'http://localhost:3001') {
        this.baseUrl = baseUrl;
    }

    /**
     * Build query string from parameters object
     */
    buildQueryString(params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                searchParams.append(key, value.toString());
            }
        });
        return searchParams.toString();
    }

    /**
     * Make HTTP request with error handling
     */
    async makeRequest(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(`API Error: ${data.error.message}`);
            }
            
            return data.data;
        } catch (error) {
            console.error('Request failed:', error);
            throw error;
        }
    }

    /**
     * Get filtered reviews for a specific creator
     */
    async getCreatorReviews(creatorId, filters = {}) {
        const queryString = this.buildQueryString(filters);
        const url = `${this.baseUrl}/api/v1/creators/${creatorId}/reviews?${queryString}`;
        return this.makeRequest(url);
    }

    /**
     * Get filtered reviews across all creators
     */
    async getAllReviews(filters = {}) {
        const queryString = this.buildQueryString(filters);
        const url = `${this.baseUrl}/api/v1/reviews?${queryString}`;
        return this.makeRequest(url);
    }

    /**
     * Get basic creator reputation (legacy endpoint)
     */
    async getCreatorReputation(creatorId) {
        const url = `${this.baseUrl}/api/v1/creators/${creatorId}/reputation`;
        return this.makeRequest(url);
    }
}

// Example usage functions

async function demonstrateApiUsage() {
    const client = new ReviewApiClient();

    console.log('=== Review API Examples ===\n');

    try {
        // Example 1: Get recent high-quality reviews for a creator
        console.log('1. Recent high-quality reviews for alex-studio:');
        const highQualityReviews = await client.getCreatorReviews('alex-studio', {
            verifiedOnly: true,
            sortBy: 'createdAt',
            sortOrder: 'desc',
            limit: 3
        });
        console.log(`Found ${highQualityReviews.reviews.totalCount} high-quality reviews`);
        console.log(`Average rating: ${highQualityReviews.aggregation.averageRating}`);
        console.log(`Verified status: ${highQualityReviews.aggregation.isVerified}`);
        console.log('Recent reviews:', highQualityReviews.reviews.reviews.map(r => ({
            rating: r.rating,
            title: r.title,
            reviewer: r.reviewerName
        })));
        console.log();

        // Example 2: Browse all reviews sorted by rating
        console.log('2. All reviews sorted by rating (highest first):');
        const topReviews = await client.getAllReviews({
            sortBy: 'rating',
            sortOrder: 'desc',
            page: 1,
            limit: 5
        });
        console.log(`Total reviews: ${topReviews.reviews.totalCount}`);
        console.log(`Platform average: ${topReviews.overallAggregation.averageRating}`);
        console.log('Top reviews:', topReviews.reviews.reviews.map(r => ({
            rating: r.rating,
            title: r.title,
            reviewer: r.reviewerName
        })));
        console.log();

        // Example 3: Filter reviews by rating range
        console.log('3. Reviews with 4-5 star ratings:');
        const excellentReviews = await client.getAllReviews({
            minRating: 4,
            maxRating: 5,
            sortBy: 'createdAt',
            sortOrder: 'desc'
        });
        console.log(`Found ${excellentReviews.reviews.totalCount} excellent reviews`);
        if (excellentReviews.filteredAggregation) {
            console.log(`Filtered average: ${excellentReviews.filteredAggregation.averageRating}`);
        }
        console.log();

        // Example 4: Paginated results
        console.log('4. Paginated reviews (page 1 of 2):');
        const paginatedReviews = await client.getAllReviews({
            page: 1,
            limit: 3,
            sortBy: 'createdAt',
            sortOrder: 'desc'
        });
        console.log(`Page ${paginatedReviews.reviews.page} of ${paginatedReviews.reviews.totalPages}`);
        console.log(`Has next page: ${paginatedReviews.reviews.hasNext}`);
        console.log(`Items on this page: ${paginatedReviews.reviews.reviews.length}`);
        console.log();

        // Example 5: Date range filtering
        console.log('5. Reviews from 2025:');
        const recentReviews = await client.getAllReviews({
            dateFrom: '2025-01-01',
            dateTo: '2025-12-31',
            sortBy: 'createdAt',
            sortOrder: 'asc'
        });
        console.log(`Found ${recentReviews.reviews.totalCount} reviews from 2025`);
        console.log('Date range:', recentReviews.reviews.reviews.map(r => ({
            date: r.createdAt,
            title: r.title
        })));
        console.log();

    } catch (error) {
        console.error('Demo failed:', error.message);
    }
}

// React component example
function ReviewListComponent() {
    const [reviews, setReviews] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [filters, setFilters] = React.useState({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
    });

    const client = new ReviewApiClient();

    const loadReviews = async () => {
        setLoading(true);
        try {
            const data = await client.getAllReviews(filters);
            setReviews(data);
        } catch (error) {
            console.error('Failed to load reviews:', error);
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        loadReviews();
    }, [filters]);

    const handleFilterChange = (newFilters) => {
        setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
    };

    const handlePageChange = (newPage) => {
        setFilters(prev => ({ ...prev, page: newPage }));
    };

    return React.createElement('div', { className: 'review-list' }, [
        // Filter controls
        React.createElement('div', { key: 'filters', className: 'filters' }, [
            React.createElement('select', {
                key: 'sort',
                value: filters.sortBy,
                onChange: (e) => handleFilterChange({ sortBy: e.target.value })
            }, [
                React.createElement('option', { key: 'date', value: 'createdAt' }, 'Sort by Date'),
                React.createElement('option', { key: 'rating', value: 'rating' }, 'Sort by Rating'),
                React.createElement('option', { key: 'reviewer', value: 'reviewerName' }, 'Sort by Reviewer')
            ]),
            React.createElement('select', {
                key: 'order',
                value: filters.sortOrder,
                onChange: (e) => handleFilterChange({ sortOrder: e.target.value })
            }, [
                React.createElement('option', { key: 'desc', value: 'desc' }, 'Descending'),
                React.createElement('option', { key: 'asc', value: 'asc' }, 'Ascending')
            ]),
            React.createElement('label', { key: 'verified' }, [
                React.createElement('input', {
                    type: 'checkbox',
                    checked: filters.verifiedOnly || false,
                    onChange: (e) => handleFilterChange({ 
                        verifiedOnly: e.target.checked ? true : undefined 
                    })
                }),
                ' High quality only'
            ])
        ]),

        // Review list
        loading ? 
            React.createElement('div', { key: 'loading' }, 'Loading...') :
            React.createElement('div', { key: 'reviews' }, [
                reviews.reviews?.reviews.map(review => 
                    React.createElement('div', { 
                        key: review.id, 
                        className: 'review-item' 
                    }, [
                        React.createElement('h3', { key: 'title' }, review.title),
                        React.createElement('div', { key: 'rating' }, `Rating: ${review.rating}/5`),
                        React.createElement('p', { key: 'body' }, review.body),
                        React.createElement('small', { key: 'meta' }, 
                            `By ${review.reviewerName} on ${review.createdAt}`)
                    ])
                ),

                // Pagination
                reviews.reviews && React.createElement('div', { 
                    key: 'pagination', 
                    className: 'pagination' 
                }, [
                    React.createElement('button', {
                        key: 'prev',
                        disabled: !reviews.reviews.hasPrev,
                        onClick: () => handlePageChange(filters.page - 1)
                    }, 'Previous'),
                    React.createElement('span', { key: 'info' }, 
                        `Page ${reviews.reviews.page} of ${reviews.reviews.totalPages}`),
                    React.createElement('button', {
                        key: 'next',
                        disabled: !reviews.reviews.hasNext,
                        onClick: () => handlePageChange(filters.page + 1)
                    }, 'Next')
                ])
            ])
    ]);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReviewApiClient, demonstrateApiUsage };
}

// Run demo if this file is executed directly
if (typeof window === 'undefined' && require.main === module) {
    demonstrateApiUsage();
}