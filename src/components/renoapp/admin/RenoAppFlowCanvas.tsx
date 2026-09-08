'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Handle, Position, useNodesState, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { Copy, GripVertical, Maximize, Minus, MoveRight, Plus, RotateCcw, Trash2, RefreshCw } from 'lucide-react'
import { canDropFlowNode, flattenFlow, flowSubtreeIds, flowTarget, type FlowNode, type FlowMove, type FlowMovePreview } from '@/lib/renoapp/flowEditor'
import '@xyflow/react/dist/style.css'

type DiagramNode = Node<{ item: FlowNode; expanded: boolean }, 'flowCard'>
type Props = {
  root: FlowNode
  expandedIds: string[]
  disabled: boolean
  onToggle: (id: string) => void
  onOpen: (node: FlowNode) => void
  onCopy: (node: FlowNode) => void
  onRemove: (node: FlowNode) => void
  onReload: () => Promise<void>
}
type PositionMap = Record<string, { x: number; y: number }>
const WIDTH = 240
const HEIGHT = 156
const colors = {
  stone: 'border-stone-300 bg-white', sky: 'border-sky-300 bg-sky-50',
  emerald: 'border-emerald-300 bg-emerald-50', amber: 'border-amber-300 bg-amber-50',
  rose: 'border-rose-300 bg-rose-50', violet: 'border-violet-300 bg-violet-50',
}
const labels = { root: 'Renoveringstyp', question: 'Fråga', option: 'Svar', document: 'Underlag', participant: 'Medverkande', flag: 'Flagga', status: 'Status' }
const buttonClass = 'nodrag nopan inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-transparent text-stone-600 hover:border-stone-300 hover:bg-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-600'
const Actions = createContext<Pick<Props, 'onOpen' | 'onCopy' | 'onRemove' | 'onToggle' | 'disabled'> & {
  highlighted: string | null; chooseMove: (node: FlowNode) => void
} | null>(null)

function FlowCard({ id, data, selected }: NodeProps<DiagramNode>) {
  const actions = useContext(Actions)!
  const item = data.item
  const editable = item.ref.type !== 'status'
  return <div data-flow-id={item.id} className={`h-[156px] w-[240px] rounded-md border p-2.5 text-stone-900 shadow-sm ${colors[item.tone]} ${selected ? 'ring-2 ring-sky-500' : ''} ${actions.highlighted === id ? 'ring-4 ring-emerald-500' : ''}`}>
    {item.kind !== 'root' ? <Handle type="target" position={Position.Left} isConnectable={false} /> : null}
    <div className="flex h-7 items-center justify-between gap-1">
      <span className="flow-drag-handle flex h-7 min-w-0 cursor-grab items-center gap-1 text-[11px] font-semibold text-stone-600 active:cursor-grabbing" title="Flytta kort">
        <GripVertical size={15} className="shrink-0" />{labels[item.kind]}
      </span>
      <div className="flex shrink-0">
        {item.source ? <button type="button" className={buttonClass} disabled={actions.disabled} title="Flytta koppling" aria-label="Flytta koppling" onClick={() => actions.chooseMove(item)}><MoveRight size={15} /></button> : null}
        {editable ? <>
          <button type="button" className={buttonClass} disabled={actions.disabled} title="Skapa kopia" aria-label="Skapa kopia" onClick={() => actions.onCopy(item)}><Copy size={15} /></button>
          <button type="button" className={buttonClass} disabled={actions.disabled} title={item.kind === 'root' ? 'Radera renoveringstyp överallt' : 'Ta bort från flödet'} aria-label={item.kind === 'root' ? 'Radera renoveringstyp överallt' : 'Ta bort från flödet'} onClick={() => actions.onRemove(item)}><Trash2 size={15} /></button>
        </> : null}
        {item.children.length ? <button type="button" className={buttonClass} disabled={actions.disabled} title={data.expanded ? 'Fäll ihop' : 'Expandera'} aria-label={data.expanded ? 'Fäll ihop' : 'Expandera'} aria-expanded={data.expanded} onClick={() => actions.onToggle(item.id)}>{data.expanded ? <Minus size={15} /> : <Plus size={15} />}</button> : null}
      </div>
    </div>
    <button type="button" className="nodrag nopan mt-1 block h-[60px] w-full text-left text-sm font-semibold leading-5 disabled:opacity-50" disabled={actions.disabled || !editable} aria-label={`Öppna ${item.title}`} title={item.title} onClick={() => actions.onOpen(item)}>
      <span className="line-clamp-3 [overflow-wrap:anywhere]">{item.title}</span>
    </button>
    <div className="mt-2 flex h-7 items-center gap-1 overflow-hidden">
      {item.badges.map(badge => <span key={badge} title={badge} className="min-w-0 truncate rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px]">{badge}</span>)}
    </div>
    {item.children.length ? <Handle type="source" position={Position.Right} isConnectable={false} /> : null}
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

async function requestMove(move: FlowMove, version?: string) {
  const response = await fetch('/api/renoapp/admin/flow-move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...move, apply: Boolean(version), version }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Kunde inte bekräfta flytten. Ladda om flödet.')
  if (!result.version || !result.itemLabel) throw new Error('Svaret kunde inte bekräftas. Ladda om flödet.')
  return result as FlowMovePreview
}

function Canvas(props: Props) {
  const { root, expandedIds, disabled, onReload } = props
  const flow = useReactFlow<DiagramNode>()
  const storageKey = `renoapp-flow-layout:v1:${root.id}`
  const positions = useRef<PositionMap>({})
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const operationInFlight = useRef(false)
  const [choice, setChoice] = useState<FlowNode | null>(null)
  const [chosenTargetId, setChosenTargetId] = useState('')
  const [preview, setPreview] = useState<{ move: FlowMove; result: FlowMovePreview; destinationNodeId: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dragStart = useRef<{ id: string; position: { x: number; y: number }; movingIds: Set<string>; positions: PositionMap } | null>(null)
  const allOccurrences = useMemo(() => flattenFlow(root, null), [root])
  const occurrences = useMemo(() => flattenFlow(root, expandedIds), [root, expandedIds])
  const graph = useMemo(() => {
    const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    layout.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 72, marginx: 24, marginy: 24 })
    occurrences.forEach(row => layout.setNode(row.id, { width: WIDTH, height: HEIGHT }))
    occurrences.forEach(row => { if (row.parentId) layout.setEdge(row.parentId, row.id) })
    dagre.layout(layout, { disableOptimalOrderHeuristic: true })
    return {
      nodes: occurrences.map(row => ({ id: row.id, type: 'flowCard' as const, dragHandle: '.flow-drag-handle',
        position: { x: layout.node(row.id).x - WIDTH / 2, y: layout.node(row.id).y - HEIGHT / 2 },
        data: { item: row.node, expanded: row.node === root || expandedIds.includes(row.node.id) } })),
      edges: occurrences.flatMap(row => row.parentId ? [{ id: `edge:${row.id}`, source: row.parentId, target: row.id,
        type: 'smoothstep', style: { stroke: '#78716c', strokeWidth: 1.5 }, reconnectable: false, deletable: false }] : []),
    }
  }, [occurrences, root, expandedIds])

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
    if ((preview || choice) && !dialog.current?.open) dialog.current?.showModal()
  }, [preview, choice])

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
      && cursor.x >= target.position.x && cursor.x <= target.position.x + WIDTH
      && cursor.y >= target.position.y && cursor.y <= target.position.y + HEIGHT) ?? null
  }
  const prepareMove = async (source: FlowNode, destination: FlowNode) => {
    const target = flowTarget(destination)
    if (!source.source || !target || operationInFlight.current) return
    operationInFlight.current = true
    setBusy(true)
    setNotice(null)
    const move = { source: source.source, target }
    try { setPreview({ move, result: await requestMove(move), destinationNodeId: destination.id }); setChoice(null) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Kunde inte förbereda flytten.'); setChoice(null) }
    finally { setBusy(false); operationInFlight.current = false }
  }
  const applyMove = async () => {
    if (!preview || operationInFlight.current) return
    operationInFlight.current = true
    setBusy(true)
    try {
      await requestMove(preview.move, preview.result.version)
      if (preview.destinationNodeId !== root.id && !expandedIds.includes(preview.destinationNodeId)) {
        props.onToggle(preview.destinationNodeId)
      }
      setNotice('Kopplingen har flyttats.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kunde inte bekräfta flytten. Ladda om flödet.')
    } finally {
      setPreview(null)
      await onReload()
      setBusy(false)
      operationInFlight.current = false
    }
  }
  const choices = choice ? occurrences.filter(row => canDropFlowNode(choice, row.node)) : []
  const locked = disabled || busy || Boolean(preview || choice)

  return <section className="min-w-0" aria-label="Flödesdiagram">
    <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
      {notice ? <p role="status" className="mr-auto max-w-full text-sm text-stone-700">{notice}</p> : null}
      {busy ? <span role="status" className="mr-2 text-sm">Bearbetar...</span> : null}
      <button type="button" className={buttonClass} disabled={locked} aria-label="Zooma in" title="Zooma in" onClick={() => void flow.zoomIn()}><Plus size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Zooma ut" title="Zooma ut" onClick={() => void flow.zoomOut()}><Minus size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Visa hela flödet" title="Visa hela flödet" onClick={() => void flow.fitView({ padding: 0.12, maxZoom: 1 })}><Maximize size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Återställ kortens placering" title="Återställ kortens placering" onClick={() => {
        positions.current = {}
        try { localStorage.removeItem(storageKey) } catch { /* The diagram still resets in memory. */ }
        setNodes(graph.nodes)
        requestAnimationFrame(() => void flow.fitView({ padding: 0.12, maxZoom: 1 }))
      }}><RotateCcw size={17} /></button>
      <button type="button" className={buttonClass} disabled={locked} aria-label="Ladda om flödet" title="Ladda om flödet" onClick={() => void onReload()}><RefreshCw size={17} /></button>
    </div>
    <div className="h-[min(72vh,820px)] min-h-[480px] w-full overflow-hidden rounded-md border border-stone-200 bg-stone-50">
      <Actions.Provider value={{ ...props, disabled: locked, highlighted, chooseMove: node => { setNotice(null); setChosenTargetId(''); setChoice(node) } }}>
        <ReactFlow<DiagramNode> nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
          fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.15} maxZoom={1.6}
          nodesDraggable={!locked} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
          nodesFocusable={!locked} edgesFocusable={false} multiSelectionKeyCode={null} selectionKeyCode={null}
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
            const target = findDropTarget(event, node)
            setHighlighted(target && canDropFlowNode(node.data.item, target.data.item) ? target.id : null)
          }}
          onNodeDragStop={(event, node) => {
            setHighlighted(null)
            const target = findDropTarget(event, node)
            if (target) {
              restoreDrag()
              if (canDropFlowNode(node.data.item, target.data.item)) void prepareMove(node.data.item, target.data.item)
              else setNotice(node.data.item.kind === 'option' ? 'Svarsalternativ hör till sin fråga. Flytta hela frågan för att behålla svarens betydelse.' : 'Kortet kan inte flyttas till den kopplingen.')
              return
            }
            const translated = translatedBranch(node)
            const movingIds = dragStart.current?.movingIds ?? new Set([node.id])
            const stationary = flow.getNodes().filter(other => !movingIds.has(other.id))
            const overlaps = flow.getNodes().filter(item => movingIds.has(item.id)).some(item => {
              const position = translated[item.id] ?? item.position
              return stationary.some(other => position.x < other.position.x + WIDTH && position.x + WIDTH > other.position.x
                && position.y < other.position.y + HEIGHT && position.y + HEIGHT > other.position.y)
            })
            if (overlaps) { restoreDrag(); setNotice('Grenen får inte överlappa andra kort. Välj en ledig plats.'); return }
            persistPosition(node)
          }}
        />
      </Actions.Provider>
    </div>
    {preview || choice ? <dialog ref={dialog} aria-labelledby="flow-move-heading" onCancel={event => {
      event.preventDefault(); if (!busy) { setPreview(null); setChoice(null) }
    }} className="fixed inset-0 m-auto max-h-[90vh] w-[min(560px,calc(100vw-32px))] overflow-auto rounded-md border border-stone-300 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/30">
      <h2 id="flow-move-heading" className="text-lg font-semibold">Flytta koppling</h2>
      {preview ? <>
        <p className="mt-3 break-words font-semibold">{preview.result.itemLabel}</p>
        <dl className="mt-4 grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-stone-500">Från</dt><dd className="break-words">{preview.result.fromLabel}</dd>
          <dt className="text-stone-500">Till</dt><dd className="break-words">{preview.result.toLabel}</dd>
        </dl>
        <p className="mt-4 text-sm">Detta ändrar när kortet ingår i ansökningsflödet. Kortets underliggande kopplingar följer med.</p>
        {preview.result.shared ? <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">Frågor, svar och underlag är delade. Ändringen gäller i alla renoveringsflöden som använder den gamla eller nya kopplingen.</p> : null}
      </> : <>
        <p className="mt-3 break-words font-semibold">{choice!.title}</p>
        <label className="mt-4 block text-sm">Ny koppling
          <select className="mt-1 w-full rounded border border-stone-300 p-2" value={chosenTargetId} disabled={busy} onChange={event => setChosenTargetId(event.target.value)}>
            <option value="">Välj plats</option>
            {choices.map(row => <option key={row.id} value={row.id}>{row.node.kind === 'option' ? `${occurrences.find(parent => parent.id === row.parentId)?.node.title} / ` : ''}{row.node.title}</option>)}
          </select>
        </label>
        {!choices.length ? <p className="mt-3 text-sm">Inga möjliga platser visas. Expandera den gren som kortet ska flyttas till.</p> : null}
      </>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus disabled={busy} className="rounded border border-stone-300 px-4 py-2 text-sm disabled:opacity-50" onClick={() => { setPreview(null); setChoice(null) }}>Avbryt</button>
        <button type="button" disabled={busy || (!preview && !chosenTargetId)} className="rounded bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => {
          if (preview) void applyMove()
          else { const target = occurrences.find(row => row.id === chosenTargetId); if (choice && target) void prepareMove(choice, target.node) }
        }}>{busy ? 'Bearbetar...' : preview ? 'Flytta koppling' : 'Granska flytt'}</button>
      </div>
    </dialog> : null}
  </section>
}

export default function RenoAppFlowCanvas(props: Props) {
  return <ReactFlowProvider key={props.root.id}><Canvas {...props} /></ReactFlowProvider>
}
