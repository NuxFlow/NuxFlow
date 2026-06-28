// Wrangler compiles .wasm imports into a WebAssembly.Module at bundle time,
// bypassing the "WebAssembly.compile() disallowed by embedder" runtime restriction.
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
