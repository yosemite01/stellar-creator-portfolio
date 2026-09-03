# Mobile Infinite Scrolling

Memory-optimized infinite scrolling for the Tamgora mobile app (Expo). This
is the single canonical doc for the feature — it replaces three previous,
overlapping copies (`mobile/IMPLEMENTATION_COMPLETE.md`,
`mobile/INFINITE_SCROLLING_README.md`, and
`mobile/src/INFINITE_SCROLLING_GUIDE.md`, the last of which was also
malformed — written as a `.md` file but wrapped in a `/** ... */` block
comment).

## Core files

| File | Purpose |
|---|---|
| [`src/hooks/useInfiniteScroll.ts`](./src/hooks/useInfiniteScroll.ts) | Pagination state: page tracking, request deduplication, memory-aware pruning, error handling, cleanup on unmount |
| [`src/hooks/usePagination.ts`](./src/hooks/usePagination.ts) | Higher-level pagination API with caching, `AbortController` support, and memory-pressure detection |
| [`src/components/InfiniteScrollList.tsx`](./src/components/InfiniteScrollList.tsx) | `FlatList` wrapper — `getItemLayout`, `removeClippedSubviews`, memoized rendering, pull-to-refresh |
| [`src/components/VirtualizedScrollList.tsx`](./src/components/VirtualizedScrollList.tsx) | `VirtualizedList` wrapper for very large datasets — only visible items are rendered |
| [`src/utils/memoryOptimization.ts`](./src/utils/memoryOptimization.ts) | `ItemMemoryCache` (LRU), `BatchCleanupProcessor`, `MemoryMonitor` |
| [`src/screens/FreelancerDirectoryEnhanced.tsx`](./src/screens/FreelancerDirectoryEnhanced.tsx) | Reference implementation: search + filtering + infinite scroll + pull-to-refresh together |

`InfiniteScrollList` is for lists in roughly the 50–500 item range;
`VirtualizedScrollList` is for 500+ items where only virtualized rendering
keeps memory bounded.

## Basic usage

```typescript
import { InfiniteScrollList } from '../components/InfiniteScrollList';

export function MyList() {
  return (
    <InfiniteScrollList
      infiniteConfig={{
        pageSize: 20,
        maxItems: 500,
        onLoadMore: async (page, pageSize) => {
          const response = await api.getItems(page, pageSize);
          return response.items;
        },
      }}
      renderItem={(item) => <ItemCard item={item} />}
      keyExtractor={(item) => item.id}
      itemHeight={100}
      scrollThreshold={0.7}
    />
  );
}
```

For large datasets, swap in `VirtualizedScrollList` with a larger
`maxItems`/`windowSize`:

```typescript
<VirtualizedScrollList
  infiniteConfig={{
    pageSize: 50,
    maxItems: 2000,
    onLoadMore: async (page, pageSize) => {
      const response = await api.getLargeDataset(page, pageSize);
      return response.items;
    },
  }}
  renderItem={(item) => <CompactItem item={item} />}
  keyExtractor={(item) => item.id}
  itemHeight={60}
  windowSize={15}
  maxToRenderPerBatch={5}
/>
```

### Search + infinite scroll

Filter locally, in `useMemo` — don't refetch per keystroke:

```typescript
const [searchQuery, setSearchQuery] = useState('');
const { data, loadMore } = useInfiniteScroll({
  pageSize: 25,
  onLoadMore: async (page, pageSize) => {
    const response = await api.search(searchQuery, page, pageSize);
    return response.results;
  },
});

const filtered = useMemo(
  () => data.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())),
  [data, searchQuery],
);
```

### Error recovery

```typescript
const { error, loadMore } = useInfiniteScroll({ /* ... */ });

if (error) {
  return (
    <View>
      <Text>{error.message}</Text>
      <Button title="Retry" onPress={loadMore} />
    </View>
  );
}
```

### Memory-aware pagination (`usePagination`)

```typescript
const { items, currentPage, isLoading, nextPage, reset, getMemoryStats } = usePagination({
  pageSize: 30,
  maxItems: 500,
  enableMemoryManagement: true,
});

const handleLoadMore = () => {
  nextPage(async (page, size) => {
    const response = await api.getItems(page, size);
    return response.items;
  });
};
```

## Tuning parameters

**`maxItems`** — how many items stay resident in memory (older items evicted
LRU-style once exceeded):

| Item weight | Suggested `maxItems` |
|---|---|
| Lightweight (text only) | 1000 |
| Medium (text + small images) | 500 |
| Heavy (complex layouts) | 200 |
| Very heavy (video previews) | 100 |

**`pageSize`** — items fetched per page: 20 for typical mobile lists, 30 for
search results, 50+ for tablet/desktop-width layouts.

**`scrollThreshold`** (0–1) — how far down the list before triggering the
next page: `0.5` for aggressive prefetch, `0.7` as a reasonable default,
`0.9` for lazy loading.

**`maxToRenderPerBatch`** — items rendered per frame: `5` for
`VirtualizedScrollList` (heavier items), `10` (default) for
`InfiniteScrollList`.

## Memory monitoring

```typescript
import { ItemMemoryCache, MemoryMonitor } from '../utils/memoryOptimization';

const cache = new ItemMemoryCache({ maxItemsInMemory: 500 });
const stats = cache.getStats();
console.log(`Cache size: ${stats.size}/${stats.maxSize} (${stats.utilizationPercent}%)`);

const monitor = new MemoryMonitor({ lowMemoryThreshold: 80 });
monitor.onMemoryPressure((isLow) => {
  if (isLow) {
    // reduce batch size, clear cache, etc.
  }
});
monitor.start(5000);
```

## Best practices

**Do:**
- Memoize `renderItem` with `useCallback` (an inline function defeats `FlatList`'s memoization).
- Use a stable `keyExtractor` (e.g. `item.id`) — never the array index.
- Set `itemHeight` when items have a fixed height, to unlock `getItemLayout`.
- Filter data locally in `useMemo`; don't refetch per keystroke.
- Monitor cache utilization via `getStats()`.
- Use `VirtualizedScrollList` once a list regularly exceeds ~500 items.

**Don't:**
- Pass an inline arrow function as `renderItem`.
- Use the array index as `keyExtractor`.
- Change `pageSize` dynamically mid-session.
- Fetch the entire dataset on first load.
- Leave `maxItems` unbounded (`0`) for anything but small, known-size lists.

## Troubleshooting

**Laggy scrolling** — reduce `maxToRenderPerBatch` (10 → 5), increase
`updateCellsBatchingPeriod` (50ms → 100ms), confirm `renderItem` is
memoized, or switch to `VirtualizedScrollList`.

**Memory keeps growing** — set a real `maxItems` limit, check
`cache.getStats()`, reduce `pageSize`, or switch to `VirtualizedScrollList`.

**Items jump/flicker on load** — set `itemHeight` to the actual rendered
height (enables `getItemLayout`), or set `estimatedItemSize` for variable
heights.

**Filters don't work with infinite scroll** — filter in `useMemo`, not
inside the hook; reset pagination (`refresh()`) when the filter changes.

## Reference implementation

[`FreelancerDirectoryEnhanced.tsx`](./src/screens/FreelancerDirectoryEnhanced.tsx)
combines `VirtualizedScrollList`, real-time search/discipline filtering,
pull-to-refresh, and memoized card components against several hundred
freelancer profiles — the place to look for how these pieces fit together
in a real screen.

## Future enhancements

- Bi-directional scrolling (load from both ends of the list)
- Sticky section headers
- SQLite-backed persistence across sessions
- Prefetching the next page before the user reaches the threshold
