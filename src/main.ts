import './style.css'
import {
  addTermBoth,
  cancelFractionFactors,
  divideAll,
  divideAllBySelectedFactor,
  multiplyAllBySelectedFactor,
  moveFactorAcrossEquals,
  extendFraction,
  mergeAll,
  mergeEquationTerms,
  moveOperandBetweenSides,
  multiplyAll,
  multiplyFactors,
} from './engine/actions'
import { applyAutoSuggestion, autoLevelLabel, clampAutoLevel, getAutoSuggestion } from './engine/auto'
import { createEquation, type Equation } from './model/equation'
import { renderEquationRow } from './ui/equationRow'
import { renderHistoryPanel } from './ui/historyPanel'
import { strings } from './strings'

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
        <span>k</span>
        <input id="k-value" type="number" step="1" value="2" aria-label="Heltallsverdi for k">
      </label>
      <button class="tool-button multiply-action" data-action="multiply" type="button">· k</button>
      <button class="tool-button divide-action" data-action="divide" type="button">÷ k</button>
      <button class="tool-button add-action" data-action="add" type="button">+ k</button>
      <button class="tool-button subtract-action" data-action="subtract" type="button">− k</button>
      <button class="tool-button extend-action" data-action="extend" type="button">× k/k</button>
      <button class="tool-button" data-action="merge" type="button">${strings.merge}</button>
      <span class="toolbar-spacer"></span>
      <button class="tool-button secondary-action" data-action="undo" type="button">↶ ${strings.undo}</button>
      <button class="tool-button primary-action" data-action="new" type="button">${strings.newEquation}</button>
    </section>

    <p id="message" class="message" role="status" aria-live="polite"></p>

    <section class="workspace-grid">
      <div id="history-panel"></div>
      <section class="equation-card card" aria-label="Oppgave">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Oppgave</p>
          </div>
          <span id="solved-badge" class="solved-badge" hidden>Løst</span>
        </div>
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
const previousEquations: Equation[] = []
let dragState: {
  kind: 'term' | 'factor' | 'fraction-factor'
  source: HTMLElement
  ghost: HTMLElement
  side: 'left' | 'right'
  termIndex: number
  index: number
  factorPath?: number[]
  fractionPath?: number[]
  fractionPart?: 'numerator' | 'denominator'
  factorValue?: number
  pointerX: number
  pointerY: number
} | undefined

function currentK(): number {
  const value = Number(kInput.value)
  if (!kInput.value.trim() || !Number.isInteger(value)) throw new Error(strings.invalidK)
  return value
}

function isSolved(): boolean {
  return /^(x = -?\d+|-?\d+ = x)$/.test(equation.prettyPrint())
}

function render(): void {
  equationRow.replaceChildren(renderEquationRow(equation))
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

function perform(action: () => void): void {
  message.textContent = ''
  message.classList.remove('message-error')
  try {
    action()
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Handlingen kunne ikke utføres.'
    message.classList.add('message-error')
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
    if (equation.history.canUndo()) {
      const previous = equation.history.undo()
      if (previous) {
        equation.left = previous.left
        equation.right = previous.right
      }
    } else if (previousEquations.length > 0) {
      equation = previousEquations.pop()!
    }
    message.textContent = ''
    render()
  }
  if (action === 'new') {
    previousEquations.push(equation)
    equation = createEquation()
    extending = false
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
  const suggestion = getAutoSuggestion(equation, autoLevel)
  if (suggestion) perform(() => applyAutoSuggestion(equation, suggestion))
})

equationRow.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (extending) {
    if (!target.closest('.fraction')) return
    const term = target.closest<HTMLElement>('.draggable-term')
    if (!term?.dataset.side || term.dataset.index === undefined) return
    perform(() => extendFraction(equation, term.dataset.side as 'left' | 'right', Number(term.dataset.index), currentK()))
    extending = false
    app.querySelector('[data-action="extend"]')?.classList.remove('active')
    return
  }

  const termOperator = target.closest<HTMLElement>('.operator-tile')
  if (termOperator?.dataset.side && termOperator.dataset.leftTerm && termOperator.dataset.rightTerm) {
    perform(() => {
      if (!mergeEquationTerms(
        equation,
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
    perform(() => multiplyFactors(
      equation,
      factorOperator.dataset.side as 'left' | 'right',
      Number(factorOperator.dataset.termIndex),
      JSON.parse(factorOperator.dataset.parentPath!) as number[],
      Number(factorOperator.dataset.leftFactor),
      Number(factorOperator.dataset.rightFactor),
    ))
  }
})

document.addEventListener('pointerdown', (event) => {
  if (extending || !(event.target instanceof Element)) return
  const target = event.target
  if (!equationRow.contains(target)) return
  if (target.closest('.operator-tile, .factor-operator')) return

  const fractionFactor = target.closest<HTMLElement>('.fraction-factor')
  const factor = target.closest<HTMLElement>('.factor-tile')
  const term = target.closest<HTMLElement>('.draggable-term')
  const source = fractionFactor ?? factor ?? term
  if (!source?.dataset.side) return

  let kind: 'term' | 'factor' | 'fraction-factor'
  let termIndex: number
  let index: number
  let factorPath: number[] | undefined
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
  ghost.style.left = `${rect.left}px`
  ghost.style.top = `${rect.top}px`
  ghost.style.width = `${rect.width}px`
  document.body.append(ghost)
  source.classList.add('dragging')
  if (kind === 'factor' || kind === 'fraction-factor') {
    const row = renderedEquationRow()
    if (kind === 'factor') row?.classList.add('show-division-targets')
    if (kind === 'fraction-factor' && fractionPart === 'numerator' && row) {
      row.classList.add('show-division-targets')
      row.dataset.divisionOnly = source.dataset.side === 'left' ? 'right' : 'left'
    }
    row?.style.setProperty('--drop-factor-width', `${rect.width}px`)
    row?.style.setProperty('--drop-factor-height', `${rect.height}px`)
    if (kind === 'fraction-factor' && fractionPart === 'denominator') {
      const sourceSide = source.dataset.side
      row?.querySelectorAll<HTMLElement>('.multiply-drop-target').forEach((target) => {
        const inSameFraction =
          target.dataset.side === sourceSide &&
          target.dataset.termIndex === String(termIndex) &&
          target.dataset.fractionPath === JSON.stringify(fractionPath)
        const onOtherSide = target.dataset.side !== sourceSide && target.dataset.wholeSide === 'true'
        if (inSameFraction || onOtherSide) target.classList.add('active')
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
    fractionPath,
    fractionPart,
    factorValue: source.dataset.value === undefined ? undefined : Number(source.dataset.value),
    pointerX: event.clientX,
    pointerY: event.clientY,
  }
}, true)

document.addEventListener('pointermove', (event) => {
  if (!dragState) return
  dragState.ghost.style.transform = `translate(${event.clientX - dragState.pointerX}px, ${event.clientY - dragState.pointerY}px)`
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
  equationRow.querySelectorAll('.drop-target, .factor-drop-target').forEach((target) => {
    target.classList.remove('drop-target', 'factor-drop-target')
  })
  equationRow.querySelectorAll('.division-drop-target.drop-target').forEach((target) => {
    target.classList.remove('drop-target')
  })

  if (dragState.kind === 'fraction-factor') {
    const drag = dragState
    const multiplyTarget = elementUnderPointer?.closest<HTMLElement>('.multiply-drop-target.active')
      ?? (() => {
        const hoveredSide = elementUnderPointer?.closest<HTMLElement>('.equation-side')
        if (drag.fractionPart !== 'denominator' || !hoveredSide || hoveredSide.dataset.side === drag.side) {
          return undefined
        }
        return hoveredSide.querySelector<HTMLElement>('.multiply-drop-target.active') ?? undefined
      })()
    if (multiplyTarget) {
      multiplyTarget.classList.add('drop-target')
      return
    }
    const hoveredSide = elementUnderPointer?.closest<HTMLElement>('.equation-side')
    if (drag.fractionPart === 'numerator' && hoveredSide && hoveredSide.dataset.side !== drag.side) {
      hoveredSide.querySelector<HTMLElement>('.division-drop-target')?.classList.add('drop-target')
      return
    }
    const target = elementUnderPointer?.closest<HTMLElement>('.fraction-factor')
    if (
      target &&
      target !== dragState.source &&
      target.dataset.side === dragState.side &&
      target.dataset.termIndex === String(dragState.termIndex) &&
      target.dataset.fractionPath === JSON.stringify(dragState.fractionPath) &&
      target.dataset.fractionPart !== dragState.fractionPart
    ) {
      target.classList.add('factor-drop-target')
    }
    return
  }

  if (dragState.kind === 'factor') {
    const denominatorTarget = elementUnderPointer?.closest<HTMLElement>('.division-drop-target')
    if (denominatorTarget) {
      denominatorTarget.classList.add('drop-target')
      return
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

  const targetTerm = elementUnderPointer?.closest<HTMLElement>('.draggable-term')
  if (targetTerm && targetTerm !== dragState.source) {
    if (targetTerm.dataset.side === dragState.side) targetTerm.classList.add('factor-drop-target')
  }
  const targetSide = elementUnderPointer?.closest<HTMLElement>('.equation-side')
  equationRow.querySelectorAll('.equation-side').forEach((side) => {
    if (targetSide && targetSide.dataset.side !== dragState?.side) side.classList.remove('drop-target')
    else side.classList.remove('drop-target')
  })
  if (targetSide && targetSide.dataset.side !== dragState.side) targetSide.classList.add('drop-target')
})

function finishDrag(event: PointerEvent): void {
  if (!dragState) return
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
  const currentDrag = dragState
  dragState = undefined
  currentDrag.ghost.remove()
  currentDrag.source.classList.remove('dragging')
  const finishedRow = renderedEquationRow()
  finishedRow?.classList.remove('show-division-targets')
  if (finishedRow) delete finishedRow.dataset.divisionOnly
  equationRow.querySelectorAll('.multiply-drop-target.active').forEach((target) => {
    target.classList.remove('active')
  })
  equationRow.querySelectorAll('.drop-target, .factor-drop-target').forEach((target) => {
    target.classList.remove('drop-target', 'factor-drop-target')
  })
  equationRow.querySelectorAll('.division-drop-target.drop-target').forEach((target) => {
    target.classList.remove('drop-target')
  })

  if (currentDrag.kind === 'fraction-factor') {
    const multiplyTarget = elementUnderPointer?.closest<HTMLElement>('.multiply-drop-target')
    const dropSide = elementUnderPointer?.closest<HTMLElement>('.equation-side')?.dataset.side
    if (dropSide && dropSide !== currentDrag.side) {
      perform(() => moveFactorAcrossEquals(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!,
        currentDrag.factorValue,
      ))
      return
    }
    if (currentDrag.fractionPart === 'denominator' && multiplyTarget) {
      perform(() => multiplyAllBySelectedFactor(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!,
        currentDrag.factorValue,
      ))
      return
    }
    const target = elementUnderPointer?.closest<HTMLElement>('.fraction-factor')
    if (
      target &&
      target !== currentDrag.source &&
      target.dataset.side === currentDrag.side &&
      target.dataset.termIndex === String(currentDrag.termIndex) &&
      target.dataset.fractionPath === JSON.stringify(currentDrag.fractionPath) &&
      target.dataset.fractionPart !== currentDrag.fractionPart &&
      target.dataset.factorPath !== undefined
    ) {
      const sourcePath = currentDrag.factorPath!
      const targetPath = JSON.parse(target.dataset.factorPath) as number[]
      const numeratorPath =
        currentDrag.fractionPart === 'numerator' ? sourcePath : targetPath
      const denominatorPath =
        currentDrag.fractionPart === 'denominator' ? sourcePath : targetPath
      perform(() => cancelFractionFactors(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.fractionPath!,
        numeratorPath,
        denominatorPath,
      ))
    }
    return
  }

  if (currentDrag.kind === 'factor') {
    const divisionTarget = elementUnderPointer?.closest<HTMLElement>('.division-drop-target')
    if (divisionTarget?.dataset.side && divisionTarget.dataset.side !== currentDrag.side) {
      perform(() => moveFactorAcrossEquals(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!,
        currentDrag.factorValue,
      ))
      return
    }
    if (divisionTarget?.dataset.side) {
      perform(() => divideAllBySelectedFactor(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!,
        currentDrag.factorValue,
      ))
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
      perform(() => multiplyFactors(
        equation,
        currentDrag.side,
        currentDrag.termIndex,
        currentDrag.factorPath!.slice(0, -1),
        currentDrag.index,
        Number(target.dataset.factorIndex),
      ))
    }
    return
  }

  const targetTerm = elementUnderPointer?.closest<HTMLElement>('.draggable-term')
  const targetSide = elementUnderPointer?.closest<HTMLElement>('.equation-side')
  if (targetTerm?.dataset.side === currentDrag.side && targetTerm.dataset.index !== undefined) {
    const targetIndex = Number(targetTerm.dataset.index)
    if (targetIndex !== currentDrag.termIndex) {
      perform(() => {
        if (!mergeEquationTerms(equation, currentDrag.side, currentDrag.termIndex, targetIndex)) {
          throw new Error(strings.incompatibleTerms)
        }
      })
    }
  } else if (targetSide?.dataset.side && targetSide.dataset.side !== currentDrag.side) {
    perform(() => moveOperandBetweenSides(equation, currentDrag.side, currentDrag.termIndex))
  }
}

document.addEventListener('pointerup', finishDrag)
document.addEventListener('pointercancel', finishDrag)

render()
