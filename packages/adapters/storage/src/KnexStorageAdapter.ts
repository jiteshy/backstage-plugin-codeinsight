import type { Knex } from 'knex';
import type {
  Artifact,
  CIGEdge,
  CIGNode,
  IngestionJob,
  RepoFile,
  RepoStatus,
  Repository,
  StorageAdapter,
} from '@codeinsight/types';

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
  content: Record<string, unknown> | null;
  input_sha: string;
  prompt_version: string | null;
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
  started_at: Date | null;
  completed_at: Date | null;
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
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
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

  // -------------------------------------------------------------------------
  // CIG
  // -------------------------------------------------------------------------

  async upsertCIGNodes(nodes: CIGNode[]): Promise<void> {
    if (nodes.length === 0) return;

    for (const chunk of batch(nodes)) {
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

    for (const chunk of batch(edges)) {
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
}
