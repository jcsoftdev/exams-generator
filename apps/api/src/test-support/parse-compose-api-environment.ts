/**
 * Minimal line-scanner for the `services.api.environment` block of one of
 * this project's docker-compose files — NOT a general YAML parser. Good
 * enough for the fixed, consistently-indented shape both compose files use;
 * not meant to survive arbitrary reformatting.
 */
export function parseComposeApiEnvironmentKeys(composeYaml: string): string[] {
  const lines = composeYaml.split("\n");
  const apiServiceIndex = lines.findIndex((line) => /^ {2}api:\s*$/.test(line));
  if (apiServiceIndex === -1) return [];

  const environmentIndex = lines.findIndex(
    (line, i) => i > apiServiceIndex && /^ {4}environment:\s*$/.test(line),
  );
  if (environmentIndex === -1) return [];

  const keys: string[] = [];
  for (const line of lines.slice(environmentIndex + 1)) {
    // Comments are legitimate inside an environment block — skip, don't stop.
    if (/^ {6}#/.test(line)) continue;
    const match = /^ {6}([A-Z_][A-Z0-9_]*):/.exec(line);
    if (!match) break;
    keys.push(match[1]!);
  }
  return keys;
}
