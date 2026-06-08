import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "mocha";
import "should";
import {
	buildDevDiagnosticsMarkdown,
	collectMarkerStatuses,
} from "../devDiagnostics";

describe("devDiagnostics", () => {
	it("builds a stable diagnostics markdown document", () => {
		const markdown = buildDevDiagnosticsMarkdown({
			displayName: "Cline-Fork",
			extensionName: "claude-dev",
			extensionVersion: "3.88.1",
			extensionMode: "Development",
			vscodeVersion: "1.100.0",
			workspaceFolders: ["/tmp/project"],
			platform: "darwin",
			arch: "arm64",
			nodeVersion: "v22.0.0",
			git: { branch: "main", commit: "abc1234" },
			markers: [
				{ name: ".cline", exists: true },
				{ name: "Hooks", exists: false },
			],
		});

		markdown.should.containEql("# Cline Fork Diagnostics");
		markdown.should.containEql("- Display name: Cline-Fork");
		markdown.should.containEql("- Version: 3.88.1");
		markdown.should.containEql("/tmp/project");
		markdown.should.containEql("- Branch: main");
		markdown.should.containEql("- yes .cline");
		markdown.should.containEql("- no Hooks");
	});

	it("handles missing workspace and git info", () => {
		const markdown = buildDevDiagnosticsMarkdown({
			displayName: "Cline-Fork",
			extensionName: "claude-dev",
			extensionVersion: "3.88.1",
			extensionMode: "Production",
			vscodeVersion: "1.100.0",
			workspaceFolders: [],
			platform: "linux",
			arch: "x64",
			nodeVersion: "v22.0.0",
			markers: [],
		});

		markdown.should.containEql("No workspace folder open");
		markdown.should.containEql("- Branch: unknown");
		markdown.should.containEql("- No workspace markers checked");
	});

	it("collects known project marker statuses", async () => {
		const workspace = await fs.mkdtemp(
			path.join(os.tmpdir(), "cline-diagnostics-"),
		);
		await fs.mkdir(path.join(workspace, ".cline"));
		await fs.mkdir(path.join(workspace, "Hooks"));

		const markers = await collectMarkerStatuses(workspace);
		const byName = new Map(
			markers.map((marker) => [marker.name, marker.exists]),
		);

		(byName.get(".cline") === true).should.be.true();
		(byName.get("Hooks") === true).should.be.true();
		(byName.get("Workflows") === false).should.be.true();
	});
});
