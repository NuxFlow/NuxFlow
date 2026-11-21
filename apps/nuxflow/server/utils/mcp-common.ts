import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { Db } from './db'
import { roleAtLeast, type Role, type ApiKeyScope } from './permissions'

// Types and small helpers shared by the MCP tool files (mcp-tools.ts for content and
// settings, mcp-site-tools.ts for media, menus, redirects and forms).

export interface McpToolContext {
  event: H3Event
  db: Db
  siteId: string
  apiKeyUserId: string
  apiKeyRole: Role | undefined
}

export type McpToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export interface McpToolDefinition {
  description: string
  scope: ApiKeyScope
  inputSchema: Record<string, unknown>
}

export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] }
}

export function toolJsonResult(value: unknown): McpToolResult {
  return textResult(JSON.stringify(value, null, 2))
}

// The key's own declared scopes (set in api-keys/index.post.ts, resolved onto the request
// by 03.api-key-auth.ts) are a ceiling on top of the issuing user's site role, not a
// substitute for it — a key can be scoped down to read-only even when issued by an
// editor/admin. Every tool needs its matching scope in addition to its role check.
export function apiKeyRoleAtLeast(apiKeyRole: Role | undefined, minimum: Role): boolean {
  return roleAtLeast(apiKeyRole ?? 'viewer', minimum)
}

/** A role refusal in the wording every tool uses. */
export function toolRoleError(ctx: McpToolContext, minimum: Role, what: string): McpToolResult | null {
  if (apiKeyRoleAtLeast(ctx.apiKeyRole, minimum)) return null
  return textResult(`Error: Role "${ctx.apiKeyRole ?? 'none'}" is unauthorized to ${what} (needs ${minimum} or above).`)
}

/** Parses tool arguments, or returns the validation problems as a tool error. */
export function parseToolArgs<T extends z.ZodType>(schema: T, args: unknown): { data: z.infer<T> } | { error: McpToolResult } {
  const parsed = schema.safeParse(args ?? {})
  if (parsed.success) return { data: parsed.data }
  return { error: textResult(`Error: ${parsed.error.issues.map(i => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ')}`) }
}
