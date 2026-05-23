import * as esbuild from 'esbuild-wasm'
import esbuildWasmURL from 'esbuild-wasm/esbuild.wasm?url'

export async function bundleFiles(files: { readonly [key: string]: string }, entry: string) {
  await esbuild.initialize({ wasmURL: esbuildWasmURL })

  const resolveBare = (spec: string) => {
    for (const [pkg, url] of Object.entries({
      hono: 'https://esm.sh/hono@4.12.22',
      zod: 'https://esm.sh/zod@4.4.3',
      '@hono/zod-openapi': 'https://esm.sh/@hono/zod-openapi@1.4.0?deps=hono@4.12.22,zod@4.4.3',
    } as const)) {
      if (spec === pkg) return url
      if (spec.startsWith(`${pkg}/`)) {
        const sub = spec.slice(pkg.length)
        const [base = url, query] = url.split('?')
        return query ? `${base}${sub}?${query}` : `${base}${sub}`
      }
    }
    return null
  }

  const virtualFs: esbuild.Plugin = {
    name: 'virtual-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return { path: `/${entry}`, namespace: 'virtual' }
        }
        if (args.path.startsWith('.')) {
          const url = new URL(args.path, `file://${args.importer}`)
          return { path: url.pathname, namespace: 'virtual' }
        }
        const resolved = resolveBare(args.path)
        if (resolved) return { external: true, path: resolved }
        return { errors: [{ text: `Unregistered module: ${args.path}` }] }
      })
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
        const key = args.path.replace(/^\//, '')
        for (const candidate of [key, `${key}.ts`, `${key}.tsx`]) {
          const content = files[candidate]
          if (content !== undefined) return { contents: content, loader: 'ts' }
        }
        return { errors: [{ text: `Module not found: ${args.path}` }] }
      })
    },
  }

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    target: 'es2020',
    plugins: [virtualFs],
  })
  const output = result.outputFiles[0]
  if (!output) throw new Error('esbuild produced no output')
  return output.text
}
