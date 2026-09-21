// Back-compat shim after the drive extraction: the Envelope type + formatter moved to
// `@storytree/drive`. Re-exported here so every cli file that imports `./envelope.js` is unchanged.
// The shared `node → next:` emitter (ADR-0161) lives beside them and is re-exported the same way.
export {
  formatEnvelope,
  emitNodeEnvelope,
  runnableNextLine,
  withDeltaFooter,
  type Envelope,
  type ContextNode,
  type NodeEdge,
} from "@storytree/drive";
