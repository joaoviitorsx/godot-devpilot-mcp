import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const GITHUB_ACTIONS_WORKFLOW = (godotVersion: string, exportPlatforms: string[]): string => `name: Godot Build

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    name: Build (\${{ matrix.platform }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        platform: ${JSON.stringify(exportPlatforms)}
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true

      - name: Cache Godot binary
        id: cache-godot
        uses: actions/cache@v4
        with:
          path: ~/.local/share/godot
          key: godot-\${{ runner.os }}-${godotVersion}

      - name: Install Godot ${godotVersion}
        if: steps.cache-godot.outputs.cache-hit != 'true'
        run: |
          mkdir -p ~/.local/share/godot
          curl -L -o godot.zip "https://github.com/godotengine/godot/releases/download/${godotVersion}-stable/Godot_v${godotVersion}-stable_linux.x86_64.zip"
          unzip -q godot.zip -d /tmp/godot-bin
          mv /tmp/godot-bin/Godot_v${godotVersion}-stable_linux.x86_64 ~/.local/share/godot/godot
          chmod +x ~/.local/share/godot/godot

      - name: Install export templates
        run: |
          mkdir -p ~/.local/share/godot/export_templates/${godotVersion}.stable
          curl -L -o templates.tpz "https://github.com/godotengine/godot/releases/download/${godotVersion}-stable/Godot_v${godotVersion}-stable_export_templates.tpz"
          unzip -q templates.tpz -d /tmp/templates
          mv /tmp/templates/templates/* ~/.local/share/godot/export_templates/${godotVersion}.stable/

      - name: Import resources
        run: ~/.local/share/godot/godot --headless --path . --import || true

      - name: Export build
        run: |
          mkdir -p build/\${{ matrix.platform }}
          ~/.local/share/godot/godot --headless --path . --export-release "\${{ matrix.platform }}" "build/\${{ matrix.platform }}/game"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: \${{ matrix.platform }}-build
          path: build/\${{ matrix.platform }}
          if-no-files-found: warn

  test:
    name: Static checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Run gut tests here when set up"
`;

const GITLAB_CI_YML = (godotVersion: string): string => `# Godot CI for GitLab
image: barichello/godot-ci:${godotVersion}

stages: [build]

variables:
  EXPORT_NAME: game

build:linux:
  stage: build
  script:
    - mkdir -p build/linux
    - godot --headless --path . --import || true
    - godot --headless --path . --export-release "Linux/X11" "build/linux/$EXPORT_NAME"
  artifacts:
    paths: [build/linux]

build:windows:
  stage: build
  script:
    - mkdir -p build/windows
    - godot --headless --path . --import || true
    - godot --headless --path . --export-release "Windows Desktop" "build/windows/$EXPORT_NAME.exe"
  artifacts:
    paths: [build/windows]

build:web:
  stage: build
  script:
    - mkdir -p build/web
    - godot --headless --path . --import || true
    - godot --headless --path . --export-release "Web" "build/web/index.html"
  artifacts:
    paths: [build/web]
`;

const CIRCLECI_CONFIG = (godotVersion: string): string => `version: 2.1

jobs:
  build:
    docker:
      - image: barichello/godot-ci:${godotVersion}
    steps:
      - checkout
      - run:
          name: Import
          command: godot --headless --path . --import || true
      - run:
          name: Export Linux
          command: |
            mkdir -p build/linux
            godot --headless --path . --export-release "Linux/X11" "build/linux/game"
      - store_artifacts:
          path: build/linux

workflows:
  build_and_test:
    jobs:
      - build
`;

export function registerCiTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_setup_ci",
    "Generate a CI workflow file for the project. Targets: github_actions (.github/workflows/godot-build.yml), gitlab (.gitlab-ci.yml), circleci (.circleci/config.yml). Configures multi-platform export + test stub.",
    {
      target: z.enum(["github_actions", "gitlab", "circleci"]),
      godot_version: z.string().optional().default("4.3"),
      platforms: z.array(z.enum(["Linux/X11", "Windows Desktop", "macOS", "Web", "Android"])).optional().default(["Linux/X11", "Windows Desktop", "Web"]),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_setup_ci", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          let target_path: string;
          let content: string;
          if (params.target === "github_actions") {
            target_path = ".github/workflows/godot-build.yml";
            content = GITHUB_ACTIONS_WORKFLOW(params.godot_version, params.platforms);
          } else if (params.target === "gitlab") {
            target_path = ".gitlab-ci.yml";
            content = GITLAB_CI_YML(params.godot_version);
          } else {
            target_path = ".circleci/config.yml";
            content = CIRCLECI_CONFIG(params.godot_version);
          }
          const abs = path.join(config.projectRoot, target_path);
          if (await fileExists(abs) && !params.overwrite) {
            return createErrorResponse("EXISTS", `${target_path} already exists; pass overwrite=true.`, { path: target_path }, []);
          }
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf8");
          return createSuccessResponse(
            { target: params.target, file: target_path, godot_version: params.godot_version, platforms: params.platforms },
            `CI workflow written: ${target_path}`,
            ["Configure repo secrets (signing certs, deploy tokens) before pushing.", "Run devpilot_setup_export_preset for each target platform first."]
          );
        })
      )
  );
}
