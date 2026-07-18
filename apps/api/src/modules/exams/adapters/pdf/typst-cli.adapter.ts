import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PdfCompilerPort,
  ExamPdfDocumentInput,
  AnswerKeyDocumentInput,
  TypstCompilationError,
} from "../../domain/ports/pdf-compiler.port";
import { renderExamTypst, renderAnswerKeyTypst } from "./typst-template";
import { mapCompileErrorToQuestionId } from "./typst-error-mapper";

export interface CompileRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Abstraction over "run the typst binary with these CLI args". Injectable
 * so the adapter's compile-failure handling can be unit-tested (fake
 * runner, deterministic stderr) without needing typst installed. The
 * default `spawnTypstRunner` is what production code actually uses.
 */
export type CompileRunner = (
  args: readonly string[],
) => Promise<CompileRunResult>;

export const spawnTypstRunner: CompileRunner = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("typst", args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });

/**
 * PdfCompilerPort adapter that shells out to the `typst` CLI (installed in
 * infra/Dockerfile.api, pinned version — see that file for the exact
 * version). Renders the `.typ` source via `typst-template.ts`, writes it to
 * a scratch directory, and invokes `typst compile --root / <in> <out>` so
 * absolute image paths on disk resolve regardless of where the process
 * runs from.
 */
export class TypstCliAdapter implements PdfCompilerPort {
  constructor(private readonly runner: CompileRunner = spawnTypstRunner) {}

  async compileExam(input: ExamPdfDocumentInput): Promise<Buffer> {
    return this.compile(renderExamTypst(input));
  }

  async compileAnswerKey(input: AnswerKeyDocumentInput): Promise<Buffer> {
    return this.compile(renderAnswerKeyTypst(input));
  }

  private async compile(typstSource: string): Promise<Buffer> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "typst-"));
    const inputPath = path.join(workDir, "input.typ");
    const outputPath = path.join(workDir, "output.pdf");

    try {
      await fs.writeFile(inputPath, typstSource, "utf-8");

      const result = await this.runner([
        "compile",
        "--root",
        "/",
        inputPath,
        outputPath,
      ]);

      if (result.exitCode !== 0) {
        const questionId = mapCompileErrorToQuestionId(
          typstSource,
          result.stderr,
        );
        const suffix = questionId ? ` (question ${questionId})` : "";
        throw new TypstCompilationError(
          `typst compile failed${suffix}`,
          questionId,
          result.stderr,
        );
      }

      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
