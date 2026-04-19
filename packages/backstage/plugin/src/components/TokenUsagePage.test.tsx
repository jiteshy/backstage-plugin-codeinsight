/**
 * @jest-environment jsdom
 *
 * Unit tests for TokenUsagePage.
 *
 * Strategy:
 *  - Mock @backstage/core-plugin-api (useApi) and @backstage/core-components
 *    at the module level, matching the patterns in EntityCodeInsightContent.test.tsx.
 *  - Wrap renders in a MUI ThemeProvider so makeStyles() resolves.
 */
import '@testing-library/jest-dom';
import { createTheme, ThemeProvider } from '@material-ui/core/styles';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Module mocks — must come before component import
// ---------------------------------------------------------------------------

const mockApi = {
  getTokenUsage: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => ({
  useApi: () => mockApi,
  createApiRef: (config: { id: string }) => ({ id: config.id }),
}));

// Backstage core-components stubs — Page, Header, Content render children,
// Table renders a simple HTML table so we can assert on repo data.
jest.mock('@backstage/core-components', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="page">{children}</div>
  ),
  Header: ({ title, subtitle }: { title?: string; subtitle?: string }) => (
    <div data-testid="header" data-title={title} data-subtitle={subtitle}>
      {title}
    </div>
  ),
  Content: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="content">{children}</div>
  ),
  Progress: () => <div data-testid="progress" />,
  Table: ({ title, data, columns }: { title?: string; data?: any[]; columns?: any[] }) => (
    <div data-testid="backstage-table">
      {title && <div>{title}</div>}
      <table>
        <tbody>
          {(data ?? []).map((row: any, i: number) => (
            <tr key={i}>
              {(columns ?? []).map((col: any, j: number) => (
                <td key={j}>
                  {col.render ? col.render(row) : row[col.field]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  TableColumn: undefined,
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------
import { TokenUsagePage } from './TokenUsagePage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const theme = createTheme();

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <TokenUsagePage />
    </ThemeProvider>,
  );
}

const mockStats = {
  timeRange: '30d' as const,
  totalTokens: 1_234_567,
  totalEstimatedCost: 3.7,
  byModel: [
    { model: 'claude-sonnet-4-20250514', tokens: 1_000_000, estimatedCost: 3.0 },
    { model: 'llm', tokens: 234_567, estimatedCost: 0.7 },
  ],
  byRepo: [
    {
      repoId: 'org~my-repo',
      repoName: 'my-repo',
      ingestionTokens: 1_000_000,
      qnaTokens: 234_567,
      totalTokens: 1_234_567,
      estimatedCost: 3.7,
      lastActivity: new Date().toISOString(),
    },
  ],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getTokenUsage.mockResolvedValue(mockStats);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenUsagePage', () => {
  it('renders summary cards with formatted values', async () => {
    renderPage();
    await waitFor(() => {
      // "1.2M" appears in both the summary card and the repo table — assert at least one
      expect(screen.getAllByText('1.2M').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('$3.70').length).toBeGreaterThanOrEqual(1);
      // Active repos count — use a custom matcher to target the statValue element
      expect(screen.getByText((content, element) =>
        content === '1' && element?.className?.includes('statValue') === true,
      )).toBeInTheDocument();
    });
  });

  it('renders model breakdown table', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument();
      expect(screen.getByText('llm')).toBeInTheDocument();
    });
  });

  it('renders repo usage table', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument();
    });
  });

  it('fetches with default 30d range', async () => {
    renderPage();
    await waitFor(() => {
      expect(mockApi.getTokenUsage).toHaveBeenCalledWith('30d');
    });
  });

  it('re-fetches when time range changes', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('1.2M').length).toBeGreaterThanOrEqual(1));

    const emptyStats = { ...mockStats, totalTokens: 0, byModel: [], byRepo: [] };
    mockApi.getTokenUsage.mockResolvedValue(emptyStats);

    const sevenDayButton = screen.getByText('Last 7 days');
    fireEvent.click(sevenDayButton);

    await waitFor(() => {
      expect(mockApi.getTokenUsage).toHaveBeenCalledWith('7d');
    });
  });

  it('shows error message on API failure', async () => {
    mockApi.getTokenUsage.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('shows loading indicator while fetching', async () => {
    let resolveFetch: (value: typeof mockStats) => void;
    mockApi.getTokenUsage.mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      }),
    );
    renderPage();
    expect(screen.getByTestId('progress')).toBeInTheDocument();
    resolveFetch!(mockStats);
    await waitFor(() => {
      expect(screen.queryByTestId('progress')).not.toBeInTheDocument();
    });
  });

  it('clears stale stats when a fetch fails', async () => {
    mockApi.getTokenUsage.mockResolvedValue(mockStats);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('1.2M').length).toBeGreaterThanOrEqual(1));

    mockApi.getTokenUsage.mockRejectedValue(new Error('Backend exploded'));
    const sevenDayButton = screen.getByText('Last 7 days');
    fireEvent.click(sevenDayButton);

    await waitFor(() => {
      expect(screen.getByText(/Backend exploded/)).toBeInTheDocument();
    });
    expect(screen.queryByText('1.2M')).not.toBeInTheDocument();
  });

  it('renders the page header with title', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Token Usage')).toBeInTheDocument();
    });
  });

  it('renders time range toggle buttons', async () => {
    renderPage();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('All time')).toBeInTheDocument();
  });

  it('renders stat labels', async () => {
    renderPage();
    await waitFor(() => {
      // "Total Tokens" and "Estimated Cost" appear in both summary cards and repo table columns
      expect(screen.getAllByText('Total Tokens').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Estimated Cost').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Active Repos')).toBeInTheDocument();
    });
  });
});
