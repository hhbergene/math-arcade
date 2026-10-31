import { strings } from '../strings'
import { cloneEquation, cloneNode, isOp, num, op, type Node, type OpNode } from '../model/node'
import { prettyPrint } from '../model/prettyPrint'
import { Equation } from '../model/equation'
import { simplifyEquation } from './simplify'
import { mergeAllLikeTerms, mergeTermsAt } from './merge'

type Side = 'left' | 'right'
type Factor = { kind: 'num'; value: number } | { kind: 'var'; value: string }

function save(equation: Equation): void {
  equation.history.save(equation)
}

function record(equation: Equation, message: string): void {
  equation.history.record(equation, message)
}

function flattenMultiply(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => (isOp(node, 'mul') ? node.operands : [node]))
}

function multiplyExpression(expression: OpNode, factor: Factor): OpNode {
  return op(
    'add',
    expression.operands.map((term) => op('mul', flattenMultiply([cloneNode(term), cloneNode(factor)]))),
  )
}

function factorText(factor: Factor): string {
  return String(factor.value)
}

export function multiplyAll(equation: Equation, value: number): void {
  if (!Number.isInteger(value)) throw new Error(strings.invalidK)
  if (value === 0) throw new Error(strings.multiplyByZero)
  save(equation)
  equation.left = multiplyExpression(equation.left, { kind: 'num', value })
  equation.right = multiplyExpression(equation.right, { kind: 'num', value })
  simplifyEquation(equation)
  record(equation, strings.multiplyAll.replace('{f}', factorText({ kind: 'num', value })))
}

export function divideAll(equation: Equation, value: number): void {
  if (!Number.isInteger(value)) throw new Error(strings.invalidK)
  if (value === 0) throw new Error(strings.divideByZero)
  save(equation)
  const divisor = num(value)
  for (const side of [equation.left, equation.right]) {
    side.operands = side.operands.map((term) => {
      if (value === -1) return op('mul', [num(-1), cloneNode(term)])
      if (isOp(term, 'div') && term.operands.length === 2) {
        const denominator = term.operands[1]
        return op('div', [cloneNode(term.operands[0]), op('mul', flattenMultiply([cloneNode(denominator), divisor]))])
      }
      return op('div', [cloneNode(term), num(value)])
    })
  }
  simplifyEquation(equation)
  record(equation, strings.divideAll.replace('{f}', String(value)))
}

export function addTermBoth(equation: Equation, coefficient: number, isX = false): void {
  if (!Number.isInteger(coefficient)) throw new Error(strings.invalidK)
  if (!isX && coefficient === 0) return

  const makeTerm = (): Node =>
    isX
      ? coefficient === 1
        ? { kind: 'var', value: 'x' }
        : op('mul', [num(coefficient), { kind: 'var', value: 'x' }])
      : num(coefficient)
  save(equation)
  equation.left.operands.push(makeTerm())
  equation.right.operands.push(makeTerm())
  simplifyEquation(equation)

  const value = isX
    ? coefficient === 1
      ? 'x'
      : coefficient === -1
        ? '-x'
        : `${coefficient}x`
    : String(coefficient)
  record(equation, strings.addBoth.replace('{val}', value))
}

function negate(node: Node): Node {
  if (node.kind === 'num') return num(-node.value)
  if (isOp(node, 'mul')) {
    const operands = node.operands.map(cloneNode)
    const index = operands.findIndex((child) => child.kind === 'num')
    if (index >= 0) {
      const coefficient = operands[index]
      if (coefficient.kind === 'num') operands[index] = num(-coefficient.value)
      return op('mul', operands)
    }
  }
  if (isOp(node, 'div') && node.operands.length === 2) {
    return op('div', [negate(node.operands[0]), cloneNode(node.operands[1])])
  }
  return op('mul', [num(-1), cloneNode(node)])
}

export function moveOperandBetweenSides(
  equation: Equation,
  source: Side,
  operandIndex: number,
): void {
  const sourceSide = source === 'left' ? equation.left : equation.right
  const destination = source === 'left' ? equation.right : equation.left
  if (!Number.isInteger(operandIndex) || operandIndex < 0 || operandIndex >= sourceSide.operands.length) {
    throw new Error('Leddet finnes ikke på denne siden av likningen.')
  }
  save(equation)
  const [moved] = sourceSide.operands.splice(operandIndex, 1)
  if (sourceSide.operands.length === 0) sourceSide.operands.push(num(0))
  destination.operands.push(negate(moved))
  simplifyEquation(equation)
  record(equation, strings.moveTerm.replace('{str}', prettyPrint(moved)))
}

export function swapSides(equation: Equation): void {
  save(equation)
  ;[equation.left, equation.right] = [equation.right, equation.left]
  record(equation, strings.swap)
}

export function extendFraction(
  equation: Equation,
  side: Side,
  operandIndex: number,
  multiplier: number,
): void {
  if (!Number.isInteger(multiplier) || multiplier <= 0) throw new Error(strings.invalidK)
  const expression = side === 'left' ? equation.left : equation.right
  const target = expression.operands[operandIndex]
  if (!isOp(target, 'div') || target.operands.length !== 2) {
    throw new Error('Velg et brøkledd som skal utvides.')
  }
  save(equation)
  expression.operands[operandIndex] = op('div', [
    op('mul', flattenMultiply([cloneNode(target.operands[0]), num(multiplier)])),
    op('mul', flattenMultiply([cloneNode(target.operands[1]), num(multiplier)])),
  ])
  record(equation, strings.extendHistory)
}

export function mergeEquationTerms(
  equation: Equation,
  side: Side,
  first: number,
  second: number,
): boolean {
  const target = side === 'left' ? equation.left : equation.right
  const before = cloneEquation(equation)
  if (!mergeTermsAt(target, first, second)) return false
  simplifyEquation(equation)
  equation.history.save(before)
  record(equation, strings.mergeTerms)
  return true
}

function nodeAtPath(root: Node, path: number[]): Node {
  let node = root
  for (const index of path) {
    if (!isOp(node) || index < 0 || index >= node.operands.length) {
      throw new Error(strings.numericFactorsOnly)
    }
    node = node.operands[index]
  }
  return node
}

function replaceNodeAtPath(root: Node, path: number[], replacement: Node): void {
  const parent = nodeAtPath(root, path.slice(0, -1))
  const index = path[path.length - 1]
  if (!isOp(parent) || index === undefined || index < 0 || index >= parent.operands.length) {
    throw new Error(strings.selectCommonFactor)
  }
  parent.operands[index] = replacement
}

function commonFactor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

export function cancelFractionFactors(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): void {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term) throw new Error(strings.selectCommonFactor)
  const fraction = nodeAtPath(term, fractionPath)
  if (!isOp(fraction, 'div') || fraction.operands.length !== 2) {
    throw new Error(strings.selectCommonFactor)
  }

  const isPartPath = (path: number[], part: number): boolean =>
    path.length > fractionPath.length &&
    fractionPath.every((index, pathIndex) => path[pathIndex] === index) &&
    path[fractionPath.length] === part
  if (!isPartPath(numeratorPath, 0) || !isPartPath(denominatorPath, 1)) {
    throw new Error(strings.selectCommonFactor)
  }

  const numeratorFactor = nodeAtPath(term, numeratorPath)
  const denominatorFactor = nodeAtPath(term, denominatorPath)
  if (
    numeratorFactor.kind !== 'num' ||
    denominatorFactor.kind !== 'num' ||
    !Number.isInteger(numeratorFactor.value) ||
    !Number.isInteger(denominatorFactor.value)
  ) {
    throw new Error(strings.selectCommonFactor)
  }
  if (denominatorFactor.value === 0) throw new Error(strings.divideByZero)
  const divisor = commonFactor(numeratorFactor.value, denominatorFactor.value)
  if (divisor < 2) throw new Error(strings.noCommonFactor)

  const before = cloneEquation(equation)
  replaceNodeAtPath(term, numeratorPath, num(numeratorFactor.value / divisor))
  replaceNodeAtPath(term, denominatorPath, num(denominatorFactor.value / divisor))
  simplifyEquation(equation)
  equation.history.save(before)
  record(equation, strings.cancelFraction.replace('{f}', String(divisor)))
}

export function multiplyFactors(
  equation: Equation,
  side: Side,
  termIndex: number,
  parentPath: number[],
  firstFactor: number,
  secondFactor: number,
): void {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term || firstFactor === secondFactor) throw new Error(strings.numericFactorsOnly)
  const parent = nodeAtPath(term, parentPath)
  if (!isOp(parent, 'mul')) throw new Error(strings.numericFactorsOnly)

  const first = parent.operands[firstFactor]
  const second = parent.operands[secondFactor]
  if (first?.kind !== 'num' || second?.kind !== 'num') {
    throw new Error(strings.numericFactorsOnly)
  }

  const before = cloneEquation(equation)
  const leftIndex = Math.min(firstFactor, secondFactor)
  const rightIndex = Math.max(firstFactor, secondFactor)
  parent.operands[leftIndex] = num(first.value * second.value)
  parent.operands.splice(rightIndex, 1)
  simplifyEquation(equation)
  equation.history.save(before)
  record(
    equation,
    strings.multiplyFactors
      .replace('{a}', String(first.value))
      .replace('{b}', String(second.value)),
  )
}

function selectedFactor(
  equation: Equation,
  side: Side,
  termIndex: number,
  factorPath: number[],
  displayedValue?: number,
): Node & { kind: 'num' } {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term) throw new Error(strings.selectDenominatorFactor)
  const factor = nodeAtPath(term, factorPath)
  if (factor.kind !== 'num' || !Number.isInteger(factor.value)) {
    throw new Error(strings.selectDenominatorFactor)
  }
  // A chip may show |value| when the term's minus is drawn as an operator.
  if (displayedValue !== undefined && Math.abs(displayedValue) === Math.abs(factor.value)) {
    return num(displayedValue) as Node & { kind: 'num' }
  }
  return factor
}

export function divideAllBySelectedFactor(
  equation: Equation,
  side: Side,
  termIndex: number,
  factorPath: number[],
  displayedValue?: number,
): void {
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(strings.divideByZero)

  save(equation)
  for (const equationSide of [equation.left, equation.right]) {
    const onlyTerm = equationSide.operands.length === 1 ? equationSide.operands[0] : undefined
    if (onlyTerm && isOp(onlyTerm, 'div') && onlyTerm.operands.length === 2) {
      onlyTerm.operands[1] = op(
        'mul',
        flattenMultiply([cloneNode(onlyTerm.operands[1]), cloneNode(factor)]),
      )
    } else {
      equationSide.operands = [
        op('div', [cloneNode(onlyTerm ?? equationSide), cloneNode(factor)]),
      ]
    }
  }
  record(equation, strings.divideAll.replace('{f}', String(factor.value)))
}

export function multiplyAllBySelectedFactor(
  equation: Equation,
  side: Side,
  termIndex: number,
  factorPath: number[],
  displayedValue?: number,
): void {
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(strings.multiplyByZero)

  save(equation)
  for (const equationSide of [equation.left, equation.right]) {
    equationSide.operands = equationSide.operands.map((operand) => {
      if (isOp(operand, 'div') && operand.operands.length === 2) {
        return op('div', [
          op('mul', flattenMultiply([cloneNode(factor), cloneNode(operand.operands[0])])),
          cloneNode(operand.operands[1]),
        ])
      }
      return op('mul', flattenMultiply([cloneNode(factor), cloneNode(operand)]))
    })
  }
  record(equation, strings.multiplyAll.replace('{f}', String(factor.value)))
}

function isInDenominator(term: Node, factorPath: number[]): boolean {
  let node = term
  for (const index of factorPath) {
    if (isOp(node, 'div') && index === 1) return true
    if (!isOp(node)) return false
    node = node.operands[index]
  }
  return false
}

function tidyAfterRemoval(node: Node): Node {
  if (!isOp(node)) return node
  const operands = node.operands.map(tidyAfterRemoval)
  if (node.kind === 'mul') {
    const factors = flattenMultiply(operands)
    const withoutOnes = factors.filter((factor) => !(factor.kind === 'num' && factor.value === 1))
    const kept = withoutOnes.length > 0 ? withoutOnes : [num(1)]
    return kept.length === 1 ? kept[0] : op('mul', kept)
  }
  if (node.kind === 'div' && operands.length === 2) {
    const [numerator, denominator] = operands
    if (denominator.kind === 'num' && denominator.value === 1) return numerator
  }
  return op(node.kind, operands)
}

function removeFactor(term: Node, factorPath: number[], factor: Node & { kind: 'num' }): Node {
  const stored = nodeAtPath(term, factorPath)
  if (stored.kind !== 'num') throw new Error(strings.selectDenominatorFactor)
  // What remains when the displayed factor is taken out: 1, or -1 if the chip hid a minus.
  const remainder = num(stored.value / factor.value)
  if (factorPath.length === 0) return remainder
  const copy = cloneNode(term)
  replaceNodeAtPath(copy, factorPath, remainder)
  return tidyAfterRemoval(copy)
}

function divideSide(expression: OpNode, factor: Node): void {
  const onlyTerm = expression.operands.length === 1 ? expression.operands[0] : undefined
  if (onlyTerm && isOp(onlyTerm, 'div') && onlyTerm.operands.length === 2) {
    onlyTerm.operands[1] = op('mul', flattenMultiply([cloneNode(onlyTerm.operands[1]), cloneNode(factor)]))
    return
  }
  expression.operands = [op('div', [cloneNode(onlyTerm ?? expression), cloneNode(factor)])]
}

function multiplySide(expression: OpNode, factor: Node): void {
  const onlyTerm = expression.operands.length === 1 ? expression.operands[0] : undefined
  if (onlyTerm && isOp(onlyTerm, 'div') && onlyTerm.operands.length === 2) {
    onlyTerm.operands[0] = op('mul', flattenMultiply([cloneNode(onlyTerm.operands[0]), cloneNode(factor)]))
    return
  }
  expression.operands = [op('mul', flattenMultiply([cloneNode(onlyTerm ?? expression), cloneNode(factor)]))]
}

/**
 * Drag a factor across "=": it is cancelled on its own side and appears on the other side,
 * e.g. 2x = 4 → x = 4/2 and x/2 = 1 → x = 1 · 2. Needs a single term on the source side;
 * otherwise both whole sides are divided/multiplied with the factor kept visible.
 */
export function moveFactorAcrossEquals(
  equation: Equation,
  side: Side,
  termIndex: number,
  factorPath: number[],
  displayedValue?: number,
): void {
  const source = side === 'left' ? equation.left : equation.right
  const target = side === 'left' ? equation.right : equation.left
  const term = source.operands[termIndex]
  if (!term) throw new Error(strings.selectDenominatorFactor)
  const fromDenominator = isInDenominator(term, factorPath)
  if (source.operands.length !== 1) {
    if (fromDenominator) multiplyAllBySelectedFactor(equation, side, termIndex, factorPath, displayedValue)
    else divideAllBySelectedFactor(equation, side, termIndex, factorPath, displayedValue)
    return
  }
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(fromDenominator ? strings.multiplyByZero : strings.divideByZero)

  save(equation)
  source.operands = [removeFactor(term, factorPath, factor)]
  if (fromDenominator) multiplySide(target, factor)
  else divideSide(target, factor)
  record(
    equation,
    (fromDenominator ? strings.multiplyAll : strings.divideAll).replace('{f}', String(factor.value)),
  )
}

export function mergeAll(equation: Equation): number {
  const before = cloneEquation(equation)
  const count = mergeAllLikeTerms(equation)
  if (count > 0) {
    equation.history.save(before)
    record(equation, 'Slo sammen like ledd')
  }
  return count
}
