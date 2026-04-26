'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Filter, RotateCcw } from 'lucide-react';

export interface ReviewFilterOptions {
  minRating?: number;
  maxRating?: number;
  dateFrom?: string;
  dateTo?: string;
  verifiedOnly?: boolean;
  sortBy?: 'createdAt' | 'rating' | 'reviewerName';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

interface ReviewFiltersProps {
  filters: ReviewFilterOptions;
  onFiltersChange: (filters: ReviewFilterOptions) => void;
  totalReviews?: number;
  isLoading?: boolean;
}

export function ReviewFilters({ 
  filters, 
  onFiltersChange, 
  totalReviews = 0,
  isLoading = false 
}: ReviewFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const hasActiveFilters = Object.keys(filters).some(key => {
    const value = filters[key as keyof ReviewFilterOptions];
    return value !== undefined && value !== null && value !== '';
  });

  const activeFilterCount = [
    filters.minRating,
    filters.maxRating,
    filters.dateFrom,
    filters.dateTo,
    filters.verifiedOnly,
    filters.sortBy && filters.sortBy !== 'createdAt',
    filters.sortOrder && filters.sortOrder !== 'desc'
  ].filter(v => v !== undefined && v !== null && v !== false).length;

  const handleFilterChange = (key: keyof ReviewFilterOptions, value: any) => {
    onFiltersChange({
      ...filters,
      [key]: value,
      page: 1 // Reset to first page when filters change
    });
  };

  const clearFilters = () => {
    onFiltersChange({
      page: 1,
      limit: filters.limit || 10
    });
  };

  const clearFilter = (key: keyof ReviewFilterOptions) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onFiltersChange(newFilters);
  };

  return (
    <Card className="p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2"
          >
            <Filter size={16} />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <RotateCcw size={14} />
              Clear all
            </Button>
          )}
        </div>
        
        <div className="text-sm text-muted-foreground">
          {isLoading ? 'Loading...' : `${totalReviews} reviews`}
        </div>
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          {filters.minRating && (
            <Badge variant="outline" className="flex items-center gap-1">
              Min Rating: {filters.minRating}★
              <button
                onClick={() => clearFilter('minRating')}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
          {filters.maxRating && (
            <Badge variant="outline" className="flex items-center gap-1">
              Max Rating: {filters.maxRating}★
              <button
                onClick={() => clearFilter('maxRating')}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
          {filters.dateFrom && (
            <Badge variant="outline" className="flex items-center gap-1">
              From: {filters.dateFrom}
              <button
                onClick={() => clearFilter('dateFrom')}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
          {filters.dateTo && (
            <Badge variant="outline" className="flex items-center gap-1">
              To: {filters.dateTo}
              <button
                onClick={() => clearFilter('dateTo')}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
          {filters.verifiedOnly && (
            <Badge variant="outline" className="flex items-center gap-1">
              Verified Only
              <button
                onClick={() => clearFilter('verifiedOnly')}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Expanded Filter Controls */}
      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t">
          {/* Rating Range */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Rating Range</Label>
            <div className="flex gap-2">
              <Select
                value={filters.minRating?.toString() || 'none'}
                onValueChange={(value) => 
                  handleFilterChange('minRating', value === 'none' ? undefined : parseInt(value))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Min" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any</SelectItem>
                  <SelectItem value="1">1★</SelectItem>
                  <SelectItem value="2">2★</SelectItem>
                  <SelectItem value="3">3★</SelectItem>
                  <SelectItem value="4">4★</SelectItem>
                  <SelectItem value="5">5★</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.maxRating?.toString() || 'none'}
                onValueChange={(value) => 
                  handleFilterChange('maxRating', value === 'none' ? undefined : parseInt(value))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Max" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any</SelectItem>
                  <SelectItem value="1">1★</SelectItem>
                  <SelectItem value="2">2★</SelectItem>
                  <SelectItem value="3">3★</SelectItem>
                  <SelectItem value="4">4★</SelectItem>
                  <SelectItem value="5">5★</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Date Range</Label>
            <div className="space-y-2">
              <Input
                type="date"
                placeholder="From date"
                value={filters.dateFrom || ''}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value || undefined)}
              />
              <Input
                type="date"
                placeholder="To date"
                value={filters.dateTo || ''}
                onChange={(e) => handleFilterChange('dateTo', e.target.value || undefined)}
              />
            </div>
          </div>

          {/* Sort Options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Sort By</Label>
            <Select
              value={filters.sortBy || 'createdAt'}
              onValueChange={(value) => handleFilterChange('sortBy', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Date</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="reviewerName">Reviewer</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.sortOrder || 'desc'}
              onValueChange={(value) => handleFilterChange('sortOrder', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Newest First</SelectItem>
                <SelectItem value="asc">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Additional Options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Options</Label>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="verified-only"
                checked={filters.verifiedOnly || false}
                onCheckedChange={(checked) => 
                  handleFilterChange('verifiedOnly', checked || undefined)
                }
              />
              <Label htmlFor="verified-only" className="text-sm">
                High-quality reviews only (4+ stars)
              </Label>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Reviews per page</Label>
              <Select
                value={filters.limit?.toString() || '10'}
                onValueChange={(value) => handleFilterChange('limit', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}