// Stub for @opentelemetry/api — satisfies better-auth's optional instrumentation import
// without requiring the real package to be installed.
const noop = () => {}
const noopSpan = { end: noop, setStatus: noop, setAttribute: noop, addEvent: noop, recordException: noop, setAttributes: noop, isRecording: () => false, spanContext: () => ({}) }
const noopTracer = {
  startActiveSpan: (_name, fnOrOpts, fnOrCtx, fn) => {
    const cb = typeof fnOrOpts === 'function' ? fnOrOpts : typeof fnOrCtx === 'function' ? fnOrCtx : fn
    return cb(noopSpan)
  },
  startSpan: () => noopSpan,
}

export const trace = { getTracer: () => noopTracer, getActiveSpan: () => undefined, setSpan: ctx => ctx, deleteSpan: ctx => ctx }
export const context = { with: (_ctx, fn) => fn(), active: () => ({}), bind: (_ctx, fn) => fn }
export const propagation = { inject: noop, extract: ctx => ctx, fields: () => [] }
export const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 }
export const SpanKind = { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 }
export const diag = { setLogger: noop, verbose: noop, debug: noop, info: noop, warn: noop, error: noop }
export const DiagConsoleLogger = function () {}
export const DiagLogLevel = { NONE: 0, ERROR: 30, WARN: 50, INFO: 60, DEBUG: 70, VERBOSE: 80, ALL: 9999 }

export default { trace, context, propagation, SpanStatusCode, SpanKind, diag, DiagConsoleLogger, DiagLogLevel }
