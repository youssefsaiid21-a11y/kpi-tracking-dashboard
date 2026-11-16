"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/hooks/useApi";
import { api } from "@/lib/api-client";
import { useDateRange } from "@/lib/hooks/useDateRange";
import {
  LayoutDashboard,
  Calendar,
  Users,
  TrendingUp,
  Target,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sparkles,
} from "lucide-react";
import type { UserRole } from "@/types";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: UserRole[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Meetings", href: "/meetings", icon: Calendar },
  { label: "Team", href: "/team", icon: Users, roles: ["manager", "admin"] },
  { label: "Conversion", href: "/conversion", icon: TrendingUp },
  { label: "Insights", href: "/insights", icon: Sparkles },
  { label: "Targets", href: "/targets", icon: Target },
  {
    label: "Data Quality",
    href: "/data-quality",
    icon: ShieldAlert,
    roles: ["manager", "admin"],
  },
  { label: "Settings", href: "/settings", icon: UserCog },
  { label: "Admin", href: "/admin", icon: ShieldCheck, roles: ["admin"] },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ collapsed: controlledCollapsed, onToggleCollapse }: SidebarProps = {}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const handleToggle = onToggleCollapse ?? (() => setInternalCollapsed(!internalCollapsed));
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const sessionReady = status === "authenticated";
  const userRole = (session?.user as { role?: UserRole } | undefined)?.role ?? "rep";
  const userName = session?.user?.name ?? "";
  const userInitial = userName ? userName.charAt(0).toUpperCase() : "";

  const queryClient = useQueryClient();
  const { dateRange } = useDateRange();

  const handlePrefetch = useCallback(
    (href: string) => {
      if (href === "/dashboard") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.analytics(dateRange),
          queryFn: ({ signal }) =>
            api.get("/api/analytics", {
              period: dateRange.period,
              startDate: dateRange.start.toISOString(),
              endDate: dateRange.end.toISOString(),
            }, signal),
        });
      } else if (href === "/meetings") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.pendingCount(dateRange),
          queryFn: ({ signal }) =>
            api.get("/api/meetings", {
              status: "pending",
              pageSize: 1,
              page: 1,
              countOnly: "true",
              startDate: dateRange.start.toISOString(),
              endDate: dateRange.end.toISOString(),
            }, signal),
        });
      } else if (href === "/team") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.team(dateRange),
          queryFn: ({ signal }) =>
            api.get("/api/analytics/team", {
              period: dateRange.period,
              startDate: dateRange.start.toISOString(),
              endDate: dateRange.end.toISOString(),
            }, signal),
        });
      }
    },
    [queryClient, dateRange]
  );

  const visibleItems = navItems.filter(
    (item) => !item.roles || (sessionReady && item.roles.includes(userRole))
  );

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-card/50 backdrop-blur-xl border-r border-white/[0.04] transition-all duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-3 border-b border-white/[0.04] px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary text-sm font-bold">
          I
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-foreground tracking-tight truncate">
            Example Company
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1.5">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={() => handlePrefetch(item.href)}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                isActive
                  ? "bg-primary/10 text-primary shadow-glow-sm"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-white/[0.04] p-3 space-y-2">
        <div
          className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20">
            {sessionReady ? userInitial : <div className="h-3 w-3 rounded-full bg-white/[0.06] animate-pulse" />}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              {sessionReady ? (
                <>
                  <p className="truncate text-sm font-medium text-foreground">
                    {userName}
                  </p>
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {userRole}
                  </p>
                </>
              ) : (
                <>
                  <div className="h-3.5 w-20 rounded bg-white/[0.06] animate-pulse" />
                  <div className="mt-1 h-2.5 w-12 rounded bg-white/[0.04] animate-pulse" />
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-all hover:bg-destructive/10 hover:text-red-400 ${
            collapsed ? "justify-center" : ""
          }`}
          title={collapsed ? "Log out" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={handleToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full bg-secondary border border-white/[0.06] text-muted-foreground shadow-surface hover:text-foreground hover:bg-card transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </aside>
  );
}
