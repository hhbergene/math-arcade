import type { Equation } from '../model/equation'
import { isOp, type Node, type OpNode } from '../model/node'
import { nodeSign, positiveForDisplay } from '../model/prettyPrint'
import { hasSameStructure, keepsSignInFirstFactor, renderNode } from './renderNode'

function isWholeSideFraction(expression: OpNode): boolean {
  return expression.operands.length === 1 && isOp(expression.operands[0], 'div')
}

function renderSide(
  side: 'left' | 'right',
  expression: OpNode,
): HTMLElement {
  const area = document.createElement('section')
  area.className = 'equation-side'
  area.dataset.side = side
  area.setAttribute('aria-label', side === 'left' ? 'Venstre side' : 'Høyre side')

  if (isWholeSideFraction(expression)) {
    const term = document.createElement('div')
    term.className = 'draggable-term fraction-term'
    term.dataset.side = side
    term.dataset.index = '0'
    term.dataset.termIndex = '0'
    term.setAttribute('aria-label', 'Brøkledd; dra for å flytte over likhetstegnet')
    term.append(renderNode(expression.operands[0], {
      side,
      termIndex: 0,
      path: [],
    }))
    const topFraction = term.querySelector<HTMLElement>(':scope > .fraction')
    topFraction?.querySelector<HTMLElement>(':scope > .numerator > .multiply-drop-target')
      ?.setAttribute('data-whole-side', 'true')
    topFraction?.querySelector<HTMLElement>(':scope > .denominator')
      ?.append(divisionTarget(side))
    area.append(term)
    return area
  }

  const fraction = document.createElement('div')
  fraction.className = 'side-fraction division-preview'
  const terms = document.createElement('div')
  terms.className = 'equation-terms'
  const multiplyTarget = document.createElement('span')
  multiplyTarget.className = 'multiply-drop-target'
  multiplyTarget.dataset.side = side
  multiplyTarget.dataset.wholeSide = 'true'
  multiplyTarget.setAttribute('aria-label', 'Slipp her for å gange begge sider med faktoren')
  terms.append(multiplyTarget)

  if (expression.operands.length === 0) {
    terms.append(renderNode({ kind: 'num', value: 0 }))
  } else {
    expression.operands.forEach((term: Node, index) => {
      const ownSign = index === 0 && keepsSignInFirstFactor(term)
      const sign = ownSign ? 1 : nodeSign(term)
      if (index > 0 || sign === -1) {
        const canMerge = index > 0
        const token = document.createElement(canMerge ? 'button' : 'span')
        token.className = `equation-operator${canMerge ? ' operator-tile' : ''}`
        if (canMerge) {
          token.setAttribute('type', 'button')
          token.setAttribute('aria-label', `Slå sammen ledd ${index} og ${index + 1}`)
          token.dataset.side = side
          token.dataset.leftTerm = String(index - 1)
          token.dataset.rightTerm = String(index)
        }
        token.textContent = sign === -1 ? '−' : '+'
        terms.append(token)
      }

      const wrapper = document.createElement('div')
      wrapper.className = 'draggable-term'
      wrapper.dataset.side = side
      wrapper.dataset.index = String(index)
      wrapper.dataset.termIndex = String(index)
      wrapper.setAttribute('aria-label', `Ledd ${index + 1}; dra for å flytte over likhetstegnet`)
      const displayedTerm = sign === -1 ? positiveForDisplay(term) : term
      const context = hasSameStructure(term, displayedTerm)
        ? { side, termIndex: index, path: [] }
        : undefined
      wrapper.append(renderNode(displayedTerm, context))
      terms.append(wrapper)
    })
  }

  fraction.append(terms)
  const line = document.createElement('div')
  line.className = 'equation-wide-fraction-line'
  line.setAttribute('aria-hidden', 'true')
  fraction.append(line)
  fraction.append(divisionTarget(side))
  area.append(fraction)
  return area
}

function divisionTarget(side: 'left' | 'right'): HTMLElement {
  const target = document.createElement('span')
  target.className = 'division-drop-target'
  target.dataset.side = side
  target.setAttribute('aria-label', `Nevner for ${side === 'left' ? 'venstre' : 'høyre'} side`)
  return target
}

export function renderEquationRow(equation: Equation): HTMLElement {
  const row = document.createElement('div')
  row.className = 'equation-row'
  row.append(renderSide('left', equation.left))

  const equals = document.createElement('span')
  equals.className = 'equals-token'
  equals.textContent = '='
  equals.setAttribute('aria-label', 'er lik')
  row.append(equals, renderSide('right', equation.right))
  return row
}
