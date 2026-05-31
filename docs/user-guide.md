# NuxFlow User Guide

Welcome to NuxFlow, the modern, edge-deployed CMS. This guide will help you navigate the dashboard and manage your content effectively.

## Getting Started

When you first install NuxFlow, you will be greeted by the **Setup Wizard**. This guide will help you configure your site name, administrator account, and initial settings without ever touching a configuration file.

Once setup is complete, you can access the admin dashboard at `/admin`.

---

## The Dashboard

The dashboard provides a high-level overview of your site's health and activity:
- **Quick Actions**: Create a new post or page instantly.
- **Recent Activity**: See recent content updates and user logins.
- **Site Stats**: (If configured) View traffic and submission data.

---

## Content Management

### Pages vs. Posts
- **Pages**: Static content like "About Us", "Contact", or your Homepage.
- **Posts**: Dynamic, date-ordered content like blog entries or news updates.

### The Block Editor
NuxFlow features a powerful, visual block editor. You can build complex layouts by stacking blocks:
- **Text Blocks**: Paragraphs, Headings (H1-H6), and Blockquotes.
- **Media Blocks**: Images, Videos, and Galleries.
- **Layout Blocks**: Dividers and Tables.
- **Interactive Blocks**: Buttons and embedded Forms.

**Tip**: You can drag and drop blocks to reorder them at any time.

### Workflow States
Content follows a simple workflow:
1.  **Draft**: Only visible to editors in the dashboard.
2.  **Pending Review**: (Optional) Ready for an Admin to approve.
3.  **Scheduled**: Will go live automatically at a future date.
4.  **Published**: Live on your website.
5.  **Archived**: Hidden from the site but preserved in the database.

---

## Media Library

Manage all your assets in one place.
- **Upload**: Drag and drop images or videos directly into the library.
- **Editing**: Add Alt Text and Captions to improve SEO and accessibility.
- **Focal Point**: Set a focal point for images to ensure they crop correctly on different screen sizes.

---

## SEO & Settings

### Global Settings
In **Settings > Site**, you can update your site's title, description, and primary language.

### Per-Page SEO
Every Page and Post has an **SEO Tab** where you can:
- Customize the Meta Title and Description.
- Preview how the page will look on Google and Social Media.
- Manage Open Graph (OG) images for sharing.

### Redirects
Manage **301 and 302 redirects** directly from the dashboard to ensure visitors never hit a 404 page when you move content.

---

## AI Writing Assistant

If configured, NuxFlow provides AI-powered tools to help you write:
- **Improve Writing**: Select a paragraph and ask the AI to make it more professional, shorter, or more engaging.
- **SEO Generation**: Let the AI suggest meta titles and descriptions based on your content.
- **Alt Text**: Automatically generate descriptive alt text for your images.

---

## Themes

You can change the visual appearance of your site from **Admin → Themes**.

- **Activate**: Switch to any installed theme immediately.
- **Preview**: Open a preview link before committing to a theme.

The built-in Default theme is always available as a fallback. Additional themes can be installed as a zip package from the **Install theme** button or added to the codebase and deployed — see [Adding themes](#adding-themes-and-plugins) below.

### Appearance settings

The **Appearance** card at the bottom of the Themes page controls three global settings that apply to every public-facing page on your site. They take effect on the next page load.

| Setting | What it does |
|---|---|
| **Colour scheme** | `dark` forces dark mode on all public pages; `light` forces light mode; `auto` follows each visitor's system preference |
| **Accent colour** | Injected into every page as the CSS variable `--nuxflow-primary`. Your theme CSS can reference `var(--nuxflow-primary)` to pick up this colour automatically. Also controls the active item highlight in the admin sidebar |
| **Body font** | Injects the chosen Google Font and applies it to the page body via `--nuxflow-font`. Requests are loaded from `fonts.googleapis.com` |

These settings are separate from the active theme CSS file — you can set an accent colour without uploading or editing any CSS. If your theme CSS also hardcodes a colour, the theme's value takes precedence for those specific selectors.

---

## Plugins

NuxFlow supports two kinds of plugins, both managed from **Admin → Plugins**.

**Bundled plugins** are compiled into the Worker at deploy time and support deep framework integration such as custom content types and admin pages. NuxFlow ships with three bundled plugins out of the box.

**Dynamic plugins** run as isolated Cloudflare Workers spawned on demand from code stored in KV. They can be uploaded and activated from the dashboard without redeploying your site — a capability unique to the Cloudflare Workers platform.

### Canvas Page Builder

Canvas is a visual drag-and-drop page builder. When enabled, it adds a **Canvas** editor mode to any page or post, letting you build layouts from blocks without writing code.

Available blocks include Hero sections, Text, Image, Video, Columns, Feature grids, Testimonials, CTA banners, and Spacers. Each block has a settings panel for configuring its content and appearance.

To use Canvas on a piece of content, open the content item and switch the editor mode to **Canvas editor** using the toggle at the top of the editor.

### Contact Form

The Contact Form plugin provides an embeddable `ContactForm` block and a submission inbox at **Admin → Plugins → Contact Forms**.

When the block is placed on a page, visitors can submit their name, email, subject, and message. Submissions are protected by Cloudflare Turnstile spam detection (when configured) and rate-limited automatically.

From the inbox you can view each submission, mark it as read, archive it, mark it as spam, or reply directly via email.

To receive email notifications when a new message arrives, set a **Notification email** in **Admin → Settings**.

### Payments & Memberships

The Payments plugin adds subscription tiers and content gating. Manage it from **Admin → Memberships**.

**Tiers tab**: Create and manage membership tiers with a name, price, billing interval (monthly, yearly, or one-time), and a list of features shown to visitors. Tiers can be deactivated without deleting them.

**Subscribers tab**: View all active and historical subscriptions across Stripe, Lemon Squeezy, and Paddle, with their status and renewal date.

To accept payments, configure at least one payment provider by adding the relevant secrets — see the [Installation Guide](./installation.md) for the required environment variables. The checkout flow is fully handled server-side; no payment provider credentials are exposed to the browser.

---

## Adding Themes and Plugins

### Dynamic plugins (no redeploy required)

Dynamic plugins run as isolated Cloudflare Workers and are stored in a KV namespace. To install one, build it with the NuxFlow CLI and run `nuxflow plugin deploy` — or go to **Admin → Plugins** and use the **Upload plugin** button to paste a pre-built bundle directly.

A dynamic plugin bundle consists of up to two parts:

- **Server module**: a self-contained ES module that exports a `fetch` handler (`export default { async fetch(request) { ... } }`). It receives requests forwarded to `/_nuxflow/ext/{pluginId}/...`.
- **Client bundle**: an ES module that exports a `register(app, registry, vue)` function. NuxFlow loads this in the browser and calls `register` to add Canvas blocks or Vue components to the page.

For a complete guide to building and deploying your own dynamic plugin, see the **[External Plugin Development Guide](./plugins.md)**.

### Bundled plugins and themes (requires redeploy)

For plugins that need deeper integration — custom content types, Drizzle schema extensions, or new admin pages — add them to the codebase and redeploy.

```bash
# 1. Add the package and register it automatically
npx nuxflow add @author/package-name

# 2. Rebuild and redeploy
pnpm build && wrangler deploy
```

Once deployed, return to **Admin → Plugins** or **Admin → Themes** and click **Install** or **Activate**.

Community packages follow the naming conventions `nuxflow-plugin-*` and `nuxflow-theme-*` on npm.
