/**
 * EntityCodeInsightContent — unified single tab for the CodeInsight plugin.
 *
 * Header layout (single row, no vertical shift):
 *   [left: plugin description]   [right: inline status/progress  |  action button]
 *
 * Inner tabs: Documentation | Diagrams | Q&A
 *
 * Action button semantics:
 *   "Discover Insights" — no docs yet; full ingestion + doc/diagram/QnA generation pass
 *   "Sync Changes"      — docs exist; detects changed files, updates only those
 *   Both call the same backend endpoint — the label sets the right expectation.
 */
import { InfoCard, MarkdownContent } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Chip from '@material-ui/core/Chip';
import CircularProgress from '@material-ui/core/CircularProgress';
import Divider from '@material-ui/core/Divider';
import Fab from '@material-ui/core/Fab';
import { makeStyles } from '@material-ui/core/styles';
import Tab from '@material-ui/core/Tab';
import Tabs from '@material-ui/core/Tabs';
import TextField from '@material-ui/core/TextField';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';

import { codeInsightApiRef, DiagramSection, DocSection, QnASource } from '../api';

import { MermaidDiagramViewer } from './MermaidDiagramViewer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_ANNOTATION = 'github.com/project-slug';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'partial']);
const POLL_INTERVAL_MS = 3_000;

const SECTION_ORDER: Record<string, number> = {
  overview: 0,
  'getting-started': 1,
  configuration: 2,
  dependencies: 3,
  'project-structure': 4,
  'component-hierarchy': 5,
  routing: 6,
  testing: 7,
  deployment: 8,
  'api-reference': 9,
  auth: 10,
  database: 11,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobOutcome {
  status: 'completed' | 'partial' | 'failed';
  filesProcessed?: number;
  errorMessage?: string;
}

type ContentTab = 'docs' | 'diagrams' | 'qna';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: QnASource[];
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles(theme => ({
  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(3),
    padding: theme.spacing(1.5, 2),
  },
  // Left: bold title + description stacked vertically
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    flexGrow: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontWeight: 700,
    fontSize: '1.4rem',
    lineHeight: 1.3,
  },
  headerDesc: {
    color: theme.palette.text.secondary,
    fontSize: '0.82rem',
    lineHeight: 1.5,
  },
  // Right: timestamp on top (right-aligned), actions row below
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(0.75),
    flexShrink: 0,
  },
  timestamp: {
    color: theme.palette.text.disabled,
    fontSize: '0.72rem',
    whiteSpace: 'nowrap',
  },
  // Actions row: inline status + button on same line
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  inlineStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  inlineStatusText: {
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
  },
  dismissBtn: {
    minWidth: 'auto',
    padding: '0 6px',
    fontSize: '0.75rem',
    lineHeight: '1.4',
  },

  // ── Tabs + content ───────────────────────────────────────────────────────
  tabContent: { padding: theme.spacing(2) },

  // ── Documentation tab ────────────────────────────────────────────────────
  staleBanner: {
    borderLeft: `4px solid ${theme.palette.warning.main}`,
    backgroundColor: theme.palette.action.selected,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    borderRadius: 2,
    marginBottom: theme.spacing(2),
  },
  // Combined stats bar above all sections
  docStatsBar: {
    marginBottom: theme.spacing(2.5),
    paddingBottom: theme.spacing(1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  docStatsLine: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
    marginBottom: theme.spacing(0.75),
  },
  docStatsBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: theme.palette.action.selected,
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: '0.73rem',
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  docStatsSep: {
    color: theme.palette.text.disabled,
    fontSize: '0.8rem',
    userSelect: 'none' as const,
    padding: theme.spacing(0, 0.25),
  },
  docDisclaimer: {
    fontSize: '0.75rem',
    color: theme.palette.text.disabled,
    fontStyle: 'italic',
  },
  // Table of contents
  toc: {
    marginBottom: theme.spacing(3),
    padding: theme.spacing(1.5, 2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    display: 'inline-block',
    minWidth: 360,
  },
  tocTitle: {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1),
  },
  tocList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  },
  tocItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    cursor: 'pointer',
    color: theme.palette.primary.main,
    fontSize: '0.7rem',
    fontWeight: 500,
    padding: '1px 0',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    // Underline only the text label, not the number
    '&:hover $tocItemLabel': {
      textDecoration: 'underline',
    },
  },
  tocItemNumber: {
    fontSize: '0.8rem',
    color: theme.palette.text.disabled,
    minWidth: 16,
    fontVariantNumeric: 'tabular-nums',
    textDecoration: 'none',
  },
  tocItemLabel: {
    fontSize: '0.8rem',
    textDecoration: 'none',
  },
  // Each section: no border, no divider — pure whitespace separation
  docSection: {
    marginBottom: theme.spacing(4),
  },
  // Per-section meta row: name (left, subtle) + files·tokens (right)
  docSectionMeta: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  },
  docSectionName: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: theme.palette.primary.main,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  staleChip: {
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
    fontWeight: 600,
    height: 18,
    fontSize: '0.65rem',
  },

  // ── Empty / placeholder states ───────────────────────────────────────────
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(6, 2),
    gap: theme.spacing(1.5),
    color: theme.palette.text.secondary,
    textAlign: 'center',
  },
  emptyStateIconRing: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    border: `2px solid ${theme.palette.primary.main}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.35rem',
    color: theme.palette.primary.main,
    opacity: 0.6,
    flexShrink: 0,
  },
  emptyStateFeatures: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    marginTop: theme.spacing(0.25),
  },
  emptyStateFeaturePill: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 20,
    padding: theme.spacing(0.5, 1.5),
    fontSize: '0.74rem',
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.action.hover,
  },
  comingSoon: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(6, 2),
    gap: theme.spacing(1),
    color: theme.palette.text.secondary,
    textAlign: 'center',
  },

  backToTopRow: {
    position: 'sticky' as const,
    bottom: theme.spacing(2),
    display: 'flex',
    justifyContent: 'flex-end',
    // Transparent so content shows through the container, only the FAB is clickable
    pointerEvents: 'none' as const,
    '& > *': { pointerEvents: 'all' as const },
  },
  errorText: { color: theme.palette.error.main },

  // ── Q&A tab ───────────────────────────────────────────────────────────────
  qnaContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: 540,
  },
  qnaToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: theme.spacing(1),
    marginBottom: theme.spacing(1),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  qnaToolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  qnaDisclaimer: {
    fontSize: '0.72rem',
    color: theme.palette.text.disabled,
    fontStyle: 'italic',
  },
  qnaMessages: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    paddingRight: theme.spacing(0.5),
  },
  qnaMessageRow: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  qnaUserRow: {
    alignItems: 'flex-end',
  },
  qnaAssistantRow: {
    alignItems: 'flex-start',
  },
  qnaRoleLabel: {
    fontSize: '0.68rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: theme.palette.text.disabled,
    marginBottom: 2,
  },
  qnaUserBubble: {
    maxWidth: '78%',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    borderRadius: '12px 12px 2px 12px',
    padding: theme.spacing(1, 1.5),
    fontSize: '0.875rem',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  },
  qnaAssistantBubble: {
    maxWidth: '88%',
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: '2px 12px 12px 12px',
    padding: theme.spacing(1, 1.5),
    fontSize: '0.875rem',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
    '& p': { margin: '0 0 8px', '&:last-child': { margin: 0 } },
    '& pre': { overflowX: 'auto' as const },
    '& code': { fontSize: '0.8rem' },
  },
  qnaCursor: {
    display: 'inline-block',
    width: 2,
    height: '1em',
    backgroundColor: theme.palette.text.primary,
    marginLeft: 1,
    verticalAlign: 'text-bottom',
    animation: '$blink 1s step-end infinite',
  },
  '@keyframes blink': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0 },
  },
  qnaSources: {
    marginTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  },
  qnaSourcesLabel: {
    fontSize: '0.68rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: theme.palette.text.disabled,
    marginBottom: theme.spacing(0.25),
  },
  qnaSourceCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: theme.spacing(0.5, 1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    cursor: 'pointer',
    textDecoration: 'none',
    backgroundColor: theme.palette.action.hover,
    '&:hover': {
      backgroundColor: theme.palette.action.selected,
    },
  },
  qnaSourcePath: {
    fontSize: '0.76rem',
    fontFamily: 'monospace',
    color: theme.palette.primary.main,
    wordBreak: 'break-all' as const,
  },
  qnaSourceMeta: {
    fontSize: '0.7rem',
    color: theme.palette.text.disabled,
  },
  qnaInputArea: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
    paddingTop: theme.spacing(1.5),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  qnaTextField: {
    flex: 1,
  },

  // ── Diagrams tab ──────────────────────────────────────────────────────────
  diagramsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
    gap: theme.spacing(3),
    marginTop: theme.spacing(2),
  },
  diagramCard: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(2),
    backgroundColor: theme.palette.background.paper,
    overflow: 'hidden',
  },
  diagramCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  diagramTitle: {
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  diagramMeta: {
    fontSize: '0.72rem',
    color: theme.palette.text.disabled,
  },
  diagramMermaidContainer: {
    overflow: 'hidden',
    borderRadius: 4,
    minHeight: 120,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagramStatsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
    marginBottom: theme.spacing(2),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionId(artifactId: string): string {
  return `ci-section-${artifactId.replaceAll('/', '-')}`;
}

/** Strip the first markdown heading line (# or ##) so we don't duplicate the section label. */
function stripLeadingHeading(md: string): string {
  return md.replace(/^#{1,2}[^\n]*\n?/, '').trimStart();
}

function sectionSortKey(artifactId: string): number {
  const slug = artifactId.split('/').pop() ?? artifactId;
  return SECTION_ORDER[slug] ?? Number.MAX_SAFE_INTEGER;
}

function formatModuleName(artifactId: string): string {
  const slug = artifactId.split('/').pop() ?? artifactId;
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}


function stripSourceRefs(text: string): string {
  return text.replace(/\[source:\d+\]/gi, '').replace(/ {2,}/g, ' ');
}

function buildFileUrl(repoUrl: string, filePath: string, startLine?: number): string {
  const base = `${repoUrl}/blob/HEAD/${filePath}`;
  return startLine ? `${base}#L${startLine}` : base;
}

function outcomeMessage(outcome: JobOutcome): { text: string; color: 'textSecondary' | 'error' | 'inherit' } {
  if (outcome.status === 'failed') {
    return {
      text: outcome.errorMessage ? `Analysis failed: ${outcome.errorMessage}` : 'Analysis failed — check server logs.',
      color: 'error',
    };
  }
  if ((outcome.filesProcessed ?? 0) === 0) {
    return { text: 'No new changes — already up to date.', color: 'textSecondary' };
  }
  if (outcome.status === 'partial') {
    return { text: `Done — ${outcome.filesProcessed} files updated (some skipped).`, color: 'inherit' };
  }
  return { text: `Done — ${outcome.filesProcessed} files updated.`, color: 'inherit' };
}

// ---------------------------------------------------------------------------
// TableOfContents
// ---------------------------------------------------------------------------

function TableOfContents({ sections }: { sections: DocSection[] }) {
  const classes = useStyles();

  const scrollTo = (artifactId: string) => {
    document.getElementById(sectionId(artifactId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box className={classes.toc}>
      <Typography className={classes.tocTitle}>Contents</Typography>
      <Box className={classes.tocList}>
        {sections.map((section, idx) => (
          <Box
            key={section.artifactId}
            component="button"
            className={classes.tocItem}
            onClick={() => scrollTo(section.artifactId)}
          >
            <Typography component="span" className={classes.tocItemNumber}>
              {idx + 1}.
            </Typography>
            <Typography component="span" className={classes.tocItemLabel}>
              {formatModuleName(section.artifactId)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// DocSectionCard
// ---------------------------------------------------------------------------

function DocSectionCard({ section }: { section: DocSection }) {
  const classes = useStyles();

  return (
    <Box id={sectionId(section.artifactId)} className={classes.docSection}>
      {/* Section heading row: name + optional stale chip */}
      <Box className={classes.docSectionMeta}>
        <Typography className={classes.docSectionName}>
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
      {section.markdown ? (
        <MarkdownContent content={stripLeadingHeading(section.markdown)} />
      ) : (
        <Typography variant="body2" color="textSecondary">
          No content generated for this section.
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// DiagramCard
// ---------------------------------------------------------------------------

function DiagramCard({ diagram }: { diagram: DiagramSection }) {
  const classes = useStyles();

  return (
    <Box className={classes.diagramCard}>
      <Box className={classes.diagramCardHeader}>
        <Typography className={classes.diagramTitle}>{diagram.title}</Typography>
        <Box display="flex" alignItems="center" style={{ gap: 6 }}>
          {diagram.isStale && (
            <Chip
              size="small"
              label="Stale"
              className={classes.staleChip}
              title={`Stale reason: ${diagram.staleReason ?? 'unknown'}`}
            />
          )}
          <Chip
            size="small"
            label={diagram.llmUsed ? 'AI' : 'AST'}
            title={diagram.llmUsed ? 'Generated with LLM assistance' : 'Generated from AST — no LLM required'}
          />
        </Box>
      </Box>
      <Typography className={classes.diagramMeta} style={{ marginBottom: diagram.description ? 4 : 8 }}>
        {diagram.diagramType} · {diagram.artifactId}
      </Typography>
      {diagram.description && (
        <Typography variant="body2" color="textSecondary" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
          {diagram.description}
        </Typography>
      )}
      {diagram.mermaid ? (
        <MermaidDiagramViewer
          id={diagram.artifactId}
          mermaid={diagram.mermaid}
          nodeMap={diagram.nodeMap}
          title={diagram.title}
          llmUsed={diagram.llmUsed}
        />
      ) : (
        <Box className={classes.diagramMermaidContainer}>
          <Typography variant="body2" color="textSecondary">No diagram content available.</Typography>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// FirstRunEmptyState
// ---------------------------------------------------------------------------

function FirstRunEmptyState({ icon, heading }: { icon: string; heading: string }) {
  const classes = useStyles();
  return (
    <Box className={classes.emptyState}>
      <Box className={classes.emptyStateIconRing}>{icon}</Box>
      <Typography variant="h6" style={{ fontWeight: 600 }}>{heading}</Typography>
      <Typography variant="body2" color="textSecondary" style={{ maxWidth: 460, lineHeight: 1.65 }}>
        Run a full repository analysis to generate documentation and architecture diagrams,
        and index the codebase for natural-language Q&amp;A — all kept in sync as it evolves.
      </Typography>
      <Box className={classes.emptyStateFeatures}>
        <Box component="span" className={classes.emptyStateFeaturePill}>Docs</Box>
        <Box component="span" className={classes.emptyStateFeaturePill}>Architecture Diagrams</Box>
        <Box component="span" className={classes.emptyStateFeaturePill}>Q&amp;A</Box>
      </Box>
      <Typography variant="caption" color="textSecondary" style={{ marginTop: 4 }}>
        Use the button above to get started.
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// DiagramsContent
// ---------------------------------------------------------------------------

function DiagramsContent({
  diagrams,
  loadError,
  isFirstRun,
}: {
  diagrams: DiagramSection[] | null;
  loadError: string | null;
  isFirstRun: boolean;
}) {
  const classes = useStyles();

  if (loadError) {
    return (
      <Typography variant="body2" className={classes.errorText}>
        Failed to load diagrams: {loadError}
      </Typography>
    );
  }

  if (!diagrams) {
    return (
      <Box display="flex" alignItems="center" style={{ gap: 8 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Loading diagrams...</Typography>
      </Box>
    );
  }

  if (diagrams.length === 0) {
    return isFirstRun ? (
      <FirstRunEmptyState icon="◆" heading="No diagrams generated yet" />
    ) : (
      <Box className={classes.emptyState}>
        <Typography variant="h6">No diagrams found</Typography>
        <Typography variant="body2">
          Try clicking &quot;Sync Changes&quot; to refresh diagrams for this repository.
        </Typography>
      </Box>
    );
  }

  const astCount = diagrams.filter(d => !d.llmUsed).length;
  const llmCount = diagrams.filter(d => d.llmUsed).length;
  const staleCount = diagrams.filter(d => d.isStale).length;

  return (
    <div>
      <Box className={classes.diagramStatsBar}>
        <Box component="span" className={classes.docStatsBadge}>
          {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'}
        </Box>
        {astCount > 0 && (
          <>
            <Typography className={classes.docStatsSep}>·</Typography>
            <Box component="span" className={classes.docStatsBadge}>
              {astCount} AST
            </Box>
          </>
        )}
        {llmCount > 0 && (
          <>
            <Typography className={classes.docStatsSep}>·</Typography>
            <Box component="span" className={classes.docStatsBadge}>
              {llmCount} AI-assisted
            </Box>
          </>
        )}
        {staleCount > 0 && (
          <>
            <Typography className={classes.docStatsSep}>·</Typography>
            <Chip size="small" label={`${staleCount} stale`} className={classes.staleChip} />
          </>
        )}
      </Box>
      <Box className={classes.diagramsGrid}>
        {diagrams.map(diagram => (
          <DiagramCard key={diagram.artifactId} diagram={diagram} />
        ))}
      </Box>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentationContent
// ---------------------------------------------------------------------------

function DocumentationContent({
  docs,
  loadError,
  isFirstRun,
}: {
  docs: DocSection[] | null;
  loadError: string | null;
  isFirstRun: boolean;
}) {
  const classes = useStyles();
  const topRef = useRef<HTMLDivElement>(null);

  if (loadError) {
    return (
      <Typography variant="body2" className={classes.errorText}>
        Failed to load documentation: {loadError}
      </Typography>
    );
  }

  if (!docs) {
    return (
      <Box display="flex" alignItems="center" style={{ gap: 8 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Loading documentation...</Typography>
      </Box>
    );
  }

  if (docs.length === 0) {
    return isFirstRun ? (
      <FirstRunEmptyState icon="≡" heading="No documentation yet" />
    ) : (
      <Box className={classes.emptyState}>
        <Typography variant="h6">No documentation found</Typography>
        <Typography variant="body2">
          Try clicking &quot;Sync Changes&quot; to refresh documentation for this repository.
        </Typography>
      </Box>
    );
  }

  const sorted = [...docs].sort(
    (a, b) => sectionSortKey(a.artifactId) - sectionSortKey(b.artifactId),
  );

  const totalFiles = docs.reduce((sum, s) => sum + s.fileCount, 0);
  const totalTokens = docs.reduce((sum, s) => sum + s.tokensUsed, 0);
  const latestMs = docs.reduce((max, s) => Math.max(max, Date.parse(s.generatedAt)), 0);
  const latestDate = latestMs ? new Date(latestMs).toLocaleString() : null;
  const staleCount = docs.filter(s => s.isStale).length;

  return (
    <div ref={topRef}>
      {/* Combined stats bar */}
      <Box className={classes.docStatsBar}>
        <Box className={classes.docStatsLine}>
          <Box component="span" className={classes.docStatsBadge}>
            {docs.length} {docs.length === 1 ? 'section' : 'sections'}
          </Box>
          <Typography className={classes.docStatsSep}>·</Typography>
          <Box component="span" className={classes.docStatsBadge}>
            {totalFiles} files analyzed
          </Box>
          {totalTokens > 0 && (
            <>
              <Typography className={classes.docStatsSep}>·</Typography>
              <Box component="span" className={classes.docStatsBadge}>
                {totalTokens.toLocaleString()} tokens
              </Box>
            </>
          )}
          {latestDate && (
            <>
              <Typography className={classes.docStatsSep}>·</Typography>
              <Box component="span" className={classes.docStatsBadge}>
                Updated {latestDate}
              </Box>
            </>
          )}
          {staleCount > 0 && (
            <>
              <Typography className={classes.docStatsSep}>·</Typography>
              <Chip size="small" label={`${staleCount} stale`} className={classes.staleChip} />
            </>
          )}
        </Box>
        <Typography className={classes.docDisclaimer}>
          AI-generated content — may contain inaccuracies. Always verify critical information against the source code.
        </Typography>
      </Box>

      {/* Table of contents */}
      <TableOfContents sections={sorted} />

      {/* Sections — no dividers, whitespace separation only */}
      {sorted.map(section => (
        <DocSectionCard key={section.artifactId} section={section} />
      ))}

      {/* Sticky back-to-top — sticks to the bottom of the scroll container as user reads */}
      <Box className={classes.backToTopRow}>
        <Tooltip title="Back to top" placement="left">
          <Fab
            size="small"
            onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            ↑
          </Fab>
        </Tooltip>
      </Box>
    </div>
  );
}

// (ComingSoonContent removed — Q&A tab is now live)

// ---------------------------------------------------------------------------
// SourceCard
// ---------------------------------------------------------------------------

function SourceCard({ source, repoUrl }: { source: QnASource; repoUrl: string }) {
  const classes = useStyles();
  const href = buildFileUrl(repoUrl, source.filePath, source.startLine);
  const lineMeta = source.startLine
    ? source.endLine && source.endLine !== source.startLine
      ? `lines ${source.startLine}–${source.endLine}`
      : `line ${source.startLine}`
    : null;

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={classes.qnaSourceCard}
    >
      <Typography className={classes.qnaSourcePath}>{source.filePath}</Typography>
      <Typography className={classes.qnaSourceMeta}>
        {[source.symbol, lineMeta, source.layer].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// QnAContent
// ---------------------------------------------------------------------------

function QnAContent({
  repoId,
  repoUrl,
  isFirstRun,
}: {
  repoId: string;
  repoUrl: string;
  isFirstRun: boolean;
}) {
  const api = useApi(codeInsightApiRef);
  const classes = useStyles();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  // Auto-create session on mount
  useEffect(() => {
    let cancelled = false;
    setSessionError(null);
    api.createQnASession(repoId).then(
      ({ sessionId: sid }) => { if (!cancelled) setSessionId(sid); },
      err => { if (!cancelled) setSessionError(String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, repoId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewConversation = useCallback(async () => {
    try {
      setSessionError(null);
      const { sessionId: sid } = await api.createQnASession(repoId);
      setSessionId(sid);
      setMessages([]);
    } catch (err) {
      setSessionError(String(err));
    }
  }, [api, repoId]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || !sessionId || isAsking) return;

    setInput('');
    setIsAsking(true);

    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: question },
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);

    try {
      const sources = await api.askQnAStream(repoId, sessionId, question, token => {
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: m.content + token } : m),
        );
      });
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, isStreaming: false, sources } : m),
      );
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error: ${String(err)}`, isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsAsking(false);
    }
  }, [api, repoId, sessionId, input, isAsking]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (isFirstRun) {
    return <FirstRunEmptyState icon="?" heading="Q&A not available yet" />;
  }

  if (sessionError) {
    return (
      <Typography variant="body2" className={classes.errorText}>
        Failed to start Q&A session: {sessionError}
      </Typography>
    );
  }

  return (
    <Box className={classes.qnaContainer}>
      {/* Toolbar */}
      <Box className={classes.qnaToolbar}>
        <Box className={classes.qnaToolbarLeft}>
          <Typography variant="body2" style={{ fontWeight: 600 }}>
            Ask about this repository
          </Typography>
          {!sessionId && <CircularProgress size={12} />}
        </Box>
        <Button size="small" onClick={handleNewConversation} disabled={isAsking}>
          New conversation
        </Button>
      </Box>

      {/* Message list */}
      <Box className={classes.qnaMessages}>
        {messages.length === 0 && (
          <Box className={classes.emptyState} style={{ padding: '32px 0' }}>
            <Typography variant="body2" color="textSecondary">
              Ask a question about the codebase — e.g. &quot;How does authentication work?&quot;
            </Typography>
          </Box>
        )}

        {messages.map(msg => (
          <Box
            key={msg.id}
            className={`${classes.qnaMessageRow} ${msg.role === 'user' ? classes.qnaUserRow : classes.qnaAssistantRow}`}
          >
            <Typography className={classes.qnaRoleLabel}>
              {msg.role === 'user' ? 'You' : 'CodeInsight'}
            </Typography>

            {msg.role === 'user' ? (
              <Box className={classes.qnaUserBubble}>{msg.content}</Box>
            ) : (
              <Box className={classes.qnaAssistantBubble}>
                {msg.content ? (
                  <MarkdownContent content={stripSourceRefs(msg.content)} />
                ) : (
                  <CircularProgress size={14} />
                )}
                {msg.isStreaming && <Box component="span" className={classes.qnaCursor} />}

                {/* Sources */}
                {!msg.isStreaming && msg.sources && msg.sources.length > 0 && (
                  <Box className={classes.qnaSources}>
                    <Typography className={classes.qnaSourcesLabel}>
                      Sources ({msg.sources.length})
                    </Typography>
                    {msg.sources.map((src, idx) => (
                      <SourceCard key={idx} source={src} repoUrl={repoUrl} />
                    ))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        ))}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input area */}
      <Box className={classes.qnaInputArea}>
        <TextField
          className={classes.qnaTextField}
          variant="outlined"
          size="small"
          placeholder="Ask a question... (Shift+Enter for newline)"
          multiline
          rowsMax={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!sessionId || isAsking}
        />
        <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={handleSend}
          disabled={!sessionId || isAsking || !input.trim()}
          style={{ minWidth: 64, height: 40, flexShrink: 0 }}
        >
          {isAsking ? <CircularProgress size={14} color="inherit" /> : 'Send'}
        </Button>
      </Box>

      <Typography className={classes.qnaDisclaimer} style={{ marginTop: 6 }}>
        AI-generated answers — always verify against source code.
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function CodeInsightContentInner() {
  const { entity } = useEntity();
  const classes = useStyles();
  const api = useApi(codeInsightApiRef);

  const annotation = entity.metadata.annotations?.[GITHUB_ANNOTATION];
  const repoId = annotation ? annotation.replaceAll('/', '-') : null;
  const repoUrl = annotation ? `https://github.com/${annotation}` : null;

  // Remote data
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramSection[] | null>(null);
  const [diagramLoadError, setDiagramLoadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Job lifecycle
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState('Queued...');
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<JobOutcome | null>(null);

  // Active inner tab
  const [activeTab, setActiveTab] = useState<ContentTab>('docs');

  // Fetch last-synced timestamp (non-fatal if unavailable)
  useEffect(() => {
    if (!repoId) return undefined;
    let cancelled = false;
    api.getRepoStatus(repoId).then(
      result => { if (!cancelled) setLastSynced(result.updatedAt ?? null); },
      () => { /* non-fatal */ },
    );
    return () => { cancelled = true; };
  }, [api, repoId, refreshToken]);

  // Load docs on mount and after each completed job
  useEffect(() => {
    if (!repoId) return undefined;
    let cancelled = false;
    setLoadError(null);
    api.getDocs(repoId).then(
      result => { if (!cancelled) setDocs(result); },
      err => { if (!cancelled) setLoadError(String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, repoId, refreshToken]);

  // Load diagrams on mount and after each completed job
  useEffect(() => {
    if (!repoId) return undefined;
    let cancelled = false;
    setDiagramLoadError(null);
    api.getDiagrams(repoId).then(
      result => { if (!cancelled) setDiagrams(result); },
      err => { if (!cancelled) setDiagramLoadError(String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, repoId, refreshToken]);

  // Poll for job status while a job is active
  useEffect(() => {
    if (!activeJobId || !repoId) return undefined;
    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      try {
        const result = await api.getJobStatus(repoId, activeJobId);
        if (cancelled) return;
        if (result.status === 'running') setJobLabel('Analyzing repository...');
        if (TERMINAL_STATUSES.has(result.status)) {
          setActiveJobId(null);
          setLastOutcome({
            status: result.status as JobOutcome['status'],
            filesProcessed: result.filesProcessed,
            errorMessage: result.errorMessage,
          });
          setRefreshToken(t => t + 1);
        }
      } catch (err) {
        if (!cancelled) {
          setActiveJobId(null);
          setTriggerError(`Lost contact with job: ${String(err)}`);
        }
      }
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, repoId, activeJobId]);

  const hasDocs = docs !== null && docs.length > 0;
  // "First run" = docs loaded (not null) and empty — no prior analysis
  const isFirstRun = docs !== null && !hasDocs;

  const handleAnalyze = useCallback(async () => {
    if (!repoId || !repoUrl) return;
    setTriggerLoading(true);
    setTriggerError(null);
    setLastOutcome(null);
    setJobLabel('Queued...');
    try {
      const { jobId } = await api.triggerIngestion(repoId, repoUrl);
      setActiveJobId(jobId);
    } catch (err) {
      setTriggerError(String(err));
    } finally {
      setTriggerLoading(false);
    }
  }, [api, repoId, repoUrl]);

  // No annotation guard
  if (!annotation || !repoId || !repoUrl) {
    return (
      <InfoCard title="CodeInsight">
        <Typography variant="body2">
          No GitHub annotation found on this entity. Add{' '}
          <code>{GITHUB_ANNOTATION}</code> to <code>metadata.annotations</code>{' '}
          in the entity YAML to enable CodeInsight.
        </Typography>
      </InfoCard>
    );
  }

  const lastSyncedLabel = lastSynced
    ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
    : null;

  // Inline status message (left of button, same row, no vertical shift)
  const inlineStatus = (() => {
    if (triggerError) return { text: triggerError, color: 'error' as const, spinner: false };
    if (activeJobId) return { text: jobLabel, color: 'textSecondary' as const, spinner: true };
    if (lastOutcome) return { ...outcomeMessage(lastOutcome), spinner: false };
    return null;
  })();

  const buttonLabel = triggerLoading ? 'Starting...' : isFirstRun ? 'Discover Insights' : 'Sync Changes';
  const buttonTooltip = isFirstRun
    ? 'Run a full analysis to generate documentation and architecture diagrams, and index the codebase for Q&A.'
    : 'Detect new commits and update only the sections affected by changed files.';

  return (
    <InfoCard noPadding>
      {/* ── Header: two-column, no vertical shift on status change ── */}
      <Box className={classes.header}>
        {/* Left column: bold title + description */}
        <Box className={classes.headerLeft}>
          <Typography className={classes.headerTitle}>
            Code Insights
          </Typography>
          <Typography className={classes.headerDesc}>
            Turns your repository into living knowledge — auto-generated documentation, architecture
            diagrams, and a Q&A-ready index that stays in sync as your codebase evolves.
          </Typography>
        </Box>

        {/* Right column: timestamp (top) + actions row (bottom) */}
        <Box className={classes.headerRight}>
          {lastSyncedLabel && (
            <Typography className={classes.timestamp}>{lastSyncedLabel}</Typography>
          )}
          <Box className={classes.headerActions}>
            {/* Inline status — appears left of button, same row, zero vertical shift */}
            {inlineStatus && (
              <Box className={classes.inlineStatus}>
                {inlineStatus.spinner && <CircularProgress size={12} />}
                <Typography className={classes.inlineStatusText} color={inlineStatus.color}>
                  {inlineStatus.text}
                </Typography>
                {!inlineStatus.spinner && (
                  <Button
                    className={classes.dismissBtn}
                    size="small"
                    onClick={() => { setLastOutcome(null); setTriggerError(null); }}
                  >
                    ×
                  </Button>
                )}
              </Box>
            )}

            <Tooltip title={buttonTooltip}>
              {/* span needed so Tooltip works when Button is disabled */}
              <span>
                <Button
                  variant={isFirstRun ? 'contained' : 'outlined'}
                  color="primary"
                  size="small"
                  disabled={triggerLoading || !!activeJobId}
                  onClick={handleAnalyze}
                  startIcon={
                    triggerLoading ? <CircularProgress size={14} color="inherit" /> : undefined
                  }
                >
                  {buttonLabel}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      <Divider />

      {/* ── Inner content tabs ── */}
      <Tabs
        value={activeTab}
        onChange={(_, val) => setActiveTab(val as ContentTab)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab label="Documentation" value="docs" />
        <Tab label="Diagrams" value="diagrams" />
        <Tab label="Q&A" value="qna" />
      </Tabs>

      <Divider />

      <Box className={classes.tabContent}>
        {activeTab === 'docs' && (
          <DocumentationContent docs={docs} loadError={loadError} isFirstRun={isFirstRun} />
        )}
        {activeTab === 'diagrams' && (
          <DiagramsContent
            diagrams={diagrams}
            loadError={diagramLoadError}
            isFirstRun={isFirstRun}
          />
        )}
        {activeTab === 'qna' && repoId && repoUrl && (
          <QnAContent repoId={repoId} repoUrl={repoUrl} isFirstRun={isFirstRun} />
        )}
      </Box>
    </InfoCard>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Returns true if the entity has the GitHub annotation required by CodeInsight.
 *
 * ```tsx
 * <EntityLayout.Route if={isCodeInsightAvailable} path="/codeinsight" title="CodeInsight">
 *   <EntityCodeInsightContent />
 * </EntityLayout.Route>
 * ```
 */
export const isCodeInsightAvailable = (entity: {
  metadata: { annotations?: Record<string, string> };
}) => Boolean(entity.metadata.annotations?.[GITHUB_ANNOTATION]);

/**
 * The single CodeInsight tab. Drop this onto any Backstage entity page.
 * Use `isCodeInsightAvailable` in the route `if` prop to restrict which entities show it.
 */
export const EntityCodeInsightContent = () => <CodeInsightContentInner />;
