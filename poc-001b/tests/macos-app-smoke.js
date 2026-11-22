(() => {
  if (window.__knowpaperSmokeStarted) return
  window.__knowpaperSmokeStarted = true
  const start = performance.now()
  const timings = {}
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args)
  const wait = async (name, find, timeout = 30_000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const result = find()
      if (result) return result
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(name + ': ' + [...document.querySelectorAll('[role=alert]')].map(n => n.textContent).join('; '))
  }
  const enabled = (name) => [...document.querySelectorAll('button:enabled')].find(b => b.textContent.trim() === name)
  const click = async name => (await wait(name, () => enabled(name))).click()
  const elapsed = begin => Math.round(performance.now() - begin)
  const reject = (name, params) => invoke(name, params).then(
    () => { throw new Error(name + ' unexpectedly succeeded') },
    error => String(error),
  )

  async function run() {
    check(await invoke('database_status') === 9, 'Schema 9')
    check((await invoke('list_subjects')).length === 9, 'nine subjects')
    timings.schemaAndSubjectsMs = elapsed(start)
    await click('旧版 JSON 演示')
    await click('题卷预览')
    let begin = performance.now()
    await click('导出当前 PDF')
    const status = await wait('single PDF', () => document.querySelector('.status')?.textContent.match(/PDF 已保存到 (.+)/))
    const single = status[1]
    timings.singleMs = elapsed(begin)

    const faults = {}
    const exerciseFaults = window.__knowpaperPrintFaults === true
    if (exerciseFaults) {
      const singleRequest = { kind: 'paper', longSample: false, revisionId: null }
      faults.start = await reject('export_pdf', singleRequest)
      check(faults.start.includes('无法开始打印'), faults.start)
      begin = performance.now()
      const late = reject('export_pdf', singleRequest)
      await new Promise(resolve => setTimeout(resolve, 200))
      faults.concurrent = await reject('export_pdf', singleRequest)
      check(faults.concurrent.includes('另一项打印任务'), faults.concurrent)
      faults.timeout = await late
      check(faults.timeout.includes('打印超时'), faults.timeout)
      timings.timeoutMs = elapsed(begin)
      faults.quarantined = await reject('export_pdf', singleRequest)
      check(faults.quarantined.includes('重新打开知卷'), faults.quarantined)
      begin = performance.now()
      for (;;) {
        const result = await invoke('export_pdf', singleRequest).then(
          path => ({ path }), error => ({ error: String(error) }),
        )
        if (result.path) {
          check(result.path === single, 'retry wrote an unexpected file')
          break
        }
        check(result.error.includes('重新打开知卷') && elapsed(begin) < 15_000, result.error)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      timings.recoveryMs = elapsed(begin)
    }

    const papers = await invoke('list_compositions')
    const pairs = {}
    for (const count of [20, 30, 50]) {
      const id = papers.find(p => p.title === 'DEV-012 原创混合卷 ' + count)?.id
      check(id, 'missing composition ' + count)
      const preview = await invoke('preview_composition', { id })
      check(preview.paper.entries.length === count && preview.answers.entries.length === count, 'wrong snapshot size')
      if (count === 20) {
        const rejected = await invoke('export_composition', { id, identity: 'wrong-identity', confirmed: true })
          .then(() => false, () => true)
        check(rejected, 'snapshot mismatch accepted')
        if (exerciseFaults) {
          faults.closedAnswer = await reject('export_composition', { id, identity: preview.identity, confirmed: true })
          check(faults.closedAnswer.includes('打印窗口已关闭'), faults.closedAnswer)
        }
      }
      begin = performance.now()
      const result = await invoke('export_composition', { id, identity: preview.identity, confirmed: true })
      check(result.paper && result.answers, 'PDF pair incomplete')
      pairs[count] = result
      timings['pair' + count + 'Ms'] = elapsed(begin)
    }

    let tables
    const tablePaper = papers.find(p => p.title === 'DEV-013 原创表格混合卷 20')
    if (tablePaper) {
      await click('SQLite 题库')
      const question = await wait('table question', () =>
        document.querySelector('button[data-question-id="dev013-structured-table"]:enabled'))
      question.click()
      await wait('table editor', () => document.querySelector('.tiptap table')?.rows.length === 61)
      tables = {}
      for (const [kind, button] of [['paper', '题卷预览'], ['answers', '答案卷预览']]) {
        await click(button)
        await wait('rendered table', () => document.querySelector('.paper .rich-table'))
        const mathBase = document.querySelector('.rich-table .katex .base')
        check(mathBase && getComputedStyle(mathBase).whiteSpace === 'nowrap',
          'KaTeX must keep the tokens within each formula group together')
        await wait('table attachments ready', () => !document.querySelector('.paper .attachment-notice'))
        await click('导出当前 PDF')
        const saved = await wait('table ' + kind + ' PDF', () =>
          document.querySelector('.status')?.textContent.match(/PDF 已保存到 (.+)/))
        tables[kind] = saved[1]
      }
      const { id } = tablePaper
      const preview = await invoke('preview_composition', { id })
      check(preview.paper.entries.length === 20 && preview.answers.entries.length === 20, 'wrong table snapshot size')
      tables.pair = await invoke('export_composition', { id, identity: preview.identity, confirmed: true })
    }

    await click('试卷库')
    const source = await wait('registered original PDF', () =>
      [...document.querySelectorAll('.paper-library-list button[title^="SHA-256"]')]
        .find(button => button.textContent.includes('dev012-scan')))
    begin = performance.now()
    source.click()
    const canvas = () => document.querySelector('.reader-workspace .pdf-reading-area canvas')
    await wait('PDF.js first page rendered', () => canvas()?.width > 0 &&
      Boolean(canvas().getContext('2d').getImageData(4, 4, 1, 1).data[3]))
    const page = () => document.querySelector('[aria-label="跳转页码"]')
    check(page()?.max === '100', 'wrong PDF.js page count')
    timings.pdfFirstPageMs = elapsed(begin)
    begin = performance.now()
    await click('下一页')
    await wait('jump and draw second page', () => page()?.value === '2' &&
      Boolean(canvas()?.getContext('2d').getImageData(4, 4, 1, 1).data[3]))
    timings.pdfNextPageMs = elapsed(begin)
    return { ok: true, single, pairs, tables, timings, faults, originalPages: Number(page().max) }
  }
  run().then(result => { window.__knowpaperSmokeResult = result }, error => {
    window.__knowpaperSmokeResult = { ok: false, error: error?.message ?? String(error), timings }
  })
})()
