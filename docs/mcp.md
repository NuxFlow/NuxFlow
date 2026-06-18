# Model Context Protocol (MCP) Server Integration

NuxFlow includes a native, edge-compatible **Model Context Protocol (MCP)** server. This allows AI agents and coding assistants (such as Claude Desktop, Cursor, Gemini, or custom LLM clients) to read, create, update, and manage your website's content directly through secure, type-safe API requests.

With the MCP integration, you can ask your AI assistant to:
- *"Draft a new blog post about Edge Computing and publish it."*
- *"Fetch our 'About Us' page and rewrite the second paragraph to be more engaging."*
- *"List all drafted pages on our site and check their SEO titles."*

---

## 🚀 How it Works

The MCP server runs natively on NuxFlow's edge runtime (Cloudflare Workers / D1) at the endpoint `/api/v1/mcp`. It supports:
1. **GET (SSE Handshake)**: Establishes a Server-Sent Events (SSE) stream, returning a unique `sessionId` mapped to `/api/v1/mcp?sessionId=...`.
2. **POST (JSON-RPC 2.0)**: Processes JSON-RPC 2.0 message payloads (containing methods like `initialize`, `tools/list`, and `tools/call`) and pushes results back through the SSE stream.

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

The MCP server exposes five high-performance content manipulation tools:

### 1. `list_content`
List pages or posts in the NuxFlow CMS.
* **Arguments**:
  - `type` (string, optional): Filter by content type slug (`page` or `post`, default: `page`).
  - `status` (string, optional): Filter by publish status (`draft`, `review`, `published`, `scheduled`, `archived`).
  - `limit` (number, optional): Maximum number of items to return (default: `20`, max: `50`).

### 2. `get_content`
Get full details (including body content, slug, and metadata) of a specific page or post.
* **Arguments** (must provide at least one):
  - `id` (string): The unique 26-character ULID of the content item.
  - `slug` (string): The URL slug of the content item.

### 3. `create_content`
Create a new page or post drafted by the AI assistant.
* **Arguments**:
  - `title` (string, required): The title of the page/post.
  - `slug` (string, required): The URL slug for the page/post.
  - `content` (string, optional): The text or HTML body content.
  - `type` (string, optional): The content type slug (`page` or `post`, default: `page`).
  - `status` (string, optional): The status (`draft` or `published`, default: `draft`).

### 4. `update_content`
Update the title, content, slug, or status of an existing page or post.
* **Arguments**:
  - `id` (string, required): The 26-character ULID of the content item to update.
  - `title` (string, optional): The new title.
  - `slug` (string, optional): The new slug.
  - `content` (string, optional): The new content text or HTML.
  - `status` (string, optional): The new status (`draft`, `review`, `published`, `scheduled`, `archived`).

### 5. `delete_content`
Permanently delete a page or post.
* **Arguments**:
  - `id` (string, required): The unique 26-character ULID of the content item to delete.
* **Security Note**: This tool requires the authenticated API key to be associated with an `editor`, `admin`, or `super_admin` role.

---

## 💻 Claude Desktop Configuration Example

To connect your **Claude Desktop** application to the NuxFlow MCP server, add an entry to your Claude Desktop configuration file (typically located at `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "nuxflow-cms": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-cli",
        "sse",
        "https://your-nuxflow-domain.com/api/v1/mcp"
      ],
      "env": {
        "Authorization": "Bearer <your_nuxflow_api_key>"
      }
    }
  }
}
```

Replace `https://your-nuxflow-domain.com` with your live edge site domain and `<your_nuxflow_api_key>` with the API token generated in your dashboard. Restart Claude Desktop, and your AI assistant will immediately see the NuxFlow content tools!
