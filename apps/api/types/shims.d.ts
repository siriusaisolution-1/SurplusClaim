// apps/api/types/shims.d.ts
// Minimal shims ONLY for libraries that don't ship TS types.
// DO NOT shim @nestjs/*, @prisma/client, or workspace packages (@surplus/*)
// because that overrides real type definitions and breaks CI.

declare module 'pdfkit' {
  const PDFDocument: any;
  export = PDFDocument;
}
