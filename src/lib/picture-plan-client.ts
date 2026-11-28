'use client'
// What the picture panels may offer: GET /api/imagine says whether this Oasis, for this page, can make pictures on
// the machine's own ChatGPT plan (src/lib/picture-plan.ts) and which model is the default. Asked once per page load.

import { useEffect, useState } from 'react'

export interface PicturePlanInfo {
  plan: boolean
  planLabel: string
  defaultModel: string
}

export const PLAN_MODEL_KEY = 'chatgpt-plan'
const FALLBACK: PicturePlanInfo = { plan: false, planLabel: 'ChatGPT plan', defaultModel: 'nano-banana-2' }
let asked: Promise<PicturePlanInfo> | null = null

export function fetchPicturePlan(base = process.env.NEXT_PUBLIC_BASE_PATH || ''): Promise<PicturePlanInfo> {
  if (!asked) {
    asked = fetch(`${base}/api/imagine`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : FALLBACK))
      .then((d: Partial<PicturePlanInfo>) => ({
        plan: d.plan === true,
        planLabel: typeof d.planLabel === 'string' ? d.planLabel : FALLBACK.planLabel,
        defaultModel: typeof d.defaultModel === 'string' ? d.defaultModel : FALLBACK.defaultModel,
      }))
      .catch(() => FALLBACK)
  }
  return asked
}

/** What the legacy 'gemini-flash' key (the route's default) is called on this page. */
export function defaultModelLabel(info: PicturePlanInfo | null): string {
  return info?.plan && info.defaultModel === PLAN_MODEL_KEY ? info.planLabel : 'Nano Banana 2'
}

/** null until the answer is in. */
export function usePicturePlan(): PicturePlanInfo | null {
  const [info, setInfo] = useState<PicturePlanInfo | null>(null)
  useEffect(() => {
    let live = true
    fetchPicturePlan().then(i => { if (live) setInfo(i) })
    return () => { live = false }
  }, [])
  return info
}
