# Publishing godot_devpilot_mcp to the Godot Asset Library

Checklist + walkthrough.

## Pre-publish requirements

- [ ] Stable version tag in git (`v0.5.0` or similar)
- [ ] License file (`LICENSE`) present at repo root
- [ ] `addons/godot_devpilot_mcp/plugin.cfg` filled correctly:
  - `name=`
  - `description=` (1-2 sentences)
  - `author=`
  - `version=` matches git tag
  - `script="plugin.gd"`
- [ ] No platform-specific binaries committed (assets must be source-only)
- [ ] `.gitignore` excludes `dist/`, `node_modules/`, `.godot/`, `*.gd.uid`
- [ ] Plugin loads cleanly in a fresh Godot 4.3+ project (no errors in Output)
- [ ] Plugin disables cleanly without orphaned nodes
- [ ] Tested on Linux + Windows + macOS (at least 2 of 3)
- [ ] No runtime panics in editor (try toggling 5+ times)

## Plugin metadata

```ini
; addons/godot_devpilot_mcp/plugin.cfg
[plugin]
name="DevPilot MCP"
description="Bridge between an MCP server and Godot 4: scene/script/blueprint/composition tools for prompt-driven game development."
author="<you>"
version="0.5.0"
script="plugin.gd"
```

## Repository hygiene

- README.md at root with screenshot/gif (Asset Library shows it inline)
- `docs/` folder linked from README
- CHANGELOG.md with entries per version
- `examples/` folder with at least 2 reference projects
- License = MIT or Apache-2.0 (Asset Library prefers permissive)

## Submission steps

1. Create account at https://godotengine.org/asset-library
2. Sign in → "Submit Asset"
3. Fill form:
   - **Title**: DevPilot MCP
   - **Category**: 2D Tools (or Scripts depending on review)
   - **Godot version**: 4.3
   - **Source**: GitHub URL
   - **Repository host**: GitHub
   - **Repository URL**: https://github.com/<user>/godot-devpilot-mcp
   - **Issues URL**: same + /issues
   - **Download URL**: https://github.com/<user>/godot-devpilot-mcp/archive/refs/tags/v0.5.0.zip
   - **Commit hash**: tag's SHA
   - **Description**: longer version of plugin.cfg description, list 5-10 capabilities
   - **Browse URL**: same as repo
   - **Icon URL**: link to a 64×64 PNG hosted on the repo (`docs/icon.png`)
4. Submit and wait — review takes 3-30 days.
5. Reviewer will leave comments on Asset Library page; respond and update tag if changes requested.

## Post-publish

- Bump `[plugin]/version=` AND git tag together when releasing.
- Re-submit "Edit Asset" via the Asset Library form (same flow, different button) — only required when you want existing users to see "Update" prompt.
- Monitor issues filed via Asset Library link.

## Common rejections

- Missing or invalid `plugin.cfg`
- Plugin throws errors on enable/disable
- Description too short
- License file missing
- Hosting on a non-public repo
- Inappropriate category

## Bonus

- Submit a short blog post / tweet announcing release.
- Add Asset Library badge to README.
- Pin issue tracker label `asset-library-feedback` for triaging external user reports.
