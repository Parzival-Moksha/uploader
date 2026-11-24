# Contributing

Pull requests are welcome here, on `uploader`. Found something that breaks on your machine (a Mac, Linux, a different shell, a browser)? Fix it the way you would in any repository, ideally with your coding agent, and open a pull request. Say in it what was wrong, on which system, and how you tried the fix.

## How a change gets in

This repository is the packaged Oasis: a script makes it from the authors' main repository, so a change made only here would be overwritten by the next package. That is handled on our side: each merged pull request is carried over into the main repository, with you as its author, and is in the next release. You do not need to do anything for that.

A few files are written by the packaging script and cannot take changes directly: `package.json`, `ASSETS.md`, `data/asset-catalog-extras.json` and the world files in `prisma/default-worlds/`. If your fix needs one of those, describe it in the pull request and we make it in the main repository.

## Trying your change

```
node scripts/oasis.mjs start     # installs, builds and opens it
node scripts/oasis.mjs stop
```

`OASIS_WEB_PORT` and `OASIS_PORT` move it off the default ports (4516 and 4530) if those are taken.

## Something broke? A question?

Open an issue: https://github.com/Parzival-Moksha/uploader/issues. Paste what the screen said, word for word, and your system. You will get an answer within a day.

## Good first fixes

Small, real things a coding agent can fix in about twenty minutes. Say which one you took in your pull request.

1. **Your system.** Anything that breaks on your Mac or Linux machine while installing or starting: the start script is `scripts/oasis.mjs`, the starters are `oasis.command` and `oasis.sh`. The best fix of all, because nobody else can test it.
2. **A port that is taken.** When another program already uses port 4516 or 4530, `node scripts/oasis.mjs start` waits and gives up. It should say at once which port is taken and how to pick others (`OASIS_WEB_PORT`, `OASIS_PORT`), or pick free ones itself.
3. **Quiet misses.** This package leaves out some sounds and one animation that the authors cannot pass on (see `ASSETS.md`); the page then logs 404 errors for `audio/spells/manifest.json` and `animations/Standing Idle To Fight Idle.fbx`. Make those fall back without an error.
4. **Hints that do nothing yet.** The key hints at the top right show "Next agent" and "Next pic" before there is any agent or picture. Show a hint only when its key would do something.
