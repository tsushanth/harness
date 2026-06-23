import OpenAI from "openai";
import { runEval } from "./runner.js";
import { compareReports, printReport } from "./report.js";
import { BASELINE_SUITE } from "./suite.js";

const models = (process.env.MODELS ?? process.env.MODEL ?? "gpt-4o-mini").split(",");

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "required",
});

console.log(`Running ${BASELINE_SUITE.length} eval cases against: ${models.join(", ")}`);

const results = await Promise.all(
  models.map((model) => runEval(BASELINE_SUITE, model.trim(), client))
);

if (results.length === 1) {
  printReport(results[0]!);
} else {
  compareReports(results);
}
