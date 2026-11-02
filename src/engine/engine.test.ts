import { describe, expect, it } from 'vitest'
import {
  addTermBoth,
  cancelFractionFactors,
  canEvaluateNegativeUnitFraction,
  evaluateNegativeUnitFraction,
  canCancelFractionFactors,
  finishFractionCancellations,
  divideAll,
  divideAllBySelectedFactor,
  multiplyAllBySelectedFactor,
  moveFactorAcrossEquals,
  mergeAll,
  mergeEquationTerms,
  mergeNestedTerms,
  moveOperandBetweenSides,
  moveOperandToPosition,
  multiplyAll,
  multiplyFactors,
  distributeFactor,
  showFractionCancellation,
  swapEquationTerms,
  swapFactors,
  swapNestedTerms,
} from './actions'
import { getAutoSuggestion } from './auto'
import { simplify, simplifyEquation } from './simplify'
import { cloneEquation, num, op, variable } from '../model/node'
import { parseEquation } from '../model/parser'
import { prettyPrint, prettyPrintEquation } from '../model/prettyPrint'
import { createEquation } from '../model/equation'
import { cloneNode } from '../model/node'

describe('independent cancellation completion', () => {
  it('allows product factors outside parentheses and preserves the opposite product', () => {
    const equation = createEquation('(3(x+2))/3=3(1)')
    const right = cloneNode(equation.right)
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])).toBe(true)
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    expect(equation.prettyPrint()).toBe('1 · (x + 2)/1 = 3 · 1')
    expect(finishFractionCancellations(equation, [cancellation], 'left')).toEqual([])
    expect(equation.prettyPrint()).toBe('x + 2 = 3 · 1')
    expect(equation.right).toEqual(right)
    expect(equation.left.operands).toEqual([variable('x'), num(2)])
  })

  it('exposes marked sums as separate terms without changing unmarked fractions', () => {
    const equation = createEquation('(3(x+2))/3+6/3+(2(x-4))/2=3(1)')
    const unmarked = cloneNode(equation.left.operands[1])
    const right = cloneNode(equation.right)
    const first = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    const second = showFractionCancellation(equation, 'left', 2, [], [0, 0], [1])
    const before = cloneNode(equation.left)
    finishFractionCancellations(equation, [first, second], 'left')
    expect(equation.left.operands).toHaveLength(5)
    expect(equation.left.operands[1]).toEqual(num(2))
    expect(equation.left.operands[2]).toEqual(unmarked)
    expect(equation.right).toEqual(right)
    expect(equation.history.undo()?.left).toEqual(before)
  })

  it('can retain nested-merge behavior after cancellation exposes the selected terms', () => {
    const equation = createEquation('(3(7-3))/3=3(1)')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    finishFractionCancellations(equation, [cancellation])
    expect(mergeEquationTerms(equation, 'left', 0, 1, false)).toBe(true)
    expect(equation.prettyPrint()).toBe('4 = 3 · 1')
  })

  it('rejects cancellation of an individual sum term in every engine entry point', () => {
    const equation = createEquation('(x+3)/3=1')
    const before = equation.prettyPrint()
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 1], [1])).toBe(false)
    expect(() => showFractionCancellation(equation, 'left', 0, [], [0, 1], [1])).toThrow()
    expect(() => cancelFractionFactors(equation, 'left', 0, [], [0, 1], [1])).toThrow()
    expect(equation.prettyPrint()).toBe(before)
    expect(equation.history.canUndo()).toBe(false)
  })

  it('keeps an unmarked cancellable fraction on the opposite side structurally unchanged', () => {
    const equation = createEquation('(3(x+2))/3=(3(4))/3')
    const right = cloneNode(equation.right)
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    finishFractionCancellations(equation, [cancellation], 'left')
    expect(equation.right).toEqual(right)
  })

  it('completes one side while retaining the other pending cancellation', () => {
    const equation = createEquation('(3(x+2))/3=(3(4))/3')
    const left = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    const right = showFractionCancellation(equation, 'right', 0, [], [0, 0], [1])
    const markedRight = cloneNode(equation.right)
    const remaining = finishFractionCancellations(equation, [left, right], 'left')
    expect(remaining).toEqual([right])
    expect(equation.right).toEqual(markedRight)
    expect(equation.prettyPrint()).toBe('x + 2 = 1 · 4/1')
    finishFractionCancellations(equation, remaining)
    expect(equation.prettyPrint()).toBe('x + 2 = 4')
  })

  it('cleans all marked sides together and leaves unmarked factors uncancelled', () => {
    const equation = createEquation('(2(3)x)/(2(3))=(2(5))/(2(5))')
    const left = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1, 0])
    const right = showFractionCancellation(equation, 'right', 0, [], [0, 0], [1, 0])
    expect(finishFractionCancellations(equation, [left, right])).toEqual([])
    expect(equation.prettyPrint()).toBe('3 · x/3 = 5/5')
  })

  it('retains unrelated ones and fractions within a marked side', () => {
    const equation = createEquation('(2(1)x)/(2(3))+6/3=1')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1, 0])
    finishFractionCancellations(equation, [cancellation])
    expect(equation.prettyPrint()).toBe('1 · x/3 + 6/3 = 1')
  })

  it('handles several pairs on one side and repeated use of a reduced factor', () => {
    const equation = createEquation('(12x)/(2(3))=1')
    const first = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1, 0])
    const second = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1, 1])
    expect(first.numeratorOriginal).toBe(12)
    expect(second.numeratorOriginal).toBe(6)
    finishFractionCancellations(equation, [first, second])
    expect(equation.prettyPrint()).toBe('2 · x = 1')
  })

  it('completes pairs in multiple fraction terms without invalidating paths', () => {
    const equation = createEquation('(2x)/2+(3x)/3=1')
    const first = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    const second = showFractionCancellation(equation, 'left', 1, [], [0, 0], [1])
    finishFractionCancellations(equation, [first, second], 'left')
    expect(equation.prettyPrint()).toBe('x + x = 1')
  })

  it('does nothing when completing an unmarked side and makes completion undoable', () => {
    const equation = createEquation('(3x)/3=1')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    const entries = equation.history.entries.length
    expect(finishFractionCancellations(equation, [cancellation], 'right')).toEqual([cancellation])
    expect(equation.history.entries.length).toBe(entries)
    const marked = cloneNode(equation.left)
    finishFractionCancellations(equation, [cancellation])
    expect(equation.history.undo()?.left).toEqual(marked)
    expect(equation.history.undo()?.left).toEqual(createEquation('(3x)/3=1').left)
  })

  it('direct cancellation remains one undoable action and never reduces the other side', () => {
    const equation = createEquation('(3x)/3=6/3')
    const before = cloneNode(equation.left)
    cancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])
    expect(equation.prettyPrint()).toBe('x = 6/3')
    expect(equation.history.undo()?.left).toEqual(before)
    expect(equation.history.canUndo()).toBe(false)
  })
})

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
  it('merges signed numerator terms without cancelling or changing the denominator', () => {
    const equation = createEquation('(7-3)/2=2')
    expect(mergeNestedTerms(equation, 'left', 0, [0], 0, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('4/2 = 2')
    expect(equation.history.undo()?.left).toEqual(createEquation('(7-3)/2=2').left)
  })

  it('merges only the selected nested terms and preserves the rest', () => {
    const equation = createEquation('(7-3+x)/2=2')
    expect(mergeNestedTerms(equation, 'left', 0, [0], 1, 0)).toBe(true)
    expect(equation.prettyPrint()).toBe('(4 + x)/2 = 2')
  })

  it('does not mutate history or the fraction when nested terms cannot merge', () => {
    const equation = createEquation('(x+3)/2=2')
    expect(mergeNestedTerms(equation, 'left', 0, [0], 0, 1)).toBe(false)
    expect(equation.prettyPrint()).toBe('(x + 3)/2 = 2')
    expect(equation.history.canUndo()).toBe(false)
  })

  it('merges nested denominator terms using their own path', () => {
    const equation = createEquation('x/(7-3)=2')
    expect(mergeNestedTerms(equation, 'left', 0, [1], 0, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('x/4 = 2')
  })

  it('checks cancellation without changing the model or history', () => {
    const equation = createEquation('(6x)/3=1')
    const before = equation.prettyPrint()
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])).toBe(true)
    expect(equation.prettyPrint()).toBe(before)
    expect(equation.history.canUndo()).toBe(false)
  })

  it('checks individual factors in numerator and denominator products', () => {
    const equation = createEquation('(2(3)x)/(5(6))=1')
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 1], [1, 1])).toBe(true)
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 1], [1, 0])).toBe(false)
    expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 2], [1, 1])).toBe(false)
  })

  it.each(['(6x+2)/3=1', '(5x)/3=1', '(6x)/0=1'])(
    'rejects illegal cancellation in %s', (source) => {
      const equation = createEquation(source)
      expect(canCancelFractionFactors(equation, 'left', 0, [], [0, 0], [1])).toBe(false)
    },
  )

  it.each(['before', 'after'] as const)('inserts a teller factor %s its existing denominator', (placement) => {
    const equation = createEquation('(5x)/3=1/7')
    divideAllBySelectedFactor(equation, 'left', 0, [0, 0], 5, placement, 'before')
    expect(equation.prettyPrint()).toBe(placement === 'before'
      ? '5 · x/(5 · 3) = 1/(5 · 7)'
      : '5 · x/(3 · 5) = 1/(5 · 7)')
  })

  it.each(['before', 'after'] as const)('moves a teller factor %s the opposite denominator', (placement) => {
    const equation = createEquation('(5x)/3=1/7')
    moveFactorAcrossEquals(equation, 'left', 0, [0, 0], 5, placement)
    expect(equation.prettyPrint()).toBe(placement === 'before'
      ? 'x/3 = 1/(5 · 7)'
      : 'x/3 = 1/(7 · 5)')
  })

  it.each(['before', 'after'] as const)('multiplies a fraction numerator %s the sum', (placement) => {
    const equation = createEquation('(x+2)/3=1')
    multiplyAllBySelectedFactor(equation, 'left', 0, [1], 3, placement)
    expect(equation.prettyPrint()).toBe(placement === 'before'
      ? '3 · (x + 2)/3 = 3 · 1'
      : '(x + 2) · 3/3 = 3 · 1')
  })

  it.each(['before', 'after'] as const)('moves a denominator %s the opposite expression', (placement) => {
    const equation = createEquation('(x+2)/3=1')
    moveFactorAcrossEquals(equation, 'left', 0, [1], 3, placement)
    expect(equation.prettyPrint()).toBe(placement === 'before'
      ? 'x + 2 = 3 · 1'
      : 'x + 2 = 1 · 3')
  })

  it.each([1, 4, -2])('evaluates a denominator dropped directly onto numeric target %i', (value) => {
    const equation = createEquation(`(x+2)/3=${value}`)
    moveFactorAcrossEquals(equation, 'left', 0, [1], 3, 'after', true)
    expect(equation.left.operands).toEqual([variable('x'), num(2)])
    expect(equation.right.operands).toEqual([num(3 * value)])
    expect(equation.history.entries).toHaveLength(2)
    expect(equation.history.undo()?.left).toEqual(createEquation(`(x+2)/3=${value}`).left)
  })

  it('respects the opposite slot when the source has several terms', () => {
    const equation = createEquation('x/3+2=1')
    moveFactorAcrossEquals(equation, 'left', 0, [1], 3, 'after')
    expect(equation.prettyPrint()).toBe('3 · x/3 + 3 · 2 = 1 · 3')
  })

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

  it('divides both sides when dropping a numerator factor below its fraction', () => {
    const equation = createEquation('x=4/2')
    divideAllBySelectedFactor(equation, 'right', 0, [0])
    expect(equation.prettyPrint()).toBe('x/4 = 4/(2 · 4)')
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

  it('keeps visible reduced factors until the cancellation is confirmed', () => {
    const equation = createEquation('4/2=2')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0], [1])
    expect(cancellation).toMatchObject({
      numeratorOriginal: 4,
      numeratorReduced: 2,
      denominatorOriginal: 2,
      denominatorReduced: 1,
    })
    expect(equation.prettyPrint()).toBe('2/1 = 2')
    simplifyEquation(equation)
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

  it('makes an exposed numerator sum movable before evaluating the opposite product', () => {
    const equation = createEquation('(x+2)/3=1')
    moveFactorAcrossEquals(equation, 'left', 0, [1], 3)
    expect(equation.prettyPrint()).toBe('x + 2 = 1 · 3')
    expect(equation.left.operands).toEqual([variable('x'), num(2)])
    expect(equation.right.operands).toEqual([op('mul', [num(1), num(3)])])
    moveOperandBetweenSides(equation, 'left', 1)
    expect(equation.prettyPrint()).toBe('x = 3 - 2')
    expect(equation.history.undo()?.left.operands).toEqual([variable('x'), num(2)])
    expect(equation.history.undo()?.left).toEqual(createEquation('(x+2)/3=1').left)
  })

  it('exposes a sum on the right but retains grouping while a denominator remains', () => {
    const equation = createEquation('1=(x-2)/3')
    moveFactorAcrossEquals(equation, 'right', 0, [1], 3)
    expect(equation.right.operands).toHaveLength(2)
    moveOperandBetweenSides(equation, 'right', 1)
    expect(equation.prettyPrint()).toBe('3 + 2 = x')
    const fraction = createEquation('(x+2)/(3(2))=1')
    moveFactorAcrossEquals(fraction, 'left', 0, [1, 0], 3)
    expect(fraction.prettyPrint()).toBe('(x + 2)/2 = 1 · 3')
    expect(fraction.left.operands).toHaveLength(1)
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
    expect(equation.prettyPrint()).toBe('x = 2 · 1')
  })
})

describe('equation actions and history', () => {
  it('records direct cancellation with its completed result in one undo step', () => {
    const equation = createEquation('6/(-2)=1')
    const before = cloneEquation(equation)
    cancelFractionFactors(equation, 'left', 0, [], [0], [1])
    expect(equation.prettyPrint()).toBe('-3 = 1')
    expect(equation.history.entries).toHaveLength(2)
    expect(equation.history.entries[1]).toContain('-3 = 1')
    expect(equation.history.undo()).toEqual(before)
  })

  it.each(['before', 'after'] as const)('keeps distributed products unevaluated when inserted %s', (placement) => {
    const equation = createEquation('3(x+2)=12')
    const before = cloneEquation(equation)
    distributeFactor(equation, 'left', 0, [], 0, 1, placement, false)
    expect(equation.left.operands).toEqual(placement === 'before'
      ? [op('mul', [num(3), variable('x')]), op('mul', [num(3), num(2)])]
      : [op('mul', [variable('x'), num(3)]), op('mul', [num(2), num(3)])])
    expect(equation.history.undo()).toEqual(before)
  })

  it('evaluates all distributed numeric products on a numeric factor drop', () => {
    const equation = createEquation('3(2x+4)=12')
    distributeFactor(equation, 'left', 0, [], 0, 1, 'after', true)
    expect(equation.left.operands).toEqual([op('mul', [num(6), variable('x')]), num(12)])
  })

  it('distributes a selected coefficient into every parenthesized term', () => {
    const equation = createEquation('3(x+1)=12')
    distributeFactor(equation, 'left', 0, [], 0, 1)
    expect(equation.prettyPrint()).toBe('3 · x + 3 = 12')
    expect(equation.left.operands).toEqual([op('mul', [num(3), variable('x')]), num(3)])
    expect(equation.history.undo()?.left).toEqual(createEquation('3(x+1)=12').left)
  })

  it('distributes a negative coefficient without merging separate sum terms', () => {
    const equation = createEquation('-2(x-3+1)=8')
    distributeFactor(equation, 'left', 0, [], 0, 1)
    expect(equation.prettyPrint()).toBe('-2 · x + 6 - 2 = 8')
  })

  it('preserves other product factors when distributing one factor', () => {
    const equation = createEquation('2(3)(x+1)=12')
    distributeFactor(equation, 'left', 0, [], 1, 2)
    expect(equation.prettyPrint()).toBe('2 · (3 · x + 3) = 12')
  })

  it('distributes inside a numerator without cancelling its denominator', () => {
    const equation = createEquation('(x+2)/3=1')
    multiplyAllBySelectedFactor(equation, 'left', 0, [1], 3)
    const before = cloneEquation(equation)
    distributeFactor(equation, 'left', 0, [0], 0, 1)
    expect(equation.prettyPrint()).toBe('(3 · x + 6)/3 = 3 · 1')
    expect(equation.history.undo()).toEqual(before)
  })

  it('cancels only the dragged denominator when another equal coefficient is present', () => {
    const equation = createEquation('(x+2)/3=1')
    multiplyAllBySelectedFactor(equation, 'left', 0, [1], 3)
    moveFactorAcrossEquals(equation, 'left', 0, [1], 3)
    expect(equation.prettyPrint()).toBe('3 · (x + 2) = 3 · 1 · 3')
  })

  it('evaluates minus x over minus one directly by selecting both minus factors', () => {
    const equation = createEquation('(-x)/(-1)=7')
    expect(canEvaluateNegativeUnitFraction(equation, 'left', 0, [], [0, 0], [1])).toBe(true)
    evaluateNegativeUnitFraction(equation, 'left', 0, [], [0, 0], [1])
    expect(equation.left.operands).toEqual([variable('x')])
    expect(equation.history.entries.length).toBe(2)
    expect(equation.history.undo()?.left.operands).toEqual([
      op('div', [op('mul', [num(-1), variable('x')]), num(-1)]),
    ])
  })

  it('keeps the denominator minus during magnitude cancellation and finishes at -3', () => {
    const equation = createEquation('x=6/(-2)')
    const cancellation = showFractionCancellation(equation, 'right', 0, [], [0], [1])
    expect(cancellation.numeratorReduced).toBe(3)
    expect(cancellation.denominatorReduced).toBe(-1)
    expect(equation.prettyPrint()).toBe('x = 3/(-1)')
    expect(equation.history.entries.at(-1)).toContain('Forkortet brøken med 2')
    finishFractionCancellations(equation, [cancellation])
    expect(equation.right.operands).toEqual([num(-3)])
  })

  it.each([4, -4])('evaluates %i/(-1) directly with one undo step', (value) => {
    const equation = createEquation(`x=(${value})/(-1)`)
    expect(canEvaluateNegativeUnitFraction(equation, 'right', 0, [], [0], [1])).toBe(true)
    evaluateNegativeUnitFraction(equation, 'right', 0, [], [0], [1])
    expect(equation.right.operands).toEqual([num(-value)])
    expect(equation.history.entries.at(-1)).toContain('Regnet ut')
    expect(equation.history.undo()?.right.operands).toEqual([op('div', [num(value), num(-1)])])
  })

  it('does not evaluate just a coefficient or a detached minus as the full fraction', () => {
    const equation = createEquation('4x/(-1)=4/(-2)')
    expect(canEvaluateNegativeUnitFraction(equation, 'left', 0, [], [0, 0], [1])).toBe(false)
    expect(canEvaluateNegativeUnitFraction(equation, 'right', 0, [], [0], [1, 0])).toBe(false)
  })

  it('reduces negative twos with their negative common factor', () => {
    const equation = createEquation('(-2)/(-2)=1')
    const first = showFractionCancellation(equation, 'left', 0, [], [0], [1])
    expect(first.numeratorReduced).toBe(1)
    expect(first.denominatorReduced).toBe(1)
    expect(equation.history.entries.at(-1)).toContain('Forkortet brøken med -2')
    finishFractionCancellations(equation, [first])
    expect(equation.prettyPrint()).toBe('1 = 1')
  })

  it('still cancels an existing pair of negative ones', () => {
    const equation = createEquation('(-1)/(-1)=1')
    const second = showFractionCancellation(equation, 'left', 0, [], [0], [1])
    expect(second.numeratorReduced).toBe(1)
    expect(second.denominatorReduced).toBe(1)
    finishFractionCancellations(equation, [second])
    expect(equation.prettyPrint()).toBe('1 = 1')
  })

  it('cancels -4 from both numerator coefficient and denominator directly', () => {
    const equation = createEquation('(-4x)/(-4)=0/(-4)')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1])
    expect(cancellation.numeratorReduced).toBe(1)
    expect(cancellation.denominatorReduced).toBe(1)
    expect(equation.history.entries.at(-1)).toContain('Forkortet brøken med -4')
    finishFractionCancellations(equation, [cancellation])
    expect(equation.prettyPrint()).toBe('x = 0/(-4)')
  })

  it('cancels detached minus factors without cancelling their magnitudes', () => {
    const equation = createEquation('(-2)/(-3)=1')
    const cancellation = showFractionCancellation(equation, 'left', 0, [], [0, 0], [1, 0])
    expect(cancellation.numeratorReduced).toBe(1)
    expect(cancellation.denominatorReduced).toBe(1)
    finishFractionCancellations(equation, [cancellation])
    expect(equation.prettyPrint()).toBe('2/3 = 1')
  })

  it('detaches the negative-one factor from a negative numeric term', () => {
    const equation = createEquation('-2=-x')
    moveFactorAcrossEquals(equation, 'left', 0, [0], -1)
    expect(equation.left.operands).toEqual([num(2)])
    expect(equation.prettyPrint()).toBe('2 = -1 · x/(-1)')
    expect(equation.history.undo()?.left.operands).toEqual([num(-2)])
  })

  it('represents minus x as a sum containing the negative-one factor', () => {
    const equation = createEquation('-x=5')
    expect(equation.left).toEqual(op('add', [op('mul', [num(-1), variable('x')])]))
    moveFactorAcrossEquals(equation, 'left', 0, [0], -1)
    expect(equation.prettyPrint()).toBe('x = 5/(-1)')
  })

  it.each([0, 1])('replaces a lone destination zero instead of inserting beside it at %i', (index) => {
    const equation = createEquation('2x-4=0')
    expect(moveOperandToPosition(equation, 'left', 0, 'right', index)).toBe(true)
    expect(equation.prettyPrint()).toBe('-4 = -2 · x')
    expect(equation.right.operands).toEqual([op('mul', [num(-2), variable('x')])])
    const restored = equation.history.undo()
    expect(restored?.right.operands).toEqual([num(0)])
  })

  it('inserts a constant into a zero side without recording a merge', () => {
    const equation = createEquation('3+x=0')
    expect(moveOperandToPosition(equation, 'left', 0, 'right', 0, 0)).toBe(true)
    expect(equation.prettyPrint()).toBe('x = -3')
    expect(equation.right.operands).toEqual([num(-3)])
    expect(equation.history.entries.at(-1)).not.toContain('Flyttet og slo sammen ledd')
  })

  it('inserts a moved term at a selected position without evaluating neighbouring terms', () => {
    const equation = createEquation('2x=7-3')
    expect(moveOperandToPosition(equation, 'right', 0, 'right', 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x = -3 + 7')
    expect(equation.right.operands).toEqual([op('mul', [num(-1), num(3)]), num(7)])
  })

  it.each([
    [2, '2 · x + 3 - 7 = 0'],
    [1, '2 · x - 7 + 3 = 0'],
    [0, '-7 + 2 · x + 3 = 0'],
  ])('inserts 7 across equals at position %i without merging', (index, expected) => {
    const equation = createEquation('2x+3=7')
    expect(moveOperandToPosition(equation, 'right', 0, 'left', index)).toBe(true)
    expect(equation.prettyPrint()).toBe(expected)
    expect(equation.right.operands).toEqual([num(0)])
  })

  it.each([1, 2])('merges with exactly 3 on either half of its chip (position %i)', (index) => {
    const equation = createEquation('2x+3=7')
    expect(moveOperandToPosition(equation, 'right', 0, 'left', index, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x - 4 = 0')
    const restored = equation.history.undo()
    expect(restored).toBeDefined()
    equation.left = restored!.left
    equation.right = restored!.right
    expect(equation.prettyPrint()).toBe('2 · x + 3 = 7')
  })

  it('does not merge an incompatible target with a different compatible neighbour', () => {
    const equation = createEquation('5+2x=7')
    expect(moveOperandToPosition(equation, 'right', 0, 'left', 1, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('5 - 7 + 2 · x = 0')
  })

  it.each([
    [0, '3 = -2 · x + 7'],
    [1, '3 = 7 - 2 · x'],
  ])('moves the entire 2x term to the right at position %i', (index, expected) => {
    const equation = createEquation('2x+3=7')
    expect(moveOperandToPosition(equation, 'left', 0, 'right', index)).toBe(true)
    expect(equation.prettyPrint()).toBe(expected)
  })

  it('cancels original-position moves and reorders around remaining source terms', () => {
    const equation = createEquation('2x=7+x')
    const count = equation.history.entries.length
    expect(moveOperandToPosition(equation, 'right', 0, 'right', 0)).toBe(false)
    expect(equation.history.entries.length).toBe(count)
    expect(moveOperandToPosition(equation, 'right', 0, 'right', 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x = x + 7')
  })

  it.each([0, 1])('moves 3 to 7 and merges at position %i', (index) => {
    const equation = createEquation('2x+3=7')
    expect(moveOperandToPosition(equation, 'left', 1, 'right', index, 0)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x = 4')
  })

  it('merges numeric terms when dropped directly onto a negative term', () => {
    const equation = createEquation('2x=7-3')
    expect(moveOperandToPosition(equation, 'right', 0, 'right', 0, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x = 4')
    expect(equation.right.operands).toEqual([num(4)])
    expect(equation.history.entries.at(-1)).toContain('Flyttet og slo sammen ledd')
  })

  it('merges a positive term dropped onto a leading negative term', () => {
    const equation = createEquation('2x=-3+7')
    expect(moveOperandToPosition(equation, 'right', 1, 'right', 0, 0)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x = 4')
    expect(equation.right.operands).toEqual([num(4)])
  })

  it('moves a term across equals into the selected position and flips its sign', () => {
    const equation = createEquation('2x=7-3')
    expect(moveOperandToPosition(equation, 'right', 0, 'left', 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x - 7 = -3')
    expect(equation.left.operands).toEqual([op('mul', [num(2), variable('x')]), num(-7)])
    expect(equation.right.operands).toEqual([op('mul', [num(-1), num(3)])])
  })

  it('merges a moved term with the destination term when dropped onto it across equals', () => {
    const equation = createEquation('2x-3=7')
    expect(moveOperandToPosition(equation, 'right', 0, 'left', 1, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 · x - 10 = 0')
    expect(equation.left.operands).toEqual([op('mul', [num(2), variable('x')]), num(-10)])
    expect(equation.right.operands).toEqual([num(0)])
  })

  it('swaps adjacent equation terms without changing their signs', () => {
    const equation = createEquation('-2x-4+x=-x-9')
    expect(swapEquationTerms(equation, 'left', 1, 2)).toBe(true)
    expect(equation.prettyPrint()).toBe('-2 · x + x - 4 = -x - 9')
    expect(equation.history.entries.at(-1)).toContain('Byttet om på to ledd')
  })

  it('swaps adjacent factors without multiplying or simplifying them', () => {
    const equation = createEquation('-2x=0')
    expect(swapFactors(equation, 'left', 0, [], 0, 1)).toBe(true)
    expect(equation.left.operands[0]).toEqual(op('mul', [variable('x'), num(-2)]))
    expect(equation.history.entries.at(-1)).toContain('Byttet om på to faktorer')
  })

  it('swaps the coefficient with x while preserving the remaining equation', () => {
    const equation = createEquation('2x+3=7')
    expect(swapFactors(equation, 'left', 0, [], 0, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('x · 2 + 3 = 7')
    expect(equation.left.operands[0]).toEqual(op('mul', [variable('x'), num(2)]))
  })

  it('swaps adjacent terms inside a nested sum', () => {
    const equation = createEquation('x=0')
    equation.left.operands = [op('add', [variable('x'), num(2)])]
    expect(swapNestedTerms(equation, 'left', 0, [], 0, 1)).toBe(true)
    expect(equation.prettyPrint()).toBe('2 + x = 0')
  })

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
