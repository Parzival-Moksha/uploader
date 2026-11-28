// The old Codex panel's routes (/api/codex, /api/codex/models, /api/codex/sessions) answer only when switched on.
// /api/codex runs `codex exec` with approvals and the sandbox off, and any script that ever runs in the Oasis's own
// origin could call it (Merge Goat, 28 Nov, with two such holes found that night). Codex villagers do not use these
// routes: they run through the agent engine. So they are off unless OASIS_CODEX_PANEL=1 is in the page server's
// environment (Anorak, 28 Nov 01:05). One line in the package README's advanced part says so.

type EnvLike = { [key: string]: string | undefined }

export const CODEX_PANEL_SWITCH = 'OASIS_CODEX_PANEL'

export function codexPanelEnabled(env: EnvLike = process.env): boolean {
  return (env[CODEX_PANEL_SWITCH] || '').trim() === '1'
}

/** A 404 with the way to turn it on, or null when the panel is on. */
export function codexPanelOff(env: EnvLike = process.env): Response | null {
  if (codexPanelEnabled(env)) return null
  return Response.json(
    { error: `The old Codex panel is off. To turn it on, put ${CODEX_PANEL_SWITCH}=1 in the Oasis's .env and start it again. Codex agents in the village do not need it.` },
    { status: 404 },
  )
}
