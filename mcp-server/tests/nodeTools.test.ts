import { describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../src/config/config";
import type { GodotClient } from "../src/godot/client";
import { registerNodeTools } from "../src/tools/nodeTools";

function makeConfig(readOnly = false): ServerConfig {
  return {
    server: { name: "test", version: "0.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeout: 5000, reconnectDelay: 1000, maxReconnectDelay: 30000 },
    security: { readOnly },
    projectRoot: "/fake/project"
  };
}

function makeGodot(callResult: unknown = { ok: true, data: {}, message: "" }): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn().mockResolvedValue(callResult)
  } as unknown as GodotClient;
}

function makeServer() {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  return {
    tool: (name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      tools[name] = handler;
    },
    run: (name: string, args: Record<string, unknown> = {}) => tools[name](args)
  };
}

describe("nodeTools", () => {
  describe("godot_add_node", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      const result = await server.run("godot_add_node", {
        node_type: "Sprite2D",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });

    it("calls node.add with defaults", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_add_node", { node_type: "Label" });

      expect(godot.call).toHaveBeenCalledWith("node.add", {
        node_type: "Label",
        node_name: "Label",
        parent_path: ".",
        properties: {}
      });
    });

    it("supports documented type/name aliases and initial properties", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_add_node", {
        type: "Sprite2D",
        name: "PlayerSprite",
        parent_path: "Player",
        properties: { visible: true }
      });

      expect(godot.call).toHaveBeenCalledWith("node.add", {
        node_type: "Sprite2D",
        node_name: "PlayerSprite",
        parent_path: "Player",
        properties: { visible: true }
      });
    });

    it("blocked in read-only mode", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig(true));

      const result = await server.run("godot_add_node", { node_type: "Node" }) as { isError: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe("godot_remove_node", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      const result = await server.run("godot_remove_node", {
        node_path: "Player",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
    });

    it("calls node.remove", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_remove_node", { node_path: "Player" });

      expect(godot.call).toHaveBeenCalledWith("node.remove", { node_path: "Player" });
    });
  });

  describe("godot_rename_node", () => {
    it("calls node.rename", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_rename_node", { node_path: "Player", new_name: "Hero" });

      expect(godot.call).toHaveBeenCalledWith("node.rename", { node_path: "Player", new_name: "Hero" });
    });
  });

  describe("godot_duplicate_node", () => {
    it("calls node.duplicate", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_duplicate_node", { node_path: "Enemy" });

      expect(godot.call).toHaveBeenCalledWith("node.duplicate", { node_path: "Enemy" });
    });
  });

  describe("godot_reparent_node", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      const result = await server.run("godot_reparent_node", {
        node_path: "Player",
        new_parent_path: "World",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
    });
  });

  describe("godot_get_node_properties", () => {
    it("calls node.get_properties with default path", async () => {
      const godot = makeGodot({ ok: true, data: { properties: [] }, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_get_node_properties", {});

      expect(godot.call).toHaveBeenCalledWith("node.get_properties", { node_path: "." });
    });
  });

  describe("godot_set_node_property", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      const result = await server.run("godot_set_node_property", {
        node_path: "Player",
        property: "position",
        value: { x: 0, y: 0 },
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
    });

    it("calls node.set_property", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_set_node_property", { property: "visible", value: false });

      expect(godot.call).toHaveBeenCalledWith("node.set_property", {
        node_path: ".",
        property: "visible",
        value: false
      });
    });
  });

  describe("godot_get_node_groups", () => {
    it("calls node.get_groups", async () => {
      const godot = makeGodot({ ok: true, data: { groups: [] }, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_get_node_groups", { node_path: "Player" });

      expect(godot.call).toHaveBeenCalledWith("node.get_groups", { node_path: "Player" });
    });
  });

  describe("godot_add_node_to_group", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      const result = await server.run("godot_add_node_to_group", {
        node_path: "Player",
        group: "enemies",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
    });
  });

  describe("godot_remove_node_from_group", () => {
    it("calls node.remove_from_group", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig());

      await server.run("godot_remove_node_from_group", { node_path: "Player", group: "enemies" });

      expect(godot.call).toHaveBeenCalledWith("node.remove_from_group", {
        node_path: "Player",
        group: "enemies"
      });
    });
  });

  describe("read-only allowlist", () => {
    it("allows godot_get_node_properties in read-only mode", async () => {
      const godot = makeGodot({ ok: true, data: { properties: [] }, message: "" });
      const server = makeServer();
      registerNodeTools(server as never, godot, makeConfig(true));

      const result = await server.run("godot_get_node_properties", { node_path: "Player" }) as { isError: boolean };

      expect(result.isError).toBe(false);
      expect(godot.call).toHaveBeenCalledWith("node.get_properties", { node_path: "Player" });
    });
  });
});
