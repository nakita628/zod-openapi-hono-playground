import { bundleFiles } from '@/lib'

export async function runUserCode(files: { readonly [key: string]: string }) {
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

  const extractApp = (module: unknown) => {
    if (typeof module !== 'object' || module === null) return null
    if (!('app' in module)) return null
    return isHonoApp(module.app) ? module.app : null
  }

  const docConfig = {
    openapi: '3.0.0',
    info: { title: 'Playground', version: '0.0.0' },
    servers: [
      {
        url: 'http://localhost:8787',
        description: 'In-memory Hono app (intercepted by customFetch)',
      },
    ],
  } as const

  try {
    const code = await bundleFiles(files, 'index.ts')
    const blob = new Blob([code], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      const imported = await import(/* @vite-ignore */ url)
      const app = extractApp(imported)
      if (!app) {
        return { ok: false, error: 'Module must export `app: OpenAPIHono`' } as const
      }
      const doc = app.getOpenAPIDocument(docConfig)
      return { ok: true, value: { app, doc } } as const
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
  }
}
