# ShahabTech Shop Admin design system

## Product and audience
Phone- and desktop-friendly private admin dashboard for a first-time Telegram shop owner. Bot: @ShahabTech1Bot. Sell digital products and automatically deliver one activation code or access link after verified Telegram Stars payment. Dashboard sections: Overview, Products, Stock, Orders, Settings. The initial review target is Products, with an Add product drawer. This is a visual preview, not a functioning checkout.

## Primary style source
Superdesign library: mosaic-grid-architecture-style (Mosaic Grid Architecture Style). Adapt its technical minimalist, flat, paper-and-forest system for an operational dashboard, not a marketing landing page. Do not add marketing hero sections or background illustrations.

## Visual foundations
- Paper #F7F7F5 background; white #FFFFFF surfaces; forest #1A3C2B primary actions and headings; grid #3A3A38 at 20% opacity borders; text #252C28 and muted #657068.
- Supporting colors: coral #FF8C69 for low-stock attention, mint #9EFFBF for published/ready status, gold #F4D35E for Stars and draft indicators. Every status has readable text as well as color.
- Space Grotesk headings, General Sans body (Arial fallback), JetBrains Mono for IDs and compact metadata. Adapt typography for a dashboard: 28–32px page title, 18–20px section titles, 14–16px body, 12px metadata. Avoid wide uppercase paragraphs or tiny essential text.
- Flat surfaces, 1px hairline borders, 2px corner radius, no gradients or box shadows. Generous 8px spacing system: 8, 16, 24, 32. Compact but readable rows, 44px minimum interaction targets.
- Text brand 'ShahabTech / Shop admin'; no fabricated product/vendor logos or avatar headshots. No existing logo asset is available. Functional line icons only.
- 160ms ease-out focus/hover/selection transitions; respect reduced-motion preferences.

## Layout
Desktop: fixed 216px left sidebar, top utility bar, spacious content area with heading and Add product action, 3 operational summary tiles, product search/category/status filters, a product table, a small contextual getting-started panel. Optional drawer overlays from the right for product creation.
Mobile: sidebar becomes a menu, content is a single column, metrics wrap, product rows become labeled cards, drawer fills the screen. No horizontal page overflow. Keep primary action reachable.

## Content and states
Show a visible 'Design preview · sample data' notice. Illustrative generic products only (AI prompt pack, coding toolkit, design templates, learning bundle), no claims of access to paid third-party accounts. Example prices are integers in Stars, labeled clearly; never use dollar balance/recharge UI. Stock is counted in codes/links. Example metrics are explicitly sample data, not actual revenue. Explain: 'Add a product, upload its codes or links, then publish it to your bot.'

Product table: product name/category, price in Stars, available stock, Published/Draft status, Edit action. Include low-stock and out-of-stock rows. Publishing requires a title, description, integer Stars price, and available stock; stock content stays masked.

Add product drawer: product name, category, customer description, Stars price with help, delivery type (Activation code / Access link), one-code-or-link-per-line stock textarea with placeholder only, Save draft, Publish product. Explain that each paid order receives one stock item. Fields have visible labels and errors. Do not show real activation codes, tokens, or owner IDs in the design.

Navigation: Overview, Products (selected), Stock, Orders, Settings. Footer links: 'Open Telegram bot', 'Sign out'. The interface should be friendly and clear for a total beginner.

## Behavior boundary
Use working prototype-only controls where possible: search/filter sample rows, open/close drawer and responsive menu. Form submissions must clearly remain preview interactions; never invoke APIs, take payment, collect credentials, or imply products were published. Actual login, persistence, Telegram integration, and deployment follow owner design approval.
