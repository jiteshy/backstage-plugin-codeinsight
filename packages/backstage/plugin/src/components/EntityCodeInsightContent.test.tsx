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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  createQnASession: jest.fn().mockResolvedValue({ sessionId: 'sess-test' }),
  askQnAStream: jest.fn().mockResolvedValue([]),
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
// Import component and helpers AFTER all mocks
// ---------------------------------------------------------------------------
import {
  EntityCodeInsightContent,
  stripSourceRefs,
  buildGitHubFileUrl,
  nextMsgId,
} from './EntityCodeInsightContent';

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

// JSDOM does not implement scrollIntoView — stub it globally so effects that
// call el.scrollIntoView() (e.g. the QnA messages scroll-to-bottom effect)
// do not throw.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

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

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

describe('stripSourceRefs', () => {
  it('removes a single [source:N] reference', () => {
    expect(stripSourceRefs('See [source:1] for details.')).toBe('See for details.');
  });

  it('removes multiple [source:N] references', () => {
    expect(stripSourceRefs('See [source:1] and [source:42] here.')).toBe(
      'See and here.',
    );
  });

  it('collapses consecutive spaces left by removal', () => {
    // After removing [source:1] from "foo [source:1] bar" there are two spaces; they should become one.
    expect(stripSourceRefs('foo [source:1] bar')).toBe('foo bar');
  });

  it('is case-insensitive for the SOURCE keyword', () => {
    // The regex is /gi so uppercase variants are stripped; surrounding spaces remain
    // subject to the double-space collapse rule.
    expect(stripSourceRefs('foo [SOURCE:3] bar')).toBe('foo bar');
    expect(stripSourceRefs('foo [Source:7] bar')).toBe('foo bar');
  });

  it('returns the input unchanged when there are no source refs', () => {
    const plain = 'This is regular text without any refs.';
    expect(stripSourceRefs(plain)).toBe(plain);
  });

  it('returns an empty string unchanged', () => {
    expect(stripSourceRefs('')).toBe('');
  });

  it('handles text that is only source refs', () => {
    // Leading space after removal gets collapsed but the result is non-empty whitespace;
    // we just verify it does not throw and refs are stripped.
    const result = stripSourceRefs('[source:1][source:2]');
    expect(result).not.toMatch(/\[source:\d+\]/i);
  });

  it('does not strip partial patterns that are not valid source refs', () => {
    expect(stripSourceRefs('[source:abc]')).toBe('[source:abc]');
    expect(stripSourceRefs('[sources:1]')).toBe('[sources:1]');
  });
});

// ---------------------------------------------------------------------------

describe('buildGitHubFileUrl', () => {
  it('builds a URL without a line anchor when startLine is omitted', () => {
    expect(buildGitHubFileUrl('https://github.com/org/repo', 'src/index.ts')).toBe(
      'https://github.com/org/repo/blob/HEAD/src/index.ts',
    );
  });

  it('appends the #L fragment when startLine is provided', () => {
    expect(buildGitHubFileUrl('https://github.com/org/repo', 'src/index.ts', 42)).toBe(
      'https://github.com/org/repo/blob/HEAD/src/index.ts#L42',
    );
  });

  it('normalises a trailing slash on the repoUrl', () => {
    expect(buildGitHubFileUrl('https://github.com/org/repo/', 'src/main.ts')).toBe(
      'https://github.com/org/repo/blob/HEAD/src/main.ts',
    );
  });

  it('normalises a trailing slash when startLine is also provided', () => {
    expect(buildGitHubFileUrl('https://github.com/org/repo/', 'lib/utils.ts', 10)).toBe(
      'https://github.com/org/repo/blob/HEAD/lib/utils.ts#L10',
    );
  });

  it('handles a nested file path correctly', () => {
    expect(
      buildGitHubFileUrl('https://github.com/org/repo', 'packages/core/src/graph/resolver.ts', 1),
    ).toBe(
      'https://github.com/org/repo/blob/HEAD/packages/core/src/graph/resolver.ts#L1',
    );
  });

  it('does not append #L0 when startLine is 0 (falsy)', () => {
    const url = buildGitHubFileUrl('https://github.com/org/repo', 'src/file.ts', 0);
    expect(url).not.toContain('#L');
  });
});

// ---------------------------------------------------------------------------

describe('nextMsgId', () => {
  it('returns a string that starts with the given prefix', () => {
    const id = nextMsgId('u');
    expect(id).toMatch(/^u-/);
  });

  it('returns unique IDs across successive calls', () => {
    const a = nextMsgId('u');
    const b = nextMsgId('u');
    expect(a).not.toBe(b);
  });

  it('includes the prefix in the returned id', () => {
    const id = nextMsgId('assistant');
    expect(id).toMatch(/^assistant-\d+$/);
  });

  it('generates strictly increasing numeric suffixes', () => {
    const id1 = nextMsgId('x');
    const id2 = nextMsgId('x');
    const num1 = parseInt(id1.split('-')[1], 10);
    const num2 = parseInt(id2.split('-')[1], 10);
    expect(num2).toBeGreaterThan(num1);
  });
});

// ---------------------------------------------------------------------------
// QnAContent component — rendered via the Q&A tab
// ---------------------------------------------------------------------------

describe('QnAContent', () => {
  // Navigate to the Q&A tab after rendering the full component.
  async function renderAndOpenQnATab() {
    renderContent();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Q&A' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Q&A' }));
  }

  // -------------------------------------------------------------------------
  // Session creation
  // -------------------------------------------------------------------------

  describe('session creation on mount', () => {
    it('calls createQnASession with the derived repoId when not first-run', async () => {
      // getDocs returns data so isFirstRun=false
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview',
          isStale: false,
          staleReason: null,
          fileCount: 1,
          generatedAt: '2024-01-01T00:00:00Z',
          tokensUsed: 100,
        },
      ]);
      mockApi.createQnASession.mockResolvedValue({ sessionId: 'sess-1' });

      await renderAndOpenQnATab();

      await waitFor(() => {
        expect(mockApi.createQnASession).toHaveBeenCalledWith('org-my-repo');
      });
    });

    it('does NOT call createQnASession when isFirstRun (docs empty)', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      await renderAndOpenQnATab();

      // Give a tick for any erroneous async calls to fire
      await waitFor(() => {
        expect(screen.getAllByText('Q&A not available yet').length).toBeGreaterThan(0);
      });

      expect(mockApi.createQnASession).not.toHaveBeenCalled();
    });

    it('renders the empty-chat prompt once the session is ready', async () => {
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview',
          isStale: false,
          staleReason: null,
          fileCount: 1,
          generatedAt: '2024-01-01T00:00:00Z',
          tokensUsed: 100,
        },
      ]);
      mockApi.createQnASession.mockResolvedValue({ sessionId: 'sess-ready' });

      await renderAndOpenQnATab();

      await waitFor(() => {
        expect(
          screen.getByText(/Ask a question about the codebase/i),
        ).toBeInTheDocument();
      });
    });

    it('shows a generic session error message when createQnASession rejects', async () => {
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview',
          isStale: false,
          staleReason: null,
          fileCount: 1,
          generatedAt: '2024-01-01T00:00:00Z',
          tokensUsed: 100,
        },
      ]);
      mockApi.createQnASession.mockRejectedValue(new Error('Network error'));

      await renderAndOpenQnATab();

      await waitFor(() => {
        expect(screen.getByText(/Failed to start Q&A session/i)).toBeInTheDocument();
      });
    });

    it('shows a friendly message when QnA service is not configured', async () => {
      mockApi.getDocs.mockResolvedValue([
        {
          artifactId: 'overview',
          markdown: '# Overview',
          isStale: false,
          staleReason: null,
          fileCount: 1,
          generatedAt: '2024-01-01T00:00:00Z',
          tokensUsed: 100,
        },
      ]);
      mockApi.createQnASession.mockRejectedValue(new Error('QnA service not configured'));

      await renderAndOpenQnATab();

      await waitFor(() => {
        expect(
          screen.getByText(/administrator needs to configure LLM and embedding services/i),
        ).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // First-run state
  // -------------------------------------------------------------------------

  describe('when isFirstRun (docs empty)', () => {
    it('renders the Q&A not available yet empty state instead of the chat UI', async () => {
      mockApi.getDocs.mockResolvedValue([]);

      await renderAndOpenQnATab();

      await waitFor(() => {
        expect(screen.getAllByText('Q&A not available yet').length).toBeGreaterThan(0);
      });
      expect(screen.queryByPlaceholderText(/Ask a question/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Sending a message
  // -------------------------------------------------------------------------

  describe('sending a message', () => {
    const docFixture = [
      {
        artifactId: 'overview',
        markdown: '# Overview',
        isStale: false,
        staleReason: null,
        fileCount: 1,
        generatedAt: '2024-01-01T00:00:00Z',
        tokensUsed: 100,
      },
    ];

    beforeEach(() => {
      mockApi.getDocs.mockResolvedValue(docFixture);
      mockApi.createQnASession.mockResolvedValue({ sessionId: 'sess-send' });
    });

    it('adds a user message bubble after clicking Send', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      // Wait for the input to become enabled (session ready)
      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'How does auth work?' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText('How does auth work?')).toBeInTheDocument();
      });
    });

    it('adds an assistant message bubble after streaming completes', async () => {
      // Simulate onToken being called once, then resolving with no sources
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('Authentication uses JWT.');
          return [];
        },
      );

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'How does auth work?' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        // MarkdownContent stub renders the stripped text directly
        expect(screen.getByText('Authentication uses JWT.')).toBeInTheDocument();
      });
    });

    it('calls askQnAStream with the correct repoId, sessionId, and question', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'What is the architecture?' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(mockApi.askQnAStream).toHaveBeenCalledWith(
          'org-my-repo',
          'sess-send',
          'What is the architecture?',
          expect.any(Function),
        );
      });
    });

    it('clears the input field after sending', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Tell me something.' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect((input as HTMLInputElement).value).toBe('');
      });
    });

    it('sends on Enter key without Shift', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Enter key question' } });
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(screen.getByText('Enter key question')).toBeInTheDocument();
      });
    });

    it('does NOT send on Shift+Enter', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'multiline draft' } });
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

      // askQnAStream should not be called — no message bubble added
      expect(mockApi.askQnAStream).not.toHaveBeenCalled();
    });

    it('does NOT send when the input is blank', async () => {
      mockApi.askQnAStream.mockResolvedValue([]);

      await renderAndOpenQnATab();

      // Send button should be disabled when input is empty
      const sendBtn = await screen.findByRole('button', { name: /Send/i });
      expect(sendBtn).toBeDisabled();
    });

    it('displays an error message in the assistant bubble when askQnAStream rejects', async () => {
      mockApi.askQnAStream.mockRejectedValue(new Error('LLM timeout'));

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Will this fail?' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText(/Error:.*LLM timeout/i)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Source cards
  // -------------------------------------------------------------------------

  describe('source cards', () => {
    const docFixture = [
      {
        artifactId: 'overview',
        markdown: '# Overview',
        isStale: false,
        staleReason: null,
        fileCount: 1,
        generatedAt: '2024-01-01T00:00:00Z',
        tokensUsed: 100,
      },
    ];

    beforeEach(() => {
      mockApi.getDocs.mockResolvedValue(docFixture);
      mockApi.createQnASession.mockResolvedValue({ sessionId: 'sess-src' });
    });

    it('renders source cards with file paths after the assistant message settles', async () => {
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('Auth uses JWT.');
          return [
            { filePath: 'src/auth/jwt.ts', startLine: 12, symbol: 'JwtService' },
          ];
        },
      );

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Explain auth' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText('src/auth/jwt.ts')).toBeInTheDocument();
      });
    });

    it('renders the Sources count label', async () => {
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('Some answer.');
          return [
            { filePath: 'src/a.ts', startLine: 1 },
            { filePath: 'src/b.ts', startLine: 2 },
          ];
        },
      );

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Give me sources' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText('Sources (2)')).toBeInTheDocument();
      });
    });

    it('source card links point to the correct GitHub blob URL', async () => {
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('Answer.');
          return [
            { filePath: 'src/service.ts', startLine: 5 },
          ];
        },
      );

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Any question' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        const link = screen.getByText('src/service.ts').closest('a');
        expect(link).toHaveAttribute(
          'href',
          'https://github.com/org/my-repo/blob/HEAD/src/service.ts#L5',
        );
      });
    });

    it('does not render the Sources section when sources array is empty', async () => {
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('No sources answer.');
          return [];
        },
      );

      await renderAndOpenQnATab();

      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'Question without sources' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText('No sources answer.')).toBeInTheDocument();
      });
      expect(screen.queryByText(/^Sources \(/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // "New conversation" button
  // -------------------------------------------------------------------------

  describe('"New conversation" button', () => {
    const docFixture = [
      {
        artifactId: 'overview',
        markdown: '# Overview',
        isStale: false,
        staleReason: null,
        fileCount: 1,
        generatedAt: '2024-01-01T00:00:00Z',
        tokensUsed: 100,
      },
    ];

    beforeEach(() => {
      mockApi.getDocs.mockResolvedValue(docFixture);
    });

    it('creates a new session and clears messages when clicked', async () => {
      mockApi.createQnASession
        .mockResolvedValueOnce({ sessionId: 'sess-a' })
        .mockResolvedValueOnce({ sessionId: 'sess-b' });
      mockApi.askQnAStream.mockImplementation(
        async (_repoId, _sessionId, _question, onToken) => {
          onToken('First answer.');
          return [];
        },
      );

      await renderAndOpenQnATab();

      // Send a message to populate the chat
      const input = await screen.findByPlaceholderText(/Ask a question/i);
      fireEvent.change(input, { target: { value: 'First question' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));

      await waitFor(() => {
        expect(screen.getByText('First answer.')).toBeInTheDocument();
      });

      // Click "New conversation"
      fireEvent.click(screen.getByRole('button', { name: /New conversation/i }));

      await waitFor(() => {
        // createQnASession called a second time for the new session
        expect(mockApi.createQnASession).toHaveBeenCalledTimes(2);
      });

      // Prior messages should no longer be visible
      expect(screen.queryByText('First answer.')).not.toBeInTheDocument();
      expect(screen.queryByText('First question')).not.toBeInTheDocument();
    });

    it('shows a session error when the new-conversation createQnASession call rejects', async () => {
      mockApi.createQnASession
        .mockResolvedValueOnce({ sessionId: 'sess-ok' })
        .mockRejectedValueOnce(new Error('Service down'));

      await renderAndOpenQnATab();

      // Wait for session to be ready
      await screen.findByPlaceholderText(/Ask a question/i);

      fireEvent.click(screen.getByRole('button', { name: /New conversation/i }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to start Q&A session/i)).toBeInTheDocument();
      });
    });
  });
});
