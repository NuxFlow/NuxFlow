// What Admin → Inbox gets from the server: GET /api/v1/inbox (the message list),
// GET /api/v1/inbox/:id (one conversation) and GET /api/v1/mailboxes. Import-free.

export type InboxMessageStatus = 'new' | 'read' | 'archived' | 'spam'

/** One row of the message list. */
export interface InboxMessage {
  id: string
  threadId: string
  mailboxId: string | null
  mailboxName: string
  fromAddress: string
  fromName: string | null
  toAddress: string
  subject: string
  snippet: string
  status: InboxMessageStatus
  /** AI triage: lead, support, spam or other. */
  category: string | null
  aiSummary: string | null
  attachmentCount: number
  createdAt: string
}

export interface InboxListResponse {
  messages: InboxMessage[]
  total: number
  /** Unread across the whole inbox, for the sidebar badge. */
  unread: number
  page: number
  limit: number
}

/** An attachment, downloaded by its index (storage keys stay on the server). */
export interface InboxAttachment {
  index: number
  filename: string
  contentType: string
  size: number
  /** False when the file wasn't kept (storage full, or no R2). */
  available: boolean
}

/** One message in a conversation, either direction. Its HTML is only ever shown in a
 * sandboxed iframe. */
export interface InboxThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  fromAddress: string
  fromName: string | null
  toAddress: string
  subject: string
  textBody: string | null
  htmlBody: string | null
  attachments: InboxAttachment[]
  /** The sender checks from `Authentication-Results`. */
  auth: { spf?: string; dkim?: string; dmarc?: string; dkimPassDomains?: string[] } | null
  status: InboxMessageStatus
  category: string | null
  aiSummary: string | null
  /** Who on the team sent a reply. */
  sentByName: string | null
  createdAt: string
}

export interface InboxThreadResponse {
  message: { id: string; threadId: string; mailboxId: string | null; status: InboxMessageStatus; subject: string }
  thread: InboxThreadMessage[]
}

/** An address mail is received at. */
export interface Mailbox {
  id: string
  localPart: string
  name: string
  forwardTo: string | null
  notify: boolean
  enabled: boolean
  createdAt: string
  /** The address on the site's own domain (`*@…` for the catch-all). */
  siteAddress: string
  /** The same mailbox on the shared inbound domain, when there is one. */
  platformAddress: string | null
}

export interface MailboxesResponse {
  mailboxes: Mailbox[]
  setup: {
    siteDomain: string
    platformDomain: string | null
    handle: string | null
    emailProvider: string
    /** The Cloudflare send_email binding exists (needed to reply). */
    sendingBindingPresent: boolean
  }
}
