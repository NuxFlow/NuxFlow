# Model Context Protocol (MCP) Server Integration

NuxFlow includes a native, edge-compatible **Model Context Protocol (MCP)** server. This allows AI agents and coding assistants (such as Claude Desktop, Cursor, Gemini, or custom LLM clients) to read, create, update, and manage your website's content directly through secure, type-safe API requests.

With the MCP integration, you can ask your AI assistant to:
- *"Draft a new blog post about Edge Computing and publish it."*
- *"Fetch our 'About Us' page and rewrite the second paragraph to be more engaging."*
- *"List all drafted pages on our site and check their SEO titles."*
- *"Find every image without alt text and write a description for each."*
- *"Add a Contact link to the header menu."*
- *"I renamed /services to /what-we-do — set up the redirect."*
- *"Summarise this week's contact form messages and tell me which ones need a reply."*

---

## 🚀 How it Works

The MCP server lives at `/api/v1/mcp` on each site and speaks the **Streamable HTTP** transport (protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`). Each JSON-RPC message (`initialize`, `tools/list`, `tools/call`, `ping`) is one `POST`, answered in that request's JSON body. The server keeps no session between requests, so it works on every Cloudflare location. `GET` returns `405`: the server never opens a server-to-client stream.

The older HTTP+SSE transport (a `GET` stream plus `POST ?sessionId=`) is no longer supported. Point your client at the same URL using its "HTTP" or "Streamable HTTP" option.

---

## 🔒 Authentication

All MCP requests must be authenticated. 

1. Navigate to your NuxFlow Dashboard at `/admin`.
2. Go to **Settings → API keys**.
3. Generate a new API key with the scopes the assistant needs:
   - `read:content` — read pages, posts, media, menus and redirects
   - `write:content` — create, change and delete them, and upload media
   - `read:personal` — read form submissions. These are people's names, email addresses and messages, so only tick it for a key that needs them.
   - `manage:settings` — change the look and basic settings (see below)
4. Authenticate your MCP client by adding the API key in the request headers:
   ```http
   Authorization: Bearer <your_api_key_here>
   ```

---

## 🛠️ Supported Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_content` | `read:content` | Lists pages or posts, filtered by type and status. |
| `get_content` | `read:content` | Gets one item by `id` or `slug`, with its body and taxonomy terms. |
| `search_content` | `read:content` | Finds published content by topic or keyword (semantic search when Vectorize is set up, keyword search otherwise). |
| `list_taxonomies` | `read:content` | Lists the site's taxonomies and their terms as `taxonomy/term` paths. |
| `create_content` | `write:content` | Creates a page, post or event, including an event's dates, repeat rule, price and booking settings. |
| `update_content` | `write:content` | Changes an item's title, slug, content or status, or an event's details. Moving or removing dates tells the people booked, and refunds them if a date is gone. |
| `set_content_terms` | `write:content` | Replaces an item's categories/tags, given as `taxonomy/term` paths. |
| `delete_content` | `write:content` | Permanently deletes an item. Refused for an event with paid upcoming bookings. |
| `get_site_settings` | `read:content` | Lists the settings an AI assistant may change (light/dark mode, accent colour, fonts, header options, homepage search title and description, site name), with their values and what's allowed. |
| `update_site_settings` | `manage:settings` | Changes those settings, and only those. Needs an admin's key. Nothing is saved if any value is invalid. Recorded in **Settings → Audit log** as **AI-assisted**, with the request. |
| `list_media` | `read:content` | Lists the media library, newest first, with each file's URL, size, alt text and focal point. Filters: name, kind (image/video/audio/pdf), folder, images missing alt text. |
| `update_media` | `write:content` | Sets a file's alt text, caption or focal point. Author or above. |
| `upload_media` | `write:content` | Adds a file from a public URL (up to 20 MB) or as base64 (up to 5 MB). Same file types, SVG cleaning and storage limit as uploading in the admin. Needs file storage (R2). Author or above. |
| `list_menus` | `read:content` | Lists menus, where each shows (header, footer, sidebar), and their links. |
| `create_menu` / `update_menu` / `delete_menu` | `write:content` | Creates, renames, moves or deletes a menu, or replaces its links. Links point at a page by its slug or at a URL. Editor or above. |
| `list_redirects` | `read:content` | Lists redirects. Editor or above. |
| `create_redirect` / `delete_redirect` | `write:content` | Adds a redirect (301, 302, 307, 308 or 410 Gone) or removes one. Chains are flattened, as in **SEO → Redirects**. Editor or above. |
| `list_forms` | `read:personal` | Lists forms with their fields and how many submissions are new. Editor or above. |
| `list_form_submissions` | `read:personal` | Reads a form's submissions, newest first (spam and archived left out unless asked). IP addresses and browsers are never included, and uploaded files appear by name only. Editor or above. |

The settings tools are the same short, safe list the admin's own **Ask AI** helper can suggest. Credentials, the domain, custom code, payments and people can't be changed over MCP. The assistant is told to show you each change and get your agreement before calling `update_site_settings`. Your MCP client also asks you to approve each tool call, so read what it is about to change.

Each tool also checks the key owner's role on the site, the same as the admin API: an `author` can only edit their own drafts and can't publish, and deleting needs `editor` or above. Every change is recorded in **Settings → Audit log** under the key owner's name. `tools/list` returns every tool's exact input schema. A refused call comes back as a tool result with `isError: true` and a plain-English reason, so the assistant can explain it or try again.

---

## 💻 Connecting a Client

**Claude Code:**

```bash
claude mcp add --transport http nuxflow https://your-site.com/api/v1/mcp   --header "Authorization: Bearer <your_nuxflow_api_key>"
```

**Claude Desktop** (which starts local servers only) goes through the `mcp-remote` bridge. Add this to `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "nuxflow": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-site.com/api/v1/mcp", "--header", "Authorization:${NUXFLOW_AUTH}"],
      "env": { "NUXFLOW_AUTH": "Bearer <your_nuxflow_api_key>" }
    }
  }
}
```

Other clients (Cursor, custom agents) take the same URL and `Authorization` header in their HTTP transport settings. Replace `https://your-site.com` with your site's domain and restart the client.
