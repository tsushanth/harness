import type { EvalSuiteResult } from "./types.js";

export function printReport(result: EvalSuiteResult): void {
  const { model, total, passed, passRate, cases, durationMs } = result;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Model : ${model}`);
  console.log(`  Score : ${passed}/${total} (${(passRate * 100).toFixed(0)}%)`);
  console.log(`  Time  : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`${"═".repeat(60)}\n`);

  for (const c of cases) {
    const icon = c.passed ? "✓" : "✗";
    console.log(`  ${icon}  [${c.id}] ${c.description}`);

    if (!c.passed) {
      const { toolsCalled, argMatch, answerMatch, judgeReason } = c.scores;
      if (toolsCalled === false) console.log(`       ↳ wrong tools called`);
      if (argMatch === false)    console.log(`       ↳ arg mismatch`);
      if (answerMatch === false) {
        if (judgeReason)         console.log(`       ↳ judge: ${judgeReason}`);
        else                     console.log(`       ↳ answer missing expected phrases`);
      }
      if (c.errors.length > 0)  console.log(`       ↳ error: ${c.errors[0]}`);
      if (c.finalAnswer)        console.log(`       ↳ got: "${c.finalAnswer.slice(0, 120)}"`);
    }
  }

  console.log();
}

export function compareReports(results: EvalSuiteResult[]): void {
  if (results.length < 2) {
    printReport(results[0]!);
    return;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("  COMPARISON");
  console.log(`${"═".repeat(70)}`);

  const caseIds = results[0]!.cases.map((c) => c.id);

  // Header
  const modelCols = results.map((r) => r.model.padEnd(30));
  console.log(`\n  ${"Case".padEnd(35)}${modelCols.join("  ")}`);
  console.log(`  ${"-".repeat(35)}${results.map(() => "-".repeat(30)).join("  ")}`);

  for (const id of caseIds) {
    const row = results.map((r) => {
      const c = r.cases.find((x) => x.id === id);
      if (!c) return "N/A".padEnd(30);
      return (c.passed ? "✓ pass" : "✗ FAIL").padEnd(30);
    });
    console.log(`  ${id.padEnd(35)}${row.join("  ")}`);
  }

  console.log(`\n  ${"TOTAL".padEnd(35)}${results.map((r) => `${r.passed}/${r.total} (${(r.passRate * 100).toFixed(0)}%)`.padEnd(30)).join("  ")}`);
  console.log();
}
