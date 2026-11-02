import { isOp, type Node } from '../model/node'
import { nodeSign, positiveForDisplay } from '../model/prettyPrint'
import type { FractionCancellation } from '../engine/actions'

type RenderContext = {
  side: 'left' | 'right'
  termIndex: number
  path: number[]
  cancellations?: readonly FractionCancellation[]
}

type FractionContext = {
  path: number[]
  part: 'numerator' | 'denominator'
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

export function hasSameStructure(left: Node, right: Node): boolean {
  if (left.kind !== right.kind) return false
  if (!isOp(left) || !isOp(right)) return true
  return (
    left.operands.length === right.operands.length &&
    left.operands.every((child, index) => hasSameStructure(child, right.operands[index]))
  )
}

/** Leading negative coefficients keep their sign inside the factor chip. */
export function keepsSignInFirstFactor(term: Node): boolean {
  if (term.kind === 'num') return term.value < 0
  if (!isOp(term, 'mul')) return false
  return term.operands.some((factor) => factor.kind === 'num' && factor.value < 0)
}

function numberText(value: number, parenthesizeNegative = false): string {
  if (value >= 0) return String(value)
  const text = `−${Math.abs(value)}`
  return parenthesizeNegative ? `(${text})` : text
}

function addFactorData(element: HTMLElement, context: RenderContext, factorIndex: number): void {
  element.dataset.side = context.side
  element.dataset.termIndex = String(context.termIndex)
  element.dataset.parentPath = JSON.stringify(context.path)
  element.dataset.factorIndex = String(factorIndex)
}

function addFractionFactorData(
  element: HTMLElement,
  context: RenderContext,
  factorPath: number[],
  fraction: FractionContext,
): void {
  element.dataset.side = context.side
  element.dataset.termIndex = String(context.termIndex)
  element.dataset.factorPath = JSON.stringify(factorPath)
  element.dataset.fractionPath = JSON.stringify(fraction.path)
  element.dataset.fractionPart = fraction.part
}

function fractionCancellationValue(
  context: RenderContext,
  factorPath: number[],
): { original: number; reduced: number; part: 'numerator' | 'denominator' } | undefined {
  let result: { original: number; reduced: number; part: 'numerator' | 'denominator' } | undefined
  for (const cancellation of context.cancellations ?? []) {
    if (cancellation.side !== context.side || cancellation.termIndex !== context.termIndex) continue
    for (const part of ['numerator', 'denominator'] as const) {
      if (JSON.stringify(cancellation[`${part}Path`]) !== JSON.stringify(factorPath)) continue
      result = { original: result?.original ?? cancellation[`${part}Original`],
        reduced: cancellation[`${part}Reduced`], part }
    }
  }
  return result
}

function renderFactorValue(
  value: number,
  factorPath: number[],
  context: RenderContext,
  parenthesizeNegative = false,
  fraction?: FractionContext,
): HTMLElement {
  const signedChip = (number: number): HTMLElement => {
    const chip = numberChip(number, parenthesizeNegative)
    const minus = chip.querySelector<HTMLElement>('.number-minus-chip')
    if (minus) {
      minus.classList.add('factor-tile', 'minus-factor')
      minus.dataset.value = '-1'
      if (fraction) {
        minus.classList.add('fraction-factor')
        addFractionFactorData(minus, context,
          number === -1 ? factorPath : [...factorPath, 0], fraction)
      } else {
        addFactorData(minus, { ...context, path: factorPath }, 0)
      }
    }
    return chip
  }
  const cancellation = fractionCancellationValue(context, factorPath)
  if (!cancellation) return signedChip(value)

  const annotation = element(
    'span',
    `fraction-cancellation fraction-cancellation-${cancellation.part}`,
  )
  annotation.dataset.side = context.side
  annotation.dataset.termIndex = String(context.termIndex)
  annotation.dataset.factorPath = JSON.stringify(factorPath)
  const preservedMinus = cancellation.original < 0 && cancellation.reduced < 0
  const originalValue = preservedMinus ? -cancellation.original : cancellation.original
  const reducedValue = preservedMinus ? -cancellation.reduced : cancellation.reduced
  const original = numberChip(originalValue, parenthesizeNegative && !preservedMinus)
  original.classList.add('fraction-cancelled-chip')
  const reduced = element('span', 'fraction-cancellation-result')
  reduced.textContent = numberText(reducedValue, parenthesizeNegative && !preservedMinus)
  reduced.setAttribute('aria-label', `Forkortet verdi ${numberText(cancellation.reduced)}; klikk for å fullføre`)
  annotation.append(original, reduced)
  if (preservedMinus) {
    const signed = element('span', 'signed-number')
    const minus = signedChip(cancellation.original).querySelector<HTMLElement>('.number-minus-chip')!
    if (parenthesizeNegative) signed.append('(')
    signed.append(minus, annotation)
    if (parenthesizeNegative) signed.append(')')
    return signed
  }
  return annotation
}

function renderProduct(
  node: Node & { kind: 'mul' },
  context: RenderContext,
  denominatorFactors = false,
  fraction?: FractionContext,
): HTMLElement {
  const product = element('span', 'product-node')
  node.operands.forEach((factor, index) => {
    if (index > 0) {
      const previous = node.operands[index - 1]
      const canMultiply = previous.kind === 'num' && factor.kind === 'num'
      const token = element(
        canMultiply ? 'button' : 'span',
        `inline-operator multiply-token${canMultiply ? ' factor-operator' : ''}`,
      )
      token.dataset.side = context.side
      token.dataset.termIndex = String(context.termIndex)
      token.dataset.parentPath = JSON.stringify(context.path)
      token.dataset.leftFactor = String(index - 1)
      token.dataset.rightFactor = String(index)
      token.setAttribute(
        'aria-label',
        canMultiply
          ? 'Klikk for å gange sammen nabofaktorene, eller dra en faktor hit for å bytte plass'
          : 'Dra en faktor hit for å bytte plass',
      )
      if (canMultiply) {
        token.setAttribute('type', 'button')
      }
      const compactMinus = index === 1 && previous.kind === 'num' &&
        previous.value === -1 && factor.kind === 'var'
      token.textContent = compactMinus ? '' : '·'
      if (compactMinus) token.classList.add('compact-minus-product')
      product.append(token)
    }
    const isDraggableFactor = factor.kind === 'num'
    const wrapper = element('span', isDraggableFactor
      ? `factor-tile${denominatorFactors ? ' denominator-factor' : ''}${fraction ? ' fraction-factor' : ''}`
      : 'factor-piece')
    if (isDraggableFactor) {
      const factorPath = [...context.path, index]
      if (fraction) addFractionFactorData(wrapper, context, factorPath, fraction)
      else addFactorData(wrapper, context, index)
      wrapper.dataset.value = String(factor.value)
      const shown = numberText(factor.value)
      wrapper.setAttribute(
        'aria-label',
        fraction && fractionCancellationValue(context, factorPath)
          ? `Forkortet faktor ${shown}; klikk for å fullføre forkortingen`
          : fraction
          ? `Tallfaktor ${shown} i ${fraction.part === 'numerator' ? 'telleren' : 'nevneren'}; dra inn i parentesen for å gange alle ledd, slipp på en tallfaktor for å regne ut produktene; drag over brøkstreken forkorter direkte, to klikk viser forkortingen; dra til skillet mellom faktorer for å bytte plass`
          : denominatorFactors
          ? `Tallfaktor ${shown} i nevneren`
          : `Tallfaktor ${shown}; dra inn i parentesen for å gange alle ledd, slipp på en tallfaktor for å regne ut produktene; dra til skillet eller en nabovariabel for å bytte plass, til en tallfaktor for å gange eller klikk på to tallfaktorer; dra til nevneren for å dele`,
      )
    } else if (factor.kind === 'var' && !fraction) {
      wrapper.classList.add('factor-swap-target')
      addFactorData(wrapper, context, index)
      wrapper.setAttribute('aria-label', 'Slipp en nabofaktor her for å bytte plass')
    }
    wrapper.append(
      factor.kind === 'num'
        ? renderFactorValue(factor.value, [...context.path, index], context, index > 0, fraction)
        : withParentheses(factor, renderNode(factor, {
          ...context,
          path: [...context.path, index],
        })),
    )
    if (index === 0 && factor.kind === 'num' && factor.value === -1 &&
      node.operands[1]?.kind === 'var' &&
      !fractionCancellationValue(context, [...context.path, index])) {
      wrapper.classList.add('minus-factor')
      const minus = element('span', 'factor-chip')
      minus.textContent = '−'
      wrapper.replaceChildren(minus)
      wrapper.setAttribute('aria-label', 'Faktor −1; dra minuschipen for å dele med −1 eller bytte faktorplass')
    }
    product.append(wrapper)
  })
  return product
}

function numberChip(value: number, parenthesizeNegative = false): HTMLElement {
  if (value < 0) {
    const number = element('span', 'signed-number')
    if (parenthesizeNegative) number.append('(')
    const minus = element('span', 'factor-chip number-minus-chip')
    minus.textContent = '−'
    minus.setAttribute('aria-label', 'Minus, faktor −1')
    const magnitude = element('span', 'factor-chip')
    magnitude.textContent = String(Math.abs(value))
    number.append(minus, magnitude)
    if (parenthesizeNegative) number.append(')')
    return number
  }
  const chip = element('span', 'factor-chip')
  chip.textContent = numberText(value, parenthesizeNegative)
  return chip
}

export function addMultiplicationTargets(
  container: HTMLElement,
  data: Record<string, string>,
  targetClass = 'multiply-drop-target',
): void {
  for (const placement of ['before', 'after']) {
    const target = element('span', targetClass)
    Object.assign(target.dataset, data, { placement })
    const operation = targetClass === 'division-drop-target' ? 'dele med' : 'gange med'
    target.setAttribute('aria-label', `Slipp ${placement === 'before' ? 'før' : 'etter'} uttrykket for å ${operation} faktoren`)
    container.append(target)
  }
}

export function renderNode(node: Node, context?: RenderContext): HTMLElement {
  if (node.kind === 'num') {
    if (node.value < 0 && context && context.path.length === 0) {
      const product = element('span', 'product-node')
      const minus = element('span', 'factor-tile minus-factor')
      addFactorData(minus, context, 0)
      minus.dataset.value = '-1'
      minus.setAttribute('aria-label', 'Faktor −1; dra minuschipen for å dele med −1')
      const chip = numberChip(-1)
      chip.textContent = '−'
      minus.append(chip)
      product.append(minus, numberChip(-node.value))
      return product
    }
    return numberChip(node.value)
  }
  if (node.kind === 'var') {
    const chip = element('span', 'factor-chip variable-chip')
    chip.textContent = String(node.value)
    return chip
  }

  if (isOp(node, 'add')) {
    const addition = element('span', 'nested-addition')
    if (context) {
      addition.dataset.side = context.side
      addition.dataset.termIndex = String(context.termIndex)
      addition.dataset.sumPath = JSON.stringify(context.path)
    }
    node.operands.forEach((term, index) => {
      const ownSign = index === 0 && keepsSignInFirstFactor(term)
      const sign = ownSign ? 1 : nodeSign(term)
      if (index > 0 || sign === -1) {
        const interactive = context && index > 0
        const token = element(interactive ? 'button' : 'span',
          `inline-operator${interactive ? ' operator-tile nested-sum-operator' : ''}`)
        if (interactive) {
          token.setAttribute('type', 'button')
          token.setAttribute('aria-label', `Klikk for å slå sammen ledd ${index} og ${index + 1}, eller dra hit for å bytte plass`)
          token.dataset.side = context.side
          token.dataset.termIndex = String(context.termIndex)
          token.dataset.sumPath = JSON.stringify(context.path)
          token.dataset.leftTerm = String(index - 1)
          token.dataset.rightTerm = String(index)
        }
        token.textContent = sign === -1 ? '−' : '+'
        addition.append(token)
      }
      const body = element('span', `nested-term${context ? ' sum-term' : ''}`)
      if (context) {
        body.dataset.side = context.side
        body.dataset.termIndex = String(context.termIndex)
        body.dataset.sumPath = JSON.stringify(context.path)
        body.dataset.sumIndex = String(index)
        body.setAttribute(
          'aria-label',
          `Ledd ${index + 1} i summen; dra til skillet for å bytte plass, klikk på to ledd eller dra til et annet ledd for å slå sammen`,
        )
      }
      const displayedTerm = sign === -1 ? positiveForDisplay(term) : term
      body.append(
        context && hasSameStructure(term, displayedTerm)
          ? renderNode(displayedTerm, {
              ...context,
              path: [...context.path, index],
            })
          : renderNode(displayedTerm),
      )
      addition.append(body)
    })
    return addition
  }

  if (isOp(node, 'mul')) {
    return context ? renderProduct(node, context) : renderPlainProduct(node)
  }

  const fraction = element('span', 'fraction')
  const numerator = element('span', 'fraction-part numerator')
  const denominator = element('span', 'fraction-part denominator')
  const fractionPath = context?.path ?? []
  const numeratorContext = context
    ? { ...context, path: [...context.path, 0] }
    : undefined
  const denominatorContext = context
    ? { ...context, path: [...context.path, 1] }
    : undefined
  const renderFractionPart = (
    partNode: Node | undefined,
    part: 'numerator' | 'denominator',
    partContext: RenderContext | undefined,
  ): HTMLElement | Text => {
    if (!partNode) return document.createTextNode(part === 'numerator' ? '0' : '?')
    if (!partContext) return renderNode(partNode)
    const fractionContext = { path: fractionPath, part }
    if (partNode.kind === 'num') {
      const factor = element('span', 'factor-tile fraction-factor')
      addFractionFactorData(factor, partContext, partContext.path, fractionContext)
      factor.dataset.value = String(partNode.value)
      factor.setAttribute(
        'aria-label',
        fractionCancellationValue(partContext, partContext.path)
          ? `Forkortet faktor ${numberText(partNode.value)}; klikk for å fullføre forkortingen`
          : `Tallfaktor ${numberText(partNode.value)} i ${part === 'numerator' ? 'telleren' : 'nevneren'}; dra til en faktor på motsatt side av brøkstreken for å forkorte direkte, eller klikk på begge for å vise forkortingen; deling på −1 regnes ut direkte`,
      )
      factor.append(renderFactorValue(partNode.value, partContext.path, partContext, false, fractionContext))
      return factor
    }
    if (isOp(partNode, 'mul')) {
      return renderProduct(
        partNode,
        partContext,
        part === 'denominator',
        fractionContext,
      )
    }
    return renderNode(partNode, partContext)
  }
  if (context) {
    addMultiplicationTargets(numerator, {
      side: context.side,
      termIndex: String(context.termIndex),
      fractionPath: JSON.stringify(fractionPath),
    })
    addMultiplicationTargets(denominator, {
      side: context.side,
      termIndex: String(context.termIndex),
      fractionPath: JSON.stringify(fractionPath),
    }, 'division-drop-target')
  }
  if (isOp(node.operands[0], 'add') && node.operands[0].operands.length > 1) {
    numerator.classList.add('multiplication-sum')
  }
  if (isOp(node.operands[1], 'add') && node.operands[1].operands.length > 1) {
    denominator.classList.add('multiplication-sum')
  }
  numerator.append(renderFractionPart(node.operands[0], 'numerator', numeratorContext))
  const denominatorNode = node.operands[1]
  denominator.append(renderFractionPart(denominatorNode, 'denominator', denominatorContext))
  fraction.append(numerator, denominator)
  return fraction
}

function renderPlainProduct(node: Node & { kind: 'mul' }): HTMLElement {
  const product = element('span', 'product-node')
  node.operands.forEach((factor, index) => {
    if (index > 0) {
      const token = element('span', 'inline-operator multiply-token')
      token.textContent = '·'
      product.append(token)
    }
    product.append(
      factor.kind === 'num'
        ? numberChip(factor.value, index > 0)
        : withParentheses(factor, renderNode(factor)),
    )
  })
  return product
}

function withParentheses(factor: Node, rendered: HTMLElement): HTMLElement {
  if (!isOp(factor, 'add') || factor.operands.length < 2) return rendered
  const group = element('span', 'parenthesized')
  group.append('(', rendered, ')')
  return group
}
