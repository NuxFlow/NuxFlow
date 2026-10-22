# Model Context Protocol (MCP) Server Integration

NuxFlow includes a native, edge-compatible **Model Context Protocol (MCP)** server. This allows AI agents and coding assistants (such as Claude Desktop, Cursor, Gemini, or custom LLM clients) to read, create, update, and manage your website's content directly through secure, type-safe API requests.

With the MCP integration, you can ask your AI assistant to:
- *"Draft a new blog post about Edge Computing and publish it."*
- *"Fetch our 'About Us' page and rewrite the second paragraph to be more engaging."*
- *"List all drafted pages on our site and check their SEO titles."*

---

## 🚀 How it Works

The MCP server lives at `/api/v1/mcp` on each site and speaks the **Streamable HTTP** transport (protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`). Each JSON-RPC message (`initialize`, `tools/list`, `tools/call`, `ping`) is one `POST`, answered in that request's JSON body. The server keeps no session between requests, so it works on every Cloudflare location. `GET` returns `405`: the server never opens a server-to-client stream.

The older HTTP+SSE transport (a `GET` stream plus `POST ?sessionId=`) is no longer supported. Point your client at the same URL using its "HTTP" or "Streamable HTTP" option.

---

## 🔒 Authentication

All MCP requests must be authenticated. 

1. Navigate to your NuxFlow Dashboard at `/admin`.
2. Go to **Settings > API Keys** (or **Developer Settings**).
3. Generate a new API key with the following minimum scopes:
   - `read:content` (required to list or get content)
   - `write:content` (required to create, update, or delete content)
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
| `create_content` | `write:content` | Creates a page or post. |
| `update_content` | `write:content` | Changes an item's title, slug, content or status. |
| `set_content_terms` | `write:content` | Replaces an item's categories/tags, given as `taxonomy/term` paths. |
| `delete_content` | `write:content` | Permanently deletes an item. |

Each tool also checks the key owner's role on the site, the same as the admin API: an `author` can only edit their own drafts and can't publish, and deleting needs `editor` or above. `tools/list` returns every tool's exact input schema.

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
