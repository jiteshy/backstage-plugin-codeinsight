import {
  Content,
  Header,
  Page,
  Progress,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import Box from '@material-ui/core/Box';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import { makeStyles } from '@material-ui/core/styles';
import MuiTable from '@material-ui/core/Table';
import MuiTableBody from '@material-ui/core/TableBody';
import MuiTableCell from '@material-ui/core/TableCell';
import MuiTableHead from '@material-ui/core/TableHead';
import MuiTableRow from '@material-ui/core/TableRow';
import Typography from '@material-ui/core/Typography';
import ToggleButton from '@material-ui/lab/ToggleButton';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  codeInsightApiRef,
  ModelBreakdown,
  RepoUsageRow,
  TokenUsageStats,
  UsageTimeRange,
} from '../api';

const useStyles = makeStyles(theme => ({
  summaryBar: {
    display: 'flex',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(3),
  },
  statCard: {
    flex: 1,
    textAlign: 'center',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 700,
  },
  statLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.875rem',
  },
  modelTable: {
    marginBottom: theme.spacing(3),
  },
  rangeToggle: {
    marginBottom: theme.spacing(2),
  },
}));

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const repoColumns: TableColumn<RepoUsageRow>[] = [
  { title: 'Repo', field: 'repoName' },
  {
    title: 'Ingestion Tokens',
    field: 'ingestionTokens',
    type: 'numeric',
    render: row => formatTokens(row.ingestionTokens),
  },
  {
    title: 'QnA Tokens',
    field: 'qnaTokens',
    type: 'numeric',
    render: row => formatTokens(row.qnaTokens),
  },
  {
    title: 'Total Tokens',
    field: 'totalTokens',
    type: 'numeric',
    defaultSort: 'desc',
    render: row => formatTokens(row.totalTokens),
  },
  {
    title: 'Estimated Cost',
    field: 'estimatedCost',
    type: 'numeric',
    render: row => formatCost(row.estimatedCost),
  },
  {
    title: 'Last Activity',
    field: 'lastActivity',
    render: row => formatRelativeTime(row.lastActivity),
  },
];

export function TokenUsagePage() {
  const api = useApi(codeInsightApiRef);
  const classes = useStyles();
  const [range, setRange] = useState<UsageTimeRange>('30d');
  const [stats, setStats] = useState<TokenUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchUsage = useCallback(async (r: UsageTimeRange) => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTokenUsage(r);
      if (fetchId !== fetchIdRef.current) return;
      setStats(data);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setStats(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchUsage(range);
  }, [range, fetchUsage]);

  const handleRangeChange = (_: unknown, newRange: UsageTimeRange | null) => {
    if (newRange) setRange(newRange);
  };

  return (
    <Page themeId="tool">
      <Header title="Token Usage" subtitle="CodeInsight LLM token consumption and cost estimates" />
      <Content>
        <Box className={classes.rangeToggle}>
          <ToggleButtonGroup
            value={range}
            exclusive
            onChange={handleRangeChange}
            size="small"
          >
            <ToggleButton value="7d">Last 7 days</ToggleButton>
            <ToggleButton value="30d">Last 30 days</ToggleButton>
            <ToggleButton value="all">All time</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {loading && <Progress />}

        {error && (
          <Typography color="error" gutterBottom>
            Failed to load usage data: {error}
          </Typography>
        )}

        {!loading && stats && (
          <>
            <Box className={classes.summaryBar}>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {formatTokens(stats.totalTokens)}
                  </Typography>
                  <Typography className={classes.statLabel}>Total Tokens</Typography>
                </CardContent>
              </Card>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {formatCost(stats.totalEstimatedCost)}
                  </Typography>
                  <Typography className={classes.statLabel}>Estimated Cost</Typography>
                </CardContent>
              </Card>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {stats.byRepo.length}
                  </Typography>
                  <Typography className={classes.statLabel}>Active Repos</Typography>
                </CardContent>
              </Card>
            </Box>

            {stats.byModel.length > 0 && (
              <Card className={classes.modelTable}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Model Breakdown
                  </Typography>
                  <MuiTable size="small">
                    <MuiTableHead>
                      <MuiTableRow>
                        <MuiTableCell>Model</MuiTableCell>
                        <MuiTableCell align="right">Tokens</MuiTableCell>
                        <MuiTableCell align="right">Estimated Cost</MuiTableCell>
                      </MuiTableRow>
                    </MuiTableHead>
                    <MuiTableBody>
                      {stats.byModel.map((m: ModelBreakdown) => (
                        <MuiTableRow key={m.model}>
                          <MuiTableCell>{m.model}</MuiTableCell>
                          <MuiTableCell align="right">{formatTokens(m.tokens)}</MuiTableCell>
                          <MuiTableCell align="right">{formatCost(m.estimatedCost)}</MuiTableCell>
                        </MuiTableRow>
                      ))}
                    </MuiTableBody>
                  </MuiTable>
                </CardContent>
              </Card>
            )}

            <Table<RepoUsageRow>
              title="Per-Repo Usage"
              columns={repoColumns}
              data={stats.byRepo}
              options={{
                pageSize: 10,
                search: true,
                sorting: true,
                padding: 'dense',
              }}
            />
          </>
        )}
      </Content>
    </Page>
  );
}
