/**
 * Parses the raw `message.content` string OpenRouter returns for a
 * `generate()` call into a plain JS value (still unvalidated — shape
 * validation happens separately in `openrouter-response-validator.ts`).
 *
 * Thinking models (e.g. `deepseek/deepseek-r1:free`) don't reliably return
 * ONLY the JSON payload, even with `response_format: json_schema`:
 *  - some return clean JSON with no reasoning at all — nothing to strip.
 *  - some inline their chain-of-thought INSIDE `content`, before the JSON,
 *    sometimes wrapped in `<think>...</think>` tags.
 *  - some (reasoning field handled separately by the adapter, not here) put
 *    reasoning in a dedicated `message.reasoning` field, leaving `content`
 *    clean — that case degenerates to "clean JSON" for this function.
 *
 * This function is robust to all of the above: it discards any leading
 * reasoning text and extracts only the LAST top-level, balanced JSON object
 * found in the string (thinking models place their final answer after the
 * reasoning; an earlier reasoning paragraph may itself contain
 * JSON-looking example snippets, so "last" — not "first" — is the correct
 * choice).
 */
export function parseGeneratedQuestionContent(content: string): unknown {
  const withoutThinkTags = stripThinkTags(content);

  const direct = tryParseJson(withoutThinkTags.trim());
  if (direct !== undefined) {
    return direct;
  }

  const candidates = extractTopLevelJsonCandidates(withoutThinkTags);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(candidates[i]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  throw new SyntaxError("No JSON object found in AI response content");
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "");
}

function tryParseJson(text: string): unknown {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Scans `text` left to right for TOP-LEVEL brace-balanced `{...}`
 * substrings (never nested — once a top-level object closes, scanning
 * resumes right after it), respecting string literals so braces inside
 * quoted strings don't confuse the scan. Unbalanced `{` (no matching
 * close) is skipped.
 */
function extractTopLevelJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }

    const start = i;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const char = text[j];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === "{") {
        depth++;
      }
      if (char === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      i = start + 1;
      continue;
    }

    candidates.push(text.slice(start, end + 1));
    i = end + 1;
  }

  return candidates;
}
