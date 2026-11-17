import { difficulties } from './metadata-api'
import { reviewLabels } from './sqlite-api'
import type { SearchFilters, TextCondition } from './knowledge-api'
import type { ReviewStatus } from './sqlite-api'

const textFields = [
  ['地区', 'region'], ['来源', 'source'], ['标签', 'tag'], ['题型', 'questionType'],
] as const

export const sortLabels = { id: '逻辑题 ID', year: '年份', difficulty: '难度' } as const

function TextField({ label, value, change }: { label: string; value: TextCondition; change: (value: TextCondition) => void }) {
  return <div className="search-text-condition">
    <label>{label} <input aria-label={label} maxLength={120} value={value.text} disabled={value.missing}
      onChange={(event) => change({ ...value, text: event.target.value })} /></label>
    <label className="check"><input type="checkbox" aria-label={label + '未标注'} checked={value.missing}
      onChange={(event) => change({ ...value, missing: event.target.checked })} />未标注</label>
  </div>
}

export function AdvancedFilters({ filters, update, busy }: {
  filters: SearchFilters; update: (value: Partial<SearchFilters>) => void; busy: boolean
}) {
  return <details className="advanced-filters">
    <summary>高级筛选与排序</summary>
    <fieldset className="metadata-fields" disabled={busy}>
      <label>起始年份 <input aria-label="起始年份" type="number" min={1} max={9999} disabled={filters.yearUnknown}
        value={filters.yearFrom} onChange={(event) => update({ yearFrom: event.target.value })} /></label>
      <label>截止年份 <input aria-label="截止年份" type="number" min={1} max={9999} disabled={filters.yearUnknown}
        value={filters.yearTo} onChange={(event) => update({ yearTo: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={filters.yearUnknown} onChange={(event) =>
        update({ yearUnknown: event.target.checked })} />年份未标注</label>
      {textFields.map(([label, field]) => <TextField key={field} label={label} value={filters[field]}
        change={(value) => update({ [field]: value })} />)}
      <label>难度 <select aria-label="筛选难度" value={filters.difficulty} onChange={(event) => update({ difficulty: event.target.value })}>
        <option value="">不限</option><option value="0">未标注</option>
        {difficulties.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
      </select></label>
      <label>审核状态 <select aria-label="审核状态" value={filters.review} onChange={(event) => update({ review: event.target.value as ReviewStatus | '' })}>
        <option value="">不限</option>
        {Object.entries(reviewLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>排序 <select aria-label="排序字段" value={filters.sort} onChange={(event) => update({ sort: event.target.value as SearchFilters['sort'] })}>
        {Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>方向 <select aria-label="排序方向" value={filters.descending ? 'desc' : 'asc'}
        onChange={(event) => update({ descending: event.target.value === 'desc' })}>
        <option value="asc">升序</option><option value="desc">降序</option>
      </select></label>
    </fieldset>
  </details>
}

export function appliedConditions(filters: SearchFilters, subject: string, point: string): string[] {
  const conditions = [subject, point && point + (filters.descendants ? '（含下级）' : '（直属）'), filters.keyword.trim() && '关键词 ' + filters.keyword.trim()]
  if (filters.yearUnknown) conditions.push('年份未标注')
  else if (filters.yearFrom || filters.yearTo) conditions.push('年份 ' + (filters.yearFrom || '不限') + '–' + (filters.yearTo || '不限'))
  for (const [label, field] of textFields) {
    const { text, missing } = filters[field]
    if (missing) conditions.push(label + '未标注')
    else if (text.trim()) conditions.push(label + ' ' + text.trim())
  }
  if (filters.difficulty) conditions.push('难度 ' + (difficulties[Number(filters.difficulty) - 1] ?? '未标注'))
  if (filters.review) conditions.push(reviewLabels[filters.review])
  return conditions.filter(Boolean)
}
