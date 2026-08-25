/**
 * Prints the EXACT extraction request this codebase sends — system prompt,
 * user text, and the strict json_schema — so it can be pasted into any
 * provider's playground without hand-copying fragments that then drift from
 * the code. Never sends anything; the image is a 4-byte PNG stub.
 *
 * Run: pnpm --filter @exams-generator/api exec ts-node src/scripts/dump-extract-prompt.ts
 */
import { buildOpenRouterExtractRequestBody } from "../modules/ai/adapters/openrouter/openrouter-request-builder";

const body = buildOpenRouterExtractRequestBody("MODELO-AQUI", {
  image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png",
});

const system = body.messages[0]!.content as string;
const userParts = body.messages[1]!.content as { type: string; text?: string }[];
const user = userParts.find((part) => part.type === "text")!.text;

console.log("=== SYSTEM ===\n");
console.log(system);
console.log("\n\n=== USER (va junto a la imagen como image_url) ===\n");
console.log(user);
console.log("\n\n=== response_format ===\n");
console.log(JSON.stringify(body.response_format, null, 2));
console.log(`\n=== max_tokens: ${body.max_tokens} ===`);
