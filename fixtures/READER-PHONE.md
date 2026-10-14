# Minimal Reader-owned phone fixture pack

Exact UTF-8 file contents are in `reader-phone.files.json`: each `files` entry maps a vault-relative path to its full contents. No Reader vault was changed and no native command was run to prepare this pack.

## Ownership and application

Reader `/s/93635` alone applies the pack to its approved disposable vault:

`/Users/wannli/code/obsidian-reader/.sandbox/Reader2 Test Vault`

- Keep Fileclass and FileClass Inline disabled while preparing settings/fixtures.
- Check every destination for collisions. Do not overwrite different existing files blindly; the owner must deliberately merge settings or choose a clean fixture namespace.
- Write the two plugin settings files **before first enable/index**, not after. Values are JSON booleans, never the strings `"false"`/`"true"`.
- Create note/Base fixtures using Reader's correctly targeted Obsidian workflow. Use its own registered vault ID before CLI commands and guard its exact renderer/path; never reuse the companion vault ID.
- Do not copy the whole companion dummy, Hot Reload, `.hotreload`, `.native-smoke`, or its workspace/configuration.

## Versions and conventions

- `fileclass-inline`: companion build, manifest 0.4.0, **FileClass Inline API v2**, main SHA `ea22905b66e03398faeca26009da47fa9603dedc3b4cecbbfdd55cb60e3a05e0`.
- `fileclass`: official 0.2.15, **Fileclass API 1.1**, Obsidian 1.12.7+.
- Enable the **Bases core plugin** for the project picker.
- Fileclass class folder: `Classes/`; alias: `fileClass`.
- FileClass Inline capture folder: `Nodes` (no trailing slash); binding property: `fileClass`; trigger: `@`.
- All three class schemas are standalone, with `version: "2.0"`, stable field IDs and root `path: ""`. No Task/WorkItem parent class is required.

## Ten files

1. `.obsidian/plugins/fileclass/data.json`: exact audited configuration keys, including disabled Canvas engine/schema logging/bind insertion/reorder/creation popup and empty global class.
2. `.obsidian/plugins/fileclass-inline/data.json`: the three FileClass Inline convention settings.
3. `Classes/Person.md`: optional `notes` Input only; no required completion.
4. `Classes/Project.md`: optional `projectTitle` Input supplies picker labels.
5. `Classes/PhoneTask.md`: **four required fields**—`summary` Input, `completed` Boolean, `estimate` Number, `project` File—and optional `details` Input.
6. `Projects/Atlas project.md`: Project; display label `Atlas & Orbit`.
7. `Projects/Borealis project.md`: Project; display label `Borealis research`.
8. `Projects/Non-project.md`: Person; negative control with label `Should never show`.
9. `Working/Projects.base`: table view `Projects only`, filter `fileClass == "Project"`, columns `file.name` and `note.projectTitle`, ascending filename sort.
10. `Working/FileClass Inline phone test.md`: short optional-capture/required-capture instructions; no changes under `Reading/`.

PhoneTask's File options are exactly:

```yaml
required: true
baseFile: Working/Projects.base
viewName: Projects only
displayColumn: note.projectTitle
```

`required: true` is inside **options for all four required fields**. `false` and `0` are values entered during the test, **not automatic defaults**. No templates, `newNotes` destinations, legacy `fileClassNoteTemplate`, global class, or folder/tag bindings are supplied.

## Protection boundary

The audited flags disable Fileclass's normal Canvas-derived note writes and schema log writes before they can queue. Generic Reader/Nodes creation does not invoke Fileclass's own templates/default-field insertion. There is no per-folder write-deny switch: avoid explicit Fileclass write actions/bindings on `Reading/`, and do not enable other creation automation. These settings are not a filesystem sandbox or a guarantee against Reader/other plugins/Sync writing there.

On iPhone, wait until fixtures **and safe plugin settings** have finished syncing before enabling Fileclass. Ensure the `.base` file actually arrived.

## Mandatory desktop preflight, then minimum phone work

These setting keys were checked against release 0.2.15. Required text/Boolean/Number controls and the exact Project/Base query/options were separately verified natively. The new flattened PhoneTask composition has **not** been run in Reader's vault; Reader must perform this short desktop preflight before handing it to Wannes:

- Confirm public class discovery includes Person, Project and PhoneTask; inspect `getSchema("PhoneTask")` for all four required options and optional details.
- Against a real disposable PhoneTask note, call public `fileCandidates(path, "project")`. Expect **exactly two** candidates, ordered Atlas then Borealis, with the two display labels above. The negative control, schema notes and `Reading/` notes must not appear.
- Confirm Nodes API v2 required capture persists summary, Boolean `false`, number `0`, and the exact selected candidate string. Details must not appear in the completion form or be inserted by Nodes.

**Hard fail if the candidate list is broader or empty.** Fileclass 0.2.15 can fall back to all Markdown files if Bases is unavailable or a query/view errors. Requiredness does not establish project membership; do not treat a fallback list as a successful setup. The selected display column must be in the Base view's `order` list, as provided.

With native default wikilink settings, Atlas is `[[Atlas project|Atlas & Orbit]]`; compare against the actual upstream candidate string rather than forcing that syntax if Reader's vault intentionally uses Markdown links.

After desktop preflight, Wannes only needs one native optional-Person `@` capture, one Reader → PhoneTask capture using `Phone capture` / **No** / **0** / **Atlas & Orbit**, and Reader's existing synced-link navigation check. Reuse that last check; verify YAML automatically on Mac.
