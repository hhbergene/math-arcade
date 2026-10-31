import { History } from './history'
import { num, op, variable, type EquationSnapshot, type Node, type OpNode } from './node'
import { parseEquation } from './parser'
import { prettyPrintEquation } from './prettyPrint'
import { strings } from '../strings'

const knownEquations = ['2x+3=7', '(x+2)/3=1']

export class Equation implements EquationSnapshot {
  left: OpNode
  right: OpNode
  readonly history = new History()
  solution?: number

  constructor(left: OpNode, right: OpNode, solution?: number) {
    this.left = left
    this.right = right
    this.solution = solution
  }

  prettyPrint(): string {
    return prettyPrintEquation(this)
  }
}

function makeXTerm(coefficient: number): Node {
  if (coefficient === 1) return variable('x')
  return op('mul', [num(coefficient), variable('x')])
}

export function createEquation(source?: string): Equation {
  const known = source ?? knownEquations.shift()
  if (known) {
    const parsed = parseEquation(known)
    const equation = new Equation(parsed.left, parsed.right)
    equation.history.record(equation, strings.testEquation.replace('{equation}', known))
    return equation
  }

  let a = 0
  let c = 0
  let b = 0
  let d = 0
  let solution = 0
  do {
    a = randomInteger(-6, 6, true)
    c = randomInteger(-6, 6, true)
    b = randomInteger(-12, 12)
    d = randomInteger(-12, 12)
    const denominator = a - c
    const numerator = d - b
    if (denominator !== 0 && numerator % denominator === 0) {
      solution = numerator / denominator
      if (solution >= -20 && solution <= 20) break
    }
  } while (true)

  const equation = new Equation(
    op('add', [makeXTerm(a), num(b)]),
    op('add', [makeXTerm(c), num(d)]),
    solution,
  )
  equation.history.record(equation, strings.newEquationHistory)
  return equation
}

function randomInteger(minimum: number, maximum: number, excludeZero = false): number {
  let value = 0
  do {
    value = Math.floor(Math.random() * (maximum - minimum + 1)) + minimum
  } while (excludeZero && value === 0)
  return value
}
