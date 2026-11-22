import { requestStaticSetup, browserStorage } from './static-setup.js';
import { validateSetup } from './settings.js';

// Same GET/PUT file workflow as the working sketches. Settings always belong to
// this sketch's API and public/settings.json in development; there is no API fallback.
async function readResponse(response) {
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw Error('Settings API is not loaded. Restart this sketch’s dev server so it loads vite.config.js.');
  }
  if (response.headers.get('X-Sketch-Id') !== '19-erosion') throw Error('This settings API is not 19-erosion.');
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Settings request failed.');
  return validateSetup(result);
}
export async function requestSetup(method = 'GET', value) {
  if (import.meta.env?.PROD) return requestStaticSetup({ method, value, validate: validateSetup, storage: browserStorage(),
    url: new URL(`${import.meta.env.BASE_URL}settings.json`, location.href).href });
  if (method === 'GET') return readResponse(await fetch('/api/setup', { cache: 'no-store' }));
  if (method !== 'PUT') throw Error('Use GET or PUT for settings.');
  const settings = validateSetup(value);
  // Check ownership before writing to a port shared by several sketches.
  await requestSetup();
  await readResponse(await fetch('/api/setup', {
    method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Sketch-Id': '19-erosion' }, body: JSON.stringify(settings),
  }));
  // Only show Saved after a fresh API read returns the entire persisted setup.
  const saved = await requestSetup();
  if (JSON.stringify(saved) !== JSON.stringify(settings)) throw Error('Save verification failed: the API did not retain these settings.');
  return saved;
}
