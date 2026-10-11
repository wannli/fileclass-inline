# Nodes — Obsidian plugin development

A minimal TypeScript plugin and isolated local development vault. The example plugin adds a **Nodes: Say hello** command; replace `src/main.ts` with your plugin code.

## Setup

```sh
npm install
npm run dev
```

The dev command sets up `dummy-vault/`, downloads and enables [Hot Reload](https://github.com/pjeby/hot-reload) (pinned at 0.3.1), and watches `src/`. It writes `main.js` and `manifest.json` directly to `dummy-vault/.obsidian/plugins/obsidian-nodes/`. Open **this folder's `dummy-vault/`** as a vault in Obsidian (not the repository root). If Obsidian prompts about community plugins, allow them in this disposable vault. Run **Nodes: Say hello** from the command palette to confirm it loaded.

Keep `npm run dev` running while editing. Hot Reload watches the `.hotreload` marker and reloads the plugin after a successful rebuild. If you change `manifest.json`, restart `npm run dev` to sync it. Use `npm run typecheck` for TypeScript checks.

## Files

- `src/main.ts` — plugin entry point.
- `manifest.json` — Obsidian plugin ID, name and version.
- `scripts/setup-dev-vault.mjs` — idempotent vault setup; refuses unmarked existing vault/plugin folders.
- `scripts/build.mjs` — dev watcher or release build.
- `dummy-vault/` — local, gitignored test vault (never use a personal vault here).
- `dist/` — gitignored release output from `npm run build` (`main.js` and `manifest.json`; no vault data or Hot Reload marker).

The setup script never removes vault data. To reset the disposable vault, close it in Obsidian first and remove `dummy-vault/` yourself.

## Releases

The GitHub Actions pipeline follows `obsidian-reader2`: Release Please manages version/changelog PRs, then attaches checked plugin assets to a draft release before publishing.

Enable **Allow GitHub Actions to create and approve pull requests** in the repository's Actions settings. Pushes to `main` run checks and update the release PR. The default GitHub token cannot trigger PR CI; a human can close and reopen that PR to trigger checks. Merging a release PR publishes the release and requires Wannes's approval—do not auto-merge or tag manually.

Release Please owns package, lockfile, plugin version, and changelog updates. `0.1.0` is the initial baseline, not a published release. Update `versions.json` only when the minimum Obsidian version changes, preserving earlier entries. If publication fails, inspect the draft and logs; do not overwrite assets or move tags automatically.

Approved Conventional Commit scopes are **`main`** (core work), **`schemas`**, and **`ui`**. Other scopes require Wannes's approval.

Run `npm run check` for metadata validation, typechecking, release-tooling tests, and a production build. These checks do not prove native Obsidian behavior.

### Install a release

Requires Obsidian **1.5.0 or later**. The manifest allows desktop and mobile; native-device compatibility still needs verification.

Download `main.js` and `manifest.json` from a published GitHub release into `<vault>/.obsidian/plugins/obsidian-nodes/` (create the folder if needed). Enable **Nodes** under Community plugins. To update, replace those files and reload Obsidian. Do not install GitHub's source archives as plugin assets.
