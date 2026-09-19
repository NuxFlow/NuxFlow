export interface CustomizerValues {
  colorMode: 'auto' | 'light' | 'dark'
  primaryColor: string
  linkColor: string
  bgLight: string
  bgDark: string
  bodyFont: string
  headingFont: string
  fontSize: 'xs' | 'sm' | 'base' | 'lg' | 'xl'
  headingWeight: '300' | '400' | '500' | '600' | '700' | '800'
  lineHeight: 'tight' | 'normal' | 'relaxed'
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  spacing: 'compact' | 'normal' | 'spacious'
  contentWidth: 'narrow' | 'default' | 'wide' | 'full'
}
