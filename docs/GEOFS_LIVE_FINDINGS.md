# GeoFS Live Findings

Last updated: 2026-04-04

This note captures findings from live Playwright-driven runs against [GeoFS v3.8](https://www.geo-fs.com/geofs.php?v=3.8) using the local Chrome extension build and the smoke harness at [geofs-live-smoke.mjs](../scripts/geofs-live-smoke.mjs).

## Harness and artifacts

- Command: `npm run test:geofs-live`
- Artifacts:
  - summary.json: `output/playwright/geofs-live-smoke/summary.json`
  - update-samples.json: `output/playwright/geofs-live-smoke/update-samples.json`
  - map-samples.json: `output/playwright/geofs-live-smoke/map-samples.json`
  - workspace-after-background.png: `output/playwright/geofs-live-smoke/workspace-after-background.png`

The harness now clears its Chromium profile on each run so the extension does not keep loading stale bundle hashes between builds.

The Playwright browser profile is not logged into a GeoFS account, so multiplayer chat send/auth behavior should be treated as unavailable during these runs. Chat-path observations in this document are limited to transport health and fallback behavior, not successful authenticated send.

## Current live status

As of the latest 2026-04-04 run:

- All workspace panels render in the live harness, including:
  - traffic table
  - traffic map
  - runway map
  - surface map
  - chat
  - focus
  - weather
  - settings
  - chart library
  - reference viewer
- The prior React `#185` failure in the non-surface maps is no longer present.
- The harness now records per-panel render status, first-success samples, first `429` `/update`, and focus samples over time.
- Live `/update` is now reaching the extension again.
- The workspace diagnostics now show:
  - `Last /update` timestamps
  - live update cadence in the ~500-700ms range during the latest run
  - active bridge heartbeat without falling back to `bridge alive but no traffic`
- Chat remains unavailable in the harness because the test browser profile is anonymous, so the main active fallback remains `chat-send-unavailable`.

## Root cause fixed in this pass

The extension was previously attached to GeoFS and receiving bridge heartbeats, but not receiving any live `/update` or `/map` data even though Playwright network capture could see those requests.

Confirmed root cause:
- GeoFS uses top-page `XMLHttpRequest` for `/update` and `/map`.
- The original bridge only patched `fetch`, so the extension could stay attached while missing the actual traffic feed.
- After adding XHR interception, the feed still failed intermittently because the injected bridge was loading as a module script and the XHR hook could be displaced during GeoFS startup.

Fix applied:
- inject the bridge as a classic script instead of a module script
- patch both `fetch` and `XMLHttpRequest`
- reassert the hooks on the bridge heartbeat interval so late GeoFS overrides do not silently disable capture

Observed result:
- the live smoke harness now records sustained `/update` and `/map` traffic
- the workspace receives and timestamps live `/update`
- map panels update against real contacts/conflicts instead of only static airport/reference data

## Confirmed GeoFS endpoint shapes

### `/update`

Observed endpoint:
- `https://mps.geo-fs.com/update?l=<number>`

Observed transport behavior:
- top-page `XMLHttpRequest`
- `POST`

Observed top-level fields:
- `myId`
- `userCount`
- `users`
- `chatMessages`
- `lastMsgId`
- `serverTime`

Observed meaning:
- `myId` appears to be the local player/session id.
- `users` is the short-range/live traffic list and is the only source observed with `chatMessages`.
- `chatMessages` is present even when empty.
- `serverTime` is present on successful responses.

### `/map`

Observed endpoint:
- `https://mps.geo-fs.com/map`

Observed transport behavior:
- top-page `XMLHttpRequest`
- `POST`

Observed top-level fields:
- `userCount`
- `users`

Observed meaning:
- `/map` appears to be the broad/global traffic snapshot.
- No `chatMessages`, `lastMsgId`, or `serverTime` were observed in captured `/map` payloads.

## Observed user/contact record structure

Observed per-user fields:
- `id`
- `acid`
- `ac`
- `cs`
- `st`
- `co`
- `ve`
- `ti`

Observed nested structure:
- `st` includes at least:
  - `gr`
  - `as`
  - sometimes `lv`
- `co` appears to encode:
  - latitude
  - longitude
  - altitude-like value
  - heading-like value
  - pitch/bank-like values
- `ve` appears to encode velocity components or deltas.
- `ti` is a per-contact timestamp and may be `null`.

## Data quality / normalization risks seen live

The payloads contain many contacts that should not be treated as operationally reliable without filtering:

- Blank callsigns are common.
- `Foo` callsigns are common.
- `acid` is often `null`.
- Some contacts contain extreme or obviously unrealistic values:
  - absurd altitude-like values
  - absurd speed-like values
  - `gr: false` instead of a numeric/boolean pattern consistent with nearby records
  - `ti: null`
- Duplicated or near-duplicated identities appear in both feeds and within the broader map feed.

This validates the current hygiene filters and suggests the domain normalization layer should remain strict and defensive.

## Focus/background behavior

Important: Playwright focus behavior is still **not** a faithful reproduction of the real-world GeoFS focus dependency you described.

Observed under automation:
- `document.visibilityState` stayed `"visible"` after bringing the extension tab to the front.
- `document.hidden` stayed `false`.
- `document.hasFocus()` also remained `true` in the captured GeoFS page state.
- In the latest successful run, `/update` continued in both experiments:
  - same-window tab switch: active `23`, background `14`
  - popup-window switch: active `29`, background `40`
- Even while those responses continued, the GeoFS page still reported:
  - `visibilityState: "visible"`
  - `hidden: false`
  - `hasFocus: true`

Implication:
- The automation harness now proves extension rendering and can probe multiple focus/window arrangements, but it still does **not** yet prove the real desktop/browser condition where GeoFS `/update` stops when the user does not keep the GeoFS tab effectively selected.
- The focused-tab operational warning in the app is still correct as a product assumption, but Playwright cannot currently validate that assumption by simple tab switching alone.
- The DOM focus/visibility signals exposed through Playwright are not sufficient to model the real-world focus dependency reported by the user.

## Rate limiting and upstream instability

Observed directly in live runs:
- `/update` sometimes returned HTTP `429`.
- In the latest run, the first observed `/update` in the popup-window experiment was a `429`, followed by successful `/update` responses in that same experiment.
- GeoFS/related assets also produced occasional `400` and CORS-related failures.

Implication:
- Background health should treat `429` as an upstream availability or throttling state, not as a parser failure.
- A lack of `/update` responses may be caused by throttling as well as browser focus or tab-state behavior.

## Browser console findings from GeoFS

Observed recurrent console warnings/errors:
- WebGL `INVALID_ENUM: bindTexture: invalid target`
- Canvas `getImageData` performance warnings
- `glTF 1.0 assets were deprecated in CesiumJS`
- CORS failures against `data.geo-fs.com/landmarks/...`
- occasional `429 Too Many Requests`

Implication:
- GeoFS itself is noisy and occasionally degraded.
- Extension diagnostics should avoid interpreting every missing asset or console error as an extension fault.

## Extension debugging findings

Resolved during this pass:
- The non-surface map render loop was eliminated by moving map-heavy derivation out of the inline Zustand object selector and into local memoized derivation from primitive store slices.
- `traffic-map`, `runway-map`, and `surface-map` all render in live automation.
- The GeoFS bridge now captures top-page XHR traffic reliably enough for live `/update` and `/map` ingestion.
- The harness now records:
  - panel render status by panel id
  - first successful `/map`
  - first successful `/update`
  - first `429` `/update`
  - focus samples over time
  - same-window versus popup-window focus experiment results

Current follow-up issue:
- GeoFS live probing still does not reproduce the user-reported “tab must remain selected” behavior in Playwright, even though the real browser appears to have that constraint.
- The extension currently receives live `/update`, but KMSP-local traffic may still be sparse in anonymous automation runs, so the traffic table can remain empty while conflict logic fires against the broader ingested set.

## Useful next debugging targets

1. Determine whether the real-world selected-tab constraint depends on Chrome window activation or compositor state that Playwright does not expose through DOM focus APIs.
2. Compare live runs with and without manual page interaction after load to see whether GeoFS changes multiplayer cadence after specific user gestures or aircraft state changes.
3. Keep building a scrubbed fixture corpus from the live captures:
  - successful `/map`
  - successful `/update`
  - `429` `/update`
  - malformed/noisy payload examples
4. Refine controller-facing traffic presentation so “live feed is healthy but no KMSP-local contacts match filters” is distinguished from true ingestion failure.
5. Use the diagnostics fields to validate that rate-limited `/update` states are surfaced distinctly from unsupported payloads and generic bridge degradation.
