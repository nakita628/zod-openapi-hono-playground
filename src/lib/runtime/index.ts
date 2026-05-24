import * as esbuild from 'esbuild-wasm'
import esbuildWasmURL from 'esbuild-wasm/esbuild.wasm?url'

const BARE_MODULES = {
  hono: 'https://esm.sh/hono@4.12.22',
  zod: 'https://esm.sh/zod@4.4.3',
  '@hono/zod-openapi': 'https://esm.sh/@hono/zod-openapi@1.4.0?deps=hono@4.12.22,zod@4.4.3',
} as const

const DOC_CONFIG = {
  openapi: '3.0.0',
  info: { title: 'Playground', version: '0.0.0' },
  servers: [
    {
      url: 'http://localhost:8787',
      description: 'In-memory Hono app (intercepted by customFetch)',
    },
  ],
} as const

const ready = esbuild.initialize({ wasmURL: esbuildWasmURL })

export async function runUserCode(files: { readonly [key: string]: string }) {
  const resolveBare = (spec: string) => {
    for (const [pkg, url] of Object.entries(BARE_MODULES)) {
      if (spec === pkg) return url
      if (spec.startsWith(`${pkg}/`)) {
        const sub = spec.slice(pkg.length)
        const [base = url, query] = url.split('?')
        return query ? `${base}${sub}?${query}` : `${base}${sub}`
      }
    }
    return null
  }

  const virtualFs = {
    name: 'virtual-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return { path: '/index.ts', namespace: 'virtual' }
        if (args.path.startsWith('.'))
          return {
            path: new URL(args.path, `file://${args.importer}`).pathname,
            namespace: 'virtual',
          }
        const resolved = resolveBare(args.path)
        return resolved
          ? { external: true, path: resolved }
          : { errors: [{ text: `Unregistered module: ${args.path}` }] }
      })
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
        const key = args.path.replace(/^\//, '')
        const content = [key, `${key}.ts`, `${key}.tsx`]
          .map((candidate) => files[candidate])
          .find((value) => value !== undefined)
        return content !== undefined
          ? { contents: content, loader: 'ts' }
          : { errors: [{ text: `Module not found: ${args.path}` }] }
      })
    },
  } satisfies esbuild.Plugin

  const isHonoApp = (
    value: unknown,
  ): value is {
    readonly fetch: (req: Request) => Promise<Response>
    readonly getOpenAPIDocument: (config: {
      readonly openapi: string
      readonly info: { readonly title: string; readonly version: string }
      readonly servers?: readonly { readonly url: string; readonly description?: string }[]
    }) => { [key: string]: unknown }
  } => {
    if (typeof value !== 'object' || value === null) return false
    if (!('fetch' in value && 'getOpenAPIDocument' in value)) return false
    return typeof value.fetch === 'function' && typeof value.getOpenAPIDocument === 'function'
  }

  try {
    await ready
    const built = await esbuild.build({
      entryPoints: ['index.ts'],
      bundle: true,
      format: 'esm',
      write: false,
      target: 'es2020',
      plugins: [virtualFs],
    })
    const output = built.outputFiles[0]
    if (!output) throw new Error('esbuild produced no output')
    const url = URL.createObjectURL(new Blob([output.text], { type: 'text/javascript' }))
    try {
      const imported: unknown = await import(/* @vite-ignore */ url)
      const app =
        typeof imported === 'object' &&
        imported !== null &&
        'app' in imported &&
        isHonoApp(imported.app)
          ? imported.app
          : null
      if (!app) return { ok: false, error: 'Module must export `app: OpenAPIHono`' } as const
      return { ok: true, value: { app, doc: app.getOpenAPIDocument(DOC_CONFIG) } } as const
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
  }
}
