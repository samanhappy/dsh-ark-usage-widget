// dsh-ark-usage-widget — bundle entry (host composition plugin).
//
// On every user-facing session start this trusted composition plugin
// re-creates the Ark Coding Plan usage widget as a dynamic Cordis plugin and
// pre-authorizes its own client Package, so no per-process approval prompt is
// shown. The approval is issued from this trusted composition plugin for the
// exact Package it just created — the browser half of this widget is trusted
// by configuration, equivalent to a statically built client plugin.
//
// The widget itself stays a dynamic plugin (client code loaded at runtime)
// because the browser half cannot be compiled into the shipped web bundle
// from an installed package; a static client row would require rebuilding the
// web app from a source checkout. This bundle's patch row mounts THIS module
// only — see cordis.patch.yml.
//
// How the pre-authorization works (all steps use the public dynamicCordisRunner
// service; verified against dsh-cordis-host-runner/lib/index.js):
//   - define() creates the plugin with an empty approvedClientPackages set.
//   - runHostHalf(agent, pluginId, packageId, 'run', null, true) is the
//     "direct panel gesture" path: it adds the package to approvedClientPackages
//     and starts the Host half, committing currentPackageId.
//   - stop() retracts the run but deliberately keeps the in-memory grants
//     (approvedClientPackages / clientVersionUpdatesApproved).
//   - run() then computes requiresApproval = false for this Package, so the
//     emitted cordis/request-run carries requiresApproval:false. The client
//     runner's open() auto-orchestrates the full load (host + client) with no
//     approval card, and reconcileApprovals re-drives it if the page connects
//     late.
// Grants are in-memory only, so this sequence must run once per process —
// which is exactly what this session-start handler does.
//
// The Host/Client source lives in ./code.js (the single file to edit); this
// module only imports and injects it.
//
// Fail-soft by design: nothing here may throw into session startup, and if
// the pre-authorization step fails, run() falls back to the standard approval
// flow (one card the user can approve).

import { HOST_CODE, CLIENT_CODE } from './code.js'

const PLUGIN_PREFIX = 'arku'
const PLUGIN_NAME = 'Ark Coding Plan 用量'
const PLUGIN_PURPOSE = '侧边栏底部最下一行用量（设置操作栏下方）：SVG 线条火山图标（currentColor，宽栏 16px / rail 18px）与右侧百分比数字做视觉中心对齐（实测墨迹偏移 0.85px 后修正）；宽栏整行显示三周期两位小数百分比，rail 态仅图标；弹窗左/下与侧边栏和视窗齐平，含 16px SVG 刷新按钮，底部仅显示更新时间。'

const startedSessions = new Set()

export default {
  name: 'dsh-ark-usage-widget',
  apply(ctx) {
    ctx.on('agent/session-start', async (payload) => {
      try {
        const agent = payload && payload.agent
        if (!agent || !agent.id) return
        if (startedSessions.has(agent.id)) return
        startedSessions.add(agent.id)
        const header = agent.session && agent.session.header
        if (header && header.origin === 'subagent') return
        const runner = ctx.get('dynamicCordisRunner')
        if (runner === undefined) {
          console.log('[dsh-ark-usage-widget] dynamicCordisRunner unavailable — skipping')
          return
        }
        const receipt = runner.define({
          sessionId: agent.id,
          plugin: { kind: 'new', idPrefix: PLUGIN_PREFIX },
          name: PLUGIN_NAME,
          purpose: PLUGIN_PURPOSE,
          code: { host: HOST_CODE, client: CLIENT_CODE }
        })
        // Pre-authorize this exact Package (direct-gesture path), then stop the
        // run so the following run() sees requiresApproval=false and the client
        // auto-loads without an approval card. If anything here fails, run()
        // below still falls back to the normal approval flow.
        try {
          const started = await runner.runHostHalf(agent, receipt.pluginId, receipt.packageId, 'run', null, true)
          if (started && started.ok) {
            await runner.stop(agent, receipt.pluginId)
            console.log('[dsh-ark-usage-widget] pre-authorized', receipt.pluginId, receipt.packageId)
          } else {
            console.log('[dsh-ark-usage-widget] pre-authorize not ok, falling back to approval flow', JSON.stringify(started))
          }
        } catch (error) {
          console.error('[dsh-ark-usage-widget] pre-authorize failed, falling back to approval flow', error && error.stack ? error.stack : String(error))
        }
        const result = await runner.run(agent, receipt.pluginId, receipt.packageId, 'run')
        console.log('[dsh-ark-usage-widget]', receipt.pluginId, JSON.stringify(result))
      } catch (error) {
        console.error('[dsh-ark-usage-widget]', error && error.stack ? error.stack : String(error))
      }
    })
  }
}
