import type {
  ActiveContext,
  Artifact,
  ArtifactContent,
  ArtifactFeedback,
  ArtifactInput,
  ArtifactType,
  CIGEdge,
  CIGNode,
  IngestionJob,
  QnAMessage,
  QnARole,
  QnASession,
  QnASource,
  RepoFile,
  RepoStatus,
  Repository,
  StaleReason,
  StorageAdapter,
  TokenUsageStats,
  UsageTimeRange,
} from '@codeinsight/types';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// DB row types (snake_case) — internal only
// ---------------------------------------------------------------------------

interface RepoRow {
  repo_id: string;
  name: string;
  url: string;
  provider: string;
  status: string;
  last_commit_sha: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RepoFileRow {
  repo_id: string;
  file_path: string;
  current_sha: string;
  last_processed_sha: string | null;
  file_type: string;
  language: string | null;
  parse_status: string;
}

interface CIGNodeRow {
  node_id: string;
  repo_id: string;
  file_path: string;
  symbol_name: string;
  symbol_type: string;
  start_line: number;
  end_line: number;
  exported: boolean;
  extracted_sha: string;
  metadata: Record<string, unknown> | null;
}

interface CIGEdgeRow {
  edge_id: string;
  repo_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
}

interface ArtifactRow {
  repo_id: string;
  artifact_id: string;
  artifact_type: string;
  content: ArtifactContent | null;
  input_sha: string;
  prompt_version: string | null;
  generation_sig: string | null;
  is_stale: boolean;
  stale_reason: string | null;
  tokens_used: number;
  llm_used: boolean;
  generated_at: Date;
}

interface JobRow {
  job_id: string;
  repo_id: string;
  trigger: string;
  status: string;
  from_commit: string | null;
  to_commit: string | null;
  changed_files: string[] | null;
  artifacts_stale: string[] | null;
  files_processed: number;
  files_skipped: number;
  tokens_consumed: number;
  error_message: string | null;
  indexing_status: string | null;
  indexing_error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

interface QnASessionRow {
  session_id: string;
  repo_id: string;
  user_ref: string | null;
  active_context: ActiveContext | null;
  created_at: Date;
  last_active: Date;
}

interface QnAMessageRow {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  sources: QnASource[] | null;
  tokens_used: number;
  created_at: Date;
}

interface FeedbackRow {
  repo_id: string;
  artifact_id: string;
  artifact_type: string;
  rating: number;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Row ↔ Domain mappers
// ---------------------------------------------------------------------------

function repoFromRow(row: RepoRow): Repository {
  return {
    repoId: row.repo_id,
    name: row.name,
    url: row.url,
    provider: row.provider as Repository['provider'],
    status: row.status as Repository['status'],
    lastCommitSha: row.last_commit_sha,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function repoFileFromRow(row: RepoFileRow): RepoFile {
  return {
    repoId: row.repo_id,
    filePath: row.file_path,
    currentSha: row.current_sha,
    lastProcessedSha: row.last_processed_sha,
    fileType: row.file_type as RepoFile['fileType'],
    language: row.language,
    parseStatus: row.parse_status as RepoFile['parseStatus'],
  };
}

function cigNodeFromRow(row: CIGNodeRow): CIGNode {
  return {
    nodeId: row.node_id,
    repoId: row.repo_id,
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type as CIGNode['symbolType'],
    startLine: row.start_line,
    endLine: row.end_line,
    exported: row.exported,
    extractedSha: row.extracted_sha,
    metadata: row.metadata,
  };
}

function cigEdgeFromRow(row: CIGEdgeRow): CIGEdge {
  return {
    edgeId: row.edge_id,
    repoId: row.repo_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    edgeType: row.edge_type as CIGEdge['edgeType'],
  };
}

function artifactFromRow(row: ArtifactRow): Artifact {
  return {
    repoId: row.repo_id,
    artifactId: row.artifact_id,
    artifactType: row.artifact_type as Artifact['artifactType'],
    content: row.content,
    inputSha: row.input_sha,
    promptVersion: row.prompt_version,
    generationSig: row.generation_sig,
    isStale: row.is_stale,
    staleReason: row.stale_reason as Artifact['staleReason'],
    tokensUsed: row.tokens_used,
    llmUsed: row.llm_used,
    generatedAt: new Date(row.generated_at),
  };
}

function jobFromRow(row: JobRow): IngestionJob {
  return {
    jobId: row.job_id,
    repoId: row.repo_id,
    trigger: row.trigger as IngestionJob['trigger'],
    status: row.status as IngestionJob['status'],
    fromCommit: row.from_commit,
    toCommit: row.to_commit,
    changedFiles: row.changed_files,
    artifactsStale: row.artifacts_stale,
    filesProcessed: row.files_processed,
    filesSkipped: row.files_skipped,
    tokensConsumed: row.tokens_consumed,
    errorMessage: row.error_message,
    indexingStatus: row.indexing_status as IngestionJob['indexingStatus'],
    indexingError: row.indexing_error,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function qnaSessionFromRow(row: QnASessionRow): QnASession {
  return {
    sessionId: row.session_id,
    repoId: row.repo_id,
    userRef: row.user_ref,
    activeContext: row.active_context ?? {
      mentionedFiles: [],
      mentionedSymbols: [],
    },
    createdAt: new Date(row.created_at),
    lastActive: new Date(row.last_active),
  };
}

function qnaMessageFromRow(row: QnAMessageRow): QnAMessage {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    role: row.role as QnARole,
    content: row.content,
    sources: row.sources,
    tokensUsed: row.tokens_used,
    createdAt: new Date(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Batch helper — splits an array into chunks for safe batch operations
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

function batch<T>(items: T[], size = BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// KnexStorageAdapter
// ---------------------------------------------------------------------------

export class KnexStorageAdapter implements StorageAdapter {
  constructor(private readonly knex: Knex) {}

  // -------------------------------------------------------------------------
  // Repository operations
  // -------------------------------------------------------------------------

  async getRepo(repoId: string): Promise<Repository | null> {
    const row = await this.knex<RepoRow>('ci_repositories')
      .where('repo_id', repoId)
      .first();
    return row ? repoFromRow(row) : null;
  }

  async upsertRepo(repo: Repository): Promise<void> {
    const row: RepoRow = {
      repo_id: repo.repoId,
      name: repo.name,
      url: repo.url,
      provider: repo.provider,
      status: repo.status,
      last_commit_sha: repo.lastCommitSha ?? null,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
    };
    await this.knex<RepoRow>('ci_repositories')
      .insert(row)
      .onConflict('repo_id')
      .merge({
        name: row.name,
        url: row.url,
        provider: row.provider,
        status: row.status,
        last_commit_sha: row.last_commit_sha,
        updated_at: row.updated_at,
      });
  }

  async updateRepoStatus(
    repoId: string,
    status: RepoStatus,
    lastCommitSha?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: this.knex.fn.now(),
    };
    if (lastCommitSha !== undefined) {
      update.last_commit_sha = lastCommitSha;
    }
    await this.knex('ci_repositories').where('repo_id', repoId).update(update);
  }

  async deleteRepo(repoId: string): Promise<void> {
    // All child tables (repo_files, cig_nodes, artifacts, jobs, qna_*) have
    // ON DELETE CASCADE FKs to ci_repositories, so a single delete suffices.
    await this.knex('ci_repositories').where('repo_id', repoId).delete();
  }

  async saveFeedback(feedback: ArtifactFeedback): Promise<void> {
    await this.knex<FeedbackRow>('ci_artifact_feedback')
      .insert({
        repo_id: feedback.repoId,
        artifact_id: feedback.artifactId,
        artifact_type: feedback.artifactType,
        rating: feedback.rating,
        created_at: new Date(),
      })
      .onConflict(['repo_id', 'artifact_id'])
      .merge(['rating', 'created_at']);
  }

  // -------------------------------------------------------------------------
  // File tracking
  // -------------------------------------------------------------------------

  async upsertRepoFiles(files: RepoFile[]): Promise<void> {
    if (files.length === 0) return;

    for (const chunk of batch(files)) {
      const rows: RepoFileRow[] = chunk.map(f => ({
        repo_id: f.repoId,
        file_path: f.filePath,
        current_sha: f.currentSha,
        last_processed_sha: f.lastProcessedSha ?? null,
        file_type: f.fileType,
        language: f.language ?? null,
        parse_status: f.parseStatus,
      }));

      await this.knex<RepoFileRow>('ci_repo_files')
        .insert(rows)
        .onConflict(['repo_id', 'file_path'])
        .merge({
          current_sha: this.knex.raw('EXCLUDED.current_sha'),
          last_processed_sha: this.knex.raw('EXCLUDED.last_processed_sha'),
          file_type: this.knex.raw('EXCLUDED.file_type'),
          language: this.knex.raw('EXCLUDED.language'),
          parse_status: this.knex.raw('EXCLUDED.parse_status'),
        });
    }
  }

  async getRepoFiles(repoId: string): Promise<RepoFile[]> {
    const rows = await this.knex<RepoFileRow>('ci_repo_files').where(
      'repo_id',
      repoId,
    );
    return rows.map(repoFileFromRow);
  }

  async getChangedRepoFiles(repoId: string): Promise<RepoFile[]> {
    const rows = await this.knex<RepoFileRow>('ci_repo_files')
      .where('repo_id', repoId)
      .andWhere(function () {
        this.whereNull('last_processed_sha').orWhereRaw(
          'current_sha != last_processed_sha',
        );
      });
    return rows.map(repoFileFromRow);
  }

  async deleteRepoFilesNotIn(repoId: string, currentFilePaths: string[]): Promise<void> {
    if (currentFilePaths.length === 0) {
      // No current files — delete everything for this repo
      await this.knex('ci_repo_files').where('repo_id', repoId).del();
      return;
    }

    // Fetch existing paths and diff in memory rather than issuing a single
    // NOT IN query, because currentFilePaths can be arbitrarily large and
    // exceeding the DB parameter limit would produce a runtime error.
    const existingPaths = await this.knex<RepoFileRow>('ci_repo_files')
      .where('repo_id', repoId)
      .select('file_path');

    const currentSet = new Set(currentFilePaths);
    const toDelete = existingPaths
      .map(r => r.file_path)
      .filter(p => !currentSet.has(p));

    if (toDelete.length === 0) return;

    for (const chunk of batch(toDelete)) {
      await this.knex('ci_repo_files')
        .where('repo_id', repoId)
        .whereIn('file_path', chunk)
        .del();
    }
  }

  // -------------------------------------------------------------------------
  // CIG
  // -------------------------------------------------------------------------

  async upsertCIGNodes(nodes: CIGNode[]): Promise<void> {
    if (nodes.length === 0) return;

    const unique = Array.from(
      new Map(nodes.map(n => [`${n.repoId}::${n.filePath}::${n.symbolName}::${n.symbolType}`, n])).values(),
    );

    for (const chunk of batch(unique)) {
      const rows: CIGNodeRow[] = chunk.map(n => ({
        node_id: n.nodeId,
        repo_id: n.repoId,
        file_path: n.filePath,
        symbol_name: n.symbolName,
        symbol_type: n.symbolType,
        start_line: n.startLine,
        end_line: n.endLine,
        exported: n.exported,
        extracted_sha: n.extractedSha,
        metadata: n.metadata ?? null,
      }));

      await this.knex<CIGNodeRow>('ci_cig_nodes')
        .insert(rows)
        .onConflict(['repo_id', 'file_path', 'symbol_name', 'symbol_type'])
        .merge({
          node_id: this.knex.raw('EXCLUDED.node_id'),
          start_line: this.knex.raw('EXCLUDED.start_line'),
          end_line: this.knex.raw('EXCLUDED.end_line'),
          exported: this.knex.raw('EXCLUDED.exported'),
          extracted_sha: this.knex.raw('EXCLUDED.extracted_sha'),
          metadata: this.knex.raw('EXCLUDED.metadata'),
        });
    }
  }

  async upsertCIGEdges(edges: CIGEdge[]): Promise<void> {
    if (edges.length === 0) return;

    const unique = Array.from(new Map(edges.map(e => [e.edgeId, e])).values());

    for (const chunk of batch(unique)) {
      const rows: CIGEdgeRow[] = chunk.map(e => ({
        edge_id: e.edgeId,
        repo_id: e.repoId,
        from_node_id: e.fromNodeId,
        to_node_id: e.toNodeId,
        edge_type: e.edgeType,
      }));

      await this.knex<CIGEdgeRow>('ci_cig_edges')
        .insert(rows)
        .onConflict('edge_id')
        .merge({
          repo_id: this.knex.raw('EXCLUDED.repo_id'),
          from_node_id: this.knex.raw('EXCLUDED.from_node_id'),
          to_node_id: this.knex.raw('EXCLUDED.to_node_id'),
          edge_type: this.knex.raw('EXCLUDED.edge_type'),
        });
    }
  }

  async deleteCIGForFiles(repoId: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;

    // Edges referencing nodes for these files are cascade-deleted via FK
    await this.knex('ci_cig_nodes')
      .where('repo_id', repoId)
      .whereIn('file_path', filePaths)
      .del();
  }

  async getCIGNodes(repoId: string): Promise<CIGNode[]> {
    const rows = await this.knex<CIGNodeRow>('ci_cig_nodes').where(
      'repo_id',
      repoId,
    );
    return rows.map(cigNodeFromRow);
  }

  async getCIGEdges(repoId: string): Promise<CIGEdge[]> {
    const rows = await this.knex<CIGEdgeRow>('ci_cig_edges').where(
      'repo_id',
      repoId,
    );
    return rows.map(cigEdgeFromRow);
  }

  // -------------------------------------------------------------------------
  // Artifacts (Phase 2+)
  // -------------------------------------------------------------------------

  async upsertArtifact(artifact: Artifact): Promise<void> {
    const row: ArtifactRow = {
      repo_id: artifact.repoId,
      artifact_id: artifact.artifactId,
      artifact_type: artifact.artifactType,
      content: artifact.content ?? null,
      input_sha: artifact.inputSha,
      prompt_version: artifact.promptVersion ?? null,
      generation_sig: artifact.generationSig ?? null,
      is_stale: artifact.isStale,
      stale_reason: artifact.staleReason ?? null,
      tokens_used: artifact.tokensUsed,
      llm_used: artifact.llmUsed,
      generated_at: artifact.generatedAt,
    };

    await this.knex<ArtifactRow>('ci_artifacts')
      .insert(row)
      .onConflict(['repo_id', 'artifact_id'])
      .merge({
        artifact_type: row.artifact_type,
        content: row.content,
        input_sha: row.input_sha,
        prompt_version: row.prompt_version,
        generation_sig: row.generation_sig,
        is_stale: row.is_stale,
        stale_reason: row.stale_reason,
        tokens_used: row.tokens_used,
        llm_used: row.llm_used,
        generated_at: row.generated_at,
      });
  }

  async getArtifact(
    artifactId: string,
    repoId: string,
  ): Promise<Artifact | null> {
    const row = await this.knex<ArtifactRow>('ci_artifacts')
      .where({ repo_id: repoId, artifact_id: artifactId })
      .first();
    return row ? artifactFromRow(row) : null;
  }

  async getStaleArtifacts(repoId: string): Promise<Artifact[]> {
    const rows = await this.knex<ArtifactRow>('ci_artifacts')
      .where({ repo_id: repoId, is_stale: true });
    return rows.map(artifactFromRow);
  }

  async getArtifactsByType(repoId: string, type: ArtifactType): Promise<Artifact[]> {
    const rows = await this.knex<ArtifactRow>('ci_artifacts')
      .where({ repo_id: repoId, artifact_type: type });
    return rows.map(artifactFromRow);
  }

  async markArtifactsStale(
    repoId: string,
    artifactIds: string[],
    reason: StaleReason,
  ): Promise<void> {
    if (artifactIds.length === 0) return;

    for (const chunk of batch(artifactIds)) {
      await this.knex('ci_artifacts')
        .where('repo_id', repoId)
        .whereIn('artifact_id', chunk)
        .update({ is_stale: true, stale_reason: reason });
    }
  }

  // -------------------------------------------------------------------------
  // Artifact Inputs
  // -------------------------------------------------------------------------

  async upsertArtifactInputs(inputs: ArtifactInput[]): Promise<void> {
    if (inputs.length === 0) return;

    for (const chunk of batch(inputs)) {
      const rows = chunk.map(i => ({
        repo_id: i.repoId,
        artifact_id: i.artifactId,
        file_path: i.filePath,
        file_sha: i.fileSha,
      }));

      await this.knex('ci_artifact_inputs')
        .insert(rows)
        .onConflict(['repo_id', 'artifact_id', 'file_path'])
        .merge({ file_sha: this.knex.raw('EXCLUDED.file_sha') });
    }
  }

  async getArtifactInputs(
    repoId: string,
    artifactId: string,
  ): Promise<ArtifactInput[]> {
    const rows = await this.knex('ci_artifact_inputs')
      .where({ repo_id: repoId, artifact_id: artifactId });

    return rows.map((r: { repo_id: string; artifact_id: string; file_path: string; file_sha: string }) => ({
      repoId: r.repo_id,
      artifactId: r.artifact_id,
      filePath: r.file_path,
      fileSha: r.file_sha,
    }));
  }

  async getArtifactIdsByFilePaths(
    repoId: string,
    filePaths: string[],
  ): Promise<string[]> {
    if (filePaths.length === 0) return [];

    const artifactIds = new Set<string>();
    for (const chunk of batch(filePaths)) {
      const rows: Array<{ artifact_id: string }> = await this.knex('ci_artifact_inputs')
        .where('repo_id', repoId)
        .whereIn('file_path', chunk)
        .distinct('artifact_id')
        .select('artifact_id');
      rows.forEach(r => artifactIds.add(r.artifact_id));
    }
    return Array.from(artifactIds);
  }

  async getArtifactDependents(
    repoId: string,
    artifactIds: string[],
  ): Promise<string[]> {
    if (artifactIds.length === 0) return [];

    const dependentIds = new Set<string>();
    for (const chunk of batch(artifactIds)) {
      const rows: Array<{ dependent_id: string }> = await this.knex('ci_artifact_dependencies')
        .where('repo_id', repoId)
        .whereIn('dependency_id', chunk)
        .distinct('dependent_id')
        .select('dependent_id');
      rows.forEach(r => dependentIds.add(r.dependent_id));
    }
    return Array.from(dependentIds);
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  async createJob(job: IngestionJob): Promise<string> {
    const row: JobRow = {
      job_id: job.jobId,
      repo_id: job.repoId,
      trigger: job.trigger,
      status: job.status,
      from_commit: job.fromCommit ?? null,
      to_commit: job.toCommit ?? null,
      changed_files: job.changedFiles ?? null,
      artifacts_stale: job.artifactsStale ?? null,
      files_processed: job.filesProcessed,
      files_skipped: job.filesSkipped,
      tokens_consumed: job.tokensConsumed,
      error_message: job.errorMessage ?? null,
      indexing_status: job.indexingStatus ?? null,
      indexing_error: job.indexingError ?? null,
      started_at: job.startedAt ?? null,
      completed_at: job.completedAt ?? null,
      created_at: job.createdAt,
    };

    await this.knex<JobRow>('ci_ingestion_jobs').insert(row);
    return job.jobId;
  }

  async updateJob(
    jobId: string,
    update: Partial<IngestionJob>,
  ): Promise<void> {
    const row: Record<string, unknown> = {};

    if (update.status !== undefined) row.status = update.status;
    if (update.fromCommit !== undefined) row.from_commit = update.fromCommit;
    if (update.toCommit !== undefined) row.to_commit = update.toCommit;
    if (update.changedFiles !== undefined)
      row.changed_files = update.changedFiles;
    if (update.artifactsStale !== undefined)
      row.artifacts_stale = update.artifactsStale;
    if (update.filesProcessed !== undefined)
      row.files_processed = update.filesProcessed;
    if (update.filesSkipped !== undefined)
      row.files_skipped = update.filesSkipped;
    if (update.tokensConsumed !== undefined)
      row.tokens_consumed = update.tokensConsumed;
    if (update.errorMessage !== undefined)
      row.error_message = update.errorMessage;
    if (update.indexingStatus !== undefined)
      row.indexing_status = update.indexingStatus ?? null;
    if (update.indexingError !== undefined)
      row.indexing_error = update.indexingError ?? null;
    if (update.startedAt !== undefined) row.started_at = update.startedAt;
    if (update.completedAt !== undefined) row.completed_at = update.completedAt;

    if (Object.keys(row).length === 0) return;

    await this.knex('ci_ingestion_jobs').where('job_id', jobId).update(row);
  }

  async getJob(jobId: string): Promise<IngestionJob | null> {
    const row = await this.knex<JobRow>('ci_ingestion_jobs')
      .where('job_id', jobId)
      .first();
    return row ? jobFromRow(row) : null;
  }

  async getActiveJobForRepo(repoId: string): Promise<IngestionJob | null> {
    const row = await this.knex<JobRow>('ci_ingestion_jobs')
      .where('repo_id', repoId)
      .whereIn('status', ['queued', 'running'])
      .orderBy('created_at', 'desc')
      .first();
    return row ? jobFromRow(row) : null;
  }

  // -------------------------------------------------------------------------
  // QnA Sessions (Phase 5.6)
  // -------------------------------------------------------------------------

  async createSession(session: QnASession): Promise<string> {
    await this.knex('ci_qna_sessions').insert({
      session_id: session.sessionId,
      repo_id: session.repoId,
      user_ref: session.userRef ?? null,
      active_context: JSON.stringify(session.activeContext),
      created_at: session.createdAt,
      last_active: session.lastActive,
    });
    return session.sessionId;
  }

  async getSession(sessionId: string): Promise<QnASession | null> {
    const row = await this.knex<QnASessionRow>('ci_qna_sessions')
      .where('session_id', sessionId)
      .first();
    return row ? qnaSessionFromRow(row) : null;
  }

  async updateSessionActiveContext(
    sessionId: string,
    activeContext: ActiveContext,
  ): Promise<void> {
    await this.knex('ci_qna_sessions')
      .where('session_id', sessionId)
      .update({ active_context: JSON.stringify(activeContext) });
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.knex('ci_qna_sessions')
      .where('session_id', sessionId)
      .update({ last_active: this.knex.fn.now() });
  }

  // -------------------------------------------------------------------------
  // QnA Messages (Phase 5.6)
  // -------------------------------------------------------------------------

  async addMessage(message: QnAMessage): Promise<string> {
    await this.knex('ci_qna_messages').insert({
      message_id: message.messageId,
      session_id: message.sessionId,
      role: message.role,
      content: message.content,
      sources: message.sources ? JSON.stringify(message.sources) : null,
      tokens_used: message.tokensUsed,
      created_at: message.createdAt,
    });
    return message.messageId;
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
    offset?: number,
  ): Promise<QnAMessage[]> {
    let query = this.knex<QnAMessageRow>('ci_qna_messages')
      .where('session_id', sessionId)
      .orderBy('created_at', 'asc');

    if (offset !== undefined) query = query.offset(offset);
    if (limit !== undefined) query = query.limit(limit);

    const rows = await query;
    return rows.map(qnaMessageFromRow);
  }

  async getSessionMessageCount(sessionId: string): Promise<number> {
    const result = await this.knex('ci_qna_messages')
      .where('session_id', sessionId)
      .count('message_id as count')
      .first();
    return Number(result?.count ?? 0);
  }

  // -------------------------------------------------------------------------
  // Token Usage Stats (Phase 6.3)
  // -------------------------------------------------------------------------

  private computeCutoff(timeRange: UsageTimeRange): Date | null {
    if (timeRange === 'all') return null;
    const now = new Date();
    const days = timeRange === '7d' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  async getTokenUsageStats(
    timeRange: UsageTimeRange,
    costMap: Record<string, number>,
  ): Promise<TokenUsageStats> {
    const cutoff = this.computeCutoff(timeRange);
    const defaultRate = costMap['default'] ?? Math.max(...Object.values(costMap), 0);

    // 1. Ingestion tokens by repo
    let ingestionQuery = this.knex('ci_artifacts as a')
      .join('ci_repositories as r', 'a.repo_id', 'r.repo_id')
      .where('a.llm_used', true)
      .groupBy('a.repo_id', 'r.name')
      .select(
        'a.repo_id as repo_id',
        'r.name as repo_name',
        this.knex.raw('COALESCE(SUM(a.tokens_used), 0)::bigint as ingestion_tokens'),
        this.knex.raw('MAX(a.generated_at) as last_ingestion'),
      );
    if (cutoff) {
      ingestionQuery = ingestionQuery.where('a.generated_at', '>=', cutoff);
    }
    const ingestionRows: Array<{
      repo_id: string;
      repo_name: string;
      ingestion_tokens: string;
      last_ingestion: Date | null;
    }> = await ingestionQuery;

    // 2. QnA tokens by repo
    let qnaQuery = this.knex('ci_qna_messages as m')
      .join('ci_qna_sessions as s', 'm.session_id', 's.session_id')
      .join('ci_repositories as r', 's.repo_id', 'r.repo_id')
      .groupBy('s.repo_id', 'r.name')
      .select(
        's.repo_id as repo_id',
        'r.name as repo_name',
        this.knex.raw('COALESCE(SUM(m.tokens_used), 0)::bigint as qna_tokens'),
        this.knex.raw('MAX(m.created_at) as last_qna'),
      );
    if (cutoff) {
      qnaQuery = qnaQuery.where('m.created_at', '>=', cutoff);
    }
    const qnaRows: Array<{
      repo_id: string;
      repo_name: string;
      qna_tokens: string;
      last_qna: Date | null;
    }> = await qnaQuery;

    // 3. Model breakdown from artifacts
    let modelQuery = this.knex('ci_artifacts')
      .where('llm_used', true)
      .whereNotNull('generation_sig')
      .groupBy(this.knex.raw("SPLIT_PART(generation_sig, ':', 1)"))
      .select(
        this.knex.raw("SPLIT_PART(generation_sig, ':', 1) as model"),
        this.knex.raw('COALESCE(SUM(tokens_used), 0)::bigint as tokens'),
      );
    if (cutoff) {
      modelQuery = modelQuery.where('generated_at', '>=', cutoff);
    }
    const modelRows: Array<{ model: string; tokens: string }> = await modelQuery;

    // 4. QnA total tokens (add under generic "llm" label)
    let qnaTotalQuery = this.knex('ci_qna_messages')
      .select(this.knex.raw('COALESCE(SUM(tokens_used), 0)::bigint as tokens'));
    if (cutoff) {
      qnaTotalQuery = qnaTotalQuery.where('created_at', '>=', cutoff);
    }
    const qnaTotalRow: { tokens: string } = await qnaTotalQuery.first() as { tokens: string };
    const qnaTotalTokens = Number(qnaTotalRow?.tokens ?? 0);

    // Merge ingestion + QnA into byRepo map
    const repoMap = new Map<string, {
      repoId: string;
      repoName: string;
      ingestionTokens: number;
      qnaTokens: number;
      lastIngestion: Date | null;
      lastQna: Date | null;
    }>();

    for (const row of ingestionRows) {
      repoMap.set(row.repo_id, {
        repoId: row.repo_id,
        repoName: row.repo_name,
        ingestionTokens: Number(row.ingestion_tokens),
        qnaTokens: 0,
        lastIngestion: row.last_ingestion ? new Date(row.last_ingestion) : null,
        lastQna: null,
      });
    }

    for (const row of qnaRows) {
      const existing = repoMap.get(row.repo_id);
      if (existing) {
        existing.qnaTokens = Number(row.qna_tokens);
        existing.lastQna = row.last_qna ? new Date(row.last_qna) : null;
      } else {
        repoMap.set(row.repo_id, {
          repoId: row.repo_id,
          repoName: row.repo_name,
          ingestionTokens: 0,
          qnaTokens: Number(row.qna_tokens),
          lastIngestion: null,
          lastQna: row.last_qna ? new Date(row.last_qna) : null,
        });
      }
    }

    const byRepo = Array.from(repoMap.values()).map(entry => {
      const totalTokens = entry.ingestionTokens + entry.qnaTokens;
      const lastActivity = entry.lastIngestion && entry.lastQna
        ? (entry.lastIngestion > entry.lastQna ? entry.lastIngestion : entry.lastQna)
        : entry.lastIngestion ?? entry.lastQna;
      return {
        repoId: entry.repoId,
        repoName: entry.repoName,
        ingestionTokens: entry.ingestionTokens,
        qnaTokens: entry.qnaTokens,
        totalTokens,
        estimatedCost: (totalTokens / 1_000_000) * defaultRate,
        lastActivity,
      };
    });

    // Sort by totalTokens descending
    byRepo.sort((a, b) => b.totalTokens - a.totalTokens);

    // Build model breakdown
    const byModel = modelRows.map(row => {
      const tokens = Number(row.tokens);
      const rate = costMap[row.model] ?? defaultRate;
      return {
        model: row.model,
        tokens,
        estimatedCost: (tokens / 1_000_000) * rate,
      };
    });

    // Add QnA total under "llm" label if there are any QnA tokens
    if (qnaTotalTokens > 0) {
      const qnaRate = costMap['llm'] ?? defaultRate;
      byModel.push({
        model: 'llm',
        tokens: qnaTotalTokens,
        estimatedCost: (qnaTotalTokens / 1_000_000) * qnaRate,
      });
    }

    // Sort by tokens descending
    byModel.sort((a, b) => b.tokens - a.tokens);

    const totalTokens = byModel.reduce((sum, m) => sum + m.tokens, 0);
    const totalEstimatedCost = byModel.reduce((sum, m) => sum + m.estimatedCost, 0);

    return {
      timeRange,
      totalTokens,
      totalEstimatedCost,
      byModel,
      byRepo,
    };
  }
}
