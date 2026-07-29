"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNumber } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchOrgChart, type OrgChartNode } from "./org-api";

export function OrgChartView() {
  const { t, dir } = useTranslation();
  const [roots, setRoots] = useState<OrgChartNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setRoots(await fetchOrgChart());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("orgChart.title")}
      </h2>
      {roots && roots.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {roots.map((node) => (
            <DepartmentNode key={node.id} node={node} />
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("orgChart.empty")}</p>
      )}
    </div>
  );
}

function DepartmentNode({ node }: { node: OrgChartNode }) {
  const { t, locale } = useTranslation();
  return (
    <li data-department-id={node.id} className="flex flex-col gap-1">
      <div className="rounded-md border border-neutral-200 p-2">
        <p className="font-body text-sm font-medium text-neutral-900">{node.name}</p>
        <p className="font-body text-xs text-neutral-600">
          {node.managerName ? t("orgChart.manager", { name: node.managerName }) : t("orgChart.noManager")}
          {" · "}
          {t("orgChart.employeeCount", { count: formatNumber(node.employeeCount, locale) })}
        </p>
      </div>
      {node.children.length > 0 ? (
        <ul className="flex flex-col gap-2 ps-4">
          {node.children.map((child) => (
            <DepartmentNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
