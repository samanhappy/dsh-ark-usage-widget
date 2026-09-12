// dsh-ark-usage-widget — static host half (composition plugin row).
//
// This bundle no longer uses the dynamic Cordis runner. The old design
// re-created the widget as a dynamic plugin on every DSH start, which made the
// cordis-host-runner steer the run outcome back into the owning session
// (agent.steer with wake) — one injected "cordis-host-runner" user message and
// one automatic model turn per process start. That is gone: the widget is now
// a STATIC pair of halves contributed by this bundle:
//
//   - HOST half (this module): a plain host composition plugin that registers
//     an HTTP route /ark-usage on the web server (same origin as the GUI),
//     guarded by the connection trust fence, and returns the account-wide Ark
//     usage JSON read through the local `arkcli` CLI.
//   - CLIENT half (src/client.js, built to lib/client.js): a static browser
//     plugin declared via `dsh.client` + `exports["./client"]`. The host
//     client-modules service scans the live loader entries at runtime and
//     serves the bundle into window.__DSH_BOOT__ exactly like every built-in
//     UI row — no define/run/request-run/approval/steering anywhere in the
//     path, so the user sees nothing and the model is never woken.
//
// The single row in cordis.patch.yml is dual-face (host apply + dsh.client),
// the same pattern as the connection / modules packages.
//
// The route reuses the open-in-app security shape: `connection.requestRejection`
// (Host/Origin fence + login cookie) is asked before any response. The data is
// account-level and process-wide, matching the widget's global sidebar UI.
//
// Fail-soft: nothing here may throw into composition startup; a missing
// subprocess/arkcli simply yields the structured error payload the client
// renders ("获取失败" with a retry button).

const CACHE_TTL_MS = 60000
const WINDOW_5H = 5 * 3600 * 1000
const WINDOW_7D = 7 * 86400 * 1000
const WINDOW_30D = 30 * 86400 * 1000

export const name = 'dsh-ark-usage-widget'
export const inject = ['webServer', 'connection', 'subprocess']

/** Route served to the browser widget; GET /ark-usage, optional ?force=1. */
export const ARK_USAGE_ROUTE = '/ark-usage'

/** Local view of the browser-side connection service's trust fence. */
function connectionOf(ctx) {
  return Reflect.get(ctx, 'connection')
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function apply(ctx) {
  const fetcher = createFetcher(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ARK_USAGE_ROUTE,
    handler: async (req, res) => {
      const connection = connectionOf(ctx)
      const rejection = connection === undefined ? undefined : connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      // Node always sets url on server requests; String keeps that fact local.
      const url = new URL(String(req.url), 'http://localhost')
      const force = url.searchParams.get('force') === '1'
      sendJson(res, 200, await fetcher.fetch(force))
    },
  }), 'dsh-ark-usage-widget: GET /ark-usage')
}

// ── arkcli data pipeline (moved verbatim from the old dynamic HOST_CODE) ────

function createFetcher(ctx) {
  const subprocess = ctx.get('subprocess')
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
    return process.cwd() || '/'
  }

  async function runCli(argv) {
    if (subprocess === undefined) {
      const err = new Error('subprocess 服务不可用')
      err.stderr = 'subprocess 服务不可用'
      throw err
    }
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
        stderr: { maxBytes: 200000 },
      },
      graceMs: 3000,
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

  async function fetchSeatMilestones(knownSeatId) {
    try {
      let seatId = knownSeatId
      if (!seatId) {
        const out = await runCli(['api', 'usage.get_seat_info', '--params', '{"ProjectName":"default"}', '--format', 'json'])
        const json = JSON.parse(out)
        seatId = json && json.Result && json.Result.SeatID
      }
      if (!seatId) return null
      const params = JSON.stringify({ SeatID: String(seatId).trim(), ProjectName: 'default' })
      const out = await runCli(['api', 'usage.get_seat_info_usage', '--params', params, '--format', 'json'])
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
        monthlyUsage: typeof r.MonthlyUsage === 'number' ? r.MonthlyUsage : null,
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
          total: isFinite(total) ? total : null,
        })
      }
      items.push({
        product: String(item.product || 'coding-plan'),
        edition: String(item.edition || ''),
        seatId: item.seat_id !== undefined && item.seat_id !== null ? String(item.seat_id) : null,
        subscribed: item.subscribed === true,
        error: item.error !== undefined && item.error !== null ? String(item.error) : null,
        periods: periods,
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

  async function fetch(force) {
    const now = Date.now()
    if (!force && cache && now - cache.at < CACHE_TTL_MS) {
      return cache.data
    }
    try {
      const planOut = await runCli(['usage', 'plan', '--format', 'json'])
      const planJson = JSON.parse(planOut)
      const seatId = planJson.items && planJson.items.length ? planJson.items[0].seat_id || null : null
      const milestones = await fetchSeatMilestones(seatId)
      const data = {
        ok: true,
        updatedAt: Date.now(),
        error: null,
        detail: null,
        viewer: buildViewer(planJson),
        items: buildItems(planJson, milestones),
      }
      cache = { at: now, data: data }
      return data
    } catch (err) {
      try {
        const milestones = await fetchSeatMilestones(null)
        if (milestones && milestones.seatId) {
          const periods = []
          const push = (label, periodName, usage, reset, windowMs) => {
            periods.push({
              label: label, name: periodName,
              percent: round2(usage), remaining: round2(Math.max(0, Math.min(100, 100 - usage))),
              resetAt: reset || null, cyclePercent: cyclePercentOf(reset, windowMs),
              used: null, total: null,
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
              subscribed: true, error: null, periods: periods,
            }],
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

  return { fetch }
}
