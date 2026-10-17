# ShahabTech Telegram shop — website admin plan

## Confirmed

- Upgrade the existing @ShahabTech1Bot shop on the current Hostinger deployment.
- Manage the shop from a website, usable on phones and computers.
- Provide product listings, purchase confirmation, stock, and order management similar to the supplied Telegram screenshot.
- Use Telegram Stars for digital-product payments inside Telegram.
- Owner Telegram user ID: 6976455363.
- Automatically deliver activation codes or access links after verified payment.
- Review a Superdesign dashboard design before implementation.

## Dashboard

- Private sign-in, secure session cookies, rate-limited login, and sign-out.
- Overview: actual product, stock, and order counts; no fabricated sales statistics.
- Products: create and edit title, description, category, Stars price, delivery method, and published/draft state.
- Stock: add activation codes or access links, show available/reserved/delivered quantities, and avoid exposing delivery secrets before purchase.
- Orders: payment state, customer Telegram ID, product/price snapshot, delivery state, and delivery retry controls.
- Settings: shop title, support instructions, and payment readiness.
- Clear empty states and a first-product walkthrough for a new owner.

## Customer flow

1. `/start` opens the shop menu.
2. Customer selects a product and sees its description, price, and availability.
3. Buy opens an order confirmation with Confirm and Cancel buttons.
4. Confirm creates an invoice in Telegram Stars.
5. Pre-checkout revalidates order ownership, exact currency/amount, and availability.
6. Only a verified successful-payment update permits fulfillment.
7. Automatic delivery sends a reserved activation code/link; manual delivery creates an actionable paid order for the owner.
8. Order history lets the customer check purchases and retrieve delivered items.

## Implementation requirements

- Preserve the existing private bot token and webhook secret on the host.
- Keep durable shop data outside public_html; exclude it and credentials from Git and deploy archives.
- Enforce order ownership and stock allocation on the server.
- Persist payment IDs and handle duplicate Telegram updates safely across restarts.
- Never fulfill an unpaid order or charge for unconfigured/sample products.
- Keep the existing /ping, /id, health endpoint, and SSH launcher working.
- Register callback_query and pre_checkout_query webhook updates as well as messages.
- Back up durable data before schema changes; release without overwriting production secrets/data.
- Test access control, product CRUD, stock concurrency, duplicate payments, amount mismatch, fulfillment retries, and refund handling before enabling sales.

## Owner information received

- Automatic code/link delivery is selected.
- Owner Telegram User ID is 6976455363. This is a public identifier, not a bot token.

## Current state

This is a plan, not a deployed shop. The existing test bot is still running. Payment collection is not enabled by this document.
