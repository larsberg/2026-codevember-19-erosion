import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, siteEntry } from './manifest.js';

export function checkRelease(root = process.cwd()) {
  const dist = path.join(root, 'dist');
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dist, 'sketch.json'))));
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'public/sketch.json')));
  if (JSON.stringify(manifest) !== JSON.stringify(sourceManifest)) throw Error('Rebuild: deployed metadata is stale.');
  for (const name of ['index.html', 'catalogue.json', ...(manifest.url ? ['site-entry.json'] : []), '.nojekyll', manifest.thumbnail.src]) {
    if (!fs.existsSync(path.join(dist, name))) throw Error(`Incomplete release: ${name}. Capture the thumbnail, then rebuild.`);
  }
  const image = fs.readFileSync(path.join(dist, manifest.thumbnail.src));
  let dimensions;
  if (image.length >= 24 && image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    dimensions = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  } else if (image.length > 4 && image.readUInt16BE(0) === 0xffd8) {
    // Support the inherited Shatter thumbnail capture, which writes JPEG.
    for (let offset = 2; offset + 4 < image.length;) {
      if (image[offset++] !== 0xff) break;
      while (image[offset] === 0xff) offset++;
      const marker = image[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = image.readUInt16BE(offset);
      if (length < 2 || offset + length > image.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        dimensions = { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) }; break;
      }
      offset += length;
    }
  }
  if (!dimensions) throw Error('Expected a readable PNG or JPEG thumbnail.');
  if (dimensions.width !== manifest.thumbnail.width || dimensions.height !== manifest.thumbnail.height) throw Error('Thumbnail dimensions do not match the manifest.');
  if (manifest.url) {
    const entry = JSON.parse(fs.readFileSync(path.join(dist, 'site-entry.json')));
    if (JSON.stringify(entry) !== JSON.stringify(siteEntry(manifest))) throw Error('Stale gallery entry.');
  }
  const catalogue = JSON.parse(fs.readFileSync(path.join(dist, 'catalogue.json')));
  if (catalogue.sketches.length !== 1 || catalogue.sketches[0].id !== manifest.id) throw Error('Incorrect catalogue identity.');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = match[1];
    if (/^(?:[a-z]+:|#)/i.test(url)) continue;
    if (url.startsWith('/')) throw Error(`Root-relative asset breaks Pages subpaths: ${url}`);
    if (!fs.existsSync(path.resolve(dist, url.split(/[?#]/)[0]))) throw Error(`Missing HTML asset: ${url}`);
  }
  const setupName = fs.existsSync(path.join(root, 'public/settings.json')) ? 'settings.json' : 'setup.json';
  if (!fs.readFileSync(path.join(root, 'public', setupName)).equals(fs.readFileSync(path.join(dist, setupName)))) throw Error('Rebuild: published preset differs from the saved file.');
  if (!fs.readdirSync(path.join(dist, 'assets')).some(file => file.endsWith('.wasm'))) throw Error('Missing Box3D WebAssembly asset.');
  for (const name of ['node_modules', 'src', 'server', 'references', 'ignoreMe', '.git', '.env']) {
    if (fs.existsSync(path.join(dist, name))) throw Error(`Unexpected development files in release: ${name}`);
  }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = checkRelease();
  console.log(`Release verified: ${manifest.id}`);
}
