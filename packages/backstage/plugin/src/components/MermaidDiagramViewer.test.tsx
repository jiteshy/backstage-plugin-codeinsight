/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { createTheme, ThemeProvider } from '@material-ui/core/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mermaid mock — must be declared before any import that triggers the module
// ---------------------------------------------------------------------------

const mockRender = jest.fn();
const mockInitialize = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

// ---------------------------------------------------------------------------
// Browser API mocks
// ---------------------------------------------------------------------------

const mockWriteText = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText },
  writable: true,
  configurable: true,
});

const mockSerializeToString = jest.fn().mockReturnValue('<svg>mocked</svg>');
(global as any).XMLSerializer = jest.fn().mockImplementation(() => ({
  serializeToString: mockSerializeToString,
}));

const mockCreateObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test-id');
const mockRevokeObjectURL = jest.fn();
Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

// ---------------------------------------------------------------------------
// Import component AFTER mocks are in place
// ---------------------------------------------------------------------------

// We import after mocks so the module-level `mermaidInitialized` flag starts
// fresh for the test run. Individual tests reset it by clearing mock state.
import { MermaidDiagramViewer } from './MermaidDiagramViewer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const theme = createTheme();

function renderViewer(props: Partial<React.ComponentProps<typeof MermaidDiagramViewer>> = {}) {
  const defaults: React.ComponentProps<typeof MermaidDiagramViewer> = {
    id: 'test-diagram',
    mermaid: 'graph TD\n  A --> B',
    ...props,
  };
  return render(
    <ThemeProvider theme={theme}>
      <MermaidDiagramViewer {...defaults} />
    </ThemeProvider>,
  );
}

/** Build an SVG element containing .node elements with specific text labels. */
function buildSvgWithNodes(labels: string[]): string {
  const nodes = labels
    .map(
      label =>
        `<g class="node"><g class="label"><text>${label}</text></g></g>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg">${nodes}</svg>`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default: render succeeds and returns SVG
  mockRender.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>' });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MermaidDiagramViewer', () => {
  // ── 1. Loading state ───────────────────────────────────────────────────

  describe('initial loading state', () => {
    it('renders the control bar immediately before mermaid resolves', () => {
      // Keep the mermaid render promise pending so we can observe the pre-render state
      let resolveRender!: (value: { svg: string }) => void;
      mockRender.mockReturnValue(new Promise(res => { resolveRender = res; }));

      renderViewer();

      // Control bar buttons are visible immediately (no waiting)
      expect(screen.getByTitle('Zoom in')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom out')).toBeInTheDocument();
      expect(screen.getByTitle('Reset view')).toBeInTheDocument();

      // The SVG wrapper div is present but empty (no SVG injected yet)
      const wrapperDivs = document.querySelectorAll('div');
      const svgWrapper = Array.from(wrapperDivs).find(
        div => div.style.transform?.includes('scale'),
      );
      expect(svgWrapper).toBeInTheDocument();
      expect(svgWrapper?.querySelector('svg')).toBeNull();

      // Clean up the pending promise to avoid act() warnings
      act(() => { resolveRender({ svg: '<svg/>' }); });
    });
  });

  // ── 2. Successful render ───────────────────────────────────────────────

  describe('successful render', () => {
    it('injects the returned SVG into the container div', async () => {
      const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
      mockRender.mockResolvedValue({ svg: svgMarkup });

      renderViewer();

      await waitFor(() => {
        expect(document.querySelector('svg')).toBeInTheDocument();
      });

      // The injected SVG element should be present in the DOM
      const svgEl = document.querySelector('svg');
      expect(svgEl).not.toBeNull();
    });

    it('calls mermaid.render with a sanitized id derived from the prop', async () => {
      renderViewer({ id: 'my diagram/123' });

      await waitFor(() => expect(mockRender).toHaveBeenCalled());

      // The svgId passed to mermaid.render should only contain [a-zA-Z0-9-]
      const [svgId] = mockRender.mock.calls[0] as [string, string];
      expect(svgId).toMatch(/^mermaid-[a-zA-Z0-9-]+$/);
    });

    it('passes the mermaid source string to mermaid.render', async () => {
      const source = 'graph LR\n  X --> Y';
      renderViewer({ mermaid: source });

      await waitFor(() => expect(mockRender).toHaveBeenCalled());

      const [, passedSource] = mockRender.mock.calls[0] as [string, string];
      expect(passedSource).toBe(source);
    });

    it('does not show an error message on successful render', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.queryByText('Failed to render diagram')).not.toBeInTheDocument();
    });
  });

  // ── 3. Error state ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('shows error message when mermaid.render throws', async () => {
      mockRender.mockRejectedValue(new Error('Parse error: unexpected token'));

      renderViewer({ mermaid: 'invalid mermaid %%' });

      await waitFor(() => {
        expect(screen.getByText('Failed to render diagram')).toBeInTheDocument();
      });
    });

    it('shows the original mermaid source in the error box', async () => {
      const badSource = 'this is not valid mermaid syntax';
      mockRender.mockRejectedValue(new Error('Syntax error'));

      renderViewer({ mermaid: badSource });

      await waitFor(() => {
        expect(screen.getByText(badSource)).toBeInTheDocument();
      });
    });

    it('does not render the control bar in the error state', async () => {
      mockRender.mockRejectedValue(new Error('Render failed'));

      renderViewer();

      await waitFor(() => {
        expect(screen.getByText('Failed to render diagram')).toBeInTheDocument();
      });

      expect(screen.queryByTitle('Zoom in')).not.toBeInTheDocument();
    });
  });

  // ── 4. Control bar buttons ─────────────────────────────────────────────

  describe('control bar', () => {
    it('renders all expected control buttons', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.getByTitle('Zoom in')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom out')).toBeInTheDocument();
      expect(screen.getByTitle('Reset view')).toBeInTheDocument();
      expect(screen.getByTitle('Fullscreen')).toBeInTheDocument();
      expect(screen.getByTitle('Download SVG')).toBeInTheDocument();
    });

    it('displays the zoom percentage label starting at 100%', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('updates zoom label when zoom in button is clicked', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Zoom in'));

      // After one click the zoom should be 1.1 = 110%
      expect(screen.getByText('110%')).toBeInTheDocument();
    });

    it('updates zoom label when zoom out button is clicked', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Zoom out'));

      // After one click the zoom should be 0.9 = 90%
      expect(screen.getByText('90%')).toBeInTheDocument();
    });

    it('resets zoom to 100% when reset button is clicked after zooming in', async () => {
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Zoom in'));
      fireEvent.click(screen.getByTitle('Zoom in'));
      expect(screen.getByText('120%')).toBeInTheDocument();

      fireEvent.click(screen.getByTitle('Reset view'));
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  // ── 5. Fullscreen button & dialog ──────────────────────────────────────

  describe('fullscreen', () => {
    it('opens the fullscreen dialog when fullscreen button is clicked', async () => {
      renderViewer({ title: 'My Diagram' });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.queryByTitle('Close fullscreen')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTitle('Fullscreen'));

      await waitFor(() => {
        expect(screen.getByTitle('Close fullscreen')).toBeInTheDocument();
      });
    });

    it('closes the fullscreen dialog when close button is clicked', async () => {
      renderViewer({ title: 'My Diagram' });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Fullscreen'));
      await waitFor(() => expect(screen.getByTitle('Close fullscreen')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Close fullscreen'));

      await waitFor(() => {
        expect(screen.queryByTitle('Close fullscreen')).not.toBeInTheDocument();
      });
    });

    it('shows the diagram title inside the fullscreen dialog header', async () => {
      renderViewer({ title: 'Architecture Overview' });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Fullscreen'));

      await waitFor(() => {
        // Title should appear in the dialog header (may appear multiple times, just assert presence)
        expect(screen.getAllByText('Architecture Overview').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows AI chip when llmUsed=true in fullscreen header', async () => {
      renderViewer({ llmUsed: true });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Fullscreen'));

      await waitFor(() => {
        expect(screen.getAllByText('AI').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows AST chip when llmUsed=false in fullscreen header', async () => {
      renderViewer({ llmUsed: false });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Fullscreen'));

      await waitFor(() => {
        expect(screen.getAllByText('AST').length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── 6. showFullscreenButton=false ─────────────────────────────────────

  describe('showFullscreenButton prop', () => {
    it('hides the fullscreen button when showFullscreenButton=false', async () => {
      renderViewer({ showFullscreenButton: false });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.queryByTitle('Fullscreen')).not.toBeInTheDocument();
    });

    it('still shows other control buttons when fullscreen is hidden', async () => {
      renderViewer({ showFullscreenButton: false });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      expect(screen.getByTitle('Zoom in')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom out')).toBeInTheDocument();
      expect(screen.getByTitle('Reset view')).toBeInTheDocument();
      expect(screen.getByTitle('Download SVG')).toBeInTheDocument();
    });

    it('does not render the Dialog element when showFullscreenButton=false', async () => {
      const { container } = renderViewer({ showFullscreenButton: false });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      // MUI Dialog renders a Portal; with fullscreen hidden, clicking does nothing.
      // Simply assert the fullscreen trigger is absent — the dialog cannot open.
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  // ── 7. SVG download ────────────────────────────────────────────────────

  describe('download SVG', () => {
    it('calls XMLSerializer.serializeToString with the rendered SVG element', async () => {
      mockRender.mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="content"/></svg>',
      });

      renderViewer({ id: 'dep-graph', title: 'Dependency Graph' });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Download SVG'));

      expect(mockSerializeToString).toHaveBeenCalledTimes(1);
      const [serializedEl] = mockSerializeToString.mock.calls[0] as [Element];
      expect(serializedEl.tagName.toLowerCase()).toBe('svg');
    });

    it('calls URL.createObjectURL to create a download link', async () => {
      renderViewer({ title: 'My Chart' });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Download SVG'));

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const [blob] = mockCreateObjectURL.mock.calls[0] as [Blob];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/svg+xml');
    });

    it('does nothing when no SVG is present in the container', async () => {
      // Simulate a pending render — keep the promise unresolved so no SVG is injected
      let resolveRender!: (value: { svg: string }) => void;
      mockRender.mockReturnValue(new Promise(res => { resolveRender = res; }));

      renderViewer();

      // Click download before render completes
      fireEvent.click(screen.getByTitle('Download SVG'));

      expect(mockSerializeToString).not.toHaveBeenCalled();
      expect(mockCreateObjectURL).not.toHaveBeenCalled();

      // Cleanup
      act(() => { resolveRender({ svg: '<svg/>' }); });
    });
  });

  // ── 8. Clickable node wiring ───────────────────────────────────────────

  describe('clickable node wiring', () => {
    const nodeMap = {
      'UserService': 'src/services/UserService.ts',
      'AuthController': 'src/controllers/AuthController.ts',
    };

    it('copies the file path to clipboard when a matching node is clicked', async () => {
      const svgWithNodes = buildSvgWithNodes(['UserService', 'AuthController', 'UnmappedNode']);
      mockRender.mockResolvedValue({ svg: svgWithNodes });

      renderViewer({ nodeMap });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      // Allow the clickable-node wiring effect to run (it depends on renderDone state)
      await waitFor(() => {
        const nodeEls = document.querySelectorAll('.node');
        // At least the two mapped nodes should have cursor:pointer
        const clickableNodes = Array.from(nodeEls).filter(
          el => (el as HTMLElement).style.cursor === 'pointer',
        );
        expect(clickableNodes.length).toBe(2);
      });

      const nodeEls = document.querySelectorAll('.node');
      const userServiceNode = Array.from(nodeEls).find(el =>
        el.textContent?.includes('UserService'),
      ) as HTMLElement;

      fireEvent.click(userServiceNode);

      expect(mockWriteText).toHaveBeenCalledWith('src/services/UserService.ts');
    });

    it('shows a toast message after clicking a mapped node', async () => {
      const svgWithNodes = buildSvgWithNodes(['UserService']);
      mockRender.mockResolvedValue({ svg: svgWithNodes });

      renderViewer({ nodeMap });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      await waitFor(() => {
        const nodeEls = document.querySelectorAll('.node');
        const clickable = Array.from(nodeEls).find(
          el => (el as HTMLElement).style.cursor === 'pointer',
        );
        expect(clickable).toBeTruthy();
      });

      const nodeEl = document.querySelector('.node') as HTMLElement;
      fireEvent.click(nodeEl);

      await waitFor(() => {
        expect(screen.getByText('Copied: src/services/UserService.ts')).toBeInTheDocument();
      });
    });

    it('does not make unmapped nodes clickable', async () => {
      const svgWithNodes = buildSvgWithNodes(['UserService', 'UnmappedNode']);
      mockRender.mockResolvedValue({ svg: svgWithNodes });

      renderViewer({ nodeMap });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      await waitFor(() => {
        const clickableNodes = Array.from(document.querySelectorAll('.node')).filter(
          el => (el as HTMLElement).style.cursor === 'pointer',
        );
        expect(clickableNodes.length).toBe(1);
      });

      const allNodes = Array.from(document.querySelectorAll('.node'));
      const unmappedNode = allNodes.find(el =>
        el.textContent?.includes('UnmappedNode'),
      ) as HTMLElement;

      expect(unmappedNode.style.cursor).not.toBe('pointer');
    });

    it('does not wire any nodes when nodeMap is not provided', async () => {
      const svgWithNodes = buildSvgWithNodes(['UserService']);
      mockRender.mockResolvedValue({ svg: svgWithNodes });

      // No nodeMap prop
      renderViewer();

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      const nodeEl = document.querySelector('.node') as HTMLElement;
      fireEvent.click(nodeEl);

      expect(mockWriteText).not.toHaveBeenCalled();
    });

    it('does not wire any nodes when nodeMap is null', async () => {
      const svgWithNodes = buildSvgWithNodes(['UserService']);
      mockRender.mockResolvedValue({ svg: svgWithNodes });

      renderViewer({ nodeMap: null });

      await waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument());

      const allNodes = Array.from(document.querySelectorAll('.node'));
      const anyClickable = allNodes.some(
        el => (el as HTMLElement).style.cursor === 'pointer',
      );
      expect(anyClickable).toBe(false);
    });
  });

  // ── 9. Re-render on prop change ────────────────────────────────────────

  describe('re-render on prop change', () => {
    it('re-calls mermaid.render when the mermaid source prop changes', async () => {
      const { rerender } = renderViewer({ mermaid: 'graph TD\n  A --> B' });
      await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));

      const newSource = 'graph LR\n  X --> Y --> Z';

      rerender(
        <ThemeProvider theme={theme}>
          <MermaidDiagramViewer
            id="test-diagram"
            mermaid={newSource}
          />
        </ThemeProvider>,
      );

      await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));

      const [, secondSource] = mockRender.mock.calls[1] as [string, string];
      expect(secondSource).toBe(newSource);
    });
  });
});
