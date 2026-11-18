
import { useEffect, useState } from 'react'
import { paperReader } from './paper-reader-api'
import type { Location } from './paper-reader-api'
import { describeError } from './sqlite-api'

export function PaperLocations({ questionId, open, disabled }: {
  questionId: string; open: (location: Location) => void; disabled?: boolean
}) {
  const [locations, setLocations] = useState<Location[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void paperReader.questionLocations(questionId).then((rows) => {
      if (active) setLocations(rows)
    }).catch((reason: unknown) => { if (active) setError(describeError(reason)) })
    return () => { active = false }
  }, [questionId])

  if (error) return <p role="alert">{error}</p>
  if (!locations.length) return null
  return <section className="paper-sources" aria-label="PDF 原卷定位">
    {locations.map((location) => <button key={location.file_id + location.source_key + location.ordinal}
      disabled={disabled} onClick={() => open(location)}>
      查看原卷 · {location.title} · 第 {location.page_index + 1} 页 · {location.file_id.slice(0, 8)}
      {location.ordinal > 0 ? ' · 区域 ' + (location.ordinal + 1) : ''}
    </button>)}
  </section>
}
