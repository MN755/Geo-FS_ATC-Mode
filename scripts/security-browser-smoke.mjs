import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect as baseExpect } from 'playwright/test';

const dist = path.resolve('dist');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const expect = baseExpect.configure({ timeout: 20_000 });

async function withExtension(run) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'geofs-security-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false, viewport: { width: 1600, height: 1200 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  try {
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const id = new URL(worker.url()).host;
    await run(context, `chrome-extension://${id}/workspace.html`);
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

await withExtension(async (context, url) => {
  await context.route('https://demotiles.maplibre.org/style.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8,
      sources: { fixture: { type: 'geojson', data: { type: 'FeatureCollection', features: [] },
        attribution: '<a href="javascript:window.__mapXss=1" onclick="window.__mapXss=1">Unsafe</a>' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce8eb' } },
        { id: 'fixture', type: 'circle', source: 'fixture' }] })
  }));
  const page = await context.newPage();
  let errors = 0, overlayImages = 0;
  page.on('pageerror', () => errors++);
  context.on('response', response => {
    if (response.url().includes('/charts/kmsp/kmsp-airport-diagram-ground.png')
      && response.status() === 200) overlayImages++;
  });
  await page.goto(url);
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(3);
  await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible();
  const overlay = page.getByLabel('Show aligned overlay');
  await expect(overlay).toBeChecked();
  await overlay.uncheck();
  await expect(overlay).not.toBeChecked();
  await overlay.check();
  await expect(overlay).toBeChecked();
  await expect.poll(() => overlayImages).toBeGreaterThan(0);
  await page.locator('button.reference-open').filter({ hasText: 'KMSP Airport Diagram PDF' }).first().click();
  await expect(page.locator('.pdf-toolbar')).toContainText('Page 1 / 1');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    return canvas?.width > 300 && canvas?.height > 300;
  });
  const pixels = await page.locator('.pdf-canvas').evaluate(canvas =>
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0));
  assert.ok(pixels, 'PDF rendering produced an empty canvas');
  await page.getByPlaceholder('Search inside PDF').fill('airport');
  await expect(page.locator('.pdf-search-results button').first()).toBeVisible();
  await page.locator('.pdf-search-results button').first().click();
  await page.reload();
  await expect(page.locator('body')).toContainText('PDF text cache hit');
  const attribution = await page.evaluate(() => ({
    count: document.querySelectorAll('.maplibregl-ctrl-attrib').length,
    dangerous: [...document.querySelectorAll('.maplibregl-ctrl-attrib *')].some(element =>
      [...element.attributes].some(attribute => attribute.name.startsWith('on')
        || (attribute.name === 'href' && /^javascript:/i.test(attribute.value)))),
    executed: !!window.__mapXss
  }));
  assert.ok(attribution.count > 0);
  assert.equal(attribution.dangerous, false);
  assert.equal(attribution.executed, false);
  assert.equal(errors, 0, 'Extension fixture raised a page error');
  console.log('Extension fixtures passed: three maps, overlay toggling/image, sanitized attribution, PDF pixels/search/cache.');
});

await withExtension(async (context, url) => {
  // Count status results only. Never collect live response bodies, chat, aircraft,
  // session identifiers, URLs with query strings, browser profiles or screenshots.
  const counts = { updates: 0, maps: 0, basemap: 0, weather: 0 };
  const bootstrapResponses = {};
  const bootstrapPaths = new Set(['/js/commonJS.js', '/js/geofs.js', '/js/Cesium/build/Cesium.js']);
  let errors = 0;
  context.on('response', response => {
    const u = new URL(response.url());
    if (u.hostname === 'www.geo-fs.com' && bootstrapPaths.has(u.pathname))
      bootstrapResponses[u.pathname] = response.status();
    if (response.status() !== 200) return;
    if (u.hostname.endsWith('.geo-fs.com') && u.pathname === '/update') counts.updates++;
    if (u.hostname.endsWith('.geo-fs.com') && u.pathname === '/map') counts.maps++;
    if (u.hostname === 'demotiles.maplibre.org') counts.basemap++;
    if (u.hostname === 'aviationweather.gov') counts.weather++;
  });
  const ui = await context.newPage();
  ui.on('pageerror', () => errors++);
  await ui.goto(url);
  await expect(ui.locator('canvas.maplibregl-canvas')).toHaveCount(3);
  const game = await context.newPage();
  const response = await game.goto('https://www.geo-fs.com/geofs.php?v=3.8',
    { waitUntil: 'domcontentloaded', timeout: 90_000 });
  assert.equal(response.status(), 200, 'Live GeoFS page was unavailable');
  await game.bringToFront();
  try {
  // GeoFS loads its engine scripts after window.load, then exposes Fly. Wait
  // for that actual state, including sessions that start without a welcome modal.
  await game.waitForFunction(() => !!window.geofs?.aircraft?.instance
    || !!document.querySelector('.geofs-startModal .geofs-fly-button')?.offsetParent,
  undefined, { timeout: 90_000 });
  const start = game.locator('.geofs-startModal .geofs-fly-button');
  if (await start.isVisible()) await start.click();
  // Do not fill a chat field or invoke any outbound-chat action.
  await expect.poll(() => counts.updates, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => counts.maps, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => counts.basemap, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => counts.weather, { timeout: 30_000 }).toBeGreaterThan(0);
  const link = ui.locator('.status-cluster').filter({ hasText: 'GeoFS Link' }).locator('strong');
  await expect(link).toHaveText('Attached');
  await ui.bringToFront();
  await sleep(15_000);
  await expect(link).toHaveText('Foreground required');
  assert.equal(errors, 0, 'Live extension raised a page error');
  console.log('Live read-only integration passed:', JSON.stringify(counts));
  } finally {
    const bootstrap = await game.evaluate(() => ({
      ready: document.readyState, deferredLoaded: !!window.eventdone?.deferredload,
      aircraftReady: !!window.geofs?.aircraft?.instance,
      startVisible: !!document.querySelector('.geofs-startModal .geofs-fly-button')?.offsetParent,
      deferredScripts: document.querySelectorAll('script[data-deferredsrc]').length
    }));
    console.log('Live readiness diagnostics:', JSON.stringify({ counts, bootstrap, bootstrapResponses }));
  }
});
