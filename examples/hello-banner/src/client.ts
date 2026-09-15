// Client-side render logic for the "Hello Banner" plugin.
// Runs inside a sandboxed <iframe sandbox="allow-scripts"> for each rendered block
// instance — never in the main app. Block metadata (name, icon, fields, defaultProps)
// lives in blocks.json instead, since the trusted app reads that directly.

export function renderBlock(
  blockId: string,
  { defineComponent, h, computed }: {
    defineComponent: (opts: object) => unknown
    h: (tag: string | object, props?: object | null, children?: unknown) => unknown
    computed: <T>(fn: () => T) => { value: T }
  },
) {
  if (blockId !== 'hello-banner/banner') return null

  return defineComponent({
    props: {
      headline: { type: String, default: 'Welcome to NuxFlow' },
      subtext: { type: String, default: 'This banner was registered by the Hello Banner external plugin.' },
      bgColor: { type: String, default: '#4f46e5' },
      textColor: { type: String, default: '#ffffff' },
      align: { type: String, default: 'center' },
    },
    setup(props: Record<string, string>) {
      const wrapperStyle = computed(() => ({
        backgroundColor: props.bgColor,
        color: props.textColor,
        padding: '64px 32px',
        textAlign: props.align as 'left' | 'center' | 'right',
        width: '100%',
      }))

      const headlineStyle = {
        fontSize: '2.25rem',
        fontWeight: '800',
        lineHeight: '1.2',
        marginBottom: '16px',
        margin: '0 0 16px',
      }

      const subtextStyle = {
        fontSize: '1.125rem',
        opacity: '0.85',
        maxWidth: '640px',
        margin: props.align === 'center' ? '0 auto' : '0',
      }

      const badgeStyle = {
        display: 'inline-block',
        marginTop: '24px',
        fontSize: '0.75rem',
        opacity: '0.6',
        border: '1px solid currentColor',
        borderRadius: '9999px',
        padding: '2px 10px',
      }

      return () =>
        h('section', { style: wrapperStyle.value }, [
          h('h2', { style: headlineStyle }, props.headline),
          h('p', { style: subtextStyle }, props.subtext),
          h('span', { style: badgeStyle }, 'hello-banner plugin · sandboxed iframe'),
        ])
    },
  })
}
