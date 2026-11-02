import type { History } from '../model/history'

export function renderHistoryPanel(history: History): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'history-panel'
  panel.setAttribute('aria-label', 'Historikk')

  const list = document.createElement('ol')
  list.className = 'history-list'
  list.setAttribute('aria-live', 'polite')
  for (const entry of history.entries) {
    const item = document.createElement('li')
    item.textContent = entry
    list.append(item)
  }
  panel.append(list)
  return panel
}
