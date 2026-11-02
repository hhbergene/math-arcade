import { describe, expect, it } from 'vitest'
import { cancellationCorridor, dropPlacement, dropRectContains, enclosingDropRect, termDropPosition } from './dropGeometry'

describe('unified fraction drop geometry', () => {
  it('includes chips, gaps, both alternatives and shifted placement in one area', () => {
    const rect = enclosingDropRect([
      { left: 50, right: 130, top: 30, bottom: 65 },
      { left: 10, right: 40, top: 30, bottom: 65 },
      { left: 140, right: 170, top: 30, bottom: 65 },
      { left: 160, right: 190, top: 30, bottom: 65 },
    ])
    expect(dropRectContains(rect, 45, 40)).toBe(true)
    expect(dropRectContains(rect, 189, 40)).toBe(true)
    expect(dropRectContains(rect, 191, 40)).toBe(false)
    expect(dropPlacement(rect, 99)).toBe('before')
    expect(dropPlacement(rect, 100)).toBe('after')
  })

  describe('signed term drop geometry', () => {
    const targets = [
      { index: 0, rect: { left: 10, right: 90, top: 20, bottom: 60 }, compatible: false },
      { index: 1, rect: { left: 110, right: 170, top: 20, bottom: 60 }, compatible: true },
    ]

    it('distinguishes all four positions and both halves of the signed constant', () => {
      expect(termDropPosition(targets, 180, 40)).toEqual({ index: 2, placement: 'after', mergeTargetIndex: undefined })
      expect(termDropPosition(targets, 160, 40)).toEqual({ index: 2, placement: 'after', mergeTargetIndex: 1 })
      expect(termDropPosition(targets, 120, 40)).toEqual({ index: 1, placement: 'before', mergeTargetIndex: 1 })
      expect(termDropPosition(targets, 100, 40)).toEqual({ index: 1, placement: 'before', mergeTargetIndex: undefined })
      expect(termDropPosition(targets, 40, 40)).toEqual({ index: 0, placement: 'before', mergeTargetIndex: undefined })
    })

    it('uses the signed midpoint and never merges above or below a chip', () => {
      expect(termDropPosition(targets, 139, 40).placement).toBe('before')
      expect(termDropPosition(targets, 140, 40).placement).toBe('after')
      expect(termDropPosition(targets, 140, 19).mergeTargetIndex).toBeUndefined()
      expect(termDropPosition(targets, 140, 61).mergeTargetIndex).toBeUndefined()
      expect(termDropPosition([], 140, 40).index).toBe(0)
    })
  })

  it('mirrors cancellation corridors and includes exactly ten pixels beyond the line', () => {
    const above = cancellationCorridor({ left: 20, right: 54, top: 10, bottom: 44 }, 60)
    const below = cancellationCorridor({ left: 20, right: 54, top: 76, bottom: 110 }, 60)
    expect(above).toEqual({ left: 20, right: 54, top: 10, bottom: 70 })
    expect(below).toEqual({ left: 20, right: 54, top: 50, bottom: 110 })
    expect(dropRectContains(below, 54, 50)).toBe(true)
    expect(dropRectContains(below, 55, 60)).toBe(false)
    expect(dropRectContains(below, 30, 49)).toBe(false)
  })
})
