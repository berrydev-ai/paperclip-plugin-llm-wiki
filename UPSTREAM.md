# Upstream and fork policy

This repository is a maintained fork of the LLM Wiki plugin that lives in the
Paperclip monorepo.

| | |
|---|---|
| Upstream repo | https://github.com/paperclipai/paperclip |
| Upstream path | `packages/plugins/plugin-llm-wiki` |
| Forked at | `3ff636bc4852dfc07fcab8ccfdb0b4fd22c1548c` (2026-08-22) |
| Upstream package | `@paperclipai/plugin-llm-wiki` (npm, last published `0.1.0` on 2026-05-11) |
| This package | `@berrydev-ai/plugin-llm-wiki` |

## Why this fork exists

`@paperclipai/plugin-llm-wiki@0.1.0` cannot be installed from npm. It ships its
bootstrap gitignore as `templates/.gitignore`, and npm treats that filename
specially — it renames it to `.npmignore` when unpacking into `node_modules`. The
manifest reads that template at module load, so every install failed with:

```
Failed to load manifest module at .../dist/manifest.js:
Error: ENOENT: no such file or directory, open '.../templates/.gitignore'
```

Upstream fixed the source of the bug (the template is now
`templates/gitignore.template`, written out as `.gitignore` at bootstrap) but has
not published a release since, and the package is marked `private` in the
monorepo and absent from `scripts/release-package-manifest.json`, so no CI
release picks it up. This fork carries the fix on a published package.

## What diverges from upstream

Kept deliberately identical so upstream changes merge cleanly — `src/`,
`tests/`, `templates/`, `agents/`, `migrations/`, `skills/`, `fixtures/`,
`tsconfig.json`, `vitest.config.ts`, `esbuild.config.mjs`, `rollup.config.mjs`.

Intentional differences:

- **`package.json`** — renamed to `@berrydev-ai/plugin-llm-wiki`, no longer
  `private`, standalone scripts (no `pnpm --filter` monorepo indirection),
  `@paperclipai/plugin-sdk` pinned to a published version instead of
  `workspace:*`, and `jsdom` added because it is no longer hoisted from the
  monorepo root.
- **Plugin id is unchanged** — the manifest still declares
  `paperclipai.plugin-llm-wiki`. That is deliberate: an instance that already has
  the upstream plugin installed keeps its wiki data, applied migrations and
  plugin row when it reinstalls from this package. The tradeoff is that this
  plugin and the bundled upstream one cannot both be active on one instance.
- **`tests/packaging.spec.ts`** — new. See below.
- **`.github/workflows/ci.yml`**, **`LICENSE`**, **`.nvmrc`**, this file — new.

## The packaging guard

`tests/packaging.spec.ts` exists so the original bug cannot recur. It packs the
package, genuinely installs the tarball into a temp prefix the way the Paperclip
server does (`npm install <spec> --prefix <dir> --ignore-scripts`), and then
imports the *installed* manifest.

A "is the file in the tarball" assertion would not have caught the original bug —
the file **was** in the published tarball and only disappeared at install time.
The guard also scans the source tree for filenames npm rewrites, because newer
npm (11.x) drops `.gitignore` at pack time instead, which the tarball comparison
alone would miss.

## Syncing from upstream

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git   # once
git fetch upstream master
git diff <last-synced-sha>..upstream/master -- packages/plugins/plugin-llm-wiki
```

Apply the relevant hunks, then update the "Forked at" SHA above. Run
`npm test` (on Node 24 — see `.nvmrc`) before publishing; the packaging guard is
part of that suite.

Do **not** take upstream's `package.json` wholesale — it carries the monorepo
`workspace:*` deps, the `private` flag and the `pnpm --filter` scripts that this
fork deliberately drops.
