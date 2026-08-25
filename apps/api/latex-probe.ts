import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCollectedContent } from "./src/modules/bank/domain/prepare-collected-content";

const DATA = join(__dirname, "src", "db", "data");
const files = [
  ...readdirSync(join(DATA, "collected")).filter((n) => n.endsWith(".json")).map((n) => join(DATA, "collected", n)),
  ...readdirSync(DATA).filter((n) => n.startsWith("escolar-") && n.endsWith(".json")).map((n) => join(DATA, n)),
];

const directory = mkdtempSync(join(tmpdir(), "latex-probe-"));
let converted = 0;
let stillLatex = 0;
let compiled = 0;
const failures: string[] = [];
const untranslated = new Set<string>();

for (const f of files) {
  const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  const list = (raw.entries as unknown[]) ?? Object.values(raw).flatMap((v) => (Array.isArray(v) ? v : []));
  for (const item of list as Array<Record<string, unknown>>) {
    if (!item || typeof item.bodyTypst !== "string") continue;
    const alts = Array.isArray(item.alternatives)
      ? (item.alternatives as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    const hadLatex = [item.bodyTypst as string, ...alts].some((t) => /\$[^$\n]*\\/.test(t));
    if (!hadLatex) continue;

    const prepared = prepareCollectedContent({ bodyTypst: item.bodyTypst as string, alternatives: alts });
    const parts = [prepared.bodyTypst, ...prepared.alternatives];
    const leftover = parts.some((t) => /\\\\\$|\\\$/.test(t) && /\\[a-z]/.test(t));
    if (leftover) {
      stillLatex++;
      for (const [, cmd] of [item.bodyTypst as string, ...alts].join(" ").matchAll(/\$[^$\n]*?\\([A-Za-z]+)/g)) {
        untranslated.add(cmd);
      }
    } else {
      converted++;
    }

    const source = join(directory, "check.typ");
    writeFileSync(source, `${parts.join("\n\n")}\n`, "utf8");
    try {
      execFileSync("typst", ["compile", source, join(directory, "check.pdf")], { stdio: "pipe" });
      compiled++;
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString().split("\n")[0] ?? String(error);
      if (failures.length < 8) failures.push(`${(item.sourceName as string) ?? "?"}\n    ${stderr}\n    ${parts[0]?.slice(0, 120)}`);
    }
  }
}

console.log(`questions that carried LaTeX: ${converted + stillLatex}`);
console.log(`  fully translated to Typst:  ${converted}`);
console.log(`  left escaped (unknown cmd): ${stillLatex}`);
console.log(`compiled with real typst:     ${compiled} / ${converted + stillLatex}`);
if (untranslated.size > 0) console.log(`untranslated commands: ${[...untranslated].join(", ")}`);
failures.forEach((f) => console.log(`  FAIL ${f}`));
