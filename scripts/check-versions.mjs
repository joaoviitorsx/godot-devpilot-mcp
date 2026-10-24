#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const pkg = JSON.parse(read("mcp-server/package.json"));
const cliPkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("mcp-server/package-lock.json"));
const plugin = read("addons/godot_devpilot_mcp/plugin.cfg").match(/^version="([^"]+)"/m)?.[1];
const dispatcher = read("addons/godot_devpilot_mcp/core/dispatcher.gd");
const pluginCode = dispatcher.match(/^const PLUGIN_VERSION := "([^"]+)"/m)?.[1];
const protocol = dispatcher.match(/^const PROTOCOL_VERSION := "([^"]+)"/m)?.[1];
const config = read("mcp-server/src/config/config.ts");
const serverCode = config.match(/version: "([^"]+)",\s*protocolVersion: "([^"]+)"/)?.slice(1);
const versions = [cliPkg.version, pkg.version, lock.version, lock.packages?.[""]?.version, plugin, pluginCode, serverCode?.[0]];
if (versions.some((value) => value !== pkg.version) || protocol !== serverCode?.[1]) {
  console.error("Version mismatch:", { versions, protocol, serverCode });
  process.exitCode = 1;
} else console.log(`Versions aligned: plugin/server ${pkg.version}, protocol ${protocol}`);
