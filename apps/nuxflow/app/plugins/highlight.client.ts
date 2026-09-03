// hljs core + languages are loaded lazily (see loadHljs below) so the
// ~11 language-grammar bundle is only ever downloaded on a route that
// actually has a `.nux-content pre code` block, not eagerly on every
// navigation.
import type { HLJSApi } from 'highlight.js'

let hljsPromise: Promise<HLJSApi> | null = null

function loadHljs(): Promise<HLJSApi> {
  if (!hljsPromise) {
    hljsPromise = Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/php'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/yaml'),
    ]).then(([
      core,
      javascript,
      typescript,
      xml,
      css,
      json,
      bash,
      python,
      php,
      sql,
      yaml,
    ]) => {
      const hljs = core.default
      hljs.registerLanguage('javascript', javascript.default)
      hljs.registerLanguage('js', javascript.default)
      hljs.registerLanguage('typescript', typescript.default)
      hljs.registerLanguage('ts', typescript.default)
      hljs.registerLanguage('html', xml.default)
      hljs.registerLanguage('vue', xml.default)
      hljs.registerLanguage('xml', xml.default)
      hljs.registerLanguage('tsx', typescript.default)
      hljs.registerLanguage('jsx', javascript.default)
      hljs.registerLanguage('css', css.default)
      hljs.registerLanguage('json', json.default)
      hljs.registerLanguage('bash', bash.default)
      hljs.registerLanguage('shell', bash.default)
      hljs.registerLanguage('python', python.default)
      hljs.registerLanguage('php', php.default)
      hljs.registerLanguage('sql', sql.default)
      hljs.registerLanguage('yaml', yaml.default)
      return hljs
    })
  }
  return hljsPromise
}

async function highlightContentBlocks() {
  const codeBlocks = document.querySelectorAll('.nux-content pre code:not(.hljs)')
  if (!codeBlocks.length) return

  const hljs = await loadHljs()
  document.querySelectorAll('.nux-content pre code:not(.hljs)').forEach((el) => {
    hljs.highlightElement(el as HTMLElement)
  })
}

export default defineNuxtPlugin(() => {
  const router = useRouter()
  router.afterEach(() => nextTick(highlightContentBlocks))
})
