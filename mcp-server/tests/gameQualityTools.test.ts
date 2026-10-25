import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { auditGameQuality, registerGameQualityTools } from "../src/tools/gameQualityTools.js";
import { cleanupTmpProjects, makeConfig, makeTmpProject, mkdir, writeFile } from "./_helpers.js";

afterEach(async () => cleanupTmpProjects());

async function fixture() {
  const root = await makeTmpProject();
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "scenes"));
  await writeFile(path.join(root, "project.godot"), '[application]\nrun/main_scene="res://scenes/game.tscn"\n[input]\nmove_up={"deadzone":0.2}\n');
  await writeFile(path.join(root, "scenes", "game.tscn"), '[gd_scene format=3]\n[node name="Game" type="Node2D"]\n');
  await writeFile(path.join(root, "scripts", "hud.gd"), 'extends CanvasLayer\nfunc _ready():\n\tvar label = Label.new()\n\tlabel.position = Vector2(520, 145)\n');
  await writeFile(path.join(root, "scripts", "save_store.gd"), 'extends RefCounted\nconst SAVE_PATH = "user://save.json"\nfunc save(data):\n\tvar file = FileAccess.open(SAVE_PATH, FileAccess.WRITE)\n\tfile.store_string(JSON.stringify(data))\n');
  await writeFile(path.join(root, "scripts", "world.gd"), 'extends Node2D\nfunc _draw():\n\tdraw_circle(Vector2.ZERO, 8, Color.WHITE)\n');
  return root;
}

describe("game quality audit", () => {
  it("finds the five Capi-style risks with line evidence and a supplied progression budget", async () => {
    const root = await fixture();
    const result = await auditGameQuality(root, {
      progression: {
        milestone_distance: 7000, resource_capacity: 65, minimum_attempts: 2,
        strategies: [{ name: "boost", progress_per_second: 185, resource_per_second: 1.45 }]
      },
      controls: [
        { action: "move_up", expected_effect: "ascend" },
        { action: "return_home", expected_effect: "end run early" }
      ]
    });
    expect(result.progression.findings.map((item) => item.id)).toContain("milestone_reachable_early");
    expect(result.progression.strategy_results[0].reachable_in_one_attempt).toBe(true);
    expect(result.controls.contract[0].configured).toBe(true);
    expect(result.controls.findings.map((item) => item.id)).toContain("input_action_missing");
    expect(result.presentation.findings.map((item) => item.id)).toContain("procedural_only_art");
    expect(result.ui.findings[0].evidence[0]).toMatchObject({ path: "res://scripts/hud.gd", line: 4 });
    expect(result.persistence.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "unversioned_save", "direct_save_write", "save_without_backup", "no_git_repository"
    ]));
  });

  it("avoids invented progression and save failures when no model or save system is provided", async () => {
    const root = await makeTmpProject();
    await writeFile(path.join(root, "project.godot"), '[application]\nconfig/name="Small Game"\n');
    await mkdir(path.join(root, ".git"));
    const result = await auditGameQuality(root);
    expect(result.progression.status).toBe("not_verified");
    expect(result.persistence.findings).toEqual([]);
    expect(result.scan.omitted_source_files).toBe(0);
  });

  it("exposes a read-only MCP tool with a structured report", async () => {
    const root = await fixture();
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const client = new Client({ name: "client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    registerGameQualityTools(server, makeConfig(root, true));
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const response = await client.callTool({ name: "devpilot_game_quality_audit", arguments: {} });
      expect(response.isError).toBe(false);
      const text = response.content[0].type === "text" ? response.content[0].text : "{}";
      const parsed = JSON.parse(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.ui.findings[0].id).toBe("fixed_code_ui");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
