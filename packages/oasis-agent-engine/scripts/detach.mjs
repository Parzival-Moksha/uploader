#!/usr/bin/env node
// Start a long job so it outlives the agent that starts it (27 Nov: Tyler's final encode died with his session's
// restart). An agent's background Bash and subagents live inside its claude process: a restart, an account move or
// an engine restart ends them. A job started here does not belong to that process tree: this script starts a runner
// and exits at once, so the runner's parent is gone and a tree kill of the agent cannot reach it. The runner goes
// through the heavy-job wrapper when this machine has it (below normal priority, one heavy job at a time), writes
// the job's output to a log and, when it ends, its exit code to a status file.
//
//   node detach.mjs --name "EP314 final encode" [--cwd C:/dir] -- ffmpeg -i in.mov out.mp4
//   node detach.mjs --status <the .json it printed>      running (pid) / done, exit N, how long
//
// Check the status file (or the log) from a later turn: it says when the job is done, whatever happened to you.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..', '..', '..');
const JOBS = process.env.OASIS_JOBS_DIR || path.join(ROOT, 'logs', 'jobs');
const HEAVY_JOB = process.env.OASIS_HEAVY_JOB || 'C:/7m_sysadmin/scripts/heavy-job.ps1';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (args[0] === '--runner') {
  // The runner: runs the job, waits for it, writes how it ended.
  const status = args[1];
  const job = JSON.parse(fs.readFileSync(status, 'utf8'));
  const out = fs.openSync(job.log, 'a');
  const useWrapper = process.platform === 'win32' && fs.existsSync(HEAVY_JOB);
  const child = useWrapper
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HEAVY_JOB, '-Name', job.name, '-Cwd', job.cwd, '-Command', job.command], { cwd: job.cwd, stdio: ['ignore', out, out], windowsHide: true })
    : spawn(job.command, { cwd: job.cwd, shell: true, stdio: ['ignore', out, out], windowsHide: true });
  if (!useWrapper) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here */ } }
  fs.writeFileSync(status, JSON.stringify({ ...job, runner: process.pid, pid: child.pid, state: 'running' }, null, 2));
  child.on('exit', (code) => {
    const endedAt = Date.now();
    fs.writeFileSync(status, JSON.stringify({ ...job, runner: process.pid, pid: child.pid, state: 'done', exit: code ?? 1, endedAt, minutes: Math.round((endedAt - job.startedAt) / 6000) / 10 }, null, 2));
    process.exit(0);
  });
} else if (args[0] === '--status') {
  const job = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  if (job.state === 'done') console.log(`${job.name}: done, exit ${job.exit}, ${job.minutes} min. Log: ${job.log}`);
  else if (job.runner && alive(job.runner)) console.log(`${job.name}: running (pid ${job.pid}) for ${Math.round((Date.now() - job.startedAt) / 60000)} min. Log: ${job.log}`);
  else console.log(`${job.name}: its runner is gone without saying how it ended (the PC restarted?). Log: ${job.log}`);
} else {
  const dash = args.indexOf('--');
  const command = dash >= 0 ? args.slice(dash + 1).join(' ') : '';
  const name = opt('--name') || command.slice(0, 40) || 'a job';
  if (!command) { console.error('usage: node detach.mjs --name "<what>" [--cwd <dir>] -- <command>'); process.exit(2); }
  fs.mkdirSync(JOBS, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
  const base = path.join(JOBS, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${slug}`);
  const job = { name, command, cwd: path.resolve(opt('--cwd') || process.cwd()), log: `${base}.log`, startedAt: Date.now(), state: 'starting' };
  fs.writeFileSync(`${base}.json`, JSON.stringify(job, null, 2));
  const runner = spawn(process.execPath, [SELF, '--runner', `${base}.json`], { detached: true, stdio: 'ignore', windowsHide: true });
  runner.unref();
  console.log(`Started "${name}" on its own (it outlives your session). Log: ${job.log}\nStatus: node "${SELF}" --status "${base}.json"`);
}
