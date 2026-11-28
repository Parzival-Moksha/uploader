// Why Claude Code asks, in plain words (the owner, 26 Nov: prompts in bypass he could not read).
//
// Claude Code's own safety checks ask even in bypass and auto, and their answer cannot be remembered ("requires
// explicit approval and cannot be auto-allowed by permission rules"). A can_use_tool request then carries
// decision_reason ("Dangerous rm operation on statically-unresolvable target: C:\box\*") and decision_reason_type
// "safetyCheck" (captured from claude 26 Nov on a sandbox agent in bypass: `cd seq && rm -f *`). This only says what
// the check is; it never answers it. The page has the same words (src/lib/village/village-decisions.ts); a test keeps
// them together.

/** The reason in plain words, or null when the request carries none. */
export function plainPermissionReason(reason, type) {
  const text = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  if (/dangerous rm/i.test(text)) {
    if (/working directory or its ancestor/i.test(text)) return 'wants to delete its working folder or a folder above it';
    if (/statically[- ]unresolvable|cannot be statically resolved|command substitution|cannot be checked/i.test(text)) return 'wants to delete files it cannot name in advance';
    if (/critical system directory/i.test(text)) return 'wants to delete a whole top-level folder';
    return 'wants to delete something Claude Code always asks about';
  }
  const clipped = text.length > 200 ? `${text.slice(0, 199)}…` : text;
  return type === 'safetyCheck' ? `Claude Code's safety check asks: ${clipped}` : clipped;
}

/** The card's (and the ping's) first line: the plain reason, then the whole command on one line; else null. */
export function permissionHeadline(toolName, input, reason, type) {
  const plain = plainPermissionReason(reason, type);
  if (!plain) return null;
  const command = input && typeof input === 'object' && typeof input.command === 'string' ? input.command.replace(/\s+/g, ' ').trim() : '';
  return command ? `${plain}: ${command.length > 300 ? `${command.slice(0, 299)}…` : command}` : plain;
}

/** The few words over a waiting agent's head (Companion's sign): what it needs from him, by kind. */
export function permissionSign(decision) {
  if (decision.requestKind === 'question') return 'has a question for you';
  if (decision.requestKind === 'plan') return 'has a plan for you to approve';
  const reason = typeof decision.decisionReason === 'string' ? decision.decisionReason : '';
  if (/dangerous rm/i.test(reason)) {
    if (/working directory or its ancestor/i.test(reason)) return 'needs your yes: delete its working folder';
    if (/critical system directory/i.test(reason)) return 'needs your yes: delete a top-level folder';
    return 'needs your yes: delete files';
  }
  const input = (decision.input && typeof decision.input === 'object' ? decision.input : {});
  const file = typeof input.file_path === 'string' ? input.file_path.split(/[\\/]/).pop() : '';
  switch (decision.toolName) {
    case 'Bash': case 'PowerShell': return 'needs your yes: run a command';
    case 'Write': return file ? `needs your yes: write ${file}` : 'needs your yes: write a file';
    case 'Edit': case 'NotebookEdit': return file ? `needs your yes: edit ${file}` : 'needs your yes: edit a file';
    case 'WebFetch': return 'needs your yes: open a web page';
    case 'WebSearch': return 'needs your yes: search the web';
    default: return decision.toolName ? `needs your yes: ${decision.toolName}` : 'needs your yes';
  }
}
