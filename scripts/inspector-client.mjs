// Local development-launcher debugging only. Verify the process identity before
// pausing or changing anything; never inspect the desktop's credentials/settings.
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function connectInspector(port, expectedPid) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  const pending = new Map(), listeners = new Map(); let nextId = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result); }
    else for (const listener of listeners.get(message.method) || []) listener(message.params);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const identity = await call('Runtime.evaluate', { expression: 'process.pid', returnByValue: true });
  if (identity.result.value !== expectedPid) { socket.close(); throw new Error('The inspector belongs to a different process; no changes were made.'); }
  return { call, on(method, fn) { const list = listeners.get(method) || []; list.push(fn); listeners.set(method, list); }, close() { socket.close(); } };
}

export async function disableRelaunchWatcher(client, scriptPath) {
  const scripts = new Map(), events = []; let waiter;
  const nextPause = () => {
    if (events.length) return Promise.resolve(events.shift());
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { waiter = null; reject(new Error('The launcher did not pause before restarting.')); }, 5000); waiter = event => { clearTimeout(timer); waiter = null; resolve(event); }; });
  };
  client.on('Debugger.scriptParsed', event => { scripts.set(event.scriptId, event.url); });
  client.on('Debugger.paused', event => { if (waiter) waiter(event); else events.push(event); });
  // Queue the pause immediately after enabling the domain, before spending time
  // inspecting script metadata. The running launcher's 350ms timer stays safe.
  const enabled = client.call('Debugger.enable'), pauseRequested = client.call('Debugger.pause');
  await Promise.all([enabled, pauseRequested]);
  let event = await nextPause();
  const actualPath = await realpath(scriptPath), actualUrl = pathToFileURL(actualPath).href;
  const script = [...scripts].find(([, url]) => url === actualUrl || url === actualPath);
  if (!script) throw new Error('Could not identify the Norae development launcher.');
  const { scriptSource } = await client.call('Debugger.getScriptSource', { scriptId: script[0] });
  const lines = scriptSource.split('\n');
  const lineNumber = lines.findIndex(line => line.includes('void desktop.restart()'));
  if (lineNumber < 0) throw new Error('The launcher does not match the expected restart code.');
  let frame = event.callFrames.find(frame => frame.location.scriptId === script[0]);
  if (!frame) {
    await client.call('Debugger.setBreakpoint', { location: { scriptId: script[0], lineNumber } });
    await client.call('Debugger.resume'); event = await nextPause();
    frame = event.callFrames.find(frame => frame.location.scriptId === script[0]);
  }
  if (!frame) throw new Error('The debugger stopped outside the expected launcher.');
  const result = await client.call('Debugger.evaluateOnCallFrame', {
    callFrameId: frame.callFrameId,
    expression: 'if (typeof server === "undefined" || typeof desktop === "undefined" || typeof watchers === "undefined") throw new Error("Missing launcher bindings"); stopped = true; clearTimeout(restartTimer); for (const watcher of watchers) watcher.close(); globalThis.__noraeUpgradeServer = server; globalThis.__noraeUpgradeDesktop = desktop; desktop.restart = () => Promise.resolve(); true',
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(`Could not safely disable the old restart watcher: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
  await client.call('Debugger.resume');
  await client.call('Debugger.disable');
}
