# Photography & Portfolio Guide

NuxFlow includes everything you need to build a professional photography website or portfolio — an image gallery with uncropped masonry and row layouts and a full-screen lightbox, EXIF metadata display, a live focal-point crop editor, a blog index that switches between list and grid views, and a dedicated image sitemap for Google Images indexing. This guide walks through each feature and explains how they fit together.

---

## Gallery Canvas Block

The **Gallery** block is the core building block for photography pages. It shows your photos in one of three layouts and opens them in a full-screen lightbox, so visitors can see each one large.

### Adding a gallery to a page

1. Open any page that uses the **Canvas editor**.
2. Click the **+** insert button between blocks (or the **Add block** button at the bottom).
3. In the block picker, select **Gallery** from the **Media** category.
4. Click the new block to select it, then open its settings in the right panel.

### Adding images

Click **Add from library** under the **Images** field. The picker lets you add a whole shoot at once:

- **Folder** — show only one Media Library folder (for example *Smith wedding*).
- **Sort** — *File name (A–Z)* keeps camera order (`DSC_0001`, `DSC_0002`…); *Newest first* shows recent uploads first.
- Click photos to select them. Each selected photo shows a number: that is the order it will be added in.
- **Select all shown** selects every photo in the folder you're looking at. **Load more** loads the next 200 when a folder is bigger than that.
- Click **Add N images**.

You can also paste a single image URL, but photos added from the library carry their real width and height, which the uncropped layouts need to lay them out exactly.

Each photo in the list has:

- **Alt text** — describes the photo for screen readers and Google Images. Filled in from the Media Library if you've written it there.
- **Caption** — optional text visitors see. Filled in from the Media Library caption if there is one.
- A **drag handle** and **up/down arrows** to change the order, and a **remove** button. **Remove all** clears the block (the files stay in the Media Library).

### Gallery settings

| Setting | Description |
|---|---|
| **Layout** | **Masonry** shows whole photos in staggered columns (the default for new galleries). **Rows** shows whole photos in rows of equal height, like a contact sheet. **Grid** crops every photo to the same shape. |
| **Columns** | Masonry and Grid: 2, 3, or 4 columns. Phones show fewer. |
| **Crop shape** | Grid only: square, landscape (3:2, 4:3) or portrait (2:3, 3:4). |
| **Row height** | Rows only: the target height of each row in pixels. Phones use shorter rows. |
| **Gap** | Spacing between images in pixels (0–48). |
| **Show captions** | Shows each photo's caption under it (over it, in the Rows layout). Captions always show in the lightbox. |
| **Rounded corners** | Rounds the corners of each photo. |
| **Open lightbox on click** | When enabled, clicking any image opens it full-screen in the lightbox. Enabled by default. |
| **Allow downloads** | Shows a **Download all** button above the gallery (a zip of every photo, at full size) and a download button on each photo in the lightbox. Off by default. Anyone who can view the page can download, so on a client gallery only people with the password can. |
| **Padding** | Controls the space around the gallery within the page layout. |

> **Tip:** Galleries made before the Layout setting existed keep showing as a square Grid until you change it.

---

## Lightbox

The lightbox is a built-in full-screen image viewer. It is available on the Gallery block and the single Image block.

When the lightbox is open:

- Click the background or press **Escape** to close it.
- Press **← →**, click the on-screen arrows, or **swipe** on a phone to move between images (gallery only).
- The photo's caption shows under it, and a counter shows the current position (e.g. "3 / 12").

### Enabling lightbox on the single Image block

The **Image** block has a toggle called **Open lightbox on click**. It is off by default. Enable it in the block settings panel to make a standalone image clickable — useful for detail shots, before-and-after images, or any photo where you want the visitor to be able to view it full-screen.

### Fast loading for large photos

Turn on **Image Transformations** in **Settings → Media** (after the one-time Cloudflare dashboard step it describes). On a hosted site, your plan must include image resizing; if it doesn't, the switch is locked and says so. Galleries then load resized, modern-format copies, and the lightbox loads a screen-sized copy, instead of the full-size original from your camera. Without it, a visitor's browser downloads every original file.

---

## Client Galleries

A client gallery is a page only your client can open — for example the photos from their wedding.

1. Upload the photos into their own folder in the **Media Library** (e.g. *Smith wedding*).
2. Create a Canvas page (e.g. `/smith-wedding`) and add a **Gallery** block with the whole folder (see *Adding images* above).
3. In the editor's **SEO & Access** panel, set **Content access** to **Password protected** and choose a **Page password**.
4. To let your client save their photos, switch on **Allow downloads** in the Gallery block's settings.
5. Publish, and send your client the page link and the password.

Your client sees a password form; after entering it, their browser remembers it for 30 days. With downloads on, they get **Download all** (a zip named after the page, with your original file names) and a download button on each photo. You (signed in) always see the page. Changing the password asks everyone for the new one. Password-protected galleries are never listed in search, sitemaps or Google Images.

> **Downloads:** only photos from your Media Library are included (an image pasted in by web address is left out). A single download can be up to 1,000 photos or 2 GB — split bigger shoots across more than one gallery.

> **Good to know:** the password protects the page. Each photo is stored at a long, unguessable address, but someone who is sent a photo's direct link can still open it.

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

NuxFlow generates a dedicated image sitemap at `/sitemap-images.xml`. This Google Image Sitemap Extension file lists each of your published pages together with the images shown on it.

Google Images uses this sitemap to discover and index your photos. For a photography site, this is one of the most effective ways to drive search traffic — your photos can appear directly in Google Images searches and in Google Discover.

### What is included

Every published, public page that search engines may index is listed, together with every image it shows: its featured image, Image blocks, Gallery and Carousel images, and images inside text. Google requires each image to be listed under the page it appears on. Images used only in drafts, members-only pages, or pages marked noindex are left out, and so are library images no page uses yet. The sitemap uses the site's canonical URL (set in **Admin → SEO → Global defaults**) as its base.

Each page entry lists one `<image:loc>` per image, containing the image's full URL.

### Improving how your photos rank

Google reads each image's description from the **alt text** on the page itself (it no longer uses titles or captions in image sitemaps). To give your photos the best chance:

1. Fill in the **Alt text** field on every image in your Image and Gallery blocks. Describe what is in the photo clearly and concisely.
2. In **Admin → Media Library**, add alt text to library items too. The AI **Generate alt text** button can draft it for you.
3. Give each gallery page a descriptive title and meta description, which search engines use as context for the images on it.

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

Create a new canvas page for each series or project. Add a **Gallery** block, click **Add from library**, pick the shoot's folder, sort by file name, and **Select all shown**. Choose **Masonry** or **Rows** so photos aren't cropped, and leave **Open lightbox on click** enabled so visitors can view each photo large.

### 4. Use the Image block for hero shots

Place a single **Image** block at the top of a page with **Open lightbox on click** enabled for a dramatic full-screen opener that invites visitors to click in.

### 5. Enable the blog grid for your posts

If you publish shoot diaries, behind-the-scenes posts, or blog content, the grid layout at `/blog` ensures your featured images lead the story. Set an OG image on every post.

### 6. Submit your image sitemap

Submit `/sitemap-images.xml` to Google Search Console to maximise your images' visibility in Google Images search.
