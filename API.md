# Optional integration API (version 1)

Available on the enabled `fileclass-inline` plugin instance as `plugin.api`. Check that the plugin exists and `api?.version === 1`; do not require FileClass Inline or import its private classes. The API is available after FileClass Inline loads. Retained references are safe after unload: reads return empty arrays/null and creation resolves null. Feature-detect again after re-enabling.

```ts
type Color = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
interface NodeResult {
  path: string;
  title: string;
  type: string;
  aliases: string[];
  color?: Color;
}
interface FileClassInlineApi {
  readonly version: 1;
  listTypes(): Array<{ type: string; label: string; color?: Color }>;
  searchNodes(query: string): NodeResult[];
  createNode(options: {
    type?: string;
    suggestedTitle?: string;
    sourcePath?: string;
    signal?: AbortSignal;
  }): Promise<NodeResult | null>;
  getNode(path: string): NodeResult | null;
  createNodeForLink?(
    options: { type?: string; suggestedTitle?: string; sourcePath: string; signal?: AbortSignal },
    link: (node: NodeResult) => Promise<void>
  ): Promise<NodeResult | null>;
}
```

- Paths are exact vault-relative Markdown paths including `.md`. Titles are filenames without `.md`; aliases exclude the title. Results are independent snapshots.
- Reads rebuild the node index from Obsidian's current metadata snapshot. Like Obsidian itself, externally edited files become visible after the host parses their metadata. Types/labels/colors use current schema metadata, not a color captured when a node was created. Duplicate or invalid schema metadata is excluded; creation additionally validates the full schema/template from a fresh vault read.
- Search matches titles and aliases using the existing ranked fuzzy search, with no API result limit. Empty query lists nodes. `getNode` returns null for missing, untyped, or out-of-folder notes. Recently API-created nodes are available immediately, even before the metadata cache catches up.
- Creation always opens the existing schema-aware form (required fields, defaults, link fields, and templates). Omitting `type` opens the type chooser first. `suggestedTitle` is editable, not silently accepted. Unknown types/no usable schemas return null with a notice.
- `sourcePath` is optional caller context, reserved for future use in v1; it does not insert a link, open an editor, set properties, or establish cleanup provenance. Callers own any subsequent linking.
- Created nodes are standalone and never registered for auto-pruning. Cancellation/closing either dialog or disabling FileClass Inline resolves null and closes pending API dialogs. No new write begins after cancellation. A vault write already in progress cannot be rolled back: a standalone file may remain if the plugin is disabled during that write.
- Optional `signal` lets callers cancel their own request on navigation/teardown. Abort resolves null once, closes its dialog, and prevents subsequent writes; an already-aborted signal opens nothing. The abort listener is removed on every completion path. Changing node/schema folder settings invalidates an open form before its next creation step, resolving null rather than writing into an obsolete folder.
- Validation/write errors remain visible in the form for correction/retry; cancelling still resolves null. Schema changes while a form is open require reopening it.

### Optional linked creation

`createNodeForLink` is an additive, feature-detected v1 capability. It opens the same form, then awaits the caller's guarded link write. The callback must reject failed/uncertain writes and persist a link containing the exact returned vault-relative path **including `.md`**. Extensionless/short links are not enrolled. Do not mutate the result. Defer successful UI teardown until the operation returns; abort during creation, linking, or enrollment prevents enrollment.

Only FileClass Inline decides eligibility, using the form's original rendered values and its existing `PruneManager`. A successful eligible creation is tracked using the existing record format; the full path is a conservative retention token (even a remaining plain-text mention prevents cleanup). FileClass Inline still waits for a resolved link and applies its unchanged last-link, pristine-content, schema, editor, and local-trash safeguards. Failed enrollment keeps the note; it does not undo a saved link. `createNode` retains its independent standalone semantics above.

Reader must be updated to opt in and FileClass Inline must expose this capability. Older FileClass Inline versions fall back to standalone creation. Existing/previously created notes are never retroactively enrolled. No new Markdown properties or persisted schema are introduced.

Version 1 is the API contract version, independent of the plugin release version. Breaking signature or semantic changes require a new API version. Reader and other optional consumers must gracefully handle absence, unsupported versions, null results, and FileClass Inline being disabled mid-flow.
