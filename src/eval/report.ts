import type { EvalSuiteResult } from "./types.js";

export function printReport(result: EvalSuiteResult): void {
  const { model, runs, total, passed, passRate, cases, durationMs } = result;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Model : ${model}`);
  console.log(`  Runs  : ${runs} per case`);
  console.log(`  Score : ${passed}/${total} cases passed (${(passRate * 100).toFixed(0)}%)`);
  console.log(`  Time  : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`${"═".repeat(60)}\n`);

  for (const c of cases) {
    const voteStr = runs > 1 ? ` [${c.passCount}/${c.runs}]` : "";
    const icon = c.passed ? "✓" : c.passCount > 0 ? "~" : "✗";
    console.log(`  ${icon}  [${c.id}]${voteStr} ${c.description}`);

    if (!c.passed) {
      const { toolsCalled, argMatch, answerMatch, judgeReason } =
        c.representative.scores;
      if (toolsCalled === false) console.log(`       ↳ wrong tools called`);
      if (argMatch === false) console.log(`       ↳ arg mismatch`);
      if (answerMatch === false) {
        if (judgeReason) console.log(`       ↳ judge: ${judgeReason}`);
        else console.log(`       ↳ answer missing expected phrases`);
      }
      if (c.representative.errors.length > 0)
        console.log(`       ↳ error: ${c.representative.errors[0]}`);
    }
  }

  console.log();
}

export function compareReports(results: EvalSuiteResult[]): void {
  if (results.length < 2) {
    printReport(results[0]!);
    return;
  }

  const runs = results[0]!.runs;
  console.log(`\n${"═".repeat(75)}`);
  console.log(`  COMPARISON  (${runs} run${runs > 1 ? "s" : ""} per case, majority vote)`);
  console.log(`${"═".repeat(75)}`);

  const caseIds = results[0]!.cases.map((c) => c.id);
  const colW = 28;

  const modelCols = results.map((r) => r.model.slice(0, colW).padEnd(colW));
  console.log(`\n  ${"Case".padEnd(38)}${modelCols.join("  ")}`);
  console.log(`  ${"-".repeat(38)}${results.map(() => "-".repeat(colW)).join("  ")}`);

  for (const id of caseIds) {
    const row = results.map((r) => {
      const c = r.cases.find((x) => x.id === id);
      if (!c) return "N/A".padEnd(colW);
      const vote = runs > 1 ? ` (${c.passCount}/${c.runs})` : "";
      const icon = c.passed ? "✓" : c.passCount > 0 ? "~" : "✗";
      return `${icon} ${c.passed ? "pass" : "FAIL"}${vote}`.padEnd(colW);
    });
    console.log(`  ${id.padEnd(38)}${row.join("  ")}`);
  }

  const totals = results.map((r) => {
    const pct = (r.passRate * 100).toFixed(0);
    return `${r.passed}/${r.total} (${pct}%)`.padEnd(colW);
  });
  console.log(
    `\n  ${"TOTAL".padEnd(38)}${totals.join("  ")}`
  );

  // Variance summary — only meaningful with multiple runs
  if (runs > 1) {
    console.log(`\n  ${"─".repeat(75)}`);
    console.log(`  VARIANCE (cases where model was inconsistent across runs)\n`);
    for (const r of results) {
      const flaky = r.cases.filter((c) => c.passCount > 0 && c.passCount < c.runs);
      if (flaky.length === 0) {
        console.log(`  ${r.model}: no variance`);
      } else {
        console.log(`  ${r.model}:`);
        for (const c of flaky) {
          console.log(`    ~ [${c.id}]  ${c.passCount}/${c.runs} runs passed`);
        }
      }
    }
  }

  console.log();
}
