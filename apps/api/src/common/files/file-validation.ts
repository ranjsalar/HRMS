import { fromBuffer } from "file-type";

// 10 MB — generous for a scanned ID/passport/contract PDF or photo, without
// being wasteful. See DECISIONS.md.
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

// Allowlist, not a blocklist — the only types accepted are these; anything
// else (including every executable format) is rejected by omission, not by
// name. DOCX deliberately excluded for v1 (its magic bytes are a generic
// ZIP container; reliably distinguishing "a real .docx" from "a zip
// renamed .docx" needs deeper structural inspection than a v1 upload path
// needs) — contract/id/passport/certificate uploads are PDFs or photo
// scans in practice. Revisit if a real need for DOCX surfaces.
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export class FileValidationError extends Error {}

export interface ValidatedFile {
  mime: string;
  ext: string;
}

/**
 * The ONLY thing that decides what a file is: the actual bytes. The
 * client's claimed Content-Type and the original filename/extension are
 * never consulted here — both are trivially spoofable (a `.exe` renamed to
 * `.pdf` still claims `application/pdf` in its Content-Type header and its
 * filename, but its first two bytes are still `MZ`). Detection reads the
 * buffer itself via `file-type`, which inspects magic numbers/file
 * signatures, not extensions or headers.
 */
export async function validateDocumentFile(buffer: Buffer): Promise<ValidatedFile> {
  if (buffer.length === 0) {
    throw new FileValidationError("File is empty");
  }
  if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
    throw new FileValidationError(
      `File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB limit`,
    );
  }

  const detected = await fromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new FileValidationError(
      detected
        ? `File type "${detected.mime}" is not allowed`
        : "Could not determine a supported file type from the file's contents",
    );
  }

  return { mime: detected.mime, ext: detected.ext };
}
