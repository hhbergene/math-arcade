import { strings } from '../strings'
import type { History } from '../model/history'

export function renderHistoryPanel(history: History): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'history-panel'
  panel.setAttribute('aria-labelledby', 'history-title')

  const heading = document.createElement('div')
  heading.className = 'history-heading'
  const title = document.createElement('h2')
  title.id = 'history-title'
  title.textContent = strings.historyTitle
  const count = document.createElement('span')
  count.className = 'history-count'
  count.textContent = String(history.entries.length)
  heading.append(title, count)

  const list = document.createElement('ol')
  list.className = 'history-list'
  list.setAttribute('aria-live', 'polite')
  for (const entry of history.entries) {
    const item = document.createElement('li')
    item.textContent = entry
    list.append(item)
  }
  panel.append(heading, list)
  return panel
}
