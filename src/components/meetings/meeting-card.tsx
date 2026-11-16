"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Clock, Users, CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { cn, classificationLabelDisplay } from "@/lib/utils";

interface MeetingCardProps {
  meeting: any;
  onReview: (id: string, data: any) => Promise<void>;
  isReviewed?: boolean;
}

const SOURCE_OPTIONS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "email", label: "Email" },
  { value: "referral", label: "Referral" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level =
    confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const colors = {
    high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    low: "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-medium", colors[level])}
    >
      {Math.round(confidence * 100)}%
    </Badge>
  );
}

function AttendeeAvatar({
  name,
  isExternal,
}: {
  name: string;
  isExternal: boolean;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  return (
    <div className="relative group">
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium transition-colors",
          isExternal
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "bg-white/[0.06] text-muted-foreground"
        )}
      >
        {initials}
      </div>
      {isExternal && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-[1.5px] border-card bg-primary" />
      )}
      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-0.5 text-[10px] text-foreground opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none border border-white/[0.06] shadow-lg">
        {name}
        {isExternal ? " (external)" : ""}
      </span>
    </div>
  );
}

export function MeetingCard({ meeting, onReview, isReviewed }: MeetingCardProps) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(
    isReviewed ? meeting.review?.confirmedLabel ?? null : null
  );
  const [source, setSource] = useState<string>(meeting.review?.source ?? "");
  const [partnerName, setPartnerName] = useState<string>(meeting.review?.partnerName ?? "");
  const [notes, setNotes] = useState<string>(meeting.review?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const showOptionalFields =
    selectedLabel !== null && selectedLabel !== "irrelevant";
  const isClassifying = selectedLabel !== null && (!isReviewed || isEditing);

  const startTime = new Date(meeting.startTime);
  const endTime = new Date(meeting.endTime);
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 60000
  );

  const handleSelectLabel = (label: string) => {
    if (isReviewed && !isEditing) setIsEditing(true);
    setSelectedLabel(label);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedLabel) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onReview(meeting.id, {
        confirmedLabel: selectedLabel,
        source: showOptionalFields ? source || null : null,
        partnerName: selectedLabel === "partnerships" ? partnerName || null : null,
        notes: notes || null,
      });
      setSaved(true);
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message ?? "Failed to save review");
    } finally {
      setSaving(false);
    }
  };

  const suggested = meeting.suggestedClass;

  return (
    <Card
      className={cn(
        "transition-all duration-300",
        saved && "border-emerald-500/30 glow-teal",
        isReviewed && !isEditing && "border-emerald-500/15",
        isClassifying && !saved && "border-primary/30 glow-blue"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground text-sm leading-tight truncate">
              {meeting.subject || "No Subject"}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{format(startTime, "EEE, MMM d, yyyy")}</span>
              <span>
                {format(startTime, "h:mm a")} - {format(endTime, "h:mm a")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {durationMinutes} min
              </span>
            </div>
          </div>

          {isReviewed && meeting.review && !isEditing && (
            <Badge variant="success" className="shrink-0 text-[10px]">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {classificationLabelDisplay(meeting.review.confirmedLabel)}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Attendees */}
        {meeting.attendees?.length > 0 && (
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex flex-wrap gap-1">
              {meeting.attendees.map((att: any, i: number) => (
                <AttendeeAvatar
                  key={i}
                  name={att.name || att.email}
                  isExternal={!att.isInternal}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI suggestion */}
        {suggested && (
          <div className="rounded-lg bg-chart-violet/5 border border-chart-violet/10 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-3 w-3 text-chart-violet" />
              <span className="text-[10px] font-medium text-chart-violet uppercase tracking-wider">
                AI Suggestion
              </span>
              <Badge variant="outline" className="ml-1 text-[10px] bg-chart-violet/10 text-chart-violet border-chart-violet/20">
                {classificationLabelDisplay(suggested.suggestedLabel)}
              </Badge>
              <ConfidenceBadge confidence={suggested.confidence} />
            </div>
            {suggested.reasoning && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {suggested.reasoning}
              </p>
            )}
          </div>
        )}

        {/* Classification buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "partnerships", display: "Partnerships", activeClass: "bg-violet-600 hover:bg-violet-600/85 text-white", hoverClass: "hover:border-violet-500/30 hover:text-violet-400" },
            { label: "conferences", display: "Conferences", activeClass: "bg-amber-600 hover:bg-amber-600/85 text-white", hoverClass: "hover:border-amber-500/30 hover:text-amber-400" },
            { label: "referrals", display: "Referrals", activeClass: "bg-emerald-600 hover:bg-emerald-600/85 text-white glow-teal", hoverClass: "hover:border-emerald-500/30 hover:text-emerald-400" },
            { label: "linkedin", display: "LinkedIn", activeClass: "bg-blue-600 hover:bg-blue-600/85 text-white glow-blue", hoverClass: "hover:border-blue-500/30 hover:text-blue-400" },
            { label: "email", display: "Email", activeClass: "bg-cyan-600 hover:bg-cyan-600/85 text-white", hoverClass: "hover:border-cyan-500/30 hover:text-cyan-400" },
            { label: "inbound", display: "Inbound", activeClass: "bg-pink-600 hover:bg-pink-600/85 text-white", hoverClass: "hover:border-pink-500/30 hover:text-pink-400" },
            { label: "repeat_meeting", display: "Repeat Meeting", activeClass: "bg-orange-600 hover:bg-orange-600/85 text-white", hoverClass: "hover:border-orange-500/30 hover:text-orange-400" },
            { label: "irrelevant", display: "Irrelevant", activeClass: "bg-white/10 hover:bg-white/[0.08] text-foreground", hoverClass: "hover:border-white/10 hover:text-foreground" },
          ].map((btn) => (
            <Button
              key={btn.label}
              size="sm"
              variant={selectedLabel === btn.label ? "default" : "outline"}
              className={cn(
                "transition-all text-xs",
                selectedLabel === btn.label ? btn.activeClass : btn.hoverClass
              )}
              onClick={() => handleSelectLabel(btn.label)}
            >
              {btn.display}
            </Button>
          ))}
        </div>

        {/* Optional fields */}
        {selectedLabel && showOptionalFields && (isClassifying || isEditing) && (
          <div className="space-y-3 rounded-lg border border-white/[0.04] bg-secondary/50 p-3 animate-in slide-in-from-top-2 duration-200">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                Lead Source
              </label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedLabel === "partnerships" && (
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                  Partner Name
                </label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Enter partner organization name..."
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {selectedLabel && (isClassifying || isEditing) && (
          <div className="animate-in slide-in-from-top-1 duration-200">
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
              Notes (optional)
            </label>
            <textarea
              className="flex min-h-[52px] w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-40 resize-none transition-colors"
              placeholder="Add any additional context..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        )}

        {/* Save button */}
        {selectedLabel && (isClassifying || isEditing) && (
          <div className="flex items-center gap-3 animate-in slide-in-from-top-1 duration-200">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || saved}
              className="min-w-[90px] text-xs"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving
                </span>
              ) : saved ? (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Saved
                </span>
              ) : (
                "Save Review"
              )}
            </Button>
            {isEditing && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setIsEditing(false);
                  setSaveError(null);
                  setSelectedLabel(meeting.review?.confirmedLabel ?? null);
                  setSource(meeting.review?.source ?? "");
                  setPartnerName(meeting.review?.partnerName ?? "");
                  setNotes(meeting.review?.notes ?? "");
                }}
              >
                Cancel
              </Button>
            )}
            {saveError && (
              <p className="text-xs text-red-500">{saveError}</p>
            )}
          </div>
        )}

        {/* Reviewed metadata */}
        {isReviewed && meeting.review && !isEditing && meeting.review.reviewedAt && (
          <div className="text-[10px] text-muted-foreground pt-2 border-t border-white/[0.04]">
            Reviewed {format(new Date(meeting.review.reviewedAt), "MMM d, yyyy 'at' h:mm a")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
