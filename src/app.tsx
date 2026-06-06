import Editor, { useMonaco, type OnMount } from '@monaco-editor/react'
import { ApiReferenceReact } from '@scalar/api-reference-react'

import '@scalar/api-reference-react/style.css'
import type { AnyApiReferenceConfiguration } from '@scalar/api-reference-react'
import type { editor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeRendererProps } from 'react-arborist'
import type { IconType } from 'react-icons'
import { SiTypescript } from 'react-icons/si'
import { VscChevronDown, VscChevronRight, VscFolder, VscFolderOpened } from 'react-icons/vsc'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { getBundledDts, runUserCode } from '@/lib'

const DESKTOP_BREAKPOINT = '(min-width: 768px)'

const fileNames = ['index.ts', 'handler.ts', 'route.ts'] as const

const playgroundFiles: { [K in 'index.ts' | 'handler.ts' | 'route.ts']: string } = {
  'index.ts': `import { OpenAPIHono } from '@hono/zod-openapi'
import { getRouteHandler } from './handler'
import { getRoute } from './route'

export const app = new OpenAPIHono()

app.openapi(getRoute, getRouteHandler)
`,
  'handler.ts': `import type { RouteHandler } from '@hono/zod-openapi'
import { getRoute } from './route'

export const getRouteHandler: RouteHandler<typeof getRoute> = async (c) => {
  return c.json({ message: 'Hono🔥' })
}
`,
  'route.ts': `import { createRoute, z } from '@hono/zod-openapi'

export const getRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  },
})
`,
}

const extraLibModules = [
  { name: '@hono/zod-openapi', path: 'file:///node_modules/@hono/zod-openapi/index.d.ts' },
  { name: 'zod', path: 'file:///node_modules/zod/index.d.ts' },
] as const

const ZOD_OPENAPI_AUGMENT_BODY = `
  interface ZodType {
    openapi(refId: string, metadata?: Record<string, unknown>): this
    openapi(metadata: Record<string, unknown>): this
  }
`

const fileUri = (name: 'index.ts' | 'handler.ts' | 'route.ts') => `file:///src/${name}`

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_BREAKPOINT).matches)
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_BREAKPOINT)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

type FileNode = {
  readonly id: string
  readonly name: string
  readonly children?: readonly FileNode[]
}

const TREE_DATA: readonly FileNode[] = [
  {
    id: 'src',
    name: 'src',
    children: fileNames.map((name) => ({ id: name, name })),
  },
]

const isPlaygroundFile = (id: string): id is (typeof fileNames)[number] =>
  id === 'index.ts' || id === 'handler.ts' || id === 'route.ts'

const FileNodeRow = ({ node, style }: NodeRendererProps<FileNode>) => {
  const Caret: IconType | null = node.isInternal
    ? node.isOpen
      ? VscChevronDown
      : VscChevronRight
    : null
  const Icon: IconType = node.isInternal
    ? node.isOpen
      ? VscFolderOpened
      : VscFolder
    : SiTypescript
  return (
    <div
      style={style}
      onClick={() => (node.isInternal ? node.toggle() : node.select())}
      className={`flex h-full cursor-pointer items-center gap-1.5 pr-3 font-sans text-[13px] text-vs-text ${
        node.isSelected && node.isLeaf ? 'bg-vs-bg-active' : 'hover:bg-vs-bg-active/50'
      }`}
    >
      <span className="inline-flex w-4 shrink-0 items-center justify-center">
        {Caret ? <Caret size={14} /> : null}
      </span>
      <Icon size={14} className="shrink-0" {...(node.isLeaf ? { color: '#3178C6' } : {})} />
      <span className="truncate">{node.data.name}</span>
    </div>
  )
}

const FileTree = ({
  active,
  onSelect,
}: {
  readonly active: 'index.ts' | 'handler.ts' | 'route.ts'
  readonly onSelect: (name: 'index.ts' | 'handler.ts' | 'route.ts') => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="h-full">
      <Tree<FileNode>
        data={TREE_DATA}
        openByDefault
        width="100%"
        height={height}
        rowHeight={26}
        indent={16}
        selection={active}
        onActivate={(node) => {
          if (!node.isLeaf) return
          if (isPlaygroundFile(node.id)) onSelect(node.id)
        }}
        disableMultiSelection
        disableDrag
        disableDrop
        disableEdit
      >
        {FileNodeRow}
      </Tree>
    </div>
  )
}

const CodeEditor = ({
  activeFile,
  onFilesChange,
}: {
  readonly activeFile: 'index.ts' | 'handler.ts' | 'route.ts'
  readonly onFilesChange?: (files: {
    [K in 'index.ts' | 'handler.ts' | 'route.ts']: string
  }) => void
}) => {
  const monaco = useMonaco()
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!monaco) return
    const { typescriptDefaults, ScriptTarget, ModuleKind, ModuleResolutionKind, JsxEmit } =
      monaco.typescript
    typescriptDefaults.setCompilerOptions({
      target: ScriptTarget.ES2020,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.NodeJs,
      jsx: JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      noEmit: true,
      strict: true,
    })

    for (const name of fileNames) {
      const uri = monaco.Uri.parse(fileUri(name))
      if (!monaco.editor.getModel(uri)) {
        monaco.editor.createModel(playgroundFiles[name], 'typescript', uri)
      }
    }

    void Promise.all(
      extraLibModules.map(async ({ name, path }) => {
        const augment = name === 'zod' ? ZOD_OPENAPI_AUGMENT_BODY : ''
        const marker = name === 'zod' ? 'interface ZodType' : ''
        const exclude = name === '@hono/zod-openapi' ? ['zod'] : []
        const dts = await getBundledDts(name, augment, marker, exclude)
        if (dts) typescriptDefaults.addExtraLib(dts, path)
      }),
    )
  }, [monaco])

  useEffect(() => {
    if (!monaco || !editorInstance) return
    const uri = monaco.Uri.parse(fileUri(activeFile))
    const model = monaco.editor.getModel(uri)
    if (model) editorInstance.setModel(model)
  }, [monaco, editorInstance, activeFile])

  useEffect(() => {
    if (!monaco || !onFilesChange) return
    const getValue = (name: 'index.ts' | 'handler.ts' | 'route.ts') =>
      monaco.editor.getModel(monaco.Uri.parse(fileUri(name)))?.getValue() ?? ''
    const emitSnapshot = () => {
      onFilesChange({
        'index.ts': getValue('index.ts'),
        'handler.ts': getValue('handler.ts'),
        'route.ts': getValue('route.ts'),
      })
    }
    const disposers = fileNames.map((name) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(fileUri(name)))
      return model ? model.onDidChangeContent(emitSnapshot) : null
    })
    return () => {
      for (const disposer of disposers) {
        if (disposer) disposer.dispose()
      }
    }
  }, [monaco, onFilesChange])

  const handleMount: OnMount = (instance) => {
    setEditorInstance(instance)
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      onMount={handleMount}
      options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }}
    />
  )
}

const ApiReference = ({
  doc,
  app,
  error,
}: {
  readonly doc: { [key: string]: unknown } | null
  readonly app: {
    readonly fetch: (req: Request) => Promise<Response>
    readonly getOpenAPIDocument: (config: {
      readonly openapi: string
      readonly info: { readonly title: string; readonly version: string }
      readonly servers?: readonly { readonly url: string; readonly description?: string }[]
    }) => { [key: string]: unknown }
  } | null
  readonly error: string | null
}) => {
  const customFetch = useMemo<typeof fetch | undefined>(() => {
    if (!app) return undefined
    const wrappedFetch: typeof fetch = async (input, init) => {
      const requestUrl =
        input instanceof Request
          ? input.url
          : new URL(input.toString(), 'http://localhost:8787').toString()
      const request = input instanceof Request ? input : new Request(requestUrl, init)
      const response = await app.fetch(request)
      return new Proxy(response, {
        get(target, prop) {
          if (prop === 'url') return requestUrl
          const value = Reflect.get(target, prop, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    return wrappedFetch
  }, [app])

  const configuration = useMemo<AnyApiReferenceConfiguration>(
    () => ({
      darkMode: true,
      layout: 'modern',
      hideClientButton: true,
      ...(doc ? { content: doc } : {}),
      ...(customFetch ? { customFetch } : {}),
    }),
    [doc, customFetch],
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      {error && (
        <div className="border-b border-b-red-200 border-l-4 border-l-red-600 bg-red-50 px-3 py-2 font-sans text-[13px] whitespace-pre-wrap text-red-800">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {doc && <ApiReferenceReact configuration={configuration} />}
      </div>
    </div>
  )
}

const App = () => {
  const isDesktop = useIsDesktop()
  const [activeFile, setActiveFile] = useState<'index.ts' | 'handler.ts' | 'route.ts'>('index.ts')
  const [activeTab, setActiveTab] = useState<'tree' | 'code' | 'api'>('code')
  const [files, setFiles] = useState<{
    [K in 'index.ts' | 'handler.ts' | 'route.ts']: string
  }>(playgroundFiles)
  const [app, setApp] = useState<{
    readonly fetch: (req: Request) => Promise<Response>
    readonly getOpenAPIDocument: (config: {
      readonly openapi: string
      readonly info: { readonly title: string; readonly version: string }
      readonly servers?: readonly { readonly url: string; readonly description?: string }[]
    }) => { [key: string]: unknown }
  } | null>(null)
  const [doc, setDoc] = useState<{ [key: string]: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFilesChange = useCallback(
    (next: { [K in 'index.ts' | 'handler.ts' | 'route.ts']: string }) => {
      setFiles(next)
    },
    [],
  )

  useEffect(() => {
    const abortController = new AbortController()
    const timer = setTimeout(async () => {
      if (abortController.signal.aborted) return
      const result = await runUserCode(files)
      if (abortController.signal.aborted) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setApp(result.value.app)
      setDoc(result.value.doc)
      setError(null)
    })
    return () => {
      abortController.abort()
      clearTimeout(timer)
    }
  }, [files])

  if (isDesktop) {
    return (
      <Group orientation="horizontal" className="h-screen w-screen">
        <Panel defaultSize={15} minSize={10}>
          <FileTree active={activeFile} onSelect={setActiveFile} />
        </Panel>
        <Separator className="w-1 cursor-col-resize touch-none bg-vs-border transition-colors hover:bg-vs-accent active:bg-vs-accent" />
        <Panel defaultSize={42} minSize={20}>
          <CodeEditor activeFile={activeFile} onFilesChange={handleFilesChange} />
        </Panel>
        <Separator className="w-1 cursor-col-resize touch-none bg-vs-border transition-colors hover:bg-vs-accent active:bg-vs-accent" />
        <Panel defaultSize={43} minSize={20}>
          <ApiReference doc={doc} app={app} error={error} />
        </Panel>
      </Group>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex shrink-0 border-b border-vs-border bg-vs-bg">
        {(['tree', 'code', 'api'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            data-active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 cursor-pointer border-0 bg-transparent p-3 font-sans text-[13px] text-vs-text data-[active=true]:bg-vs-bg-active data-[active=true]:text-white"
          >
            {tab === 'tree' ? 'Files' : tab === 'code' ? 'Code' : 'API'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'tree' && (
          <FileTree
            active={activeFile}
            onSelect={(name) => {
              setActiveFile(name)
              setActiveTab('code')
            }}
          />
        )}
        {activeTab === 'code' && (
          <CodeEditor activeFile={activeFile} onFilesChange={handleFilesChange} />
        )}
        {activeTab === 'api' && <ApiReference doc={doc} app={app} error={error} />}
      </div>
    </div>
  )
}

export default App
