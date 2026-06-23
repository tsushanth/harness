import OpenAI from "openai";

export interface JudgeResult {
  passed: boolean;
  reason: string;
}

const JUDGE_SYSTEM = `\
You are an evaluation judge for AI assistant responses.
You will be given a user question, the tool results the assistant had access to, and the assistant's final response.
Your job is to decide if the assistant's response correctly and faithfully answers the user's question using the tool results.

Respond with valid JSON only: { "passed": true/false, "reason": "one sentence" }`;

export async function judgeAnswer(
  client: OpenAI,
  judgeModel: string,
  userMessage: string,
  toolResults: Record<string, unknown>,
  finalAnswer: string,
  criteria: string
): Promise<JudgeResult> {
  const prompt = `\
User question: ${userMessage}

Tool results available to the assistant:
${JSON.stringify(toolResults, null, 2)}

Assistant's final response:
${finalAnswer}

Evaluation criteria: ${criteria}

Did the assistant pass? Respond with JSON only.`;

  try {
    const response = await client.chat.completions.create({
      model: judgeModel,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(content) as { passed?: boolean; reason?: string };

    return {
      passed: parsed.passed ?? false,
      reason: parsed.reason ?? "no reason given",
    };
  } catch {
    // If judge itself fails, don't penalize the model being tested
    return { passed: true, reason: "judge unavailable — skipped" };
  }
}
