export async function getBundledDts(moduleName: string) {
  const ESM_URL_PATTERN =
    /^https:\/\/esm\.sh\/(?:v\d+\/)?(@?[\w.-]+(?:\/[\w.-]+)?)(?:@[\w.\-+]+)?(\/[^?]*)?(?:\?.*)?$/

  const normalizeModulePath = (url: string) => {
    const matched = ESM_URL_PATTERN.exec(url)
    if (!matched) return (url.split('?')[0] ?? url).replace(/\.d\.ts$/, '')
    const pkg = matched[1] ?? ''
    const subpath = (matched[2] ?? '').replace(/\.d\.ts$/, '')
    return `${pkg}${subpath}`
  }

  const walkDts = async (
    rootUrl: string,
    visited: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, string>> => {
    if (visited.has(rootUrl)) return visited
    const res = await fetch(rootUrl)
    const dts = res.ok ? await res.text() : ''
    const dtsImports = Array.from(dts.matchAll(/from\s+["']([^"']+)["']/g))
      .map((match) => match[1] ?? '')
      .filter((p) => p.endsWith('.d.ts'))
    const resolvedUrls = dtsImports.map((p) => new URL(p, rootUrl).toString())
    const rewritten = dtsImports.reduce(
      (acc, original, index) =>
        acc.replace(original, normalizeModulePath(resolvedUrls[index] ?? '')),
      dts,
    )
    const next = new Map(visited).set(rootUrl, rewritten)
    return resolvedUrls.reduce<Promise<ReadonlyMap<string, string>>>(
      async (accPromise, childUrl) => walkDts(childUrl, await accPromise),
      Promise.resolve(next),
    )
  }

  const res = await fetch(`https://esm.sh/${moduleName}`)
  if (!res.ok) return ''
  const indexDtsUrl = res.headers.get('x-typescript-types')
  if (!indexDtsUrl) return ''
  const files = await walkDts(indexDtsUrl, new Map())
  const declarations = Array.from(files.entries())
    .map(([url, dts]) => `declare module "${normalizeModulePath(url)}"{${dts}}`)
    .join('\n')
  return `${declarations}\ndeclare module "${moduleName}" {export * from "${normalizeModulePath(indexDtsUrl)}"}`
}
