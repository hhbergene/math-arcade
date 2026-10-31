import { isOp, num, op, variable, type Node, type OpNode } from './node'

export class EquationParser {
  private position = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text.replace(/\s+/g, '')
  }

  parseEquation(): { left: OpNode; right: OpNode } {
    if (!this.text) throw new Error('Likningen kan ikke være tom.')

    const left = this.parseExpression()
    let right: Node
    if (this.peek() === '=') {
      this.position += 1
      right = this.parseExpression()
    } else {
      right = num(0)
    }
    if (this.peek() !== undefined) throw new Error(`Uventet tegn: ${this.peek()}`)
    return { left: asAdd(left), right: asAdd(right) }
  }

  private peek(): string | undefined {
    return this.text[this.position]
  }

  private parseExpression(): Node {
    const terms = [this.parseTerm()]
    while (this.peek() === '+' || this.peek() === '-') {
      const sign = this.peek()
      this.position += 1
      const term = this.parseTerm()
      terms.push(sign === '-' ? op('mul', [num(-1), term]) : term)
    }
    return terms.length === 1 ? terms[0] : op('add', terms)
  }

  private parseTerm(): Node {
    const factors = [this.parseFactor()]
    while (this.peek() !== undefined && !'+-)=/'.includes(this.peek()!)) {
      factors.push(this.parseFactor())
    }
    return factors.length === 1 ? factors[0] : op('mul', factors)
  }

  private parseFactor(): Node {
    const token = this.peek()
    if (token === undefined) throw new Error('Uventet slutt på likningen.')

    if (token === '(') {
      this.position += 1
      const expression = this.parseExpression()
      this.expect(')')
      return this.parseOptionalDivision(expression)
    }

    if (token === '-') {
      this.position += 1
      const inner = this.parseFactor()
      if (inner.kind === 'num') return num(-inner.value)
      return op('mul', [num(-1), inner])
    }

    if (/\d/.test(token)) {
      const start = this.position
      while (/\d/.test(this.peek() ?? '')) this.position += 1
      return this.parseOptionalDivision(num(Number(this.text.slice(start, this.position))))
    }

    if (/[a-z]/i.test(token)) {
      this.position += 1
      return this.parseOptionalDivision(variable(token))
    }

    throw new Error(`Ukjent tegn: ${token}`)
  }

  private parseOptionalDivision(numerator: Node): Node {
    if (this.peek() !== '/') return numerator
    this.position += 1
    return op('div', [numerator, this.parseFactor()])
  }

  private expect(expected: string): void {
    if (this.peek() !== expected) {
      throw new Error(`Forventet '${expected}', fikk '${this.peek() ?? 'slutt på likningen'}'.`)
    }
    this.position += 1
  }
}

function asAdd(node: Node): OpNode {
  return isOp(node, 'add') ? node : op('add', [node])
}

export function parseEquation(text: string): { left: OpNode; right: OpNode } {
  return new EquationParser(text).parseEquation()
}
