import { isOp, type Node } from '../model/node'
import { nodeSign, positiveForDisplay } from '../model/prettyPrint'

type RenderContext = {
  side: 'left' | 'right'
  termIndex: number
  path: number[]
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

/** A leading term like -3·x or 2·(-3)·x keeps its minus inside the number chip. */
export function keepsSignInFirstFactor(term: Node): boolean {
  if (term.kind === 'num') return term.value < 0
  if (!isOp(term, 'mul')) return false
  return term.operands.some((factor) => factor.kind === 'num' && factor.value < 0 && factor.value !== -1)
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
      if (canMultiply) {
        token.setAttribute('type', 'button')
        token.setAttribute('aria-label', 'Gang sammen nabofaktorene')
        token.dataset.side = context.side
        token.dataset.termIndex = String(context.termIndex)
        token.dataset.parentPath = JSON.stringify(context.path)
        token.dataset.leftFactor = String(index - 1)
        token.dataset.rightFactor = String(index)
      }
      token.textContent = '·'
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
        fraction
          ? `Tallfaktor ${shown} i ${fraction.part === 'numerator' ? 'telleren' : 'nevneren'}; dra til en faktor på motsatt side av brøkstreken for å forkorte`
          : denominatorFactors
          ? `Tallfaktor ${shown} i nevneren`
          : `Tallfaktor ${shown}; dra til en annen faktor for å gange eller til nevneren for å dele`,
      )
    }
    wrapper.append(
      factor.kind === 'num'
        ? numberChip(factor.value, index > 0)
        : withParentheses(factor, renderNode(factor, {
          ...context,
          path: [...context.path, index],
        })),
    )
    product.append(wrapper)
  })
  return product
}

function numberChip(value: number, parenthesizeNegative = false): HTMLElement {
  const chip = element('span', 'factor-chip')
  chip.textContent = numberText(value, parenthesizeNegative)
  return chip
}

export function renderNode(node: Node, context?: RenderContext): HTMLElement {
  if (node.kind === 'num') return numberChip(node.value)
  if (node.kind === 'var') {
    const chip = element('span', 'factor-chip variable-chip')
    chip.textContent = String(node.value)
    return chip
  }

  if (isOp(node, 'add')) {
    const addition = element('span', 'nested-addition')
    node.operands.forEach((term, index) => {
      const ownSign = index === 0 && keepsSignInFirstFactor(term)
      const sign = ownSign ? 1 : nodeSign(term)
      if (index > 0 || sign === -1) {
        const token = element('span', 'inline-operator')
        token.textContent = sign === -1 ? '−' : '+'
        addition.append(token)
      }
      const body = element('span', 'nested-term')
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
        `Tallfaktor ${numberText(partNode.value)} i ${part === 'numerator' ? 'telleren' : 'nevneren'}; dra til en faktor på motsatt side av brøkstreken for å forkorte`,
      )
      factor.append(renderNode(partNode))
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
    const multiplyTarget = element('span', 'multiply-drop-target')
    multiplyTarget.dataset.side = context.side
    multiplyTarget.dataset.termIndex = String(context.termIndex)
    multiplyTarget.dataset.fractionPath = JSON.stringify(fractionPath)
    multiplyTarget.setAttribute('aria-label', 'Slipp her for å gange begge sider med faktoren')
    numerator.append(multiplyTarget)
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
