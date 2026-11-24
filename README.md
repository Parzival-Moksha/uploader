# The Oasis

Your Claude Code sessions as characters in a 3D village on your own machine. Walk around, see who is working, who is waiting and who needs a decision, and talk to any session by typing or by voice. What you say in the village arrives in that same session.

## Install: one sentence

Tell your Claude Code (or any coding agent that can run commands):

```
install the Oasis from github.com/Parzival-Moksha/uploader and open it
```

That is all: no plugin, no slash command. It clones this repository (**about 600 MB**: every world and avatar), installs and builds it (about 7 to 10 minutes the first time on a 100 Mbit line) and opens the village in your browser. Every Claude Code session on this machine shows up there. You need Node.js 20 or later and git.

By hand, the same thing:

```
git clone --depth 1 https://github.com/Parzival-Moksha/uploader.git
cd uploader
node scripts/oasis.mjs start
```

On a slow or metered line, the small edition (about 32 MB: one world, 12 avatars) is on every release page as `oasis-lite-<version>.tar.gz`: unpack it and run `node scripts/oasis.mjs start` in it (with the plugin: `/oasis lite`).

Start it only this way (`pnpm dev` and `npm start` run the same script): `next dev` or `next start` alone gives a page without the engine, the database or the village, an empty world where nobody can be summoned. `node scripts/oasis.mjs status` says what is running and which version, `node scripts/oasis.mjs stop` stops it. **To update:** in the Oasis folder, `node scripts/oasis.mjs update` (git pull, then a rebuild; your worlds, agents and keys stay). The version is in the main menu (M), under the Oasis's name. It works the same on Windows, macOS and Linux. (macOS: installs and opens on a clean Mac at every release, checked by machine; no person has watched a Mac install yet. Linux: written with care, not yet run by us.)

## Optional: the Claude Code plugin

Not needed for anything above. It is for people who live in Claude Code and want, from any session, `/oasis`: it opens the village with that session in front of you, gives that session the world tools (look at the world, build in it), and lets you talk from the village to sessions running in the Claude Code app or a terminal. It installs the same full Oasis as this repository, from the release.

```
/plugin marketplace add Parzival-Moksha/uploader
/plugin install oasis@oasis
```

Then type `/oasis` in a new session (the first time it downloads the release and builds it, a few minutes). To update an Oasis the plugin installed: `/oasis update` (plain `/oasis` never updates; it says when a newer one is ready).

## What runs on your machine

- **The page server** on `127.0.0.1:4516` (Next.js): the 3D village in your browser.
- **The agent engine** on `127.0.0.1:4530`: it lists your Claude Code sessions from `~/.claude/projects`, mirrors them, and runs the ones you start in the village as ordinary `claude` processes under your own account, with the permission mode you choose. Permission prompts appear in the village for you to answer; nothing is approved for you.
- **On its first start, the voice-typing helper sets itself up:** it needs a Python 3 on your machine, downloads about 50 MB of Python packages from PyPI (pinned versions) and a 259 MB English speech model (Moonshine, MIT) from download.moonshine.ai, each file checked against its published list. About a minute. It then turns your voice into text on this machine, without sending it anywhere. Until it is ready, and on machines where it cannot run (no Python 3, an Intel Mac, macOS before 15), the microphone uses your browser's own speech recognition, which sends the audio to the browser's maker. `OASIS_EARS_INSTALL=0` in `.env` switches the helper off.
- **Only when you press "Host a party" (World menu):** a party server on this computer's address in your Wi-Fi, port 4680, and an answer to "who has a party?" on UDP port 4599, until you stop the party. Anyone on the same network can join, without a password. They get a separate copy of one world, run from its own folder (`~/.oasis/party`): no agents, none of your worlds, uploads or generated files, and none of your keys unless you switch paid spells on for the evening (then the four spell keys, with a budget). They do see the models in your catalog, to build with. The first time, Windows may ask whether Node.js may use the network.
- Both servers listen on this machine only; only a party you host can be reached from your network. Nothing is sent to us: no account, no telemetry.

## Once it runs

- **Summon a guide** (Agents, top left) starts a first agent that greets you and shows the keys.
- **/docs** in the Oasis (for example `http://localhost:4516/docs`): your first minutes, the keys, agents, building, voice, and what to do when something is wrong.
- A coding agent should read [AGENTS.md](./AGENTS.md): install, start, open, summon, build, report a problem, in one page.

## Voice

- Agents can speak. By default they use your browser's built-in voices: free, no key.
- You can talk instead of typing (T next to an agent): on this machine with the local helper above, or with your browser's speech recognition until it is ready.
- Optional: an ElevenLabs voice with your own key (`ELEVENLABS_API_KEY` in `.env`). Then the text to be spoken goes to ElevenLabs under your account.

## About this repository

This is the packaged Oasis: the village, the agent engine, the Claude Code plugin and a Hermes skill, with only assets that may be passed on. A script makes it from the authors' main repository; pull requests here are welcome all the same and are carried over by hand (see CONTRIBUTING.md).

## What the characters can do today

- Your own body and every agent stand, idle, walk, jog, sprint, roll, talk with moving hands, cast, flinch and fall. These come from the Quaternius Universal Animation Library (CC0).
- They do not dance, sit, wave or emote yet. The dances and some walks in the authors' own Oasis are Mixamo files, which Adobe does not allow to be passed on as files, so they are not in this package. A free set is being added.
- With an ElevenLabs voice, an agent's mouth follows its words. With the browser's built-in voice it speaks, but the mouth does not move yet.
- 42 avatars in the full Oasis, 12 in the lite one. All state CC0 in their own files.

## Something broke?

Open an issue at https://github.com/Parzival-Moksha/uploader/issues with what the screen said, word for word, and your system (Windows, macOS, Linux). You get an answer within a day.

## Contributing

Pull requests are welcome here: fixes for a Mac, Linux or your setup most of all. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licences

The code is MIT (see `LICENSE`). Pictures, 3D models, avatars, animations, sounds and fonts keep the licences of their authors. Every avatar, sound, picture, animation and font is listed with its source and licence in `ASSETS.md`.
