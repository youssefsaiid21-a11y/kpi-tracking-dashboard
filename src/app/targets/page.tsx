"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "@/lib/hooks/useSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TargetGauge } from "@/components/charts/target-gauge";
import { DeficitCard } from "@/components/charts/deficit-card";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys, useUsers } from "@/lib/hooks/useApi";
import type {
  MetricType,
  DeficitAnalysis,
} from "@/types";
import { Target, Plus, Calculator, AlertTriangle, TrendingUp, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface TargetRecord {
  id: string;
  metricType: MetricType;
  targetValue: number;
  period: string;
  userId: string | null;
  userName?: string | null;
  isActive: boolean;
  actual?: number;
}

interface TargetsPageData {
  targets: TargetRecord[];
  deficits?: {
    metricLabel: string;
    analysis: DeficitAnalysis;
  }[];
}

interface TargetsResponse {
  success: boolean;
  data: TargetRecord[];
  deficits?: {
    metricLabel: string;
    analysis: DeficitAnalysis;
  }[];
}

const metricLabels: Record<MetricType, string> = {
  total_meetings: "Total Meetings",
  linkedin_meetings: "LinkedIn Meetings",
  email_meetings: "Email Meetings",
  partnerships_meetings: "Partnerships Meetings",
  conferences_meetings: "Conferences Meetings",
  referrals_meetings: "Referrals Meetings",
  inbound_meetings: "Inbound Meetings",
  repeat_meeting_meetings: "Repeat Meetings",
  conversion_rate: "Conversion Rate",
};

const periodLabels: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function SkeletonCard() {
  return <div className="h-40 animate-pulse rounded-lg border bg-card" />;
}

export default function TargetsPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const queryClient = useQueryClient();

  // Form state
  const [formMetric, setFormMetric] = useState<MetricType>("total_meetings");
  const [formValue, setFormValue] = useState<string>("");
  const [formPeriod, setFormPeriod] = useState<string>("monthly");
  const [formUserId, setFormUserId] = useState<string>("team");
  const [saveMessage, setSaveMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── React Query: fetch targets ──
  const { data, isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: queryKeys.targets(),
    queryFn: ({ signal }) =>
      api.get<TargetsResponse>("/api/targets", {}, signal),
    enabled: !sessionLoading,
    select: (res): TargetsPageData => ({
      targets: res.data,
      deficits: res.deficits ?? [],
    }),
  });

  // ── React Query: fetch users (managers only) ──
  const { data: users = [] } = useUsers();

  // ── Mutation: save target ──
  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ success: boolean }>("/api/targets", body),
    onSuccess: () => {
      setSaveMessage({ text: "Target saved successfully", success: true });
      setFormValue("");
      queryClient.invalidateQueries({ queryKey: queryKeys.targets() });
    },
    onError: (err: any) => {
      setSaveMessage({ text: err?.message ?? "Failed to save target", success: false });
    },
  });

  // ── Mutation: delete target ──
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>("/api/targets", { id }),
    onSuccess: () => {
      setSaveMessage({ text: "Target deleted", success: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.targets() });
    },
    onError: (err: any) => {
      setSaveMessage({ text: err?.message ?? "Failed to delete target", success: false });
    },
  });

  const handleSaveTarget = () => {
    if (!formValue || Number(formValue) <= 0) return;
    const body: Record<string, unknown> = {
      metricType: formMetric,
      targetValue: Number(formValue),
      period: formPeriod,
    };
    if (formUserId !== "team") {
      body.userId = formUserId;
    }
    saveMutation.mutate(body);
  };

  const handleDeleteTarget = (id: string) => {
    setDeleteConfirmId(id);
  };

  // Auto-dismiss save message
  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Failed to load targets"
    : null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="mb-4 h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error</h2>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Section 1: Current Targets */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Target className="h-5 w-5" />
          Current Targets
        </h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : data && data.targets.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.targets
              .filter((t) => t.isActive)
              .map((target) => (
                <Card key={target.id} className="shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {metricLabels[target.metricType]}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {periodLabels[target.period] ?? target.period}
                        </Badge>
                        {isManager && (
                          <button
                            onClick={() => handleDeleteTarget(target.id)}
                            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete target"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {target.userName ?? "Team"}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <TargetGauge
                      label={metricLabels[target.metricType]}
                      actual={target.actual ?? 0}
                      target={target.targetValue}
                      unit={
                        target.metricType === "conversion_rate" ? "%" : ""
                      }
                    />
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Target className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                No targets set yet.{" "}
                {isManager
                  ? "Use the form below to create a target."
                  : "Ask your manager to set targets."}
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Section 2: Add/Edit Target (manager/admin only) */}
      {isManager && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plus className="h-5 w-5" />
            Add / Edit Target
          </h2>
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {/* Metric Type */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Metric Type</label>
                  <Select
                    value={formMetric}
                    onValueChange={(v) => setFormMetric(v as MetricType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="total_meetings">Total Meetings</SelectItem>
                      <SelectItem value="linkedin_meetings">LinkedIn Meetings</SelectItem>
                      <SelectItem value="email_meetings">Email Meetings</SelectItem>
                      <SelectItem value="partnerships_meetings">Partnerships Meetings</SelectItem>
                      <SelectItem value="conferences_meetings">Conferences Meetings</SelectItem>
                      <SelectItem value="referrals_meetings">Referrals Meetings</SelectItem>
                      <SelectItem value="inbound_meetings">Inbound Meetings</SelectItem>
                      <SelectItem value="repeat_meeting_meetings">Repeat Meetings</SelectItem>
                      <SelectItem value="conversion_rate">Conversion Rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Target Value */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Value</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 20"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                  />
                </div>

                {/* Period */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Period</label>
                  <Select value={formPeriod} onValueChange={setFormPeriod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Rep Select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Assigned To</label>
                  <Select value={formUserId} onValueChange={setFormUserId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="team">Team (All)</SelectItem>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Save Button */}
                <div className="flex items-end">
                  <Button
                    onClick={handleSaveTarget}
                    disabled={saveMutation.isPending || !formValue || Number(formValue) <= 0}
                    className="w-full"
                  >
                    {saveMutation.isPending ? "Saving..." : "Save Target"}
                  </Button>
                </div>
              </div>
              {saveMessage && (
                <p
                  className={cn(
                    "mt-3 text-sm",
                    saveMessage.success
                      ? "text-green-600"
                      : "text-red-600"
                  )}
                >
                  {saveMessage.text}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Section 3: Deficit Analysis */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Calculator className="h-5 w-5" />
          Deficit Analysis
        </h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : data?.deficits && data.deficits.length > 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.deficits.map((d, i) => (
                <DeficitCard
                  key={i}
                  metricLabel={d.metricLabel}
                  analysis={d.analysis}
                />
              ))}
            </div>

            {/* Scenario Modeling */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-base font-medium text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                Scenario Modeling
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-blue-200 bg-blue-50/30 shadow-sm dark:border-blue-800 dark:bg-blue-950/20">
                  <CardContent className="p-5 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      If Volume +30%
                    </p>
                    <p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {data.deficits[0]
                        ? Math.round(
                            data.deficits[0].analysis.currentActual * 1.3
                          )
                        : "--"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      projected meetings
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/30 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/20">
                  <CardContent className="p-5 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      If Conversion +20%
                    </p>
                    <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {data.deficits[0]
                        ? data.deficits[0].analysis.scenarioIfConversionUp
                        : "--"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      projected outcome
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-violet-200 bg-violet-50/30 shadow-sm dark:border-violet-800 dark:bg-violet-950/20">
                  <CardContent className="p-5 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      If Both Improve
                    </p>
                    <p className="mt-2 text-2xl font-bold text-violet-600 dark:text-violet-400">
                      {data.deficits[0]
                        ? data.deficits[0].analysis.scenarioIfBothUp
                        : "--"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      projected outcome
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Calculator className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                No deficit data available. Set targets above to see gap analysis.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}
        title="Delete Target"
        description="Are you sure you want to delete this target? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
      />
    </div>
  );
}
