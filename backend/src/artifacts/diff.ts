import { Artifact } from "./types";

export interface DiffResult {
  artifact_type: string;
  role: string;
  from_version: number;
  to_version: number;
  diff: {
    added?: Record<string, any>;
    removed?: Record<string, any>;
    changed?: Record<string, { from: any; to: any }>;
  };
}

export interface ChartMetadata {
  chart_type?: string;
  title?: string;
  data_points?: number;
  points?: Array<{ x: any; y: any }>;
  series?: Array<{ label: string; data: Array<{ x: any; y: any }> }>;
  labels?: {
    x_label?: string;
    y_label?: string;
  };
  config?: Record<string, any>;
  role?: string;
}

/**
 * Phase 8.5.3: Type-aware artifact diffing engine
 * Provides deterministic, inspectable diffs between artifact versions
 */
export function diffArtifacts(from: Artifact, to: Artifact): DiffResult {
  // Validation: artifacts must be comparable
  if (from.job_id !== to.job_id) {
    throw new Error("Artifacts must belong to the same job");
  }
  
  if (from.type !== to.type) {
    throw new Error("Artifacts must be the same type");
  }
  
  if (from.role !== to.role) {
    throw new Error("Artifacts must have the same role");
  }

  // Route to type-specific diff engine
  switch (from.type) {
    case "chart":
      return diffCharts(from, to);
    case "pdf":
      return diffPdfs(from, to);
    case "text":
      return diffText(from, to);
    default:
      throw new Error(`Diff not supported for artifact type: ${from.type}`);
  }
}

/**
 * Chart-specific diffing logic
 * Compares chart metadata, data points, and configuration
 */
function diffCharts(from: Artifact, to: Artifact): DiffResult {
  const fromMeta = from.metadata as ChartMetadata;
  const toMeta = to.metadata as ChartMetadata;

  const diff: DiffResult["diff"] = {
    added: {},
    removed: {},
    changed: {}
  };

  // Diff data points
  const fromPoints = fromMeta.points || [];
  const toPoints = toMeta.points || [];
  
  const pointDiff = diffArrays(fromPoints, toPoints, (p) => `${p.x}:${p.y}`);
  if (pointDiff.added.length > 0) {
    diff.added!["points"] = pointDiff.added;
  }
  if (pointDiff.removed.length > 0) {
    diff.removed!["points"] = pointDiff.removed;
  }

  // Diff series data (if present)
  if (fromMeta.series && toMeta.series) {
    const seriesDiff = diffSeries(fromMeta.series, toMeta.series);
    if (seriesDiff.added.length > 0) {
      diff.added!["series"] = seriesDiff.added;
    }
    if (seriesDiff.removed.length > 0) {
      diff.removed!["series"] = seriesDiff.removed;
    }
    if (Object.keys(seriesDiff.changed).length > 0) {
      diff.changed = { ...diff.changed, ...seriesDiff.changed };
    }
  }

  // Diff simple metadata fields
  const simpleFields = ["title", "chart_type", "data_points"];
  for (const field of simpleFields) {
    const fromValue = fromMeta[field as keyof ChartMetadata];
    const toValue = toMeta[field as keyof ChartMetadata];
    
    if (fromValue !== toValue) {
      diff.changed![field] = { from: fromValue, to: toValue };
    }
  }

  // Diff labels
  if (fromMeta.labels || toMeta.labels) {
    const labelDiff = diffObjects(
      fromMeta.labels || {}, 
      toMeta.labels || {}
    );
    if (Object.keys(labelDiff.changed).length > 0) {
      diff.changed = { ...diff.changed, ...labelDiff.changed };
    }
  }

  // Diff config
  if (fromMeta.config || toMeta.config) {
    const configDiff = diffObjects(
      fromMeta.config || {}, 
      toMeta.config || {}
    );
    if (Object.keys(configDiff.changed).length > 0) {
      diff.changed = { ...diff.changed, ...configDiff.changed };
    }
  }

  // Clean up empty sections
  if (Object.keys(diff.added!).length === 0) delete diff.added;
  if (Object.keys(diff.removed!).length === 0) delete diff.removed;
  if (Object.keys(diff.changed!).length === 0) delete diff.changed;

  return {
    artifact_type: from.type,
    role: from.role || "default",
    from_version: from.version || 1,
    to_version: to.version || 1,
    diff
  };
}

/**
 * PDF diffing (placeholder for future implementation)
 * Currently focuses on metadata changes, not binary content
 */
function diffPdfs(from: Artifact, to: Artifact): DiffResult {
  const diff: DiffResult["diff"] = {};

  // Diff PDF metadata (pages, embedded artifacts, etc.)
  const metadataFields = ["pages", "embedded_artifacts", "section_count"];
  const changed: Record<string, { from: any; to: any }> = {};
  
  for (const field of metadataFields) {
    const fromValue = from.metadata?.[field];
    const toValue = to.metadata?.[field];
    
    if (fromValue !== toValue) {
      changed[field] = { from: fromValue, to: toValue };
    }
  }

  if (Object.keys(changed).length > 0) {
    diff.changed = changed;
  }

  return {
    artifact_type: from.type,
    role: from.role || "default",
    from_version: from.version || 1,
    to_version: to.version || 1,
    diff
  };
}

/**
 * Text diffing (placeholder for future implementation)
 */
function diffText(from: Artifact, to: Artifact): DiffResult {
  const diff: DiffResult["diff"] = {};

  // Simple metadata diff for now
  const fromBytes = from.metadata?.bytes;
  const toBytes = to.metadata?.bytes;
  
  if (fromBytes !== toBytes) {
    diff.changed = {
      size: { from: fromBytes, to: toBytes }
    };
  }

  return {
    artifact_type: from.type,
    role: from.role || "default",
    from_version: from.version || 1,
    to_version: to.version || 1,
    diff
  };
}

// Utility functions for diffing

interface ArrayDiff<T> {
  added: T[];
  removed: T[];
}

function diffArrays<T>(from: T[], to: T[], keyFn: (item: T) => string): ArrayDiff<T> {
  const fromKeys = new Set(from.map(keyFn));
  const toKeys = new Set(to.map(keyFn));

  const added = to.filter(item => !fromKeys.has(keyFn(item)));
  const removed = from.filter(item => !toKeys.has(keyFn(item)));

  return { added, removed };
}

interface ObjectDiff {
  changed: Record<string, { from: any; to: any }>;
}

function diffObjects(from: Record<string, any>, to: Record<string, any>): ObjectDiff {
  const changed: Record<string, { from: any; to: any }> = {};

  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)]);
  
  for (const key of allKeys) {
    const fromValue = from[key];
    const toValue = to[key];
    
    if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
      changed[key] = { from: fromValue, to: toValue };
    }
  }

  return { changed };
}

interface SeriesDiff {
  added: Array<{ label: string; data: Array<{ x: any; y: any }> }>;
  removed: Array<{ label: string; data: Array<{ x: any; y: any }> }>;
  changed: Record<string, { from: any; to: any }>;
}

function diffSeries(
  from: Array<{ label: string; data: Array<{ x: any; y: any }> }>,
  to: Array<{ label: string; data: Array<{ x: any; y: any }> }>
): SeriesDiff {
  const fromLabels = new Set(from.map(s => s.label));
  const toLabels = new Set(to.map(s => s.label));

  const added = to.filter(s => !fromLabels.has(s.label));
  const removed = from.filter(s => !toLabels.has(s.label));
  
  const changed: Record<string, { from: any; to: any }> = {};
  
  // Find common series and compare their data
  for (const fromSeries of from) {
    const toSeries = to.find(s => s.label === fromSeries.label);
    if (toSeries) {
      const dataDiff = diffArrays(fromSeries.data, toSeries.data, (p) => `${p.x}:${p.y}`);
      if (dataDiff.added.length > 0 || dataDiff.removed.length > 0) {
        changed[fromSeries.label] = {
          from: { data: fromSeries.data, points: fromSeries.data.length },
          to: { data: toSeries.data, points: toSeries.data.length }
        };
      }
    }
  }

  return { added, removed, changed };
}
