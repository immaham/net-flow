export type LogLevel = "INFO" | "WARN" | "ERROR";

export function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString();

  const contextText = context ? ` ${JSON.stringify(context)}` : "";

  console.log(`[${timestamp}] [${level}] ${message}${contextText}`);
}
