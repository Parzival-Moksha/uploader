// ░▒▓ CARBON MISSIONS — what the Oasis needs from the owner: one file each in docs/questions ▓▒░
// Pure: parsing, sorting, answering. The format is docs/questions/README.md in 7c_oasis:
//     state: open | parked | answered
//     kind: question | task
//     asked: 2026-11-19
//     by: Hustler
//     score: ease 5 · impact 4 · urgency 3
//     minutes: 2
//     blocks: who or what waits
//     recommend: the asker's recommendation
//     predict: Anorak's guess of the owner's answer (never shown before he answers)
//     (answered, answer, took, hit once he has answered)
//
//     # Title
//     ## What it is … ## Options … ## Recommendation …

import type { Mission } from './village-missions'

export type CarbonState = 'open' | 'parked' | 'answered'
export type CarbonKind = 'question' | 'task'

export interface CarbonMission {
  file: string
  title: string
  state: CarbonState
  kind: CarbonKind
  asked: string
  by: string
  ease: number | null
  impact: number | null
  urgency: number | null
  /** ease × impact × urgency ÷ 125, two decimals; null without a full score. */
  priority: number | null
  /** His time, the estimate. */
  minutes: number | null
  blocks: string
  recommend: string
  predict: string
  answered: string
  answer: string
  took: number | null
  hit: string
  /** He pressed "not enough to decide": when, and a fingerprint of the body as it was then. */
  unclear: { date: string; hash: string } | null
  /** Still unclear: the body has not changed since. Such a mission sinks below the other open ones. */
  sinking: boolean
  /** Everything under the title. */
  body: string
  markdown: string
}

const num = (value: string | undefined): number | null => {
  const n = Number.parseFloat(value || '')
  return Number.isFinite(n) ? n : null
}

/** The header: `key: value` lines up to the first blank line. */
function readHeader(lines: string[]): { head: Record<string, string>; end: number } {
  const head: Record<string, string> = {}
  let end = 0
  for (; end < lines.length; end += 1) {
    const line = lines[end]
    if (!line.trim()) break
    const colon = line.indexOf(':')
    if (colon < 0 || line.startsWith('#')) break
    head[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { head, end }
}

export function parseCarbonMission(file: string, text: string): CarbonMission {
  const markdown = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = markdown.split('\n')
  const { head, end } = readHeader(lines)
  const titleAt = lines.findIndex((line, index) => index >= end && line.startsWith('# '))
  const title = titleAt >= 0 ? lines[titleAt].slice(2).trim() : file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/[-_]+/g, ' ')
  const body = lines.slice(titleAt >= 0 ? titleAt + 1 : end).join('\n').trim()
  const nums: Record<string, number> = {}
  for (const match of (head.score || '').matchAll(/(ease|impact|urgency)\s*(\d)/g)) nums[match[1]] = Number(match[2])
  const complete = 'ease' in nums && 'impact' in nums && 'urgency' in nums
  const state = (['open', 'parked', 'answered'].includes(head.state) ? head.state : 'open') as CarbonState
  const asked = /^\d{4}-\d{2}-\d{2}/.test(head.asked || '') ? head.asked.slice(0, 10) : (/^(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] || '')
  return {
    file,
    title,
    state,
    kind: head.kind === 'task' ? 'task' : 'question',
    asked,
    by: head.by || '',
    ease: nums.ease ?? null,
    impact: nums.impact ?? null,
    urgency: nums.urgency ?? null,
    priority: complete ? Math.round((nums.ease * nums.impact * nums.urgency / 125) * 100) / 100 : null,
    minutes: num(head.minutes),
    blocks: head.blocks || '',
    recommend: head.recommend || '',
    predict: head.predict || '',
    answered: head.answered || '',
    answer: head.answer || '',
    took: num(head.took),
    hit: head.hit || '',
    ...unclearOf(head.unclear, body),
    body,
    markdown,
  }
}

/** A short, stable fingerprint of a mission's body (FNV-1a), to tell whether the asker has changed it. */
export function bodyHash(body: string): string {
  let hash = 2166136261
  const text = body.replace(/\r\n?/g, '\n').trim()
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function unclearOf(value: string | undefined, body: string): { unclear: CarbonMission['unclear']; sinking: boolean } {
  const match = /^(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{8})$/.exec((value || '').trim())
  if (!match) return { unclear: null, sinking: false }
  return { unclear: { date: match[1], hash: match[2] }, sinking: match[2] === bodyHash(body) }
}

/** "Not enough to decide": noted in the header with the body's fingerprint; the mission sinks until the body changes. */
export function markUnclear(text: string, date: string): string {
  const markdown = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = markdown.split('\n')
  const { end } = readHeader(lines)
  const { body } = parseCarbonMission('x.md', markdown)
  const header = lines.slice(0, end).filter(line => line.slice(0, line.indexOf(':')).trim().toLowerCase() !== 'unclear')
  header.push(`unclear: ${date} ${bodyHash(body)}`)
  return [...header, ...lines.slice(end)].join('\n')
}

/**
 * Who to talk to about a mission: the agent named in `by` if it is in the village, else Anorak (a mission asked
 * by Anorak or one of his helpers goes to him). Names match whole, any case; "Hacker (via Anorak)" finds Hacker.
 */
export function askingAgent<T extends { id: string; name: string }>(by: string, agents: T[]): T | null {
  const wanted = by.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()
  const byName = (name: string) => agents.find(agent => (agent.name || '').toLowerCase() === name)
  const anorak = byName('anorakdev') || agents.find(agent => /^anorak/i.test(agent.name || '')) || null
  if (!wanted || /anorak|helper|subagent/.test(wanted)) return anorak
  const exact = byName(wanted)
  if (exact) return exact
  const first = wanted.split(/[,;+&]| and /)[0].trim()
  return byName(first) || agents.find(agent => first.length > 1 && (agent.name || '').toLowerCase().startsWith(first)) || anorak
}

export type BodyPart = { kind: 'text'; text: string } | { kind: 'command'; text: string }

/** A mission's body with its commands taken out, to stand in a box with a copy button: fenced blocks, and lines that are only `code`. */
export function splitCommands(body: string): BodyPart[] {
  const parts: BodyPart[] = []
  let text: string[] = []
  const flush = () => {
    if (text.join('\n').trim()) parts.push({ kind: 'text', text: text.join('\n') })
    text = []
  }
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const code: string[] = []
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) code.push(lines[j++])
      flush()
      if (code.join('').trim()) parts.push({ kind: 'command', text: code.join('\n').replace(/\s+$/, '') })
      i = j
      continue
    }
    const only = /^\s*(?:[-*]\s+|\d+\.\s+)?`([^`]+)`\s*$/.exec(line)
    if (only) {
      flush()
      parts.push({ kind: 'command', text: only[1] })
      continue
    }
    text.push(line)
  }
  flush()
  return parts
}

/** The message the asking agent gets when he presses "not enough to decide". */
export function formatUnclearNote(m: Pick<CarbonMission, 'file' | 'title'>): string {
  return [
    `[Mindcraft · Carbon] The owner could not decide "${m.title}" (docs/questions/${m.file}) from the file.`,
    'Add what is missing to the file itself (the context, the command to run, the text to approve, what a yes and a no lead to), not in your thread. Until the file changes, the mission sits at the bottom of his list.',
  ].join('\n')
}

export function isCarbonFile(name: string): boolean {
  return /\.md$/i.test(name) && name.toLowerCase() !== 'readme.md' && !name.startsWith('.') && !name.startsWith('_')
}

export type CarbonSort = 'priority' | 'oldest' | 'newest' | 'urgency' | 'impact' | 'ease'

/** Open first, then parked, then answered; within each, by `sort` (priority by default), ties by date then name. */
export function sortCarbon<T extends Pick<CarbonMission, 'file' | 'state' | 'asked' | 'priority' | 'urgency' | 'impact' | 'ease'>>(list: T[], sort: CarbonSort = 'priority'): T[] {
  const stateOrder: Record<CarbonState, number> = { open: 0, parked: 1, answered: 2 }
  // An open mission he couldn't decide sinks below the other open ones until its body changes.
  const rank = (m: T) => stateOrder[m.state] + ((m as { sinking?: boolean }).sinking && m.state === 'open' ? 0.5 : 0)
  const key = (m: T): number => {
    if (sort === 'priority') return -(m.priority ?? -1)
    if (sort === 'urgency') return -(m.urgency ?? 0)
    if (sort === 'impact') return -(m.impact ?? 0)
    if (sort === 'ease') return -(m.ease ?? 0)
    return 0
  }
  return [...list].sort((a, b) => {
    const s = rank(a) - rank(b)
    if (s) return s
    if (sort === 'oldest' || sort === 'newest') {
      const d = a.asked < b.asked ? -1 : a.asked > b.asked ? 1 : 0
      if (d) return sort === 'oldest' ? d : -d
    } else {
      const k = key(a) - key(b)
      if (k) return k
    }
    return (a.asked < b.asked ? -1 : a.asked > b.asked ? 1 : 0) || (a.file < b.file ? -1 : 1)
  })
}

export interface CarbonAnswer {
  /** His words. */
  answer: string
  /** `answered`, or `parked` (he said "later"). */
  state: 'answered' | 'parked'
  /** Minutes the mission was open in front of him. */
  took: number | null
  /** The day, `2026-11-20`. */
  date: string
}

/**
 * Write an answer into the header: state, answered (or parked), answer, took. Header lines it doesn't
 * set stay as they are, in their place; the body is not touched.
 */
export function answerCarbonMission(text: string, input: CarbonAnswer): string {
  const markdown = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = markdown.split('\n')
  const { end } = readHeader(lines)
  const header = lines.slice(0, end)
  const rest = lines.slice(end)
  const set = (key: string, value: string) => {
    const at = header.findIndex(line => line.slice(0, line.indexOf(':')).trim().toLowerCase() === key)
    const line = `${key}: ${value.replace(/\s*\n\s*/g, ' ').trim()}`
    if (at < 0) header.push(line)
    else header[at] = line
  }
  set('state', input.state)
  if (input.state === 'answered') set('answered', input.date)
  else set('parked', input.date)
  set('answer', input.answer)
  if (input.took !== null && Number.isFinite(input.took)) set('took', String(Math.max(0, Math.round(input.took))))
  const body = rest.length && rest[0].trim() ? ['', ...rest] : rest
  return [...header, ...body].join('\n')
}

/** The quick answers. Yes is the recommendation, in its words. */
export function quickAnswer(choice: 'yes' | 'no' | 'later' | 'done', mission: Pick<CarbonMission, 'recommend'>): { answer: string; state: 'answered' | 'parked' } {
  if (choice === 'yes') return { answer: mission.recommend ? `yes (as recommended: ${mission.recommend})` : 'yes', state: 'answered' }
  if (choice === 'later') return { answer: 'later', state: 'parked' }
  if (choice === 'done') return { answer: 'done', state: 'answered' }
  return { answer: 'no', state: 'answered' }
}

/**
 * The garden's mission wall shows his open missions (the owner, 2026-11-20: "the missions that are in the Zen
 * garden are actually relevant to the agents"; they should be his). One panel per open mission, highest
 * priority first, at most `max`; the caption says how long it takes him and what waits on it.
 */
export function carbonWallMissions(list: CarbonMission[], max = 24): Mission[] {
  return sortCarbon(list.filter(m => m.state === 'open')).slice(0, max).map(m => ({
    file: m.file,
    title: m.title,
    state: m.kind,
    column: 'to do' as const,
    who: m.by ? `asked by ${m.by}` : '',
    doneWhen: '',
    ease: m.ease,
    impact: m.impact,
    urgency: m.urgency,
    priority: m.priority,
    tldr: [m.minutes !== null ? `about ${m.minutes} min of your time` : '', m.blocks ? `waits: ${m.blocks}` : ''].filter(Boolean).join(' · ') || (m.kind === 'task' ? 'a thing to do' : 'a question for you'),
    picture: '',
    pictureUrl: null,
    markdown: m.markdown,
  }))
}

/** The message Anorak gets when the owner answers. */
export function formatAnswerNote(m: Pick<CarbonMission, 'file' | 'title' | 'recommend' | 'predict'>, answer: string, state: 'answered' | 'parked', took: number | null): string {
  return [
    `[Mindcraft · Carbon] The owner ${state === 'parked' ? 'parked' : 'answered'} "${m.title}" (docs/questions/${m.file})${took !== null ? ` after ${took} min` : ''}:`,
    '',
    answer.trim(),
    '',
    `Recommendation was: ${m.recommend || '—'}. Your prediction was: ${m.predict || '—'}.`,
    'The file has state, answered and answer in its header now. Act on it, write `hit` (yes / partly / no), and update the decisions and the board.',
  ].join('\n')
}
