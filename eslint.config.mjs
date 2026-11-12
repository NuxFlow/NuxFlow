import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Nuxt 5 (Nitro v3 / h3 v2) readiness: patterns PR #144 moved behind one function each, so
// upgrade day is a one-place change. These keep them from creeping back in (one did, in
// the starter sites work). Each owner file gets the list minus its own pattern.
const NUXT5_RESTRICTED = {
  createError: {
    selector: 'CallExpression[callee.name="createError"]',
    message: 'Use httpError() or the helpers in server/utils/response.ts (h3 v2 replaces createError with new HTTPError()).',
  },
  cloudflareContext: {
    selector: 'MemberExpression[property.name="cloudflare"][object.property.name="context"]',
    message: 'Use getCfEnv()/getCloudflareContext()/waitUntil() from server/utils/cf-env.ts (Nitro v3 moves this to event.req.runtime.cloudflare).',
  },
  runtimeConfigEvent: {
    selector: 'CallExpression[callee.name="useRuntimeConfig"][arguments.length>0]',
    message: 'Call useRuntimeConfig() with no argument (Nuxt 5 drops the event parameter).',
  },
  eventPath: {
    selector: 'MemberExpression[object.name="event"][property.name="path"]',
    message: 'Use getRequestURL(event).pathname (h3 v2 removes event.path).',
  },
}
const nuxt5Restricted = (...except) => [
  'error',
  ...Object.entries(NUXT5_RESTRICTED).filter(([key]) => !except.includes(key)).map(([, rule]) => rule),
]

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: false,
  },
  dirs: {
    // Nuxt-specific srcDir convention detection (auto-imports, page/layout/component
    // rules) — scoped to the actual Nuxt app only. This does NOT limit which files get
    // linted; `packages/*` are linted too (via their own `lint` scripts), they just don't
    // get Nuxt-app-specific treatment, which is correct since they aren't Nuxt apps.
    src: ['./apps/nuxflow'],
  },
}).append(
  {
    ignores: [
      'apps/nuxflow/server/stubs/**',
      'apps/nuxflow/worker-configuration.d.ts',
      // Checked-in third-party build output (Vue runtime, served to the sandboxed
      // plugin iframe — see nuxt.config.ts serverAssets) — not our source, not meant
      // to be linted.
      'apps/nuxflow/server/assets/vendor/**',
      // Checked-in generated CLI/scaffolder bundles (esbuild/tsup output committed so
      // `npx create-nuxflow-app` / the published `nuxflow` bin work without a build
      // step) — generated, not authored, not meant to be linted.
      'packages/cli/bin/**',
      'packages/create-nuxflow-app/bin/**',
      'packages/create-nuxflow-app/dist/**',
    ],
  },
  {
    // Scoped to match `@nuxt/eslint-config`'s own TS rule glob (see
    // node_modules/@nuxt/eslint-config/dist/chunks/typescript.mjs) rather than applying
    // repo-wide: without a `files` restriction these TS-only rules also get evaluated
    // against non-TS files linted under this same config (e.g. `packages/cli/build.mjs`,
    // `packages/create-nuxflow-app/tsup.config.ts` before this glob, or any plain `.mjs`/
    // `.cjs` build script in packages/*), which aren't parsed by @typescript-eslint/parser
    // and crash `consistent-type-imports` with "requires type information... detected a
    // parser other than @typescript-eslint/parser".
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // `no-console` still applies repo-wide (not a TS-only rule) — kept separate from the
    // TS-scoped block above so build scripts (build.mjs, tsup.config.ts) still get it.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/nuxflow/server/**/*.ts'],
    rules: { 'no-restricted-syntax': nuxt5Restricted() },
  },
  {
    // The one place allowed to call createError (httpError()).
    files: ['apps/nuxflow/server/utils/response.ts'],
    rules: { 'no-restricted-syntax': nuxt5Restricted('createError') },
  },
  {
    // The one place allowed to read event.context.cloudflare.
    files: ['apps/nuxflow/server/utils/cf-env.ts'],
    rules: { 'no-restricted-syntax': nuxt5Restricted('cloudflareContext') },
  },
  {
    // Terminal commands (pnpm ring:*): printing to the terminal is their whole job.
    files: ['apps/nuxflow/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: [
      'apps/nuxflow/app/*.vue',
      'apps/nuxflow/app/pages/**/*.vue',
      'apps/nuxflow/app/layouts/**/*.vue',
      'apps/nuxflow/app/components/**/*.vue',
    ],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // The canvas block tree (`CanvasBlockData`) is one big reactive object owned by the
    // editor; `block` props on recursive tree nodes are references into that same shared
    // state, not copies — nested mutation (materializing `block.children` lazily, see the
    // comment on `setSlotChildren` in CanvasBlock.vue) is the deliberate design, not a
    // one-way-data-flow bug. `shallowOnly` keeps the rule active for what it's actually
    // meant to catch (reassigning the `block` prop itself), just not nested writes into it.
    files: ['packages/canvas/src/editor/CanvasBlock.vue'],
    rules: {
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
    },
  },
)
