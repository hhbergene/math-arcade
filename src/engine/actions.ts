import { strings } from '../strings'
import { cloneEquation, cloneNode, isOp, isZeroSide, num, op, type Node, type OpNode } from '../model/node'
import { prettyPrint } from '../model/prettyPrint'
import { Equation } from '../model/equation'
import { simplify, simplifyEquation } from './simplify'
import { mergeAllLikeTerms, mergeTermsAt } from './merge'

type Side = 'left' | 'right'
type FactorPlacement = 'before' | 'after'
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

function exposedTerms(node: Node): Node[] {
  return isOp(node, 'add') ? node.operands.flatMap(exposedTerms) : [node]
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

export function negate(node: Node): Node {
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

export function moveOperandToPosition(
  equation: Equation,
  source: Side,
  operandIndex: number,
  destination: Side,
  destinationIndex: number,
  mergeTargetIndex?: number,
): boolean {
  const sourceSide = source === 'left' ? equation.left : equation.right
  const destinationSide = destination === 'left' ? equation.left : equation.right
  if (!Number.isInteger(operandIndex) || operandIndex < 0 || operandIndex >= sourceSide.operands.length) {
    throw new Error('Leddet finnes ikke på denne siden av likningen.')
  }

  const sameSide = source === destination
  const remainingLength = destinationSide.operands.length - (sameSide ? 1 : 0)
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0 ||
    destinationIndex > remainingLength) {
    throw new Error(strings.incompatibleTerms)
  }
  if (mergeTargetIndex !== undefined &&
    (!Number.isInteger(mergeTargetIndex) || mergeTargetIndex < 0 ||
      mergeTargetIndex >= destinationSide.operands.length ||
      (sameSide && mergeTargetIndex === operandIndex))) {
    throw new Error(strings.incompatibleTerms)
  }
  if (sameSide && destinationIndex === operandIndex && mergeTargetIndex === undefined) return false
  const before = cloneEquation(equation)
  if (!sameSide && isZeroSide(destinationSide)) {
    destinationSide.operands.length = 0
    destinationIndex = 0
    mergeTargetIndex = undefined
  }
  const [moved] = sourceSide.operands.splice(operandIndex, 1)
  if (!sameSide && sourceSide.operands.length === 0) sourceSide.operands.push(num(0))
  destinationSide.operands.splice(destinationIndex, 0, sameSide ? moved! : negate(moved!))
  const targetAfterRemoval = mergeTargetIndex === undefined ? undefined
    : mergeTargetIndex - (sameSide && mergeTargetIndex > operandIndex ? 1 : 0)
  const targetAfterInsertion = targetAfterRemoval === undefined ? undefined
    : targetAfterRemoval + (targetAfterRemoval >= destinationIndex ? 1 : 0)
  const merged = targetAfterInsertion !== undefined &&
    mergeTermsAt(destinationSide, destinationIndex, targetAfterInsertion)
  if (sameSide && destinationIndex === operandIndex && !merged) return false
  equation.history.save(before)
  record(
    equation,
    merged
      ? strings.moveAndMergeTerm
      : sameSide ? strings.reorderTerm : strings.moveTerm.replace('{str}', prettyPrint(moved!)),
  )
  return true
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
  if (!target || !isOp(target, 'div') || target.operands.length !== 2) {
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
  simplifyResult = true,
): boolean {
  const target = side === 'left' ? equation.left : equation.right
  const before = cloneEquation(equation)
  if (!mergeTermsAt(target, first, second)) return false
  if (simplifyResult) simplifyEquation(equation)
  equation.history.save(before)
  record(equation, strings.mergeTerms)
  return true
}

function areAdjacentOperands(operands: Node[], first: number, second: number): boolean {
  return Number.isInteger(first) &&
    Number.isInteger(second) &&
    Math.abs(first - second) === 1 &&
    first >= 0 &&
    second >= 0 &&
    first < operands.length &&
    second < operands.length
}

function swapAdjacentOperands(operands: Node[], first: number, second: number): void {
  ;[operands[first], operands[second]] = [operands[second]!, operands[first]!]
}

export function swapEquationTerms(
  equation: Equation,
  side: Side,
  first: number,
  second: number,
): boolean {
  const expression = side === 'left' ? equation.left : equation.right
  if (!areAdjacentOperands(expression.operands, first, second)) return false
  const before = cloneEquation(equation)
  swapAdjacentOperands(expression.operands, first, second)
  equation.history.save(before)
  record(equation, strings.swapTerms)
  return true
}

function nodeAtPath(root: Node, path: number[]): Node {
  let node = root
  for (const index of path) {
    if (node.kind === 'num' && node.value < 0 && index === 0) {
      node = num(-1)
      continue
    }
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
  if (parent.kind === 'num' && parent.value < 0 && index === 0 && replacement.kind === 'num') {
    parent.value = Math.abs(parent.value) * replacement.value
    return
  }
  if (!isOp(parent) || index === undefined || index < 0 || index >= parent.operands.length) {
    throw new Error(strings.selectCommonFactor)
  }
  parent.operands[index] = replacement
}

export function mergeNestedTerms(
  equation: Equation,
  side: Side,
  termIndex: number,
  sumPath: number[],
  first: number,
  second: number,
): boolean {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term) throw new Error(strings.incompatibleTerms)
  const sum = nodeAtPath(term, sumPath)
  if (!isOp(sum, 'add')) throw new Error(strings.incompatibleTerms)
  const copy = cloneNode(sum)
  if (!isOp(copy, 'add') || !mergeTermsAt(copy, first, second)) return false
  save(equation)
  const replacement = copy.operands.length === 1 ? copy.operands[0] : copy
  if (sumPath.length === 0) expression.operands[termIndex] = replacement
  else replaceNodeAtPath(term, sumPath, replacement)
  record(equation, strings.mergeTerms)
  return true
}

export function swapNestedTerms(
  equation: Equation,
  side: Side,
  termIndex: number,
  sumPath: number[],
  first: number,
  second: number,
): boolean {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term) return false
  const sum = nodeAtPath(term, sumPath)
  if (!isOp(sum, 'add') || !areAdjacentOperands(sum.operands, first, second)) return false
  const before = cloneEquation(equation)
  swapAdjacentOperands(sum.operands, first, second)
  equation.history.save(before)
  record(equation, strings.swapTerms)
  return true
}

function commonFactor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) [a, b] = [b, a % b]
  return left < 0 && right < 0 ? -a : a
}

export function canEvaluateNegativeUnitFraction(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): boolean {
  const term = equation[side].operands[termIndex]
  if (!term) throw new Error(strings.selectCommonFactor)
  const fraction = nodeAtPath(term, fractionPath)
  if (!isOp(fraction, 'div') || fraction.operands.length !== 2 ||
    fraction.operands[1].kind !== 'num' || fraction.operands[1].value !== -1 ||
    JSON.stringify(denominatorPath) !== JSON.stringify([...fractionPath, 1])) return false
  const numerator = fraction.operands[0]
  if (numerator.kind === 'num') {
    return JSON.stringify(numeratorPath) === JSON.stringify([...fractionPath, 0])
  }
  return isOp(numerator, 'mul') && numerator.operands.length === 2 &&
    numerator.operands[0].kind === 'num' && numerator.operands[0].value === -1 &&
    numerator.operands[1].kind === 'var' &&
    JSON.stringify(numeratorPath) === JSON.stringify([...fractionPath, 0, 0])
}

export function evaluateNegativeUnitFraction(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): void {
  if (!canEvaluateNegativeUnitFraction(equation, side, termIndex, fractionPath, numeratorPath, denominatorPath)) {
    throw new Error(strings.selectCommonFactor)
  }
  const term = equation[side].operands[termIndex]
  const fraction = nodeAtPath(term, fractionPath)
  if (!isOp(fraction, 'div')) {
    throw new Error(strings.selectCommonFactor)
  }
  const numerator = fraction.operands[0]
  const result = numerator.kind === 'num' ? num(-numerator.value) : tidyAfterRemoval(negate(numerator))
  const expressionText = prettyPrint(fraction)
  save(equation)
  if (fractionPath.length === 0) equation[side].operands[termIndex] = result
  else replaceNodeAtPath(term, fractionPath, result)
  record(equation, `Regnet ut ${expressionText} = ${prettyPrint(result)}`)
}

export function canCancelFractionFactors(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): boolean {
  const term = (side === 'left' ? equation.left : equation.right).operands[termIndex]
  if (!term) throw new Error(strings.selectCommonFactor)
  const fraction = nodeAtPath(term, fractionPath)
  if (!isOp(fraction, 'div') || fraction.operands.length !== 2) return false
  const directFactor = (path: number[], part: number): boolean => {
    if (path[fractionPath.length] !== part ||
      !fractionPath.every((index, i) => path[i] === index)) return false
    let node = fraction.operands[part]
    for (const index of path.slice(fractionPath.length + 1)) {
      if (node.kind === 'num' && node.value < 0 && index === 0) {
        node = num(-1)
        continue
      }
      if (!isOp(node, 'mul')) return false
      node = node.operands[index]
      if (!node) return false
    }
    return node.kind === 'num'
  }
  if (!directFactor(numeratorPath, 0) || !directFactor(denominatorPath, 1)) return false
  const numerator = nodeAtPath(term, numeratorPath)
  const denominator = nodeAtPath(term, denominatorPath)
  return numerator.kind === 'num' && denominator.kind === 'num' &&
    Number.isInteger(numerator.value) && Number.isInteger(denominator.value) &&
    denominator.value !== 0 &&
    (Math.abs(commonFactor(numerator.value, denominator.value)) > 1 ||
      (numerator.value === -1 && denominator.value === -1))
}

export function cancelFractionFactors(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): void {
  cancelFractionFactorsInternal(
    equation,
    side,
    termIndex,
    fractionPath,
    numeratorPath,
    denominatorPath,
    true,
  )
}

export type FractionCancellation = {
  side: Side
  termIndex: number
  fractionPath: number[]
  numeratorPath: number[]
  denominatorPath: number[]
  numeratorOriginal: number
  denominatorOriginal: number
  numeratorReduced: number
  denominatorReduced: number
}

export function finishFractionCancellations(
  equation: Equation,
  cancellations: readonly FractionCancellation[],
  side?: Side,
): FractionCancellation[] {
  return completeFractionCancellations(equation, cancellations, side, true)
}

function completeFractionCancellations(
  equation: Equation,
  cancellations: readonly FractionCancellation[],
  side: Side | undefined,
  recordHistory: boolean,
): FractionCancellation[] {
  const selected = cancellations.filter((cancellation) => !side || cancellation.side === side)
  if (selected.length === 0) return [...cancellations]
  const replacements = new Map<Side, Map<number, Node>>()
  for (const currentSide of ['left', 'right'] as const) {
    const expression = currentSide === 'left' ? equation.left : equation.right
    const terms = new Map<number, Node>()
    for (const cancellation of selected.filter((item) => item.side === currentSide)) {
      if (terms.has(cancellation.termIndex)) continue
      const term = expression.operands[cancellation.termIndex]
      if (!term) throw new Error(strings.selectCommonFactor)
      const paths = selected.filter((item) => item.side === currentSide &&
        item.termIndex === cancellation.termIndex).flatMap((item) => [item.numeratorPath, item.denominatorPath])
      const selectedPaths = new Set(paths.map((path) => JSON.stringify(path)))
      const cleanup = (node: Node, path: number[]): { node: Node; touched: boolean } => {
        if (!isOp(node)) return { node, touched: selectedPaths.has(JSON.stringify(path)) }
        const children = node.operands.map((child, index) => cleanup(child, [...path, index]))
        const touched = children.some((child) => child.touched)
        if (!touched) return { node, touched: false }
        if (node.kind === 'mul') {
          const kept = children.filter((child) => !(child.touched && child.node.kind === 'num' && child.node.value === 1))
            .map((child) => child.node)
          return { node: kept.length === 0 ? num(1) : kept.length === 1 ? kept[0] : op('mul', kept), touched }
        }
        if (node.kind === 'div' && children.length === 2 && children[1].touched &&
          children[1].node.kind === 'num' && children[1].node.value === 1) {
          return { node: children[0].node, touched }
        }
        if (node.kind === 'div' && children.length === 2 && children[1].touched &&
          children[1].node.kind === 'num' && children[1].node.value === -1 &&
          children[0].node.kind === 'num') {
          return { node: num(-children[0].node.value), touched }
        }
        return { node: op(node.kind, children.map((child) => child.node)), touched }
      }
      terms.set(cancellation.termIndex, cleanup(term, []).node)
    }
    replacements.set(currentSide, terms)
  }
  if (recordHistory) save(equation)
  for (const [currentSide, terms] of replacements) {
    const expression = currentSide === 'left' ? equation.left : equation.right
    expression.operands = expression.operands.flatMap((node, index) => {
      const replacement = terms.get(index)
      return replacement ? exposedTerms(replacement) : [node]
    })
  }
  if (recordHistory) record(equation, strings.finishCancellation)
  return cancellations.filter((cancellation) => side && cancellation.side !== side)
}

export function showFractionCancellation(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
): FractionCancellation {
  return cancelFractionFactorsInternal(
    equation,
    side,
    termIndex,
    fractionPath,
    numeratorPath,
    denominatorPath,
    false,
  )
}

function cancelFractionFactorsInternal(
  equation: Equation,
  side: Side,
  termIndex: number,
  fractionPath: number[],
  numeratorPath: number[],
  denominatorPath: number[],
  simplify: boolean,
): FractionCancellation {
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
  if (divisor !== -1 && Math.abs(divisor) < 2) throw new Error(strings.noCommonFactor)
  if (!canCancelFractionFactors(equation, side, termIndex, fractionPath, numeratorPath, denominatorPath)) {
    throw new Error(strings.selectCommonFactor)
  }

  const before = cloneEquation(equation)
  const numeratorReduced = numeratorFactor.value / divisor
  const denominatorReduced = denominatorFactor.value / divisor
  replaceNodeAtPath(term, numeratorPath, num(numeratorReduced))
  replaceNodeAtPath(term, denominatorPath, num(denominatorReduced))
  equation.history.save(before)
  const cancellation: FractionCancellation = {
    side,
    termIndex,
    fractionPath: [...fractionPath],
    numeratorPath: [...numeratorPath],
    denominatorPath: [...denominatorPath],
    numeratorOriginal: numeratorFactor.value,
    denominatorOriginal: denominatorFactor.value,
    numeratorReduced,
    denominatorReduced,
  }
  if (simplify) completeFractionCancellations(equation, [cancellation], undefined, false)
  record(equation, strings.cancelFraction.replace('{f}', String(divisor)))
  return cancellation
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

export function distributeFactor(
  equation: Equation,
  side: Side,
  termIndex: number,
  parentPath: number[],
  factorIndex: number,
  sumIndex: number,
  placement: FactorPlacement = 'before',
  evaluateProducts = true,
): void {
  const term = equation[side].operands[termIndex]
  if (!term) throw new Error(strings.numericFactorsOnly)
  const product = nodeAtPath(term, parentPath)
  if (!isOp(product, 'mul') || factorIndex === sumIndex) throw new Error(strings.numericFactorsOnly)
  const factor = product.operands[factorIndex]
  const sum = product.operands[sumIndex]
  if (factor?.kind !== 'num' || !sum || !isOp(sum, 'add')) throw new Error(strings.numericFactorsOnly)
  const before = cloneEquation(equation)
  const expanded = op('add', sum.operands.map((operand) => {
    const multiplied = op('mul', flattenMultiply(placement === 'before'
      ? [cloneNode(factor), cloneNode(operand)]
      : [cloneNode(operand), cloneNode(factor)]))
    return evaluateProducts ? simplify(multiplied) : multiplied
  }))
  product.operands[sumIndex] = expanded
  product.operands.splice(factorIndex, 1)
  const replacement = product.operands.length === 1 ? product.operands[0] : product
  if (parentPath.length === 0) {
    equation[side].operands.splice(termIndex, 1, ...exposedTerms(replacement))
  } else {
    replaceNodeAtPath(term, parentPath, replacement)
  }
  equation.history.save(before)
  record(equation, `Ganget ${prettyPrint(factor)} inn i parentesen`)
}

export function swapFactors(
  equation: Equation,
  side: Side,
  termIndex: number,
  parentPath: number[],
  firstFactor: number,
  secondFactor: number,
): boolean {
  const expression = side === 'left' ? equation.left : equation.right
  const term = expression.operands[termIndex]
  if (!term) return false
  const parent = nodeAtPath(term, parentPath)
  if (!isOp(parent, 'mul') || !areAdjacentOperands(parent.operands, firstFactor, secondFactor)) return false
  const before = cloneEquation(equation)
  swapAdjacentOperands(parent.operands, firstFactor, secondFactor)
  equation.history.save(before)
  record(equation, strings.swapFactors)
  return true
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
  // A negative number exposes a virtual leading -1 factor without changing the stored term.
  if (term.kind === 'num' && term.value < 0 && factorPath.length === 1 && factorPath[0] === 0) {
    return num(-1)
  }
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
  placement: FactorPlacement = 'after',
  oppositePlacement: FactorPlacement = 'after',
): void {
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(strings.divideByZero)

  save(equation)
  for (const equationSide of [equation.left, equation.right]) {
    divideSide(equationSide, factor,
      equationSide === (side === 'left' ? equation.left : equation.right) ? placement : oppositePlacement)
  }
  record(equation, strings.divideAll.replace('{f}', String(factor.value)))
}

export function multiplyAllBySelectedFactor(
  equation: Equation,
  side: Side,
  termIndex: number,
  factorPath: number[],
  displayedValue?: number,
  placement: FactorPlacement = 'before',
  oppositePlacement: FactorPlacement = 'before',
): void {
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(strings.multiplyByZero)

  save(equation)
  for (const equationSide of [equation.left, equation.right]) {
    const sidePlacement = equationSide === (side === 'left' ? equation.left : equation.right)
      ? placement
      : oppositePlacement
    const product = (operand: Node): Node => op('mul', flattenMultiply(
      sidePlacement === 'before'
        ? [cloneNode(factor), cloneNode(operand)]
        : [cloneNode(operand), cloneNode(factor)],
    ))
    equationSide.operands = equationSide.operands.map((operand) => {
      if (isOp(operand, 'div') && operand.operands.length === 2) {
        return op('div', [
          product(operand.operands[0]),
          cloneNode(operand.operands[1]),
        ])
      }
      return product(operand)
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
  if (factorPath.length > 1 && factorPath[factorPath.length - 1] === 0 && factor.value === -1) {
    const parentPath = factorPath.slice(0, -1)
    const parent = nodeAtPath(term, parentPath)
    if (parent.kind === 'num' && parent.value < 0) {
      const copy = cloneNode(term)
      replaceNodeAtPath(copy, parentPath, num(-parent.value))
      return tidyAfterRemoval(copy)
    }
  }
  if (term.kind === 'num' && term.value < 0 && factorPath.length === 1 && factorPath[0] === 0 &&
    factor.value === -1) {
    return num(-term.value)
  }
  const stored = nodeAtPath(term, factorPath)
  if (stored.kind !== 'num') throw new Error(strings.selectDenominatorFactor)
  // What remains when the displayed factor is taken out: 1, or -1 if the chip hid a minus.
  const remainder = num(stored.value / factor.value)
  if (factorPath.length === 0) return remainder
  const copy = cloneNode(term)
  replaceNodeAtPath(copy, factorPath, remainder)
  return tidyAfterRemoval(copy)
}

function divideSide(expression: OpNode, factor: Node, placement: FactorPlacement = 'after'): void {
  const onlyTerm = expression.operands.length === 1 ? expression.operands[0] : undefined
  if (onlyTerm && isOp(onlyTerm, 'div') && onlyTerm.operands.length === 2) {
    onlyTerm.operands[1] = op('mul', flattenMultiply(placement === 'before'
      ? [cloneNode(factor), cloneNode(onlyTerm.operands[1])]
      : [cloneNode(onlyTerm.operands[1]), cloneNode(factor)]))
    return
  }
  expression.operands = [op('div', [cloneNode(onlyTerm ?? expression), cloneNode(factor)])]
}

function multiplySide(expression: OpNode, factor: Node, placement: FactorPlacement): void {
  const onlyTerm = expression.operands.length === 1 ? expression.operands[0] : undefined
  const product = (operand: Node): Node => op('mul', flattenMultiply(
    placement === 'before'
      ? [cloneNode(factor), cloneNode(operand)]
      : [cloneNode(operand), cloneNode(factor)],
  ))
  if (onlyTerm && isOp(onlyTerm, 'div') && onlyTerm.operands.length === 2) {
    onlyTerm.operands[0] = product(onlyTerm.operands[0])
    return
  }
  expression.operands = [product(onlyTerm ?? expression)]
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
  placement: FactorPlacement = 'after',
  evaluateTargetProduct = false,
): void {
  const source = side === 'left' ? equation.left : equation.right
  const target = side === 'left' ? equation.right : equation.left
  const term = source.operands[termIndex]
  if (!term) throw new Error(strings.selectDenominatorFactor)
  const fromDenominator = isInDenominator(term, factorPath)
  if (source.operands.length !== 1) {
    if (fromDenominator) multiplyAllBySelectedFactor(equation, side, termIndex, factorPath, displayedValue, 'before', placement)
    else divideAllBySelectedFactor(equation, side, termIndex, factorPath, displayedValue, 'before', placement)
    return
  }
  const factor = selectedFactor(equation, side, termIndex, factorPath, displayedValue)
  if (factor.value === 0) throw new Error(fromDenominator ? strings.multiplyByZero : strings.divideByZero)

  save(equation)
  source.operands = exposedTerms(removeFactor(term, factorPath, factor))
  if (fromDenominator && evaluateTargetProduct && target.operands.length === 1 &&
    target.operands[0].kind === 'num') {
    target.operands = [num(target.operands[0].value * factor.value)]
  } else if (fromDenominator) multiplySide(target, factor, placement)
  else divideSide(target, factor, placement)
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
