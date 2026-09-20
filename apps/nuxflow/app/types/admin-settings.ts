// Shared reactive-state shapes for admin/settings/index.vue's tab components. Split out
// so the parent page and each tab component agree on the same types without the parent
// (a .vue page, not a module) needing to export them.

export interface GeneralState {
  name: string
  domain: string
  locale: string
  timezone: string
  status: 'active' | 'maintenance'
  notificationEmail: string
  allowPublicRegistration: boolean
}

export interface AppearanceState {
  showHeader: boolean
  showSearch: boolean
  showStickyHeader: boolean
  logoSize: 'sm' | 'md' | 'lg'
  faviconUrl: string
  logoUrl: string
  customHeadHtml: string
  customBodyHtml: string
}

export interface EmailState {
  provider: string
  fromAddress: string
  resendApiKey: string
  brevoApiKey: string
  zeptoApiKey: string
}

export interface IntegrationsState {
  turnstileSiteKey: string
}

export interface SocialState {
  googleClientId: string
  googleClientSecret: string
  githubClientId: string
  githubClientSecret: string
}

export interface PaymentsState {
  signupsDisabled: boolean
  signupsDisabledMessage: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  lsApiKey: string
  lsStoreId: string
  lsWebhookSecret: string
  paddleApiKey: string
  paddleVendorId: string
  paddleWebhookSecret: string
  paddleSandbox: boolean
}

export interface AiState {
  provider: string
  openaiApiKey: string
  anthropicApiKey: string
  geminiApiKey: string
  deepseekApiKey: string
  ollamaBaseUrl: string
  ollamaModel: string
}

export interface CloudflareMediaState {
  accountId: string
  streamToken: string
  imagesToken: string
  imagesDeliveryUrl: string
}

export interface R2State {
  publicUrl: string
}

export interface S3State {
  bucket: string
  accessKey: string
  secretKey: string
  region: string
  endpoint: string
  publicUrl: string
}

export interface BunnyState {
  apiKey: string
  storageZone: string
  pullZone: string
}

export interface PushState {
  vapidPublicKey: string | null
  eventsContentPublished: boolean
  eventsPaymentConfirmation: boolean
  eventsFormSubmission: boolean
}

export interface SecurityState {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}
