'use client';

import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
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
  isOpen?: boolean;
  onToggle?: () => void;
}

export function FilterPanel({
  filters,
  onFilterChange,
  onFilterReset,
  isOpen = true,
  onToggle,
}: FilterPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(filters.map(f => f.id))
  );

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
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
        className="relative"
      >
        Filters
        {getActiveFilterCount() > 0 && (
          <span className="absolute top-0 right-0 -mt-2 -mr-2 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs">
            {getActiveFilterCount()}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div className="w-full md:w-64 space-y-4">
      {/* Filter Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Filters</h3>
        {getActiveFilterCount() > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFilterReset}
            className="text-xs"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Active Filters Tags */}
      {getActiveFilterCount() > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.map((group) => {
            if (!group.selected) return null;

            if (group.type === 'checkbox' && typeof group.selected === 'string') {
              const option = group.options.find(o => o.id === group.selected);
              if (!option) return null;

              return (
                <div
                  key={`${group.id}-${group.selected}`}
                  className="inline-flex items-center gap-2 bg-primary/20 text-primary px-3 py-1 rounded-full text-sm"
                >
                  {option.label}
                  <button
                    onClick={() => onFilterChange(group.id, '')}
                    className="ml-1 hover:opacity-70"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            }

            if (group.type === 'multi-select' && Array.isArray(group.selected)) {
              return group.selected.map((selectedId: string) => {
                const option = group.options.find(o => o.id === selectedId);
                if (!option) return null;

                return (
                  <div
                    key={`${group.id}-${selectedId}`}
                    className="inline-flex items-center gap-2 bg-primary/20 text-primary px-3 py-1 rounded-full text-sm"
                  >
                    {option.label}
                    <button
                      onClick={() => {
                        const newSelected = (group.selected as string[]).filter(
                          id => id !== selectedId
                        );
                        onFilterChange(group.id, newSelected);
                      }}
                      className="ml-1 hover:opacity-70"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              });
            }

            return null;
          })}
        </div>
      )}

      {/* Filter Groups */}
      <div className="space-y-4">
        {filters.map((group) => (
          <div key={group.id} className="border-b border-border pb-4">
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full flex items-center justify-between py-2 hover:text-primary transition-colors"
            >
              <h4 className="font-medium text-sm">{group.label}</h4>
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  expandedGroups.has(group.id) ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Group Options */}
            {expandedGroups.has(group.id) && (
              <div className="mt-3 space-y-3">
                {group.type === 'checkbox' && (
                  <div className="space-y-2">
                    {group.options.map((option) => (
                      <div key={option.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`filter-${group.id}-${option.id}`}
                          checked={group.selected === option.id}
                          onCheckedChange={(checked) => {
                            onFilterChange(group.id, checked ? option.id : '');
                          }}
                        />
                        <Label
                          htmlFor={`filter-${group.id}-${option.id}`}
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
                    ))}
                  </div>
                )}

                {group.type === 'multi-select' && (
                  <div className="space-y-2">
                    {group.options.map((option) => {
                      const isSelected = Array.isArray(group.selected) &&
                        group.selected.includes(option.id);

                      return (
                        <div key={option.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`filter-${group.id}-${option.id}`}
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
                            htmlFor={`filter-${group.id}-${option.id}`}
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
                      step={parseInt(group.options[1].id) - parseInt(group.options[0].id)}
                      value={group.selected as [number, number] || [0, 10000]}
                      onValueChange={(value) => onFilterChange(group.id, value as [number, number])}
                      className="w-full"
                    />
                    {Array.isArray(group.selected) && (
                      <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                        <span>${group.selected[0]}</span>
                        <span>-</span>
                        <span>${group.selected[1]}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
