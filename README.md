# Nodes — a Fileclass companion for Obsidian

Find, create, and reference typed notes without leaving your writing. **Fileclass owns the schemas; Nodes owns fuzzy finding and inline capture.** Notes remain ordinary Markdown with native YAML properties and wikilinks.

## Requirements

Install and enable [Fileclass](https://github.com/mdelobelle/fileclass) with its public API v1. Nodes feature-detects the supported API and fails safely when Fileclass is absent, disabled, or reloaded. The reviewed Fileclass release, 0.2.15, requires Obsidian 1.12.7 or later. Nodes' older manifest floor only permits loading its dependency diagnostic; it does not make Fileclass available on older hosts.

No Fileclass source changes, private modal imports, separate schema engine, or Dataview dependency are needed. Fileclass uses native Bases for its query-backed choices; Nodes delegates those choices to Fileclass rather than parsing `.base` files itself.

## Configure the conventions

In **Settings → Nodes**:

- **Capture folder:** where new notes go; default `Nodes`. Existing typed notes can be found anywhere in the vault.
- **Class binding property:** must match Fileclass's *fileClass alias*; default `fileClass`.
- **Inline trigger:** default `@`.

Class names and icons come from Fileclass. Nodes has no class-color setting and creates no colored highlights. Existing highlighted Markdown is not rewritten.

### Example Fileclass

Create `Person.md` in the class folder configured in **Fileclass**, using Fileclass's editor or YAML:

```yaml
---
icon: user-round
fields:
  - name: email
    id: person-email
    type: Input
    options:
      required: true
    path: ""
  - name: notes
    id: person-notes
    type: Input
    options: {}
    path: ""
---
```

A newly captured note initially contains only the binding and body:

```markdown
---
fileClass: Person
---
# Ada Lovelace
```

Nodes then offers `email`, because it is missing and required. The optional `notes` field never triggers or appears in this form. If there are no missing required values, no completion modal opens.

## While writing

- Type `@` and part of a filename or alias. Results rank exact matches, then prefixes, then fuzzy matches. Each note appears once, with its Fileclass icons and class badges.
- Choose a result to insert an ordinary wikilink. Filenames are shortened only when the target remains unambiguous. Duplicate names/aliases show their full paths visibly, without requiring hover.
- Choose **Create…** to capture a new note. With one available class, no class picker is needed; with several, selecting the class confirms inline creation. A valid inline title does not need a second name dialog. Invalid or colliding names require correction; existing files are never overwritten.
- Select a name and type `@`, or use **Nodes: Create or link node** from the palette/editor menu. The original wording becomes the link label.
- A multiline selection is copied literally into a new note before the source is replaced. It is never discarded to link an existing note. Nodes does not execute placeholders in copied text.
- **Nodes: Create node** is the standalone flow: choose a class, confirm an editable name, and open the note.
- Put **Create or link node** on Obsidian's mobile toolbar if a software keyboard does not deliver the inline trigger normally. No interaction depends on hovering or right-clicking.

### Required-field completion

Creation and linking happen **before** completion. The form displays only unresolved required fields, using Fileclass's effective definitions, choices, link candidates and validated public writes. Optional fields never cause a modal. Edit those later through Fileclass's link indicator, context menu or normal Properties UI.

The initial implementation supports flat `Input`, `Number`, `Boolean`, `Date`, `Select`, `Cycle`, `Multi`, `MultiInput`, `File` and `MultiFile` fields. Unsupported required types/nested requirements are explained rather than silently considered complete. Absent optional object containers do not force their child fields into a form.

- `false` and `0` are filled values. Empty required lists need at least one entry, even though Fileclass's current validator accepts some empty lists.
- Fileclass supplies allowed values and candidate link serialization; Nodes does not guess target classes or implement a query engine.
- Dates use raw text or date wikilinks and Fileclass's validation. Nodes shows a declared format when available, but does not guess Fileclass's hidden global date format or format/build date links.
- Choices are filtered locally, not re-queried on each keystroke, and large lists have bounded rendering.
- **Save required values** saves through Fileclass. Ctrl/⌘+Enter is the keyboard shortcut. Saved fields are retained if another field fails.
- **Close** leaves the created note, link and any saved properties in place. It is not rollback.
- Writes wait briefly for metadata visibility so later dependent choices see earlier saved values. If metadata remains pending, the batch stops; retry waits without rewriting the accepted field. Dependent fields may need another pass if their available choices change.

Fileclass's schema/validation semantics remain authoritative, with conservative UI checks. A candidate picker is not a general foreign-key guarantee. Native/manual edits can still leave invalid data.

## Safety and scope

- Fileclass confirms the new note's binding before Nodes uses it. A mismatched alias, metadata timeout or dependency failure keeps the file and explains the problem.
- Nodes rechecks source editor/file identity, the full document snapshot and the selected range before inserting. If anything changed, the new note is kept and unrelated source text is not replaced.
- Required-field writes check original target identity, effective field definitions and current values. A concurrently filled field is not intentionally overwritten. The public Fileclass API cannot make a cross-plugin write transactional.
- Abort/unload stops subsequent owned work and closes owned forms. An already-started vault/Fileclass write can finish; retained notes are not silently deleted.
- **Automatic cleanup is disabled entirely.** Legacy cleanup records are not restored. Fileclass-created notes never enter a pruning queue.
- No Fileclass templates, destination contexts, Base-filter-derived defaults, computed properties, or arbitrary scripts are executed by Nodes' creation path. Other installed plugins' creation hooks remain outside Nodes' control.
- Creation is not a cross-file transaction. There is no global rollback for note creation, property edits and source linking.

### Performance

Fuzzy finding uses an in-memory index; typing does not call Fileclass or enumerate the vault. Changed notes are refreshed incrementally. Full reconciliation is coalesced and time-sliced; Fileclass's ordinary index notifications do not cause immediate repeated full-vault scans. Public APIs do not expose every global binding-setting change, so ambiguous invalidations also receive bounded idle reconciliation. **Check Fileclass connection** explicitly reconciles the current catalog and notes.

Desktop, mobile and e-ink/Boox controls use native widgets, keyboard shortcuts and touch targets; no hover-only behavior or animation is required. Automated/browser checks are not proof of real-device Boox compatibility.

## Moving from the previous Nodes schema system

This is a Fileclass-backed replacement, not a second schema mode. Previous `nodeSchema`/`nodeType` definitions are not read or converted automatically. Define matching Fileclasses and bind existing notes through Fileclass's supported conventions. If you reuse a `type` property, configure the same alias in both plugins and ensure its values match actual class names.

No existing notes are moved, recolored, rewritten or deleted. Old `schemasFolder`, highlight and pruning settings are ignored. The integration API is now **v2** because creation/completion semantics changed; v1-only Reader integrations must be updated explicitly. See [API.md](API.md).

## Local development

```sh
npm ci
npm run dev
```

The development command prepares a protected, gitignored `dummy-vault/`, verifies Hot Reload pinned to 0.3.1, and builds directly into its Nodes plugin folder. Open **that dummy vault**, not the repository root or a personal vault. Enable Nodes and Hot Reload there; setup does not silently enable plugins. Install/enable Fileclass separately and configure its class folder as `Classes/` to use the disposable fixtures. The setup script refuses unmarked existing vault/plugin folders.

- `npm run typecheck` — TypeScript checks.
- `npm test` — focused behavior/lifecycle tests with mocked Obsidian APIs.
- `npm run check` — metadata, types, tests and release build.
- `dist/` — release assets only; no test vault or Hot Reload marker.

Native Obsidian and real-device smoke checks are still needed after UI/lifecycle changes. See [VERIFICATION.md](VERIFICATION.md) for completed checks and device limitations.

## Releases

Release Please manages versions and changelogs; do not bump or tag manually. Merging a release PR requires Wannes's approval. Approved Conventional Commit scopes are `main`, `schemas`, and `ui`; ask before using others.

Install `main.js` and `manifest.json` from a published release into `<vault>/.obsidian/plugins/obsidian-nodes/`, and enable Nodes plus a compatible Fileclass. GitHub source archives are not installable plugin releases.
