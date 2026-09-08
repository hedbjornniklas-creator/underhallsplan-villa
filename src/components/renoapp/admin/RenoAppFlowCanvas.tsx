'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Handle, Position, useNodesState, useReactFlow, type Node, type NodeProps, type NodeChange } from '@xyflow/react'
import { Copy, GripVertical, Maximize, Minus, MoveRight, Plus, RotateCcw, Trash2, RefreshCw, CornerDownRight, X } from 'lucide-react'
import { canChooseFlowTarget, flattenFlow, flowSubtreeIds, flowTarget, type FlowNode, type FlowEdit, type FlowMovePreview } from '@/lib/renoapp/flowEditor'
import { FLOW_CARD_WIDTH, FLOW_CARD_INITIAL_HEIGHT, FLOW_LAYOUT_VERSION, layoutFlow } from '@/lib/renoapp/flowLayout'
import '@xyflow/react/dist/style.css'

type DiagramNode = Node<{ item: FlowNode; expanded: boolean }, 'flowCard'>
type Props = {
  root: FlowNode
  expandedIds: string[]
  disabled: boolean
  mutationsDisabled: boolean
  onPrepareEdit: (edit: FlowEdit) => Promise<FlowMovePreview>
  onApplyEdit: (edit: FlowEdit, version: string, label: string) => Promise<void>
  onToggle: (id: string) => void
  onOpen: (node: FlowNode) => void
  onReload: () => Promise<void>
}
type PositionMap = Record<string, { x: number; y: number }>
const colors = {
  stone: 'border-stone-300 bg-white', sky: 'border-sky-300 bg-sky-50',
  emerald: 'border-emerald-300 bg-emerald-50', amber: 'border-amber-300 bg-amber-50',
  rose: 'border-rose-300 bg-rose-50', violet: 'border-violet-300 bg-violet-50',
}
const labels = { root: 'Renoveringstyp', question: 'Fråga', option: 'Svar', document: 'Underlag', participant: 'Medverkande', flag: 'Flagga', status: 'Status' }
const iconButtonClass = 'nodrag nopan inline-flex shrink-0 items-center justify-center rounded border border-transparent text-stone-600 hover:border-stone-300 hover:bg-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-600'
const buttonClass = `${iconButtonClass} h-7 w-7`
const cardButtonClass = `${iconButtonClass} h-6 w-6`
type Selection = { operation: 'move' | 'copy'; source: FlowNode; sourceId: string }
const Actions = createContext<Pick<Props, 'onOpen' | 'onToggle' | 'disabled' | 'mutationsDisabled'> & {
  onRemove: (node: FlowNode) => void
  highlighted: string | null
  selection: Selection | null
  targetIds: Set<string>
  choose: (id: string, node: FlowNode, operation: 'move' | 'copy') => void
  selectTarget: (id: string) => void
} | null>(null)

function FlowCard({ id, data, selected }: NodeProps<DiagramNode>) {
  const actions = useContext(Actions)!
  const item = data.item
  const editable = item.ref.type !== 'status'
  const choosing = Boolean(actions.selection)
  const target = actions.targetIds.has(id)
  const source = actions.selection?.sourceId === id
  const title = <span className="line-clamp-3 [overflow-wrap:anywhere]">{item.title}</span>
  return <div data-flow-id={item.id} data-flow-target={choosing ? String(target) : undefined} style={{ width: FLOW_CARD_WIDTH }} className={`relative rounded-md border p-2 text-stone-900 shadow-sm ${colors[item.tone]} ${source || (!choosing && selected) ? 'ring-2 ring-sky-500' : ''} ${target || actions.highlighted === id ? 'ring-2 ring-emerald-600' : ''} ${choosing && !target && !source ? 'opacity-45' : ''}`}>
    {item.kind !== 'root' ? <Handle type="target" position={Position.Left} isConnectable={false} /> : null}
    <div className="flex h-6 items-center justify-between gap-1">
      <span className={`flow-drag-handle flex h-6 min-w-0 items-center gap-1 text-[10px] font-semibold text-stone-600 ${choosing ? '' : 'cursor-grab active:cursor-grabbing'}`} title="Flytta kortets placering">
        <GripVertical size={15} className="shrink-0" />{labels[item.kind]}
      </span>
      <div className="flex shrink-0">
        {!choosing && item.source ? <button type="button" className={cardButtonClass} disabled={actions.mutationsDisabled} title="Flytta koppling" aria-label="Flytta koppling" onClick={() => actions.choose(id, item, 'move')}><MoveRight size={15} /></button> : null}
        {!choosing && item.source ? <>
          <button type="button" className={cardButtonClass} disabled={actions.mutationsDisabled} title="Kopiera till en annan plats" aria-label="Kopiera till en annan plats" onClick={() => actions.choose(id, item, 'copy')}><Copy size={15} /></button>
          <button type="button" className={cardButtonClass} disabled={actions.mutationsDisabled} title="Ta bort från flödet" aria-label="Ta bort från flödet" onClick={() => actions.onRemove(item)}><Trash2 size={15} /></button>
        </> : null}
        {item.children.length ? <button type="button" className={`${cardButtonClass} relative z-20`} disabled={actions.disabled} title={data.expanded ? 'Fäll ihop' : 'Expandera'} aria-label={data.expanded ? 'Fäll ihop' : 'Expandera'} aria-expanded={data.expanded} onClick={() => actions.onToggle(item.id)}>{data.expanded ? <Minus size={15} /> : <Plus size={15} />}</button> : null}
      </div>
    </div>
    {choosing ? <div className="mt-1 text-[13px] font-semibold leading-[17px]">{title}</div> : <button type="button" className="nodrag nopan mt-1 block w-full text-left text-[13px] font-semibold leading-[17px] disabled:opacity-50" disabled={actions.disabled || !editable} aria-label={`Öppna ${item.title}`} title={item.title} onClick={() => actions.onOpen(item)}>{title}</button>}
    <div className="mt-1 flex h-4 items-center gap-1 overflow-hidden pr-4">
      {item.badges.map(badge => <span key={badge} title={badge} className="min-w-0 truncate rounded border border-stone-200 bg-white px-1 text-[10px] leading-[14px]">{badge}</span>)}
    </div>
    {item.children.length ? <Handle type="source" position={Position.Right} isConnectable={false} /> : null}
    {choosing ? <button type="button" className="nodrag nopan absolute inset-0 z-10 rounded-md enabled:cursor-pointer enabled:hover:bg-emerald-100/35 focus-visible:outline-4 focus-visible:outline-emerald-700" disabled={actions.mutationsDisabled || !target} aria-label={`Koppla hit: ${item.title}`} onClick={() => actions.selectTarget(id)}>
      {target ? <CornerDownRight size={16} className="absolute bottom-2 right-2 rounded bg-white text-emerald-700" /> : null}
    </button> : null}
  </div>
}

const nodeTypes = { flowCard: FlowCard }

function readPositions(key: string): PositionMap {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, position]) => position
      && Number.isFinite(position.x) && Number.isFinite(position.y)
      && Math.abs(position.x) < 100_000 && Math.abs(position.y) < 100_000))
  } catch { return {} }
}

function Canvas(props: Props) {
  const { root, expandedIds, disabled, mutationsDisabled, onReload } = props
  const flow = useReactFlow<DiagramNode>()
  const storageKey = `renoapp-flow-layout:${FLOW_LAYOUT_VERSION}:${root.id}`
  const positions = useRef<PositionMap>({})
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([])
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({})
  const handleNodesChange = useCallback((changes: NodeChange<DiagramNode>[]) => {
    onNodesChange(changes)
    const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions)
    if (dimensions.length) setCardHeights(current => {
      const next = { ...current }
      let changed = false
      for (const change of dimensions) {
        if (change.type === 'dimensions' && change.dimensions && change.dimensions.height > 0
          && next[change.id] !== change.dimensions.height) {
          next[change.id] = change.dimensions.height
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [onNodesChange])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fitAfterChange, setFitAfterChange] = useState(false)
  const operationInFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const [choice, setChoice] = useState<Selection | null>(null)
  const [preview, setPreview] = useState<{ edit: FlowEdit; result: FlowMovePreview; destinationNodeId?: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dragStart = useRef<{ id: string; position: { x: number; y: number }; movingIds: Set<string>; positions: PositionMap } | null>(null)
  const allOccurrences = useMemo(() => flattenFlow(root, null), [root])
  const occurrences = useMemo(() => flattenFlow(root, expandedIds), [root, expandedIds])
  const graph = useMemo(() => {
    const layout = layoutFlow(occurrences, cardHeights)
    return {
      nodes: occurrences.map(row => ({ id: row.id, type: 'flowCard' as const, dragHandle: '.flow-drag-handle',
        position: layout.get(row.id)!,
        data: { item: row.node, expanded: row.node === root || expandedIds.includes(row.node.id) } })),
      edges: occurrences.flatMap(row => row.parentId ? [{ id: `edge:${row.id}`, source: row.parentId, target: row.id,
        type: 'smoothstep', pathOptions: { offset: 16, borderRadius: 5 }, style: { stroke: '#78716c', strokeWidth: 1.5 }, reconnectable: false, deletable: false }] : []),
    }
  }, [occurrences, root, expandedIds, cardHeights])

  useEffect(() => {
    positions.current = readPositions(storageKey)
    const defaults = new Map(graph.nodes.map(node => [node.id, node.position]))
    const parents = new Map(occurrences.map(row => [row.id, row.parentId]))
    setNodes(graph.nodes.map(node => {
      if (positions.current[node.id]) return { ...node, position: positions.current[node.id] }
      // Newly expanded descendants inherit the nearest manually positioned ancestor.
      let parentId = parents.get(node.id)
      while (parentId) {
        const saved = positions.current[parentId], original = defaults.get(parentId)
        if (saved && original) return { ...node, position: {
          x: node.position.x + saved.x - original.x, y: node.position.y + saved.y - original.y,
        } }
        parentId = parents.get(parentId)
      }
      return node
    }))
  }, [graph, occurrences, storageKey, setNodes])

  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal()
  }, [preview])

  useEffect(() => {
    if (!choice) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setChoice(null) } }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [choice])

  useEffect(() => {
    if (choice && (disabled || mutationsDisabled || !allOccurrences.some(row => row.id === choice.sourceId))) setChoice(null)
  }, [choice, disabled, mutationsDisabled, allOccurrences])

  useEffect(() => {
    if (!fitAfterChange || busy) return
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.12, maxZoom: 1 })
      setFitAfterChange(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [nodes, busy, fitAfterChange, flow])

  const translatedBranch = (node: DiagramNode) => {
    const start = dragStart.current
    if (!start) return {}
    const dx = node.position.x - start.position.x, dy = node.position.y - start.position.y
    return Object.fromEntries(Object.entries(start.positions).map(([id, position]) => [id, { x: position.x + dx, y: position.y + dy }])) as PositionMap
  }
  const persistPosition = (node: DiagramNode) => {
    positions.current = { ...positions.current, ...translatedBranch(node) }
    try { localStorage.setItem(storageKey, JSON.stringify(positions.current)) }
    catch { setNotice('Placeringen kunde inte sparas i webbläsaren.') }
  }
  const restoreDrag = () => {
    const start = dragStart.current
    if (start) setNodes(current => current.map(node => start.positions[node.id] ? { ...node, position: start.positions[node.id] } : node))
  }
  const findDropTarget = (event: MouseEvent | TouchEvent, node: DiagramNode) => {
    const point = 'clientX' in event ? event : event.changedTouches[0]
    if (!point) return null
    const cursor = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY })
    return flow.getNodes().find(target => target.id !== node.id && !dragStart.current?.movingIds.has(target.id)
      && cursor.x >= target.position.x && cursor.x <= target.position.x + FLOW_CARD_WIDTH
      && cursor.y >= target.position.y && cursor.y <= target.position.y + (cardHeights[target.id] ?? FLOW_CARD_INITIAL_HEIGHT)) ?? null
  }
  const prepareEdit = async (source: FlowNode, destination: FlowNode | null, operation: FlowEdit['operation']) => {
    const target = destination && flowTarget(destination)
    if (!source.source || (operation !== 'remove' && !target) || disabled || mutationsDisabled || operationInFlight.current) return
    operationInFlight.current = true
    setBusy(true)
    setNotice(null)
    setChoice(null)
    const edit: FlowEdit = operation === 'remove' ? { source: source.source, operation }
      : { source: source.source, target: target!, operation }
    try {
      const result = await props.onPrepareEdit(edit)
      if (mounted.current) setPreview({ edit, result, destinationNodeId: destination?.id })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kunde inte förbereda ändringen.')
    } finally { setBusy(false); operationInFlight.current = false }
  }
  const applyEdit = async () => {
    if (!preview || operationInFlight.current) return
    const confirmed = preview
    operationInFlight.current = true
    setBusy(true)
    setPreview(null)
    if (confirmed.destinationNodeId && confirmed.destinationNodeId !== root.id && !expandedIds.includes(confirmed.destinationNodeId)) {
      props.onToggle(confirmed.destinationNodeId)
    }
    try {
      const verb = confirmed.edit.operation === 'copy' ? 'Kopiera' : confirmed.edit.operation === 'remove' ? 'Ta bort' : 'Flytta'
      await props.onApplyEdit(confirmed.edit, confirmed.result.version, `${verb}: ${confirmed.result.itemLabel}`)
      if (!mounted.current) return
      setNotice(confirmed.edit.operation === 'copy' ? 'Kortet har kopplats till den nya platsen. Originalet finns kvar.'
        : confirmed.edit.operation === 'remove' ? 'Kopplingen har tagits bort. Originalet och dess underfunktioner finns kvar.'
        : 'Kopplingen har flyttats.')
      setFitAfterChange(true)
    } catch {
      // The page-owned save queue keeps errors visible even after changing flow.
    } finally {
      if (mounted.current) setBusy(false)
      operationInFlight.current = false
    }
  }
  const targetIds = new Set(choice ? occurrences.filter(row => canChooseFlowTarget(choice.source, row.node, choice.operation)).map(row => row.id) : [])
  const selectTarget = (id: string) => {
    if (!choice || !targetIds.has(id) || disabled || mutationsDisabled || operationInFlight.current) return
    const target = occurrences.find(row => row.id === id)!
    void prepareEdit(choice.source, target.node, choice.operation)
  }
  const locked = disabled || Boolean(preview)
  const mutationLocked = locked || mutationsDisabled || busy

  return <section className="min-w-0" aria-label="Flödesdiagram">
    {choice ? <div role="status" className="mb-2 flex flex-col gap-2 rounded-md border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {choice.operation === 'move' ? <MoveRight size={18} className="shrink-0" /> : <Copy size={18} className="shrink-0" />}
        <span className="min-w-0 break-words font-semibold">{choice.operation === 'move' ? 'Flytta' : 'Kopiera'}: {choice.source.title}</span>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="text-emerald-900">{targetIds.size ? 'Välj mottagande kort' : 'Ingen möjlig koppling visas'}</span>
        <button type="button" className="inline-flex items-center gap-1 rounded border border-emerald-700 bg-white px-2 py-1.5 font-semibold" onClick={() => setChoice(null)}><X size={15} />Avbryt</button>
      </div>
    </div> : null}
    <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
      {notice ? <p role="status" className="mr-auto max-w-full text-sm text-stone-700">{notice}</p> : null}
      {busy ? <span role="status" className="mr-2 text-sm">Bearbetar...</span> : null}
      <button type="button" className={buttonClass} disabled={locked} aria-label="Zooma in" title="Zooma in" onClick={() => void flow.zoomIn()}><Plus size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Zooma ut" title="Zooma ut" onClick={() => void flow.zoomOut()}><Minus size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Visa hela flödet" title="Visa hela flödet" onClick={() => void flow.fitView({ padding: 0.12, maxZoom: 1 })}><Maximize size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked || Boolean(choice)} aria-label="Återställ kortens placering" title="Återställ kortens placering" onClick={() => {
        positions.current = {}
        try { localStorage.removeItem(storageKey) } catch { /* The diagram still resets in memory. */ }
        setNodes(graph.nodes)
        requestAnimationFrame(() => void flow.fitView({ padding: 0.12, maxZoom: 1 }))
      }}><RotateCcw size={17} /></button>
      <button type="button" className={buttonClass} disabled={mutationLocked || Boolean(choice)} aria-label="Ladda om flödet" title="Ladda om flödet" onClick={() => void onReload()}><RefreshCw size={17} /></button>
    </div>
    <div className="h-[min(72vh,820px)] min-h-[480px] w-full overflow-hidden rounded-md border border-stone-200 bg-stone-50">
      <Actions.Provider value={{ ...props, disabled: locked, mutationsDisabled: mutationLocked, highlighted, selection: choice, targetIds, selectTarget, onRemove: node => { void prepareEdit(node, null, 'remove') },
        choose: (id, node, operation) => {
          setNotice(null); setChoice({ operation, source: node, sourceId: id })
        } }}>
        <ReactFlow<DiagramNode> nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={handleNodesChange}
          fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.15} maxZoom={1.6}
          nodesDraggable={!locked && !choice} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
          nodesFocusable={!locked && !choice} edgesFocusable={false} multiSelectionKeyCode={null} selectionKeyCode={null}
          panOnDrag={!locked} zoomOnScroll={!locked} zoomOnPinch={!locked} zoomOnDoubleClick={false}
          onNodeDragStart={(_, node) => {
            const movingIds = flowSubtreeIds(allOccurrences, node.id)
            const knownPositions = { ...positions.current, ...Object.fromEntries(flow.getNodes().map(item => [item.id, { ...item.position }])) }
            dragStart.current = { id: node.id, position: { ...node.position }, movingIds,
              positions: Object.fromEntries(Object.entries(knownPositions).filter(([id]) => movingIds.has(id))) }
            setNotice(null)
          }}
          onNodeDrag={(event, node) => {
            const translated = translatedBranch(node)
            setNodes(current => current.map(item => translated[item.id] ? { ...item, position: translated[item.id] } : item))
            const target = mutationLocked ? null : findDropTarget(event, node)
            setHighlighted(target && canChooseFlowTarget(node.data.item, target.data.item, 'move') ? target.id : null)
          }}
          onNodeDragStop={(event, node) => {
            setHighlighted(null)
            const target = findDropTarget(event, node)
            if (target) {
              restoreDrag()
              if (mutationLocked) { setNotice('Vänta tills ändringarna sparats innan du ändrar en koppling.'); return }
              if (canChooseFlowTarget(node.data.item, target.data.item, 'move')) void prepareEdit(node.data.item, target.data.item, 'move')
              else setNotice(node.data.item.kind === 'option' ? 'Svarsalternativ hör till sin fråga. Flytta hela frågan för att behålla svarens betydelse.' : 'Kortet kan inte flyttas till den kopplingen.')
              return
            }
            const translated = translatedBranch(node)
            const movingIds = dragStart.current?.movingIds ?? new Set([node.id])
            const stationary = flow.getNodes().filter(other => !movingIds.has(other.id))
            const overlaps = flow.getNodes().filter(item => movingIds.has(item.id)).some(item => {
              const position = translated[item.id] ?? item.position
              return stationary.some(other => position.x < other.position.x + FLOW_CARD_WIDTH && position.x + FLOW_CARD_WIDTH > other.position.x
                && position.y < other.position.y + (cardHeights[other.id] ?? FLOW_CARD_INITIAL_HEIGHT)
                && position.y + (cardHeights[item.id] ?? FLOW_CARD_INITIAL_HEIGHT) > other.position.y)
            })
            if (overlaps) { restoreDrag(); setNotice('Grenen får inte överlappa andra kort. Välj en ledig plats.'); return }
            persistPosition(node)
          }}
        />
      </Actions.Provider>
    </div>
    {preview ? <dialog ref={dialog} aria-labelledby="flow-move-heading" onCancel={event => {
      event.preventDefault(); if (!busy) setPreview(null)
    }} className="fixed inset-0 m-auto max-h-[90vh] w-[min(560px,calc(100vw-32px))] overflow-auto rounded-md border border-stone-300 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/30">
      <h2 id="flow-move-heading" className="text-lg font-semibold">{preview.edit.operation === 'copy' ? 'Kopiera till en annan plats' : preview.edit.operation === 'remove' ? 'Ta bort från flödet' : 'Flytta koppling'}</h2>
      <p className="mt-3 break-words font-semibold">{preview.result.itemLabel}</p>
      <dl className="mt-4 grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-stone-500">Från</dt><dd className="break-words">{preview.result.fromLabel}</dd>
        {preview.edit.operation !== 'remove' ? <><dt className="text-stone-500">Till</dt><dd className="break-words">{preview.result.toLabel}</dd></> : null}
      </dl>
      <p className="mt-4 text-sm">{preview.edit.operation === 'copy'
        ? 'Samma kort med alla svar och underfunktioner kopplas till den nya platsen. Ingen ny fråge- eller underlagsdefinition skapas. Den befintliga kopplingen finns kvar.'
        : preview.edit.operation === 'remove'
          ? 'Endast den valda kopplingen tas bort. Originalet, dess svar och underfunktioner finns kvar i databasen och på andra platser där de är kopplade.'
          : 'Detta ändrar när kortet ingår i ansökningsflödet. Kortets underliggande kopplingar följer med.'}</p>
      {preview.edit.operation === 'copy' ? <p className="mt-3 text-sm">Ändringar i själva kortet och dess underfunktioner gäller på alla platser där samma kort används.</p> : null}
      {preview.result.shared ? <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">Frågor och svar är delade. Kopplingsändringen gäller i alla renoveringsflöden som använder {preview.edit.operation === 'copy' ? 'det mottagande kortet' : preview.edit.operation === 'remove' ? 'samma överordnade kort' : 'den gamla eller nya kopplingen'}.</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus disabled={busy} className="rounded border border-stone-300 px-4 py-2 text-sm disabled:opacity-50" onClick={() => setPreview(null)}>Avbryt</button>
        <button type="button" disabled={busy} className="rounded bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void applyEdit()}>{busy ? 'Bearbetar...' : preview.edit.operation === 'copy' ? 'Koppla hit' : preview.edit.operation === 'remove' ? 'Ta bort kopplingen' : 'Flytta koppling'}</button>
      </div>
    </dialog> : null}
  </section>
}

export default function RenoAppFlowCanvas(props: Props) {
  return <ReactFlowProvider key={props.root.id}><Canvas {...props} /></ReactFlowProvider>
}
