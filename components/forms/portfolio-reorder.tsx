"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PortfolioItem {
    id: string;
    title: string;
    description: string;
    url: string;
    imageUrl: string;
}

interface PortfolioReorderProps {
    items: PortfolioItem[];
    onChange: (items: PortfolioItem[]) => void;
}

export function PortfolioReorder({ items, onChange }: PortfolioReorderProps) {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const moveItem = useCallback(
        (fromIndex: number, toIndex: number) => {
            if (toIndex < 0 || toIndex >= items.length) return;
            const updated = [...items];
            const [moved] = updated.splice(fromIndex, 1);
            updated.splice(toIndex, 0, moved);
            onChange(updated);
        },
        [items, onChange],
    );

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverIndex(index);
    };

    const handleDrop = (e: React.DragEvent, toIndex: number) => {
        e.preventDefault();
        const fromIndex = draggedIndex;
        setDraggedIndex(null);
        setDragOverIndex(null);
        if (fromIndex !== null && fromIndex !== toIndex) {
            moveItem(fromIndex, toIndex);
        }
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === "ArrowUp" && index > 0) {
            e.preventDefault();
            moveItem(index, index - 1);
            setFocusedIndex(index - 1);
        } else if (e.key === "ArrowDown" && index < items.length - 1) {
            e.preventDefault();
            moveItem(index, index + 1);
            setFocusedIndex(index + 1);
        }
    };

    const removeItem = useCallback(
        (index: number) => {
            const updated = items.filter((_, i) => i !== index);
            onChange(updated);
        },
        [items, onChange],
    );

    const addItem = useCallback(() => {
        const newItem: PortfolioItem = {
            id: crypto.randomUUID(),
            title: "",
            description: "",
            url: "",
            imageUrl: "",
        };
        onChange([...items, newItem]);
    }, [items, onChange]);

    const updateItem = useCallback(
        (index: number, field: keyof PortfolioItem, value: string) => {
            const updated = [...items];
            updated[index] = { ...updated[index], [field]: value };
            onChange(updated);
        },
        [items, onChange],
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Portfolio Items</h4>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                    Add Item
                </Button>
            </div>

            {items.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                    No portfolio items yet. Click &quot;Add Item&quot; to get started.
                </p>
            )}

            <ul ref={listRef} className="space-y-2" role="listbox" aria-label="Portfolio items, reorder with arrow keys">
                {items.map((item, index) => (
                    <li
                        key={item.id}
                        draggable
                        role="option"
                        aria-selected={focusedIndex === index}
                        aria-label={`Portfolio item ${index + 1}: ${item.title || "Untitled"}. Use arrow keys to reorder.`}
                        tabIndex={0}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onFocus={() => setFocusedIndex(index)}
                        className={`border rounded-lg p-4 bg-background transition-all ${
                            draggedIndex === index ? "opacity-50 scale-95" : ""
                        } ${
                            dragOverIndex === index && draggedIndex !== index
                                ? "border-primary border-2"
                                : ""
                        } ${focusedIndex === index ? "ring-2 ring-ring" : ""}`}
                    >
                        <div className="flex items-start gap-3">
                            <div
                                className="mt-2 cursor-grab active:cursor-grabbing text-muted-foreground"
                                aria-hidden="true"
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <circle cx="5" cy="3" r="1.5" />
                                    <circle cx="11" cy="3" r="1.5" />
                                    <circle cx="5" cy="8" r="1.5" />
                                    <circle cx="11" cy="8" r="1.5" />
                                    <circle cx="5" cy="13" r="1.5" />
                                    <circle cx="11" cy="13" r="1.5" />
                                </svg>
                            </div>

                            <div className="flex-1 space-y-2">
                                <Input
                                    placeholder="Project title"
                                    value={item.title}
                                    onChange={(e) => updateItem(index, "title", e.target.value)}
                                />
                                <Input
                                    placeholder="Description"
                                    value={item.description}
                                    onChange={(e) =>
                                        updateItem(index, "description", e.target.value)
                                    }
                                />
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Project URL"
                                        value={item.url}
                                        onChange={(e) =>
                                            updateItem(index, "url", e.target.value)
                                        }
                                    />
                                    <Input
                                        placeholder="Image URL"
                                        value={item.imageUrl}
                                        onChange={(e) =>
                                            updateItem(index, "imageUrl", e.target.value)
                                        }
                                    />
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeItem(index)}
                                aria-label={`Remove ${item.title || "item"}`}
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                </svg>
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
