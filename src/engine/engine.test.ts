import { describe, expect, it } from 'vitest'
import {
  addTermBoth,
  cancelFractionFactors,
  divideAll,
  divideAllBySelectedFactor,
  multiplyAllBySelectedFactor,
  moveFactorAcrossEquals,
  mergeAll,
  mergeEquationTerms,
  moveOperandBetweenSides,
  multiplyAll,
  multiplyFactors,
} from './actions'
import { getAutoSuggestion } from './auto'
import { simplify } from './simplify'
import { num, op, variable } from '../model/node'
import { parseEquation } from '../model/parser'
import { prettyPrint, prettyPrintEquation } from '../model/prettyPrint'
import { createEquation } from '../model/equation'

describe('equation parser and formatting', () => {
  it('parses implicit multiplication, subtraction, and both sides', () => {
    const equation = parseEquation('2x+3=7')
    expect(prettyPrintEquation(equation)).toBe('2 · x + 3 = 7')
  })

  it('parses parenthesized fractions', () => {
    expect(prettyPrintEquation(parseEquation('(x+2)/3=1'))).toBe('(x + 2)/3 = 1')
    expect(prettyPrint(op('div', [variable('x'), op('mul', [num(2), num(3)])]))).toBe(
      'x/(2 · 3)',
    )
  })

  it('rejects trailing or malformed input', () => {
    expect(() => parseEquation('2x+')).toThrow()
    expect(() => parseEquation('x=2!')).toThrow()
  })
})

describe('simplification and merging', () => {
  it('cancels a numeric coefficient against an integer denominator', () => {
    expect(prettyPrint(simplify(op('div', [op('mul', [num(2), variable('x')]), num(2)])))).toBe('x')
  })

  it('clears a numeric denominator when multiplying both sides', () => {
    const equation = createEquation('(x+2)/3=1')
    multiplyAll(equation, 3)
    expect(equation.prettyPrint()).toBe('x + 2 = 3')
  })

  it('combines like variable terms and constants', () => {
    const equation = createEquation('2x+3x+4+5=0')
    expect(mergeAll(equation)).toBe(2)
    expect(equation.prettyPrint()).toBe('5 · x + 9 = 0')
  })

  it('merges negative terms from subtraction', () => {
    const equation = createEquation('2x-3x+5-2=0')
    expect(mergeAll(equation)).toBe(2)
    expect(equation.prettyPrint()).toBe('-x + 3 = 0')
  })

  it('merges the two selected terms on one side', () => {
    const equation = createEquation('2x+3+5=0')
    expect(mergeEquationTerms(equation, 'left', 1, 2)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x + 8 = 0')
  })

  it('multiplies two selected numeric factors', () => {
    const equation = createEquation('2(2)x=8')
    multiplyFactors(equation, 'left', 0, [], 0, 1)
    expect(equation.prettyPrint()).toBe('4 · x = 8')
  })

  it('places the selected coefficient below both complete sides as fractions', () => {
    const equation = createEquation('2x=4')
    divideAllBySelectedFactor(equation, 'left', 0, [0])
    expect(equation.prettyPrint()).toBe('2 · x/2 = 4/2')
  })

  it('puts a common denominator below every term on both sides', () => {
    const equation = createEquation('2x+3=7')
    divideAllBySelectedFactor(equation, 'left', 0, [0])
    expect(equation.prettyPrint()).toBe('(2 · x + 3)/2 = 7/2')
  })

  it('extends existing denominators instead of nesting another fraction', () => {
    const equation = createEquation('2x=4')
    divideAllBySelectedFactor(equation, 'left', 0, [0])
    divideAllBySelectedFactor(equation, 'left', 0, [0, 0])
    expect(equation.prettyPrint()).toBe('2 · x/(2 · 2) = 4/(2 · 2)')
  })

  it('cancels matching numerator and denominator factors in a fraction', () => {
    const equation = createEquation('x=2')
    equation.left.operands = [op('div', [op('mul', [num(2), variable('x')]), num(2)])]
    cancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])
    expect(equation.prettyPrint()).toBe('x = 2')
  })

  it('reduces a numeric fraction when dragging numerator onto denominator', () => {
    const equation = createEquation('4/2=2')
    cancelFractionFactors(equation, 'left', 0, [], [0], [1])
    expect(equation.prettyPrint()).toBe('2 = 2')
  })

  it('rejects cancelling factors that have no common factor', () => {
    const equation = createEquation('x=1')
    equation.left.operands = [op('div', [op('mul', [num(2), variable('x')]), num(3)])]
    expect(() => cancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])).toThrow(
      'Disse faktorene har ingen felles faktor større enn 1.',
    )
  })

  it('divides by a negative leading coefficient including its sign', () => {
    const equation = createEquation('-3x=0')
    divideAllBySelectedFactor(equation, 'left', 0, [0], -3)
    expect(equation.prettyPrint()).toBe('-3 · x/(-3) = 0/(-3)')
  })

  it('divides by the displayed absolute value when the minus is an operator', () => {
    const equation = createEquation('-3x=0')
    divideAllBySelectedFactor(equation, 'left', 0, [0], 3)
    expect(equation.prettyPrint()).toBe('-3 · x/3 = 0/3')
  })

  it('moves a factor across = and cancels it on the source side', () => {
    const equation = createEquation('2x=4')
    moveFactorAcrossEquals(equation, 'left', 0, [0], 2)
    expect(equation.prettyPrint()).toBe('x = 4/2')
  })

  it('moves a negative coefficient across = with its sign', () => {
    const equation = createEquation('-3x=6')
    moveFactorAcrossEquals(equation, 'left', 0, [0], -3)
    expect(equation.prettyPrint()).toBe('x = 6/(-3)')
  })

  it('moves a denominator factor across = as multiplication', () => {
    const equation = createEquation('x=1')
    equation.left.operands = [op('div', [variable('x'), num(2)])]
    moveFactorAcrossEquals(equation, 'left', 0, [1], 2)
    expect(equation.prettyPrint()).toBe('x = 1 · 2')
  })

  it('moves a numerator factor out of a fraction across =', () => {
    const equation = createEquation('x=4')
    equation.left.operands = [op('div', [op('mul', [num(2), variable('x')]), num(3)])]
    moveFactorAcrossEquals(equation, 'left', 0, [0, 0], 2)
    expect(equation.prettyPrint()).toBe('x/3 = 4/2')
  })

  it('divides whole sides when the source side has several terms', () => {
    const equation = createEquation('2x+4=6')
    moveFactorAcrossEquals(equation, 'left', 0, [0], 2)
    expect(equation.prettyPrint()).toBe('(2 · x + 4)/2 = 6/2')
  })

  it('multiplies both sides by a dragged denominator factor and keeps it visible', () => {
    const equation = createEquation('x=1')
    equation.left.operands = [op('div', [variable('x'), num(2)])]
    multiplyAllBySelectedFactor(equation, 'left', 0, [1])
    expect(equation.prettyPrint()).toBe('2 · x/2 = 2 · 1')
    cancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])
    expect(equation.prettyPrint()).toBe('x = 2')
  })
})

describe('equation actions and history', () => {
  it('moves a term across the equals sign, merges, divides, and undoes', () => {
    const equation = createEquation('2x+3=7')
    expect(equation.history.entries[0]).toBe(
      '2 · x + 3 = 7  [Testlikning: 2x+3=7]',
    )

    moveOperandBetweenSides(equation, 'left', 1)
    expect(equation.prettyPrint()).toBe('2 · x = 7 - 3')
    mergeAll(equation)
    expect(equation.prettyPrint()).toBe('2 · x = 4')
    divideAll(equation, 2)
    expect(equation.prettyPrint()).toBe('x = 2')

    const previous = equation.history.undo()
    expect(previous).toBeDefined()
    equation.left = previous!.left
    equation.right = previous!.right
    expect(equation.prettyPrint()).toBe('2 · x = 4')
    expect(equation.history.entries).toHaveLength(3)
  })

  it('adds the same term to both sides', () => {
    const equation = createEquation('x=4')
    addTermBoth(equation, -4)
    expect(equation.prettyPrint()).toBe('x - 4 = 4 - 4')
  })

  it('suggests clearing a denominator at the highest auto level', () => {
    const equation = createEquation('(x+2)/3=1')
    expect(getAutoSuggestion(equation, 4)).toMatchObject({
      kind: 'multiply',
      factor: 3,
    })
  })
})
