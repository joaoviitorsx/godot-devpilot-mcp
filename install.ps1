$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath (Join-Path (Get-Location).Path 'project.godot') -PathType Leaf)) {
    throw 'GodoPilot: execute este comando dentro da pasta do seu jogo (onde está project.godot).'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'GodoPilot: instale Node.js 22.12+ com npm antes de continuar.'
}

$packageSpec = if ($env:GODOPILOT_PACKAGE_SPEC) { $env:GODOPILOT_PACKAGE_SPEC } else { 'github:joaoviitorsx/godot-devpilot-mcp#main' }
& npm.cmd exec --yes "--package=$packageSpec" -- godopilot @args
if ($LASTEXITCODE -ne 0) {
    throw "GodoPilot: instalacao falhou (codigo $LASTEXITCODE)."
}
