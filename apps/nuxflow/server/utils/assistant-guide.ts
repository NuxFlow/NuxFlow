// The admin AI helper answers "how do I…?" from NuxFlow's own user guide (docs/
// user-guide.md, bundled as the `docs` server asset — see nuxt.config.ts). The guide is
// split at its headings and the few sections that best match the question go into the
// prompt. Plain word matching rather than embeddings: it needs no Vectorize index, so it
// works on every install, costs nothing, and the guide is small enough for it to do well.

export interface GuideSection {
  /** "AI Features › Change a page with AI" */
  title: string
  body: string
}

const MAX_SECTION_CHARS = 2500

/** Splits Markdown at ##/### headings; each section is titled with its parent heading. */
export function splitGuide(markdown: string): GuideSection[] {
  const out: GuideSection[] = []
  let h2 = ''
  let current: GuideSection | null = null
  const flush = () => {
    if (current && current.body.trim()) out.push({ title: current.title, body: current.body.trim().slice(0, MAX_SECTION_CHARS) })
  }
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{2,4}) (.+)$/.exec(line)
    if (m) {
      flush()
      const text = m[2]!.replace(/[*`]/g, '').trim()
      if (m[1] === '##') h2 = text
      current = { title: m[1] === '##' ? text : `${h2} › ${text}`, body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  flush()
  return out
}

const STOP = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'does', 'with', 'from', 'that', 'this', 'into', 'are', 'you', 'your', 'our', 'want', 'need', 'make', 'get', 'set', 'site', 'page', 'nuxflow', 'please', 'there', 'where', 'why', 'have', 'has', 'will', 'would', 'should', 'could', 'when', 'which', 'its', 'not', 'any', 'all', 'more'])

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w))
}

// Crude stemming so "colours"/"colour", "emails"/"email" and "sending"/"send" meet.
function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '') || word
}

/** The sections that best match `question`, best first; [] when nothing matches. */
export function findGuideSections(sections: GuideSection[], question: string, limit = 4): GuideSection[] {
  const terms = [...new Set(words(question).map(stem))]
  if (!terms.length) return []
  const scored = sections.map((s) => {
    const title = new Set(words(s.title).map(stem))
    const body = words(s.body).map(stem)
    let score = 0
    for (const t of terms) {
      if (title.has(t)) score += 4
      const hits = body.filter(w => w === t).length
      if (hits) score += 1 + Math.min(hits, 5) * 0.3
    }
    return { s, score }
  })
  return scored.filter(x => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.s)
}

let cached: GuideSection[] | null = null

/** The bundled user guide, split into sections (once per isolate). [] when it isn't bundled. */
export async function loadGuideSections(): Promise<GuideSection[]> {
  if (cached) return cached
  try {
    const md = await useStorage('assets/docs').getItem<string>('user-guide.md')
    cached = typeof md === 'string' ? splitGuide(md) : []
  }
  catch {
    cached = []
  }
  return cached
}
