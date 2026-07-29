import {
  FileValidationError,
  MAX_DOCUMENT_SIZE_BYTES,
  validateDocumentFile,
} from "./file-validation";

const PADDING: number[] = new Array<number>(16).fill(0);

// Real magic-byte signatures, not full valid files — file-type's detectors
// only need the header to classify a buffer, which is exactly the point:
// validation happens on bytes, not on trusting a filename or claimed type.
const PDF_HEADER = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< >>\nendobj\n");
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...PADDING]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...PADDING]);
// MZ / PE header — the actual signature of a Windows executable.
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, ...PADDING]);

describe("validateDocumentFile", () => {
  it("accepts a real PDF", async () => {
    const result = await validateDocumentFile(PDF_HEADER);
    expect(result.mime).toBe("application/pdf");
  });

  it("accepts a real PNG", async () => {
    const result = await validateDocumentFile(PNG_HEADER);
    expect(result.mime).toBe("image/png");
  });

  it("accepts a real JPEG", async () => {
    const result = await validateDocumentFile(JPEG_HEADER);
    expect(result.mime).toBe("image/jpeg");
  });

  it("rejects an executable renamed/claimed as a PDF — the claim is never consulted, only the bytes", async () => {
    // Note there is no "claimedType" or "filename" argument at all — that's
    // the point. Even if a caller believed this was a .pdf, the magic
    // bytes (MZ) are what get checked.
    await expect(validateDocumentFile(EXE_HEADER)).rejects.toThrow(FileValidationError);
  });

  it("rejects an empty buffer", async () => {
    await expect(validateDocumentFile(Buffer.alloc(0))).rejects.toThrow(FileValidationError);
  });

  it("rejects a buffer over the size limit", async () => {
    const oversized = Buffer.concat([PDF_HEADER, Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES)]);
    await expect(validateDocumentFile(oversized)).rejects.toThrow(FileValidationError);
  });

  it("rejects unrecognizable bytes", async () => {
    await expect(validateDocumentFile(Buffer.from("just some plain text"))).rejects.toThrow(
      FileValidationError,
    );
  });
});
