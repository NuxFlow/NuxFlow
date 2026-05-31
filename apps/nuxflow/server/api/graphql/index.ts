import { createYoga, createSchema } from 'graphql-yoga'
import type { H3Event } from 'h3'
import { useDb } from '../../utils/db'
import { contentItems, media } from '@nuxflow/db/schema'
import { and, eq, desc, like } from 'drizzle-orm'

const typeDefs = /* GraphQL */ `
  type ContentItem {
    id: ID!
    title: String!
    slug: String!
    status: String!
    content: String
    seoTitle: String
    seoDescription: String
    publishedAt: String
    updatedAt: String!
  }

  type MediaItem {
    id: ID!
    url: String!
    originalName: String!
    mimeType: String!
    altText: String
    width: Int
    height: Int
  }

  type Query {
    contentList(type: String, status: String, q: String, limit: Int, offset: Int): [ContentItem!]!
    contentItem(id: ID, slug: String): ContentItem
    mediaList(limit: Int, offset: Int): [MediaItem!]!
  }
`

interface GraphqlCtx {
  siteId: string
  isAuthenticated: boolean
  event: H3Event
}

const resolvers = {
  Query: {
    async contentList(
      _: unknown,
      args: { type?: string; status?: string; q?: string; limit?: number; offset?: number },
      ctx: GraphqlCtx,
    ) {
      const db = useDb(ctx.event)
      const where = [eq(contentItems.siteId, ctx.siteId)]

      // Unauthenticated requests only see published content
      if (!ctx.isAuthenticated) {
        where.push(eq(contentItems.status, 'published'))
      } else if (args.status) {
        where.push(eq(contentItems.status, args.status as 'draft'))
      }

      if (args.q) where.push(like(contentItems.title, `%${args.q}%`))

      return db.query.contentItems.findMany({
        where: and(...where),
        orderBy: [desc(contentItems.updatedAt)],
        limit: Math.min(args.limit ?? 20, 100),
        offset: args.offset ?? 0,
      })
    },

    async contentItem(_: unknown, args: { id?: string; slug?: string }, ctx: GraphqlCtx) {
      const db = useDb(ctx.event)
      if (args.id) {
        const item = await db.query.contentItems.findFirst({
          where: and(eq(contentItems.id, args.id), eq(contentItems.siteId, ctx.siteId)),
        })
        // Unauthenticated requests can only see published items
        if (item && !ctx.isAuthenticated && item.status !== 'published') return null
        return item ?? null
      }
      if (args.slug) {
        return db.query.contentItems.findFirst({
          where: and(
            eq(contentItems.slug, args.slug),
            eq(contentItems.siteId, ctx.siteId),
            eq(contentItems.status, 'published'),
          ),
        }) ?? null
      }
      return null
    },

    async mediaList(_: unknown, args: { limit?: number; offset?: number }, ctx: GraphqlCtx) {
      const db = useDb(ctx.event)
      return db.query.media.findMany({
        where: eq(media.siteId, ctx.siteId),
        limit: Math.min(args.limit ?? 20, 100),
        offset: args.offset ?? 0,
      })
    },
  },
}

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/api/graphql',
  // Context is supplied per-request from the Nitro event handler below
  context: (serverCtx) => serverCtx as unknown as GraphqlCtx,
})

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const session = await getUserSession(event).catch(() => null)
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const isAuthenticated = Boolean(session?.user?.id || apiKeyUserId)

  return yoga.fetch(toWebRequest(event), { siteId, isAuthenticated, event })
})
