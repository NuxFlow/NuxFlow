# Starter sites

A starter site is a ready-made site to start from: its pages, posts, menus, forms, look and images. NuxFlow offers them in two places:

- **At the end of setup.** The setup wizard's last step and the hosting sign-up page ask which starter to begin with.
- **Admin → Site → Starter sites** (admins only). This switches an existing site to a different starter at any time.

## Switching an existing site

Choose **Use this starter** on a card, read the confirmation, and press **Switch**. If you want a copy of everything first, the dialog has a **Download a backup** button.

What happens:

| | |
|---|---|
| Your pages and posts | **Nothing is deleted.** Every published or scheduled page and post becomes a draft, and you can publish any of them again. A page at the same address as one of the starter's (usually the home page) is renamed "(Backup — date)". The privacy page stays live unless the starter has its own. |
| Menus | The starter's menus take the header and footer positions. Your old menus are kept, just not shown. |
| Forms | The starter's forms are added. Old forms with the same address are renamed and closed. Their past entries stay. |
| Look | The starter's theme, colours, fonts and header options become active. If you switch to a starter without a theme, the previous starter's theme is switched off. A theme you installed yourself stays active. |
| Your brand | Your logo, favicon, SEO title, description and share image stay as they are. The starter only fills them in if you haven't set them. Custom head or body code is only replaced if it's empty or still exactly what the previous starter put there, so your analytics or chat code is never removed. |
| Not touched | Events, users, members, memberships, payments, email, domain, SEO rules and every other setting. |

Starters with images copy them into your media library a few at a time. The dialog shows the progress. If you close it, the install pauses, and **Starter sites** (and the dashboard) show **Continue**. **Cancel install** stops it and removes the images copied so far.

### Starters with images need file storage

Images go into your site's file storage, so a starter with images needs **R2** or **Cloudflare Images** connected (Settings → Media). Without it, those cards show "Needs file storage" and can't be picked. Text-only starters always work.

On a hosting platform, the images count towards the site's storage limit. NuxFlow checks the whole starter fits before copying anything.

## Choosing a starter during setup

The four built-in starters (Business, Blog, Portfolio, Blank) are set up straight away. A starter from the catalog needs the new admin to be signed in, because its images are copied by the admin page. So the site starts with a blank home page, and the dashboard shows **Finish setting up your site with …** with an **Install now** button. Installing it replaces the blank home page, and nothing becomes a draft.

## Where starters come from

- **Built in.** These four are text only and ship with NuxFlow (`server/utils/starters/builtin.ts`). They work offline and before storage is connected.
- **The starter catalog.** This is a signed `catalog.json` plus files, hosted at `https://starters.nuxflow.dev/catalog.json` by default. New starters appear on every install as soon as they're published, with no NuxFlow update. If the catalog can't be reached, the built-in starters are still offered and a short note says so.

The catalog is **signed** with an Ed25519 key. Every file it lists has a SHA-256 checksum. NuxFlow ignores a catalog whose signature doesn't match the public key it trusts, and any file whose checksum doesn't match. So whoever controls the web host can't slip code into the sites that install a starter. A starter can only change the settings listed above. It can never set a site's canonical address, crawler rules, credentials or payment settings.

### Running your own catalog

| Variable | Default | |
|---|---|---|
| `NUXT_STARTERS_CATALOG_URL` | `https://starters.nuxflow.dev/catalog.json` | Set it to `off` to offer only the built-in starters. Must be `https` (`http://localhost` is allowed for testing). |
| `NUXT_STARTERS_PUBLIC_KEY` | the NuxFlow project's key | The public key your catalog is signed with (`pnpm starters:build --keygen`). |

## Making a starter site

A starter is a folder:

```
my-starter/
  starter.json   { "id": "corner-cafe", "name": "Corner Café", "description": "…", "category": "Food & drink", "version": "1.0.0" }
  demo.json      the site's content — the same format as a theme's demo.json or a NuxFlow backup
  theme.css      optional — becomes the site's theme
  preview.jpg    optional — the picture on the card (16:9; .png or .webp also work)
  images/…       optional — files demo.json refers to as "images/<name>"
```

- **Making `demo.json`:** build the site on a NuxFlow install, then use Admin → Import & backup → download a backup. Take `backup.json` out of the zip, rename it to `demo.json`, and change every image URL to `images/<file>`, with the files in `images/`. A theme bundle you already have, such as Hollis Reed, works as it is. Just add a `starter.json` and a `preview.jpg`.
- **The site's name:** `{{site_name}}` anywhere in `demo.json` is replaced with the installing site's name.
- **What a starter may carry:** pages, posts, custom content types, categories/tags, menus, forms, and settings starting with `theme.`, `frontend.` or `layout.`, plus `appearance.custom_head_html`/`custom_body_html`. Logo, favicon, `seo.title`, `seo.description` and `seo.og_image` are only filled in when the site has none. Everything else in `demo.json` (users, plugins, redirects, other settings) is ignored.
- **Bump `version`** whenever you change a starter. Files are published under `<id>/<version>/`, so an install already under way keeps downloading the version it started with.

### Publishing the catalog

```bash
# Once: make a signing key (keep the private key file safe and out of git)
pnpm starters:build --keygen MYSTUFF/starters-signing-key.txt

# Build every starter, sign the catalog, upload to the R2 bucket behind starters.nuxflow.dev
pnpm starters:build MYSTUFF/starters --upload nuxflow-starters
```

- Pass every starter folder each time, or one folder that holds them all. The catalog lists exactly what you give it, so a starter you leave out disappears from the catalog.
- The build checks each starter and warns about images `demo.json` mentions but the folder lacks, or images it doesn't use.
- Without `--upload` it only writes the files to `apps/nuxflow/.starters-out/` so you can look first.
- `catalog.json` is uploaded last, so it never lists a file that isn't there yet.

To host the catalog: create an R2 bucket (for example `nuxflow-starters`), connect the custom domain `starters.nuxflow.dev` to it (R2 → bucket → Settings → Custom Domains), and upload as above. The catalog is cached for 5 minutes and the versioned files permanently. Each NuxFlow server keeps its copy of the catalog for 10 minutes.
