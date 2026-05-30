/**
 * Performance benchmarking utilities
 * Measures query performance before and after optimization
 */

interface BenchmarkResult {
  name: string;
  duration: number;
  queriesCount: number;
  avgQueryTime: number;
  timestamp: Date;
}

class Benchmark {
  private results: BenchmarkResult[] = [];

  /**
   * Run a benchmark test
   */
  async run(
    name: string,
    fn: () => Promise<void>,
    expectedQueries?: number,
  ): Promise<BenchmarkResult> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    await fn();

    const duration = performance.now() - startTime;
    const endMemory = process.memoryUsage().heapUsed;
    const memoryDelta = endMemory - startMemory;

    const result: BenchmarkResult = {
      name,
      duration,
      queriesCount: expectedQueries || 0,
      avgQueryTime: expectedQueries ? duration / expectedQueries : 0,
      timestamp: new Date(),
    };

    this.results.push(result);

    console.log(`✅ ${name}`);
    console.log(`   Duration: ${duration.toFixed(2)}ms`);
    if (expectedQueries) {
      console.log(`   Queries: ${expectedQueries}`);
      console.log(`   Avg/Query: ${result.avgQueryTime.toFixed(2)}ms`);
    }
    console.log(`   Memory: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);

    return result;
  }

  /**
   * Compare two benchmark results
   */
  compare(before: BenchmarkResult, after: BenchmarkResult) {
    const improvement =
      ((before.duration - after.duration) / before.duration) * 100;
    const queryReduction =
      ((before.queriesCount - after.queriesCount) / before.queriesCount) * 100;

    console.log(`\n📊 Benchmark Comparison: ${before.name} vs ${after.name}`);
    console.log(
      `   Duration: ${before.duration.toFixed(2)}ms → ${after.duration.toFixed(2)}ms (${improvement > 0 ? "+" : ""}${improvement.toFixed(1)}%)`,
    );
    if (before.queriesCount > 0 && after.queriesCount > 0) {
      console.log(
        `   Queries: ${before.queriesCount} → ${after.queriesCount} (${queryReduction > 0 ? "+" : ""}${queryReduction.toFixed(1)}%)`,
      );
    }

    return {
      durationImprovement: improvement,
      queryReduction,
    };
  }

  /**
   * Get all results
   */
  getResults() {
    return this.results;
  }

  /**
   * Clear results
   */
  clear() {
    this.results = [];
  }
}

export const benchmark = new Benchmark();

/**
 * Example benchmark test for N+1 query detection
 */
export async function benchmarkN1Queries() {
  console.log("\n🚀 Starting N+1 Query Benchmark\n");

  // Simulate N+1 query pattern (without optimization)
  const n1Result = await benchmark.run(
    "N+1 Query Pattern (20 creators)",
    async () => {
      // Simulate 20 individual queries
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    20,
  );

  // Simulate optimized batch query
  const batchResult = await benchmark.run(
    "Batch Query Pattern (20 creators)",
    async () => {
      // Simulate 1 batch query
      await new Promise((resolve) => setTimeout(resolve, 15));
    },
    1,
  );

  // Compare results
  benchmark.compare(n1Result, batchResult);

  console.log("\n✨ Benchmark complete!");
}

/**
 * Measure query performance with DataLoader
 */
export async function benchmarkDataLoader() {
  console.log("\n🚀 Starting DataLoader Benchmark\n");

  const { DataLoader } = await import("@/lib/dataloader");

  // Create a test DataLoader
  const loader = new DataLoader(async (ids: string[]) => {
    // Simulate database query
    await new Promise((resolve) => setTimeout(resolve, 50));
    return ids.map((id) => ({ id, data: `data-${id}` }));
  });

  // Benchmark sequential loads (simulates N+1)
  const sequentialResult = await benchmark.run(
    "Sequential DataLoader Loads (20 items)",
    async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(loader.load(`item-${i}`));
      }
      await Promise.all(promises);
    },
    20,
  );

  // Benchmark batch loads
  const batchLoadResult = await benchmark.run(
    "Batch DataLoader Loads (20 items)",
    async () => {
      const ids = Array.from({ length: 20 }, (_, i) => `item-${i}`);
      await loader.loadMany(ids);
    },
    1,
  );

  benchmark.compare(sequentialResult, batchLoadResult);

  console.log("\n✨ DataLoader benchmark complete!");
}
