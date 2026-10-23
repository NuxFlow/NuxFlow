# Video & Vlogging Guide

NuxFlow gives videographers and vloggers two complementary ways to publish video content: self-hosted adaptive streaming via Cloudflare Stream, and embedded players from YouTube or Vimeo. You can use both on the same site. This guide explains when to choose each approach and walks through the full workflow from upload to published page.

---

## Cloudflare Stream vs YouTube and Vimeo

Both approaches use the same Canvas Video block on your pages. The difference is where the video is stored and who controls the playback experience.

**Use YouTube or Vimeo when** you want public discoverability on those platforms, free hosting, and no additional configuration. Viewers on your site see the YouTube or Vimeo player, complete with that platform's branding and, in YouTube's case, related videos and potential ads at the end. This is a good fit for public-facing content where being found on YouTube is part of your strategy.

**Use Cloudflare Stream when** you want to own the experience end-to-end. Videos hosted on Stream play in a clean, branded iframe with no ads, no platform branding, and no "recommended videos" sidebar. Because the video lives inside your NuxFlow media library, you can gate it behind a membership tier — for example, making a full-length tutorial available to paying subscribers while keeping a short preview public on YouTube. Stream also delivers video over Cloudflare's global network, so playback is fast regardless of where your visitors are.

Cloudflare Stream is billed separately from the Workers Paid plan: $5 a month per 1,000 minutes of video stored, plus $1 per 1,000 minutes watched. If you do not configure Stream credentials, the YouTube and Vimeo embed options still work without any additional setup.

**On a hosted NuxFlow site** (a hosting platform such as nuxflow.cloud) you don't need a Cloudflare account: if your plan includes video, Media → Videos uploads into the platform's Stream account, and the page shows how many minutes your plan has left. Your plan also sets how many minutes of your uploaded videos visitors can watch each month. When that runs out, uploaded videos pause until the 1st (YouTube and Vimeo videos keep playing), and your site's admins get a notice. You can still add your own Stream account in Settings → Media; videos in your own account are never counted against your plan.

---

## Setting Up Cloudflare Stream

You only need to complete this setup once. Skip this section if you plan to use YouTube or Vimeo exclusively.

1. Go to **Admin → Settings → Media**.
2. Enter your **Cloudflare Account ID** — visible in the right-hand sidebar on any page of the [Cloudflare dashboard](https://dash.cloudflare.com).
3. Create a **Stream API Token**:
   - In the Cloudflare dashboard, click your profile icon (top right) → **My Profile → API Tokens → Create Token**.
   - Select **Create Custom Token**.
   - Under **Permissions**, add: **Account → Cloudflare Stream → Edit**.
   - Click **Continue to summary → Create Token** and copy the generated token.
4. Paste the token into the **Stream API Token** field and click **Save**.

Once saved, the Videos section in **Admin → Media → Videos** becomes active and the Upload button is enabled.

---

## Uploading and Managing Videos

Go to **Admin → Media → Videos** to manage your video library. The page shows a thumbnail grid of all uploaded videos with their processing status.

### Uploading a video

1. Click the **Upload Video** button in the top-right corner.
2. Select any video file from your computer, up to 30 GB (Cloudflare Stream's own limit). NuxFlow uploads it directly from your browser to Cloudflare Stream in 50 MB pieces, so a finished film of several gigabytes is fine.
3. A progress bar shows the upload percentage in real time. If your connection drops, the upload waits and carries on from where it stopped rather than starting again. Keep the tab open until it finishes.
4. The video appears in your library as soon as the upload starts. When the upload completes it moves to `Processing` while Cloudflare transcodes it into an adaptive bitrate stream. The page polls automatically every few seconds and updates the status once it is ready.

### Processing status

| Status | Meaning |
|---|---|
| **Uploading** | The file transfer is in progress. An upload that never finished (the tab was closed) is marked Failed after a day. |
| **Processing** | Cloudflare Stream is transcoding the video. This typically takes 1–5 minutes depending on file size. |
| **Ready** | The video is live and can be embedded. |
| **Failed** | Transcoding failed. Delete the entry and try uploading again. |

### Playing a video in the dashboard

Click the play icon on any ready video card, or click the card itself, to open a full-screen preview player. This lets you verify the video before embedding it on a page.

### Copying the video URL for use on a page

This is the step that connects your uploaded video to a Canvas page.

1. Click the **Manage** button on any video card.
2. In the edit panel, find the **Stream URL** row.
3. Click the **copy icon** next to the URL.
4. Paste the copied URL into a Canvas Video block on any page (see below).

The copied URL has the format `https://iframe.videodelivery.net/{streamId}`. The Canvas Video block recognises this URL automatically.

### Renaming and deleting videos

The **Manage** panel also lets you update the video title and permanently delete the video. Deleting a video removes it from both the NuxFlow database and Cloudflare Stream — this action cannot be undone. Deleting a whole site deletes its videos from Stream too.

### Private videos

A **private** video plays only on your own site's pages, for visitors who are allowed to see the page it's on. If someone copies the video's address and sends it to a friend, it won't play for them. This is what you want for client films and paid content.

- **Automatic:** when you save a password-protected or members-only page, every Stream video on it from your library becomes private.
- **By hand:** switch **Private video** on or off in a video's **Manage** panel. A private video shows a lock badge in the library.

Behind the scenes, Cloudflare Stream is told to require a signed link for the video. NuxFlow creates a fresh link, valid for 12 hours, each time an allowed visitor opens the page. Search engines are never told about private videos.

Private videos only work with Cloudflare Stream. A YouTube or Vimeo video on a password page can still be watched by anyone who has its YouTube or Vimeo address. Use the platform's own privacy settings for those, such as Vimeo's "Hide from Vimeo" and domain-level embed restrictions.

---

## Canvas Video Block

The Canvas Video block embeds a video player on any Canvas page. It accepts URLs from YouTube, Vimeo, and Cloudflare Stream — paste the URL and the block detects the source automatically.

### Adding a video block to a page

1. Open any page that uses the **Canvas editor**.
2. Click the **+** insert button between blocks (or the **Add block** button at the bottom).
3. In the block picker, select **Video** from the **Media** category.
4. Click the new block to select it, then open its settings in the right panel.
5. Paste a video URL into the **Video URL** field.

### Supported URL formats

| Source | Accepted URL formats |
|---|---|
| **YouTube** | `https://www.youtube.com/watch?v=XXXXXXXXXXX` |
| | `https://youtu.be/XXXXXXXXXXX` |
| | Shorts: `https://www.youtube.com/shorts/XXXXXXXXXXX` |
| | Live: `https://www.youtube.com/live/XXXXXXXXXXX` |
| | Embed links: `https://www.youtube.com/embed/XXXXXXXXXXX` |
| **Vimeo** | `https://vimeo.com/123456789` |
| | Unlisted: `https://vimeo.com/123456789/abcdef1234` (keep the last part, or the video won't play) |
| | Player links: `https://player.vimeo.com/video/123456789?h=abcdef1234` |
| **Cloudflare Stream** | `https://iframe.videodelivery.net/{32-char-id}` |
| | `https://watch.cloudflarestream.com/{32-char-id}` |
| | `https://customer-{code}.cloudflarestream.com/{32-char-id}/…` |
| | The bare 32-character Stream ID on its own |

For a Short or a Reel, set the **Aspect ratio** to 9:16.

Paste the URL from your browser's address bar or from the **Copy URL** button in the Videos admin panel. The block shows a placeholder until a valid URL is entered.

### Block settings

| Setting | Description |
|---|---|
| **Video URL** | The YouTube, Vimeo, or Cloudflare Stream URL. |
| **Aspect ratio** | Controls the player's proportions: 16:9 (widescreen, default), 4:3 (classic), 1:1 (square), or 9:16 (portrait/vertical). |
| **Caption** | Optional text displayed below the player. |
| **Autoplay** | Starts the video automatically when the page loads. Most browsers require videos to be muted for autoplay to work. |
| **Muted** | Mutes the video. This option is only shown when Autoplay is enabled. |
| **Video title (for search engines)** | Not shown on the page. The title Google shows in video results. Defaults to the caption, then the video's own title, then the page title. |
| **Video description (for search engines)** | Not shown on the page. Defaults to the page's description. |
| **Padding** | Controls the space around the block within the page layout. |

## Video in Blog Posts

Posts written in the ordinary editor can hold video too:

1. Click the **Insert Video** button (the play icon) in the editor toolbar.
2. Paste a YouTube, Vimeo or Cloudflare Stream link, and optionally a caption.
3. Click **Insert video**.

A YouTube Short is inserted in portrait shape automatically. In the editor, YouTube and Vimeo videos show their player. A Cloudflare Stream video shows a placeholder box and plays on the published page. Private videos work in posts exactly as on Canvas pages.

## Video Gallery Block

The **Video gallery** block (in the **Media** category) shows a grid of video thumbnails. Clicking one plays it in a full-screen player, with arrows (or the ← and → keys) to move between videos. Use it for a showreel page, a wedding-films portfolio or a list of your latest YouTube uploads.

In the **Videos** box, put one link per line. Add a title after a `|`:

```
https://youtu.be/dQw4w9WgXcQ | Our showreel
https://vimeo.com/123456789/abcdef1234 | Smith wedding
https://iframe.videodelivery.net/{32-char-id} | Behind the scenes
```

Settings: **Columns** (1–4), **Thumbnail shape** (16:9, 9:16 for Shorts and Reels, square or 4:3), **Gap**, **Show titles** and **Rounded corners**. Thumbnails come from YouTube, Vimeo and Cloudflare Stream automatically. A private Stream video shows a plain tile, because its thumbnail needs a signed link too.

## Background Video in the Hero Block

The **Hero** block can play a video behind its headline, the usual look for a videographer's homepage. Paste a link into **Background video**. It plays muted, on a loop, with no controls, and is cropped to fill the hero whatever the screen shape. **Darken the video** (0–90%) keeps the headline readable; 40% is a good start.

- Use a short clip (10–30 seconds) without important detail at the edges, since the sides or top may be cropped.
- Use a **public** video: a private Stream video won't play as a background.
- The hero's background colour or gradient shows while the video loads, and for visitors whose device asks for reduced motion, who don't see the video.
- Watching a background video counts towards your plan's minutes watched on a hosted site, like any other Stream video. A YouTube or Vimeo background doesn't.

### Cookies and privacy

YouTube videos play through YouTube's privacy-enhanced (`youtube-nocookie.com`) player and Vimeo videos with Vimeo's "do not track" setting. Neither sets tracking cookies just because the page loaded. Cloudflare Stream sets no tracking cookies.

> Autoplay with sound is blocked by most browsers by default. If you enable Autoplay, also enable Muted to ensure the video actually plays automatically across all browsers.

---

## Gating Video Content Behind a Membership

Because video content lives on Canvas pages, you can restrict any video page to members or a specific subscription tier using the same access control system used for written content.

1. Open the Canvas page that contains your Video block.
2. In the editor sidebar, find the **SEO & Access** panel.
3. Under **Content Access**, choose **Members only** or select a specific membership tier.
4. Click **Save** or publish the page.

Visitors who do not have the required membership see a paywall with the available plans. Visitors who are subscribed at the correct tier see the full page and can watch the video.

Saving the page makes its Stream videos private (see **Private videos** above), so the video itself is protected, not just the page. A subscriber can't pass the video's address to someone who hasn't paid. Password-protected pages (client galleries) work the same way.

This makes Cloudflare Stream the natural choice for premium video content — you control both the hosting and the access, without relying on any platform's own membership or paywall features.

---

## Getting Videos Found in Search

NuxFlow tells search engines about the videos on your public pages, so they can appear in Google's video results:

- **On each page**, a `VideoObject` description of every video: its title, description, thumbnail, upload date and length.
- **A video sitemap** at `/sitemap-video.xml`, listing each page with the videos on it. It is listed in your `robots.txt` automatically. To tell Google straight away, open [Google Search Console](https://search.google.com/search-console), choose your site, go to **Sitemaps**, enter `sitemap-video.xml` and click **Submit**.

YouTube, Vimeo and Cloudflare Stream videos are all included. Thumbnails come from the video itself: YouTube and Stream provide one, and NuxFlow asks Vimeo for one. Give each video a title and description in the block's settings for the best results. Private videos and videos on password-protected, members-only or noindex pages are never listed.

---

## Recommended Workflow for Vloggers and Videographers

### 1. Decide where each video lives

Use Cloudflare Stream for premium, gated, or brand-sensitive content. Use YouTube or Vimeo for public content where platform discoverability matters. Both can coexist on the same site.

### 2. Upload to Cloudflare Stream (if self-hosting)

Go to **Admin → Media → Videos**, click **Upload Video**, and wait for processing to complete. Give each video a clear title. Search engines use it when the block doesn't set a title of its own.

### 3. Build your video pages with the Canvas editor

Create a new Canvas page for each video, series, or topic. Add a **Video** block at the top, paste the URL, and configure the aspect ratio. Add supporting content below using Text, Image, or other blocks — for example, a transcript, show notes, or links mentioned in the video.

### 4. Gate premium videos behind a membership tier

For paid content, set the **Content Access** to a membership tier in the SEO & Access panel. Pair this with a **Membership Pricing** Canvas block on a separate `/membership` or `/subscribe` page so visitors can see and purchase plans.

### 5. Keep a public preview on YouTube

For premium videos, consider publishing a short trailer or preview on YouTube pointing back to your site. The full version lives behind the paywall on Cloudflare Stream, while the YouTube clip drives discovery and signups.

### 6. Publish a video index page

Create a Canvas page at a URL like `/videos` that acts as a video archive. Use the **Columns** block to create a grid of rows, each containing a thumbnail image (linking to the video page), a title in a **Text** block, and a short description. Update this page as you publish new videos.

---

> For a photography-specific walkthrough covering the Gallery block, lightbox, EXIF display, focal point editor, and image sitemap, see the **[Photography & Portfolio Guide](./photography.md)**.
