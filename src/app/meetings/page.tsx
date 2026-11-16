"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MeetingCard } from "@/components/meetings/meeting-card";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { useMeetings, useReviewMeeting } from "@/lib/hooks/useApi";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  CHANNEL_LABELS,
  type Channel,
} from "@/constants";
import {
  Inbox,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  Sparkles,
  CheckCircle2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Channel button Tailwind classes (background colors) ───── */

const CHANNEL_BTN_CLASSES: Record<Channel, string> = {
  linkedin: "bg-[#0A66C2] hover:bg-[#094fa0] text-white",
  email: "bg-[#EF4444] hover:bg-[#dc2626] text-white",
  inbound: "bg-[#06B6D4] hover:bg-[#0891b2] text-white",
  referrals: "bg-[#10B981] hover:bg-[#059669] text-white",
  partnerships: "bg-[#8B5CF6] hover:bg-[#7c3aed] text-white",
  conferences: "bg-[#F59E0B] hover:bg-[#d97706] text-white",
  repeat_meeting: "bg-[#F97316] hover:bg-[#ea580c] text-white",
  irrelevant: "bg-zinc-600 hover:bg-zinc-700 text-white",
};

/* ── Page ───────────────────────────────────────────────────── */

export default function MeetingsPage() {
  const { dateRange } = useDateRange();

  const queryClient = useQueryClient();

  // Mode: review (Tinder) vs history
  const [mode, setMode] = useState<"review" | "history">("review");

  // ── Review mode state ──
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animating, setAnimating] = useState(false);
  // Local optimistic list of pending meetings (starts from query data, mutated on classify)
  const [localPending, setLocalPending] = useState<TinderMeeting[] | null>(null);

  // ── History mode state ──
  const [historyPage, setHistoryPage] = useState(1);
  const PAGE_SIZE = 20;

  // ── Toast ──
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  /* ── React Query: pending meetings ──────────────────────── */
  const { data: pendingData, isLoading: pendingLoading, error: pendingQueryError } = useMeetings({
    status: "pending",
    pageSize: 50,
    page: 1,
    startDate: dateRange.start.toISOString(),
    endDate: dateRange.end.toISOString(),
  });

  // Sync query data into local state for optimistic updates.
  // Skip if we have an active local override (during animation / optimistic removal).
  const [suppressSync, setSuppressSync] = useState(false);
  useEffect(() => {
    if (pendingData?.data && !suppressSync) {
      setLocalPending(pendingData.data);
      setCurrentIndex(0);
    }
  }, [pendingData, suppressSync]);

  const pendingMeetings = localPending ?? pendingData?.data ?? [];
  const pendingError = pendingQueryError ? (pendingQueryError instanceof Error ? pendingQueryError.message : "Something went wrong") : null;

  /* ── React Query: history meetings ─────────────────────── */
  const { data: historyData, isLoading: historyLoading, error: historyQueryError } = useMeetings(
    {
      status: "completed",
      pageSize: PAGE_SIZE,
      page: historyPage,
      startDate: dateRange.start.toISOString(),
      endDate: dateRange.end.toISOString(),
    },
    mode === "history"
  );

  const historyMeetings = historyData?.data ?? [];
  const historyTotalPages = historyData?.meta?.totalPages ?? 1;
  const historyTotal = historyData?.meta?.total ?? 0;
  const historyError = historyQueryError ? (historyQueryError instanceof Error ? historyQueryError.message : "Something went wrong") : null;

  /* ── Mutations ─────────────────────────────────────────── */
  const reviewMutation = useReviewMeeting();

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  /* ── Classify a meeting (review mode) ─────────────────────── */

  const handleClassify = useCallback(async (channel: Channel) => {
    const meeting = pendingMeetings[currentIndex];
    if (!meeting || animating) return;

    setAnimating(true);
    // Suppress query→local sync so the refetch doesn't clobber our optimistic state
    setSuppressSync(true);

    try {
      // Use the raw API call instead of classifyMutation to control invalidation timing
      await api.post(`/api/meetings/${meeting.id}/review`, { confirmedLabel: channel });

      const classifiedId = meeting.id;

      // After animation delay, remove the card optimistically and advance
      setTimeout(() => {
        setLocalPending((prev) => {
          const updated = (prev ?? []).filter((m) => m.id !== classifiedId);
          setCurrentIndex((idx) =>
            idx >= updated.length ? Math.max(0, updated.length - 1) : idx
          );
          return updated;
        });
        setAnimating(false);
        setSuppressSync(false);
        // Now safe to invalidate — animation is done, local state is settled
        queryClient.invalidateQueries({ queryKey: ["meetings"] });
        queryClient.invalidateQueries({ queryKey: ["pendingCount"] });
        queryClient.invalidateQueries({ queryKey: ["analytics"], refetchType: "none" });
        queryClient.invalidateQueries({ queryKey: ["team"], refetchType: "none" });
      }, 150);

      setToastMessage({
        text: `Classified as "${CHANNEL_LABELS[channel]}"`,
        isError: false,
      });
    } catch {
      setToastMessage({ text: "Failed to classify. Please try again.", isError: true });
      setAnimating(false);
      setSuppressSync(false);
    }
  }, [pendingMeetings, currentIndex, animating, queryClient]);

  /* ── Review mode handler for history MeetingCards ──────────── */

  const handleHistoryReview = async (id: string, data: any) => {
    const meeting = historyMeetings.find((m) => m.id === id);
    const isUpdate = meeting?.review != null;
    const method = isUpdate ? "PUT" : "POST";

    try {
      await reviewMutation.mutateAsync({ eventId: id, data, method });
      const label = data.confirmedLabel?.replace(/_/g, " ") ?? "unknown";
      setToastMessage({ text: `Meeting updated to "${label}"`, isError: false });
    } catch (err: any) {
      setToastMessage({ text: err?.message || "Failed to save review.", isError: true });
    }
  };

  /* ── Computed values ──────────────────────────────────────── */

  const currentMeeting = pendingMeetings[currentIndex] ?? null;
  const totalPending = pendingMeetings.length;

  /* ── Keyboard shortcuts for review mode ───────────────────── */
  const SHORTCUT_CHANNELS: Channel[] = [
    "linkedin",       // 1
    "email",          // 2
    "inbound",        // 3
    "referrals",      // 4
    "partnerships",   // 5
    "conferences",    // 6
    "repeat_meeting", // 7
    "irrelevant",     // 8
  ];

  const handleKeyboardShortcut = useCallback(
    (e: KeyboardEvent) => {
      if (mode !== "review" || animating || !currentMeeting) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8) {
        handleClassify(SHORTCUT_CHANNELS[num - 1]);
      }
    },
    [mode, animating, currentMeeting, handleClassify]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, [handleKeyboardShortcut]);

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">Meeting Review</h2>
          {totalPending > 0 && mode === "review" && (
            <Badge
              variant="secondary"
              className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-sm px-2.5 py-0.5"
            >
              {totalPending} pending
            </Badge>
          )}
        </div>
      </div>

      {/* Date range indicator */}
      <p className="text-xs text-muted-foreground">
        Showing meetings for: {dateRange.label}
      </p>

      {/* Tabs */}
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as "review" | "history");
          setHistoryPage(1);
        }}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="review" className="gap-1.5">
            Review
            {totalPending > 0 && (
              <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white leading-none">
                {totalPending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            History
            {mode === "history" && historyTotal > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({historyTotal})
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Review Tab (Tinder UI) ─────────────────────────── */}
        <TabsContent value="review" className="mt-6">
          {pendingLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm">Loading meetings...</p>
            </div>
          ) : pendingError ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-red-600">{pendingError}</p>
            </div>
          ) : totalPending === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-4 opacity-40" />
              <p className="text-lg font-medium">All caught up!</p>
              <p className="text-sm mt-1">No pending meetings to review.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {/* Progress indicator */}
              <p className="text-sm text-muted-foreground mb-4">
                {currentIndex + 1} of {totalPending}
              </p>

              {/* Tinder Card */}
              {currentMeeting && (
                <TinderCard
                  meeting={currentMeeting}
                  animating={animating}
                />
              )}

              {/* Channel buttons */}
              <div className="mt-6 w-full max-w-[600px]">
                <div className="grid grid-cols-3 gap-3">
                  {(["linkedin", "email", "inbound"] as Channel[]).map(
                    (ch) => (
                      <Button
                        key={ch}
                        className={cn(
                          "h-11 text-sm font-medium transition-all",
                          CHANNEL_BTN_CLASSES[ch]
                        )}
                        disabled={animating}
                        onClick={() => handleClassify(ch)}
                      >
                        {CHANNEL_LABELS[ch]}
                      </Button>
                    )
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {(["referrals", "partnerships", "conferences"] as Channel[]).map(
                    (ch) => (
                      <Button
                        key={ch}
                        className={cn(
                          "h-11 text-sm font-medium transition-all",
                          CHANNEL_BTN_CLASSES[ch]
                        )}
                        disabled={animating}
                        onClick={() => handleClassify(ch)}
                      >
                        {CHANNEL_LABELS[ch]}
                      </Button>
                    )
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <Button
                    className={cn(
                      "h-11 text-sm font-medium transition-all",
                      CHANNEL_BTN_CLASSES.repeat_meeting
                    )}
                    disabled={animating}
                    onClick={() => handleClassify("repeat_meeting")}
                  >
                    Repeat Meeting
                  </Button>
                  <Button
                    className={cn(
                      "h-11 text-sm font-medium transition-all",
                      CHANNEL_BTN_CLASSES.irrelevant
                    )}
                    disabled={animating}
                    onClick={() => handleClassify("irrelevant")}
                  >
                    Irrelevant
                  </Button>
                </div>

                {/* Keyboard shortcut legend */}
                <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
                  Keyboard: 1-LinkedIn 2-Email 3-Inbound 4-Referrals 5-Partnerships 6-Conferences 7-Repeat 8-Irrelevant
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── History Tab ────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          {/* Export button */}
          {mode === "history" && historyTotal > 0 && (
            <div className="flex justify-end mb-3">
              <Button
                variant="outline"
                size="sm"
                asChild
              >
                <a
                  href={`/api/export?type=meetings&format=csv&startDate=${dateRange.start.toISOString()}&endDate=${dateRange.end.toISOString()}`}
                  download
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </a>
              </Button>
            </div>
          )}
          {historyLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm">Loading meetings...</p>
            </div>
          ) : historyError ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-red-600">{historyError}</p>
            </div>
          ) : historyMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No reviewed meetings yet.</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl">
              {historyMeetings.map((meeting) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                  onReview={handleHistoryReview}
                  isReviewed
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {!historyLoading && historyTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {historyPage} of {historyTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage >= historyTotalPages}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 duration-300" role="status" aria-live="polite" aria-atomic="true">
          <div className="rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                toastMessage.isError ? "bg-red-400" : "bg-green-400"
              }`}
            />
            {toastMessage.text}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tinder Card Component ──────────────────────────────────── */

interface TinderMeeting {
  id: string;
  subject: string | null;
  startTime: string;
  endTime: string;
  attendees?: { email: string; name: string | null; isInternal: boolean }[];
  suggestedClass?: { suggestedLabel: string; confidence: number | null } | null;
}

function TinderCard({
  meeting,
  animating,
}: {
  meeting: TinderMeeting;
  animating: boolean;
}) {
  const startTime = new Date(meeting.startTime);
  const endTime = new Date(meeting.endTime);
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 60000
  );

  const attendees = meeting.attendees ?? [];
  const externalCount = attendees.filter((a) => !a.isInternal).length;

  const suggested = meeting.suggestedClass;

  return (
    <Card
      className={cn(
        "w-full max-w-[600px] transition-all duration-300",
        animating && "opacity-0 -translate-x-24"
      )}
    >
      <CardHeader className="pb-3">
        {/* Subject */}
        <h3 className="text-xl font-semibold text-foreground leading-tight">
          {meeting.subject || "No Subject"}
        </h3>

        {/* Date / time / duration */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{format(startTime, "EEE, MMM d, yyyy")}</span>
          <span>
            {format(startTime, "h:mm a")} - {format(endTime, "h:mm a")}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {durationMinutes} min
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Attendees as pills */}
        {attendees.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                {attendees.length} attendees
                {externalCount > 0 && (
                  <span className="ml-1 text-primary">
                    ({externalCount} external)
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attendees.map((att: any, i: number) => {
                const email = att.email || "";
                const domain = email.split("@")[1] || "";
                const isExternal = !att.isInternal;
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-xs",
                      isExternal
                        ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                        : "bg-white/[0.06] text-muted-foreground"
                    )}
                  >
                    {att.name || email}
                    {isExternal && domain && (
                      <span className="ml-1 opacity-60 text-[10px]">
                        @{domain}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* AI suggestion badge */}
        {suggested && (
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-chart-violet" />
            <span className="text-xs text-muted-foreground">AI suggests:</span>
            <Badge
              variant="outline"
              className="text-xs bg-chart-violet/10 text-chart-violet border-chart-violet/20"
            >
              {CHANNEL_LABELS[suggested.suggestedLabel as Channel] ??
                suggested.suggestedLabel}
            </Badge>
            {suggested.confidence != null && (
              <span className="text-xs text-muted-foreground">
                ({Math.round(suggested.confidence * 100)}%)
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
