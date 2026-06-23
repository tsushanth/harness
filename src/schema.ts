import Ajv from "ajv/dist/ajv.js";
import type { ErrorObject } from "ajv";

const ajv = new Ajv.default({ allErrors: true, coerceTypes: false });

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): ValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(args) as boolean;

  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors ?? []).map((e: ErrorObject) => {
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
      case "minLength":
      case "maxLength":
        return `field "${field}" ${e.message ?? ""}`;
      default:
        return `field "${field}": ${e.message ?? e.keyword}`;
    }
  });

  return { valid: false, errors };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return obj;
  return path
    .replace(/^\//, "")
    .split("/")
    .reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), obj);
}
