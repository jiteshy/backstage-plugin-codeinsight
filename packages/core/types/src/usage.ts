export type UsageTimeRange = '7d' | '30d' | 'all';

export interface RepoUsageRow {
  repoId: string;
  repoName: string;
  ingestionTokens: number;
  qnaTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastActivity: Date | null;
}

export interface ModelBreakdown {
  model: string;
  tokens: number;
  estimatedCost: number;
}

export interface TokenUsageStats {
  timeRange: UsageTimeRange;
  totalTokens: number;
  totalEstimatedCost: number;
  byModel: ModelBreakdown[];
  byRepo: RepoUsageRow[];
}
