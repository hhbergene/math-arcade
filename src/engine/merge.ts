import { isOp, num, op, type Node, type OpNode } from '../model/node'
import { simplifyEquation } from './simplify'

function constantValue(node: Node): number | undefined {
  if (node.kind === 'num') return node.value
  if (!isOp(node, 'mul')) return undefined
  let value = 1
  for (const factor of node.operands) {
    const childValue = constantValue(factor)
    if (childValue === undefined) return undefined
    value *= childValue
  }
  return value
}

function decomposeVariable(node: Node): { coefficient: number; variable: string } | undefined {
  if (node.kind === 'var') return { coefficient: 1, variable: node.value }
  if (!isOp(node, 'mul')) return undefined

  let coefficient = 1
  let variable: string | undefined
  for (const factor of node.operands) {
    const numeric = constantValue(factor)
    if (numeric !== undefined) {
      coefficient *= numeric
      continue
    }
    const part = decomposeVariable(factor)
    if (!part || variable !== undefined) return undefined
    coefficient *= part.coefficient
    variable = part.variable
  }
  return variable === undefined ? undefined : { coefficient, variable }
}

function mergePair(left: Node, right: Node): Node | undefined {
  const leftConstant = constantValue(left)
  const rightConstant = constantValue(right)
  if (leftConstant !== undefined && rightConstant !== undefined) {
    return num(leftConstant + rightConstant)
  }

  if (left.kind === 'var' && right.kind === 'var' && left.value === right.value) {
    return op('mul', [num(2), { ...left }])
  }

  const leftVariable = decomposeVariable(left)
  const rightVariable = decomposeVariable(right)
  if (leftVariable && rightVariable && leftVariable.variable === rightVariable.variable) {
    const coefficient = leftVariable.coefficient + rightVariable.coefficient
    if (coefficient === 0) return num(0)
    if (coefficient === 1) return { kind: 'var', value: leftVariable.variable }
    return op('mul', [num(coefficient), { kind: 'var', value: leftVariable.variable }])
  }

  if (isOp(left) && isOp(right) && left.kind === right.kind) {
    if (JSON.stringify(left) === JSON.stringify(right)) return op('mul', [num(2), left])
    if (isOp(left, 'div') && isOp(right, 'div') && left.operands.length === 2 && right.operands.length === 2) {
      if (JSON.stringify(left.operands[1]) === JSON.stringify(right.operands[1])) {
        const numerator = mergePair(left.operands[0], right.operands[0])
        if (numerator) return op('div', [numerator, left.operands[1]])
      }
    }
  }
  return undefined
}

export function canMergeTerms(left: Node, right: Node): boolean {
  return mergePair(left, right) !== undefined
}

export function mergeTermsAt(side: OpNode, first: number, second: number): boolean {
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    second < 0 ||
    first >= side.operands.length ||
    second >= side.operands.length ||
    first === second
  ) {
    return false
  }

  const leftIndex = Math.min(first, second)
  const rightIndex = Math.max(first, second)
  const merged = mergePair(side.operands[leftIndex], side.operands[rightIndex])
  if (!merged) return false
  side.operands[leftIndex] = merged
  side.operands.splice(rightIndex, 1)
  return true
}

function mergeSide(side: OpNode): boolean {
  for (let first = 0; first < side.operands.length; first += 1) {
    for (let second = first + 1; second < side.operands.length; second += 1) {
      if (mergeTermsAt(side, first, second)) return true
    }
  }
  return false
}

export function mergeLikeTerms(equation: { left: OpNode; right: OpNode }): boolean {
  const changed = mergeSide(equation.left) || mergeSide(equation.right)
  if (changed) simplifyEquation(equation)
  return changed
}

export function mergeAllLikeTerms(equation: { left: OpNode; right: OpNode }): number {
  let count = 0
  while (mergeLikeTerms(equation)) count += 1
  return count
}
