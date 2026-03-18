import { InfoCard } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Chip from '@material-ui/core/Chip';
import CircularProgress from '@material-ui/core/CircularProgress';
import { makeStyles } from '@material-ui/core/styles';
import Typography from '@material-ui/core/Typography';
import { useCallback, useEffect, useState } from 'react';

import { codeInsightApiRef } from '../api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_ANNOTATION = 'github.com/project-slug';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'partial']);
const POLL_INTERVAL_MS = 3_000;

// Maps job status values to user-facing progress text
const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued...',
  running: 'Analyzing repository...',
  completed: 'Analysis complete',
  partial: 'Analysis complete (some files skipped)',
  failed: 'Analysis failed',
};

// Maps repo status values to display labels
const REPO_STATUS_LABEL: Record<string, string> = {
  idle: 'Not yet analyzed',
  processing: 'Analyzing...',
  ready: 'Ready',
  error: 'Error',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles(theme => ({
  section: {
    marginBottom: theme.spacing(2),
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  chip: {
    fontWeight: 600,
  },
  chipIdle: { backgroundColor: theme.palette.grey[300] },
  chipProcessing: { backgroundColor: theme.palette.info.light, color: theme.palette.info.contrastText },
  chipReady: { backgroundColor: theme.palette.success.light, color: theme.palette.success.contrastText },
  chipError: { backgroundColor: theme.palette.error.light, color: theme.palette.error.contrastText },
  errorText: { color: theme.palette.error.main },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  timestamp: { color: theme.palette.text.secondary, fontSize: '0.75rem' },
}));

// ---------------------------------------------------------------------------
// Helper: chip variant by status
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: string }) {
  const classes = useStyles();
  const label = REPO_STATUS_LABEL[status] ?? status;
  const classMap: Record<string, string> = {
    idle: classes.chipIdle,
    processing: classes.chipProcessing,
    ready: classes.chipReady,
    error: classes.chipError,
  };
  return (
    <Chip
      size="small"
      label={label}
      className={`${classes.chip} ${classMap[status] ?? classes.chipIdle}`}
    />
  );
}

// ---------------------------------------------------------------------------
// 1.10.5 — Repo status section
// ---------------------------------------------------------------------------

interface RepoStatusData {
  status: string;
  lastCommitSha?: string;
  updatedAt?: string;
}

function RepoStatusSection({
  repoId,
  refreshToken,
}: {
  repoId: string;
  refreshToken: number;
}) {
  const classes = useStyles();
  const api = useApi(codeInsightApiRef);
  const [data, setData] = useState<RepoStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getRepoStatus(repoId).then(
      result => { if (!cancelled) setData(result); },
      err => { if (!cancelled) setError(String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, repoId, refreshToken]);

  if (error) {
    return (
      <Box className={classes.section}>
        <Typography variant="body2" className={classes.errorText}>
          Unable to load repo status: {error}
        </Typography>
      </Box>
    );
  }

  if (!data) {
    return null;
  }

  const formattedDate = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString()
    : null;

  return (
    <Box className={classes.section}>
      <Box className={classes.row}>
        <Typography variant="body2" component="span">
          Status:
        </Typography>
        <StatusChip status={data.status} />
        {formattedDate && (
          <Typography className={classes.timestamp}>
            Last analyzed: {formattedDate}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 1.10.4 — Job progress section (polls every 3 s until terminal state)
// ---------------------------------------------------------------------------

function JobProgressSection({
  repoId,
  jobId,
  onComplete,
}: {
  repoId: string;
  jobId: string;
  onComplete: () => void;
}) {
  const classes = useStyles();
  const api = useApi(codeInsightApiRef);
  const [jobStatus, setJobStatus] = useState<string>('queued');
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(jobStatus)) {
      onComplete();
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const result = await api.getJobStatus(repoId, jobId);
        setJobStatus(result.status);
        if (TERMINAL_STATUSES.has(result.status)) {
          clearInterval(timer);
          onComplete();
        }
      } catch (err) {
        clearInterval(timer);
        setPollError(String(err));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [api, repoId, jobId, onComplete]); // onComplete is stable (useCallback []) so adding it is safe and avoids stale-closure risk

  if (pollError) {
    return (
      <Typography variant="body2" className={classes.errorText}>
        Lost contact with job: {pollError}
      </Typography>
    );
  }

  const isTerminal = TERMINAL_STATUSES.has(jobStatus);

  return (
    <Box className={classes.progressRow}>
      {!isTerminal && <CircularProgress size={16} />}
      <Typography variant="body2">
        {JOB_STATUS_LABEL[jobStatus] ?? jobStatus}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 1.10.3 — Ingestion button
// ---------------------------------------------------------------------------

function IngestionButton({
  repoId,
  repoUrl,
  onJobStarted,
}: {
  repoId: string;
  repoUrl: string;
  onJobStarted: (jobId: string) => void;
}) {
  const api = useApi(codeInsightApiRef);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const classes = useStyles();

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { jobId } = await api.triggerIngestion(repoId, repoUrl);
      onJobStarted(jobId);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api, repoId, repoUrl, onJobStarted]);

  return (
    <Box>
      <Button
        variant="contained"
        color="primary"
        disabled={loading}
        onClick={handleClick}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
      >
        {loading ? 'Starting...' : 'Analyze Repository'}
      </Button>
      {error && (
        <Typography variant="body2" className={classes.errorText} style={{ marginTop: 8 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 1.10.3–1.10.6 — Main content (component-kind only)
// ---------------------------------------------------------------------------

function CodeInsightContentInner() {
  const { entity } = useEntity();
  const classes = useStyles();

  const annotation = entity.metadata.annotations?.[GITHUB_ANNOTATION];
  // Derive a stable, URL-safe repoId from the project slug (e.g. "org/repo" → "org-repo")
  const repoId = annotation ? annotation.replaceAll('/', '-') : null;
  const repoUrl = annotation ? `https://github.com/${annotation}` : null;

  // Incremented when a job completes — triggers RepoStatusSection to re-fetch
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const handleJobStarted = useCallback((jobId: string) => {
    setActiveJobId(jobId);
  }, []);

  const handleJobComplete = useCallback(() => {
    setActiveJobId(null);
    setRefreshToken(t => t + 1);
  }, []);

  if (!annotation || !repoId || !repoUrl) {
    return (
      <InfoCard title="CodeInsight">
        <Typography variant="body2">
          No GitHub annotation found on this entity. Add{' '}
          <code>{GITHUB_ANNOTATION}</code> to <code>metadata.annotations</code>{' '}
          in the entity YAML to enable CodeInsight analysis.
        </Typography>
      </InfoCard>
    );
  }

  return (
    <InfoCard title="CodeInsight" subheader={annotation}>
      {/* 1.10.5 — Repo status */}
      <RepoStatusSection repoId={repoId} refreshToken={refreshToken} />

      {/* 1.10.4 — Active job progress */}
      {activeJobId && (
        <Box className={classes.section}>
          <JobProgressSection
            repoId={repoId}
            jobId={activeJobId}
            onComplete={handleJobComplete}
          />
        </Box>
      )}

      {/* 1.10.3 — Trigger button (hidden while a job is active) */}
      {!activeJobId && (
        <IngestionButton
          repoId={repoId}
          repoUrl={repoUrl}
          onJobStarted={handleJobStarted}
        />
      )}
    </InfoCard>
  );
}

// ---------------------------------------------------------------------------
// 1.10.6 — Exported component with isKind('component') guard
// ---------------------------------------------------------------------------

/**
 * Drop this onto any Backstage entity page tab. The component renders only
 * for entities of kind `component` — for all other entity kinds it shows a
 * "not available" message instead of the full UI.
 *
 * Typical usage in your entity page:
 *
 * ```tsx
 * <EntityLayout.Route path="/codeinsight" title="CodeInsight">
 *   <EntityCodeInsightContent />
 * </EntityLayout.Route>
 * ```
 */
export const EntityCodeInsightContent = () => {
  const { entity } = useEntity();

  if (entity.kind.toLowerCase() !== 'component') {
    return (
      <InfoCard title="CodeInsight">
        <Typography variant="body2">
          CodeInsight is only available for entities of kind <code>component</code>.
        </Typography>
      </InfoCard>
    );
  }

  return <CodeInsightContentInner />;
};
