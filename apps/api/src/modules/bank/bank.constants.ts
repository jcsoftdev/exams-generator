/** DI token for the `StoragePort` implementation the bank module uses. */
export const STORAGE_PORT = Symbol("StoragePort");

/**
 * DI token for the `PdfCompilerPort` implementation the bank module uses to
 * compile a Typst PREVIEW of a structured question (AI-generated draft
 * creation, and human edits to a draft — Lane D3, design doc §5.2) BEFORE
 * persisting it. Other modules that need the same compiler (e.g. the `ai`
 * module's generate endpoint) import this exact token/provider instead of
 * declaring their own, mirroring how `exams.module.ts` reuses `STORAGE_PORT`
 * rather than introducing a second MinIO binding.
 */
export const PDF_COMPILER_PORT = Symbol("PdfCompilerPort");
