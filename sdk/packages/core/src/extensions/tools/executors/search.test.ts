import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSearchExecutor, type SemanticSearchRanker } from "./search";

const context = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

function createWorkspace(files: Record<string, string>): string {
	const cwd = mkdtempSync(join(tmpdir(), "search-executor-"));

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = join(cwd, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content, "utf8");
	}

	return cwd;
}

describe("search executor semantic mode", () => {
	it("returns ranked semantic chunks when query uses semantic prefix", async () => {
		const cwd = createWorkspace({
			"src/runtime/tools.ts": [
				"export function registerRuntimeTools() {",
				"  return ['read_files', 'search_codebase', 'skills'];",
				"}",
			].join("\n"),
			"src/session/messages.ts": "export const messageBuilder = true;",
		});
		const search = createSearchExecutor({ maxResults: 3 });

		const result = await search("semantic: runtime register tools", cwd, context);

		expect(result).toContain("Found 1 semantic result");
		expect(result).toContain("src/runtime/tools.ts:1-3");
		expect(result).toContain("registerRuntimeTools");
	});

	it("allows hosts to provide a semantic ranker", async () => {
		const cwd = createWorkspace({
			"a.ts": "alpha",
			"b.ts": "beta",
		});
		const ranker: SemanticSearchRanker = (_query, chunks) =>
			chunks.map((chunk) => ({
				...chunk,
				score: chunk.file === "b.ts" ? 10 : 1,
			}));
		const search = createSearchExecutor({ maxResults: 1, semanticRanker: ranker });

		const result = await search("semantic: anything", cwd, context);

		expect(result).toContain("b.ts:1-1 score=10.00");
		expect(result).not.toContain("a.ts:1-1");
	});

	it("keeps regular regex search behavior for unprefixed queries", async () => {
		const cwd = createWorkspace({
			"src/example.ts": "export function exactNeedle() {}",
		});
		const search = createSearchExecutor({ maxResults: 3 });

		const result = await search("exactNeedle", cwd, context);

		expect(result).toContain("Found 1 result");
		expect(result).toContain("src/example.ts:1:");
	});
});
