// Production-only device saves, isolated by sketch identity and published URL.
// Development remains on the existing GET/PUT file API, with no fallback.
export async function requestStaticSetup({method='GET',value,signal,url,validate,
  storage,fetcher=globalThis.fetch,
  bundledSetup=typeof __BUNDLED_SETUP__ === 'undefined' ? undefined : __BUNDLED_SETUP__}) {
  const key=`sketch-setup:2026-codevember-19-erosion:v1:${url}`;
  if(method==='PUT') {
    const settings=validate(value);
    if(!storage)throw new Error('Saving is unavailable in this browser.');
    storage.setItem(key,JSON.stringify(settings));return settings;
  }
  if(method!=='GET')throw new Error('Unsupported settings request.');
  try {
    const saved=storage?.getItem(key);
    if(saved!==null&&saved!==undefined)return validate(JSON.parse(saved));
  } catch {try{storage?.removeItem(key);}catch{}}
  if(bundledSetup!==undefined)return validate(structuredClone(bundledSetup));
  const response=await fetcher(url,{signal,cache:'no-store'});
  if(!response.ok)throw new Error(`Settings request failed (${response.status}).`);
  return validate(await response.json());
}
export function browserStorage(){try{return globalThis.localStorage;}catch{return undefined;}}
