// Ark Coding Plan usage widget — Host/Client plugin source.
// This file is the single source of truth for the dynamic plugin that the
// dsh-ark-usage-widget bundle host plugin (index.js) re-creates on every DSH
// start.
// Edit HOST_CODE / CLIENT_CODE here; no other file needs to change.

export const HOST_CODE = `return {
  apply(ctx) {
    const CACHE_TTL_MS = 60000
    const WINDOW_5H = 5 * 3600 * 1000
    const WINDOW_7D = 7 * 86400 * 1000
    const WINDOW_30D = 30 * 86400 * 1000
    let cache = null

    function getCwd() {
      try {
        const policy = ctx.get('sandboxPolicy')
        if (policy && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot) {
          return policy.workspaceRoot
        }
      } catch (e) {}
      try {
        const fs = ctx.get('fs')
        if (fs) {
          const target = fs.resolve('.')
          if (target) return fs.processPath(target)
        }
      } catch (e) {}
      return '/'
    }

    async function runCli(subprocess, argv) {
      let exe = 'arkcli'
      try {
        exe = await subprocess.resolveExecutable('arkcli')
      } catch (e) {
        const err = new Error('未检测到 arkcli 命令行工具（请先安装 @volcengine/ark-cli）')
        err.stderr = String(e && e.message ? e.message : e)
        throw err
      }
      const handle = subprocess.spawn({
        argv: [exe].concat(argv),
        cwd: getCwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 2000000 },
          stderr: { maxBytes: 200000 }
        },
        graceMs: 3000
      })
      const outcome = await handle.done
      const out = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      const errText = handle.collected && handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
      if (outcome.exitCode !== 0) {
        const e = new Error(errText.trim() || 'arkcli 退出码 ' + outcome.exitCode)
        e.stderr = errText
        throw e
      }
      return out
    }

    function epochToIso(ts) {
      if (typeof ts !== 'number' || !(ts > 0)) return null
      return new Date(Math.round(ts * 1000)).toISOString()
    }

    async function fetchSeatMilestones(subprocess, knownSeatId) {
      try {
        let seatId = knownSeatId
        if (!seatId) {
          const out = await runCli(subprocess, ['api', 'usage.get_seat_info', '--params', '{"ProjectName":"default"}', '--format', 'json'])
          const json = JSON.parse(out)
          seatId = json && json.Result && json.Result.SeatID
        }
        if (!seatId) return null
        const params = JSON.stringify({ SeatID: String(seatId).trim(), ProjectName: 'default' })
        const out = await runCli(subprocess, ['api', 'usage.get_seat_info_usage', '--params', params, '--format', 'json'])
        const json = JSON.parse(out)
        const r = json && json.Result
        if (!r) return null
        return {
          seatId: String(seatId),
          shortTermReset: epochToIso(r.ShortTermResetMilestone),
          weeklyReset: epochToIso(r.WeeklyResetMilestone),
          monthlyReset: epochToIso(r.MonthlyResetMilestone),
          monthlySubscribe: epochToIso(r.MonthlySubscribeMilestone),
          shortTermUsage: typeof r.ShortTermUsage === 'number' ? r.ShortTermUsage : null,
          weeklyUsage: typeof r.WeeklyUsage === 'number' ? r.WeeklyUsage : null,
          monthlyUsage: typeof r.MonthlyUsage === 'number' ? r.MonthlyUsage : null
        }
      } catch (e) {
        return null
      }
    }

    function round2(v) {
      const n = Number(v)
      return isFinite(n) ? Math.round(n * 100) / 100 : 0
    }

    function cyclePercentOf(resetAtIso, windowMs) {
      if (!resetAtIso || !(windowMs > 0)) return null
      const end = Date.parse(resetAtIso)
      if (!isFinite(end)) return null
      const start = end - windowMs
      const p = ((Date.now() - start) / (end - start)) * 100
      return round2(Math.max(0, Math.min(100, p)))
    }

    function buildItems(jsonVal, milestones) {
      const items = []
      const rawItems = jsonVal && Array.isArray(jsonVal.items) ? jsonVal.items : []
      for (const item of rawItems) {
        const periods = []
        const rawPeriods = Array.isArray(item.periods) ? item.periods : []
        for (const p of rawPeriods) {
          const label = String(p.label || '').toLowerCase()
          let percent = Number(p.percent)
          if (!isFinite(percent)) percent = 0
          let resetAt = p.reset_at !== undefined && p.reset_at !== null ? String(p.reset_at) : null
          let cyclePercent = null
          let name = label
          if (label === 'session') {
            name = '近5小时用量'
            if (milestones) {
              if (milestones.shortTermReset) {
                resetAt = milestones.shortTermReset
                cyclePercent = cyclePercentOf(resetAt, WINDOW_5H)
              }
              if (milestones.shortTermUsage !== null) percent = milestones.shortTermUsage
            }
          } else if (label === 'weekly') {
            name = '近一周用量'
            if (milestones) {
              if (milestones.weeklyReset) {
                resetAt = milestones.weeklyReset
                cyclePercent = cyclePercentOf(resetAt, WINDOW_7D)
              }
              if (milestones.weeklyUsage !== null) percent = milestones.weeklyUsage
            }
          } else if (label === 'monthly') {
            name = '近一月用量'
            if (milestones) {
              if (milestones.monthlyReset) {
                resetAt = milestones.monthlyReset
                let win = WINDOW_30D
                if (milestones.monthlySubscribe) {
                  const s = Date.parse(milestones.monthlySubscribe)
                  const e = Date.parse(milestones.monthlyReset)
                  if (isFinite(s) && isFinite(e) && e > s) win = e - s
                }
                cyclePercent = cyclePercentOf(resetAt, win)
              }
              if (milestones.monthlyUsage !== null) percent = milestones.monthlyUsage
            }
          }
          const used = p.used !== undefined && p.used !== null ? Number(p.used) : null
          const total = p.total !== undefined && p.total !== null ? Number(p.total) : null
          periods.push({
            label: label,
            name: name,
            percent: round2(percent),
            remaining: round2(Math.max(0, Math.min(100, 100 - percent))),
            resetAt: resetAt,
            cyclePercent: cyclePercent,
            used: isFinite(used) ? used : null,
            total: isFinite(total) ? total : null
          })
        }
        items.push({
          product: String(item.product || 'coding-plan'),
          edition: String(item.edition || ''),
          seatId: item.seat_id !== undefined && item.seat_id !== null ? String(item.seat_id) : null,
          subscribed: item.subscribed === true,
          error: item.error !== undefined && item.error !== null ? String(item.error) : null,
          periods: periods
        })
      }
      return items
    }

    function buildViewer(jsonVal) {
      const v = jsonVal && jsonVal.viewer ? jsonVal.viewer : {}
      const out = {}
      const keys = ['user_name', 'account_id', 'profile', 'region', 'user_id']
      for (const key of keys) {
        if (v[key] !== undefined && v[key] !== null) out[key] = String(v[key])
      }
      return out
    }

    function classifyError(err) {
      const text = String(err && err.message ? err.message : err)
      const low = text.toLowerCase()
      if (/arkcli|command not found|enoent|未检测/.test(text) && /arkcli|not found|enoent|未检测/.test(low)) {
        return { message: '未检测到 arkcli 命令行工具（请先安装 @volcengine/ark-cli）', detail: text }
      }
      if (/login|auth|credential|token|未登录|登录|access.?denied|not.?logged/.test(low)) {
        return { message: '未登录火山方舟或登录已过期（运行 arkcli auth login volc-sso 重新授权）', detail: text }
      }
      return { message: '获取火山方舟配额失败', detail: text }
    }

    async function fetchUsage(force) {
      const now = Date.now()
      if (!force && cache && now - cache.at < CACHE_TTL_MS) {
        return cache.data
      }
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) {
        return { ok: false, updatedAt: now, error: 'subprocess 服务不可用', detail: null }
      }
      try {
        const planOut = await runCli(subprocess, ['usage', 'plan', '--format', 'json'])
        const planJson = JSON.parse(planOut)
        const seatId = planJson.items && planJson.items.length ? planJson.items[0].seat_id || null : null
        const milestones = await fetchSeatMilestones(subprocess, seatId)
        const data = {
          ok: true,
          updatedAt: Date.now(),
          error: null,
          detail: null,
          viewer: buildViewer(planJson),
          items: buildItems(planJson, milestones)
        }
        cache = { at: now, data: data }
        return data
      } catch (err) {
        try {
          const milestones = await fetchSeatMilestones(subprocess, null)
          if (milestones && milestones.seatId) {
            const periods = []
            const push = (label, name, usage, reset, windowMs) => {
              periods.push({
                label: label, name: name,
                percent: round2(usage), remaining: round2(Math.max(0, Math.min(100, 100 - usage))),
                resetAt: reset || null, cyclePercent: cyclePercentOf(reset, windowMs),
                used: null, total: null
              })
            }
            if (milestones.shortTermUsage !== null) push('session', '近5小时用量', milestones.shortTermUsage, milestones.shortTermReset, WINDOW_5H)
            if (milestones.weeklyUsage !== null) push('weekly', '近一周用量', milestones.weeklyUsage, milestones.weeklyReset, WINDOW_7D)
            if (milestones.monthlyUsage !== null) push('monthly', '近一月用量', milestones.monthlyUsage, milestones.monthlyReset, WINDOW_30D)
            const data = {
              ok: true,
              updatedAt: Date.now(),
              error: null,
              detail: null,
              viewer: {},
              items: [{
                product: 'coding-plan', edition: '', seatId: milestones.seatId,
                subscribed: true, error: null, periods: periods
              }]
            }
            cache = { at: now, data: data }
            return data
          }
        } catch (e2) {}
        const classified = classifyError(err)
        const data = { ok: false, updatedAt: Date.now(), error: classified.message, detail: classified.detail }
        return data
      }
    }

    harness.handle('ark-usage', async (args) => {
      const force = !!(args && args.force)
      return fetchUsage(force)
    })
  }
}`

export const CLIENT_CODE = `return {
  inject: ['timer'],
  apply(ctx) {
    const h = React.createElement
    const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect

    styles.insert('.arku-sb{display:flex;align-items:center;min-width:0;order:100}' +
      'div:has(>[data-slot="sidebar.footer.action"]):has(.arku-sb){display:contents}' +
      '.arku-sb-rail{width:36px}' +
      '.arku-sb-btn{display:flex;align-items:center;gap:6px;height:30px;width:100%;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#94a3b8);cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;transition:background .15s ease,color .15s ease}' +
      '.arku-sb-btn:hover{color:var(--dsw-alias-label-primary,#e2e8f0);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.arku-sb-rail .arku-sb-btn{width:36px;height:36px;padding:0;gap:0;justify-content:center;border-radius:10px}' +
      '.arku-sb-icon{flex:none;display:flex;align-items:center;justify-content:center;line-height:0}' +
      '.arku-sb-icon>svg{display:block;transform:translateY(-0.85px)}' +
      '.arku-sb-pct{font-size:12px;font-weight:700;font-family:ui-monospace,monospace;white-space:nowrap}' +
      '.arku-sb-sep{font-size:11px;color:var(--dsw-alias-label-tertiary,#64748b)}' +
      '.arku-sb-err{font-size:11px;color:#f87171;white-space:nowrap}' +
      '.arku-sb-pop{position:fixed;z-index:90;width:264px;max-height:100vh;overflow:auto;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));border:0;border-radius:14px;padding:10px 12px;box-shadow:var(--dsw-elevation-prominent,0 0 0 0.5px rgba(255,255,255,.2),0 3px 8px 0 rgba(0,0,0,.04),0 0 20px 0 rgba(0,0,0,.05));display:flex;flex-direction:column;gap:8px}' +
      '.arku-sb-head{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.arku-sb-head-right{display:flex;align-items:center;gap:6px;min-width:0}' +
      '.arku-sb-refresh{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#94a3b8);cursor:pointer;line-height:0;transition:background .15s ease,color .15s ease}' +
      '.arku-sb-refresh-glyph{display:flex;align-items:center;justify-content:center;line-height:0}' +
      '.arku-sb-refresh-glyph>svg{display:block}' +
      '.arku-sb-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e2e8f0);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.arku-sb-refresh:disabled{cursor:default;opacity:.5}' +
      '.arku-spin{animation:arku-spin .8s linear infinite}' +
      '@keyframes arku-spin{to{transform:rotate(360deg)}}' +
      '.arku-sb-title{font-size:12px;font-weight:700}' +
      '.arku-sb-user{font-size:10px;color:var(--dsw-alias-label-secondary,#94a3b8);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}' +
      '.arku-card{background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:0.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));border-radius:10px;padding:7px 10px;display:flex;flex-direction:column;gap:5px}' +
      '.arku-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '.arku-period-name{font-size:12px;font-weight:600}' +
      '.arku-card-pct{font-size:16px;font-weight:700;font-family:ui-monospace,monospace;line-height:1}' +
      '.arku-reset{font-size:10px;color:var(--dsw-alias-label-secondary,#94a3b8);display:flex;align-items:center;gap:4px}' +
      '.arku-reset-dot{width:5px;height:5px;border-radius:50%;background:#67a0fe;display:inline-block}' +
      '.arku-track{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));overflow:hidden;border:0.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}' +
      '.arku-fill{height:100%;border-radius:999px;transition:width .5s ease}' +
      '.arku-card-bottom{display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary,#94a3b8)}' +
      '.arku-remain b{color:var(--dsw-alias-label-primary,#e2e8f0);font-weight:600}' +
      '.arku-nums{font-family:ui-monospace,monospace}' +
      '.arku-error{background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:0.5px solid rgba(242,90,90,.5);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:7px;align-items:flex-start}' +
      '.arku-error-title{font-size:12px;font-weight:700;color:#fb7185}' +
      '.arku-error-detail{font-size:10px;color:var(--dsw-alias-label-secondary,#94a3b8);word-break:break-all;max-height:60px;overflow:auto}' +
      '.arku-refresh{cursor:pointer;border:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#94a3b8);border-radius:7px;font-size:11px;line-height:1;padding:4px 8px;transition:color .15s ease,background .15s ease}' +
      '.arku-refresh:hover{color:var(--dsw-alias-label-primary,#e2e8f0);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.arku-seat{font-size:10px;color:var(--dsw-alias-label-secondary,#94a3b8);padding:0 2px}' +
      '.arku-sb-foot{font-size:10px;color:var(--dsw-alias-label-secondary,rgba(148,163,184,.7));text-align:right;padding-right:2px}' +
      '.arku-sb-skel{height:9px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));opacity:.6}')

    function toneColor(percent) {
      if (percent >= 90) return '#f87171'
      if (percent >= 75) return '#fbbf24'
      return '#34d399'
    }
    function barColor(percent) {
      if (percent >= 90) return 'linear-gradient(90deg,#f43f5e,#dc2626)'
      if (percent >= 75) return 'linear-gradient(90deg,#f59e0b,#ea580c)'
      return 'linear-gradient(90deg,#6366f1,#3b82f6)'
    }

    // Volcano glyph in the shipped icon idiom: a 16x16 viewBox, no fill, and
    // color riding currentColor so it takes the row's own tone (muted label
    // grey, brightening on hover) exactly like the Settings gear beside it.
    // The shipped glyphs are filled outline contours roughly 1.25px thick at
    // 16px, so this stroked path keeps the same weight. Size follows the
    // sidebar foot convention of the Settings row: 16 wide, 18 in the rail.
    //
    // Optical alignment: flex centres both boxes, but their ink is not centred
    // in them. Measured with the row's real CSS at 12px monospace: this glyph's
    // ink sits 0.40px low in its box (mountain mass low, thin plume high), the
    // digits sit 0.45px high in theirs, so the icon reads ~0.85px low overall.
    // The CSS above lifts the svg by 0.85px, leaving ~0.00px at 16px and
    // ~0.05px at 18px. A font with different metrics moves the text term only.
    function volcanoIcon(size) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        h('path', { d: 'M5.4 5.6 1.9 13.4h12.2L10.6 5.6 9.4 7.4H6.6Z' }),
        h('path', { d: 'M8 7.4c-1-1.4 1-2.2 0-4' })
      )
    }
    function pad(n) { return n < 10 ? '0' + n : String(n) }
    function parseTime(str) {
      if (!str) return null
      const t = new Date(str).getTime()
      return isNaN(t) ? null : t
    }
    function fmtResetShort(str) {
      const target = parseTime(str)
      if (!target) return str || ''
      const d = new Date(target)
      const diff = target - Date.now()
      if (diff <= 24 * 3600 * 1000) {
        return '下次重置 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      }
      const now = new Date()
      const datePart = d.getFullYear() === now.getFullYear()
        ? (d.getMonth() + 1) + '/' + d.getDate()
        : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
      return '下次重置 ' + datePart
    }
    function fmtCountdown(str) {
      const target = parseTime(str)
      if (!target) return str || ''
      const diff = target - Date.now()
      if (diff <= 0) return '即将重置'
      const d = new Date(target)
      const n = new Date(Date.now())
      const sameDay = d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const minutes = Math.floor((diff % 3600000) / 60000)
      const timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes())
      if (days > 0) return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + timeStr + ' (' + days + '天' + hours + 'h后)'
      if (sameDay) return '今天 ' + timeStr + ' (' + (hours > 0 ? hours + 'h' : '') + minutes + 'm后)'
      return (hours > 0 ? hours + 'h' : '') + minutes + 'm后 (' + timeStr + ')'
    }

    function useArkUsage() {
      const [result, setResult] = React.useState(null)
      const load = React.useCallback(async function (force) {
        try {
          const data = await host.call('ark-usage', force ? { force: true } : {})
          setResult(data)
        } catch (err) {
          setResult({ ok: false, error: '调用失败', detail: String((err && err.message) || err) })
        }
      }, [])
      React.useEffect(function () {
        load(false)
        const t1 = ctx.interval(function () { load(false) }, 60000)
        return function () {
          if (typeof t1 === 'function') t1()
        }
      }, [])
      return { result: result, load: load }
    }

    function flatPeriods(data) {
      const out = []
      const items = data && Array.isArray(data.items) ? data.items : []
      for (const item of items) {
        if (item.subscribed !== true && (!item.periods || item.periods.length === 0)) continue
        const periods = Array.isArray(item.periods) ? item.periods : []
        for (const p of periods) out.push(p)
      }
      return out
    }

    function periodTip(p) {
      if (!p.resetAt) return p.name + '：已用 ' + p.percent.toFixed(2) + '%'
      return fmtResetShort(p.resetAt)
    }

    function PeriodCard(period) {
      return h('div', { className: 'arku-card', key: period.label },
        h('div', { className: 'arku-card-top' },
          h('span', { className: 'arku-period-name' }, period.name),
          h('span', { className: 'arku-card-pct', title: periodTip(period), style: { color: toneColor(period.percent) } }, period.percent.toFixed(2) + '%')
        ),
        period.resetAt ? h('div', { className: 'arku-reset', title: periodTip(period) },
          h('span', { className: 'arku-reset-dot' }),
          h('span', null, fmtCountdown(period.resetAt))
        ) : null,
        h('div', { className: 'arku-track' },
          h('div', { className: 'arku-fill', style: { width: Math.min(100, Math.max(0, period.percent)) + '%', background: barColor(period.percent) } })
        ),
        h('div', { className: 'arku-card-bottom' },
          h('span', { className: 'arku-remain' }, '剩余额度: ', h('b', null, period.remaining.toFixed(2) + '%')),
          period.used !== null && period.total !== null
            ? h('span', { className: 'arku-nums' }, String(period.used) + ' / ' + String(period.total))
            : null
        )
      )
    }

    function DetailCards(data) {
      const cards = []
      const items = data && Array.isArray(data.items) ? data.items : []
      for (const item of items) {
        if (item.subscribed !== true && (!item.periods || item.periods.length === 0)) continue
        const periods = Array.isArray(item.periods) ? item.periods : []
        for (const period of periods) cards.push(PeriodCard(period))
      }
      return cards
    }

    function MiniContent(result) {
      if (!result) return h('span', { className: 'arku-sb-pct', style: { color: '#94a3b8' } }, '加载中…')
      if (!result.ok) return h('span', { className: 'arku-sb-err' }, '获取失败')
      const periods = flatPeriods(result)
      const ordered = ['session', 'weekly', 'monthly']
      const list = []
      for (const label of ordered) {
        const p = periods.find(function (x) { return x.label === label })
        if (p) list.push(p)
      }
      if (!list.length) return h('span', { className: 'arku-sb-err' }, '无订阅')
      const children = []
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        if (i > 0) children.push(h('span', { className: 'arku-sb-sep', key: 'sep-' + i }, '·'))
        children.push(h('span', { className: 'arku-sb-pct', key: p.label, title: periodTip(p), style: { color: toneColor(p.percent) } }, p.percent.toFixed(2) + '%'))
      }
      return children
    }

    // Right edge of the sidebar column: the widest tall-and-narrow ancestor.
    // Falling back to the anchor itself keeps this harmless if the shell's
    // structure changes.
    function columnRight(node, vw, vh) {
      let best = 0
      let el = node.parentElement
      for (let i = 0; i < 8 && el; i++) {
        let r = null
        try { r = el.getBoundingClientRect() } catch (err) {}
        if (r && r.width > 0 && r.width < vw * 0.5 && r.height > vh * 0.5 && r.right > best) {
          best = r.right
        }
        el = el.parentElement
      }
      return best
    }

    // Measure the rendered popup, then seat it flush against the sidebar on
    // the left and the viewport on the bottom. The other edges only move when
    // the preferred side genuinely has no room (flip to the anchor's left, or
    // clamp so nothing spills off-screen).
    function placePop(btn, pop) {
      const b = btn.getBoundingClientRect()
      const p = pop.getBoundingClientRect()
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800
      const column = columnRight(btn, vw, vh)
      let left = Math.max(b.right, column)
      if (left + p.width > vw) {
        const flipped = b.left - p.width
        left = flipped >= 0 ? flipped : vw - p.width
      }
      left = Math.max(0, Math.min(left, Math.max(0, vw - p.width)))
      const top = Math.max(0, vh - p.height)
      return { left: Math.round(left), top: Math.round(top) }
    }

    // The slot renders through a [data-slot] anchor with display:contents, so
    // the footer row can be flattened by CSS to let the order property seat
    // this entry below the Settings row. This effect is the fallback for a
    // browser without :has(): it finds the nearest flex container and, when
    // that is still the horizontal footer row, wraps it and gives this row
    // full width. Every mutation is restored on cleanup.
    function bindLayout(node, wide) {
      let el = node && node.parentElement
      for (let i = 0; i < 4 && el; i++) {
        let cs = null
        try {
          if (typeof window !== 'undefined' && window.getComputedStyle) cs = window.getComputedStyle(el)
        } catch (err) {}
        if (cs && String(cs.display).indexOf('flex') >= 0) {
          const isRow = String(cs.flexDirection || '').indexOf('row') === 0
          const prevWrap = el.style.flexWrap
          const prevFlex = node.style.flex
          if (isRow) {
            if (cs.flexWrap !== 'wrap') el.style.flexWrap = 'wrap'
            node.style.flex = wide ? '1 0 100%' : '0 0 auto'
          }
          return function () {
            el.style.flexWrap = prevWrap
            node.style.flex = prevFlex
          }
        }
        el = el.parentElement
      }
      return undefined
    }

    function SidebarUsage(props) {
      const { result, load } = useArkUsage()
      const wide = !!(props && props.wide)
      const [open, setOpen] = React.useState(false)
      const [popPos, setPopPos] = React.useState({ left: 8, top: 8 })
      const btnRef = React.useRef(null)
      const popRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const [busy, setBusy] = React.useState(false)

      function toggle(e) {
        const node = btnRef.current
        if (open) {
          setOpen(false)
          return
        }
        if (node) {
          const r = node.getBoundingClientRect()
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800
          setPopPos({ left: Math.round(r.right + 10), top: Math.max(8, Math.round(r.bottom - 300)) })
        }
        setOpen(true)
      }
      async function refreshNow() {
        setBusy(true)
        await load(true)
        setBusy(false)
      }

      useLayout(function () {
        return bindLayout(wrapRef.current, wide)
      }, [wide])

      useLayout(function () {
        if (!open) return
        const pop = popRef.current
        const btn = btnRef.current
        if (!pop || !btn) return
        function place() {
          const next = placePop(btn, pop)
          setPopPos(function (prev) {
            if (prev && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.top - next.top) < 1) return prev
            return next
          })
        }
        place()
        window.addEventListener('resize', place)
        return function () { window.removeEventListener('resize', place) }
      }, [open, result])

      useLayout(function () {
        if (!open) return
        function onDown(e) {
          const wrap = wrapRef.current
          if (wrap && e.target && wrap.contains(e.target)) return
          setOpen(false)
        }
        window.addEventListener('pointerdown', onDown)
        return function () { window.removeEventListener('pointerdown', onDown) }
      }, [open])

      const tip = (function () {
        if (!result || !result.ok) return null
        const periods = flatPeriods(result)
        const texts = []
        for (const label of ['session', 'weekly', 'monthly']) {
          const p = periods.find(function (x) { return x.label === label })
          if (p) texts.push(periodTip(p))
        }
        return texts.join(' · ') || null
      })()

      const btn = h('button', {
        className: 'arku-sb-btn',
        ref: function (node) { btnRef.current = node },
        onClick: toggle,
        title: tip || undefined
      },
        h('span', { className: 'arku-sb-icon' }, volcanoIcon(wide ? 16 : 18)),
        wide ? MiniContent(result) : null
      )

      let pop = null
      if (open) {
        const viewer = result && result.viewer ? result.viewer : {}
        const headUser = viewer.user_name || viewer.account_id || viewer.profile || ''
        const updated = new Date((result && result.updatedAt) || Date.now())
        const updatedText = pad(updated.getHours()) + ':' + pad(updated.getMinutes()) + ':' + pad(updated.getSeconds())
        let body
        if (!result) {
          body = h('div', null,
            h('div', { className: 'arku-sb-skel', style: { width: '40%', marginBottom: '6px' } }),
            h('div', { className: 'arku-sb-skel', style: { width: '92%', marginBottom: '6px' } }),
            h('div', { className: 'arku-sb-skel', style: { width: '80%' } })
          )
        } else if (!result.ok) {
          body = h('div', { className: 'arku-error' },
            h('span', { className: 'arku-error-title' }, result.error || '加载失败'),
            result.detail ? h('div', { className: 'arku-error-detail' }, result.detail) : null,
            h('button', { className: 'arku-refresh', disabled: busy, onClick: refreshNow }, '重试')
          )
        } else {
          const cards = DetailCards(result)
          body = cards.length ? cards : h('div', { className: 'arku-seat' }, '当前账号暂无生效的 Coding Plan 订阅')
        }
        pop = h('div', {
          className: 'arku-sb-pop',
          ref: function (node) { popRef.current = node },
          style: { left: popPos.left + 'px', top: popPos.top + 'px' }
        },
          h('div', { className: 'arku-sb-head' },
            h('span', { className: 'arku-sb-title' }, '火山方舟'),
            h('div', { className: 'arku-sb-head-right' },
              headUser ? h('span', { className: 'arku-sb-user' }, headUser) : null,
              h('button', {
                className: 'arku-sb-refresh',
                disabled: busy,
                onClick: refreshNow,
                title: '刷新'
              }, h('span', { className: 'arku-sb-refresh-glyph' + (busy ? ' arku-spin' : '') },
                h('svg', {
                  viewBox: '0 0 24 24',
                  width: 16,
                  height: 16,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                },
                  h('path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }),
                  h('path', { d: 'M21 3v5h-5' })
                )
              ))
            )
          ),
          body,
          result ? h('div', { className: 'arku-sb-foot' }, '更新于 ' + updatedText) : null
        )
      }

      return h('div', {
        className: 'arku-sb' + (wide ? '' : ' arku-sb-rail'),
        ref: function (node) { wrapRef.current = node }
      },
        btn,
        pop
      )
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('sidebar.footer.action', function () {
      return slots.register(
        { name: 'sidebar.footer.action', id: 'ark-usage', order: 100 },
        function (props) { return h(SidebarUsage, props) }
      )
    })
  }
}
`
