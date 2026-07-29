import { apiFetch } from "@/lib/api-client";

export type DocumentType = "contract" | "id" | "passport" | "certificate";

export interface DocumentDto {
  id: string;
  employeeId: string;
  type: DocumentType;
  expiryDate: string | null;
  uploadedAt: string;
}

export interface SignedDocumentUrl {
  url: string;
  expiresAt: string;
}

export function fetchMyDocuments(): Promise<DocumentDto[]> {
  return apiFetch<DocumentDto[]>("/documents/me");
}

/** A fresh signed URL every call — never cached/reused beyond its short TTL. See DECISIONS.md. */
export function fetchSignedDocumentUrl(documentId: string): Promise<SignedDocumentUrl> {
  return apiFetch<SignedDocumentUrl>(`/documents/${documentId}/signed-url`);
}

/**
 * `employeeId` is required by the backend's shared upload endpoint (also
 * used by admin/manager uploads for other employees) — but for THIS
 * self-service caller it's always their own, resolved by the caller
 * (ProfileView already needs the same `/employees/me` lookup) rather than
 * ever asked for in the upload form itself. The server independently
 * re-validates it via `EmployeesService.isVisible`, so this isn't the
 * real security boundary — see DECISIONS.md.
 */
export function uploadDocument(input: {
  employeeId: string;
  type: DocumentType;
  file: File;
}): Promise<DocumentDto> {
  const formData = new FormData();
  formData.append("employeeId", input.employeeId);
  formData.append("type", input.type);
  formData.append("file", input.file);
  return apiFetch<DocumentDto>("/documents", { method: "POST", body: formData });
}
