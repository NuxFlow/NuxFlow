# Photography & Portfolio Guide

NuxFlow includes everything you need to build a professional photography website or portfolio — a responsive image gallery with a full-screen lightbox, EXIF metadata display, a live focal-point crop editor, a blog index that switches between list and grid views, and a dedicated image sitemap for Google Images indexing. This guide walks through each feature and explains how they fit together.

---

## Gallery Canvas Block

The **Gallery** block is the core building block for photography pages. It renders a responsive CSS grid of photos, and supports a full-screen lightbox so visitors can view images at full resolution.

### Adding a gallery to a page

1. Open any page that uses the **Canvas editor**.
2. Click the **+** insert button between blocks (or the **Add block** button at the bottom).
3. In the block picker, select **Gallery** from the **Media** category.
4. Click the new block to select it, then open its settings in the right panel.

### Adding images

In the **Images** field, paste an image URL into the input and click **Add**. Each image you add appears as a thumbnail row with an optional **alt text** field beside it. Fill in the alt text for every image — it improves accessibility and is used by the image sitemap for Google Images indexing.

To remove an image, click the trash icon on its row.

> **Tip:** Copy image URLs from the **Media Library** by opening a file's detail panel and clicking **Copy URL**.

### Gallery settings

| Setting | Description |
|---|---|
| **Columns** | Number of columns in the grid: 2, 3, or 4. On small screens the grid automatically collapses to 2 columns. |
| **Gap** | Spacing between images in pixels (0–48). |
| **Rounded corners** | Applies a rounded border-radius to each image cell. |
| **Open lightbox on click** | When enabled, clicking any image opens it full-screen in the lightbox. Enabled by default. |
| **Padding** | Controls the space around the gallery within the page layout. |

---

## Lightbox

The lightbox is a built-in full-screen image viewer. It is available on both the Gallery block and the single Image block.

When the lightbox is open:

- Click the background or press **Escape** to close it.
- Press **← →** arrow keys or click the on-screen arrows to navigate between images (gallery only).
- A counter in the bottom centre shows the current position (e.g. "3 / 12").

### Enabling lightbox on the single Image block

The **Image** block has a toggle called **Open lightbox on click**. It is off by default. Enable it in the block settings panel to make a standalone image clickable — useful for detail shots, before-and-after images, or any photo where you want the visitor to be able to view it full-screen.

---

## Focal Point Editor

The focal point tells NuxFlow which part of an image is most important. When an image is cropped to fit a container — for example, a banner or a portrait-format image in a landscape slot — the focal point is kept in view.

### Setting a focal point

1. Go to **Admin → Media Library**.
2. Click any image to open its detail panel.
3. The preview on the left now renders as a **live crop preview** using `object-cover`. The image fills the preview frame exactly as it would appear when cropped in your layout.
4. Click anywhere on the preview to place the focal point. A white ring with a coloured dot marks the current position.
5. The preview updates instantly — the image re-centres on the point you clicked, so you can see exactly what will remain in view.
6. Click **Save** to persist the focal point.

To remove a focal point, click the red trash icon next to the focal-point display and save.

> **Tip:** For portrait photos used as card thumbnails, set the focal point on the subject's face so it is never cropped out regardless of the container's aspect ratio.

---

## EXIF Metadata

When you upload a JPEG image that contains EXIF data (captured by a camera or smartphone), NuxFlow automatically extracts the technical metadata and displays it in the media detail panel:

- **Camera make and model** — e.g. *Apple iPhone 15 Pro* or *Sony ILCE-7M4*
- **Aperture** — e.g. *ƒ/1.8*
- **Shutter speed** — e.g. *1/500s*
- **ISO** — e.g. *ISO 64*
- **Focal length** — e.g. *24mm*
- **Date and time taken** — from the EXIF DateTimeOriginal field

The metadata is stored in the database alongside the image record. No additional configuration is required — it is extracted automatically at upload time.

> EXIF extraction only applies to JPEG and TIFF files. PNG, WebP, and AVIF images do not carry EXIF data and will not show the metadata panel.

---

## Blog Index: List and Grid Views

The public blog index at `/blog` supports two display modes that visitors can toggle between:

- **List view** — a single column of posts with a large featured image (224 px tall) and an excerpt, separated by dividers. Good for text-heavy blogs.
- **Grid view** — a 1-to-3 column card grid (responsive: 1 col on mobile, 2 on tablet, 3 on desktop) with a 4:3 aspect-ratio image cropped to fill each card. Good for photography-led content where the image is the primary draw.

The toggle appears in the top-right corner of the blog page header. The chosen layout is saved to the visitor's browser (`localStorage`) so it persists across page loads.

> To optimise how posts look in grid view, make sure each post has an **OG / Featured Image** set in the SEO panel of the content editor. Posts without a featured image show a placeholder icon.

---

## Image Sitemap

NuxFlow generates a dedicated image sitemap at `/sitemap-images.xml`. This is a Google Image Sitemap Extension file that lists all images in your media library along with their alt text and caption.

Google Images uses this sitemap to discover and index your photos. For a photography site, this is one of the most effective ways to drive search traffic — your photos can appear directly in Google Images searches and in Google Discover.

### What is included

Every file in your media library with an image MIME type (`image/jpeg`, `image/png`, `image/webp`, etc.) is listed. The sitemap uses the site's canonical URL (configured in **Admin → Settings → SEO**) as the base.

Each image entry includes:
- `<image:loc>` — the full URL of the image file.
- `<image:title>` — the **alt text** set on the media item (when present).
- `<image:caption>` — the **caption** set on the media item (when present).

### Improving your image sitemap

The quality of your image sitemap depends directly on how well you have filled in the metadata for each image:

1. Go to **Admin → Media Library**.
2. Click any image and add **Alt text** — describe what is in the photo clearly and concisely. The AI **Generate alt text** button can draft this for you.
3. Add a **Caption** for photos that have one — a location name, a brief description, or the subject's name.
4. Click **Save**.

Repeat for all images in your library. Images with no alt text or caption still appear in the sitemap but with less information for search engines to work with.

### Submitting to Google

1. Log in to [Google Search Console](https://search.google.com/search-console).
2. Select your site property.
3. Go to **Sitemaps → Add a new sitemap**.
4. Enter `sitemap-images.xml` and click **Submit**.

Google will crawl the sitemap and index your images progressively. Results typically appear in Google Images within a few days to a few weeks.

---

## Recommended Workflow for a Photography Portfolio

Here is a suggested workflow for building a photography portfolio on NuxFlow:

### 1. Organise your media

Use **Media Library → Folders** to create folders for each shoot, series, or category (e.g. *Portraits*, *Landscapes*, *Weddings 2026*). Upload your images into the appropriate folder.

### 2. Fill in metadata for every upload

After uploading, open each image and:
- Write a descriptive **alt text** (or use the AI button to generate one).
- Add a **caption** where appropriate.
- Set a **focal point** by clicking on the crop preview.

EXIF data (if present) is filled in automatically.

### 3. Build your portfolio pages with the Gallery block

Create a new canvas page for each series or project. Add a **Gallery** block, paste your image URLs, and configure the grid. Leave **Open lightbox on click** enabled so visitors can view the full-resolution images.

### 4. Use the Image block for hero shots

Place a single **Image** block at the top of a page with **Open lightbox on click** enabled for a dramatic full-screen opener that invites visitors to click in.

### 5. Enable the blog grid for your posts

If you publish shoot diaries, behind-the-scenes posts, or blog content, the grid layout at `/blog` ensures your featured images lead the story. Set an OG image on every post.

### 6. Submit your image sitemap

Submit `/sitemap-images.xml` to Google Search Console to maximise your images' visibility in Google Images search.
