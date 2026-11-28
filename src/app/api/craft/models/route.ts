// GET /api/craft/models — the Text to 3D model list for this page: each choice with available / why not, from the
// ways to a model this machine has (src/lib/model-access.ts: Claude Code signed in, an OpenRouter key). The owner,
// 27 Nov: models are active or greyed out by the subscriptions and keys you have. Claude Code only ever answers this
// machine's own page (checkAgentRequest), so for anyone else it is greyed out. ?fresh=1 looks again now.

import { NextRequest, NextResponse } from 'next/server'
import { checkAgentRequest } from '@/lib/local-request-guard'
import { modelAccess } from '@/lib/model-access'
import { CRAFT_MODEL_OPTIONS, craftModelAvailability, usableCraftChoice } from '@/lib/craft-models'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const local = checkAgentRequest(request) === null
  const found = await modelAccess({ fresh: request.nextUrl.searchParams.get('fresh') === '1' }).catch(() => null)
  const access = {
    claudeCode: local && Boolean(found?.claudeCode),
    openrouter: Boolean(found?.openrouter) || Boolean(process.env.OPENROUTER_API_KEY),
  }
  const options = CRAFT_MODEL_OPTIONS.map(option => ({ id: option.id, label: option.label, provider: option.provider, ...craftModelAvailability(option, access) }))
  return NextResponse.json(
    { options, access, suggested: usableCraftChoice(request.nextUrl.searchParams.get('current'), access), any: options.some(option => option.available) },
    { headers: { 'cache-control': 'no-store' } },
  )
}
