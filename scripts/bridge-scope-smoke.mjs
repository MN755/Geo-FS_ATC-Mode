import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual minified classic script injected into the host page.
// Both load orders must coexist with ordinary host globals. No network is used.
const bridge = await fs.readFile(new URL('../dist/page-bridge.js', import.meta.url), 'utf8');
const names = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'];
const host = `var ${names.map((name, index) => `${name}=${index + 1}`).join(',')};`;

for (const order of ['host-first', 'bridge-first']) {
  const messages = [];
  const fetchCalls = [];
  const response = { ok: true };
  let timers = 0;
  class FakeXhr {
    open() {}
    send() {}
    setRequestHeader() {}
  }
  const nativeSend = FakeXhr.prototype.send;
  const nativeFetch = async (...args) => { fetchCalls.push(args); return response; };
  const globals = {
    fetch: nativeFetch, Request, XMLHttpRequest: FakeXhr,
    document: { visibilityState: 'visible', addEventListener() {} },
    postMessage: message => messages.push(message),
    addEventListener() {}, setInterval: () => ++timers
  };
  globals.window = globals;
  const context = vm.createContext(globals);
  if (order === 'host-first') vm.runInContext(host, context);
  vm.runInContext(bridge, context, { filename: 'page-bridge.js', timeout: 1000 });
  if (order === 'bridge-first') vm.runInContext(host, context);
  for (const [index, name] of names.entries()) assert.equal(globals[name], index + 1);
  assert.equal(globals.__GE0FS_ATC_BRIDGE_INSTALLED__, true);
  assert.equal(globals.__GEOFS_ATC_FETCH_HOOKED__, true);
  assert.equal(globals.__GEOFS_ATC_XHR_HOOKED__, true);
  assert.notEqual(globals.fetch, nativeFetch);
  assert.notEqual(FakeXhr.prototype.send, nativeSend);
  assert.ok(messages.some(message => message.event.type === 'geofs:bridge-installed'));
  assert.equal(await globals.fetch('https://static.invalid/fixture'), response);
  assert.equal(fetchCalls.length, 1);
  const installedFetch = globals.fetch;
  const installedSend = FakeXhr.prototype.send;
  vm.runInContext(bridge, context, { filename: 'page-bridge.js', timeout: 1000 });
  assert.equal(globals.fetch, installedFetch);
  assert.equal(FakeXhr.prototype.send, installedSend);
  assert.equal(timers, 1, 'Reinjection installed another bridge timer');
  console.log(`Classic bridge scope passed: ${order}, host globals preserved, hooks active, reinjection idempotent.`);
}
