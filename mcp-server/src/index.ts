#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, validateProjectRoot } from "./config/config.js";
import { GodotClient } from "./godot/client.js";
import { registerCoreTools } from "./tools/coreTools.js";
import { registerDebugTools } from "./tools/debugTools.js";
import { registerFileTools } from "./tools/fileTools.js";
import { registerInputTools } from "./tools/inputTools.js";
import { registerIntelligenceTools } from "./tools/intelligenceTools.js";
import { registerMemoryTools } from "./tools/memoryTools.js";
import { registerNodeTools } from "./tools/nodeTools.js";
import { registerProjectTools } from "./tools/projectTools.js";
import { registerSceneTools } from "./tools/sceneTools.js";
import { registerRuntimeTools } from "./tools/runtimeTools.js";
import { registerScreenshotTools } from "./tools/screenshotTools.js";
import { registerScriptTools } from "./tools/scriptTools.js";
import { registerTestTools } from "./tools/testTools.js";
import { registerToolkit2dTools } from "./tools/toolkit2dTools.js";
import { registerToolkit3dTools } from "./tools/toolkit3dTools.js";
import { registerToolkit13Tools } from "./tools/toolkit13Tools.js";
import { registerAgenticTools } from "./tools/agenticTools.js";
import { registerPhase17Tools } from "./tools/phase17Tools.js";
import { registerPhase18Tools } from "./tools/phase18Tools.js";
import { registerPhase19Tools } from "./tools/phase19Tools.js";
import { registerPhase20Tools } from "./tools/phase20Tools.js";
import { registerDoctorTools } from "./tools/doctorTools.js";
import { registerInferTools } from "./tools/inferTools.js";
import { registerWorkflowTools } from "./tools/workflowTools.js";
import { registerDiffTools } from "./tools/diffTools.js";
import { registerTransactionTools } from "./tools/transactionTools.js";
import { registerConventionTools } from "./tools/conventionTools.js";
import { registerScoreTools } from "./tools/scoreTools.js";
import { registerAutoloadTools } from "./tools/autoloadTools.js";
import { registerRecordingTools } from "./tools/recordingTools.js";
import { registerScreenshotDiffTools } from "./tools/screenshotDiffTools.js";
import { registerBehaviorReplayTools } from "./tools/behaviorReplayTools.js";
import { registerSafeRefactorV2Tools } from "./tools/safeRefactorV2Tools.js";

const config = loadConfig();

const rootCheck = validateProjectRoot(config.projectRoot);
if (!rootCheck.valid) {
  console.error(`[Godot DevPilot MCP] FATAL: invalid project root '${rootCheck.resolvedPath}': ${rootCheck.reason}`);
  console.error(`[Godot DevPilot MCP] Set GODOT_MCP_PROJECT_ROOT to the absolute path of a directory containing project.godot.`);
  process.exit(1);
}
console.error(`[Godot DevPilot MCP] project root: ${rootCheck.resolvedPath}`);

const godot = new GodotClient(config.godot);

const server = new McpServer({
  name: config.server.name,
  version: config.server.version
});

registerCoreTools(server, godot, config);
registerProjectTools(server, godot, config);
registerFileTools(server, config);
registerSceneTools(server, godot, config);
registerNodeTools(server, godot, config);
registerScriptTools(server, godot, config);
registerDebugTools(server, godot, config);
registerScreenshotTools(server, godot, config);
registerInputTools(server, godot, config);
registerRuntimeTools(server, godot, config);
registerIntelligenceTools(server, config);
registerMemoryTools(server, config);
registerToolkit2dTools(server, godot, config);
registerToolkit3dTools(server, godot, config);
registerToolkit13Tools(server, godot, config);
registerTestTools(server, godot, config);
registerAgenticTools(server, godot, config);
registerPhase17Tools(server, godot, config);
registerPhase18Tools(server, godot, config);
registerPhase19Tools(server, godot, config);
registerPhase20Tools(server, godot, config);
registerDoctorTools(server, godot, config);
registerInferTools(server, godot, config);
registerWorkflowTools(server, godot, config);
registerDiffTools(server, godot, config);
registerTransactionTools(server, godot, config);
registerConventionTools(server, godot, config);
registerScoreTools(server, godot, config);
registerAutoloadTools(server, godot, config);
registerRecordingTools(server, godot, config);
registerScreenshotDiffTools(server, godot, config);
registerBehaviorReplayTools(server, godot, config);
registerSafeRefactorV2Tools(server, godot, config);

void godot.connect().then((initialConnection) => {
  if (!initialConnection.ok) {
    console.error(`[Godot DevPilot MCP] ${initialConnection.error.code}: ${initialConnection.error.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  void godot.disconnect().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void godot.disconnect().finally(() => process.exit(0));
});
