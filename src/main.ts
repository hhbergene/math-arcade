import './style.css'
import {
  addTermBoth,
  divideAll,
  divideAllBySelectedFactor,
  showFractionCancellation,
  cancelFractionFactors,
  canCancelFractionFactors,
  canEvaluateNegativeUnitFraction,
  evaluateNegativeUnitFraction,
  finishFractionCancellations,
  type FractionCancellation,
  multiplyAllBySelectedFactor,
  moveFactorAcrossEquals,
  extendFraction,
  mergeAll,
  mergeEquationTerms,
  mergeNestedTerms,
  moveOperandToPosition,
  negate,
  multiplyAll,
  multiplyFactors,
  distributeFactor,
  swapFactors,
  swapNestedTerms,
} from './engine/actions'
import { applyAutoSuggestion, autoLevelLabel, clampAutoLevel, getAutoSuggestion } from './engine/auto'
import { createEquation, type Equation } from './model/equation'
import { cloneEquation, cloneNode, isOp, isZeroSide, op, type EquationSnapshot, type Node } from './model/node'
import { canMergeTerms } from './engine/merge'
import { renderEquationRow } from './ui/equationRow'
import { renderHistoryPanel } from './ui/historyPanel'
import { renderNode } from './ui/renderNode'
import { strings } from './strings'
import { cancellationCorridor, dropPlacement, dropRectContains, enclosingDropRect, termDropPosition, type TermDropTarget, type TermDropPosition, type DropRect } from './ui/dropGeometry'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Fant ikke app-elementet.')

app.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">Matematikk · algebra</p>
        <h1>${strings.title}</h1>
      </div>
      <div class="auto-control" aria-label="Auto-nivå">
        <span class="auto-label">${strings.auto}</span>
        <button id="auto-down" class="icon-button" type="button" aria-label="Senk auto-nivå">−</button>
        <span id="auto-level" class="auto-level"></span>
        <button id="auto-up" class="icon-button" type="button" aria-label="Øk auto-nivå">+</button>
      </div>
    </header>

    <section class="toolbar card" aria-label="Verktøylinje">
      <label class="k-input">
        <input id="k-value" type="number" step="1" value="2" aria-label="Verdi for verktøyknappene">
      </label>
      <button class="tool-button multiply-action" data-action="multiply" type="button">· 2</button>
      <button class="tool-button divide-action" data-action="divide" type="button">÷ 2</button>
      <button class="tool-button add-action" data-action="add" type="button">+ 2</button>
      <button class="tool-button subtract-action" data-action="subtract" type="button">− 2</button>
      <button class="tool-button extend-action" data-action="extend" type="button">× 2/2</button>
      <button class="tool-button" data-action="merge" type="button">${strings.merge}</button>
      <span class="toolbar-spacer"></span>
      <button class="tool-button secondary-action" data-action="undo" type="button">↶ ${strings.undo}</button>
      <button class="tool-button primary-action" data-action="new" type="button">${strings.newEquation}</button>
    </section>

    <p id="message" class="message" role="status" aria-live="polite"></p>

    <section class="workspace-grid">
      <div id="history-panel"></div>
      <section class="equation-card card" aria-label="Oppgave">
        <span id="solved-badge" class="solved-badge" hidden>Løst</span>
        <div id="equation-row" class="equation-stage"></div>
        <div id="suggestion" class="suggestion" hidden>
          <span id="suggestion-text"></span>
          <button id="suggestion-apply" class="suggestion-button" type="button">${strings.nextStep}</button>
        </div>
      </section>
    </section>
  </main>
`

const equationRow = app.querySelector<HTMLDivElement>('#equation-row')!
const historyPanel = app.querySelector<HTMLDivElement>('#history-panel')!
const message = app.querySelector<HTMLParagraphElement>('#message')!
const kInput = app.querySelector<HTMLInputElement>('#k-value')!
const autoLevelElement = app.querySelector<HTMLSpanElement>('#auto-level')!
const suggestionElement = app.querySelector<HTMLDivElement>('#suggestion')!
const suggestionText = app.querySelector<HTMLSpanElement>('#suggestion-text')!
const suggestionApply = app.querySelector<HTMLButtonElement>('#suggestion-apply')!
const solvedBadge = app.querySelector<HTMLSpanElement>('#solved-badge')!

function renderedEquationRow(): HTMLElement | null {
  return equationRow.querySelector('.equation-row')
}

let equation: Equation = createEquation()
let autoLevel = 1
let extending = false
let pendingCancellations: FractionCancellation[] = []
let suppressEquationClick = false
const previousEquations: { equation: Equation; cancellations: FractionCancellation[] }[] = []
const cancellationUndoStates = new WeakMap<Equation, Map<number, FractionCancellation[]>>()
type InteractionLocation = { termIndex: number; path: number[] }
let completedInteractionPaths: Map<string, InteractionLocation | undefined> | undefined

function interactionPathKey(side: 'left' | 'right', termIndex: number, path: number[]): string {
  return JSON.stringify([side, termIndex, path])
}

function modelPaths(): Map<string, Node> {
  const paths = new Map<string, Node>()
  for (const side of ['left', 'right'] as const) {
    const expression = side === 'left' ? equation.left : equation.right
    expression.operands.forEach((term, termIndex) => {
      const visit = (node: Node, path: number[]): void => {
        paths.set(interactionPathKey(side, termIndex, path), node)
        if (isOp(node)) node.operands.forEach((child, index) => visit(child, [...path, index]))
      }
      visit(term, [])
    })
  }
  return paths
}

function interactionLocation(side: 'left' | 'right', termIndex: number, path: number[]): InteractionLocation | undefined {
  const key = interactionPathKey(side, termIndex, path)
  return completedInteractionPaths?.has(key) ? completedInteractionPaths.get(key) : { termIndex, path }
}

function selectedLocation(side: 'left' | 'right', termIndex: number, path: number[]): InteractionLocation {
  const current = interactionLocation(side, termIndex, path)
  if (!current) throw new Error(strings.completedFactorRemoved)
  return current
}

function selectedTermIndex(side: 'left' | 'right', termIndex: number): number {
  const current = selectedLocation(side, termIndex, [])
  if (current.path.length) throw new Error(strings.incompatibleTerms)
  return current.termIndex
}

function mergeSelectedTerms(side: 'left' | 'right', first: number, second: number): boolean {
  return mergeEquationTerms(equation, side, selectedTermIndex(side, first), selectedTermIndex(side, second))
}

function swapSelectedFactors(
  side: 'left' | 'right',
  termIndex: number,
  parentPath: number[],
  first: number,
  second: number,
): boolean {
  const left = interactionLocation(side, termIndex, [...parentPath, first])
  const right = interactionLocation(side, termIndex, [...parentPath, second])
  if (!left || !right || left.termIndex !== right.termIndex ||
    JSON.stringify(left.path.slice(0, -1)) !== JSON.stringify(right.path.slice(0, -1))) return false
  return swapFactors(equation, side, left.termIndex, left.path.slice(0, -1),
    left.path[left.path.length - 1]!, right.path[right.path.length - 1]!)
}

function multiplySelectedFactors(
  side: 'left' | 'right', termIndex: number, parentPath: number[], first: number, second: number,
): void {
  const left = interactionLocation(side, termIndex, [...parentPath, first])
  const right = interactionLocation(side, termIndex, [...parentPath, second])
  if (!left || !right) {
    message.textContent = strings.completedFactorRemoved
    return
  }
  if (left.termIndex !== right.termIndex ||
    JSON.stringify(left.path.slice(0, -1)) !== JSON.stringify(right.path.slice(0, -1))) {
    throw new Error(strings.numericFactorsOnly)
  }
  multiplyFactors(equation, side, left.termIndex, left.path.slice(0, -1),
    left.path[left.path.length - 1], right.path[right.path.length - 1])
}

function mergeSelectedNestedTerms(
  side: 'left' | 'right', termIndex: number, sumPath: number[], first: number, second: number,
): boolean {
  const left = selectedLocation(side, termIndex, [...sumPath, first])
  const right = selectedLocation(side, termIndex, [...sumPath, second])
  if (left.path.length === 0 && right.path.length === 0) {
    return mergeEquationTerms(equation, side, left.termIndex, right.termIndex, false)
  }
  if (left.termIndex !== right.termIndex ||
    JSON.stringify(left.path.slice(0, -1)) !== JSON.stringify(right.path.slice(0, -1))) {
    throw new Error(strings.incompatibleTerms)
  }
  return mergeNestedTerms(equation, side, left.termIndex, left.path.slice(0, -1),
    left.path[left.path.length - 1], right.path[right.path.length - 1])
}

function swapSelectedNestedTerms(
  side: 'left' | 'right', termIndex: number, sumPath: number[], first: number, second: number,
): boolean {
  const left = selectedLocation(side, termIndex, [...sumPath, first])
  const right = selectedLocation(side, termIndex, [...sumPath, second])
  if (left.termIndex !== right.termIndex ||
    JSON.stringify(left.path.slice(0, -1)) !== JSON.stringify(right.path.slice(0, -1))) return false
  return swapNestedTerms(equation, side, left.termIndex, left.path.slice(0, -1),
    left.path[left.path.length - 1]!, right.path[right.path.length - 1]!)
}

function adjacentOperatorPair(target: HTMLElement, sourceIndex: number): [number, number] | undefined {
  if (target.dataset.leftTerm === undefined || target.dataset.rightTerm === undefined) return undefined
  const left = Number(target.dataset.leftTerm)
  const right = Number(target.dataset.rightTerm)
  return Math.abs(left - right) === 1 && (left === sourceIndex || right === sourceIndex)
    ? [left, right]
    : undefined
}

function adjacentFactorPair(target: HTMLElement, sourceIndex: number): [number, number] | undefined {
  if (target.dataset.leftFactor === undefined || target.dataset.rightFactor === undefined) return undefined
  const left = Number(target.dataset.leftFactor)
  const right = Number(target.dataset.rightFactor)
  return Math.abs(left - right) === 1 && (left === sourceIndex || right === sourceIndex)
    ? [left, right]
    : undefined
}

function termInsertionSide(x: number, y: number): 'left' | 'right' | undefined {
  if (!dragState?.termBounds || !dropRectContains(dragState.termBounds, x, y)) return undefined
  return x < dragState.equalsX! ? 'left' : 'right'
}

function clearTermDropPreview(): void {
  if (!dragState?.termBase) return
  renderTermPreview(dragState.termBase)
  dragState.termDrop = undefined
}

function renderTermPreview(snapshot: EquationSnapshot): void {
  const row = renderEquationRow(snapshot)
  equationRow.replaceChildren(row)
  if (dragState?.termBase?.[dragState.side].operands.length === 0) {
    row.querySelector(`.equation-side[data-side="${dragState.side}"] .factor-chip`)
      ?.classList.add('term-source-zero')
  }
}

function prepareTermDrag(): void {
  if (!dragState || dragState.kind !== 'term') return
  const drag = dragState
  const base = cloneEquation(equation)
  base[drag.side].operands.splice(drag.termIndex, 1)
  drag.termBase = base
  renderTermPreview(base)
  const row = renderedEquationRow()!
  drag.termBounds = row.getBoundingClientRect()
  const equalsRect = row.querySelector('.equals-token')!.getBoundingClientRect()
  drag.equalsX = (equalsRect.left + equalsRect.right) / 2
  const targets: Record<'left' | 'right', TermDropTarget[]> = { left: [], right: [] }
  for (const side of ['left', 'right'] as const) {
    if (side !== drag.side && isZeroSide(base[side])) continue
    const sourceTerm = equation[drag.side].operands[drag.termIndex]
    const moved = side === drag.side ? sourceTerm : negate(sourceTerm)
    row.querySelectorAll<HTMLElement>(`.equation-side[data-side="${side}"] .draggable-term`)
      .forEach((term) => {
        const index = Number(term.dataset.index)
        const sign = term.previousElementSibling
        const rects = [term.getBoundingClientRect()]
        if (sign?.classList.contains('equation-operator')) rects.push(sign.getBoundingClientRect())
        targets[side].push({
          index: index + (side === drag.side && index >= drag.termIndex ? 1 : 0),
          rect: enclosingDropRect(rects),
          compatible: canMergeTerms(moved, base[side].operands[index]),
        })
      })
  }
  drag.termTargets = targets
}

function updateTermDropPreview(
  side: 'left' | 'right',
  x: number,
  y: number,
): void {
  if (!dragState?.termBase || !dragState.termTargets) return
  const position = termDropPosition(dragState.termTargets[side], x, y)
  const noChange = side === dragState.side &&
    (dragState.termTargets[side].length === 0 ||
      (position.index === dragState.termIndex && position.mergeTargetIndex === undefined))
  if (noChange) {
    clearTermDropPreview()
    return
  }
  const snapshot = cloneEquation(dragState.termBase)
  if (side !== dragState.side && isZeroSide(snapshot[side])) {
    snapshot[side].operands.length = 0
  }
  const sourceTerm = equation[dragState.side].operands[dragState.termIndex]
  const moved = side === dragState.side ? cloneNode(sourceTerm) : negate(sourceTerm)
  let previewIndex = position.index
  if (position.mergeTargetIndex !== undefined) {
    previewIndex = position.mergeTargetIndex -
      (side === dragState.side && position.mergeTargetIndex > dragState.termIndex ? 1 : 0)
    const target = snapshot[side].operands[previewIndex]
    snapshot[side].operands[previewIndex] = op('add',
      position.placement === 'before' ? [moved, target] : [target, moved])
  } else {
    snapshot[side].operands.splice(position.index, 0, moved)
  }
  renderTermPreview(snapshot)
  const preview = equationRow.querySelector<HTMLElement>(
    `.equation-side[data-side="${side}"] .draggable-term[data-index="${previewIndex}"]`,
  )!
  preview.classList.add('term-insertion-preview')
  preview.setAttribute('aria-hidden', 'true')
  if (position.mergeTargetIndex === undefined) {
    preview.classList.add('term-insertion-slot')
    preview.replaceChildren()
    const operator = preview.previousElementSibling
    if (operator?.classList.contains('equation-operator')) {
      if (previewIndex === 0) operator.remove()
      else operator.textContent = '+'
    }
  } else {
    preview.classList.add('term-merge-preview')
    preview.replaceChildren(renderNode(snapshot[side].operands[previewIndex]))
  }
  dragState.termDrop = { side, ...position }
}

type ClickSelection =
  | { kind: 'term'; element: HTMLElement; side: 'left' | 'right'; termIndex: number }
  | { kind: 'sum-term'; element: HTMLElement; side: 'left' | 'right'; termIndex: number; sumPath: number[]; sumIndex: number }
  | {
      kind: 'factor'
      element: HTMLElement
      side: 'left' | 'right'
      termIndex: number
      parentPath: number[]
      factorIndex: number
    }
  | {
      kind: 'fraction-factor'
      element: HTMLElement
      side: 'left' | 'right'
      termIndex: number
      factorPath: number[]
      fractionPath: number[]
      fractionPart: 'numerator' | 'denominator'
    }
let clickSelection: ClickSelection | undefined
type FractionDropArea = { group: HTMLElement; slots: HTMLElement[]; rect: DropRect }
type FractionDropHit =
  | { kind: 'insert'; area: FractionDropArea; target: HTMLElement }
  | { kind: 'cancel'; area: FractionDropArea; target: HTMLElement; numeratorPath: number[]; denominatorPath: number[] }
let dragState: {
  kind: 'term' | 'factor' | 'fraction-factor' | 'sum-term'
  source: HTMLElement
  ghost: HTMLElement
  side: 'left' | 'right'
  termIndex: number
  index: number
  factorPath?: number[]
  sumPath?: number[]
  fractionPath?: number[]
  fractionPart?: 'numerator' | 'denominator'
  factorValue?: number
  termValue?: number
  pointerX: number
  pointerY: number
  dropTarget?: HTMLElement
  enteredDropTarget?: boolean
  blockedDropRects?: DOMRect[]
  fractionAreas?: FractionDropArea[]
  fractionHit?: FractionDropHit
  termBase?: EquationSnapshot
  termBounds?: DropRect
  equalsX?: number
  termTargets?: Record<'left' | 'right', TermDropTarget[]>
  numericMultiplyTarget?: { side: 'left' | 'right'; rect: DropRect }
  distributionTarget?: {
    sumIndex: number
    rect: DropRect
    element: HTMLElement
    terms: { rect: DropRect; numericChips: HTMLElement[] }[]
    previewPlacement?: 'before' | 'after'
  }
  blockedFractionRects?: DropRect[]
  termDrop?: TermDropPosition & { side: 'left' | 'right' }
} | undefined

function fractionAreaRect(group: HTMLElement, slots: HTMLElement[]): DropRect {
  const rects: DropRect[] = [group.getBoundingClientRect(), ...slots.map((slot) => slot.getBoundingClientRect())]
  if (group.matches('.numerator, .denominator')) {
    const numerator = group.parentElement!.querySelector<HTMLElement>(':scope > .numerator')!
    const rect = numerator.getBoundingClientRect()
    rects.push({ left: rect.left, right: rect.right, top: rect.bottom - 10, bottom: rect.bottom + 10 })
  } else if (group.matches('.division-preview')) {
    // A new denominator is below the expression, not on its existing chips.
    const rect = slots[0]!.getBoundingClientRect()
    const terms = group.querySelector<HTMLElement>('.equation-terms')!.getBoundingClientRect()
    return { left: Math.min(rect.left, terms.left), right: Math.max(rect.right, terms.right),
      top: terms.bottom + 3, bottom: rect.bottom }
  }
  return enclosingDropRect(rects)
}

function fractionDropAreas(): FractionDropArea[] {
  if (!dragState) return []
  if (dragState.fractionAreas) return dragState.fractionAreas
  const groups = new Map<HTMLElement, HTMLElement[]>()
  equationRow.querySelectorAll<HTMLElement>('.division-drop-target.eligible, .multiply-drop-target.eligible')
    .forEach((slot) => {
      const group = slot.parentElement!
      groups.set(group, [...(groups.get(group) ?? []), slot])
    })
  dragState.fractionAreas = Array.from(groups, ([group, slots]) => ({
    group, slots, rect: fractionAreaRect(group, slots),
  }))
  return dragState.fractionAreas
}

function fractionDropAt(x: number, y: number): FractionDropHit | undefined {
  const drag = dragState
  if (!drag) return undefined
  if (drag.blockedFractionRects) {
    if (drag.blockedFractionRects.some((rect) => dropRectContains(rect, x, y))) return undefined
    drag.blockedFractionRects = undefined
  }
  const areas = fractionDropAreas()
  const area = areas.filter((candidate) => dropRectContains(candidate.rect, x, y))
    .sort((left, right) => {
      const distance = (candidate: FractionDropArea): number => {
        const rect = candidate.group.getBoundingClientRect()
        return Math.abs(x - (rect.left + rect.right) / 2)
      }
      return distance(left) - distance(right)
    })[0]
  if (!area) return undefined
  const candidates = area.group.querySelectorAll<HTMLElement>('.fraction-factor')
  for (const target of candidates) {
    if (target === drag.source || target.dataset.side !== drag.side ||
      target.dataset.termIndex !== String(drag.termIndex) ||
      target.dataset.fractionPath !== JSON.stringify(drag.fractionPath) ||
      target.dataset.fractionPart === drag.fractionPart) continue
    const targetPath = JSON.parse(target.dataset.factorPath!) as number[]
    const numeratorPath = drag.fractionPart === 'numerator' ? drag.factorPath! : targetPath
    const denominatorPath = drag.fractionPart === 'denominator' ? drag.factorPath! : targetPath
    if (!canEvaluateNegativeUnitFraction(equation, drag.side, drag.termIndex, drag.fractionPath!,
      numeratorPath, denominatorPath) &&
      !canCancelFractionFactors(equation, drag.side, drag.termIndex, drag.fractionPath!,
        numeratorPath, denominatorPath)) continue
    const numerator = target.closest('.fraction')!.querySelector<HTMLElement>(':scope > .numerator')!
    const corridor = cancellationCorridor(target.getBoundingClientRect(), numerator.getBoundingClientRect().bottom)
    if (dropRectContains(corridor, x, y)) {
      return { kind: 'cancel', area, target, numeratorPath, denominatorPath }
    }
  }
  const placement = dropPlacement(area.rect, x)
  const target = area.slots.find((slot) => slot.dataset.placement === placement) ?? area.slots[0]!
  return { kind: 'insert', area, target }
}

function clearFractionPreview(resetLayout: boolean): void {
  renderedEquationRow()?.classList.remove('show-division-targets')
  equationRow.querySelectorAll<HTMLElement>('.drop-slot-visible').forEach((slot) => {
    slot.classList.remove('drop-slot-visible', 'drop-target')
    slot.replaceChildren()
  })
  equationRow.querySelectorAll('.multiplication-preview-active, .cancellation-preview').forEach((element) => {
    element.classList.remove('multiplication-preview-active', 'cancellation-preview')
  })
  dragState?.ghost.classList.remove('cancellation-preview')
  if (resetLayout) {
    equationRow.querySelectorAll<HTMLElement>('.equation-side').forEach((side) => {
      side.style.minWidth = ''
      const content = side.firstElementChild as HTMLElement
      content.style.translate = ''
    })
  }
}

function updateFractionPreview(hit?: FractionDropHit): void {
  const drag = dragState
  if (!drag) return
  if (!hit) {
    if (drag.fractionHit) {
      const previousRects = fractionDropAreas().map((area) => area.rect)
      clearFractionPreview(true)
      drag.fractionAreas = undefined
      drag.blockedFractionRects = [...previousRects, ...fractionDropAreas().map((area) => area.rect)]
    }
    drag.fractionHit = undefined
    return
  }
  if (drag.fractionHit?.kind === hit.kind && drag.fractionHit.target === hit.target) {
    if (hit.kind === 'insert') hit.target.classList.add('drop-target')
    return
  }
  clearFractionPreview(false)
  drag.fractionHit = hit
  if (hit.kind === 'cancel') {
    hit.target.classList.add('factor-drop-target')
    return
  }
  const selected = fractionDropAreas().map((area) => area === hit.area
    ? hit.target
    : area.slots.find((slot) => slot.dataset.placement === 'before') ?? area.slots[0]!)
  for (const slot of selected) {
    slot.classList.add('drop-slot-visible')
    slot.parentElement!.classList.add('multiplication-preview-active')
    if (slot === hit.target) continue
    const ghost = drag.source.cloneNode(true) as HTMLElement
    if (drag.source.classList.contains('minus-factor')) {
      ghost.replaceChildren(renderNode({ kind: 'num', value: -1 }))
    }
    ghost.classList.remove('dragging', 'pair-selected', 'cancellation-preview')
    ghost.classList.add('drop-slot-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    slot.append(ghost)
  }
  if (selected.some((slot) => slot.closest('.division-preview'))) {
    renderedEquationRow()?.classList.add('show-division-targets')
  }
  hit.target.classList.add('drop-target')
  // Reserve both alternatives so crossing the midpoint cannot move it back.
  fractionDropAreas().forEach((area) => area.slots.forEach((slot) => slot.classList.add('drop-layout-slot')))
  fitFactorDropPreview()
  equationRow.querySelectorAll('.drop-layout-slot').forEach((slot) => slot.classList.remove('drop-layout-slot'))
  fractionDropAreas().forEach((area) => {
    area.rect = enclosingDropRect([area.rect, fractionAreaRect(area.group, area.slots)])
  })
}

function updateFactorDropPreview(target?: HTMLElement, pointerX?: number, pointerY?: number): void {
  if (target && target === dragState?.dropTarget) {
    target.classList.add('drop-target')
    return
  }
  const row = renderedEquationRow()
  row?.classList.remove('show-division-targets')
  equationRow.querySelectorAll('.drop-slot-visible').forEach((slot) => {
    slot.classList.remove('drop-slot-visible')
    slot.replaceChildren()
  })
  equationRow.querySelectorAll('.multiplication-preview-active').forEach((group) => {
    group.classList.remove('multiplication-preview-active')
  })
  equationRow.querySelectorAll<HTMLElement>('.equation-side').forEach((side) => {
    side.style.minWidth = ''
    const content = side.firstElementChild as HTMLElement | null
    if (content) content.style.translate = ''
  })
  if (dragState) {
    dragState.dropTarget = target
    dragState.enteredDropTarget = false
  }
  if (!target || !dragState) return
  const selector = target.classList.contains('division-drop-target')
    ? '.division-drop-target.eligible'
    : '.multiply-drop-target.eligible'
  if (target.classList.contains('division-drop-target')) row?.classList.add('show-division-targets')
  equationRow.querySelectorAll<HTMLElement>(selector).forEach((slot) => {
    if (slot.classList.contains('multiply-drop-target')) {
      if (slot.dataset.side === target.dataset.side
        ? slot !== target
        : slot.dataset.placement !== 'before') return
      slot.classList.add('drop-slot-visible')
      slot.parentElement?.classList.add('multiplication-preview-active')
      if (slot === target) return
    } else {
      slot.classList.add('drop-slot-visible')
      if (slot === target) return
    }
    const ghost = dragState!.source.cloneNode(true) as HTMLElement
    if (dragState!.source.classList.contains('minus-factor')) {
      ghost.replaceChildren(renderNode({ kind: 'num', value: -1 }))
    }
    ghost.classList.remove('dragging', 'pair-selected')
    ghost.classList.add('drop-slot-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    slot.append(ghost)
  })
  target.classList.add('drop-target')
  fitFactorDropPreview()
  if (pointerX !== undefined && pointerY !== undefined) {
    dragState.enteredDropTarget = containsPointer(target.getBoundingClientRect(), pointerX, pointerY)
  }
}

function fitFactorDropPreview(): void {
  const sides = Array.from(equationRow.querySelectorAll<HTMLElement>('.equation-side'))
  const previewBounds = (side: HTMLElement): { left: number; right: number } => {
    const contentRect = side.firstElementChild!.getBoundingClientRect()
    const rects = [contentRect, ...Array.from(side.querySelectorAll<HTMLElement>(
      '.drop-slot-visible, .drop-layout-slot',
    )).map((slot) => slot.getBoundingClientRect())]
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
    }
  }
  sides.forEach((side) => {
    if (!side.querySelector('.drop-slot-visible, .drop-layout-slot')) return
    const bounds = previewBounds(side)
    const width = bounds.right - bounds.left + 26
    if (width > side.getBoundingClientRect().width) side.style.minWidth = `${width}px`
  })
  sides.forEach((side) => {
    if (!side.querySelector('.drop-slot-visible, .drop-layout-slot')) return
    const bounds = previewBounds(side)
    const frame = side.getBoundingClientRect()
    const shift = bounds.left < frame.left + 13
      ? frame.left + 13 - bounds.left
      : bounds.right > frame.right - 13
      ? frame.right - 13 - bounds.right
      : 0
    const content = side.firstElementChild as HTMLElement
    const previousShift = Number.parseFloat(content.style.translate) || 0
    content.style.translate = `${previousShift + shift}px 0`
  })
}

function alignRenderedEquation(previousHeights?: number[]): void {
  const row = renderedEquationRow()
  if (!row) return
  const sides = Array.from(row.querySelectorAll<HTMLElement>('.equation-side'))
  const numerators = sides.map((side) =>
    side.querySelector<HTMLElement>(':scope > .fraction-term > .fraction > .numerator'),
  )

  numerators.forEach((numerator, index) => {
    if (!numerator) return
    const side = sides[index]!
    const content = side.firstElementChild as HTMLElement | null
    if (!content) return
    const sideRect = side.getBoundingClientRect()
    const numeratorRect = numerator.getBoundingClientRect()
    const lineY = numeratorRect.bottom -
      Number.parseFloat(getComputedStyle(numerator).borderBottomWidth) / 2
    content.style.transform =
      `translateY(${sideRect.top + sideRect.height / 2 - lineY}px)`
  })

  const fractionNumeratorCenters = numerators.flatMap((numerator) => {
    if (!numerator) return []
    const rect = numerator.getBoundingClientRect()
    return [rect.top + rect.height / 2]
  })
  const fractionTarget = fractionNumeratorCenters.length
    ? fractionNumeratorCenters.reduce((sum, center) => sum + center, 0) /
      fractionNumeratorCenters.length
    : undefined

  sides.forEach((side, index) => {
    if (numerators[index]) return
    const content = side.firstElementChild as HTMLElement | null
    const anchor = side.querySelector<HTMLElement>('.equation-terms, .numerator')
    if (!content || !anchor) return
    const target = fractionTarget ?? previousHeights?.[index]
    if (target === undefined) return
    const rect = anchor.getBoundingClientRect()
    content.style.transform = `translateY(${target - (rect.top + rect.height / 2)}px)`
  })

  const centers = sides.map((side) => {
    const anchor = side.querySelector<HTMLElement>('.equation-terms, .numerator')!
    const rect = anchor.getBoundingClientRect()
    return rect.top + rect.height / 2
  })
  const equals = row.querySelector<HTMLElement>('.equals-token')!
  equals.style.transform = ''
  const rect = equals.getBoundingClientRect()
  equals.style.transform = `translateY(${(centers[0]! + centers[1]!) / 2 - (rect.top + rect.height / 2)}px)`
}

new ResizeObserver(() => alignRenderedEquation()).observe(equationRow)

function containsPointer(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function factorDropTargetAt(x: number, y: number, preview = false): HTMLElement | undefined {
  const slots = Array.from(equationRow.querySelectorAll<HTMLElement>(
    '.division-drop-target.eligible, .multiply-drop-target.eligible',
  ))
  const distance = (target: HTMLElement): number => {
    const rect = target.getBoundingClientRect()
    return Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2))
  }
  const active = dragState?.dropTarget
  if (dragState?.blockedDropRects) {
    if (dragState.blockedDropRects.some((rect) => containsPointer(rect, x, y))) return undefined
    dragState.blockedDropRects = undefined
  }
  if (preview && active && dragState) {
    const nearest = slots.reduce((best, slot) => distance(slot) < distance(best) ? slot : best, active)
    if (nearest !== active && distance(nearest) + 6 < distance(active)) return nearest
    if (containsPointer(active.getBoundingClientRect(), x, y)) {
      dragState.enteredDropTarget = true
      return active
    }
    if (!dragState.enteredDropTarget) return active

    const exitedRect = active.getBoundingClientRect()
    updateFactorDropPreview()
    // Suppress re-entry caused solely by restoring the unshifted layout.
    dragState.blockedDropRects = [exitedRect, ...slots.map((slot) => slot.getBoundingClientRect())]
    return undefined
  }
  const slot = slots.filter((target) => containsPointer(target.getBoundingClientRect(), x, y))
    .sort((left, right) => distance(left) - distance(right))[0]
  if (slot) return slot
  return undefined
}

function currentK(): number {
  const value = Number(kInput.value)
  if (!kInput.value.trim() || !Number.isInteger(value)) throw new Error(strings.invalidK)
  return value
}

function updateToolLabels(): void {
  const enteredValue = kInput.value.trim()
  const displayValue = enteredValue && enteredValue.length <= 2 ? enteredValue : 'k'
  app?.querySelector('[data-action="multiply"]')?.replaceChildren('· ', displayValue)
  app?.querySelector('[data-action="divide"]')?.replaceChildren('÷ ', displayValue)
  app?.querySelector('[data-action="add"]')?.replaceChildren('+ ', displayValue)
  app?.querySelector('[data-action="subtract"]')?.replaceChildren('− ', displayValue)
  app?.querySelector('[data-action="extend"]')?.replaceChildren('× ', displayValue, '/', displayValue)
}

kInput.addEventListener('input', updateToolLabels)

function isSolved(): boolean {
  return /^(x = -?\d+|-?\d+ = x)$/.test(equation.prettyPrint())
}

function render(): void {
  const previousHeights = Array.from(equationRow.querySelectorAll<HTMLElement>(
    '.equation-side .equation-terms, .equation-side > .fraction-term > .fraction > .numerator',
  )).map((anchor) => {
    const rect = anchor.getBoundingClientRect()
    return rect.top + rect.height / 2
  })
  equationRow.replaceChildren(renderEquationRow(equation, pendingCancellations))
  alignRenderedEquation(previousHeights)
  historyPanel.replaceChildren(renderHistoryPanel(equation.history))
  const historyList = historyPanel.querySelector<HTMLOListElement>('.history-list')
  if (historyList) historyList.scrollTop = historyList.scrollHeight
  autoLevelElement.textContent = autoLevelLabel(autoLevel)
  app?.querySelector<HTMLButtonElement>('[data-action="undo"]')?.toggleAttribute(
    'disabled',
    !equation.history.canUndo() && previousEquations.length === 0,
  )

  const suggestion = getAutoSuggestion(equation, autoLevel)
  suggestionElement.hidden = !suggestion
  suggestionApply.disabled = !suggestion
  suggestionText.textContent = suggestion?.label ?? ''
  solvedBadge.hidden = !isSolved()
}

function clearClickSelection(): void {
  clickSelection?.element.classList.remove('pair-selected')
  clickSelection = undefined
}

function rememberCancellationState(): void {
  const states = cancellationUndoStates.get(equation) ?? new Map<number, FractionCancellation[]>()
  states.set(equation.history.entries.length, [...pendingCancellations])
  cancellationUndoStates.set(equation, states)
}

function finishFractionCancellation(side?: 'left' | 'right'): void {
  if (!pendingCancellations.some((cancellation) => !side || cancellation.side === side)) return
  clearClickSelection()
  rememberCancellationState()
  pendingCancellations = finishFractionCancellations(equation, pendingCancellations, side)
  message.textContent = pendingCancellations.length ? strings.cancellationPending : ''
  message.classList.remove('message-error')
}

function markFractionCancellation(
  side: 'left' | 'right',
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): void {
  if (canEvaluateNegativeUnitFraction(equation, side, termIndex,
    fractionPath, numeratorPath, denominatorPath)) {
    evaluateNegativeUnitFraction(equation, side, termIndex,
      fractionPath, numeratorPath, denominatorPath)
    return
  }
  pendingCancellations.push(showFractionCancellation(equation, side, termIndex,
    fractionPath, numeratorPath, denominatorPath))
  message.textContent = strings.cancellationPending
}

function clickSelectionFor(element: HTMLElement): ClickSelection | undefined {
  const fractionFactor = element.closest<HTMLElement>('.fraction-factor')
  if (
    fractionFactor?.dataset.side &&
    fractionFactor.dataset.termIndex !== undefined &&
    fractionFactor.dataset.factorPath !== undefined &&
    fractionFactor.dataset.fractionPath !== undefined &&
    (fractionFactor.dataset.fractionPart === 'numerator' ||
      fractionFactor.dataset.fractionPart === 'denominator')
  ) {
    return {
      kind: 'fraction-factor',
      element: fractionFactor,
      side: fractionFactor.dataset.side as 'left' | 'right',
      termIndex: Number(fractionFactor.dataset.termIndex),
      factorPath: JSON.parse(fractionFactor.dataset.factorPath) as number[],
      fractionPath: JSON.parse(fractionFactor.dataset.fractionPath) as number[],
      fractionPart: fractionFactor.dataset.fractionPart,
    }
  }

  const factor = element.closest<HTMLElement>('.factor-tile')
  if (
    factor?.dataset.side &&
    factor.dataset.termIndex !== undefined &&
    factor.dataset.factorIndex !== undefined &&
    factor.dataset.parentPath !== undefined
  ) {
    const parentPath = JSON.parse(factor.dataset.parentPath) as number[]
    const factorIndex = Number(factor.dataset.factorIndex)
    return {
      kind: 'factor',
      element: factor,
      side: factor.dataset.side as 'left' | 'right',
      termIndex: Number(factor.dataset.termIndex),
      parentPath,
      factorIndex,
    }
  }

  const term = element.closest<HTMLElement>('.draggable-term')
  const sumTerm = element.closest<HTMLElement>('.sum-term')
  if (sumTerm?.dataset.side && sumTerm.dataset.termIndex !== undefined &&
    sumTerm.dataset.sumPath !== undefined && sumTerm.dataset.sumIndex !== undefined) {
    return {
      kind: 'sum-term', element: sumTerm, side: sumTerm.dataset.side as 'left' | 'right',
      termIndex: Number(sumTerm.dataset.termIndex),
      sumPath: JSON.parse(sumTerm.dataset.sumPath) as number[],
      sumIndex: Number(sumTerm.dataset.sumIndex),
    }
  }
  if (term?.dataset.side && term.dataset.index !== undefined) {
    return {
      kind: 'term',
      element: term,
      side: term.dataset.side as 'left' | 'right',
      termIndex: Number(term.dataset.index),
    }
  }
  return undefined
}

function actionForClickPair(first: ClickSelection, second: ClickSelection): (() => void) | undefined {
  if (first.kind === 'sum-term' && second.kind === 'sum-term') {
    if (first.side !== second.side || first.termIndex !== second.termIndex ||
      JSON.stringify(first.sumPath) !== JSON.stringify(second.sumPath)) return undefined
    return () => {
      if (!mergeSelectedNestedTerms(first.side, first.termIndex, first.sumPath,
        first.sumIndex, second.sumIndex)) throw new Error(strings.incompatibleTerms)
    }
  }
  if (first.kind === 'fraction-factor' && second.kind === 'fraction-factor') {
    if (
      first.side !== second.side ||
      first.termIndex !== second.termIndex ||
      JSON.stringify(first.fractionPath) !== JSON.stringify(second.fractionPath)
    ) return undefined

    if (first.fractionPart !== second.fractionPart) {
      const numeratorPath = first.fractionPart === 'numerator' ? first.factorPath : second.factorPath
      const denominatorPath = first.fractionPart === 'denominator' ? first.factorPath : second.factorPath
      return () => {
        markFractionCancellation(
          first.side,
          first.termIndex,
          first.fractionPath,
          numeratorPath,
          denominatorPath,
        )
      }
    }

    const firstParent = first.factorPath.slice(0, -1)
    if (JSON.stringify(firstParent) !== JSON.stringify(second.factorPath.slice(0, -1))) {
      return undefined
    }
    return () => multiplySelectedFactors(
      first.side,
      first.termIndex,
      firstParent,
      first.factorPath[first.factorPath.length - 1],
      second.factorPath[second.factorPath.length - 1],
    )
  }

  if (first.kind === 'factor' && second.kind === 'factor') {
    if (
      first.side !== second.side ||
      first.termIndex !== second.termIndex ||
      JSON.stringify(first.parentPath) !== JSON.stringify(second.parentPath)
    ) return undefined
    return () => multiplySelectedFactors(
      first.side,
      first.termIndex,
      first.parentPath,
      first.factorIndex,
      second.factorIndex,
    )
  }

  if (first.kind === 'term' && second.kind === 'term') {
    if (first.side !== second.side || first.termIndex === second.termIndex) return undefined
    return () => {
      if (!mergeSelectedTerms(first.side, first.termIndex, second.termIndex)) {
        throw new Error(strings.incompatibleTerms)
      }
    }
  }
  return undefined
}

function selectClickPair(element: HTMLElement): void {
  const next = clickSelectionFor(element)
  if (!next) return
  if (!clickSelection) {
    clickSelection = next
    next.element.classList.add('pair-selected')
    message.textContent = 'Velg en brikke til i samme brøk, produkt eller sum.'
    message.classList.remove('message-error')
    return
  }

  const previous = clickSelection
  clearClickSelection()
  if (previous.element === next.element) {
    message.textContent = ''
    return
  }
  const action = actionForClickPair(previous, next)
  if (!action) {
    clickSelection = next
    next.element.classList.add('pair-selected')
    message.textContent = 'Brikkene må høre til samme brøk, produkt eller sum.'
    message.classList.remove('message-error')
    return
  }
  const markingCancellation = previous.kind === 'fraction-factor' && next.kind === 'fraction-factor' &&
    previous.fractionPart !== next.fractionPart
  perform(action, markingCancellation)
}

function perform(action: () => void, markingCancellation = false): void {
  clearClickSelection()
  message.textContent = ''
  message.classList.remove('message-error')
  try {
    if (!markingCancellation && pendingCancellations.length) {
      const before = modelPaths()
      finishFractionCancellation()
      const after = modelPaths()
      const newPaths = new Map<Node, InteractionLocation>()
      for (const [key, node] of after) {
        const [, termIndex, path] = JSON.parse(key) as ['left' | 'right', number, number[]]
        newPaths.set(node, { termIndex, path })
      }
      completedInteractionPaths = new Map(Array.from(before, ([key, node]) => [key, newPaths.get(node)]))
    }
    rememberCancellationState()
    action()
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Handlingen kunne ikke utføres.'
    message.classList.add('message-error')
  } finally {
    completedInteractionPaths = undefined
  }
  render()
}

app.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const button = target.closest<HTMLButtonElement>('[data-action]')
  const action = button?.dataset.action
  if (!action) return
  if (extending && action !== 'extend') return

  if (action === 'multiply') perform(() => multiplyAll(equation, currentK()))
  if (action === 'divide') perform(() => divideAll(equation, currentK()))
  if (action === 'add') perform(() => addTermBoth(equation, currentK()))
  if (action === 'subtract') perform(() => addTermBoth(equation, -currentK()))
  if (action === 'extend') {
    try {
      const value = currentK()
      if (value <= 0) throw new Error('Utvidelsesfaktoren må være større enn 0.')
      extending = !extending
      button.classList.toggle('active', extending)
      message.textContent = extending ? `Velg en brøk for å utvide med ${value}/${value}.` : ''
      message.classList.remove('message-error')
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : strings.invalidK
      message.classList.add('message-error')
    }
  }
  if (action === 'merge') {
    perform(() => {
      if (mergeAll(equation) === 0) message.textContent = 'Ingen like ledd å slå sammen.'
    })
  }
  if (action === 'undo') {
    clearClickSelection()
    if (equation.history.canUndo()) {
      const previous = equation.history.undo()
      if (previous) {
        equation.left = previous.left
        equation.right = previous.right
        pendingCancellations = [...(cancellationUndoStates.get(equation)?.get(equation.history.entries.length) ?? [])]
      }
    } else if (previousEquations.length > 0) {
      const previous = previousEquations.pop()!
      equation = previous.equation
      pendingCancellations = previous.cancellations
    }
    message.textContent = pendingCancellations.length ? strings.cancellationPending : ''
    render()
  }
  if (action === 'new') {
    previousEquations.push({ equation, cancellations: [...pendingCancellations] })
    equation = createEquation()
    extending = false
    pendingCancellations = []
    clearClickSelection()
    message.textContent = ''
    app.querySelector('[data-action="extend"]')?.classList.remove('active')
    render()
  }
})

app.querySelector('#auto-down')?.addEventListener('click', () => {
  autoLevel = clampAutoLevel(autoLevel - 1)
  render()
})
app.querySelector('#auto-up')?.addEventListener('click', () => {
  autoLevel = clampAutoLevel(autoLevel + 1)
  render()
})
suggestionApply.addEventListener('click', () => {
  if (pendingCancellations.length) {
    finishFractionCancellation()
    render()
  }
  const suggestion = getAutoSuggestion(equation, autoLevel)
  if (suggestion) perform(() => applyAutoSuggestion(equation, suggestion))
})

equationRow.addEventListener('click', (event) => {
  if (suppressEquationClick) {
    suppressEquationClick = false
    return
  }
  const target = event.target
  if (!(target instanceof Element)) return
  const annotation = target.closest<HTMLElement>('.fraction-cancellation')
  if (pendingCancellations.length && (annotation || target.closest('.equals-token'))) {
    if (!dragState) {
      const factor = annotation?.closest<HTMLElement>('.fraction-factor')
      const next = factor ? clickSelectionFor(factor) : undefined
      if (factor && clickSelection?.kind === 'fraction-factor' && next?.kind === 'fraction-factor' &&
        clickSelection.side === next.side && clickSelection.termIndex === next.termIndex &&
        JSON.stringify(clickSelection.fractionPath) === JSON.stringify(next.fractionPath) &&
        clickSelection.fractionPart !== next.fractionPart) {
        selectClickPair(factor)
        return
      }
      const side = annotation?.dataset.side
      finishFractionCancellation(side === 'left' || side === 'right' ? side : undefined)
      render()
    }
    return
  }
  if (extending) {
    if (!target.closest('.fraction')) return
    const term = target.closest<HTMLElement>('.draggable-term')
    if (!term?.dataset.side || term.dataset.index === undefined) return
    perform(() => {
      const side = term.dataset.side as 'left' | 'right'
      extendFraction(equation, side, selectedTermIndex(side, Number(term.dataset.index)), currentK())
    })
    extending = false
    app.querySelector('[data-action="extend"]')?.classList.remove('active')
    return
  }

  const sumOperator = target.closest<HTMLElement>('.nested-sum-operator')
  if (sumOperator?.dataset.side && sumOperator.dataset.termIndex !== undefined &&
    sumOperator.dataset.sumPath !== undefined && sumOperator.dataset.leftTerm !== undefined &&
    sumOperator.dataset.rightTerm !== undefined) {
    perform(() => {
      if (!mergeSelectedNestedTerms(sumOperator.dataset.side as 'left' | 'right',
        Number(sumOperator.dataset.termIndex), JSON.parse(sumOperator.dataset.sumPath!) as number[],
        Number(sumOperator.dataset.leftTerm), Number(sumOperator.dataset.rightTerm))) {
        throw new Error(strings.incompatibleTerms)
      }
    })
    return
  }
  const termOperator = target.closest<HTMLElement>('.operator-tile')
  if (termOperator?.dataset.side && termOperator.dataset.leftTerm && termOperator.dataset.rightTerm) {
    perform(() => {
      if (!mergeSelectedTerms(
        termOperator.dataset.side as 'left' | 'right',
        Number(termOperator.dataset.leftTerm),
        Number(termOperator.dataset.rightTerm),
      )) {
        throw new Error(strings.incompatibleTerms)
      }
    })
    return
  }

  const factorOperator = target.closest<HTMLElement>('.factor-operator')
  if (
    factorOperator?.dataset.side &&
    factorOperator.dataset.termIndex !== undefined &&
    factorOperator.dataset.parentPath &&
    factorOperator.dataset.leftFactor !== undefined &&
    factorOperator.dataset.rightFactor !== undefined
  ) {
    perform(() => multiplySelectedFactors(
      factorOperator.dataset.side as 'left' | 'right',
      Number(factorOperator.dataset.termIndex),
      JSON.parse(factorOperator.dataset.parentPath!) as number[],
      Number(factorOperator.dataset.leftFactor),
      Number(factorOperator.dataset.rightFactor),
    ))
  }
})

document.addEventListener('pointerdown', (event) => {
  suppressEquationClick = false
  if (extending || !(event.target instanceof Element)) return
  const target = event.target
  if (!equationRow.contains(target)) return
  if (target.closest('.operator-tile, .inline-operator, .fraction-cancellation-result')) return

  const fractionFactor = target.closest<HTMLElement>('.fraction-factor')
  const factor = target.closest<HTMLElement>('.factor-tile')
  const sumTerm = target.closest<HTMLElement>('.sum-term')
  const term = target.closest<HTMLElement>('.draggable-term')
  const source = fractionFactor ?? factor ?? sumTerm ?? term
  if (!source?.dataset.side) return

  let kind: 'term' | 'factor' | 'fraction-factor' | 'sum-term'
  let termIndex: number
  let index: number
  let factorPath: number[] | undefined
  let sumPath: number[] | undefined
  let fractionPath: number[] | undefined
  let fractionPart: 'numerator' | 'denominator' | undefined
  if (fractionFactor) {
    if (
      source.dataset.termIndex === undefined ||
      source.dataset.factorPath === undefined ||
      source.dataset.fractionPath === undefined ||
      (source.dataset.fractionPart !== 'numerator' && source.dataset.fractionPart !== 'denominator')
    ) return
    kind = 'fraction-factor'
    termIndex = Number(source.dataset.termIndex)
    factorPath = JSON.parse(source.dataset.factorPath) as number[]
    fractionPath = JSON.parse(source.dataset.fractionPath) as number[]
    fractionPart = source.dataset.fractionPart
    index = factorPath[factorPath.length - 1] ?? 0
  } else if (factor) {
    if (
      source.dataset.termIndex === undefined ||
      source.dataset.factorIndex === undefined ||
      source.dataset.parentPath === undefined
    ) return
    kind = 'factor'
    termIndex = Number(source.dataset.termIndex)
    index = Number(source.dataset.factorIndex)
    const parentPath = JSON.parse(source.dataset.parentPath) as number[]
    factorPath = [...parentPath, index]
  } else if (sumTerm) {
    if (source.dataset.termIndex === undefined || source.dataset.sumPath === undefined ||
      source.dataset.sumIndex === undefined) return
    kind = 'sum-term'
    termIndex = Number(source.dataset.termIndex)
    index = Number(source.dataset.sumIndex)
    sumPath = JSON.parse(source.dataset.sumPath) as number[]
  } else {
    if (source.dataset.index === undefined) return
    kind = 'term'
    termIndex = Number(source.dataset.index)
    index = termIndex
  }

  event.preventDefault()
  const rect = source.getBoundingClientRect()
  const ghost = source.cloneNode(true) as HTMLElement
  ghost.classList.add('drag-ghost')
  if (source.classList.contains('minus-factor')) {
    ghost.classList.remove('minus-factor')
    ghost.replaceChildren(renderNode({ kind: 'num', value: -1 }))
  }
  const termValue = kind === 'term' && source.dataset.termValue !== undefined
    ? Number(source.dataset.termValue)
    : undefined
  if (termValue !== undefined) {
    ghost.classList.remove('draggable-term')
    ghost.classList.add('factor-chip')
    ghost.replaceChildren()
    ghost.setAttribute('aria-hidden', 'true')
    ghost.textContent = String(termValue).replace('-', '−')
  }
  ghost.style.left = `${rect.left}px`
  ghost.style.top = `${rect.top}px`
  ghost.style.width = `${rect.width}px`
  document.body.append(ghost)
  let dropWidth = rect.width
  let dropHeight = rect.height
  if (source.classList.contains('minus-factor')) {
    ghost.style.width = 'max-content'
    const ghostRect = ghost.getBoundingClientRect()
    const productRect = source.closest('.product-node')?.getBoundingClientRect() ?? rect
    dropWidth = Math.max(productRect.width, ghostRect.width)
    dropHeight = Math.max(productRect.height, ghostRect.height)
  }
  source.classList.add('dragging')
  if (kind === 'factor' || kind === 'fraction-factor') {
    const row = renderedEquationRow()
    if (kind === 'factor') {
      row?.querySelectorAll(
        '.division-preview > .division-drop-target, .division-drop-target[data-whole-side="true"][data-placement="after"]',
      ).forEach((target) => {
        target.classList.add('eligible')
      })
    }
    row?.style.setProperty('--drop-factor-width', `${dropWidth}px`)
    row?.style.setProperty('--drop-factor-height', `${dropHeight}px`)
    if (kind === 'fraction-factor') {
      const sourceSide = source.dataset.side
      const selector = fractionPart === 'denominator' ? '.multiply-drop-target' : '.division-drop-target'
      row?.querySelectorAll<HTMLElement>(selector).forEach((target) => {
        const inSameFraction =
          target.dataset.side === sourceSide &&
          target.dataset.termIndex === String(termIndex) &&
          target.dataset.fractionPath === JSON.stringify(fractionPath)
        const onOtherSide = target.dataset.side !== sourceSide &&
          (target.dataset.wholeSide === 'true' || target.parentElement?.classList.contains('division-preview'))
        if (inSameFraction || onOtherSide) target.classList.add('eligible')
      })
    }
  }
  dragState = {
    kind,
    source,
    ghost,
    side: source.dataset.side as 'left' | 'right',
    termIndex,
    index,
    factorPath,
    sumPath,
    fractionPath,
    fractionPart,
    factorValue: source.dataset.value === undefined ? undefined : Number(source.dataset.value),
    termValue,
    pointerX: event.clientX,
    pointerY: event.clientY,
  }
  if (kind === 'term') {
    ghost.classList.add('term-drag-ghost')
    ghost.replaceChildren(renderNode(op('add', [equation[dragState.side].operands[termIndex]])))
    prepareTermDrag()
  }
  if (kind === 'fraction-factor' && fractionPart === 'denominator') {
    const oppositeSide = dragState.side === 'left' ? 'right' : 'left'
    const opposite = equation[oppositeSide]
    if (opposite.operands.length === 1 && opposite.operands[0].kind === 'num') {
      const target = equationRow.querySelector<HTMLElement>(
        `.equation-side[data-side="${oppositeSide}"] .draggable-term`,
      )
      if (target) dragState.numericMultiplyTarget = { side: oppositeSide, rect: target.getBoundingClientRect() }
    }
  }
  if (kind === 'factor' || kind === 'fraction-factor') {
    const parentPath = factorPath!.slice(0, -1)
    const product = source.closest('.product-node')
    const sums = equationRow.querySelectorAll<HTMLElement>('.nested-addition[data-sum-path]')
    for (const sum of sums) {
      const path = JSON.parse(sum.dataset.sumPath!) as number[]
      if (product && sum.closest('.product-node') === product &&
        sum.dataset.side === dragState.side && sum.dataset.termIndex === String(termIndex) &&
        JSON.stringify(path.slice(0, -1)) === JSON.stringify(parentPath)) {
        dragState.distributionTarget = {
          sumIndex: path[path.length - 1],
          rect: sum.getBoundingClientRect(),
          element: sum,
          terms: Array.from(sum.querySelectorAll<HTMLElement>(':scope > .nested-term'), (term) => ({
            rect: term.getBoundingClientRect(),
            numericChips: Array.from(term.querySelectorAll<HTMLElement>('.factor-chip'))
              .filter((chip) => chip.closest('.fraction') === sum.closest('.fraction') &&
                (/^\d+$/.test(chip.textContent ?? '') || chip.dataset.value === '-1')),
          })),
        }
        break
      }
    }
  }
}, true)

document.addEventListener('pointermove', (event) => {
  if (!dragState) return
  dragState.ghost.style.transform = `translate(${event.clientX - dragState.pointerX}px, ${event.clientY - dragState.pointerY}px)`
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
  equationRow.querySelectorAll('.drop-target, .factor-drop-target').forEach((target) => {
    target.classList.remove('drop-target', 'factor-drop-target')
  })
  equationRow.querySelectorAll('.swap-drop-target').forEach((target) => {
    target.classList.remove('swap-drop-target')
  })
  equationRow.querySelectorAll('.division-drop-target.drop-target').forEach((target) => {
    target.classList.remove('drop-target')
  })
  if (dragState.kind === 'term') {
    const side = event.clientX < dragState.equalsX! ? 'left' : 'right'
    const sourceTerm = equation[dragState.side].operands[dragState.termIndex]
    dragState.ghost.replaceChildren(renderNode(op('add',
      [side === dragState.side ? sourceTerm : negate(sourceTerm)])))
  }
  if (dragState.kind === 'sum-term') {
    const target = elementUnderPointer?.closest<HTMLElement>('.sum-term')
    if (target && target !== dragState.source && target.dataset.side === dragState.side &&
      target.dataset.termIndex === String(dragState.termIndex) &&
      target.dataset.sumPath === JSON.stringify(dragState.sumPath)) {
      target.classList.add('factor-drop-target')
    }
    const operator = elementUnderPointer?.closest<HTMLElement>('.nested-sum-operator')
    if (operator && operator.dataset.side === dragState.side &&
      operator.dataset.termIndex === String(dragState.termIndex) &&
      operator.dataset.sumPath === JSON.stringify(dragState.sumPath) &&
      adjacentOperatorPair(operator, dragState.index)) {
      operator.classList.add('swap-drop-target')
    }
    return
  }
  const distribution = dragState.distributionTarget
  if (distribution && (dropRectContains(distribution.rect, event.clientX, event.clientY) ||
    distribution.element.contains(elementUnderPointer))) {
    if (dragState.kind === 'fraction-factor') {
      clearFractionPreview(false)
      dragState.fractionHit = undefined
    } else updateFactorDropPreview()
    const hoveredTerm = distribution.terms.find((term) => dropRectContains(term.rect, event.clientX, event.clientY))
    const placement = elementUnderPointer?.closest('.distribution-slot') && distribution.previewPlacement
      ? distribution.previewPlacement
      : hoveredTerm ? dropPlacement(hoveredTerm.rect, event.clientX)
        : dropPlacement(distribution.rect, event.clientX)
    if (distribution.previewPlacement === placement) return
    distribution.previewPlacement = placement
    equationRow.querySelectorAll('.distribution-slot').forEach((slot) => slot.remove())
    distribution.element.querySelectorAll<HTMLElement>(':scope > .nested-term').forEach((term) => {
      const slot = document.createElement('span')
      slot.className = 'term-insertion-slot distribution-slot'
      slot.setAttribute('aria-hidden', 'true')
      if (placement === 'before') term.prepend(slot)
      else term.append(slot)
    })
    return
  }
  equationRow.querySelectorAll('.distribution-slot').forEach((slot) => slot.remove())
  if (distribution) distribution.previewPlacement = undefined
  if (dragState.kind === 'fraction-factor') {
    const operator = elementUnderPointer?.closest<HTMLElement>('.multiply-token')
    if (operator && operator.dataset.side === dragState.side &&
      operator.dataset.termIndex === String(dragState.termIndex) &&
      operator.dataset.parentPath === JSON.stringify(dragState.factorPath?.slice(0, -1)) &&
      adjacentFactorPair(operator, dragState.index)) {
      operator.classList.add('swap-drop-target')
    }
    updateFractionPreview(fractionDropAt(event.clientX, event.clientY))
    return
  }
  if (dragState.kind === 'term') {
    const side = termInsertionSide(event.clientX, event.clientY)
    if (side) updateTermDropPreview(side, event.clientX, event.clientY)
    else clearTermDropPreview()
    return
  }
  const slot = factorDropTargetAt(event.clientX, event.clientY, true)
  updateFactorDropPreview(slot, event.clientX, event.clientY)

  if (dragState.kind === 'factor') {
    const denominatorTarget = slot?.classList.contains('division-drop-target') ? slot : undefined
    if (denominatorTarget) {
      denominatorTarget.classList.add('drop-target')
      return
    }

    const operator = elementUnderPointer?.closest<HTMLElement>('.multiply-token')
    if (operator && operator.dataset.side === dragState.side &&
      operator.dataset.termIndex === String(dragState.termIndex) &&
      operator.dataset.parentPath === JSON.stringify(dragState.factorPath?.slice(0, -1)) &&
      adjacentFactorPair(operator, dragState.index)) {
      operator.classList.add('swap-drop-target')
    }
    const swapTarget = elementUnderPointer?.closest<HTMLElement>('.factor-swap-target')
    if (swapTarget?.dataset.side === dragState.side &&
      swapTarget.dataset.termIndex === String(dragState.termIndex) &&
      swapTarget.dataset.parentPath === JSON.stringify(dragState.factorPath?.slice(0, -1)) &&
      swapTarget.dataset.factorIndex !== undefined &&
      Math.abs(Number(swapTarget.dataset.factorIndex) - dragState.index) === 1) {
      swapTarget.classList.add('swap-drop-target')
    }
    const target = elementUnderPointer?.closest<HTMLElement>('.factor-tile')
    if (
      target &&
      target !== dragState.source &&
      target.dataset.side === dragState.side &&
      target.dataset.termIndex === String(dragState.termIndex) &&
      target.dataset.parentPath === JSON.stringify(dragState.factorPath?.slice(0, -1))
    ) {
      target.classList.add('factor-drop-target')
    }
    return
  }

})

function finishDrag(event: PointerEvent): void {
  if (!dragState) return
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
  const isClick = Math.hypot(
    event.clientX - dragState.pointerX,
    event.clientY - dragState.pointerY,
  ) < 6
  const currentDrag = dragState
  const distribution = currentDrag.distributionTarget &&
    (dropRectContains(currentDrag.distributionTarget.rect, event.clientX, event.clientY) ||
      currentDrag.distributionTarget.element.contains(elementUnderPointer))
    ? currentDrag.distributionTarget : undefined
  const evaluateDistributedProducts = distribution?.terms.some((term) =>
    term.numericChips.some((chip) => chip.contains(elementUnderPointer))) ?? false
  const distributionPlacement = elementUnderPointer?.closest('.distribution-slot') && distribution?.previewPlacement
    ? distribution.previewPlacement
    : distribution ? dropPlacement(distribution.terms.find((term) =>
      dropRectContains(term.rect, event.clientX, event.clientY))?.rect ?? distribution.rect, event.clientX)
      : 'before'
  equationRow.querySelectorAll('.distribution-slot').forEach((slot) => slot.remove())
  if (currentDrag.kind === 'term') {
    const side = termInsertionSide(event.clientX, event.clientY)
    if (side) updateTermDropPreview(side, event.clientX, event.clientY)
    else clearTermDropPreview()
  }
  const termDrop = currentDrag.kind === 'term' ? currentDrag.termDrop : undefined
  const fractionHit = currentDrag.kind === 'fraction-factor' ? fractionDropAt(event.clientX, event.clientY) : undefined
  const dropTarget = currentDrag.kind === 'fraction-factor' ? undefined : factorDropTargetAt(event.clientX, event.clientY)
  clearTermDropPreview()
  if (currentDrag.kind === 'fraction-factor') clearFractionPreview(true)
  else updateFactorDropPreview()
  dragState = undefined
  currentDrag.ghost.remove()
  currentDrag.source.classList.remove('dragging')
  const finishedRow = renderedEquationRow()
  finishedRow?.classList.remove('show-division-targets')
  equationRow.querySelectorAll('.eligible').forEach((target) => {
    target.classList.remove('eligible')
  })
  equationRow.querySelectorAll('.drop-target, .factor-drop-target').forEach((target) => {
    target.classList.remove('drop-target', 'factor-drop-target')
  })
  equationRow.querySelectorAll('.swap-drop-target').forEach((target) => {
    target.classList.remove('swap-drop-target')
  })
  equationRow.querySelectorAll('.division-drop-target.drop-target').forEach((target) => {
    target.classList.remove('drop-target')
  })

  if (currentDrag.kind === 'term') equationRow.replaceChildren(renderEquationRow(equation, pendingCancellations))
  if (event.type === 'pointercancel') return

  if (isClick) {
    // Annotation clicks are handled once by the click listener.
    if (elementUnderPointer?.closest('.fraction-cancellation')) {
      return
    }
    const source = currentDrag.kind === 'term'
      ? equationRow.querySelector<HTMLElement>(
        `.equation-side[data-side="${currentDrag.side}"] .draggable-term[data-index="${currentDrag.termIndex}"]`,
      )
      : currentDrag.source
    if (source) selectClickPair(source)
    return
  }
  suppressEquationClick = true
  clearClickSelection()

  if (currentDrag.kind === 'term') {
    if (termDrop) perform(() => {
      moveOperandToPosition(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        termDrop.side,
        termDrop.index,
        termDrop.mergeTargetIndex,
      )
    })
    return
  }

  if (currentDrag.kind === 'sum-term') {
    const operator = elementUnderPointer?.closest<HTMLElement>('.nested-sum-operator')
    const pair = operator && operator.dataset.side === currentDrag.side &&
      operator.dataset.termIndex === String(currentDrag.termIndex) &&
      operator.dataset.sumPath === JSON.stringify(currentDrag.sumPath)
      ? adjacentOperatorPair(operator, currentDrag.index)
      : undefined
    if (operator && pair) {
      perform(() => {
        if (!swapSelectedNestedTerms(currentDrag.side, currentDrag.termIndex, currentDrag.sumPath!,
          pair[0], pair[1])) throw new Error(strings.swapAdjacentOnly)
      })
      return
    }
    const target = elementUnderPointer?.closest<HTMLElement>('.sum-term')
    if (target && target !== currentDrag.source && target.dataset.side === currentDrag.side &&
      target.dataset.termIndex === String(currentDrag.termIndex) &&
      target.dataset.sumPath === JSON.stringify(currentDrag.sumPath)) {
      perform(() => {
        if (!mergeSelectedNestedTerms(currentDrag.side, currentDrag.termIndex, currentDrag.sumPath!,
          currentDrag.index, Number(target.dataset.sumIndex))) throw new Error(strings.incompatibleTerms)
      })
    }
    return
  }

  if (distribution) {
    perform(() => {
      const parentPath = currentDrag.factorPath!.slice(0, -1)
      const factor = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
      const sum = selectedLocation(currentDrag.side, currentDrag.termIndex, [...parentPath, distribution.sumIndex])
      if (factor.termIndex !== sum.termIndex ||
        JSON.stringify(factor.path.slice(0, -1)) !== JSON.stringify(sum.path.slice(0, -1))) {
        throw new Error(strings.numericFactorsOnly)
      }
      distributeFactor(equation, currentDrag.side, factor.termIndex,
        factor.path.slice(0, -1), factor.path[factor.path.length - 1], sum.path[sum.path.length - 1],
        distributionPlacement,
        evaluateDistributedProducts)
    })
    return
  }

  if (currentDrag.kind === 'fraction-factor') {
    const operator = elementUnderPointer?.closest<HTMLElement>('.multiply-token')
    const pair = operator && operator.dataset.side === currentDrag.side &&
      operator.dataset.termIndex === String(currentDrag.termIndex) &&
      operator.dataset.parentPath === JSON.stringify(currentDrag.factorPath?.slice(0, -1))
      ? adjacentFactorPair(operator, currentDrag.index)
      : undefined
    if (operator && pair) {
      perform(() => {
        if (!swapSelectedFactors(currentDrag.side, currentDrag.termIndex,
          currentDrag.factorPath!.slice(0, -1), pair[0], pair[1])) {
          throw new Error(strings.swapAdjacentOnly)
        }
      })
      return
    }
    if (!fractionHit) return
    if (fractionHit.kind === 'cancel') {
      perform(() => {
        if (canEvaluateNegativeUnitFraction(equation, currentDrag.side, currentDrag.termIndex,
          currentDrag.fractionPath!, fractionHit.numeratorPath, fractionHit.denominatorPath)) {
          evaluateNegativeUnitFraction(equation, currentDrag.side, currentDrag.termIndex,
            currentDrag.fractionPath!, fractionHit.numeratorPath, fractionHit.denominatorPath)
        } else {
          cancelFractionFactors(equation, currentDrag.side, currentDrag.termIndex,
            currentDrag.fractionPath!, fractionHit.numeratorPath, fractionHit.denominatorPath)
        }
      }, true)
      return
    }
    const target = fractionHit.target
    const placement = target.dataset.placement === 'after' ? 'after' : 'before'
    if (target.dataset.side !== currentDrag.side) {
      const evaluateProduct = currentDrag.numericMultiplyTarget &&
        currentDrag.numericMultiplyTarget.side === target.dataset.side &&
        dropRectContains(currentDrag.numericMultiplyTarget.rect, event.clientX, event.clientY)
      perform(() => {
        const selected = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
        moveFactorAcrossEquals(
          equation,
          currentDrag.side,
          selected.termIndex,
          selected.path,
          currentDrag.factorValue,
          placement,
          Boolean(evaluateProduct),
        )
      })
      return
    }
    if (currentDrag.fractionPart === 'numerator') {
      perform(() => {
        const selected = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
        divideAllBySelectedFactor(
          equation,
          currentDrag.side,
          selected.termIndex,
          selected.path,
          currentDrag.factorValue,
          placement,
          'before',
        )
      })
      return
    }
    if (currentDrag.fractionPart === 'denominator') {
      perform(() => {
        const selected = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
        multiplyAllBySelectedFactor(
          equation,
          currentDrag.side,
          selected.termIndex,
          selected.path,
          currentDrag.factorValue,
          placement,
        )
      })
      return
    }
    return
  }

  if (currentDrag.kind === 'factor') {
    const divisionTarget = dropTarget?.classList.contains('division-drop-target') ? dropTarget : undefined
    if (divisionTarget?.dataset.side && divisionTarget.dataset.side !== currentDrag.side) {
      perform(() => {
        const selected = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
        moveFactorAcrossEquals(
          equation,
          currentDrag.side,
          selected.termIndex,
          selected.path,
          currentDrag.factorValue,
        )
      })
      return
    }
    if (divisionTarget?.dataset.side) {
      perform(() => {
        const selected = selectedLocation(currentDrag.side, currentDrag.termIndex, currentDrag.factorPath!)
        divideAllBySelectedFactor(
          equation,
          currentDrag.side,
          selected.termIndex,
          selected.path,
          currentDrag.factorValue,
        )
      })
      return
    }
    const operator = elementUnderPointer?.closest<HTMLElement>('.multiply-token')
    const pair = operator && operator.dataset.side === currentDrag.side &&
      operator.dataset.termIndex === String(currentDrag.termIndex) &&
      operator.dataset.parentPath === JSON.stringify(currentDrag.factorPath?.slice(0, -1))
      ? adjacentFactorPair(operator, currentDrag.index)
      : undefined
    if (operator && pair) {
      perform(() => {
        if (!swapSelectedFactors(currentDrag.side, currentDrag.termIndex,
          currentDrag.factorPath!.slice(0, -1), pair[0], pair[1])) {
          throw new Error(strings.swapAdjacentOnly)
        }
      })
      return
    }
    const swapTarget = elementUnderPointer?.closest<HTMLElement>('.factor-swap-target')
    if (swapTarget?.dataset.side === currentDrag.side &&
      swapTarget.dataset.termIndex === String(currentDrag.termIndex) &&
      swapTarget.dataset.parentPath === JSON.stringify(currentDrag.factorPath?.slice(0, -1)) &&
      swapTarget.dataset.factorIndex !== undefined &&
      Math.abs(Number(swapTarget.dataset.factorIndex) - currentDrag.index) === 1) {
      perform(() => {
        if (!swapSelectedFactors(currentDrag.side, currentDrag.termIndex,
          currentDrag.factorPath!.slice(0, -1), currentDrag.index, Number(swapTarget.dataset.factorIndex))) {
          throw new Error(strings.swapAdjacentOnly)
        }
      })
      return
    }
    const target = elementUnderPointer?.closest<HTMLElement>('.factor-tile')
    if (
      target &&
      target !== currentDrag.source &&
      target.dataset.side === currentDrag.side &&
      target.dataset.termIndex === String(currentDrag.termIndex) &&
      target.dataset.parentPath === JSON.stringify(currentDrag.factorPath?.slice(0, -1)) &&
      target.dataset.factorIndex !== undefined
    ) {
      perform(() => multiplySelectedFactors(
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!.slice(0, -1),
        currentDrag.index,
        Number(target.dataset.factorIndex),
      ))
    }
    return
  }

}

document.addEventListener('pointerup', finishDrag)
document.addEventListener('pointercancel', finishDrag)

render()
