import { TypstCliAdapter } from "../exams/adapters/pdf/typst-cli.adapter";
import { PdfCompilerPort } from "../exams/domain/ports/pdf-compiler.port";

/**
 * Resolves the real `typst` CLI adapter (pinned version, see
 * `infra/Dockerfile.api`). No env-dependent config needed — mirrors
 * `resolvePdfCompilerAdapter` conventions used elsewhere for other ports.
 */
export function resolvePdfCompilerAdapter(): PdfCompilerPort {
  return new TypstCliAdapter();
}
