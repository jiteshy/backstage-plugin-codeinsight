/**
 * @jest-environment jsdom
 *
 * Unit tests for EntityCodeInsightContent.
 *
 * Strategy:
 *  - Mock @backstage/core-plugin-api (useApi) and @backstage/plugin-catalog-react
 *    (useEntity) at the module level to inject controlled entity fixtures and API
 *    mocks without needing a full Backstage application context.
 *  - Mock @backstage/core-components so that InfoCard and MarkdownContent render
 *    plain divs — they depend on app context and theme providers that are not
 *    available in this test environment.
 *  - Mock ./MermaidDiagramViewer to avoid mermaid initialisation in JSDOM.
 *  - Wrap each render in a MUI ThemeProvider so makeStyles() resolves.
 */
import '@testing-library/jest-dom';
import { createTheme, ThemeProvider } from '@material-ui/core/styles';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Backstage module mocks — must come before any component import
// ---------------------------------------------------------------------------

// useEntity: returns a controlled entity. Tests can override entityAnnotations.
let entityAnnotations: Record<string, string> = {
  'github.com/project-slug': 'org/my-repo',
};

jest.mock('@backstage/plugin-catalog-react', () => ({
  useEntity: () => ({
    entity: {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-repo',
        annotations: entityAnnotations,
      },
    },
  }),
}));

// useApi: returns a controlled CodeInsightApi mock.
// Tests replace mockApiImpl methods per-describe block.
const mockApi = {
  triggerIngestion: jest.fn(),
  getJobStatus: jest.fn(),
  getRepoStatus: jest.fn().mockResolvedValue({}),
  getDocs: jest.fn().mockResolvedValue([]),
  getDiagrams: jest.fn().mockResolvedValue([]),
};

jest.mock('@backstage/core-plugin-api', () => ({
  useApi: () => mockApi,
  // createApiRef is called at module level in api.ts — return a stable stub object
  createApiRef: (config: { id: string }) => ({ id: config.id }),
}));

// @backstage/core-components: render pass-through stubs for InfoCard and
// MarkdownContent so we can check child content without app context.
jest.mock('@backstage/core-components', () => ({
  InfoCard: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <div data-testid="info-card" data-title={title}>
      {children}
    </div>
  ),
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

// MermaidDiagramViewer: lightweight stub — avoids mermaid JSDOM issues.
jest.mock('./MermaidDiagramViewer', () => ({
  MermaidDiagramViewer: ({ id }: { id: string }) => (
    <div data-testid={`mermaid-viewer-${id}`}>diagram</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks
// ---------------------------------------------------------------------------
import { EntityCodeInsightContent } from './EntityCodeInsightContent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const theme = createTheme();

function renderContent() {
  return render(
    <ThemeProvider theme={theme}>
      <EntityCodeInsightContent />
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Restore sane defaults before each test
  entityAnnotations = { 'github.com/project-slug': 'org/my-repo' };
  mockApi.getRepoStatus.mockResolvedValue({});
  mockApi.getDocs.mockResolvedValue([]);
  mockApi.getDiagrams.mockResolvedValue([]);
  mockApi.triggerIngestion.mockResolvedValue({ jobId: 'job-1' });
  mockApi.getJobStatus.mockResolvedValue({ status: 'completed', filesProcessed: 0 });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityCodeInsightContent', () => {
  // -------------------------------------------------------------------------
  // Missing annotation guard
  // -------------------------------------------------------------------------

  describe('when github.com/project-slug annotation is absent', () => {
    it('renders the missing-annotation message and no action button', async () => {
      entityAnnotations = {};
      renderContent();

      await waitFor(() => {
        expect(screen.getByText(/No GitHub annotation found/)).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Discover Insights/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Sync Changes/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Action button label: "Discover Insights" vs "Sync Changes"
  // -------------------------------------------------------------------------

  describe('action button label', () => {
    it('shows "Discover Insights" contained button when getDocs returns an empty array (first run)', async () => {
      mockApi.getDocs.mockResolvedValue([]);
      mockApi.getDiagrams.mockResolvedValue([]);

      renderContent();

      // Wait for both async effects to settle (docs loaded = empty array)
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /Discover Insights/i });
        expect(btn).toBeInTheDocument();
      });

      // Confirm the button has `contained` variant by checking MUI class
      const btn = screen.getByRole('button', { name: /Discover Insights/i });
      expect(btn.className).toMatch(/contained/i);
    });

    it('shows "Sync Changes" outlined button when getDocs returns at least one section', async () => {
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview\nSome content.',
          isStale: false,
          staleReason: null,
          fileCount: 3,
          generatedAt: '2024-06-01T10:00:00.000Z',
          tokensUsed: 300,
        },
      ]);
      mockApi.getDiagrams.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /Sync Changes/i });
        expect(btn).toBeInTheDocument();
      });

      const btn = screen.getByRole('button', { name: /Sync Changes/i });
      expect(btn.className).toMatch(/outlined/i);
    });

    it('does not show "Sync Changes" when docs are empty', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Discover Insights/i })).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Sync Changes/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // FirstRunEmptyState — Documentation tab
  // -------------------------------------------------------------------------

  describe('FirstRunEmptyState on the Documentation tab', () => {
    it('renders the three feature pills when docs and diagrams are both empty', async () => {
      mockApi.getDocs.mockResolvedValue([]);
      mockApi.getDiagrams.mockResolvedValue([]);

      renderContent();

      // Wait until the empty-state is visible (docs loaded)
      await waitFor(() => {
        expect(screen.getByText('Docs')).toBeInTheDocument();
      });

      expect(screen.getByText('Architecture Diagrams')).toBeInTheDocument();
      // "Q&A" also appears as the tab label — assert at least one instance is present
      expect(screen.getAllByText('Q&A').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the "No documentation yet" heading in the empty state', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(screen.getByText('No documentation yet')).toBeInTheDocument();
      });
    });

    it('renders the description blurb prompting the user to run analysis', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(
          screen.getByText(/Run a full repository analysis/i),
        ).toBeInTheDocument();
      });
    });

    it('renders the "Use the button above to get started" caption', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(
          screen.getByText(/Use the button above to get started/i),
        ).toBeInTheDocument();
      });
    });

    it('does not render the FirstRunEmptyState when docs has content', async () => {
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview\nSome content.',
          isStale: false,
          staleReason: null,
          fileCount: 3,
          generatedAt: '2024-06-01T10:00:00.000Z',
          tokensUsed: 300,
        },
      ]);

      renderContent();

      await waitFor(() => {
        // Docs tab should show the section content, not the empty state
        expect(screen.queryByText('No documentation yet')).not.toBeInTheDocument();
      });

      expect(screen.queryByText('Docs')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // API calls — correct arguments
  // -------------------------------------------------------------------------

  describe('API call wiring', () => {
    it('calls getDocs with the derived repoId (slashes replaced by dashes)', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(mockApi.getDocs).toHaveBeenCalledWith('org-my-repo');
      });
    });

    it('calls getDiagrams with the derived repoId', async () => {
      mockApi.getDiagrams.mockResolvedValue([]);

      renderContent();

      await waitFor(() => {
        expect(mockApi.getDiagrams).toHaveBeenCalledWith('org-my-repo');
      });
    });

    it('calls getRepoStatus with the derived repoId', async () => {
      renderContent();

      await waitFor(() => {
        expect(mockApi.getRepoStatus).toHaveBeenCalledWith('org-my-repo');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('when getDocs rejects', () => {
    it('shows the docs load error message', async () => {
      mockApi.getDocs.mockRejectedValue(new Error('Failed to get docs: Internal Server Error'));

      renderContent();

      await waitFor(() => {
        expect(screen.getByText(/Failed to load documentation/i)).toBeInTheDocument();
      });
    });
  });

  describe('when getDiagrams rejects', () => {
    it('does not crash and still renders the header section', async () => {
      mockApi.getDocs.mockResolvedValue([]);
      mockApi.getDiagrams.mockRejectedValue(new Error('Failed to get diagrams: Internal Server Error'));

      renderContent();

      // Header always renders regardless of diagram fetch errors
      await waitFor(() => {
        expect(screen.getByText('Code Insights')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Header content
  // -------------------------------------------------------------------------

  describe('header', () => {
    it('renders the "Code Insights" title', async () => {
      renderContent();

      await waitFor(() => {
        expect(screen.getByText('Code Insights')).toBeInTheDocument();
      });
    });

    it('renders the plugin description', async () => {
      renderContent();

      await waitFor(() => {
        expect(screen.getByText(/Turns your repository into living knowledge/i)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inner tabs
  // -------------------------------------------------------------------------

  describe('inner tabs', () => {
    it('renders Documentation, Diagrams, and Q&A tabs', async () => {
      renderContent();

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Documentation' })).toBeInTheDocument();
      });

      expect(screen.getByRole('tab', { name: 'Diagrams' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Q&A' })).toBeInTheDocument();
    });
  });
});
