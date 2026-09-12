// dsh-ark-usage-widget — static client half (browser plugin body).
//
// This file is the body of the built client bundle (lib/client.js). The build
// script (build.mjs) wraps it in the DSH client module registration:
//
//   window.__ModuleLoader__.load({ id: "dsh-ark-usage-widget", factory: (require) => {
//     var module = { exports: {} };
//     var exports = module.exports;
//     ...this file...
//     return module.exports;
//   } });
//
// Inside that factory, `require` is the module table: only 'react' (and the
// other platform module specifiers) are resolvable, so this file imports
// nothing but 'react' and inlines everything else. It exports a standard
// cordis client plugin { inject, apply }:
//
//   - inject: ['slots'] — the browser slots service (ui-sidebar declares the
//     'sidebar.footer.action' hole; slots.inject waits for that declaration).
//   - apply: injects the widget styles, then registers the sidebar footer
//     action row. Data comes from the same-origin host route /ark-usage
//     (index.js) via fetch — no dynamic runner, no approval, no steering.
//
// Everything below the "widget UI" marker is the original dynamic client
// code moved verbatim; only the data source, the timer, and the style
// injection were adapted from the runner sandbox API to the static API.

const React = require('react')

const h = React.createElement
const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect

// ── styles (was `styles.insert` in the runner sandbox) ──────────────────────

const WIDGET_CSS =
  '.arku-sb{display:flex;align-items:center;min-width:0;order:100}' +
  'div:has(>[data-slot="sidebar.footer.action"]):has(.arku-sb){display:contents}' +
  '.arku-sb-rail{width:36px}' +
  '.arku-sb-btn{display:flex;align-items:center;gap:6px;height:30px;width:100%;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#94a3b8);cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;transition:background .15s ease,color .15s ease}' +
  '.arku-sb-btn:hover{color:var(--dsw-alias-label-primary,#e2e8f0);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
  '.arku-sb-rail .arku-sb-btn{width:36px;height:36px;padding:0;gap:0;justify-content:center;border-radius:10px}' +
  '.arku-sb-icon{flex:none;display:flex;align-items:center;justify-content:center;line-height:0}' +
  '.arku-sb-icon>svg{display:block;transform:translateY(-1.4px)}' +
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
  '.arku-sb-skel{height:9px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));opacity:.6}'

// ── data source (was `host.call('ark-usage', ...)` in the runner sandbox) ───

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase() {
  const origin = globalThis.location && typeof globalThis.location.origin === 'string'
    ? globalThis.location.origin
    : undefined
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

async function callUsage(force) {
  const url = new URL('/ark-usage' + (force ? '?force=1' : ''), hostBase())
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('HTTP ' + String(response.status))
  return response.json()
}

// ── widget UI (moved verbatim from the dynamic client code) ─────────────────

function toneColor(percent) {
  if (percent >= 90) return '#f87171'
  if (percent >= 75) return '#fbbf24'
  return '#34d399'
}
// Water-level color on the existing percentage number (no extra elements):
// encodes how the cycle's usage paces against the cycle's elapsed time
// (period.cyclePercent, computed host-side from resetAt and window length).
//   pace = usage − elapsed-time:
//     pace ≤ 0  → 充足 (usage behind schedule; quota ahead of time)  → green
//     pace > 0  → 超额使用 (usage ahead of schedule)                 → amber
//     pace > 15 → 明显超额                                            → red
//   usage ≥ 90 always red (near exhaustion regardless of pacing).
function levelColor(p) {
  const usage = p.percent
  const elapsed = p.cyclePercent
  if (usage >= 90) return '#f87171'
  if (typeof elapsed !== 'number' || !isFinite(elapsed)) return toneColor(usage)
  const pace = usage - elapsed
  if (pace > 15) return '#f87171'
  if (pace > 0) return '#fbbf24'
  return '#34d399'
}
function barColor(percent) {
  if (percent >= 90) return 'linear-gradient(90deg,#f43f5e,#dc2626)'
  if (percent >= 75) return 'linear-gradient(90deg,#f59e0b,#ea580c)'
  return 'linear-gradient(90deg,#6366f1,#3b82f6)'
}

// Official Volcengine brand mark (the volcengine.com site icon, path data
// inlined verbatim): five filled paths in a 24x24 viewBox — two translucent
// backdrop peaks at fill-opacity .5 and three solid front pieces, all on
// fill:currentColor. A filled mark carries more ink than the stroked glyphs
// beside it, but it is the actual 火山引擎 logo, so it reads instantly and
// still follows currentColor (muted label grey, brightening on hover, like
// the Settings gear). Size follows the sidebar foot convention of the
// Settings row: 16 wide, 18 in the rail.
//
// Optical alignment: flex centres both boxes, but their ink is not centred
// in them — and for this mark neither is the perceived centre. Its ink bbox
// (y 0.15–22.0 of the 24-unit box) is nominally top-heavy, yet the two tall
// backdrop peaks are only fill-opacity .5 (nearly invisible on light themes)
// while every solid piece lives in the bottom half, so bbox-centring makes
// the mark read bottom-heavy against the numbers. The svg is therefore
// lifted 1.4px, chosen from a rendered lift sweep of both themes at 16px:
// −1.0 still read low, −1.8 started floating above the text line. That puts
// the solid-mass centre on the row's centre line (the digits' ink centre
// sits 0.45px above it), which is the compromise where the mark reads
// centred in both themes. A font with different metrics moves the text term
// only.
function volcanoIcon(size) {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'currentColor',
    fillRule: 'evenodd',
    'aria-hidden': 'true',
  },
    h('path', { d: 'M7.29 5.36L3.148 21.737a.215.215 0 00.203.261h8.29a.214.214 0 00.215-.261L7.7 5.359a.214.214 0 00-.41 0z', fillOpacity: 0.5 }),
    h('path', { d: 'M4.553 16.18l-1.406 5.558a.214.214 0 00.203.261h2.42-4.551a.214.214 0 01-.214-.26l2.275-8.961a.214.214 0 01.409 0l.864 3.402z', clipRule: 'evenodd' }),
    h('path', { d: 'M14.44.15a.214.214 0 00-.41 0L8.366 21.739a.214.214 0 00.214.261H19.9a.214.214 0 00.215-.261L14.44.151z', fillOpacity: 0.5 }),
    h('path', { d: 'M16.694 22h3.207a.215.215 0 00.214-.262l-1.839-6.993 1.164-4.592a.214.214 0 01.411 0l2.951 11.586a.214.214 0 01-.214.261h-5.894z', clipRule: 'evenodd' }),
    h('path', { d: 'M10.278 7.741L6.685 21.736a.214.214 0 00.214.264h7.17a.216.216 0 00.214-.166.216.216 0 000-.098L10.687 7.742a.214.214 0 00-.409 0z' })
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
      const data = await callUsage(force)
      setResult(data)
    } catch (err) {
      setResult({ ok: false, error: '调用失败', detail: String((err && err.message) || err) })
    }
  }, [])
  React.useEffect(function () {
    load(false)
    const id = setInterval(function () { load(false) }, 60000)
    return function () { clearInterval(id) }
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
      h('span', { className: 'arku-card-pct', title: periodTip(period), style: { color: levelColor(period) } }, period.percent.toFixed(2) + '%')
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
    children.push(h('span', { className: 'arku-sb-pct', key: p.label, title: periodTip(p), style: { color: levelColor(p) } }, p.percent.toFixed(2) + '%'))
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
    title: tip || undefined,
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
      style: { left: popPos.left + 'px', top: popPos.top + 'px' },
    },
      h('div', { className: 'arku-sb-head' },
        h('span', { className: 'arku-sb-title' }, '火山方舟'),
        h('div', { className: 'arku-sb-head-right' },
          headUser ? h('span', { className: 'arku-sb-user' }, headUser) : null,
          h('button', {
            className: 'arku-sb-refresh',
            disabled: busy,
            onClick: refreshNow,
            title: '刷新',
          }, h('span', { className: 'arku-sb-refresh-glyph' + (busy ? ' arku-spin' : '') },
            h('svg', {
              viewBox: '0 0 24 24',
              width: 16,
              height: 16,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
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
    ref: function (node) { wrapRef.current = node },
  },
    btn,
    pop
  )
}

// ── plugin entry ────────────────────────────────────────────────────────────

function apply(ctx) {
  ctx.effect(function () {
    if (typeof document === 'undefined') return undefined
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-ark-usage-widget'
    tag.dataset.pluginCss = 'dsh-ark-usage-widget/styles'
    tag.textContent = WIDGET_CSS
    document.head.appendChild(tag)
    return function () {
      if (tag.parentNode) tag.parentNode.removeChild(tag)
    }
  }, 'dsh-ark-usage-widget: styles')

  ctx.slots.inject('sidebar.footer.action', function () {
    return ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'ark-usage', order: 100 },
      SidebarUsage
    )
  })
}

module.exports = { inject: ['slots'], apply }
