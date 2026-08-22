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
export type CompileRunner = (args: readonly string[]) => Promise<CompileRunResult>;

const TYPST_TIMEOUT_MS = 30_000;

export const spawnTypstRunner: CompileRunner = (args) =>
  new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TYPST_TIMEOUT_MS);

    // Pin SOURCE_DATE_EPOCH so typst stamps a fixed creation date into the
    // PDF metadata. Without it the byte output varies with wall-clock time,
    // which makes the deterministic-output release gate flake under parallel
    // test load (two compiles straddling a one-second boundary).
    const child = spawn("typst", args, {
      env: { ...process.env, SOURCE_DATE_EPOCH: "1700000000" },
      signal: controller.signal,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        reject(new Error(`typst compile timed out after ${TYPST_TIMEOUT_MS}ms`));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
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

      const result = await this.runner(["compile", "--root", "/", inputPath, outputPath]);

      if (result.exitCode !== 0) {
        const questionId = mapCompileErrorToQuestionId(typstSource, result.stderr);
        const suffix = questionId ? ` (question ${questionId})` : "";
        throw new TypstCompilationError(`typst compile failed${suffix}`, questionId, result.stderr);
      }

      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
