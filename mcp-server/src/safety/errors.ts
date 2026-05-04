export class SafetyError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly suggestions: string[];

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    suggestions: string[] = []
  ) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
    this.details = details;
    this.suggestions = suggestions;
  }
}

export function createSafetyError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  suggestions: string[] = []
): SafetyError {
  return new SafetyError(code, message, details, suggestions);
}
