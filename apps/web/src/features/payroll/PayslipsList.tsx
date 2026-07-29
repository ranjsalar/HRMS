"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { resolveApiUrl } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchMyPayslips, fetchSignedPayslipUrl, type PayslipDto } from "./payslips-api";

export function PayslipsList() {
  const { t, locale, dir } = useTranslation();
  const [payslips, setPayslips] = useState<PayslipDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [downloadErrorId, setDownloadErrorId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setPayslips(await fetchMyPayslips());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = useCallback(async (payslipId: string) => {
    setDownloadErrorId(null);
    setPreparingId(payslipId);
    try {
      // A fresh signed URL every click — never cached/reused beyond its
      // short server-issued TTL. See DECISIONS.md.
      const { url } = await fetchSignedPayslipUrl(payslipId);
      window.open(resolveApiUrl(url), "_blank", "noopener,noreferrer");
    } catch {
      setDownloadErrorId(payslipId);
    } finally {
      setPreparingId(null);
    }
  }, []);

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
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">{t("payslips.title")}</h2>
      {payslips && payslips.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {payslips.map((payslip) => (
            <li
              key={payslip.id}
              data-payslip-id={payslip.id}
              className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                {payslip.payrollRun ? (
                  <span className="font-body text-sm font-medium text-neutral-900">
                    {t("payslips.period", {
                      start: formatDate(new Date(payslip.payrollRun.periodStart), locale),
                      end: formatDate(new Date(payslip.payrollRun.periodEnd), locale),
                    })}
                  </span>
                ) : null}
                <span className="font-body text-xs text-neutral-600">
                  {t("payslips.gross")}:{" "}
                  {formatNumber(Number(payslip.gross), locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {payslip.currency} · {t("payslips.net")}:{" "}
                  {formatNumber(Number(payslip.net), locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {payslip.currency}
                </span>
                {downloadErrorId === payslip.id ? (
                  <span role="alert" className="font-body text-xs text-danger">
                    {t("payslips.downloadError")}
                  </span>
                ) : null}
              </div>
              {payslip.pdfUrl ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleDownload(payslip.id)}
                  loading={preparingId === payslip.id}
                  disabled={preparingId !== null}
                >
                  {preparingId === payslip.id ? t("payslips.preparingDownload") : t("payslips.download")}
                </Button>
              ) : (
                <span className="font-body text-xs text-neutral-600">{t("payslips.notReady")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("payslips.empty")}</p>
      )}
    </div>
  );
}
