'use client';

import { useId, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
}

export interface FilterGroup {
  id: string;
  label: string;
  type: 'checkbox' | 'range' | 'multi-select';
  options: FilterOption[];
  selected?: string | string[] | [number, number];
}

interface FilterPanelProps {
  filters: FilterGroup[];
  onFilterChange: (groupId: string, value: string | string[] | [number, number]) => void;
  onFilterReset?: () => void;
  resultCount?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function FilterPanel({
  filters,
  onFilterChange,
  onFilterReset,
  resultCount,
  isOpen = true,
  onToggle,
}: FilterPanelProps) {
  const uid = useId();
  const resultRegionId = `${uid}-result-count`;

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(filters.map(f => f.id))
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const getActiveFilterCount = (): number => {
    return filters.reduce((count, group) => {
      if (group.selected) {
        if (Array.isArray(group.selected)) {
          return count + (group.selected.length > 0 ? 1 : 0);
        }
        return count + 1;
      }
      return count;
    }, 0);
  };

  if (!isOpen && onToggle) {
    return (
      <Button
        variant="outline"
        onClick={onToggle}
        aria-label={`Open filters${getActiveFilterCount() > 0 ? `, ${getActiveFilterCount()} active` : ''}`}
        className="relative"
      >
        Filters
        {getActiveFilterCount() > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 -mt-2 -mr-2 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs"
          >
            {getActiveFilterCount()}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div className="w-full md:w-64 space-y-4">
      {/* Result count live region — announced on every filter change */}
      <div
        id={resultRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {resultCount !== undefined ? `${resultCount} bounties found` : ''}
      </div>

      {/* Filter Header */}
      <div className="flex items-center justify-between">
        <h3 id={`${uid}-heading`} className="font-semibold text-foreground">
          Filters
        </h3>
        {getActiveFilterCount() > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFilterReset}
            aria-label="Reset all filters"
            className="text-xs"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Active Filter Chips */}
      {getActiveFilterCount() > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Active filters">
          {filters.map((group) => {
            if (!group.selected) return null;

            if (group.type === 'checkbox' && typeof group.selected === 'string') {
              const option = group.options.find(o => o.id === group.selected);
              if (!option) return null;
              return (
                <div
                  key={`${group.id}-${group.selected}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove filter: ${option.label}`}
                  onClick={() => onFilterChange(group.id, '')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onFilterChange(group.id, '');
                    }
                  }}
                  className="inline-flex items-center gap-2 bg-primary/20 text-primary px-3 py-1 rounded-full text-sm cursor-pointer hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {option.label}
                  <X size={14} aria-hidden="true" />
                </div>
              );
            }

            if (group.type === 'multi-select' && Array.isArray(group.selected)) {
              return (group.selected as string[]).map((selectedId) => {
                const option = group.options.find(o => o.id === selectedId);
                if (!option) return null;
                return (
                  <div
                    key={`${group.id}-${selectedId}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove filter: ${option.label}`}
                    onClick={() => {
                      const newSelected = (group.selected as string[]).filter(
                        id => id !== selectedId
                      );
                      onFilterChange(group.id, newSelected);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const newSelected = (group.selected as string[]).filter(
                          id => id !== selectedId
                        );
                        onFilterChange(group.id, newSelected);
                      }
                    }}
                    className="inline-flex items-center gap-2 bg-primary/20 text-primary px-3 py-1 rounded-full text-sm cursor-pointer hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {option.label}
                    <X size={14} aria-hidden="true" />
                  </div>
                );
              });
            }

            return null;
          })}
        </div>
      )}

      {/* Filter Groups — logical Tab order: category → budget → deadline → skills */}
      <div className="space-y-4">
        {filters.map((group) => {
          const headingId = `${uid}-group-${group.id}`;
          const isExpanded = expandedGroups.has(group.id);

          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={headingId}
              className="border-b border-border pb-4"
            >
              {/* Group toggle button */}
              <button
                id={headingId}
                type="button"
                aria-expanded={isExpanded}
                aria-controls={`${uid}-group-${group.id}-options`}
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between py-2 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <span className="font-medium text-sm">{group.label}</span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Group Options */}
              <div
                id={`${uid}-group-${group.id}-options`}
                hidden={!isExpanded}
                className="mt-3 space-y-3"
              >
                {isExpanded && (
                  <>
                    {group.type === 'checkbox' && (
                      <div className="space-y-2">
                        {group.options.map((option) => {
                          const checkId = `${uid}-filter-${group.id}-${option.id}`;
                          return (
                            <div key={option.id} className="flex items-center gap-2">
                              <Checkbox
                                id={checkId}
                                checked={group.selected === option.id}
                                onCheckedChange={(checked) => {
                                  onFilterChange(group.id, checked ? option.id : '');
                                }}
                              />
                              <Label
                                htmlFor={checkId}
                                className="text-sm font-normal cursor-pointer flex-1"
                              >
                                {option.label}
                                {option.count !== undefined && (
                                  <span className="text-muted-foreground ml-1">
                                    ({option.count})
                                  </span>
                                )}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {group.type === 'multi-select' && (
                      <div className="space-y-2">
                        {group.options.map((option) => {
                          const isSelected =
                            Array.isArray(group.selected) &&
                            group.selected.includes(option.id);
                          const checkId = `${uid}-filter-${group.id}-${option.id}`;
                          return (
                            <div key={option.id} className="flex items-center gap-2">
                              <Checkbox
                                id={checkId}
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  const current = (group.selected || []) as string[];
                                  const newSelected = checked
                                    ? [...current, option.id]
                                    : current.filter(id => id !== option.id);
                                  onFilterChange(group.id, newSelected);
                                }}
                              />
                              <Label
                                htmlFor={checkId}
                                className="text-sm font-normal cursor-pointer flex-1"
                              >
                                {option.label}
                                {option.count !== undefined && (
                                  <span className="text-muted-foreground ml-1">
                                    ({option.count})
                                  </span>
                                )}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {group.type === 'range' && (
                      <div className="py-2">
                        <Slider
                          min={parseInt(group.options[0].id)}
                          max={parseInt(group.options[group.options.length - 1].id)}
                          step={
                            group.options.length > 1
                              ? parseInt(group.options[1].id) - parseInt(group.options[0].id)
                              : 1
                          }
                          value={(group.selected as [number, number]) || [0, 10000]}
                          onValueChange={(value) =>
                            onFilterChange(group.id, value as [number, number])
                          }
                          aria-label={`${group.label} range`}
                          className="w-full"
                        />
                        {Array.isArray(group.selected) && (
                          <div
                            className="flex items-center justify-between mt-3 text-sm text-muted-foreground"
                            aria-live="polite"
                            aria-atomic="true"
                          >
                            <span>
                              <span className="sr-only">Minimum: </span>
                              ${group.selected[0]}
                            </span>
                            <span aria-hidden="true">-</span>
                            <span>
                              <span className="sr-only">Maximum: </span>
                              ${group.selected[1]}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
