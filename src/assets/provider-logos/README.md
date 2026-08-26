# Provider logos

This directory contains one local identification asset for every provider in
`electron/services/provider-catalog.seed.ts`, plus the local `ollama`
provider. Provider IDs are the filenames used by the renderer.

## Official-source policy

Every asset comes directly from a provider-controlled source:

1. The provider's public website, documentation site, console, or web app.
2. An official downloadable brand kit.
3. An official provider-owned profile when the provider publishes no separate
   downloadable asset.

Community icon libraries, logo aggregators, and fan-made artwork are not used.
Regional endpoints, coding plans, and token plans reuse their parent
provider's official mark when no separate product mark exists.

[`sources.json`](./sources.json) records the source URL, source page, retrieval
date, alias relationship, and color treatment for all 182 providers.

## Color presentation

Official color artwork is used unchanged whenever it is published. When a
provider publishes only a monochrome mark, the app may place that untouched
mark against a color explicitly published by the provider's own site or brand
guidelines. The color is presentation metadata, not a recolored logo.

Providers whose official identity is exclusively monochrome remain
monochrome. The app does not invent a color variant.

Four contact sheets in [`previews`](./previews) show the same presentation used
by the provider and model pickers. Regenerate them with
`npm run generate:provider-logo-previews`.

Run `npm run verify:provider-logos` after changing the provider catalog or any
asset. The verifier enforces complete source metadata and rejects community
sources, duplicate files, active SVG content, external references, and
theme-dependent SVG colors.

Provider names and logos remain trademarks of their respective owners. They
are bundled only to identify the provider selected by the user.
