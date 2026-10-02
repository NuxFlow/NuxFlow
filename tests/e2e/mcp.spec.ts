import { test, expect } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from apps/nuxflow/.env
dotenv.config({ path: path.resolve(__dirname, '../../apps/nuxflow/.env') })

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787'

test.describe('NuxFlow Model Context Protocol (MCP) Server E2E Integration', () => {
  let apiKey: string
  let apiKeyId: string

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000)

    // 1. Log into the Admin panel using test credentials
    await page.goto(`${BASE_URL}/login`)
    await expect(page.locator('h1')).toContainText('Sign in to NuxFlow', { timeout: 15000 })
    await page.waitForTimeout(1000)

    const email = process.env.TEST_ADMIN_EMAIL
    const password = process.env.TEST_ADMIN_PASSWORD
    if (!email || !password) {
      throw new Error('E2E credentials not found in apps/nuxflow/.env. Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD.')
    }

    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.locator('button[type="submit"]:has-text("Sign in")').click()

    // Wait for redirect to confirm active session
    await expect(page.locator('h1.text-2xl')).toHaveText(/Good\s+morning|Good\s+afternoon|Good\s+evening/, { timeout: 20000 })

    // 2. Generate a temporary API Key using the browser session for authentication
    const keyData = await page.evaluate(async () => {
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E MCP Testing Token',
          scopes: ['read:content', 'write:content']
        })
      })
      if (!res.ok) throw new Error(`Failed to generate key: ${res.status}`)
      return await res.json()
    })

    apiKey = keyData.key
    apiKeyId = keyData.id
    console.log(`[TEST SETUP] Successfully generated temporary API Key: ${apiKeyId}`)
  })

  test.afterEach(async ({ page }) => {
    if (apiKeyId) {
      // Clean up the temporary API key after testing
      await page.evaluate(async (id) => {
        await fetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' })
      }, apiKeyId)
      console.log(`[TEST TEARDOWN] Revoked temporary API Key: ${apiKeyId}`)
    }
  })

  test('should reject unauthorized requests', async ({ request }) => {
    // Attempt request without Bearer authorization
    const res = await request.post(`${BASE_URL}/api/v1/mcp`, {
      data: {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1
      }
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.message).toContain('Unauthorized')
  })

  test('should execute complete MCP protocol and tools content CRUD loop', async ({ request }) => {
    // 1. Initialize Handshake
    console.log('[MCP TEST] 1. Initializing handshake...')
    const initRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 101
      }
    })
    expect(initRes.status()).toBe(200)
    const initPayload = await initRes.json()
    expect(initPayload.result.protocolVersion).toBe('2024-11-05')
    expect(initPayload.result.serverInfo.name).toBe('nuxflow-mcp')

    // 2. List tools
    console.log('[MCP TEST] 2. Querying tools/list...')
    const listRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 102
      }
    })
    expect(listRes.status()).toBe(200)
    const listPayload = await listRes.json()
    const tools = listPayload.result.tools
    expect(tools.length).toBeGreaterThanOrEqual(4)
    expect(tools.some((t: any) => t.name === 'create_content')).toBe(true)

    // 3. Create content
    console.log('[MCP TEST] 3. Calling create_content tool...')
    const testSlug = `e2e-mcp-page-${Date.now()}`
    const createRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create_content',
          arguments: {
            title: 'MCP E2E Verification Page',
            slug: testSlug,
            content: '<p>This page was drafted by an automated E2E test via the MCP protocol server.</p>',
            status: 'draft',
            type: 'page'
          }
        },
        id: 103
      }
    })
    expect(createRes.status()).toBe(200)
    const createPayload = await createRes.json()
    const createResultText = createPayload.result.content[0].text
    expect(createResultText).toContain('Success: Content item successfully created')
    
    // Extract ULID from response string
    const ulidMatch = createResultText.match(/[0-9A-Z]{26}/)
    expect(ulidMatch).not.toBeNull()
    const pageId = ulidMatch[0]
    console.log(`[MCP TEST] Created content item with ID: ${pageId}`)

    // 4. Get content details
    console.log('[MCP TEST] 4. Calling get_content tool...')
    const getRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_content',
          arguments: { id: pageId }
        },
        id: 104
      }
    })
    expect(getRes.status()).toBe(200)
    const getPayload = await getRes.json()
    const itemData = JSON.parse(getPayload.result.content[0].text)
    expect(itemData.id).toBe(pageId)
    expect(itemData.title).toBe('MCP E2E Verification Page')
    expect(itemData.slug).toBe(testSlug)
    expect(itemData.status).toBe('draft')

    // 5. Update content
    console.log('[MCP TEST] 5. Calling update_content tool...')
    const updateRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'update_content',
          arguments: {
            id: pageId,
            title: 'MCP E2E Verification Page (Updated)',
            status: 'published'
          }
        },
        id: 105
      }
    })
    expect(updateRes.status()).toBe(200)
    const updatePayload = await updateRes.json()
    expect(updatePayload.result.content[0].text).toContain('Success')

    // Verify update
    const getUpdatedRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_content',
          arguments: { id: pageId }
        },
        id: 106
      }
    })
    const getUpdatedPayload = await getUpdatedRes.json()
    const updatedData = JSON.parse(getUpdatedPayload.result.content[0].text)
    expect(updatedData.title).toBe('MCP E2E Verification Page (Updated)')
    expect(updatedData.status).toBe('published')

    // 6. Delete content
    console.log('[MCP TEST] 6. Calling delete_content tool...')
    const deleteRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'delete_content',
          arguments: { id: pageId }
        },
        id: 107
      }
    })
    expect(deleteRes.status()).toBe(200)
    const deletePayload = await deleteRes.json()
    expect(deletePayload.result.content[0].text).toContain('Success')

    // Verify deletion
    const getDeletedRes = await request.post(`${BASE_URL}/api/v1/mcp`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_content',
          arguments: { id: pageId }
        },
        id: 108
      }
    })
    const getDeletedPayload = await getDeletedRes.json()
    expect(getDeletedPayload.result.content[0].text).toContain('Error: Content item not found')
    console.log('[MCP TEST] Verification page successfully deleted!')
  })
})
