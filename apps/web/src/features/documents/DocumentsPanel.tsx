"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { resolveApiUrl } from "@/lib/api-client";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchMyProfile } from "@/features/profile/profile-api";
import {
  fetchMyDocuments,
  fetchSignedDocumentUrl,
  uploadDocument,
  type DocumentDto,
  type DocumentType,
} from "./documents-api";

const DOCUMENT_TYPES: DocumentType[] = ["contract", "id", "passport", "certificate"];

export function DocumentsPanel() {
  const { t, locale, dir } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [viewErrorId, setViewErrorId] = useState<string | null>(null);

  const [uploadType, setUploadType] = useState<DocumentType | "">("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [profile, docs] = await Promise.all([fetchMyProfile(), fetchMyDocuments()]);
      setEmployeeId(profile.id);
      setDocuments(docs);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleView = useCallback(async (documentId: string) => {
    setViewErrorId(null);
    setPreparingId(documentId);
    try {
      const { url } = await fetchSignedDocumentUrl(documentId);
      window.open(resolveApiUrl(url), "_blank", "noopener,noreferrer");
    } catch {
      setViewErrorId(documentId);
    } finally {
      setPreparingId(null);
    }
  }, []);

  const handleUpload = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setUploadError(null);
      setUploadSuccess(false);
      setFileError(null);

      const file = fileInputRef.current?.files?.[0];
      if (!uploadType || !file || !employeeId) {
        setFileError(t("documents.fileRequired"));
        return;
      }

      setUploading(true);
      try {
        const created = await uploadDocument({ employeeId, type: uploadType, file });
        setDocuments((prev) => (prev ? [created, ...prev] : [created]));
        setUploadSuccess(true);
        setUploadType("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : t("common.errors.generic.message"));
      } finally {
        setUploading(false);
      }
    },
    [uploadType, employeeId, t],
  );

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h2 className="font-heading text-base font-semibold text-neutral-900">
          {t("documents.title")}
        </h2>
        {documents && documents.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li
                key={doc.id}
                data-document-id={doc.id}
                className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-body text-sm font-medium text-neutral-900">
                    {t(`documents.type.${doc.type}`)}
                  </span>
                  <span className="font-body text-xs text-neutral-600">
                    {t("documents.uploadedAt", { date: formatDate(new Date(doc.uploadedAt), locale) })}
                    {doc.expiryDate
                      ? ` · ${t("documents.expiresOn", { date: formatDate(new Date(doc.expiryDate), locale) })}`
                      : ""}
                  </span>
                  {viewErrorId === doc.id ? (
                    <span role="alert" className="font-body text-xs text-danger">
                      {t("documents.viewError")}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void handleView(doc.id)}
                  loading={preparingId === doc.id}
                  disabled={preparingId !== null}
                >
                  {preparingId === doc.id ? t("documents.preparingView") : t("documents.view")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-body text-sm text-neutral-600">{t("documents.empty")}</p>
        )}
      </div>

      <form
        onSubmit={(e) => void handleUpload(e)}
        className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4"
      >
        <h2 className="font-heading text-base font-semibold text-neutral-900">
          {t("documents.uploadTitle")}
        </h2>

        <Select
          label={t("documents.documentType")}
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as DocumentType)}
        >
          <option value="">{t("documents.selectType")}</option>
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`documents.type.${type}`)}
            </option>
          ))}
        </Select>

        <div className="flex flex-col gap-1">
          <label htmlFor="document-file" className="font-body text-sm text-neutral-900">
            {t("documents.chooseFile")}
          </label>
          <input
            id="document-file"
            ref={fileInputRef}
            type="file"
            className="font-body text-sm text-neutral-900"
          />
        </div>

        {fileError ? (
          <p role="alert" className="font-body text-xs text-danger">
            {fileError}
          </p>
        ) : null}
        {uploadError ? (
          <p role="alert" className="font-body text-sm text-danger">
            {uploadError}
          </p>
        ) : null}
        {uploadSuccess ? (
          <p role="status" className="font-body text-sm text-primary">
            {t("documents.uploadSuccess")}
          </p>
        ) : null}

        <Button type="submit" loading={uploading} disabled={uploading}>
          {uploading ? t("documents.uploading") : t("documents.upload")}
        </Button>
      </form>
    </div>
  );
}
