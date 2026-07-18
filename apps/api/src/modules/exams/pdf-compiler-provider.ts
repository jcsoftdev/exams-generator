import { TypstCliAdapter } from "./adapters/pdf/typst-cli.adapter";
import { PdfCompilerPort } from "./domain/ports/pdf-compiler.port";

/** Resolves the real `typst` CLI adapter (see infra/Dockerfile.api for the pinned binary). */
export function resolvePdfCompilerAdapter(): PdfCompilerPort {
  return new TypstCliAdapter();
}
