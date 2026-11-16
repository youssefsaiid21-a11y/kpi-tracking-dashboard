"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/hooks/useSession";
import { useSyncLogs, useSettings, useUsers, useTriggerSync, useUpdateSettings, useCreateUser } from "@/lib/hooks/useApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import {
  ShieldAlert,
  RefreshCw,
  Cloud,
  Clock,
  Users,
  Plus,
  Bell,
  Activity,
  Mail,
} from "lucide-react";

interface SyncLog {
  id: string;
  provider: string;
  syncType: string;
  status: string;
  recordsProcessed: number;
  durationMs: number | null;
  startedAt: string;
  errorMessage?: string;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  outlookEmail?: string;
  isActive: boolean;
}

function cronToHumanReadable(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfWeek !== "*" && dayOfMonth === "*") {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[Number(dayOfWeek)] ?? dayOfWeek;
    return `Every ${dayName} at ${hour}:${minute.padStart(2, "0")}`;
  }
  if (hour !== "*" && minute !== "*" && dayOfMonth === "*" && month === "*") {
    return `Daily at ${hour}:${minute.padStart(2, "0")}`;
  }
  return cron;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "started":
    case "running":
      return <Badge className="bg-blue-500 text-white">Running</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-16 rounded bg-muted" />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return <div className="h-32 animate-pulse rounded-lg border bg-card" />;
}

export default function AdminPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const searchParams = useSearchParams();
  const outlookConnected = searchParams.get("outlook_connected");
  const outlookError = searchParams.get("outlook_error");

  // React Query hooks — cached, deduped, auto-refetch
  const { data: syncLogs = [], isLoading: logsLoading } = useSyncLogs();
  const { data: settingsData } = useSettings();
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const triggerSync = useTriggerSync();
  const updateSettings = useUpdateSettings();
  const createUser = useCreateUser();

  // Derived integration state from settings
  const integrations = settingsData?.integrations ?? [];
  const graphConfig = integrations.find((i: any) => i.provider === "microsoft_graph");
  const hubspotConfig = integrations.find((i: any) => i.provider === "hubspot");
  const serverGraphEnabled = graphConfig?.isEnabled ?? true;
  const serverHubspotEnabled = hubspotConfig?.isEnabled ?? true;

  const reminders = settingsData?.reminders ?? [];
  const reminderCron = reminders[0]?.cronExpression ?? "0 9 * * 1";
  const serverRemindersEnabled = reminders[0]?.isEnabled ?? true;

  // Optimistic local overrides for instant toggle response
  const [localGraphEnabled, setLocalGraphEnabled] = useState<boolean | null>(null);
  const [localHubspotEnabled, setLocalHubspotEnabled] = useState<boolean | null>(null);
  const [localRemindersEnabled, setLocalRemindersEnabled] = useState<boolean | null>(null);

  const graphEnabled = localGraphEnabled ?? serverGraphEnabled;
  const hubspotEnabled = localHubspotEnabled ?? serverHubspotEnabled;
  const remindersEnabled = localRemindersEnabled ?? serverRemindersEnabled;

  // Derived sync times
  const lastGraphSync = (syncLogs as SyncLog[]).find((l) => l.provider.startsWith("microsoft_graph") && l.status === "completed")?.startedAt ?? null;
  const lastHubspotSync = (syncLogs as SyncLog[]).find((l) => l.provider === "hubspot" && l.status === "completed")?.startedAt ?? null;

  // Local UI state
  const [syncingGraph, setSyncingGraph] = useState(false);
  const [syncingHubspot, setSyncingHubspot] = useState(false);
  const [syncError, setSyncError] = useState<{ provider: string; message: string } | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<{ text: string; isSuccess: boolean } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("rep");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserOutlookEmail, setNewUserOutlookEmail] = useState("");
  const [userSaveMessage, setUserSaveMessage] = useState<string | null>(null);

  const handleToggleGraph = (enabled: boolean) => {
    setLocalGraphEnabled(enabled); // Instant UI feedback
    updateSettings.mutate({ provider: "microsoft_graph", isEnabled: enabled }, {
      onSettled: () => setLocalGraphEnabled(null), // Revert to server state after mutation
    });
  };

  const handleToggleHubspot = (enabled: boolean) => {
    setLocalHubspotEnabled(enabled);
    updateSettings.mutate({ provider: "hubspot", isEnabled: enabled }, {
      onSettled: () => setLocalHubspotEnabled(null),
    });
  };

  const handleToggleReminders = (enabled: boolean) => {
    setLocalRemindersEnabled(enabled);
    updateSettings.mutate({ reminderEnabled: enabled }, {
      onSettled: () => setLocalRemindersEnabled(null),
    });
  };

  const handleSyncGraph = async () => {
    setSyncingGraph(true);
    setSyncError(null);
    try {
      await triggerSync.mutateAsync("microsoft_graph");
    } catch (err: any) {
      console.error("[admin] Graph sync failed:", err);
      setSyncError({ provider: "graph", message: err?.message ?? "Graph sync failed" });
    } finally {
      setSyncingGraph(false);
    }
  };

  const handleSyncHubspot = async () => {
    setSyncingHubspot(true);
    setSyncError(null);
    try {
      await triggerSync.mutateAsync("hubspot");
    } catch (err: any) {
      console.error("[admin] HubSpot sync failed:", err);
      setSyncError({ provider: "hubspot", message: err?.message ?? "HubSpot sync failed" });
    } finally {
      setSyncingHubspot(false);
    }
  };

  const handleSendReminder = async () => {
    setSendingReminder(true);
    setReminderMessage(null);
    try {
      await api.post<{ success: boolean }>("/api/reminders", { action: "send_now" });
      setReminderMessage({ text: "Reminders sent successfully", isSuccess: true });
    } catch (err: any) {
      setReminderMessage({ text: err?.message ?? "Failed to send reminders", isSuccess: false });
    } finally {
      setSendingReminder(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUserName || !newUserEmail || !newUserPassword) return;
    setUserSaveMessage(null);
    try {
      await createUser.mutateAsync({
        name: newUserName,
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
        outlookEmail: newUserOutlookEmail || undefined,
      });
      setAddDialogOpen(false);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("rep");
      setNewUserOutlookEmail("");
    } catch (err: any) {
      setUserSaveMessage(err?.message ?? "Failed to create user");
    }
  };

  const savingUser = createUser.isPending;

  if (sessionLoading || !user) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">
          Administration is only available to admin users.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Outlook OAuth feedback */}
      {outlookConnected && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          Outlook connected successfully. Calendar sync is now enabled for this account.
        </div>
      )}
      {outlookError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to connect Outlook: {outlookError.replace(/_/g, " ")}. Please check your Azure AD configuration and try again.
        </div>
      )}

      {/* Section 1: Integration Status */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Cloud className="h-5 w-5" />
          Integration Status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Microsoft Graph */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  Microsoft Graph
                </CardTitle>
                <Switch
                  checked={graphEnabled}
                  onCheckedChange={handleToggleGraph}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Last sync:{" "}
                {lastGraphSync
                  ? new Date(lastGraphSync).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Never"}
              </div>
              <div className="text-xs text-muted-foreground">
                Sync interval: Every 15 minutes
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncingGraph || !graphEnabled}
                  onClick={handleSyncGraph}
                >
                  <RefreshCw
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      syncingGraph && "animate-spin"
                    )}
                  />
                  {syncingGraph ? "Syncing..." : "Sync Now"}
                </Button>
                <a
                  href="/api/auth/outlook"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.04] hover:border-white/10"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Connect Outlook
                </a>
              </div>
              {syncError?.provider === "graph" && (
                <p className="text-xs text-red-500 mt-2">{syncError.message}</p>
              )}
            </CardContent>
          </Card>

          {/* HubSpot */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  HubSpot
                </CardTitle>
                <Switch
                  checked={hubspotEnabled}
                  onCheckedChange={handleToggleHubspot}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Last sync:{" "}
                {lastHubspotSync
                  ? new Date(lastHubspotSync).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Never"}
              </div>
              <div className="text-xs text-muted-foreground">
                Sync interval: Every 30 minutes
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={syncingHubspot || !hubspotEnabled}
                onClick={handleSyncHubspot}
              >
                <RefreshCw
                  className={cn(
                    "mr-2 h-3.5 w-3.5",
                    syncingHubspot && "animate-spin"
                  )}
                />
                {syncingHubspot ? "Syncing..." : "Sync Now"}
              </Button>
              {syncError?.provider === "hubspot" && (
                <p className="text-xs text-red-500 mt-2">{syncError.message}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Section 2: Sync Logs */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-5 w-5" />
          Sync Logs
        </h2>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Provider
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Records
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Started At
                  </th>
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))
                ) : syncLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No sync logs available yet.
                    </td>
                  </tr>
                ) : (
                  syncLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium capitalize">
                        {log.provider.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3 capitalize">{log.syncType}</td>
                      <td className="px-4 py-3">{statusBadge(log.status)}</td>
                      <td className="px-4 py-3">{log.recordsProcessed}</td>
                      <td className="px-4 py-3">
                        {log.durationMs && log.durationMs > 0
                          ? `${(log.durationMs / 1000).toFixed(1)}s`
                          : "--"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(log.startedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Section 3: Reminder Settings */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bell className="h-5 w-5" />
          Reminder Settings
        </h2>
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Schedule</p>
                <p className="text-sm text-muted-foreground">
                  {cronToHumanReadable(reminderCron)}
                </p>
                <p className="text-xs text-muted-foreground">({reminderCron})</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Enabled</span>
                <Switch
                  checked={remindersEnabled}
                  onCheckedChange={handleToggleReminders}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={sendingReminder}
                onClick={handleSendReminder}
              >
                <Bell className="mr-2 h-3.5 w-3.5" />
                {sendingReminder ? "Sending..." : "Send Reminder Now"}
              </Button>
              {reminderMessage && (
                <p
                  className={cn(
                    "text-sm",
                    reminderMessage.isSuccess
                      ? "text-green-600"
                      : "text-red-600"
                  )}
                >
                  {reminderMessage.text}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Section 4: User Management */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5" />
            User Management
          </h2>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add User
          </Button>
        </div>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Outlook Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Active
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            u.role === "admin"
                              ? "default"
                              : u.role === "manager"
                              ? "secondary"
                              : "outline"
                          }
                          className="capitalize"
                        >
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.outlookEmail ?? "--"}
                      </td>
                      <td className="px-4 py-3">
                        {u.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a new user account for the KPI tracking system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Full name"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                placeholder="Min 8 characters"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={newUserRole} onValueChange={setNewUserRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rep">Rep</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Outlook Email (optional)
              </label>
              <Input
                type="email"
                placeholder="member-067@organization-007.example"
                value={newUserOutlookEmail}
                onChange={(e) => setNewUserOutlookEmail(e.target.value)}
              />
            </div>
            {userSaveMessage && (
              <p className="text-sm text-red-600">{userSaveMessage}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={savingUser || !newUserName || !newUserEmail || !newUserPassword}
            >
              {savingUser ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
