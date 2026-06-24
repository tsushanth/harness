import Ajv from "ajv/dist/ajv.js";
import type { ErrorObject } from "ajv";

// Strict validator — used to detect schema violations
const ajvStrict = new Ajv.default({ allErrors: true, coerceTypes: false });

// Coercing validator — used to silently fix small type mismatches
// (e.g. model passes "true" for a boolean field, or "42" for a number field)
const ajvCoerce = new Ajv.default({ allErrors: true, coerceTypes: true });

export interface ValidationResult {
  valid: boolean;
  coerced: boolean;          // true if types were fixed by coercion
  data: Record<string, unknown>;  // possibly coerced copy of args
  errors: string[];
}

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): ValidationResult {
  // First try strict validation
  const strictValidate = ajvStrict.compile(schema);
  const strictValid = strictValidate({ ...args }) as boolean;

  if (strictValid) {
    return { valid: true, coerced: false, data: args, errors: [] };
  }

  // Strict failed — try coercing (AJV mutates the copy in place)
  const copy = deepCopy(args);
  const coerceValidate = ajvCoerce.compile(schema);
  const coerceValid = coerceValidate(copy) as boolean;

  if (coerceValid) {
    // Coercion fixed it — return the coerced data
    return { valid: true, coerced: true, data: copy, errors: [] };
  }

  // Neither strict nor coercion helped — return validation errors
  const errors = (strictValidate.errors ?? []).map((e: ErrorObject) => {
    const field = e.instancePath ? e.instancePath.replace(/^\//, "") : "(root)";
    switch (e.keyword) {
      case "required":
        return `missing required field: "${(e.params as { missingProperty: string }).missingProperty}"`;
      case "type":
        return `field "${field}" must be type ${(e.params as { type: string }).type}, got ${typeof getNestedValue(args, e.instancePath)}`;
      case "enum":
        return `field "${field}" must be one of: ${(e.params as { allowedValues: unknown[] }).allowedValues.map(String).join(", ")}`;
      case "additionalProperties":
        return `unexpected extra field: "${(e.params as { additionalProperty: string }).additionalProperty}"`;
      default:
        return `field "${field}": ${e.message ?? e.keyword}`;
    }
  });

  return { valid: false, coerced: false, data: args, errors };
}

function deepCopy(obj: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return obj;
  return path
    .replace(/^\//, "")
    .split("/")
    .reduce<unknown>(
      (cur, key) =>
        cur && typeof cur === "object"
          ? (cur as Record<string, unknown>)[key]
          : undefined,
      obj
    );
}
