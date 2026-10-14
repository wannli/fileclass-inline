# Nodes → Reader shared iPhone test handoff

> **Nodes desktop signoff COMPLETE for `8eb404269de6d3ab8dd5117f90fdc9450954df57d63a860204c67b0e559c0b0b`.** Wannes manually confirmed the intended desktop flow works and asked to move forward. The presentation-only update passes 293 tests; final native measurement/cleanup passed against a fresh 60-file baseline with no data changes. The earlier fixed-18px assertion was a harness error: this theme resolves its native icon token to 16px, and all eight rows matched it and were centered. No further icon-placement work is required. **Native lane RELEASED to Reader `/s/93635`** for its final desktop checks and approved shared-vault/Sync setup. No physical iPhone/Boox signoff is claimed.

## Ownership and current clearance

Reader session `/s/93635` owns the **only** shared vault and Obsidian Sync setup:

`/Users/wannli/code/obsidian-reader/.sandbox/Reader2 Test Vault`

Nodes has not opened, modified, installed into, or enrolled that vault in Sync, and has not touched the iPhone or a personal vault.

Nodes' separate Mac fixture remains:

`/Users/wannli/code/obsidian-nodes-fileclass-companion/dummy-vault`

**Approved cleanup executed and verified.** `approved-recovery-result.json` records recovery completion at `2026-10-13T17:13:20.902Z` in companion vault `e753bae011755563`, webContents `12`, target `60E5CF8838256400BD3C7A51E09D4D8D`. Fileclass and its API have fresh identities; settings and other plugin identities are unchanged. A, MetaLeft and MetaRight key-up acknowledgments are recorded. Active Date/pending observer globals are absent, no required forms remain, and the debugger attachment was restored. This establishes a fresh clean API through the approved reload; it does not claim restoration of missing historical references. No Reader-vault change or Sync operation occurred.

**Final Nodes native gates PASSED; the exclusive native lane is RELEASED to Reader `/s/93635`.** Date custom text, wikilink and default ISO date were saved and read back unchanged. In the metadata-delay test, A was written exactly once, B remained withheld across explicit retry, and B completed once metadata became visible; both persisted. All 19 API method identities were restored afterward; no active observers/forms/raw writes or outstanding commands remain. A/MetaLeft/MetaRight releases were acknowledged, and other plugin identities/settings and debugger attachment state were preserved. Evidence: `dummy-vault/.native-smoke/final-native-signoff.json` and `remaining-native-gates-result.json`. Reader may proceed with its own approved shared-vault setup using its own explicitly verified renderer. Nodes has not copied assets or changed Reader's vault. This is desktop-native signoff, not iPhone/Boox signoff.

Use a registered vault ID **before** CLI commands and retain exact-path checks. Our companion ID is `e753bae011755563`; **Reader must use its own ID**, not this one. Reader has since run its own pinned native session (reported webContents 18); its earlier registration issue is historical, not a current Nodes blocker.

### Current-candidate evidence

The earlier functional baseline was tested on `7e5ea5df…`. The `8eb40426…` changes are presentation-only, with full automated checks and Wannes's subsequent manual confirmation. Its final native slot was measurement-only, not a repeat of the three creation flows: all eight class rows were 31.5px high, with 16×16px native icons and 0px icon/label center deltas. All 19 Fileclass API originals, other plugins/settings and 60 existing vault data files remained unchanged; picker/debugger cleanup completed with no input events or outstanding commands. Evidence is archived under `dummy-vault/.native-smoke/ui-8eb4042/measurement-pass/`. Human-created Project notes legitimately expand the companion Base candidates; never delete/reclassify them to force the original two-row count.

## Verified copy-only asset receipt

Source worktree: `/Users/wannli/code/obsidian-nodes-fileclass-companion`

Branch: `feat/fileclass-companion`, uncommitted. This is an unreleased Nodes build; do not substitute the published 0.3.0 release merely because the manifest number matches.

| Plugin ID | Manifest version | API | Files to copy after approval |
| --- | --- | --- | --- |
| `obsidian-nodes` | `0.3.0` (unreleased companion build) | `2` | `dist/main.js`, `dist/manifest.json` |
| `fileclass` | `0.2.15` | `1.1` | `dummy-vault/.obsidian/plugins/fileclass/main.js`, `manifest.json`, `styles.css` |

Fileclass requires Obsidian **1.12.7+**; both plugin manifests permit mobile. The installed Fileclass main bundle was compared byte-for-byte against the official published 0.2.15 asset.

SHA-256, relative to the source worktree:

```text
8eb404269de6d3ab8dd5117f90fdc9450954df57d63a860204c67b0e559c0b0b  dist/main.js
875b728e87b33f029f66543e318219528b13d4ac89ec642e940a1dbaaca17b79  dist/manifest.json
2ef2199710b4b9a2b9e2307ba6218b591557667e4fa11b09906844f0bcc78d64  dummy-vault/.obsidian/plugins/fileclass/main.js
d40f1802e1fa1fa1b2245cc52f56b8030a947747a733cf67eae03d4a452b312b  dummy-vault/.obsidian/plugins/fileclass/manifest.json
da16243f2e928592e05e5b31db5620f9bcd00ffc45a92453d30c53953e5c5ccb  dummy-vault/.obsidian/plugins/fileclass/styles.css
```

Do not copy Hot Reload, `.hotreload`, `.native-smoke`, or the entire dummy configuration. Prepare fresh, deliberately safe settings under Reader's ownership. The old runtime observer does not travel with these verified assets.

## Reader API adaptation

API v2 still exposes `listTypes`, `searchNodes`, `getNode`, `createNode`, and `createNodeForLink`; their main call shapes remain familiar. **There is no separate v1 facade.** A Reader guard requiring `api.version === 1` must adapt, not spoof the version.

Important semantics:

- Types are Fileclass names, with `classes` and `icon`; no color contract.
- Creation saves a real note before required completion.
- `createNodeForLink` invokes Reader's guarded link callback **before** required completion.
- Closing completion retains the note, link and saved properties; it can return an incomplete created note.
- No pruning, cleanup token, or cancel-means-no-file guarantee.
- Reader must retain its own source/editor/content guards and reject unsuccessful link callbacks.
- API `suggestedTitle` remains editable; it does not promise the native inline `@` flow's skipped name confirmation.

See `API.md` for the complete contract. Adapt and desktop-test Reader before asking for phone work.

## Protecting Reading/** from Fileclass automation

Audited against the installed official **0.2.15** bundle and release source. Generic Reader/Nodes `vault.create` does **not** invoke Fileclass's create-note workflow, templates, class chooser or missing-field insertion. Ordinary class resolution is passive.

However, Fileclass's **default-enabled Canvas fields engine** can automatically modify eligible notes anywhere, including `Reading/`, following indexing or Canvas changes. There is **no per-folder write-deny setting**. Schema logging can also write/rotate files under its class folder.

Prepare these Fileclass settings **before first enable/index** in the shared vault (configuration guidance only; Nodes has not applied it):

```json
{
  "enableCanvasEngine": false,
  "enableSchemaLog": false,
  "insertFieldsOnBind": false,
  "reorderOnInsert": false,
  "openFieldsOnCreate": false,
  "globalFileClass": ""
}
```

Exact UI labels: **Canvas fields engine**, **Schema log**, **Insert fields when adding a class**, **Reorder frontmatter when inserting fields**, **Open the fields when creating a note**, **Global fileClass**.

- Turning Canvas off after work was queued is not a cancellation guarantee. Do not enable it on the phone before the safe settings have finished syncing.
- Keep the class folder, e.g. `Classes/`, and Nodes capture folder `Nodes/` outside `Reading/`. Use matching `fileClass` aliases and no global/folder/tag bindings for `Reading/`. Folder separation alone is not a write barrier.
- Keep class `newNotes[].template` and legacy `fileClassNoteTemplate` unset. They affect Fileclass's explicit create workflow, not generic file creation.
- Fileclass's own create workflow still inserts fields even with its modal disabled. `insertFieldsOnBind:false` affects explicit “Add a class,” not its create command.
- Avoid explicit Fileclass write commands on `Reading/`. Other plugins, Templater's independent hooks, Reader writes and Sync behavior are outside these switches.

References: [settings/defaults](https://github.com/mdelobelle/fileclass/blob/0.2.15/src/settings/settings.ts#L115-L145), [Canvas writer](https://github.com/mdelobelle/fileclass/blob/0.2.15/src/fields/canvas/canvasEngine.ts#L44-L219), [explicit creation](https://github.com/mdelobelle/fileclass/blob/0.2.15/src/commands/createNoteWithClass.ts#L151-L263).

## Exact minimal fixtures

Use `fixtures/reader-phone.files.json` (SHA-256 `8701815ca9575498c8ff614bb90aa2d980064eb11c4c152f96a8ccfd164d5fc8`) for exact contents of ten explicitly listed files; follow `fixtures/READER-PHONE.md` for safe application and desktop preflight. Configuration keys are release-audited; Task controls and Project/Base options were separately native-verified. The newly assembled standalone PhoneTask still needs Reader-owned desktop preflight.

**Base failure caution:** Fileclass 0.2.15 can fall back to all Markdown files when Bases/query/view execution fails. Require exactly the two Project candidates and their expected display labels before phone testing; stop on missing/extra candidates or fallback filename labels. The `.base` file and disabled-automation settings must finish syncing before Fileclass is enabled on iPhone.

## Minimal combined phone acceptance

Desktop verification now includes schema/inheritance, optional-vs-required selection, false/0 persistence, exact Base candidates/link serialization, cancellation/source guards, Date read-back and metadata-delay retry behavior. The Date test covered an explicitly declared custom format plus an unspecified format using ISO; changing Fileclass's hidden global date default was not demonstrated. Do not repeat the entire desktop matrix manually on iPhone.

Keep at most these three Nodes actions, folded into Reader's existing test script:

1. **One native Markdown `@` lookup/capture of optional Person:** real iOS keyboard trigger, touch selection, readable Fileclass icon, source/link preservation, no optional completion form. Toolbar fallback can be evaluated if iOS input does not deliver the trigger normally; it is not proof that `@` worked.
2. **One Reader → Nodes required capture:** use the standalone `PhoneTask` fixture combining Task controls with WorkItem's required Base-backed project field to exercise text/number/Boolean controls and the File picker together. Verify keyboard/scroll access to Save/Close, only required fields, retained false/0 and the chosen project, and return to the correct Reader context. Reader owns fixture preparation.
3. **Reuse Reader's existing synced-link navigation step:** open the created link once after Sync completes. Mac-side automation should verify class marker/properties/link values rather than asking Wannes to inspect YAML on the phone.

This keeps real-device selection, software keyboard, touch, picker, modal layout, Reader return and Sync propagation coverage without duplicating desktop assertions or requiring a separate WorkItem capture.
