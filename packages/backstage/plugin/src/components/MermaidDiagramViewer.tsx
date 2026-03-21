/**
 * MermaidDiagramViewer — self-contained diagram rendering component.
 *
 * Features:
 *   - Mermaid SVG rendering (lazy-loaded)
 *   - Zoom via mouse wheel (10% per tick, clamped [0.3, 3.0])
 *   - Pan via drag (mouse down + move)
 *   - Control panel: zoom+, zoom−, reset, fullscreen, download SVG
 *   - Fullscreen via MUI Dialog (standalone zoom/pan state)
 *   - Clickable nodes: matches .node elements against nodeMap keys,
 *     copies file path to clipboard + shows toast
 *   - SVG download as {title}-{timestamp}.svg
 */
import Box from '@material-ui/core/Box';
import Chip from '@material-ui/core/Chip';
import Dialog from '@material-ui/core/Dialog';
import IconButton from '@material-ui/core/IconButton';
import { makeStyles } from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Module-level mermaid init flag (shared across all viewer instances)
// ---------------------------------------------------------------------------

let mermaidInitialized = false;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles(theme => ({
  viewerRoot: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  controlBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '2px 6px',
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
    flexShrink: 0,
  },
  controlBtn: {
    width: 26,
    height: 26,
    fontSize: '0.9rem',
    fontWeight: 600,
    padding: 0,
    flexShrink: 0,
    lineHeight: 1,
  },
  zoomLabel: {
    fontSize: '0.68rem',
    color: theme.palette.text.disabled,
    minWidth: 34,
    textAlign: 'center' as const,
    userSelect: 'none' as const,
  },
  controlSep: {
    width: 1,
    height: 16,
    backgroundColor: theme.palette.divider,
    margin: '0 4px',
    flexShrink: 0,
  },
  zoomContainer: {
    overflow: 'hidden',
    background: theme.palette.type === 'dark' ? '#1e1e1e' : '#fafafa',
    borderRadius: 4,
    flex: 1,
    minHeight: 120,
    cursor: 'grab',
    '&:active': { cursor: 'grabbing' },
    userSelect: 'none' as const,
  },
  svgWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    transformOrigin: 'center center',
    willChange: 'transform',
    '& svg': {
      maxWidth: '100%',
      display: 'block',
    },
  },
  errorBox: {
    padding: 16,
  },
  errorText: {
    color: theme.palette.error.main,
    marginBottom: 4,
  },
  diagramError: {
    fontFamily: 'monospace',
    fontSize: '0.7rem',
    color: theme.palette.error.main,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  toast: {
    position: 'absolute' as const,
    bottom: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: theme.palette.grey[800],
    color: '#fff',
    padding: '4px 14px',
    borderRadius: 12,
    fontSize: '0.72rem',
    zIndex: 20,
    pointerEvents: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  dialogRoot: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  dialogHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    flexShrink: 0,
    backgroundColor: theme.palette.background.paper,
  },
  dialogHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  dialogTitle: {
    fontWeight: 600,
    fontSize: '1rem',
  },
  dialogBody: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
}));

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MermaidDiagramViewerProps {
  id: string;
  mermaid: string;
  nodeMap?: Record<string, string> | null;
  title?: string;
  llmUsed?: boolean;
  /** Hide the fullscreen button (used for the dialog instance to avoid recursion) */
  showFullscreenButton?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MermaidDiagramViewer({
  id,
  mermaid: mermaidSrc,
  nodeMap,
  title,
  llmUsed,
  showFullscreenButton = true,
}: MermaidDiagramViewerProps) {
  const classes = useStyles();

  // Refs
  const outerRef = useRef<HTMLDivElement>(null);   // zoom container (wheel events)
  const containerRef = useRef<HTMLDivElement>(null); // SVG injection target

  // Render state
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderDone, setRenderDone] = useState(false);

  // Zoom / pan state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Mermaid render ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setRenderDone(false);
    setRenderError(null);

    async function render() {
      try {
        const mermaidLib = await import('mermaid');
        const mermaidInstance = mermaidLib.default;

        if (!mermaidInitialized) {
          mermaidInstance.initialize({ startOnLoad: false, securityLevel: 'strict' });
          mermaidInitialized = true;
        }

        if (!containerRef.current || cancelled) return;

        // Use a unique, deterministic SVG element ID
        const svgId = `mermaid-${id.replaceAll(/[^a-zA-Z0-9]/g, '-')}`;
        const { svg } = await mermaidInstance.render(svgId, mermaidSrc);

        if (!containerRef.current || cancelled) return;
        containerRef.current.innerHTML = svg;
        setRenderError(null);
        setRenderDone(true);
      } catch (err) {
        if (!cancelled) setRenderError(String(err));
      }
    }

    render();
    return () => { cancelled = true; };
  }, [id, mermaidSrc]);

  // ── Clickable node wiring (post-render DOM) ─────────────────────────────
  //
  // securityLevel:'strict' sandboxes rendering inside a temporary iframe but
  // mermaidInstance.render() still returns the SVG *string*, which we inject
  // with innerHTML. The final SVG is a plain DOM node — not inside any iframe —
  // so addEventListener works normally after injection.

  useEffect(() => {
    if (!renderDone || !nodeMap || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;

    // Track listeners for cleanup, and setTimeout IDs for toast dismissal
    const listeners: Array<[Element, string, EventListener]> = [];
    const toastTimers: ReturnType<typeof setTimeout>[] = [];

    const nodes = svgEl.querySelectorAll('.node');
    nodes.forEach(node => {
      // Try various label element selectors Mermaid uses
      const labelEl =
        node.querySelector('.label') ??
        node.querySelector('foreignObject .label') ??
        node.querySelector('text');
      const label = labelEl?.textContent?.trim() ?? '';
      // Mermaid assigns SVG node ids like "flowchart-src_auth_controller_ts-0".
      // AST modules key nodeMap by the sanitized id (e.g. "src_auth_controller_ts"),
      // not the human-readable label, so try the id-derived key first.
      const rawId = node.getAttribute('id') ?? '';
      const idKey = rawId.replace(/^flowchart-/, '').replace(/-\d+$/, '');
      // id-derived key first (AST modules); label text as fallback (LLM diagrams with short human-readable ids).
      const filePath = (idKey && nodeMap[idKey]) || (label && nodeMap[label]) || undefined;
      if (!filePath) return;

      const el = node as HTMLElement;
      el.style.cursor = 'pointer';
      el.setAttribute('title', filePath);

      const onEnter: EventListener = () => { el.style.filter = 'brightness(1.2)'; };
      const onLeave: EventListener = () => { el.style.filter = ''; };
      const onClick: EventListener = () => {
        navigator.clipboard.writeText(filePath).catch(() => {});
        setToast(`Copied: ${filePath}`);
        const t = setTimeout(() => setToast(null), 2200);
        toastTimers.push(t);
      };

      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      el.addEventListener('click', onClick);

      listeners.push([el, 'mouseenter', onEnter]);
      listeners.push([el, 'mouseleave', onLeave]);
      listeners.push([el, 'click', onClick]);
    });

    return () => {
      listeners.forEach(([el, event, fn]) => el.removeEventListener(event, fn));
      toastTimers.forEach(t => clearTimeout(t));
    };
  }, [renderDone, nodeMap]);

  // ── Wheel zoom (non-passive, attached directly) ─────────────────────────

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom(z => Math.max(0.3, Math.min(3.0, z * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Drag-to-pan handlers ────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => { isDragging.current = false; };

  // ── Control actions ─────────────────────────────────────────────────────

  const handleZoomIn = () => setZoom(z => Math.min(3.0, parseFloat((z + 0.1).toFixed(2))));
  const handleZoomOut = () => setZoom(z => Math.max(0.3, parseFloat((z - 0.1).toFixed(2))));
  const handleReset = () => { setZoom(1.0); setPan({ x: 0, y: 0 }); };

  const handleDownload = () => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const xml = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (title ?? id).replace(/[^a-zA-Z0-9-_]/g, '_');
    a.download = `${safeName}-${Date.now()}.svg`;
    a.click();
    // Defer revoke so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // ── Render pieces ───────────────────────────────────────────────────────

  const controlBar = (
    <Box className={classes.controlBar}>
      <Tooltip title="Zoom in">
        <IconButton className={classes.controlBtn} size="small" onClick={handleZoomIn}>
          +
        </IconButton>
      </Tooltip>
      <Tooltip title="Zoom out">
        <IconButton className={classes.controlBtn} size="small" onClick={handleZoomOut}>
          −
        </IconButton>
      </Tooltip>
      <Typography className={classes.zoomLabel}>{Math.round(zoom * 100)}%</Typography>
      <Tooltip title="Reset view">
        <IconButton className={classes.controlBtn} size="small" onClick={handleReset}>
          ↺
        </IconButton>
      </Tooltip>
      <Box className={classes.controlSep} />
      {showFullscreenButton && (
        <Tooltip title="Fullscreen">
          <IconButton className={classes.controlBtn} size="small" onClick={() => setIsFullscreen(true)}>
            ⛶
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Download SVG">
        <IconButton className={classes.controlBtn} size="small" onClick={handleDownload}>
          ↓
        </IconButton>
      </Tooltip>
    </Box>
  );

  if (renderError) {
    return (
      <Box className={classes.errorBox}>
        <Typography variant="body2" className={classes.errorText}>
          Failed to render diagram
        </Typography>
        <Typography className={classes.diagramError}>{mermaidSrc}</Typography>
      </Box>
    );
  }

  return (
    <Box className={classes.viewerRoot}>
      {controlBar}

      {/* Zoom / pan canvas */}
      <div
        ref={outerRef}
        className={classes.zoomContainer}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          ref={containerRef}
          className={classes.svgWrapper}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
      </div>

      {/* Clipboard copy toast */}
      {toast && <Box className={classes.toast}>{toast}</Box>}

      {/* Fullscreen dialog */}
      {showFullscreenButton && (
        <Dialog
          fullScreen
          open={isFullscreen}
          onClose={() => setIsFullscreen(false)}
        >
          <Box className={classes.dialogRoot}>
            {/* Dialog header */}
            <Box className={classes.dialogHeader}>
              <Box className={classes.dialogHeaderLeft}>
                <Typography className={classes.dialogTitle}>{title ?? id}</Typography>
                {llmUsed !== undefined && (
                  <Chip
                    size="small"
                    label={llmUsed ? 'AI' : 'AST'}
                    title={
                      llmUsed
                        ? 'Generated with LLM assistance'
                        : 'Generated from AST — no LLM required'
                    }
                  />
                )}
              </Box>
              <Tooltip title="Close fullscreen">
                <IconButton size="small" onClick={() => setIsFullscreen(false)}>
                  ✕
                </IconButton>
              </Tooltip>
            </Box>

            {/* Dialog body — renders a fresh viewer instance */}
            <Box className={classes.dialogBody}>
              <MermaidDiagramViewer
                id={`${id}-fs`}
                mermaid={mermaidSrc}
                nodeMap={nodeMap}
                title={title}
                llmUsed={llmUsed}
                showFullscreenButton={false}
              />
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
}
