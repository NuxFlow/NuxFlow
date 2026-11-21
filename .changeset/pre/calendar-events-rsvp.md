---
"@nuxflow/app": minor
"@nuxflow/db": minor
"@nuxflow/canvas": minor
---

Finish the calendar and events, and add RSVPs.

- Fix scheduling: the editor's date was refused on save, "Schedule" with no date published straight away, and due posts waited until the next UTC midnight
- Fix a published item reverting to draft on its next autosave
- Fix event times moving on every save outside UTC, and all-day events landing on the wrong day
- Events and publish dates are entered and shown in the site's time zone
- Admin calendar: add from a day, drag to move, unscheduled drafts, filters, agenda view, week start, multi-day events
- Events and Posts in the admin menu; event dates required to publish and validated everywhere, MCP included
- Event pages show when and where, with Add to calendar; translations keep event details
- Calendar block: pages through months, links to events, past events, Subscribe link
- Valid, complete calendar feeds (`/events.ics`, one file per event)
- RSVPs with email confirmation, capacity, waitlist with automatic promotion, attendee list, CSV export
