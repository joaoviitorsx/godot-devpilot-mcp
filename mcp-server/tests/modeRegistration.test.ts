import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cleanupTmpProjects, makeTmpProject } from "./_helpers.js";

afterEach(async () => cleanupTmpProjects());

describe("MCP mode registration", () => {
  it("registers progressively larger tool sets and reports the exact count", async () => {
    const root = await makeTmpProject();
    const counts: number[] = [];
    for (const mode of ["minimal", "core", "full", "agentic"]) {
      const client = new Client({ name: "mode-test", version: "1.0.0" });
      const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/index.js")], env: { ...process.env, GODOT_MCP_PROJECT_ROOT: root, GODOT_MCP_MODE: mode }, stderr: "pipe" });
      try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools;
        counts.push(tools.length);
        expect(tools.some((tool) => tool.name === "godot_health_check")).toBe(true);
        expect(tools.some((tool) => tool.name === "godot_project_doctor")).toBe(mode === "full" || mode === "agentic");
        expect(tools.some((tool) => tool.name === "godot_explain_project_architecture")).toBe(mode === "agentic");
        const response = await client.callTool({ name: "godot_get_capabilities", arguments: {} });
        const payload = JSON.parse(response.content[0].type === "text" ? response.content[0].text : "{}");
        expect(payload.data.toolsCount).toBe(tools.length);
      } finally { await client.close(); }
    }
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBeLessThan(counts[3]);
  }, 30000);
});
