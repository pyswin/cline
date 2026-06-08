import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface MarkerStatus {
	name: string;
	exists: boolean;
}

export interface GitInfo {
	branch?: string;
	commit?: string;
}

export interface DevDiagnosticsInput {
	displayName: string;
	extensionName: string;
	extensionVersion: string;
	extensionMode: string;
	vscodeVersion: string;
	workspaceFolders: string[];
	platform: string;
	arch: string;
	nodeVersion: string;
	git?: GitInfo;
	markers: MarkerStatus[];
}

const MARKER_NAMES = [".cline", ".clinerules", "Rules", "Hooks", "Workflows"];

export function buildDevDiagnosticsMarkdown(
	input: DevDiagnosticsInput,
): string {
	const workspaceText =
		input.workspaceFolders.length > 0
			? input.workspaceFolders.join("\n")
			: "No workspace folder open";
	const markerText =
		input.markers.length > 0
			? input.markers
					.map((marker) => `- ${marker.exists ? "yes" : "no"} ${marker.name}`)
					.join("\n")
			: "- No workspace markers checked";

	return [
		"# Cline Fork Diagnostics",
		"",
		"## Extension",
		"",
		`- Display name: ${input.displayName}`,
		`- Package name: ${input.extensionName}`,
		`- Version: ${input.extensionVersion}`,
		`- Mode: ${input.extensionMode}`,
		`- VSCode: ${input.vscodeVersion}`,
		"",
		"## Runtime",
		"",
		`- Platform: ${input.platform}`,
		`- Architecture: ${input.arch}`,
		`- Node: ${input.nodeVersion}`,
		"",
		"## Workspace",
		"",
		workspaceText,
		"",
		"## Git",
		"",
		`- Branch: ${input.git?.branch || "unknown"}`,
		`- Commit: ${input.git?.commit || "unknown"}`,
		"",
		"## Project Markers",
		"",
		markerText,
		"",
	].join("\n");
}

export async function collectMarkerStatuses(
	workspacePath: string | undefined,
): Promise<MarkerStatus[]> {
	if (!workspacePath) {
		return [];
	}

	return Promise.all(
		MARKER_NAMES.map(async (name) => {
			try {
				await fs.access(path.join(workspacePath, name));
				return { name, exists: true };
			} catch {
				return { name, exists: false };
			}
		}),
	);
}

export async function collectGitInfo(
	workspacePath: string | undefined,
): Promise<GitInfo> {
	if (!workspacePath) {
		return {};
	}

	const runGit = async (args: string[]) => {
		try {
			const { stdout } = await execFileAsync("git", args, {
				cwd: workspacePath,
				timeout: 3000,
			});
			return stdout.trim();
		} catch {
			return undefined;
		}
	};

	const [branch, commit] = await Promise.all([
		runGit(["branch", "--show-current"]),
		runGit(["rev-parse", "--short", "HEAD"]),
	]);

	return { branch, commit };
}
