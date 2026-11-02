export type DropRect = { left: number; right: number; top: number; bottom: number }

export function enclosingDropRect(rects: DropRect[]): DropRect {
  if (rects.length === 0) throw new Error('Et slippomrade trenger minst ett rektangel.')
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right)),
    top: Math.min(...rects.map((rect) => rect.top)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }
}

export function dropRectContains(rect: DropRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function dropPlacement(rect: DropRect, x: number): 'before' | 'after' {
  return x < (rect.left + rect.right) / 2 ? 'before' : 'after'
}

export function cancellationCorridor(chip: DropRect, lineY: number): DropRect {
  return { left: chip.left, right: chip.right, top: Math.min(chip.top, lineY - 10),
    bottom: Math.max(chip.bottom, lineY + 10) }
}

export type TermDropTarget = { index: number; rect: DropRect; compatible: boolean }
export type TermDropPosition = { index: number; mergeTargetIndex?: number; placement: 'before' | 'after' }

export function termDropPosition(targets: readonly TermDropTarget[], x: number, y: number): TermDropPosition {
  if (!targets.length) return { index: 0, placement: 'before' }
  const hit = targets.findIndex((target) => dropRectContains(target.rect, x, y))
  const nearest = hit >= 0 ? hit : targets.reduce((best, target, index) => {
    const distance = Math.abs(x - (target.rect.left + target.rect.right) / 2)
    const bestDistance = Math.abs(x - (targets[best].rect.left + targets[best].rect.right) / 2)
    return distance < bestDistance ? index : best
  }, 0)
  const target = targets[nearest]
  const placement = dropPlacement(target.rect, x)
  return {
    index: nearest + (placement === 'after' ? 1 : 0),
    placement,
    mergeTargetIndex: hit >= 0 && target.compatible ? target.index : undefined,
  }
}
