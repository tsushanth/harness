import type { Message } from "./types.js";

// A single fine-tuning example in OpenAI chat format
export interface FineTuneExample {
  messages: Message[];
}

// Collector passed into Harness — gathers repair conversations as training data
export class FineTuneCollector {
  private examples: FineTuneExample[] = [];

  // Called by the repair loop when a repair succeeds.
  // context = messages up to the failed call
  // badArgs = what the model originally emitted
  // errorMessage = what we told it was wrong
  // goodArgs = what the model produced after repair
  // toolName = which tool this was for
  record(
    context: Message[],
    toolName: string,
    badArgs: string,
    errorMessage: string,
    goodArgs: Record<string, unknown>
  ): void {
    // Build a minimal conversation showing the repair:
    // [system+history] → [assistant bad call] → [user error] → [assistant good call]
    const example: FineTuneExample = {
      messages: [
        ...context,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              type: "function",
              id: "repair_0",
              function: { name: toolName, arguments: badArgs },
            },
          ],
        } as Message,
        {
          role: "user",
          content: errorMessage,
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              type: "function",
              id: "repair_1",
              function: {
                name: toolName,
                arguments: JSON.stringify(goodArgs),
              },
            },
          ],
        } as Message,
      ],
    };
    this.examples.push(example);
  }

  toJSONL(): string {
    return this.examples.map((ex) => JSON.stringify(ex)).join("\n");
  }

  count(): number {
    return this.examples.length;
  }

  clear(): void {
    this.examples = [];
  }
}
