import { InfoCard, MarkdownContent } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Chip from '@material-ui/core/Chip';
import CircularProgress from '@material-ui/core/CircularProgress';
import Divider from '@material-ui/core/Divider';
import { makeStyles } from '@material-ui/core/styles';
import Typography from '@material-ui/core/Typography';
import { useCallback, useEffect, useState } from 'react';

import { codeInsightApiRef, DocSection } from '../api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_ANNOTATION = 'github.com/project-slug';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'partial']);
const POLL_INTERVAL_MS = 3_000;

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued...',
  running: 'Regenerating documentation...',
  completed: 'Regeneration complete',
  partial: 'Regeneration complete (some files skipped)',
  failed: 'Regeneration failed',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles(theme => ({
  section: {
    marginBottom: theme.spacing(3),
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
    flexWrap: 'wrap',
  },
  sectionMeta: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    marginBottom: theme.spacing(1),
  },
  staleChip: {
    backgroundColor: theme.palette.warning.light,
    color: theme.palette.warning.contrastText,
    fontWeight: 600,
    height: 20,
    fontSize: '0.7rem',
  },
  regenerateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  errorText: { color: theme.palette.error.main },
  emptyState: { color: theme.palette.text.secondary },
  divider: { marginBottom: theme.spacing(3) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts an artifactId like "core/overview" or "backend/api-reference"
 *  into a readable title like "Overview" or "API Reference". */
function formatModuleName(artifactId: string): string {
  const parts = artifactId.split('/');
  const slug = parts[parts.length - 1] ?? artifactId;
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Job progress (polls until terminal state)
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
  }, [api, repoId, jobId, onComplete]);

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
// Single doc section
// ---------------------------------------------------------------------------

function DocSectionCard({ section }: { section: DocSection }) {
  const classes = useStyles();
  const formattedDate = new Date(section.generatedAt).toLocaleString();

  return (
    <Box className={classes.section}>
      <Box className={classes.sectionHeader}>
        <Typography variant="h6" component="h3">
          {formatModuleName(section.artifactId)}
        </Typography>
        {section.isStale && (
          <Chip
            size="small"
            label="Stale"
            className={classes.staleChip}
            title={`Stale reason: ${section.staleReason ?? 'unknown'}`}
          />
        )}
      </Box>
      <Typography className={classes.sectionMeta}>
        Generated from {section.fileCount} {section.fileCount === 1 ? 'file' : 'files'} • Last
        updated {formattedDate}
        {section.tokensUsed > 0 ? ` • ${section.tokensUsed} tokens` : ''}
      </Typography>
      {section.markdown ? (
        <MarkdownContent content={section.markdown} />
      ) : (
        <Typography variant="body2" className={classes.emptyState}>
          No content generated yet.
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function DocumentationTabInner() {
  const { entity } = useEntity();
  const classes = useStyles();
  const api = useApi(codeInsightApiRef);

  const annotation = entity.metadata.annotations?.[GITHUB_ANNOTATION];
  const repoId = annotation ? annotation.replaceAll('/', '-') : null;
  const repoUrl = annotation ? `https://github.com/${annotation}` : null;

  const [sections, setSections] = useState<DocSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Active regeneration job
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // Incrementing this token re-fetches docs after a job completes
  const [refreshToken, setRefreshToken] = useState(0);

  // Fetch docs whenever repoId or refreshToken changes
  useEffect(() => {
    if (!repoId) return undefined;

    let cancelled = false;
    api.getDocs(repoId).then(
      result => { if (!cancelled) setSections(result); },
      err => { if (!cancelled) setLoadError(String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, repoId, refreshToken]);

  const handleRegenerate = useCallback(async () => {
    if (!repoId || !repoUrl) return;
    setLoading(true);
    setRegenerateError(null);
    try {
      const { jobId } = await api.triggerIngestion(repoId, repoUrl);
      setActiveJobId(jobId);
    } catch (err) {
      setRegenerateError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api, repoId, repoUrl]);

  const handleJobComplete = useCallback(() => {
    setActiveJobId(null);
    setRefreshToken(t => t + 1);
  }, []);

  if (!annotation || !repoId || !repoUrl) {
    return (
      <InfoCard title="Documentation">
        <Typography variant="body2">
          No GitHub annotation found on this entity. Add{' '}
          <code>{GITHUB_ANNOTATION}</code> to <code>metadata.annotations</code>{' '}
          in the entity YAML to enable CodeInsight documentation.
        </Typography>
      </InfoCard>
    );
  }

  const staleCount = sections?.filter(s => s.isStale).length ?? 0;

  return (
    <InfoCard
      title="Documentation"
      subheader={annotation}
    >
      {/* Regenerate controls */}
      <Box className={classes.regenerateRow}>
        {!activeJobId && (
          <Button
            variant="outlined"
            color="primary"
            size="small"
            disabled={loading}
            onClick={handleRegenerate}
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {loading ? 'Starting...' : 'Regenerate'}
          </Button>
        )}
        {activeJobId && (
          <JobProgressSection
            repoId={repoId}
            jobId={activeJobId}
            onComplete={handleJobComplete}
          />
        )}
        {regenerateError && (
          <Typography variant="body2" className={classes.errorText}>
            {regenerateError}
          </Typography>
        )}
        {staleCount > 0 && !activeJobId && (
          <Typography variant="body2" className={classes.emptyState}>
            {staleCount} {staleCount === 1 ? 'section is' : 'sections are'} stale — regenerate to
            refresh
          </Typography>
        )}
      </Box>

      <Divider className={classes.divider} />

      {/* Loading state */}
      {!loadError && !sections && (
        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading documentation...</Typography>
        </Box>
      )}

      {/* Error state */}
      {loadError && (
        <Typography variant="body2" className={classes.errorText}>
          Failed to load documentation: {loadError}
        </Typography>
      )}

      {/* Empty state */}
      {sections && sections.length === 0 && (
        <Typography variant="body2" className={classes.emptyState}>
          No documentation generated yet. Click <strong>Regenerate</strong> to analyze this
          repository.
        </Typography>
      )}

      {/* Doc sections */}
      {sections && sections.length > 0 &&
        sections.map((section, idx) => (
          <Box key={section.artifactId}>
            <DocSectionCard section={section} />
            {idx < sections.length - 1 && <Divider className={classes.divider} />}
          </Box>
        ))}
    </InfoCard>
  );
}

/**
 * Renders generated documentation for a Backstage entity.
 *
 * Add to your entity page:
 * ```tsx
 * <EntityLayout.Route path="/docs" title="Documentation">
 *   <EntityDocumentationTab />
 * </EntityLayout.Route>
 * ```
 */
export const EntityDocumentationTab = () => <DocumentationTabInner />;
