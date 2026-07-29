"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchMyProfile, updateMyProfile, type EmployeeProfileDto } from "./profile-api";

export function ProfileView() {
  const { t, locale, dir } = useTranslation();
  const [profile, setProfile] = useState<EmployeeProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await fetchMyProfile();
      setProfile(data);
      setPhone(data.phone ?? "");
      setAddress(data.address ?? "");
      setEmergencyContactName(data.emergencyContactName ?? "");
      setEmergencyContactPhone(data.emergencyContactPhone ?? "");
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSuccessMessage(null);
      setSaving(true);
      try {
        const updated = await updateMyProfile({
          phone,
          address,
          emergencyContactName,
          emergencyContactPhone,
        });
        setProfile(updated);
        setSuccessMessage(t("profile.success"));
      } catch {
        // Non-fatal for the form itself — the fields keep their entered
        // values so the employee can just retry the save.
      } finally {
        setSaving(false);
      }
    },
    [phone, address, emergencyContactName, emergencyContactPhone, t],
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

  if (loadError || !profile) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
        <h2 className="font-heading text-base font-semibold text-neutral-900">
          {t("profile.title")}
        </h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="font-body text-xs text-neutral-600">{t("profile.fullName")}</dt>
            <dd className="font-body text-sm text-neutral-900">{profile.fullName}</dd>
          </div>
          <div>
            <dt className="font-body text-xs text-neutral-600">{t("profile.jobTitle")}</dt>
            <dd className="font-body text-sm text-neutral-900">{profile.jobTitle}</dd>
          </div>
          <div>
            <dt className="font-body text-xs text-neutral-600">{t("profile.hireDate")}</dt>
            <dd className="font-body text-sm text-neutral-900">
              {formatDate(new Date(profile.hireDate), locale)}
            </dd>
          </div>
        </dl>
      </div>

      <form
        onSubmit={(e) => void handleSave(e)}
        className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4"
      >
        <div>
          <h2 className="font-heading text-base font-semibold text-neutral-900">
            {t("profile.editTitle")}
          </h2>
          <p className="font-body text-xs text-neutral-600">{t("profile.editHint")}</p>
        </div>

        <TextField label={t("profile.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextField
          label={t("profile.address")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <TextField
          label={t("profile.emergencyContactName")}
          value={emergencyContactName}
          onChange={(e) => setEmergencyContactName(e.target.value)}
        />
        <TextField
          label={t("profile.emergencyContactPhone")}
          value={emergencyContactPhone}
          onChange={(e) => setEmergencyContactPhone(e.target.value)}
        />

        {successMessage ? (
          <p role="status" className="font-body text-sm text-primary">
            {successMessage}
          </p>
        ) : null}

        <Button type="submit" loading={saving} disabled={saving}>
          {saving ? t("profile.saving") : t("profile.save")}
        </Button>
      </form>
    </div>
  );
}
