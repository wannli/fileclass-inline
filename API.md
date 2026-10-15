# FileClass Inline integration API — version 2

Available on the enabled `fileclass-inline` instance as `plugin.api`. Feature-detect `api?.version === 2`. Do not import FileClass Inline or Fileclass implementation classes.

**Version 2 is intentional:** types now mean Fileclass classes; capture creates the note before required-field completion; linked creation invokes its callback before that completion UI; and no creation is eligible for automatic pruning. A v1-only Reader integration must not silently opt into these changed semantics.

```ts
interface NodeResult {
  path: string;
  title: string;
  type: string;
  classes: string[];
  aliases: string[];
  icon?: string;
}
interface NodesApi {
  readonly version: 2;
  listTypes(): Array<{ type: string; label: string; icon?: string }>;
  searchNodes(query: string): NodeResult[];
  getNode(path: string): NodeResult | null;
  createNode(options: {
    type?: string;
    suggestedTitle?: string;
    sourcePath?: string;
    signal?: AbortSignal;
  }): Promise<NodeResult | null>;
  pickNodeForLink?(
    options: { suggestedTitle?: string; sourcePath: string; signal?: AbortSignal },
    link: (node: NodeResult) => Promise<void>
  ): Promise<NodeResult | null>;
  createNodeForLink?(
    options: {
      type?: string;
      suggestedTitle?: string;
      sourcePath: string;
      signal?: AbortSignal;
    },
    link: (node: NodeResult) => Promise<void>
  ): Promise<NodeResult | null>;
}
```

## Reads and identity

- Paths are exact vault-relative Markdown paths including `.md`; titles are filenames without `.md`.
- Class names are Fileclass identifiers, including any class-name subdirectories. `label` currently equals the class name; `icon` is Fileclass's resolved class icon. Results contain only Fileclass-backed class metadata.
- `classes` preserves Fileclass's bound-class order. For discovery, `type` is the last bound class; for creation it is the class explicitly chosen for capture. Consumers requiring a particular class should inspect `classes`, not infer a unique type from a multi-class note.
- Results are independent snapshots. Arrays returned to callers do not mutate FileClass Inline's index.
- Reads are synchronous and use the event-maintained cache. They do not scan the vault or query Fileclass per call. Metadata/index updates are eventually visible; they are not a global transaction. “Check Fileclass connection” explicitly reconciles the current state.
- Search ranks filenames and aliases using exact, prefix and fuzzy matching, returns each note once, and has no API result cap. An empty query lists indexed typed notes. Typed notes are discoverable throughout the vault, not just its capture folder.
- The API may exist before the first Fileclass index is ready. Reads initially return empty results. Missing/unsupported/disabled Fileclass also yields empty results/null. Old API references become inert after FileClass Inline unloads; feature-detect again after reload.

## Standalone capture

`createNode()` uses FileClass Inline's shared convention-based capture flow:

1. Choose a class unless supplied or only one is available.
2. Confirm an editable filename; `suggestedTitle` is never an unattended API write.
3. Create a normal note in the configured capture folder, with the configured class marker.
4. Wait briefly for Fileclass to recognize the actual note.
5. Prompt only for unresolved required fields, then return its identity.

No optional fields cause a completion form. Closing required completion keeps the created note and any saved values and returns its identity. It does **not** guarantee that every required field is complete or that the note passed a comprehensive schema audit.

Standalone API creation does not open an editor or insert a link. `sourcePath` is caller context, not write authority; it does not infer a destination, relation, template or class. The native standalone command separately opens its result.

Unknown class, cancellation before creation, dependency errors or unrecognized binding return null with a notice where appropriate. Cancellation/failure after a write starts can leave a note even when the promise returns null; callers must not infer “no file exists” from null. FileClass Inline preserves partial results rather than deleting them.

## Shared link-or-create picker

Feature-detect optional `pickNodeForLink()` on API v2. It opens the same FileClass Inline picker used by native linking, seeded with `suggestedTitle`. Only Fileclass-typed notes are listed: there is no “All notes” mode. Empty queries and searches without matches still open the picker and include Create; they never silently create a note.

Selecting an existing note rechecks its identity, Fileclass membership and backend session before calling `link` with a snapshot. Selecting Create uses the shared class chooser and capture flow, then calls `link` **before required completion**. A valid, noncolliding inline title needs no second name dialog; empty/invalid/colliding titles use the normal name prompt.

The caller owns guarded source writes, including navigation/content checks. FileClass Inline verifies source identity before invoking the callback, never writes its Editor, and permits intentional source moves performed by the callback. Rejections propagate unchanged and retain the target; creation completion is skipped on link failure. Cancellation/closing returns null, including abort while awaiting an uncooperative callback; already-dispatched caller writes cannot be undone. Unload, settings changes and cache invalidation close the picker and cancel its owned continuation. Existing `createNode` and `createNodeForLink` remain unchanged.

## Linked capture

`createNodeForLink()` creates and confirms binding, then invokes the supplied `link` callback **before required completion**. This lets the originating text become a link before a required-fields modal opens.

- FileClass Inline checks source file identity/path before the callback. The caller must additionally guard its own editor, selection, source content and navigation state.
- The callback receives an independent snapshot and must reject failed/uncertain writes. Rejections propagate, including arbitrary rejection values. The target note is retained; completion does not run after a failed callback.
- FileClass Inline never writes the source itself through this API.
- An aborted request or changed source identity prevents the callback. A file may already exist; it is kept.
- There is no exact-path cleanup token requirement: **pruning is disabled for all Fileclass capture**. Linking does not grant deletion authority or establish cleanup provenance.

## Cancellation and writes

`signal` cancels class/name prompts and required completion. Already-aborted signals do nothing. Abort/unload/settings changes settle pending requests, close owned forms, and prevent subsequent owned stages or callbacks. A vault/Fileclass write already dispatched can finish and cannot be rolled back.

Required-field writes use Fileclass's public API, check target/field freshness, preserve meaningful `false`/`0`, and wait briefly for metadata visibility. They are individual writes, not an all-or-nothing note transaction. Another plugin can still mutate data after a check or execute its own creation hooks.

No arbitrary template execution, Fileclass destination-context emulation, private UI calls, schema conversion or automatic cleanup is part of this contract.

The API version is independent of the FileClass Inline release version and Fileclass's own API version. Breaking signatures or behavioral guarantees require another explicit API version.
