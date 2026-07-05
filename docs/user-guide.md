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

## Media Library & Video Streaming

Manage all your assets in one place.

### Standard Media Library
- **Upload**: Drag and drop images or documents directly into the library.
- **Editing**: Add Alt Text and Captions to improve SEO and accessibility.
- **Focal Point**: Set a focal point for images to control how they are cropped. Click anywhere on the live crop preview to move the focal point; the preview instantly re-centres on that spot so you can see the exact crop before saving.
- **EXIF Metadata**: When you upload a JPEG captured by a camera or smartphone, NuxFlow automatically extracts and displays the camera model, aperture (ƒ-number), shutter speed, ISO, focal length, and capture date from the file's embedded EXIF data. No configuration is required — the data is stored alongside the image record and shown in the media detail panel.

### Video Library (Cloudflare Stream)
For video bloggers and videographers, NuxFlow features an integrated, high-performance video hosting interface powered by Cloudflare Stream:
- **Direct-to-Cloudflare Uploads**: Videos upload directly from your browser to Cloudflare via an XHR request, so very large files upload without hitting server payload limits or edge worker CPU timeouts.
- **Processing & Transcoding**: Once uploaded, videos are processed into adaptive bitrate streams in the background. NuxFlow polls the status automatically and updates the video record once it is ready.
- **Visual Previews**: Play your uploaded videos directly from the dashboard in a popup media player.
- **Copy URL for Canvas**: Open any video's **Manage** panel and click the copy icon next to the Stream URL to copy a ready-to-paste URL for use in a Canvas Video block.
- **Metadata management**: Update video titles and permanently delete videos (including from Cloudflare Stream) from the Videos admin page.

#### Setup (required before uploads will work)

Video uploads require Cloudflare Stream credentials. Configure them once in the admin — no code changes or redeployment needed:

1. Go to **Admin → Settings → Media**.
2. Enter your **Cloudflare Account ID** — visible in the right-hand sidebar on any page of the [Cloudflare dashboard](https://dash.cloudflare.com).
3. Create a **Stream API Token**:
   - In the Cloudflare dashboard, click your profile icon (top right) → **My Profile → API Tokens → Create Token**.
   - Select **Create Custom Token**.
   - Under **Permissions**, add: **Account → Cloudflare Stream → Edit**.
   - Click **Continue to summary → Create Token** and copy the generated token.
4. Paste the token into the **Stream API Token** field and click **Save**.

Once saved, the Videos tab in the media library becomes active immediately. If credentials are missing, upload attempts will show an error message pointing back to this settings page.

> **Cloudflare Stream vs YouTube and Vimeo**: NuxFlow supports all three as embed sources in the Canvas Video block. Use Cloudflare Stream when you want ad-free, branded playback or need to gate video behind a membership tier. Use YouTube or Vimeo for public content where platform discoverability matters — no credentials required. For a full comparison and vlogger workflow, see the **[Video & Vlogging Guide](./video.md)**.


---

## SEO & Settings

### Global Settings
In **Settings > Site**, you can update your site's title, description, and primary language.

### Per-Page SEO
Every Page and Post has an **SEO & Access** panel in the editor sidebar where you can:
- **SEO Title & Meta Description** — with live character-count progress bars (50–60 and 150–160 are the target ranges).
- **Google Snippet Preview** — see exactly how your title, URL slug, and description will appear in a search result card before publishing.
- **Focus Keyword** — enter the primary keyword for the page; NuxFlow checks whether it appears in both the title and description and shows a ✓/✗ indicator for each.
- **Canonical URL** — override the canonical link for this specific page (useful for syndicated content or content that lives under multiple URLs).
- **Robots Override** — set `noindex`, `nofollow`, or combinations per-page, independently of the global setting.
- **OG / Featured Image** — used as `og:image` and as the Twitter card image.
- **Content Access** — control whether the page is public, members-only, or tier-gated.

### Generative Engine Optimization (GEO / LLMO)

NuxFlow bakes AI discoverability features into the routing layer — no plugins or third-party services required.

#### What's auto-generated
- **`/llms.txt`** — a machine-readable Markdown index of your site for AI assistants (ChatGPT, Claude, Perplexity, etc.). Lists your 20 most recent published posts with excerpts, links to your sitemap, feeds, and public API. No configuration needed.
- **`/atom.xml`** — an Atom 1.0 feed alongside the existing RSS 2.0 feed at `/feed.xml`. Both include author attribution and media thumbnail tags for better feed-reader and AI parser support.
- **JSON-LD structured data** — `Article`, `BreadcrumbList`, `Organization`, and `WebSite` (with `SearchAction`) schemas are automatically injected into every public page's `<head>`. These help AI systems and search engines understand your content structure without reading the full page.
- **`image:image` tags in sitemap.xml** — pages with a featured OG image now expose that image URL directly in the sitemap, improving image indexing.
- **`/sitemap-images.xml`** — a dedicated Google Image Sitemap Extension that lists every image in your media library with its alt text and caption. Submit it to Google Search Console so your photos can appear in Google Images search results. The sitemap is cached for one hour and uses the canonical URL configured in **Admin → Settings → SEO**.

#### AI crawler settings
Go to **Admin → SEO → AI Crawlers** to control which AI bots can crawl your site:
- **Allow all AI crawlers** (default) — your site is eligible to be cited as a source in AI-generated answers across ChatGPT, Claude, Perplexity, Google AI, and others.
- **Block all AI crawlers** — adds explicit `Disallow` rules for GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User, anthropic-ai, Googlebot-Extended, cohere-ai, CCBot, Applebot-Extended, and FacebookBot in your `robots.txt`.

> Blocking AI crawlers means your site will not appear in AI-generated answers or recommendations. Allow is recommended for most sites that want discoverability.

### Redirects
Manage **301 and 302 redirects** directly from the dashboard to ensure visitors never hit a 404 page when you move content.

---

## Multilingual Support (i18n)

NuxFlow features native multilingual support that allows you to translate and serve content in multiple languages.

### 1. Translating Content in the Editor
When editing an existing post or page, click the **Translate** button in the top toolbar:
- Select from the dropdown list of 15 pre-configured languages (e.g., Spanish, French, Japanese, Arabic) or enter a custom language code (e.g., `pt-BR`).
- The AI will automatically copy your layout and translate all text, headings, and SEO metadata.
- The translated copy is saved as a new **Draft** linked to the original page, allowing you to edit and review before publishing.

### 2. Managing Translations
- **Badges:** In **Admin → Content**, translations are marked with visual badges (e.g., `ES`, `FR`) and a `Translation` label next to their titles.
- **Language Filtering:** Use the language dropdown selector in the Content header to filter items by language.

### 3. Public Routing & Switching
- **URL Strategy:** Translated pages are served at path-prefixed URLs (e.g., `/es/my-page`). If a visitor lands on a translated URL that has not been published yet, the CMS automatically falls back to showing the original language version.
- **Language Switcher:** A globe dropdown picker appears in the header on pages with available translations, allowing visitors to change languages instantly.

---

## Events System

Manage conferences, workshops, meetups, and webinars, displaying them on calendars and letting visitors subscribe or RSVP.

### 1. Creating Events
NuxFlow includes a built-in `event` content type:
- In the editor sidebar, fill out the **Event Details** card:
  - **Start & End Times:** Input the date and time of the event.
  - **All Day Event Switch:** Toggle if the event spans the full day without specific hours.
  - **Location / Venue:** Enter address or "Online".
  - **Registration URL:** Provide an external registration link (e.g. Zoom, Eventbrite, or checkout page).
- Publish or schedule the event.

### 2. Events Calendar Block
To display events on your website:
- Add the **Events Calendar** block to a Canvas page.
- Choose between **List view** (displays a timeline of event cards) and **Calendar Grid** (displays a month-grid where clicking dates highlights matching events).
- Visitors can click **Add to Calendar** on any event card to generate and download a standard `.ics` file instantly to their device.

### 3. Subscription & Feeds
- **Calendar Feed:** NuxFlow automatically hosts a standards-compliant iCal feed at `/events.ics`. Visitors can copy this link and paste it into Apple Calendar, Google Calendar, or Outlook to subscribe to your events.

---

## AI Writing Assistant

If configured, NuxFlow provides AI-powered tools to help you write:
- **Improve Writing**: Select a paragraph and ask the AI to make it more professional, shorter, or more engaging.
- **SEO Generation**: Let the AI suggest meta titles and descriptions based on your content.
- **Alt Text**: Automatically generate descriptive alt text for your images.

---

## Security & Passkeys

NuxFlow supports state-of-the-art **Passkeys (WebAuthn)** for passwordless, highly secure biometrics-based authentication. This allows you to sign in instantly using Touch ID, Face ID, or external hardware security keys (e.g. YubiKeys).

### Enabling Passkeys for your Account
To register a passkey for passwordless sign-in:
1. Log into the NuxFlow Admin dashboard (`/admin`) using your email and password.
2. Go to **Settings** (click your profile in the sidebar) and navigate to the **Security** tab.
3. Locate the **Passkeys & Passwordless Login** card.
4. Enter a memorable name for your device (e.g. "Work MacBook Pro", "Personal iPhone").
5. Click **Register Passkey**; your browser will trigger a secure system prompt to set up biometrics.
6. Once registered, your device will appear in the **Registered Passkeys** list. You can view, manage, or delete keys at any time.

### Signing In with a Passkey
Once a passkey is registered:
1. Go to the NuxFlow login page at `/login`.
2. Click the **Sign in with Passkey** button.
3. Complete the native biometric or security key prompt. You will be authenticated instantly and redirected straight to the dashboard with zero typing required!

---

## Social Login & Account Linking

If the site administrator has configured Google or GitHub OAuth credentials, you can sign in — and register — using either provider from both the `/login` and `/register` pages.

### Signing in with Google or GitHub

On the login page, click the **Google** or **GitHub** button. You will be redirected to the provider to authenticate, then returned to the admin dashboard automatically.

- **New user:** if no account with your email exists, NuxFlow creates one for you automatically (as long as public registration is enabled).
- **Existing user:** if an account with your email already exists, NuxFlow links the social login to it silently — you land in the dashboard just as you would with your password.

### After onboarding with email & password

The onboarding wizard only supports email and password, so your initial admin account starts as an email/password account. After that, there are two ways to add Google or GitHub sign-in to it:

**Option 1 — Sign in with Google directly (automatic linking)**

Simply click **Google** on the login page. If the Google account's email matches your NuxFlow account email, NuxFlow automatically links them in the background and signs you in. From that point on you can use either method.

**Option 2 — Link manually from Settings**

If you want to link a social account whose email is *different* from your NuxFlow account email, or you prefer to do it explicitly:

1. Sign in with your email and password
2. Go to **Settings → Security**
3. Find the **Connected Social Accounts** card
4. Click **Connect** next to Google or GitHub and complete the OAuth flow

Once connected, the provider appears as **Connected** with the date it was linked. You can disconnect a provider at any time — but you cannot remove your last login method. If you have no password set, you must keep at least one social provider connected.

### If sign-in returns an error

If clicking a social button returns you to the login page with an error message, the most common causes are:

| Error | Meaning |
|---|---|
| "not linked to any NuxFlow account" | The social email does not match any existing account and registration is closed. Sign in with email/password first, then link from Settings → Security. |
| "already connected to a different user" | That Google/GitHub account is already linked to another NuxFlow account. |
| "provider is not enabled" | The site administrator has not configured credentials for this provider. |

---

## Themes

You can change the visual appearance of your site from **Admin → Themes**.

- **Activate**: Switch to any installed theme immediately.
- **Preview**: Open a preview link before committing to a theme.

The built-in Default theme is always available as a fallback. Additional themes can be installed as a zip package from the **Install theme** button or added to the codebase and deployed — see [Adding themes](#adding-themes-and-plugins) below.

---

### Visual Customizer

The **Visual Customizer** is a no-code, full-screen style editor with a live preview of your site running alongside the controls. It is the recommended way for non-technical users to style their site without editing CSS.

**To open it:** go to **Admin → Themes** and click **Open customizer** in the Appearance section, or click the palette icon on any theme card.

The customizer is divided into a controls panel on the left and a live iframe preview on the right. Changes appear in the preview within a fraction of a second — no page reload required.

#### What you can control

| Section | Controls |
|---|---|
| **Appearance** | Colour scheme: Auto (follows visitor's system), Light, or Dark |
| **Colors** | Accent colour — used for buttons, links, and highlights; choose from swatches or enter any hex value. Link colour — defaults to the accent colour; override independently if needed |
| **Background** | Page background colour for Light mode and Dark mode separately — choose from presets or enter any hex value. Leave blank to use the active theme's default |
| **Typography** | Body font and Heading font — choose from 17 Google Fonts across sans-serif, serif, and monospace families. Font size (XS → XL). Heading weight (Light → Extra Bold). Line spacing (Tight / Normal / Relaxed) |
| **Shape** | Corner radius for images, blockquotes, and code blocks — from sharp (None) to fully rounded (Pill) |
| **Layout** | Section spacing — Compact / Normal / Spacious, scales the vertical padding between page sections. Content width — Narrow (720 px) / Default (960 px) / Wide (1200 px) / Full, controls how wide the readable column is inside each section |

#### Device preview

Use the **Desktop / Tablet / Mobile** toggle in the top bar to check how your site looks at each viewport. The iframe resizes to match a real device width.

#### Navigating the preview

The URL bar at the top of the preview panel lets you navigate to any public page on your site. Type a path (e.g. `/about`) and press **Enter** or click **Go**. Style changes follow you across page navigations.

#### Saving and publishing

Changes are applied to the live preview immediately but are **not** saved until you click **Publish** in the top-right corner. When you publish, a CSS theme file is created (or updated) and activated automatically — visitors see your new styles on their next page load.

The **Unsaved** indicator in the title bar reminds you when there are unpublished changes.

#### What the customizer cannot change

Canvas page sections (Hero, Features, CTA banners, etc.) store their background and text colours as individual block settings in the canvas editor, not as global CSS. To change the colour of a specific canvas block, open that page in the Canvas editor and update the block's colour settings directly.

---

### Appearance settings (advanced)

The **Global appearance** card at the bottom of the Themes page exposes the same colour scheme, accent colour, and body font controls as the Visual Customizer, plus a direct save button. Use the Visual Customizer for a live-preview experience; use this card when you just want to tweak one value quickly.

| Setting | What it does |
|---|---|
| **Colour scheme** | `dark` forces dark mode on all public pages; `light` forces light mode; `auto` follows each visitor's system preference |
| **Accent colour** | Injected into every page as the CSS variable `--nuxflow-primary`. Your theme CSS can reference `var(--nuxflow-primary)` to pick up this colour automatically. Also controls the active item highlight in the admin sidebar |
| **Body font** | Injects the chosen Google Font and applies it to the page body via `--nuxflow-font`. Requests are loaded from `fonts.googleapis.com` |

These settings are separate from the active theme CSS file — you can set an accent colour without uploading or editing any CSS. If your theme CSS also hardcodes a colour, the theme's value takes precedence for those specific selectors.

---

### Site logo

Upload a logo image to replace the site name text in the public navigation bar. Configure it at **Admin → Settings → Appearance → Site logo**.

- Accepted formats: PNG, SVG, JPG, WebP
- A transparent background (PNG or SVG) looks best on most themes
- Recommended height: 40–80 px; the image is displayed at a maximum height of 32 px in the header and scales down automatically on smaller screens
- Upload a new image with **Upload logo**, or remove the current logo with **Remove logo** — removing it reverts the header to displaying the site name as text

---

### Custom code injection

Inject third-party scripts or HTML snippets into every public page without editing any files or redeploying. Configure it at **Admin → Settings → Appearance → Custom code**.

| Field | Where it is injected | Typical use |
|---|---|---|
| **Head code** | Before `</head>` | Analytics tags (GA4, Meta Pixel), early-loading scripts, custom font `<link>` tags |
| **Body code** | Before `</body>` | Live chat widgets (Intercom, Crisp), deferred scripts, cookie consent overlays |

> **Security note:** only paste code from sources you trust. The HTML you enter here is injected verbatim into your public pages. It is never shown to logged-in admin users browsing the dashboard, and it is skipped entirely on all `/admin` routes.

---

## Memberships & Payments

NuxFlow includes built-in membership and payment support. Manage it from **Admin → Memberships**.

**Tiers tab**: Create and manage membership tiers with a name, price, billing interval (monthly, yearly, or one-time), and a list of features shown to visitors. When a payment provider is configured, tiers are automatically synced to that provider on creation and update — no manual product setup required.

**Subscribers tab**: View all active and historical subscriptions across Stripe, Lemon Squeezy, and Paddle, with their status and renewal date.

**Content gating**: In the content editor, the **SEO & Access** panel lets you restrict any page or post to `Members only` or a specific tier. Visitors who don't have the required membership see a paywall with available plans.

**Pricing page**: There is no hardcoded `/pricing` route. Instead, add the **Membership Pricing** canvas block to any canvas page (see [Canvas Page Builder](#canvas-page-builder) below). The block fetches your live membership tiers automatically — no content to maintain separately. You can place it at any URL, mix it with other blocks, and highlight a specific tier as "Popular" from the block settings.

**Member account**: Subscribers can view their active plan and cancel at any time from `/account`. Stripe subscribers also get a **Manage billing** link that opens the Stripe Customer Portal for invoice history and payment method updates.

To accept payments, configure at least one payment provider in **Admin → Settings → Payments**. The checkout flow is fully handled server-side; no payment provider credentials are exposed to the browser. See the [Payments Setup Guide](./payments-setup.md) for full instructions.

---

## Canvas Page Builder

Canvas is a visual drag-and-drop page builder built into NuxFlow. It adds a **Canvas** editor mode to any page or post, letting you build layouts from blocks without writing code.

Available blocks include Hero sections, Text, Image, **Gallery**, **Carousel**, Video (supporting YouTube, Vimeo, and Cloudflare Stream), Columns, **Container**, Feature grids, Testimonials, CTA banners, Spacers, Accordions, Pricing Tables (static, for arbitrary marketing copy), **Membership Pricing** (live tier grid wired to the checkout flow), Contact Form, and HTML embeds. Each block has a settings panel for configuring its content and appearance.

#### Nesting blocks

**Columns** and **Container** are layout blocks that hold other blocks inside them, rather than fixed text. Drag any block from the picker (or drag an existing block) into a column or into a Container to nest it — a column can hold an Image, a Button, another Text block, or even another Columns/Container block, to any depth. Container also has its own background colour, padding, and max-width settings, making it useful for grouping a section of blocks with shared framing.

If you reduce a Columns block from 4 columns to 2, the blocks in the hidden columns aren't deleted — they reappear if you switch back to 4 columns.

#### Undo and redo

The Canvas toolbar has undo/redo buttons, and the standard keyboard shortcuts work too: **Ctrl+Z** (**Cmd+Z** on Mac) to undo, **Ctrl+Shift+Z** (or **Ctrl+Y**) to redo. Structural changes — adding, deleting, duplicating, or moving a block — are each a single undo step. Typing in a text field groups into one undo step per pause, so undo doesn't require reverting one keystroke at a time. These shortcuts are automatically disabled while a text field has focus, so they never interfere with normal typing or that field's own undo history.

#### Gallery block

The **Gallery** block renders a responsive image grid. Add images by pasting their URLs one at a time into the Images field in the settings panel. You can set alt text for each image individually. Configure the number of columns (2, 3, or 4), the gap between images, and whether corners are rounded.

Enable **Open lightbox on click** to let visitors view images full-screen. The lightbox supports keyboard navigation (← → arrow keys, Escape to close) and shows a position counter when the gallery has more than one image.

#### Carousel block

The **Carousel** block displays a rotating image slider — popular for hero banners and product showcases. Add images via the Images field in the settings panel, same as the Gallery block.

| Setting | Description |
|---|---|
| **Aspect ratio** | 16:9 (default), 21:9 (cinematic), 4:3, or 1:1. |
| **Autoplay** | Automatically advances slides. Enabled by default. |
| **Autoplay interval (ms)** | How long each slide stays on screen before advancing (only shown when Autoplay is on). |
| **Loop back to start** | When enabled, the carousel wraps from the last slide back to the first (and vice versa). When disabled, the arrows disable themselves at the first/last slide. |
| **Show prev/next arrows** | Toggles the click-through arrow controls. |
| **Show dot navigation** | Toggles the row of dots below the slider for jumping to a specific slide. |
| **Rounded corners** | Rounds the slider's corners. |

Visitors can also swipe on touch devices, or use the ← → arrow keys after clicking/tapping into the carousel. Autoplay pauses automatically while a visitor is hovering over the slider. With a single image, the carousel renders that image statically with no arrows, dots, or autoplay.

#### Image block lightbox

The **Image** block also has an **Open lightbox on click** toggle. When enabled, clicking the image opens it in the same full-screen lightbox — useful for hero shots or detail images where you want to offer a closer view.

#### Video block

The **Video** block embeds a video player on a Canvas page. Paste a URL from YouTube, Vimeo, or Cloudflare Stream into the **Video URL** field — the block detects the source automatically and renders the correct player.

| Setting | Description |
|---|---|
| **Video URL** | YouTube, Vimeo, or Cloudflare Stream URL. |
| **Aspect ratio** | 16:9 (default), 4:3, 1:1, or 9:16. |
| **Caption** | Optional text below the player. |
| **Autoplay** | Starts playback on page load. Enable **Muted** alongside this to ensure browsers allow it. |

To use a Cloudflare Stream video, go to **Admin → Media → Videos**, open the video's **Manage** panel, and click the copy icon next to the Stream URL. Then paste that URL into the Video block.

> For a full vlogger and videographer walkthrough — including when to choose Cloudflare Stream over YouTube, the upload flow, and gating video behind a membership — see the **[Video & Vlogging Guide](./video.md)**.

> For a full photography portfolio walkthrough — including EXIF display, focal point setup, the blog grid layout, and the image sitemap — see the **[Photography & Portfolio Guide](./photography.md)**.

To use Canvas on a piece of content, open the content item and switch the editor mode to **Canvas editor** using the toggle at the top of the editor.

---

## Blog

The public blog index is available at `/blog`. It lists all published posts with their title, excerpt, featured image, and publication date.

Visitors can switch between two display layouts using the toggle in the top-right corner of the page:

- **List view** — a single column with large featured images and excerpts. Good for text-heavy writing.
- **Grid view** — a responsive card grid (1 column on mobile, 2 on tablet, 3 on desktop) where each card shows a 4:3 cropped version of the featured image. Good for photography-driven content.

The chosen layout is saved to the visitor's browser and persists across page loads.

> Set an **OG / Featured Image** on each post in the SEO panel of the content editor. Posts without a featured image show a placeholder in grid view.

---

## Contact Forms

Contact Forms are built into NuxFlow. The **Contact Form** block can be placed on any Canvas page, and all submissions are collected in the inbox at **Admin → Contact Forms**.

When the block is placed on a page, visitors can submit their name, email, subject, and message. Submissions are protected by Cloudflare Turnstile spam detection (when configured) and rate-limited automatically.

From the inbox you can view each submission, mark it as read, archive it, mark it as spam, or reply directly via email.

To receive email notifications when a new message arrives, set a **Notification email** in **Admin → Settings**.

---

## Plugins

The **Admin → Plugins** page manages dynamic third-party plugins. NuxFlow does not use bundled plugins — all built-in features (Canvas, Contact Forms, Memberships, HTML embeds) are part of core.

**Dynamic plugins** run as isolated Cloudflare Workers spawned on demand from code stored in KV. They can be uploaded and activated from the dashboard without redeploying your site — a capability unique to the Cloudflare Workers platform.

A dynamic plugin bundle consists of up to two parts:

- **Server module**: a self-contained ES module that exports a `fetch` handler (`export default { async fetch(request) { ... } }`). It receives requests forwarded to `/_nuxflow/ext/{pluginId}/...`.
- **Client bundle**: an ES module that exports a `register(app, registry, vue)` function. NuxFlow loads this in the browser and calls `register` to add Canvas blocks or Vue components to the page.

For a complete guide to building and deploying your own dynamic plugin, see the **[External Plugin Development Guide](./plugins.md)**.

---

## Adding Themes and Custom Plugins

### Dynamic plugins (no redeploy required)

To install a dynamic plugin, build it with the NuxFlow CLI and run `nuxflow plugin deploy` — or go to **Admin → Plugins** and use the **Upload plugin** button to paste a pre-built bundle directly.

Community packages follow the naming convention `nuxflow-plugin-*` on npm.

### Themes (no redeploy required)

Themes are CSS files uploaded through **Admin → Themes → Install theme**. Switching themes is instant and does not affect live visitors until **Activate** is clicked.
