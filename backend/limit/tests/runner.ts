/**
 * Test Runner
 *
 * Runs every suite by default, or a single one when named on the command
 * line:
 *
 *   ts-node tests/runner.ts               # all suites
 *   ts-node tests/runner.ts unit          # unit | integration | e2e
 *
 * The security checks live inside the integration and e2e suites, so the
 * "security" suite name runs both of those.
 */

import { runAllUnitTests } from "./unit/rate-limit.test";
import { runAllIntegrationTests } from "./integration/security.test";
import { runAllE2ETests } from "./e2e/api-abuse.test";

type SuiteResults = {
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; error?: string }>;
};

const SUITES: Record<string, { label: string; run: () => SuiteResults | Promise<SuiteResults> }> = {
  unit: { label: "📋 UNIT TESTS", run: runAllUnitTests },
  integration: { label: "🔗 INTEGRATION TESTS", run: runAllIntegrationTests },
  e2e: { label: "🌐 E2E TESTS", run: runAllE2ETests },
};

const SUITE_GROUPS: Record<string, string[]> = {
  all: ["unit", "integration", "e2e"],
  security: ["integration", "e2e"],
};

async function runAllTests(selection: string) {
  const names = SUITE_GROUPS[selection] ?? (SUITES[selection] ? [selection] : null);
  if (!names) {
    console.error(
      `Unknown suite "${selection}". Use one of: ${[...Object.keys(SUITES), ...Object.keys(SUITE_GROUPS)].join(", ")}`,
    );
    process.exit(1);
  }

  console.log("🧪 Running Tests\n");
  console.log("=".repeat(60));

  try {
    let totalPassed = 0;
    let totalFailed = 0;

    for (const name of names) {
      const suite = SUITES[name];
      console.log(`\n${suite.label}\n`);
      const results = await suite.run();
      printResults(results);
      totalPassed += results.passed;
      totalFailed += results.failed;
    }

    console.log("\n" + "=".repeat(60));
    console.log("\n📊 TOTAL RESULTS\n");
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    const total = totalPassed + totalFailed;
    console.log(
      `📈 Success Rate: ${total > 0 ? ((totalPassed / total) * 100).toFixed(2) : "0.00"}%\n`,
    );

    process.exit(totalFailed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exit(1);
  }
}

function printResults(results: SuiteResults) {
  results.tests.forEach((test) => {
    const status = test.passed ? "✅" : "❌";
    console.log(`${status} ${test.name}`);
    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }
  });

  console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
}

runAllTests(process.argv[2] ?? "all");
