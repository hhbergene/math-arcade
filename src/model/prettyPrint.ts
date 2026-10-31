import { cloneNode, isOp, num, type Node, type OpNode } from './node'

export const symbols = {
  plus: '+',
  minus: '-',
  multiply: '·',
  divide: '/',
  equals: '=',
} as const

export function nodeSign(node: Node): -1 | 1 | undefined {
  if (node.kind === 'num') return node.value < 0 ? -1 : 1
  if (node.kind === 'var') return undefined

  if (node.kind === 'mul') {
    return node.operands.reduce<-1 | 1>((sign, child) => {
      const childSign = nodeSign(child)
      return childSign === -1 ? (sign === -1 ? 1 : -1) : sign
    }, 1)
  }

  if (node.kind === 'div' && node.operands.length === 2) {
    const numerator = nodeSign(node.operands[0])
    const denominator = nodeSign(node.operands[1])
    if (numerator === undefined || denominator === undefined) return undefined
    return numerator === denominator ? 1 : -1
  }
  return undefined
}

export function positiveForDisplay(node: Node): Node {
  if (node.kind === 'num') return num(-node.value)
  if (isOp(node, 'mul')) {
    const operands = node.operands.map(cloneNode)
    const negativeNumberIndex = operands.findIndex(
      (child) => child.kind === 'num' && child.value < 0,
    )
    if (negativeNumberIndex >= 0) {
      const child = operands[negativeNumberIndex]
      if (child.kind === 'num') {
        if (child.value === -1) operands.splice(negativeNumberIndex, 1)
        else operands[negativeNumberIndex] = num(-child.value)
      }
      return { kind: 'mul', operands }
    }
    return { kind: 'mul', operands: [num(-1), ...operands] }
  }
  if (isOp(node, 'div') && node.operands.length === 2) {
    const [numerator, denominator] = node.operands
    if (nodeSign(numerator) === -1) {
      return { kind: 'div', operands: [positiveForDisplay(numerator), cloneNode(denominator)] }
    }
    return { kind: 'div', operands: [cloneNode(numerator), positiveForDisplay(denominator)] }
  }
  return { kind: 'mul', operands: [num(-1), cloneNode(node)] }
}

function stripLeadingMinus(text: string): string {
  return text.startsWith('-') ? text.slice(1) : text
}

function needsParentheses(node: Node, parentKind: 'mul' | 'div', index?: number): boolean {
  if (isOp(node, 'add')) return true
  if (parentKind === 'div' && index === 1 && isOp(node, 'mul')) return true
  if (parentKind === 'div' && index === 1 && nodeSign(node) === -1) return true
  return parentKind === 'mul' && index !== undefined && index > 0 && nodeSign(node) === -1
}

function printChild(node: Node, parentKind: 'mul' | 'div', index?: number): string {
  const text = prettyPrint(node)
  return needsParentheses(node, parentKind, index) ? `(${text})` : text
}

export function prettyPrint(node: Node): string {
  if (node.kind === 'num' || node.kind === 'var') return String(node.value)

  if (node.kind === 'mul') {
    return node.operands
      .map((child, index) => printChild(child, 'mul', index))
      .join(` ${symbols.multiply} `)
      .replace(/- /g, '-')
  }

  if (node.kind === 'div') {
    if (node.operands.length !== 2) {
      return `(${node.operands.map(prettyPrint).join(' · ')})`
    }
    const [numerator, denominator] = node.operands
    const left = printChild(numerator, 'div')
    const right = printChild(denominator, 'div', 1)
    return left.startsWith('-') && !left.startsWith('(-')
      ? `-${left.slice(1)}/${right}`
      : `${left}/${right}`
  }

  return node.operands
    .map((child, index) => {
      const text = prettyPrint(child)
      if (index === 0 && isOp(child, 'div') && nodeSign(child.operands[0]) !== -1) return text
      const sign = nodeSign(child)
      const body = sign === -1 ? prettyPrint(positiveForDisplay(child)) : text
      if (index === 0) return sign === -1 ? `-${stripLeadingMinus(body)}` : body
      return `${sign === -1 ? ' - ' : ' + '}${sign === -1 ? stripLeadingMinus(body) : body}`
    })
    .join('')
}

export function prettyPrintEquation(equation: { left: OpNode; right: OpNode }): string {
  return `${prettyPrint(equation.left)} ${symbols.equals} ${prettyPrint(equation.right)}`
}
