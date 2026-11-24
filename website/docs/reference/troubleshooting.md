---
title: When something is wrong
sidebar_position: 1
---

# When something is wrong

Run this first, in the Oasis's folder:

```
node scripts/oasis.mjs status
```

It says whether the page server and the agent engine run, and on which ports.

| What you see | What it means | What to do |
|---|---|---|
| "This browser has not got this Oasis's key" | The servers run, but this browser (or `127.0.0.1` instead of `localhost`, or a private window) has not got the local key. | `node scripts/oasis.mjs open` (or `/oasis` in Claude Code) opens your default browser with the key; `node scripts/oasis.mjs link` puts the keyed address on the clipboard for another browser. |
| "Agent engine offline" | The engine stopped. | `node scripts/oasis.mjs start` starts what is not running. |
| "Oasis server offline" | The page server stopped. | The same. |
| An empty world, no Agents button, nobody to summon | The page was started without the start script (`next dev` or `next start` alone). | Stop it, then `node scripts/oasis.mjs start`. |
| The start never finishes | Another program uses port 4516 or 4530. | `OASIS_WEB_PORT=5016 OASIS_PORT=5030 node scripts/oasis.mjs start`, and the same pair every time after. |
| The microphone does nothing | No engine for voice typing yet. | See [Voice](../user-guide/voice.md): Settings → Sound → Voice typing says which one is used. |
| An agent says every account is out of usage | Your Claude plan's limit is reached. | It waits and goes on by itself when the limit resets; the summon menu says until when. |

Logs, in the Oasis's folder: `logs/world.log` (the page server) and `logs/engine.log` (the agent engine).

## Report it

Open an issue at https://github.com/Parzival-Moksha/uploader/issues with what the screen said, word for word, the last lines of the log, and your system (Windows, macOS with its chip, Linux). Or ask your coding agent to do it: the [page for coding agents](../getting-started/for-agents.md) says what to include. You get an answer within a day.
