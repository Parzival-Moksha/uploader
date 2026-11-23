'use client'

// ░▒▓ ACADEMY GUIDE — who you train, and what you do next ▓▒░
// The trainee picker lists your own agents too: picking one that is not in training yet puts it in
// training (a newcomer starts here, not in an agent panel's settings). The next-step strip says, in one
// line, where the path goes from here, with a button that opens that skill.

import { useMemo, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { academyNextStep, type AcademySkill, type AcademyTraineeView } from '../../lib/village/village-academy'
import { showNotice } from '../forge/GlobalNotice'
import { academyKeyOf, getAcademyState, openAcademyReader, selectAcademyTrainee, setAgentTraining, subscribeAcademy } from './academy-store'
import { agentDisplayName, canTalkTo } from './village-status'

const START = 'start:'

/** Your agents that are not trainees yet: each can be put in training from the picker. */
function useUntrainedAgents(trainees: readonly AcademyTraineeView[]) {
  const agents = useOasisStore(s => s.agentEngine.agents)
  const order = useOasisStore(s => s.agentEngine.order)
  return useMemo(() => {
    const known = new Set(trainees.map(item => item.key))
    return order
      .map(id => agents[id])
      .filter(agent => agent && canTalkTo(agent) && !known.has(academyKeyOf(agent)))
  }, [agents, order, trainees])
}

export function AcademyTraineeSelect({ trainee, trainees, className, data }: {
  trainee: AcademyTraineeView | null
  trainees: readonly AcademyTraineeView[]
  className: string
  /** The data attribute that names this picker for tests: 'map' or 'sheet'. */
  data: 'map' | 'sheet'
}) {
  const fresh = useUntrainedAgents(trainees)
  const training = trainees.filter(item => item.training)
  const resting = trainees.filter(item => !item.training)
  const pick = async (value: string) => {
    if (!value.startsWith(START)) {
      selectAcademyTrainee(value || null)
      return
    }
    const agent = useOasisStore.getState().agentEngine.agents[value.slice(START.length)]
    if (!agent) return
    const result = await setAgentTraining({ id: agent.id, name: agentDisplayName(agent), sessionId: agent.sessionId }, true)
    if (result.ok) showNotice(`${agentDisplayName(agent)} is in training: it stands as stone until it has Spirit and Body.`, 'info')
    else showNotice(`Could not start training: ${result.error}`, 'error')
  }
  return (
    <select
      {...{ [data === 'map' ? 'data-academy-map-trainee' : 'data-academy-trainee']: '' }}
      value={trainee?.key || ''}
      onChange={event => { void pick(event.target.value) }}
      onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
      className={className}
      title="The agent whose skills you see. Pick one of your agents to put it in training."
    >
      {!trainee && <option value="">{fresh.length || trainees.length ? 'pick an agent…' : 'no agents yet'}</option>}
      {training.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
      {fresh.length > 0 && (
        <optgroup label="Start training">
          {fresh.map(agent => <option key={agent.id} value={`${START}${agent.id}`}>{agentDisplayName(agent)}: start training</option>)}
        </optgroup>
      )}
      {resting.length > 0 && (
        <optgroup label="Not training">
          {resting.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
        </optgroup>
      )}
    </select>
  )
}

/** One line: where the path goes from here. `fromMap`: the sheet opens inside the Character menu. */
export function AcademyNextStep({ trainee, skills, fromMap }: { trainee: AcademyTraineeView | null; skills: readonly AcademySkill[]; fromMap: boolean }) {
  const anyAgents = useSyncExternalStore(subscribeAcademy, () => getAcademyState().trainees.length > 0, () => false)
  const owned = useOasisStore(s => s.agentEngine.order.some(id => canTalkTo(s.agentEngine.agents[id])))
  const step = academyNextStep(trainee, skills)
  const open = (skill: AcademySkill) => openAcademyReader(skill.id, fromMap)
  let text: string
  let action: { label: string; skill: AcademySkill } | null = null
  if (step.kind === 'pick') {
    text = owned || anyAgents
      ? 'Raise an agent into your co-founder, one skill at a time. Start by picking one of your agents under Trainee.'
      : 'Raise an agent into your co-founder, one skill at a time. Summon an agent first (Agents, top left), then pick it under Trainee.'
  } else if (step.kind === 'do') {
    text = step.first
      ? `${trainee!.name} starts as stone. Skill 1 is ${step.skill.name}: open it, say its prompt to ${trainee!.name}, then get the proof checked.`
      : `Next for ${trainee!.name}: ${step.skill.name}, ${step.skill.xp} XP, about ${step.skill.mins} min.`
    action = { label: step.first ? `Open ${step.skill.name}` : 'Open', skill: step.skill }
  } else if (step.kind === 'check') {
    text = `${step.skill.name} is claimed and waits for a check.`
    action = { label: 'Open', skill: step.skill }
  } else {
    text = `${trainee!.name} has every skill on this tree.`
  }
  return (
    <div data-academy-next={step.kind} className="pointer-events-auto flex max-w-[640px] items-center gap-2 rounded-xl border border-amber-300/30 bg-slate-950/80 px-3 py-1.5 text-[12px] text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button
          type="button"
          data-academy-next-open={action.skill.id}
          onClick={() => open(action!.skill)}
          className="shrink-0 rounded-md border border-amber-300/50 bg-amber-400/20 px-2.5 py-1 text-[11.5px] font-bold text-amber-50 transition hover:bg-amber-400/35"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
