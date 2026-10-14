# FileClass Inline

FileClass Inline is a companion extension to [FileClass](https://github.com/mdelobelle/fileclass). It extends FileClass's typed-note workflow with inline `@` creation, fuzzy linking of names and aliases, and safe cleanup of unused link-created notes.

This repository is currently a standalone prototype with its own YAML schema format; direct FileClass compatibility is the intended direction. It also includes an isolated local development vault.

## Setup

```sh
npm install
npm run dev
```

The dev command sets up `dummy-vault/`, downloads and enables [Hot Reload](https://github.com/pjeby/hot-reload) (pinned at 0.3.1), and watches `src/`. It writes `main.js` and `manifest.json` directly to `dummy-vault/.obsidian/plugins/fileclass-inline/`. Open **this folder's `dummy-vault/`** as a vault in Obsidian (not the repository root). If Obsidian prompts about community plugins, allow them in this disposable vault. Create a schema in `Schemas/` (example below), then run **FileClass Inline: Create node**.

Keep `npm run dev` running while editing. Hot Reload watches the `.hotreload` marker and reloads the plugin after a successful rebuild. If you change `manifest.json`, restart `npm run dev` to sync it. Use `npm run typecheck` for TypeScript checks.

## Using FileClass Inline

Put a schema in `Schemas/person.md`:

```markdown
---
nodeSchema: 1
nodeType: person
label: Person
properties:
  status:
    kind: select
    options: [active, inactive]
    default: active
  active:
    kind: checkbox
    requiredOnCreate: true
    default: true
---
# {{title}}

## Notes
```

To link tasks to existing projects and people, add `Schemas/task.md`:

```markdown
---
nodeSchema: 1
nodeType: task
label: Task
properties:
  project:
    kind: link
    targetType: project
    requiredOnCreate: true
  assignee:
    kind: link
    targetType: person
  status:
    kind: select
    options: [todo, in-progress, done]
    default: todo
---
# {{title}}
```

Each task needs a project; the assignee can be left empty. Both fields are direct, type-filtered dropdowns showing only node names (no tag or path); an optional link can be unset from the same dropdown. Ordinary Obsidian backlinks show the relationship on the project and person notes.

- **FileClass Inline: Create node** picks a schema, prompts for a filename and required properties, then creates a normal Markdown file in `Nodes/`. Press **Ctrl+Enter** (or **⌘+Enter** on Mac) to submit the creation form. The schema's `nodeType: person` becomes `type: person`; its numeric `nodeSchema: 1` becomes `schema: 1`. Both properties are plugin-owned and cannot be redefined under `properties`. `false` and `0` count as filled values; cleared optional defaults are omitted. Cancel before submission creates nothing.
- Type `@` plus a node name to choose an existing fuzzy match or **Create…**. Picker rows show `Ada Lovelace #person` on one line. Choose with your keyboard or tap; new links use the shortest unambiguous wikilink (such as `[[Ada Lovelace]]`, with a folder only when needed). The symbol can be changed in settings.
- Select text and type `@`: the selection stays intact while FileClass Inline searches existing names and aliases. If there are matches, choose an existing node or **Create…**; if there are none, choose a schema/type and create one. A one-line selection becomes the draft title and, when linked, keeps its original wording as the label. For a multi-line selection, FileClass Inline prompts for a title and copies the full selection into the new node before replacing the original text with its link (it never silently discards multiple lines to link an existing note).
- **FileClass Inline: Create or link node** (also in the editor menu) provides the same selected-text flow. With no selection, it searches from the cursor. Add the command to Obsidian's mobile toolbar as a fallback if a software keyboard does not deliver `@` as a normal text input.
- **FileClass Inline: Check schemas** displays invalid YAML/schema and property-kind conflicts, with buttons to open affected files.
- Typed nodes are only Markdown files under `Nodes/` with a scalar `type` property. A missing schema doesn't hide existing nodes from search. Settings can change the folder paths without moving files.

Supported property kinds: `text`, `number`, `checkbox`, `date`, `select`, `link`, `text-list`. `requiredOnCreate` and type-appropriate `default` are optional. A link property optionally specifies `targetType` and uses a direct dropdown of existing typed nodes; recursive creation within a field is not supported. Fields are flat YAML Properties; Obsidian native property types are vault-wide. Templates support literal `{{title}}`, `{{date}}` (local YYYY-MM-DD), and `{{property:fieldname}}`. No arbitrary code or external template plugin is needed. YAML-authored schemas are the permanent interface.

Filename collisions never overwrite. If the source editor changes while a creation form is open, the created node is kept but no unsafe link insertion occurs. Existing properties aren't silently migrated when a schema changes. Fuzzy matching uses character-sequence matching, not AI/semantic search.

### Cleaning up unused nodes

When a link-created node loses its last link, FileClass Inline can move it to **Obsidian’s local trash** in the background after a short delay. This only applies to nodes created by this plugin **while inserting a link**, whose content is byte-for-byte unchanged from creation and whose values came solely from the schema/defaults. Typed nodes with any user-entered properties, copied multi-line text, outgoing links, another incoming link, or a changed schema are kept. Standalone-created and pre-existing notes are never tracked. Cleanup also waits for resolved links and refuses to act on open nodes or while an editor has unsaved changes. Disabling the plugin or cleanup before the link disappears fails safe rather than deleting a backlog on restart.

Cleanup is enabled by default and can be turned off in **Settings → FileClass Inline → Clean up unused nodes**. It never permanently deletes: recover a moved note from the vault’s `.trash/` folder. The plugin stores a small record of eligible generated nodes in its own settings data; removing that data disables cleanup of those nodes rather than guessing what to remove.

**Verification:** Automated checks validate metadata, types, focused core behavior, and build assets. Native desktop/mobile use still needs an in-app smoke check; `isDesktopOnly: false` is not evidence of real-device verification.

## Optional integrations

Reader and other plugins can use the versioned public `plugin.api` surface to discover types, search/read nodes, and open standalone creation forms without inserting editor links. See [API.md](API.md) for the v1 contract, lifecycle, and cancellation behavior.

## Files

- `src/main.ts` — plugin entry point.
- `manifest.json` — Obsidian plugin ID, name and version.
- `scripts/setup-dev-vault.mjs` — idempotent vault setup; refuses unmarked existing vault/plugin folders.
- `scripts/build.mjs` — dev watcher or release build.
- `dummy-vault/` — local, gitignored test vault (never use a personal vault here).
- `dist/` — gitignored release output from `npm run build` (`main.js` and `manifest.json`; no vault data or Hot Reload marker).

The setup script never removes vault data. To reset the disposable vault, close it in Obsidian first and remove `dummy-vault/` yourself.
