# GeoFS ATC Workspace

GeoFS ATC Workspace is an unofficial Chrome extension that adds a controller-oriented workspace on top of GeoFS multiplayer. It is built as a desktop-first, KMSP-focused ATC console with live traffic monitoring, runway and surface maps, chart/reference handling, and controller workflow tools.

This project is not affiliated with GeoFS. It depends on observed GeoFS browser behavior and should be treated as an integration against a moving external target.

## Current status

The project is usable today as a development-stage controller workspace for GeoFS:

- Manifest V3 Chrome extension architecture
- detached React workspace window
- live GeoFS `/update` and `/map` ingestion
- traffic tracking and advisory/conflict derivation
- traffic, runway, and surface map panels
- reference shelf and in-app PDF/image/text viewer
- KMSP-first airport package, charts, and surface overlay support
- phrase packs, clearance drafting, and controller profiles
- diagnostics for bridge health, fallbacks, and adapter status

The codebase is being hardened specifically to tolerate GeoFS changes, browser lifecycle issues, and noisy upstream data.

## Features

- Live traffic ingestion from GeoFS with normalization and hygiene filtering
- Controller-oriented workspace layouts for approach, tower, ground, and chart-heavy workflows
- Focused-aircraft workflow with pinning, destination context, and surface-clearance state
- Surface-routing helpers and runway-crossing workflow scaffolding
- Conflict and spacing advisories
- Role-aware reference resolution for ground, airspace, weather, procedure, and reading contexts
- In-workspace PDF and image chart viewing
- KMSP airport diagram image overlay in the surface map
- Settings and diagnostics panel
- Controller profile import/export
- Regional discovery and fallback-aware degraded-mode handling

## Architecture

```text
src/
  app/           React workspace UI, panels, layout, maps, and store
  background/    MV3 service worker and session/controller coordination
  content/       GeoFS content script and injected page bridge
  domain/        GeoFS adapters, traffic logic, airports, references, chat, advisories
  shared/        contracts, persistence, defaults, validation, utilities
docs/
  architecture and integration notes
public/
  bundled KMSP chart assets
scripts/
  live GeoFS smoke harness and local debugging scripts
```

## Tech stack

- TypeScript
- React
- Zustand
- MapLibre GL JS
- react-grid-layout
- pdf.js (`pdfjs-dist`)
- Vitest
- Playwright for live browser probing and smoke testing

## Requirements

- Node.js 22.13+ (required by the patched PDF.js toolchain)
- Google Chrome or Chromium with extension developer mode available
- Windows, macOS, or Linux desktop environment capable of running a Chrome extension

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Build the extension:

```bash
npm run build
```

3. Open `chrome://extensions`.
4. Enable Developer Mode.
5. Choose `Load unpacked`.
6. Select the generated `dist/` directory.
7. Open GeoFS in Chrome, then launch the workspace from the extension action.

## Development commands

```bash
npm run dev
npm run build
npm run test
npm run test:geofs-live
```

Notes:

- `npm run test` runs the local Vitest suite.
- `npm run test:geofs-live` runs a Playwright-based live smoke harness against GeoFS and writes artifacts to `output/playwright/geofs-live-smoke/`.
- The live harness is intended for local debugging and reverse engineering, not CI.

## Public repo guidance

Before publishing or accepting contributions, treat this repository as an unofficial integration project:

- GeoFS protocol and page behavior can change without notice.
- Browser focus and throttling behavior matter for live `/update` ingestion.
- Anonymous test sessions do not provide full multiplayer chat capability.
- Large regional chart files should be handled as optional local imports rather than bundled repo assets.

## Known limitations

- The extension is desktop Chrome-first and not intended for Firefox or mobile.
- GeoFS remains the upstream source of truth and can rate-limit, change payloads, or alter runtime behavior.
- Real-world GeoFS focus behavior is stricter than what Playwright reproduces in automation.
- Chat behavior depends on GeoFS session state and may be unavailable in anonymous test runs.
- The KMSP overlay is operationally useful but not survey-grade.
- `maplibre` and PDF assets still dominate bundle size.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [GeoFS Integration](docs/GEOFS_INTEGRATION.md)
- [GeoFS Live Findings](docs/GEOFS_LIVE_FINDINGS.md)
- [GeoFS Ecosystem Risks](docs/GEOFS_ECOSYSTEM_RISKS.md)
- [Charts and References](docs/CHARTS_AND_REFERENCES.md)
- [Roadmap](docs/ROADMAP.md)

## License

This repository is licensed under the Apache 2.0 License. See [LICENSE](LICENSE).
