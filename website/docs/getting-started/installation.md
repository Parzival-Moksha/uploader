---
title: Install
sidebar_position: 2
---

# Install

The easiest way: tell your coding agent (Claude Code, Codex, or any agent that can run commands)

```
install the Oasis from github.com/Parzival-Moksha/uploader and open it
```

It clones the repository, installs and builds it (about five minutes the first time) and opens the village in your browser. The page it follows is [For coding agents](./for-agents.md).

## With the Claude Code plugin

```
/plugin marketplace add Parzival-Moksha/uploader
/plugin install oasis@oasis
```

Then type `/oasis` in a new session. The plugin also lets you talk from the village to sessions running in the Claude Code app or a terminal.

## By hand

You need Node.js 20 or later, git, and Claude Code or Codex.

```
git clone --depth 1 https://github.com/Parzival-Moksha/uploader.git oasis
cd oasis
node scripts/oasis.mjs start
```

`node scripts/oasis.mjs stop` stops it, `node scripts/oasis.mjs status` says what runs. Windows, macOS and Linux.

## Update

With the plugin: `/oasis update` in Claude Code. In a clone: `node scripts/oasis.mjs update`. Your worlds, agents, keys and uploads stay. With the plugin, if anything fails the old version comes back; in a clone, a failed build keeps the old one running and the next start tries again. The version shows in the main menu under the name.

## What runs on your machine

- The page, on `127.0.0.1:4516`, and the agent engine, on `127.0.0.1:4530`. Both answer this computer only, and only a browser that has the Oasis's local key.
- The agents you summon run as ordinary `claude` processes under your own plan. Their permission questions come to you.
- Voice typing that stays on your machine sets itself up on the first start when a Python 3 is there (about 300 MB, once).
- Nothing is sent to the authors: no account, no telemetry.
