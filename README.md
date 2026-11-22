# The Oasis

Your Claude Code sessions as characters in a 3D village on your own machine. Walk around, see who is working, who is waiting and who needs a decision, and talk to any session by typing or by voice. What you say in the village arrives in that same session.

## Install: one sentence

Tell your Claude Code (or any coding agent that can run commands):

```
install the Oasis from github.com/Parzival-Moksha/uploader and open it
```

It clones this repository, installs and builds it (about five minutes the first time) and opens the village in your browser. You need Node.js 20 or later and git.

## Or with the Claude Code plugin

```
/plugin marketplace add Parzival-Moksha/uploader
/plugin install oasis@oasis
```

Then type `/oasis` in a new session. The plugin also lets you talk from the village to sessions running in the Claude Code app or a terminal. The first time it downloads this repository's release, installs its packages and builds it (a few minutes, once). After that it starts in seconds and opens the village in your browser.

## Or by hand

You need Node.js 20 or later and Claude Code.

```
git clone --depth 1 https://github.com/Parzival-Moksha/uploader.git
cd uploader
node scripts/oasis.mjs start
```

`node scripts/oasis.mjs status` says what is running, `node scripts/oasis.mjs stop` stops it. It works the same on Windows, macOS and Linux. (macOS and Linux: written with care, not yet run by us on a Mac.)

## What runs on your machine

- **The page server** on `127.0.0.1:4516` (Next.js): the 3D village in your browser.
- **The agent engine** on `127.0.0.1:4530`: it lists your Claude Code sessions from `~/.claude/projects`, mirrors them, and runs the ones you start in the village as ordinary `claude` processes under your own account, with the permission mode you choose. Permission prompts appear in the village for you to answer; nothing is approved for you.
- **On its first start, the voice-typing helper sets itself up:** it needs a Python 3 on your machine, downloads about 50 MB of Python packages from PyPI (pinned versions) and a 259 MB English speech model (Moonshine, MIT) from download.moonshine.ai, each file checked against its published list. About a minute. It then turns your voice into text on this machine, without sending it anywhere. Until it is ready, and on machines where it cannot run (no Python 3, an Intel Mac, macOS before 15), the microphone uses your browser's own speech recognition, which sends the audio to the browser's maker. `OASIS_EARS_INSTALL=0` in `.env` switches the helper off.
- Both servers listen on this machine only. Nothing is sent to us: no account, no telemetry.

## Voice

- Agents can speak. By default they use your browser's built-in voices: free, no key.
- You can talk instead of typing where your browser offers speech recognition.
- Optional: an ElevenLabs voice with your own key (`ELEVENLABS_API_KEY` in `.env`). Then the text to be spoken goes to ElevenLabs under your account.

## About this repository

This is the packaged Oasis: the village, the agent engine, the Claude Code plugin and a Hermes skill, with only assets that may be passed on. A script makes it from the authors' main repository; pull requests here are welcome all the same and are carried over by hand (see CONTRIBUTING.md).

## What the characters can do today

- Your own body and every agent stand, idle, walk, jog, sprint, roll, talk with moving hands, cast, flinch and fall. These come from the Quaternius Universal Animation Library (CC0).
- They do not dance, sit, wave or emote yet. The dances and some walks in the authors' own Oasis are Mixamo files, which Adobe does not allow to be passed on as files, so they are not in this package. A free set is being added.
- With an ElevenLabs voice, an agent's mouth follows its words. With the browser's built-in voice it speaks, but the mouth does not move yet.
- 41 avatars in the full Oasis, 12 in the lite one. All state CC0 in their own files.

## Something broke?

Open an issue at https://github.com/Parzival-Moksha/uploader/issues with what the screen said, word for word, and your system (Windows, macOS, Linux). You get an answer within a day.

## Contributing

Pull requests are welcome here: fixes for a Mac, Linux or your setup most of all. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licences

The code is MIT (see `LICENSE`). Pictures, 3D models, avatars, animations, sounds and fonts keep the licences of their authors. Every avatar, sound, picture, animation and font is listed with its source and licence in `ASSETS.md`.
