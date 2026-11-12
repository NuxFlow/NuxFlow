# Shop Guide

Sell physical products and digital downloads from your NuxFlow site. Customers pay on Stripe's own checkout page, into your own Stripe account. NuxFlow never handles card details and never takes a cut of your sales.

The shop is built in, not a plugin, and it's **off until you turn it on**. A site that doesn't use it sees no change.

**In this guide**

1. [Before you start](#before-you-start)
2. [Turn the shop on](#turn-the-shop-on)
3. [Shop settings](#shop-settings)
4. [Add products](#add-products)
5. [Show products on your pages](#show-products-on-your-pages)
6. [What customers see](#what-customers-see)
7. [Orders and refunds](#orders-and-refunds)
8. [Test it before you go live](#test-it-before-you-go-live)
9. [Questions and problems](#questions-and-problems)
10. [What isn't built yet](#what-isnt-built-yet)

---

## Before you start

You need:

- **A Stripe account.** Put its **secret key** and **webhook signing secret** in **Settings → Payments**. The [Payments Setup Guide](./payments-setup.md) shows how.
- **These Stripe webhook events**, as well as the ones memberships use:
  - `checkout.session.completed`: an order was paid.
  - `checkout.session.expired`: someone left without paying, so their stock goes back on sale.
  - `charge.refunded`: you refunded in Stripe's dashboard, so the order follows.
- **An email provider** in **Settings → Email**, so customers get their receipts. Shop receipts count towards your plan's emails a month.
- **File storage** (the `MEDIA_BUCKET` binding), if you sell downloads. See the [after-installation checklist](./installation.md#5-after-installation-checklist).

On a hosting platform, the site's plan must include the shop. If it doesn't, Sales → Shop says so and the switch is locked. The plan can also limit how many products a site has.

## Turn the shop on

1. In the admin menu, open **Sales → Shop** (admins only).
2. Press **Turn the shop on**.

This adds:

- **Products** to the admin menu (editors and above).
- A **Collections** taxonomy for grouping products. Collections can nest, such as Bags → Totes. You'll find it in **Categories & tags**, with a page at `/collection`.
- A **basket** icon in your site's header.

**Turning the shop off** hides products' prices, the basket and checkout from visitors straight away. It deletes nothing, and turning it back on brings everything back.

If Payments aren't set up yet, the Shop page shows a warning, and the basket tells visitors the shop can't take payments at the moment.

## Shop settings

All on **Sales → Shop**. Press **Save** after changing them.

### Prices and tax

- **Currency.** Every price in the shop is in this one currency (GBP, EUR, USD and so on). Changing it doesn't convert prices you've already typed.
- **Prices you enter** either **include tax** (usual in the UK and EU) or have **tax added at checkout** (usual in the US). Product pages say which.
- **Collect tax with Stripe Tax.** Stripe works out and collects VAT or sales tax at checkout, from the customer's address.
  - Stripe charges an extra fee per sale for this.
  - It only collects tax where you've told Stripe you're registered. You set that up in your Stripe dashboard, under Tax.
  - Registering for VAT or sales tax, and filing the returns, is your job. Leave this off if you aren't registered.

### Delivery

- **Countries you post to:** two-letter country codes separated by commas, such as `GB, IE, FR, US`. Stripe only accepts addresses in these countries. Leave it empty to sell downloads only.
- **Delivery name**, such as "Standard delivery", shown on Stripe's page.
- **Price per order:** one charge per order, whatever is in it.
- **Free from:** delivery is free when the basket comes to at least this much. Leave it blank for never.

Delivery is only charged when something in the basket is posted. A basket of downloads only has no delivery charge and asks for no address.

### Click and collect

Switch on **Let customers collect their order instead of having it posted** to offer collection at checkout. It's free, and Stripe asks for no address.

- **Name at checkout**, such as "Collect from the bakery".
- **Notice needed:** the soonest a customer can collect after ordering, in minutes (60 is an hour; 1440 is a day).
- **Days ahead to offer:** how far ahead customers can choose (0 means today only).
- **Where and how to collect:** shown at checkout and in the receipt, such as your address and which door to use.

Customers choose a day and a time, every 15 minutes within your opening hours in **Settings → Business** (holiday hours count too, so they can't pick a day you're closed). If you haven't set opening hours, they choose a day only. Checkout checks the time again when they pay, in case it has passed since they opened the basket.

To sell for **collection only** (a bakery, a café), leave **Countries you post to** empty and switch collection on. In **Admin → Orders**, each collected order shows when it's being collected, in the list and on the order.

### Returns

**Returns policy page** is the slug of a page you've written yourself, such as `returns`. When it's set, customers must tick "I've read the returns policy" before they can pay, and the box links to that page. The order records when they ticked it.

In the UK and EU, people who buy online can usually cancel within 14 days. In the US there's no single rule. NuxFlow gives you the page and the box, not legal advice, so check what applies to what you sell.

### Downloads

- **Downloads per purchase:** how many times each download link works (5 to start with).
- **Link works for (days):** how long after paying the link keeps working (30 to start with).

## Add products

Open **Products** in the admin menu and press **New**, or press **New product** on the Shop page.

A product is a page like any other. It has the editor for its description, revisions, translations, SEO settings, and search. The **featured image** is its main picture. The **Product** card in the editor's sidebar holds the shop part:

### One price, or options

A new product has one price and no options. For sizes, colours and so on:

1. Press **Add option** and give it a name, such as **Size**.
2. Type its values separated by commas: `S, M, L`.
3. Add a second or third option if you need one, such as **Colour**: `Red, Blue`.
4. Press **Update variants**. NuxFlow makes one **variant** for each combination (S / Red, S / Blue, M / Red…).

Variants you already had keep their price and stock when you update the options. A product can have up to 3 options and 100 variants.

### Each variant

Open a variant to set:

- **Price**, and an optional **Was** price shown struck through. It has to be more than the price.
- **Type: Posted** (physical) or **Download** (digital).
- **SKU**, if you use them. Two products can't share one.
- **Track stock** and how many you have, for posted things. Leave it off for things that never run out, such as made-to-order prints.
- **Weight** in grams, for your own records for now.
- **Picture for this one**, shown when a visitor picks that variant.
- **On sale**, switched off to stop selling one variant without deleting it.

**Changing stock while people are buying is safe.** NuxFlow saves your change as "this many more" or "this many fewer", not as a fixed number. So if two sold while you had the editor open and you change 10 to 15, the shop ends up with 13.

### Download products

1. Set the variant's type to **Download**.
2. **Save the product.** A file can only be added to a saved variant.
3. Press **Upload file** on that variant (up to 100 MB).

The file is kept privately. It can only be reached through the signed link a customer gets after paying, and visitors can't find it any other way. **Replace file** swaps it for a new version, and customers who already bought get the new one. Download files count towards your site's storage. Deleting the variant or the product deletes its file.

A download variant without a file can't be bought: the basket says "This download isn't ready yet."

### More pictures and collections

**More pictures** adds to the featured image; customers can step through them on the product page. To put a product in a collection, tick it in the editor's categories box, the same as tagging a post.

### Publish

A product goes on sale when it's **published** and its page is **public**. Drafts, and members-only or password-protected products, can't be bought.

## Show products on your pages

Every product has its own page at `/its-slug`. To show products elsewhere, add one of these Canvas blocks, under **Commerce** in the block picker:

- **Products:** a grid of products, newest first. Leave **Collection slug** empty for all products, or enter one, such as `bags` (it includes sub-collections). Choose 2, 3 or 4 columns and how many to show.
- **Product:** one product, large, by its slug. A product with just one variant gets an **Add to basket** button; one with options links to its page, where the customer chooses.

## What customers see

1. **The product page** shows the pictures, the price, a button for each option, and whether it's in stock ("In stock", "Only 3 left", "Out of stock"). Stock is checked fresh each time the page opens, so a fast, cached page never offers something that has just sold out. They choose a quantity and press **Add to basket**.
2. **The basket**, at `/checkout` or through the header icon, is kept in their browser, so no account is needed. Each time it opens, NuxFlow checks every price and stock level again and notes anything that has changed, such as "Only 1 left" or "This isn't on sale any more".
3. **Pay securely** sends them to Stripe's checkout for their card details and delivery address. With Stripe Tax on, the tax is added there.
4. While they pay, **their stock is kept for them** for about half an hour, so the last one can't be sold to two people. If they leave without paying, it goes back on sale. If they come back from Stripe and press Pay again in the same tab, their first attempt is cancelled, so they aren't competing with themselves for the last one.
5. **After paying** they come back to a thank-you page and get a **receipt by email**. Its button opens their order: what they bought, where it's going, and a **Download** button for each download, with how many downloads and days are left.

**If the last one sells while someone is paying:** this can only happen when a payment arrives after their half hour has run out. NuxFlow tries to take the stock again; if it has gone, it refunds them in full automatically and emails them to say sorry. You get a notification too.

Payment is **by card only**. The stock is kept while someone pays, and slower methods such as bank debits would keep it for days and could still fail.

## Orders and refunds

**Sales → Orders** (admins only) lists everything people have paid for on your site: shop orders, paid event bookings, class passes and memberships bought in one go.

- **Sales**, the default view, shows paid orders, including refunded ones. **Everything** also shows checkouts people started and didn't finish. Unfinished ones are cleared away after 90 days; paid orders are always kept, as your record of the sale.
- Filter by what was bought, or search by name, email or order number (`1042` or `#1042`).
- Open an order to see what was bought, the delivery address and phone number, delivery and tax, how often each download has been used, and every refund.
- You get a **Shop orders** notification for each new order. Turn the email or push copy on or off in your account's notification settings.

### Refunds

Press **Refund** on a paid order:

- **All of what's left:** the money goes back to the card. Downloads stop working.
- **Part of it**, by typing a smaller amount: only money goes back, and the order stays as it was. Use this for a goodwill gesture or one returned item.

Stripe keeps its own fee on a refund. Refunds made in Stripe's dashboard show on the order too, as "refunded in Stripe's dashboard", as long as the `charge.refunded` webhook event is switched on.

Refunding doesn't put stock back. If the item comes back to you, add it to the variant's stock in the editor.

### Posting orders

There's no "mark as shipped" yet. For now, post from the address on the order and email the customer yourself.

### Personal data

Orders hold customers' names, email addresses, delivery addresses and phone numbers. Mention them in your privacy policy. Orders aren't in site backups yet. Products are: their options, prices, stock and download files go with your pages, and the shop comes back switched on when the plan includes it.

## Test it before you go live

Use Stripe's **test mode** first. In your Stripe dashboard, switch to test mode and copy the test secret key and the test webhook signing secret into **Settings → Payments**. Then:

1. Make a product with options and stock, and a download product with a file. Publish both.
2. As a visitor (a private window is easiest), add both to the basket and pay with Stripe's test card `4242 4242 4242 4242`, any future date and any three-digit code.
3. Check the receipt email arrives, its link shows the order, and the download works.
4. Check the stock went down, and the order is in **Sales → Orders** with the address.
5. Refund the order from Orders, then check the download has stopped working.
6. Start another checkout and close the Stripe page without paying. The stock comes back about 37 minutes after you started (Stripe's 31-minute checkout plus a few minutes' margin).

If you sell in several countries, try a UK, an EU and a US address to see tax and delivery work as you expect. When you're happy, swap in your live keys and live webhook secret.

## Questions and problems

**The basket says the shop can't take payments.** The Stripe secret key or webhook signing secret is missing in Settings → Payments. Both are needed: without the webhook, people could pay and never get their order.

**Paid, but the order still says "Awaiting payment".** Stripe's webhook hasn't reached the site. Check the webhook's address and that `checkout.session.completed` is ticked, then use **Resend** on the event in Stripe's dashboard. It's safe to resend: an order is only ever marked paid once.

**Stock seems stuck after someone left the checkout.** It comes back within about 37 minutes either way. It's quicker with the `checkout.session.expired` event switched on.

**"This shop isn't posting anything at the moment."** Something in the basket is posted and the shop has no **Countries you post to**.

**"Your plan doesn't include a shop."** On a hosting platform, the site's plan has to include it. Ask the platform about a bigger plan.

**A product doesn't appear in the Products block.** It has to be published, public, and have at least one variant on sale. Check the block's collection slug too.

## What isn't built yet

These are planned (see the [Roadmap](./roadmap.md)) but not there yet:

- Marking orders as shipped, tracking numbers and a "shipped" email
- Delivery zones and weight-based rates (today: one rate per order)
- Putting stock back automatically on a refund
- Low-stock notifications and a sales summary on the dashboard
- CSV export of orders, including courier formats
- Orders in site backups
- Discount codes and gift cards
- Order history on a customer's account, and product import from WooCommerce
- More than one currency, and payment providers other than Stripe
