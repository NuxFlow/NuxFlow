---
"@nuxflow/app": patch
"@nuxflow/plugin-canvas": patch
"@nuxflow/plugin-contact-form": patch
---

Implement security enhancements (SSRF protection for backups/imports, Zip bomb/slip validation for restore operations) and edge rate-limiting optimizations using Cloudflare KV/Memory cache. Add new interactive Canvas blocks (Accordion, Button, Pricing) and update Contact Form block dependencies.
