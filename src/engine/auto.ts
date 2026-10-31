import { strings } from '../strings'
import { cloneEquation, isOp, type Node } from '../model/node'
import { divideAll, mergeAll, moveOperandBetweenSides, multiplyAll, swapSides } from './actions'
import { Equation } from '../model/equation'
import { mergeLikeTerms } from './merge'
import { prettyPrint } from '../model/prettyPrint'

export type AutoLevel = 0 | 1 | 2 | 3 | 4
export type AutoSuggestion =
  | { kind: 'move'; side: 'left' | 'right'; index: number; label: string }
  | { kind: 'swap'; label: string }
  | { kind: 'divide'; divisor: number; label: string }
  | { kind: 'multiply'; factor: number; label: string }
  | { kind: 'merge'; label: string }

export const AUTO_MIN: AutoLevel = 0
export const AUTO_MAX: AutoLevel = 4

const levelNames = strings.autoLevels

export function clampAutoLevel(level: number): AutoLevel {
  return Math.max(AUTO_MIN, Math.min(AUTO_MAX, Math.trunc(level))) as AutoLevel
}

export function autoLevelLabel(level: number): string {
  return levelNames[clampAutoLevel(level)]
}

function containsVariable(node: Node): boolean {
  return node.kind === 'var' || (isOp(node) && node.operands.some(containsVariable))
}

function coefficientOfVariable(node: Node): number | undefined {
  if (node.kind === 'var') return 1
  if (isOp(node, 'mul')) {
    let coefficient = 1
    let variableCount = 0
    for (const child of node.operands) {
      if (child.kind === 'num') coefficient *= child.value
      else if (containsVariable(child)) {
        if (child.kind !== 'var') return undefined
        variableCount += 1
      }
    }
    return variableCount === 1 ? coefficient : undefined
  }
  if (isOp(node, 'div') && node.operands.length === 2) {
    const numerator = coefficientOfVariable(node.operands[0])
    const denominator = node.operands[1]
    if (numerator !== undefined && denominator.kind === 'num' && denominator.value !== 0) {
      const coefficient = numerator / denominator.value
      return Number.isInteger(coefficient) ? coefficient : undefined
    }
  }
  return undefined
}

export function getAutoSuggestion(
  equation: Equation,
  level: number,
): AutoSuggestion | undefined {
  const activeLevel = clampAutoLevel(level)
  if (activeLevel < 2) return undefined

  if (activeLevel === 4) {
    for (const side of [equation.left, equation.right]) {
      const fraction = side.operands.find((term) => isOp(term, 'div') && term.operands.length === 2)
      if (fraction && isOp(fraction, 'div')) {
        const denominator = fraction.operands[1]
        if (denominator.kind === 'num' && Number.isInteger(denominator.value) && denominator.value > 1) {
          return {
            kind: 'multiply',
            factor: denominator.value,
            label: `Gang begge sider med ${denominator.value} for å fjerne brøken.`,
          }
        }
      }
    }
  }

  const leftVariables = equation.left.operands
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => containsVariable(node))
  const rightVariables = equation.right.operands
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => containsVariable(node))

  const mergeCandidate = cloneEquation(equation)
  if (mergeLikeTerms(mergeCandidate)) {
    return { kind: 'merge', label: 'Slå sammen like ledd.' }
  }

  if (activeLevel >= 3 && leftVariables.length === 0 && rightVariables.length > 0) {
    return { kind: 'swap', label: 'Bytt sider slik at x-leddene står til venstre.' }
  }

  const leftConstant = equation.left.operands.findIndex((node) => !containsVariable(node))
  if (leftVariables.length > 0 && leftConstant >= 0) {
    const term = equation.left.operands[leftConstant]
    return {
      kind: 'move',
      side: 'left',
      index: leftConstant,
      label: `Flytt ${termLabel(term)} til høyre side.`,
    }
  }

  if (activeLevel >= 3) {
    const rightConstant = equation.right.operands.findIndex((node) => !containsVariable(node))
    if (rightVariables.length > 0 && rightConstant >= 0) {
      const term = equation.right.operands[rightConstant]
      return {
        kind: 'move',
        side: 'right',
        index: rightConstant,
        label: `Flytt ${termLabel(term)} til venstre side.`,
      }
    }

    if (leftVariables.length > 0 && rightVariables.length > 0) {
      const term = equation.right.operands[rightVariables[0].index]
      return {
        kind: 'move',
        side: 'right',
        index: rightVariables[0].index,
        label: `Flytt ${termLabel(term)} til venstre side.`,
      }
    }
  }

  if (
    activeLevel >= 3 &&
    leftVariables.length === 1 &&
    rightVariables.length === 0 &&
    equation.left.operands.every(containsVariable) &&
    equation.right.operands.every((node) => !containsVariable(node))
  ) {
    const coefficient = coefficientOfVariable(equation.left.operands[leftVariables[0].index])
    if (coefficient !== undefined && Math.abs(coefficient) > 1) {
      return {
        kind: 'divide',
        divisor: coefficient,
        label: `Del begge sider på ${coefficient}.`,
      }
    }
  }
  return undefined
}

function termLabel(node: Node): string {
  return prettyPrint(node)
}

export function applyAutoSuggestion(equation: Equation, suggestion: AutoSuggestion): void {
  if (suggestion.kind === 'swap') {
    swapSides(equation)
  } else if (suggestion.kind === 'move') {
    moveOperandBetweenSides(equation, suggestion.side, suggestion.index)
  } else if (suggestion.kind === 'divide') {
    divideAll(equation, suggestion.divisor)
  } else if (suggestion.kind === 'multiply') {
    multiplyAll(equation, suggestion.factor)
  } else {
    mergeAll(equation)
  }
}
