import type {
  DeficitAnalysis,
  TeamOverview,
  StageConversion,
  TargetVsActual,
  StrategyRecommendation,
} from "@/types";

// ─── analyzeDeficit ───────────────────────────────────────────────

export function analyzeDeficit(
  actual: number,
  target: number,
  conversionRate: number,
  remainingDays: number,
  elapsedDays?: number
): DeficitAnalysis {
  if (remainingDays <= 0) {
    return {
      currentActual: actual,
      target,
      deficit: Math.max(0, target - actual),
      remainingBusinessDays: 0,
      requiredAdditionalMeetings: 0,
      requiredDailyPace: 0,
      scenarioIfVolumeUp: actual,
      scenarioIfConversionUp: actual,
      scenarioIfBothUp: actual,
    };
  }

  const deficit = Math.max(0, target - actual);
  const requiredAdditionalMeetings = conversionRate > 0 ? Math.ceil(deficit / conversionRate) : 0;
  const requiredDailyPace = remainingDays > 0 ? deficit / remainingDays : 0;

  // Scenario projections based on remaining days and current daily run rate
  const effectiveElapsedDays = Math.max(1, elapsedDays ?? 1);
  const currentDailyRate = actual > 0 ? actual / effectiveElapsedDays : 0;

  // remainingMeetings = projected raw meetings in remaining period at current pace
  const remainingMeetings = currentDailyRate * remainingDays;

  // Scenario 1: volume increases by 30%, conversion stays the same
  const volumeUpRate = currentDailyRate * 1.3;
  const scenarioIfVolumeUp = actual + volumeUpRate * remainingDays * conversionRate;

  // Scenario 2: conversion improves by 20%, volume stays the same
  const improvedConversion = conversionRate * 1.2;
  const scenarioIfConversionUp = actual + remainingMeetings * improvedConversion;

  // Scenario 3: both improve
  const scenarioIfBothUp =
    actual + volumeUpRate * remainingDays * improvedConversion;

  return {
    currentActual: actual,
    target,
    deficit,
    requiredAdditionalMeetings,
    requiredDailyPace,
    remainingBusinessDays: remainingDays,
    scenarioIfVolumeUp: Math.round(scenarioIfVolumeUp),
    scenarioIfConversionUp: Math.round(scenarioIfConversionUp),
    scenarioIfBothUp: Math.round(scenarioIfBothUp),
  };
}

// ─── generateRecommendations ──────────────────────────────────────

export function generateRecommendations(
  teamOverview: TeamOverview,
  conversionRates: StageConversion[],
  targets: TargetVsActual[]
): StrategyRecommendation[] {
  const recommendations: StrategyRecommendation[] = [];
  let recId = 0;

  // Check all channel-based targets that are behind
  const channelTargets = targets.filter(
    (t) => t.metricType.endsWith("_meetings") && !t.onTrack
  );
  for (const chTarget of channelTargets) {
    recId++;
    const label = chTarget.metricType.replace(/_/g, " ");
    const isTotal = chTarget.metricType === "total_meetings";
    recommendations.push({
      id: `rec-${recId}`,
      category: isTotal ? "volume" : "channel_mix",
      severity: chTarget.variancePercent < -0.3 ? "critical" : "warning",
      title: `${label.charAt(0).toUpperCase() + label.slice(1)} below target`,
      description: `The team has ${chTarget.actual} ${label} against a target of ${chTarget.target} (deficit: ${chTarget.deficit}). Reps need to average ${chTarget.requiredPace.toFixed(1)} additional per remaining business day (${chTarget.remainingDays} days left).`,
      metric: chTarget.metricType,
      currentValue: chTarget.actual,
      requiredValue: chTarget.target,
    });
  }

  // Find the worst conversion stage
  if (conversionRates.length > 0) {
    const worstStage = conversionRates.reduce((worst, current) =>
      current.rate < worst.rate ? current : worst
    );

    if (worstStage.rate < 0.5) {
      recId++;
      recommendations.push({
        id: `rec-${recId}`,
        category: "conversion",
        severity: worstStage.rate < 0.2 ? "critical" : "warning",
        title: `Low conversion from ${worstStage.fromStageLabel} to ${worstStage.toStageLabel}`,
        description: `Only ${(worstStage.rate * 100).toFixed(1)}% of deals convert from ${worstStage.fromStageLabel} to ${worstStage.toStageLabel} (${worstStage.dealCount} deals). Review qualification criteria and stage exit requirements to improve throughput at this bottleneck.`,
        metric: `conversion_${worstStage.fromStage}_to_${worstStage.toStage}`,
        currentValue: worstStage.rate,
        requiredValue: 0.5,
      });
    }
  }

  // Check each rep for pacing issues
  for (const rep of teamOverview.repPerformance) {
    for (const tva of rep.targetVsActual) {
      if (!tva.onTrack && tva.deficit > 0) {
        recId++;
        recommendations.push({
          id: `rec-${recId}`,
          category: "rep_performance",
          severity:
            tva.variancePercent < -0.4 ? "critical" : "warning",
          title: `${rep.userName} is behind on ${tva.metricType.replace(/_/g, " ")}`,
          description: `${rep.userName} has ${tva.actual} against a target of ${tva.target} for ${tva.metricType.replace(/_/g, " ")} (${tva.deficit} short). Needs ${tva.requiredPace.toFixed(1)} per day over the remaining ${tva.remainingDays} business days to get back on track.`,
          metric: tva.metricType,
          currentValue: tva.actual,
          requiredValue: tva.target,
        });
      }
    }
  }

  return recommendations;
}
