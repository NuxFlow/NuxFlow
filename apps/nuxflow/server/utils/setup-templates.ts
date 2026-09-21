import { ulid } from 'ulid'

// Shared per-template homepage Canvas-block content, used both by the setup wizard
// (server/api/v1/setup/complete.post.ts, for every fresh/secondary site) and the demo
// instance's nightly reseed (server/scheduled/demo-reset.ts's seedDemo(), which used to
// carry its own near-duplicate copy of the 'landing' template). Keeping this in one place
// means copy/icon/shape changes to a template only need to happen once.

const SECTION_PADDING = { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' as const }
const FOOTER_PADDING = { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const }

export type SetupTemplate = 'landing' | 'blog' | 'portfolio' | 'blank'

/**
 * Returns the seeded homepage Canvas blocks for the given template, with `siteName`
 * interpolated into the copy exactly as each template previously did inline.
 */
export function getTemplateBlocks(template: SetupTemplate, siteName: string): Record<string, unknown>[] {
  if (template === 'landing') {
    return [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Fast, modern, and beautiful',
          subtext: `Welcome to ${siteName}. We are powered by NuxFlow — the open-source visual CMS optimized for the Cloudflare edge ecosystem.`,
          ctaLabel: 'Go to dashboard',
          ctaUrl: '/admin',
          cta2Label: 'View on GitHub',
          cta2Url: 'https://github.com/NuxFlow/NuxFlow',
          align: 'center',
          bgGradient: 'linear-gradient(to bottom right, #090d16, #064e3b, #022c22, #090d16)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #00dc82)',
          logoIcon: 'i-lucide-layers',
          showDecorations: true,
          padding: SECTION_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-features',
        props: {
          sectionLabel: 'Why Choose Us',
          sectionTitle: 'Built for Performance',
          sectionDesc: 'Everything you need to succeed online, managed right from our fast and robust admin dashboard.',
          numFeatures: '3',
          style: 'card',
          align: 'left',
          iconColor: 'var(--nuxflow-primary, #00dc82)',
          feat1Icon: 'i-lucide-zap',
          feat1Title: 'Edge Performance',
          feat1Desc: 'Global distribution with absolute speed. Zero cold starts, running closer to your audience.',
          feat2Icon: 'i-lucide-layout',
          feat2Title: 'Visual Canvas Builder',
          feat2Desc: 'Custom page layouts in seconds. Add, edit, or rearrange sections with no technical experience needed.',
          feat3Icon: 'i-lucide-shield',
          feat3Title: 'Ultimate Security',
          feat3Desc: 'Highly secure edge shielding, sandboxed plugin execution, and robust isolation by default.',
          gap: 24,
          padding: FOOTER_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Ready to grow?',
          subtext: 'Your workspace is set up and ready to create. Start building your client and portal pages today!',
          btnLabel: 'Open Admin Dashboard',
          btnUrl: '/admin',
          bgColor: '#022c22',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #00dc82)',
          padding: FOOTER_PADDING,
        },
      },
    ]
  }

  if (template === 'blog') {
    return [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Welcome to Our Journal',
          subtext: `Thoughts, ideas, and stories on the latest edge-native technology and publishing trends. Brought to you by ${siteName}.`,
          ctaLabel: 'Read Blog Posts',
          ctaUrl: '/admin/content?type=post',
          align: 'center',
          bgGradient: 'linear-gradient(to bottom right, #022c22, #047857, #022c22)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #10b981)',
          logoIcon: 'i-lucide-book-open',
          showDecorations: true,
          padding: SECTION_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-text',
        props: {
          content: `
            <h2 style="font-size: 1.75rem; font-weight: 800; margin-bottom: 1rem; color: #111827;">Publishing on the Serverless Edge</h2>
            <p style="font-size: 1.05rem; line-height: 1.7; color: #374151; margin-bottom: 1rem;">
              This blog template is pre-seeded with NuxFlow. Everything here is running natively on Cloudflare Workers and D1, making it extremely secure, globally distributed, and blisteringly fast.
            </p>
            <p style="font-size: 1.05rem; line-height: 1.7; color: #374151;">
              To customize your homepage or write new articles, head to the admin panel. Your seeded post <strong>"Hello World!"</strong> is already live and editable in the Posts directory index.
            </p>
          `,
          padding: FOOTER_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Share your stories',
          subtext: 'Ready to write your own articles? Log into your dashboard and publish your first post today.',
          btnLabel: 'Write a Post',
          btnUrl: '/admin/content?type=post',
          bgColor: '#022c22',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #10b981)',
          padding: FOOTER_PADDING,
        },
      },
    ]
  }

  if (template === 'portfolio') {
    return [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Building Digital Experiences',
          subtext: `Hi! I am a creator and developer. This is my professional portfolio showcase where I share my creative web apps and designs. Powered by ${siteName}.`,
          ctaLabel: 'View Projects',
          ctaUrl: '/admin',
          align: 'left',
          bgGradient: 'linear-gradient(to bottom right, #0f0728, #3b0764, #0f0728)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #d946ef)',
          logoIcon: 'i-lucide-palette',
          showDecorations: true,
          padding: SECTION_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-features',
        props: {
          sectionLabel: 'Selected Projects',
          sectionTitle: 'My Work & Showcase',
          sectionDesc: 'Take a look at some of my recent digital works, UI designs, and web applications.',
          numFeatures: '3',
          style: 'card',
          align: 'left',
          iconColor: 'var(--nuxflow-primary, #d946ef)',
          feat1Icon: 'i-lucide-globe',
          feat1Title: 'Web App Design',
          feat1Desc: 'Interactive client web applications built using Nuxt 4, Vue 3, and rich micro-animations.',
          feat2Icon: 'i-lucide-smartphone',
          feat2Title: 'Mobile Interfaces',
          feat2Desc: 'Pixel-perfect mobile viewports and native layout optimizations for handheld screens.',
          feat3Icon: 'i-lucide-sparkles',
          feat3Title: 'Visual Page Canvas',
          feat3Desc: 'Bespoke components designed to allow instant visual updates via Canvas editors.',
          gap: 24,
          padding: FOOTER_PADDING,
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Work with me',
          subtext: 'I am always open to discussing new opportunities, custom web designs, or client applications.',
          btnLabel: 'Get in Touch',
          btnUrl: '/admin',
          bgColor: '#0f0728',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #d946ef)',
          padding: FOOTER_PADDING,
        },
      },
    ]
  }

  // blank template
  return [
    {
      id: ulid(),
      type: 'canvas-text',
      props: {
        content: `
          <h1 style="font-size: 2.5rem; font-weight: 800; text-align: center; margin-top: 4rem; margin-bottom: 1rem; color: #111827;">Welcome to your blank canvas</h1>
          <p style="text-align: center; color: #4b5563; max-width: 600px; margin: 0 auto; line-height: 1.6; font-size: 1.1rem;">
            Your site is set up cleanly with NuxFlow. Double-click here to start editing this section or add more Canvas blocks from the toolbar below.
          </p>
        `,
        padding: SECTION_PADDING,
      },
    },
  ]
}
