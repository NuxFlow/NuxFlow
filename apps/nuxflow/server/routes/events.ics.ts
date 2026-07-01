import { useDb } from '../utils/db'
import { contentItems, contentTypes, sites } from '@nuxflow/db/schema'
import { and, eq, gte, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  if (!siteId) throw createError({ statusCode: 404 })

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true }
  })
  if (!site) throw createError({ statusCode: 404 })

  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'event')),
    columns: { id: true },
  })
  if (!type) {
    setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//NuxFlow//NuxFlow Events//EN\r\nEND:VCALENDAR\r\n`
  }

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const fromTs = ninetyDaysAgo.toISOString()

  const rows = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.status, 'published'),
      gte(contentItems.eventStartAt, fromTs)
    ),
    orderBy: [desc(contentItems.eventStartAt)],
    limit: 100
  })

  // Format Helper to convert Date/ISO to iCal stamp YYYYMMDDTHHMMSSZ or YYYYMMDD
  const formatStamp = (isoStr: string | null | undefined, allDay: boolean): string => {
    if (!isoStr) return ''
    const parts = isoStr.replace(/[-:]/g, '').split('.')
    const clean = parts[0] || ''
    if (allDay) {
      return clean.substring(0, 8)
    }
    return clean.endsWith('Z') ? clean : `${clean}Z`
  }

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NuxFlow//NuxFlow Events//EN',
    `X-WR-CALNAME:${site.name} Events`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ]

  for (const row of rows) {
    if (!row.eventStartAt) continue
    const dtStamp = formatStamp(row.updatedAt || row.publishedAt || new Date().toISOString(), false)
    const dtStart = formatStamp(row.eventStartAt, !!row.eventAllDay)
    
    let dtEnd: string
    if (row.eventEndAt) {
      dtEnd = formatStamp(row.eventEndAt, !!row.eventAllDay)
    } else {
      // Default end to 1 hour after or same day for allDay
      if (row.eventAllDay) {
        // All day end date is non-inclusive, so add 1 day
        const endD = new Date(row.eventStartAt)
        endD.setDate(endD.getDate() + 1)
        dtEnd = formatStamp(endD.toISOString(), true)
      } else {
        const endD = new Date(row.eventStartAt)
        endD.setHours(endD.getHours() + 1)
        dtEnd = formatStamp(endD.toISOString(), false)
      }
    }

    ics.push('BEGIN:VEVENT')
    ics.push(`UID:${row.id}@${site.domain}`)
    ics.push(`DTSTAMP:${dtStamp}`)
    if (row.eventAllDay) {
      ics.push(`DTSTART;VALUE=DATE:${dtStart}`)
      ics.push(`DTEND;VALUE=DATE:${dtEnd}`)
    } else {
      ics.push(`DTSTART:${dtStart}`)
      ics.push(`DTEND:${dtEnd}`)
    }
    ics.push(`SUMMARY:${row.title}`)
    if (row.excerpt) {
      ics.push(`DESCRIPTION:${row.excerpt.replace(/\n/g, '\\n')}`)
    }
    if (row.eventLocation) {
      ics.push(`LOCATION:${row.eventLocation}`)
    }
    if (row.eventUrl) {
      ics.push(`URL:${row.eventUrl}`)
    }
    ics.push('END:VEVENT')
  }

  ics.push('END:VCALENDAR')
  ics.push('') // final newline

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return ics.join('\r\n')
})
