#!/bin/sh
set -eu

if [ ! -f "./project.godot" ]; then
  printf '%s\n' 'GodoPilot: execute este comando dentro da pasta do seu jogo (onde está project.godot).' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'GodoPilot: instale Node.js 22.12+ com npm antes de continuar.' >&2
  exit 1
fi

package_spec=${GODOPILOT_PACKAGE_SPEC:-github:joaoviitorsx/godot-devpilot-mcp#main}
exec npm exec --yes --package="$package_spec" -- godopilot "$@"
