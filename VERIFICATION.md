# Fileclass companion verification

## Current desktop signoff

**Desktop signoff complete** for `8eb404269de6d3ab8dd5117f90fdc9450954df57d63a860204c67b0e559c0b0b`. Wannes personally tested this candidate and confirmed “ok it works. move forward” after clarifying Project versus WorkItem. The initially unprompted note was Project, whose field is optional; no missing-required-completion defect was confirmed or patched.

This revision changes suggestion presentation only: native desktop density, 44px mobile/coarse-pointer targets, and native-sized centered Fileclass glyphs. Full automated checks pass. The final measurement-only native slot recorded all eight class rows at 31.5px high, native-token icons/wrappers at 16×16px and 0px center deltas (zoom 1, DPR 2). The earlier failed assertion incorrectly hard-coded 18px rather than resolving the native CSS token. No further icon-placement work is required.

A fresh post-human-trial baseline of 60 vault data files was unchanged; all 19 Fileclass API originals, other plugins/settings, picker and debugger state were preserved/restored, with no input events or outstanding commands. Evidence: `dummy-vault/.native-smoke/ui-8eb4042/measurement-pass/`. This slot did not rerun the creation flows: functional evidence is the earlier native baseline plus candidate automated checks and human confirmation. Human-created Project notes can legitimately expand Base choices; do not prune/reclassify them to force two candidates. **Native lane released to Reader `/s/93635`; updated assets are ready for Reader-owned approved shared-vault setup.**

## Automated checks

Executed in the isolated `feat/fileclass-companion` worktree:

```sh
npm run check
INDEX_BENCH=1 node --test scripts/index-fileclass.test.mjs
git diff --check
```

- Metadata validation, TypeScript and release build pass.
- Latest UI candidate: 293 tests pass, 1 optional benchmark skipped. The 10,000-note benchmark passed explicitly on the preceding functional baseline; it was not redundantly rerun for this styling-only change.
- Coverage includes original source/target identities, callback replacement/rename/deletion, abort/unload, inherited required fields, original backend descriptors, `false`/`0`, empty lists, candidate freshness, partial saves, pending metadata, date text, initial focus, cache races, one-scan reconciliation, local ranking, duplicate labels and protected dummy-vault setup.

Mocks do not prove native Obsidian compatibility or real-device performance.

## Native baseline

Tested against **Obsidian 1.14.4**, **Fileclass 0.2.15 / public API 1.1**, and Nodes API **v2**, on macOS. Only the gitignored `dummy-vault/` was used. No personal vault or upstream code was changed.

Verified using native editor keyboard/pointer interactions and public APIs:

- Inline `@` creation and fuzzy alias linking.
- Optional-only creation without completion UI; required fields only after source linking.
- Saving meaningful `false` and `0`, partial-save recovery and literal multiline copying.
- Changed-source protection and callback-time target replacement protection.
- Fileclass disconnect/reconnect and Nodes unload, including inert old API references.
- Fileclass Lucide icons and visible full paths for ambiguous labels; no class colors or new highlights.

### Real Bases delegation

A real `.base` view selected two project notes and excluded a non-project note. Nodes' candidate values matched Fileclass's public `fileCandidates`, including display labels and ordering. The chosen `[[Atlas project|Atlas & Orbit]]` link was preserved unchanged through the required File field and Fileclass write.

Nodes does not parse the Base, infer creation defaults from its filters, or implement another query engine.

### Layout versus devices

- Native desktop renderer: 1280×800.
- Native mobile emulation: 390×844, with 44px required controls and no observed horizontal clipping.
- Grayscale/e-ink-representative viewport: 820×1180.

These are **desktop-host emulations**, not physical mobile or Boox tests. Native touch-event automation was not reliable on the desktop host; pointer/keyboard activation and control change events were used instead. Software-keyboard layout, Android behavior, e-ink refresh/ghosting, battery use and physical-touch latency remain unverified. Large choice-list paging is covered automatically but not exhaustively exercised on a real device.

### Search measurement

The native benchmark uses 10,000 in-memory TFile instances, the actual Nodes index and Obsidian's real fuzzy matcher. It creates no bulk vault notes. Query-time Fileclass/source and metadata calls are zero. Timings are a single desktop-renderer sample, not a Boox performance guarantee.

Latest native sample: 428.2 ms cooperative rebuild, with query p50/p95/max of 5.4/9.5/17.8 ms. Rebuild deliberately yields to the renderer instead of optimizing only total elapsed time.

**Final desktop-native gates PASSED on build `7e5ea5df…`; native lane released to Reader `/s/93635`.** Persisted read-back confirmed custom Date `13/10/2026`, date wikilink `[[Dates/2026-10-13|13/10/2026]]`, and default ISO `2026-10-13`; Fileclass validation returned no violations. In the metadata-delay test, A was written exactly once across retry, B stayed withheld while A was hidden, and both values persisted after metadata visibility returned. Changing the hidden global date default was not tested.

Final cleanup restored all 19 API method identities, left other plugins/settings unchanged, removed active observer globals/forms, restored debugger attachment state and acknowledged A/MetaLeft/MetaRight key-up releases. No raw writes or commands remained in flight. Evidence: `dummy-vault/.native-smoke/final-native-signoff.json` and `remaining-native-gates-result.json`. Earlier approved recovery established fresh originals by Fileclass-only reload; missing historical references were not claimed restored. First-input focus, startup gating and capture/delete overlays also passed.

For native CLI operations, put an explicitly registered vault ID **before** the command. A trailing vault selector demonstrably reached another same-named dummy vault. Keep exact-path guards; a filesystem folder alone does not establish CLI registration. Reader owns its separate shared test-vault/Sync setup; no personal vault or iPhone was touched.

Native transcripts, exact installed build hashes, screenshots, timings and follow-up verification are recorded locally in `dummy-vault/.native-smoke/REPORT.md`. Those disposable artifacts are not included in release assets.

## Compatibility boundaries

- Nodes API **v2** deliberately changes creation/completion semantics. A Reader integration accepting only v1 needs a separate update; Reader was not modified here.
- Fileclass's public API is required. No private Fileclass modals/settings or schema internals are used in the integration.
- Fileclass 0.2.15 can fall back to all Markdown candidates when Bases/query/view execution fails. The shared-fixture preflight must require exactly its two expected projects and labels; requiredness alone does not enforce project membership.
- Custom dates are passed through as text/wikilinks; Nodes cannot infer Fileclass's unexposed global date format and does not promise native date-widget parity.
- Public cache invalidations are not transactional. Ambiguous global changes receive bounded idle reconciliation; explicit connection checking can force refresh.
- No templates, automatic schema migration, automatic pruning, global rollback, commit, push or release was performed.
