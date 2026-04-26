/**
 * Test Runner
 * Execute all test suites
 */

import { runAllUnitTests } from "../unit/rate-limit.test";
import { runAllIntegrationTests } from "../integration/security.test";
import { runAllE2ETests } from "../e2e/api-abuse.test";

async function runAllTests() {
  console.log("🧪 Running All Tests\n");
  console.log("=".repeat(60));

  try {
    // Run unit tests
    console.log("\n📋 UNIT TESTS\n");
    const unitResults = runAllUnitTests();
    printResults(unitResults);

    // Run integration tests
    console.log("\n🔗 INTEGRATION TESTS\n");
    const integrationResults = await runAllIntegrationTests();
    printResults(integrationResults);

    // Run E2E tests
    console.log("\n🌐 E2E TESTS\n");
    const e2eResults = await runAllE2ETests();
    printResults(e2eResults);

    // Summary
    const totalPassed =
      unitResults.passed + integrationResults.passed + e2eResults.passed;
    const totalFailed =
      unitResults.failed + integrationResults.failed + e2eResults.failed;

    console.log("\n" + "=".repeat(60));
    console.log("\n📊 TOTAL RESULTS\n");
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(
      `📈 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(2)}%\n`,
    );

    process.exit(totalFailed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exit(1);
  }
}

function printResults(results: {
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; error?: string }>;
}) {
  results.tests.forEach((test) => {
    const status = test.passed ? "✅" : "❌";
    console.log(`${status} ${test.name}`);
    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }
  });

  console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
}

runAllTests();
