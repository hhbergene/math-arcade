export type NumFactor = {
  kind: 'num'
  value: number
}

export type VarFactor = {
  kind: 'var'
  value: string
}

export type OpKind = 'add' | 'mul' | 'div'

export type OpNode = {
  kind: OpKind
  operands: Node[]
}

export type Node = NumFactor | VarFactor | OpNode
export type EquationSnapshot = { left: OpNode; right: OpNode }

export const num = (value: number): NumFactor => ({ kind: 'num', value })
export const variable = (value: string): VarFactor => ({ kind: 'var', value })
export const op = (kind: OpKind, operands: Node[]): OpNode => ({ kind, operands })

export function isZeroSide(expression: OpNode): boolean {
  return expression.operands.length === 1 &&
    expression.operands[0].kind === 'num' && expression.operands[0].value === 0
}

export function isOp(node: Node): node is OpNode
export function isOp<K extends OpKind>(node: Node, kind: K): node is OpNode & { kind: K }
export function isOp(node: Node, kind?: OpKind): boolean {
  return node.kind !== 'num' && node.kind !== 'var' && (!kind || node.kind === kind)
}

export function cloneNode(node: Node): Node {
  if (node.kind === 'num') return num(node.value)
  if (node.kind === 'var') return variable(node.value)
  return op(node.kind, node.operands.map(cloneNode))
}

export function cloneEquation(equation: EquationSnapshot): EquationSnapshot {
  return {
    left: op('add', equation.left.operands.map(cloneNode)),
    right: op('add', equation.right.operands.map(cloneNode)),
  }
}
