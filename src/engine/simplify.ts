import { isOp, num, op, type Node, type OpNode } from '../model/node'

function gcd(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) [left, right] = [right, left % right]
  return left
}

function flatten(kind: 'add' | 'mul', nodes: Node[]): Node[] {
  return nodes.flatMap((node) => (isOp(node, kind) ? node.operands : [node]))
}

function numericValue(node: Node): number | undefined {
  return node.kind === 'num' && Number.isInteger(node.value) ? node.value : undefined
}

export function simplify(node: Node): Node {
  if (node.kind === 'num' || node.kind === 'var') return node

  if (node.kind === 'add') {
    const children = flatten('add', node.operands.map(simplify)).filter(
      (child) => !(child.kind === 'num' && child.value === 0),
    )
    if (children.length === 0) return num(0)
    if (children.length === 1) return children[0]
    return op('add', children)
  }

  if (node.kind === 'mul') {
    const children = flatten('mul', node.operands.map(simplify))
    if (children.some((child) => child.kind === 'num' && child.value === 0)) return num(0)

    let product = 1
    const rest: Node[] = []
    for (const child of children) {
      const value = numericValue(child)
      if (value === undefined) rest.push(child)
      else product *= value
    }
    for (let index = 0; index < rest.length && Math.abs(product) > 1; index += 1) {
      const child = rest[index]
      if (!isOp(child, 'div') || child.operands.length !== 2) continue
      const denominator = numericValue(child.operands[1])
      if (denominator === undefined || denominator <= 0) continue
      const divisor = gcd(product, denominator)
      if (divisor <= 1) continue
      product /= divisor
      const reducedDenominator = denominator / divisor
      rest[index] =
        reducedDenominator === 1
          ? child.operands[0]
          : op('div', [child.operands[0], num(reducedDenominator)])
    }

    const result = product !== 1 || rest.length === 0 ? [num(product), ...rest] : rest
    if (result.length > 1 && result[0].kind === 'num' && result[0].value === 1) {
      result.shift()
    }
    if (result.length === 0) return num(1)
    return result.length === 1 ? result[0] : op('mul', result)
  }

  if (node.operands.length !== 2) return op('div', node.operands.map(simplify))
  const [numerator, denominator] = node.operands.map(simplify)
  if (numerator.kind === 'num' && numerator.value === 0) return num(0)
  if (denominator.kind === 'num' && denominator.value === 1) return numerator

  const numeratorValue = numericValue(numerator)
  const denominatorValue = numericValue(denominator)
  if (
    numeratorValue !== undefined &&
    denominatorValue !== undefined &&
    denominatorValue !== 0
  ) {
    const divisor = gcd(numeratorValue, denominatorValue)
    let n = numeratorValue / divisor
    let d = denominatorValue / divisor
    if (d < 0) [n, d] = [-n, -d]
    return d === 1 ? num(n) : op('div', [num(n), num(d)])
  }

  if (denominatorValue !== undefined && denominatorValue !== 0) {
    let coefficient = 1
    let rest: Node[] = [numerator]
    if (isOp(numerator, 'mul') && numerator.operands.length > 0) {
      const firstValue = numericValue(numerator.operands[0])
      if (firstValue !== undefined) {
        coefficient = firstValue
        rest = numerator.operands.slice(1)
      } else {
        rest = numerator.operands
      }
    }
    const divisor = gcd(coefficient, denominatorValue)
    let n = coefficient / divisor
    let d = denominatorValue / divisor
    if (d < 0) [n, d] = [-n, -d]

    const reducedNumerator =
      n === 1
        ? rest.length === 1
          ? rest[0]
          : op('mul', rest)
        : op('mul', [num(n), ...rest])
    return d === 1 ? simplify(reducedNumerator) : op('div', [simplify(reducedNumerator), num(d)])
  }

  return op('div', [numerator, denominator])
}

export function simplifyEquation(equation: { left: OpNode; right: OpNode }): void {
  const left = simplify(equation.left)
  const right = simplify(equation.right)
  equation.left = isOp(left, 'add') ? left : op('add', [left])
  equation.right = isOp(right, 'add') ? right : op('add', [right])
}
