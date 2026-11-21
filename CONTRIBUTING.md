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
