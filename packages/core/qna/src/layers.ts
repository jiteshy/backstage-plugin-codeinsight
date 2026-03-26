// ---------------------------------------------------------------------------
// Shared layer name constants for the QnA pipeline.
// All services that read or write vector store layers must import from here
// to prevent silent mismatches when a layer name changes.
// ---------------------------------------------------------------------------

export const LAYER_CODE = 'code';
export const LAYER_FILE_SUMMARY = 'file_summary';
export const LAYER_DOC_SECTION = 'doc_section';
export const LAYER_DIAGRAM_DESC = 'diagram_desc';
export const LAYER_CIG_METADATA = 'cig_metadata';
