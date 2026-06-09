# Semantic Search Prototype

This note documents the lightweight semantic search prototype added to the SDK
core search executor.

## Scope

The prototype extends `search_codebase` in `@cline/core`.

Regular queries keep the existing regex/ripgrep behavior:

```text
InvoiceRiskAnalyzer
```

Semantic queries are opt-in with a prefix:

```text
semantic: invoice fraud risk scoring
?semantic webhook payload validation event handler
```

This SDK path is intended as a minimal prototype or fallback. The VS Code
extension has its own product-facing `semantic_search` tool path under:

```text
apps/vscode/src/services/semantic-search/
apps/vscode/src/core/task/tools/handlers/SemanticSearchToolHandler.ts
apps/vscode/src/core/prompts/system-prompt/tools/semantic_search.ts
```

## Current Behavior

When the query starts with `semantic:` or `?semantic `, the executor:

1. Reads the workspace file index.
2. Filters files using the existing include/exclude/depth rules.
3. Splits text files into bounded chunks.
4. Scores chunks with a local dependency-free token ranker.
5. Returns ranked file ranges with snippets.

The default ranker is intentionally simple. It tokenizes file paths and chunk
text, splits camelCase-style identifiers, and ranks by query-token overlap.

Hosts can replace this behavior by passing `semanticRanker` to
`createSearchExecutor`.

## Regex vs Semantic

Use regex search when the query is exact:

- class names
- function names
- imports
- config keys
- known text patterns

Use semantic search when the user knows the behavior but not the names:

- "where is invoice fraud risk handled"
- "code that validates webhook payloads"
- "where a tool request is approved and formatted"

Semantic search should not replace exact search. It is a discovery aid for
finding candidate files before reading or editing.

## Tests

Focused tests:

```bash
cd sdk/packages/core
npm exec vitest -- run src/extensions/tools/executors/search.test.ts --config vitest.config.ts
```

Type check:

```bash
cd sdk/packages/core
npm exec tsc -- -p tsconfig.dev.json --noEmit
```

## Manual Skill Check

A project-level test skill is included at:

```text
.cline/skills/cline-search-test/SKILL.md
```

Open the repository root in the VS Code Extension Development Host and ask Cline
to call `use_skill` with:

```text
cline-search-test
```

The skill is only for manual validation of the existing skill mechanism. It is
not part of the semantic search runtime.

## Future Development Route

For production work, prefer improving the VS Code semantic search service first:

```text
apps/vscode/src/services/semantic-search/
```

Recommended sequence:

1. Keep a local lexical fallback for offline behavior.
2. Extract stable interfaces for `Chunker`, `Ranker`, `EmbeddingProvider`, and
   `VectorStore`.
3. Add a local persistent workspace index keyed by file path, mtime, size, and
   content hash.
4. Add incremental updates from file watcher events.
5. Add optional embedding providers behind explicit settings.
6. Combine ranking signals from exact match, file path, symbols, LSP results,
   and vector similarity.
7. Benchmark against `search_files` on real tasks using tool calls, input
   tokens, correct-file recall, and missed-reference rate.

For code navigation, LSP is often more precise than embeddings. A robust design
should be hybrid:

- `search_files` for exact regex/text.
- LSP/code intelligence for definitions, references, and symbols.
- semantic search for behavior-level discovery when exact terms are unknown.

## LSP Development Route

LSP should be developed as a separate precision-navigation layer rather than as
part of the embedding ranker.

Recommended VS Code entry point:

```text
apps/vscode/src/integrations/lsp/
```

If that directory does not exist yet, start with a small service similar to:

```ts
interface LspNavigationService {
	findDefinition(uri: string, symbol: string): Promise<LspLocation[]>
	findReferences(uri: string, symbol: string): Promise<LspLocation[]>
	getDocumentSymbols(uri: string): Promise<LspSymbol[]>
	getWorkspaceSymbols(query: string): Promise<LspSymbol[]>
	getHover(uri: string, line: number, character: number): Promise<string | undefined>
}
```

The implementation can call VS Code language feature commands:

```text
vscode.executeDefinitionProvider
vscode.executeReferenceProvider
vscode.executeDocumentSymbolProvider
vscode.executeWorkspaceSymbolProvider
vscode.executeHoverProvider
```

Suggested rollout:

1. Add an internal `LspNavigationService` with unit tests around command
   dispatch and fallback behavior.
2. Return compact structured results: file path, line, column, symbol name, and
   a short snippet. Do not return full files.
3. Add graceful fallback when no language server is installed or no symbol is
   found: use existing tree-sitter/code-definition and regex search paths.
4. Add a tool or ranking signal that can answer precise questions:
   "definition of X", "references to X", "where is this symbol used".
5. Feed LSP results into semantic search ranking as a boost, not a replacement.
6. Cache results per session/workspace with invalidation on file changes.
7. Add telemetry/test metrics for token savings and correct-file recall.

Design constraints:

- LSP results are deterministic but language-server dependent.
- LSP is best for known symbols, not vague behavior queries.
- Embeddings are useful for vague behavior queries, but less reliable for exact
  references.
- The tool router should prefer LSP when the prompt contains terms like
  "definition", "references", "callers", "symbol", or an exact identifier.
