# Nodes — Obsidian plugin development

Typed Markdown nodes in Obsidian, with YAML schemas, validated creation, and fuzzy linking of names and aliases. Includes an isolated local development vault.

## Setup

```sh
npm install
npm run dev
```

The dev command sets up `dummy-vault/`, downloads and enables [Hot Reload](https://github.com/pjeby/hot-reload) (pinned at 0.3.1), and watches `src/`. It writes `main.js` and `manifest.json` directly to `dummy-vault/.obsidian/plugins/obsidian-nodes/`. Open **this folder's `dummy-vault/`** as a vault in Obsidian (not the repository root). If Obsidian prompts about community plugins, allow them in this disposable vault. Create a schema in `Schemas/` (example below), then run **Nodes: Create node**.

Keep `npm run dev` running while editing. Hot Reload watches the `.hotreload` marker and reloads the plugin after a successful rebuild. If you change `manifest.json`, restart `npm run dev` to sync it. Use `npm run typecheck` for TypeScript checks.

## Using Nodes

Put a schema in `Schemas/person.md`:

```markdown
---
nodeSchema: 1
nodeType: person
label: Person
highlight: green
properties:
  status:
    kind: select
    options: [active, inactive]
    default: active
  active:
    kind: checkbox
    requiredOnCreate: true
---
# {{title}}

## Notes
```

- **Nodes: Create node** picks a schema, prompts for a filename and required properties, then creates a normal Markdown file in `Nodes/`. The schema's `nodeType: person` becomes `type: person`; its numeric `nodeSchema: 1` becomes `schema: 1`. Both properties are plugin-owned and cannot be redefined under `properties`. `false` and `0` count as filled values; cleared optional defaults are omitted. Cancel before submission creates nothing.
- Type `@` plus a node name to choose an existing fuzzy match or **Create…**. Choose with your keyboard or tap; links use Obsidian's current link format. The symbol can be changed in settings.
- Select text and type `@`: the selection stays intact while Nodes searches existing names and aliases. If there are matches, choose an existing node or **Create…**; if there are none, choose a schema/type and create one. A one-line selection becomes the draft title and, when linked, keeps its original wording as the label. For a multi-line selection, Nodes prompts for a title and copies the full selection into the new node before replacing the original text with its link (it never silently discards multiple lines to link an existing note).
- **Nodes: Create or link node** (also in the editor menu) provides the same selected-text flow. With no selection, it searches from the cursor. Add the command to Obsidian's mobile toolbar as a fallback if a software keyboard does not deliver `@` as a normal text input.
- **Nodes: Check schemas** displays invalid YAML/schema and property-kind conflicts, with buttons to open affected files.
- Nodes are only Markdown files under `Nodes/` with a scalar `type` property. A missing schema doesn't hide existing nodes from search. Settings can change the folder paths without moving files.

Optional schema `highlight` uses Obsidian's six native colored-highlight names: `red` 🔴, `orange` 🟠, `yellow` 🟡, `green` 🟢, `blue` 🔵, `purple` 🟣. When a link is completed, Nodes writes normal Obsidian colored-highlight Markdown around it—for example, `==🟢[[Nodes/Wannes|Wannes]]==`. This stays highlighted without the plugin. A missing/invalid type schema leaves links uncolored. Changing a schema's color affects future links only; existing notes are not silently rewritten.

Supported property kinds: `text`, `number`, `checkbox`, `date`, `select`, `link`, `text-list`. `requiredOnCreate` and type-appropriate `default` are optional. A link property optionally specifies `targetType` and uses a picker for an existing typed node; recursive creation within a field is not supported. Fields are flat YAML Properties; Obsidian native property types are vault-wide. Templates support literal `{{title}}`, `{{date}}` (local YYYY-MM-DD), and `{{property:fieldname}}`. No arbitrary code or external template plugin is needed. YAML-authored schemas are the permanent interface.

Filename collisions never overwrite. If the source editor changes while a creation form is open, the created node is kept but no unsafe link insertion occurs. Existing properties aren't silently migrated when a schema changes. Fuzzy matching uses character-sequence matching, not AI/semantic search.

**Verification:** Automated checks validate metadata, types, focused core behavior, and build assets. Native desktop/mobile use still needs an in-app smoke check; `isDesktopOnly: false` is not evidence of real-device verification.

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
