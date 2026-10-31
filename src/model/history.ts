import { cloneEquation, type EquationSnapshot } from './node'
import { prettyPrintEquation } from './prettyPrint'

export class History {
  readonly entries: string[] = []
  private readonly snapshots: EquationSnapshot[] = []

  record(equation: EquationSnapshot, message: string): void {
    this.entries.push(`${prettyPrintEquation(equation)}  [${message}]`)
  }

  save(equation: EquationSnapshot): void {
    this.snapshots.push(cloneEquation(equation))
  }

  canUndo(): boolean {
    return this.snapshots.length > 0 && this.entries.length > 0
  }

  undo(): EquationSnapshot | undefined {
    if (!this.canUndo()) return undefined
    this.entries.pop()
    return this.snapshots.pop()
  }

  clear(): void {
    this.entries.length = 0
    this.snapshots.length = 0
  }
}
