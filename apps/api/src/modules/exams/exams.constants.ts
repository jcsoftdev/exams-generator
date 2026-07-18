/**
 * `StoragePort` DI binding is deliberately NOT redeclared here — the exams
 * module binds the SAME `STORAGE_PORT` token the bank module exports (see
 * `exams.module.ts`), exactly like the tenants module does, instead of
 * introducing a second storage DI token for the same underlying MinIO
 * bucket.
 */

/** DI token for the `PdfCompilerPort` implementation the exams module uses. */
export const PDF_COMPILER_PORT = Symbol("PdfCompilerPort");
