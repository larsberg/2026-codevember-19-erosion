// VS Code can retain a document anchor when the preview changes sketches.
// A UI flag appended to that anchor should work just like a page query.
export function drawerRequested(url) {
  const {searchParams, hash} = new URL(url);
  const queryStart = hash.indexOf('?');
  const fragment = new URLSearchParams(queryStart < 0 ? '' : hash.slice(queryStart + 1));
  const value = searchParams.get('ui') ?? fragment.get('ui');
  return ['true', '1'].includes(value?.toLowerCase());
}
