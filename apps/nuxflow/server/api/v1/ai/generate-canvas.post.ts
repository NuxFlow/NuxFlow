import { z } from 'zod'
import { generateObject } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { getAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  description: z.string().min(10).max(600),
  tone: z.enum(['professional', 'casual', 'friendly', 'bold']).optional().default('professional'),
  pageGoal: z.enum(['landing', 'about', 'product', 'pricing', 'contact', 'blog', 'general']).optional().default('general'),
})

const blockTypeEnum = z.enum([
  'canvas-hero',
  'canvas-text',
  'canvas-features',
  'canvas-testimonial',
  'canvas-cta',
  'canvas-accordion',
  'canvas-pricing',
  'canvas-columns',
  'canvas-spacer',
  'canvas-footer',
  'canvas-button',
  'canvas-image',
])

const generatedBlockSchema = z.object({
  type: blockTypeEnum,
  props: z.record(z.string(), z.unknown()),
})

const responseSchema = z.object({
  blocks: z.array(generatedBlockSchema).min(1).max(12),
})

const BLOCK_CATALOG = `
AVAILABLE BLOCKS — only use these "type" values:

canvas-hero: Full-width hero section
  Key props: headline(str), subtext(str), ctaLabel(str), ctaUrl(str), cta2Label(str), cta2Url(str),
             align("left"|"center"|"right"), bgColor(hex), textColor(hex), showDecorations(bool)

canvas-text: Rich HTML prose block
  Key props: content(HTML string with <p>, <h2>, <h3>, <ul>, <ol>, <strong> tags)

canvas-features: Icon+title+description feature grid
  Key props: sectionLabel(str), sectionTitle(str), sectionDesc(str), numFeatures(1|2|3|4),
             style("plain"|"card"|"icon-top"), align("center"|"left"), iconColor(hex), bgColor(hex),
             feat1Icon("i-lucide-XXX"), feat1Title(str), feat1Desc(str)
             feat2Icon, feat2Title, feat2Desc, feat3Icon, feat3Title, feat3Desc, feat4Icon, feat4Title, feat4Desc

canvas-testimonial: Customer quote with author
  Key props: quote(str), author(str), role(str), company(str), rating(0-5),
             style("card"|"simple"|"large"), bgColor(hex), textColor(hex)

canvas-cta: Call-to-action banner strip
  Key props: headline(str), subtext(str), btnLabel(str), btnUrl(str),
             bgColor(hex), textColor(hex), btnColor(hex)

canvas-accordion: FAQ / collapsible panels
  Key props: title(str), description(str),
             itemsJson(JSON string array of {question:str, answer:str} objects)

canvas-pricing: Pricing table (2 or 3 plans)
  Key props: title(str), description(str), numPlans("2"|"3"),
             plan1Name(str), plan1Price(str), plan1Period(str), plan1Features(JSON string array of strings),
             plan1BtnLabel(str), plan1BtnUrl(str), plan1Popular(bool)
             [plan2 and plan3 same pattern]

canvas-columns: Multi-column text layout
  Key props: columns("2"|"3"), col1(HTML), col2(HTML), col3(HTML), gap(24)

canvas-spacer: Vertical whitespace divider
  Key props: height(number 48-96), showLine(bool)

canvas-footer: Site footer with nav links
  Key props: logoText(str), description(str), col1Title(str),
             col1Links(JSON string: [{"label":"Home","url":"/"},...]),
             col2Title(str), col2Links(JSON string), copyrightText(str),
             bgColor(hex), textColor(hex)

canvas-button: Standalone CTA button
  Key props: label(str), url(str), align("center"|"left"|"right"),
             size("sm"|"md"|"lg"), rounded("lg"|"full"), bgColor(hex), textColor(hex)

canvas-image: Single image placeholder
  Key props: src(""), alt(str), caption(str), width("full"|"lg"|"md"), align("center")
`

const SYSTEM_PROMPT = `You are a web page layout designer. Given a description, generate a sensible sequence of canvas blocks that form a complete, well-structured page.

${BLOCK_CATALOG}

Rules:
- Use only the block types listed above
- Always start with canvas-hero for landing/product pages
- Use canvas-spacer (height:64) between major sections
- End landing pages with canvas-cta and/or canvas-footer
- For canvas-features, use real Lucide icon classes like i-lucide-zap, i-lucide-shield-check, i-lucide-sparkles, i-lucide-globe, i-lucide-code, i-lucide-layers
- For canvas-accordion itemsJson and canvas-pricing planXFeatures, output valid JSON strings (escaped properly)
- For canvas-columns col1/col2/col3, output valid HTML strings
- Keep bgColor as "#ffffff" and textColor as "#111827" unless a specific style is requested
- Generate 4-9 blocks total for a typical page
- All text should be compelling and match the requested tone`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-canvas' })

  const model = await getAiSdkModel(event, 'smart')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { description, tone, pageGoal } = await readValidatedBody(event, bodySchema.parse)

  const prompt = `Generate a ${pageGoal} page for: "${description}". Tone: ${tone}.`

  let object: z.infer<typeof responseSchema>
  try {
    const result = await generateObject({
      model,
      schema: responseSchema,
      system: SYSTEM_PROMPT,
      prompt,
    })
    object = result.object
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }

  const blocks = object.blocks.map(b => ({
    id: crypto.randomUUID(),
    type: b.type,
    props: b.props,
  }))

  return { type: 'canvas' as const, blocks }
})
