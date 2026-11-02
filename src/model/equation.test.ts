import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

describe('random equation creation', () => {
  it.each([
    { values: [-4, 3, 7, 0], text: '-4 · x + 7 = 3 · x', lengths: [2, 1], solution: 1 },
    { values: [4, -3, 0, 7], text: '4 · x = -3 · x + 7', lengths: [1, 2], solution: 1 },
    { values: [2, 3, 0, 0], text: '2 · x = 3 · x', lengths: [1, 1], solution: -0 },
    { values: [2, 3, 4, 5], text: '2 · x + 4 = 3 · x + 5', lengths: [2, 2], solution: -1 },
  ])('creates $text without redundant zero terms', async ({ values, text, lengths, solution }) => {
    vi.resetModules()
    const { createEquation } = await import('./equation')
    createEquation()
    createEquation()
    const random = vi.spyOn(Math, 'random')
    values.forEach((value, index) => {
      const minimum = index < 2 ? -6 : -12
      const range = index < 2 ? 13 : 25
      random.mockReturnValueOnce((value - minimum + 0.5) / range)
    })
    const equation = createEquation()
    expect(random).toHaveBeenCalledTimes(4)
    expect(equation.prettyPrint()).toBe(text)
    expect(equation.left.operands).toHaveLength(lengths[0])
    expect(equation.right.operands).toHaveLength(lengths[1])
    expect(equation.solution).toBe(solution)
    expect(equation.history.entries).toEqual([`${text}  [Startet ny likning]`])
    expect(equation.history.canUndo()).toBe(false)
  })
})
