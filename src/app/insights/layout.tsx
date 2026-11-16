"use client";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><Suspense fallback={<div className="space-y-6"><div className="h-32 animate-pulse rounded-lg border bg-card" /><div className="h-32 animate-pulse rounded-lg border bg-card" /></div>}>{children}</Suspense></AppShell>;
}
