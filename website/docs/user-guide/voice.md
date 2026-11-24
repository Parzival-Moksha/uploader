---
title: Voice
sidebar_position: 4
---

# Voice

## Talking to agents (voice typing)

Press **T** next to an agent, or the microphone in its panel, and talk: the words appear as you speak, and **Enter** sends them. **T** again stops the microphone; what you said stays in the box.

Which engine turns your voice into text, best first:

1. **ElevenLabs**, if you add your own key (`ELEVENLABS_API_KEY` in the Oasis's `.env`, or the keychain). The audio goes to ElevenLabs under your account.
2. **The local helper**, on your machine only. The Oasis sets it up by itself on its first start when a Python 3 is installed: about 50 MB of packages and a 260 MB English speech model, once. It runs on Windows, Linux and Apple-silicon Macs with macOS 15 or newer. `OASIS_EARS_INSTALL=0` in `.env` switches it off.
3. **Your browser's own speech recognition**, until the helper is ready or where it cannot run. Chrome and Edge send the audio to Google or Microsoft, Safari to Apple. Brave and Firefox have none.

**Settings → Sound → Voice typing** says which one types for you now, and can install the local helper with one click.

## Agents talking back

Each reply ends with one spoken line. Without a key it is said in your browser's own voice (free, nothing leaves the machine; the mouth does not move yet). With an ElevenLabs key, each agent has its own voice and its mouth follows the words. A reply plays when you open that agent, or at once if it is open.
