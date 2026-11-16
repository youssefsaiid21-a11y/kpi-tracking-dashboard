"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/hooks/useSession";
import { useOutlookStatus, useTriggerSync } from "@/lib/hooks/useApi";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";

const OUTLOOK_ERROR_MESSAGES: Record<string, string> = {
  admin_consent_required: "Admin consent is required for this application.",
  access_denied: "Access was denied. Please try again or contact your administrator.",
  invalid_grant: "The authorization grant is invalid or expired. Please try again.",
  token_error: "Failed to obtain an access token. Please try again.",
  fetch_failed: "Failed to fetch calendar data. Please try again later.",
  no_code: "No authorization code was received. Please try again.",
  server_error: "A server error occurred. Please try again later.",
};

function getOutlookErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return OUTLOOK_ERROR_MESSAGES[errorCode] ?? "An unexpected error occurred while connecting Outlook. Please try again.";
}

export default function SettingsPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const searchParams = useSearchParams();
  const triggerSync = useTriggerSync();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { data: outlookStatus, isLoading: statusLoading } = useOutlookStatus(!sessionLoading);

  const outlookError = searchParams.get("outlook_error");
  const outlookConnected = searchParams.get("outlook_connected");
  const adminConsentGranted = searchParams.get("admin_consent") === "granted";
  const needsAdminConsent = outlookError === "admin_consent_required";

  const isAdmin = user?.role === "admin" || user?.role === "manager";

  if (sessionLoading || statusLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Success banners */}
      {outlookConnected && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Outlook calendar connected successfully. Your meetings are being synced in the background — they should appear within a minute or two.
        </div>
      )}
      {adminConsentGranted && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <ShieldCheck className="mb-1 inline-block h-4 w-4" /> Admin consent granted. All team members can now connect their Outlook calendars.
        </div>
      )}

      {/* Error banners */}
      {needsAdminConsent && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mb-1 inline-block h-4 w-4" />{" "}
          <strong>Admin consent required.</strong> Your organization requires an admin to approve this app before users can sign in.
          {isAdmin ? (
            <span> Click the &quot;Grant Admin Consent&quot; button below to approve.</span>
          ) : (
            <span> Ask your admin to visit the Settings page and click &quot;Grant Admin Consent&quot;.</span>
          )}
        </div>
      )}
      {outlookError && !needsAdminConsent && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mb-1 inline-block h-4 w-4" /> Outlook connection failed: {getOutlookErrorMessage(outlookError)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Outlook Calendar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {outlookStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="default">Connected</Badge>
                <span className="text-sm text-muted-foreground">
                  {outlookStatus.email}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Your calendar events are being synced automatically.
              </p>
              {syncMessage && (
                <p className="text-sm text-green-700 dark:text-green-300">{syncMessage}</p>
              )}
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={triggerSync.isPending}
                    onClick={() => {
                      setSyncMessage(null);
                      triggerSync.mutate("microsoft_graph", {
                        onSuccess: () => setSyncMessage("Calendar sync completed. Check Meetings to see your data."),
                        onError: () => setSyncMessage("Sync failed — check the admin panel for details."),
                      });
                    }}
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${triggerSync.isPending ? "animate-spin" : ""}`} />
                    {triggerSync.isPending ? "Syncing…" : "Sync Now"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.href = "/api/auth/outlook"}
                >
                  Reconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="secondary">Not connected</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect your Outlook calendar to automatically sync your meetings for classification and tracking.
              </p>
              <Button
                onClick={() => window.location.href = "/api/auth/outlook"}
              >
                Connect Outlook
              </Button>
            </div>
          )}

          {/* Admin consent section */}
          {isAdmin && (
            <div className="mt-4 rounded-lg border border-dashed p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" />
                Admin: Organization Consent
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                If team members see &quot;Need admin approval&quot; when connecting Outlook, click below to grant
                org-wide consent. This only needs to be done once.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => window.location.href = "/api/auth/outlook/admin-consent"}
              >
                Grant Admin Consent
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-20">Name:</dt>
              <dd>{user?.name || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-20">Email:</dt>
              <dd>{user?.email || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-20">Role:</dt>
              <dd className="capitalize">{user?.role || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
