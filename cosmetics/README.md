# Appearance parts contract

These are data-only design manifests, not executable CSS packs or finished app deliveries. The first two test previews interpret the supplied Nile Nocturne and Royal Obsidian & Gold guidelines. Prices are intentionally unset. No app version is advertised as compatible until its bundled registry and acceptance checks exist.

**Payment policy:** every Lightning financial feature is free. Optional in-app cosmetics such as themes may be bought to support development; they change appearance only. The in-app purchase/claim flow is still under development, so this document does not announce availability or set prices/provider details.

`slots.json` is the slot inventory and per-part guideline. `component-inventory.json` maps those slots to the current PC/phone source files and records hard-coded styles that still need migration. A theme explicitly declares its changed parts; omitted parts resolve to the default. Unknown slots, keys, token references, CSS text, URLs and motions are rejected. An invalid manifest falls back as a whole before anything is applied. A valid missing part falls back individually. Removing an active theme always returns to the default without changing financial data.

The reference PDFs use ten grouped parts. We split palette and brand mark into independent slots, making eleven explicit compartments. A full theme is a preset over these slots. Keep each theme manifest as its own guideline: its `parts` state exactly what it changes. Decorative motion is intentionally `none` for this first test. Do not animate money figures, change fonts, inject logo artwork, use gradients for financial meaning or accept arbitrary CSS.

Fixed: layout, dimensions, spacing, border widths, fonts, routes, labels, financial calculations, data access, focus order and touch target sizes. The contract reduces risk; only tests can establish that a specific version is safe. Verify text at 4.5:1, non-text controls/focus at 3:1, semantic states, keyboard access, reduced motion, RTL, all pages and both native platforms. Decorative borders need not meet control contrast and cannot act as the sole control boundary.

The Thread/spool currency and textile rarity guide is optional brand exploration. Keep Lightning Coins for now; do not apply its proposed prices, rarity or claims of universal contrast as policy. The nine additional theme ideas, frames, badges and landscapes are design backlog until real assets and compatibility checks exist. Contributor achievement badges must be earned, not sold as achievements. Owner revision: only Mono is free. Other palettes require account ownership; existing purchases and previously equipped free palettes are preserved.

## Bundled themes and codes

Ship a versioned registry of supported parts/themes with the app. The website sells account ownership, never a device slot. A preview does not grant ownership or install downloaded code. Only an app with the matching built-in item/version can apply it; old apps show an update message rather than consuming a new claim they cannot use.

A one-time random code is an online delivery ticket, not an offline password. The website issues it to an owner; the app exchanges it online once for an Ed25519-signed account entitlement. The code expires; ownership and the cached signed entitlement do not. Other devices get fresh codes for the same owned item at no charge. Never make ownership single-device or require a persistent connection after activation. Device names/IDs are not licensing limits.

Portable signed licenses can be copied. That is accepted for cosmetics; signatures prevent editing item IDs, not copying valid files. A short random code cannot be checked and spent exactly once entirely offline. Offline users need a signed-file import alternative. Never embed signing keys or universal unlock passwords in the app.

## Reference decisions

- `threads-cosmetics-guide.pdf`: keep the Egyptian textile direction as optional inspiration and distinguish collectible badges from earned contributor achievements. Defer currency renaming, rarity bands, proposed prices and unprovided standalone artwork. Its palette is not assumed accessible in every pairing; test actual foreground/background combinations.
- `lightning-themes-nile-obsidian.pdf`: use the two palettes, names and fixed-layout parts concept. Keep the app's existing fonts and financial semantics, approved logo variants and stable figures. Disable suggested ambient/number animations for the first test. Split brand into its own compartment and supply a complete default rather than assuming partial themes always work.
- `lightning-marketplace.pdf`: retain preview, owned/equipped states, confirmation and separate contribution score. Override its earned-only coin rule with the owner's paid InstaPay top-up workflow. Its 200/300 prices are proposals, not production prices. Try currently affects a bounded sample only; a full app/market preview needs component mapping and acceptance first.
