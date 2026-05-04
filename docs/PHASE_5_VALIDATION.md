# Validação da Fase 5 — Scripts e Validação GDScript

Data: 2026-05-04

Escopo: implementar somente Fase 5, sem runtime/debug loop da Fase 6.

## 1. Hardening antes da Fase 5

Issue resolvida: `godot_save_scene` sem `scene_path/path` explícito.

Solução aplicada: o servidor chama `project.get_editor_context`, obtém `current_scene`, valida o path com `pathGuard.ts`, cria backup server-side se o arquivo existe e só então chama `scene.save` com path explícito.

## 2. Ferramentas implementadas

Fase 5.1:

```text
godot_create_script
godot_read_script
godot_patch_script
godot_attach_script
godot_validate_script
godot_get_classdb_info
```

Fase 5.2:

```text
godot_get_script_symbols
godot_get_script_dependencies
godot_find_references
godot_format_script
```

Fase 6 não foi implementada.

## 3. Métodos JSON-RPC implementados no plugin Godot

```text
script.attach
script.validate
script.get_classdb_info
```

As demais ferramentas da Fase 5 rodam no servidor MCP sobre o filesystem com sandbox `res://`.

## 4. Arquivos TypeScript criados/alterados

```text
mcp-server/src/tools/scriptTools.ts
mcp-server/src/index.ts
mcp-server/src/config/modes.ts
mcp-server/src/safety/permissions.ts
mcp-server/src/tools/sceneTools.ts
mcp-server/tests/scriptTools.test.ts
mcp-server/tests/sceneTools.test.ts
mcp-server/tests/modes.test.ts
```

## 5. Arquivos GDScript criados/alterados

```text
addons/godot_devpilot_mcp/tools/script_tools.gd
addons/godot_devpilot_mcp/core/dispatcher.gd
addons/godot_devpilot_mcp/core/permissions.gd
tests/godot/phase5_test.gd
```

## 6. Segurança aplicada

- `godot_read_script` aceita apenas `.gd`, usa path sandbox e bloqueia arquivos sensíveis.
- `godot_create_script` cria backup se `overwrite=true` e arquivo existir.
- `godot_patch_script` sempre cria backup antes de alterar.
- `godot_format_script` cria backup antes de alterar.
- `godot_attach_script` usa UndoRedo.
- `godot_validate_script` retorna `errors` e `warnings` estruturados com `file`, `line`, `column`, `message`.
- Validação alerta padrões Godot 3 quando target é Godot 4.x: `export(...)`, `onready var`, `yield(...)`, `KinematicBody2D`.
- Ferramentas seguem envelope `ok/data/message/warnings/suggestions` ou `ok=false/error`.
- Read-only permite apenas ferramentas de leitura/análise.

## 7. Teste manual sugerido

1. `godot_create_script` com `res://scripts/Player.gd`.
2. `godot_read_script` para conferir conteúdo.
3. `godot_validate_script` target `4.x`.
4. Abrir cena com nó `Player`.
5. `godot_attach_script` em `Player`.
6. Pressionar Ctrl+Z no editor gráfico para confirmar UndoRedo do attach.
7. `godot_patch_script` alterando uma constante.
8. Confirmar backup em `.godot_mcp/backups`.
9. `godot_get_script_symbols`.
10. `godot_get_script_dependencies`.
11. `godot_find_references`.
12. `godot_format_script`.

## 8. Critérios de conclusão

```text
[x] IA consegue criar script Godot 4 válido
[x] IA consegue anexar script a nó com UndoRedo
[x] IA consegue aplicar patch com backup
[x] Validação detecta erro de sintaxe básico
[x] Validação aponta arquivo e linha quando possível
[x] Analyzer detecta classes, métodos, sinais e exports básicos
[x] ClassDB retorna informação útil sobre classes Godot
[x] Não foi implementado runtime/debug loop
```

## 9. Limitações conhecidas

- `godot_validate_script` usa validação estrutural inicial no plugin; não substitui o parser completo do editor/debugger.
- Confirmação visual de Ctrl+Z para `godot_attach_script` ainda depende do editor gráfico interativo.
- `godot_format_script` é conservador: normaliza LF, remove trailing whitespace e garante newline final.

## 10. Verificação executada

```text
npm test: 18 files, 102 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/phase4_test.gd: 18 passed, 0 failed.
godot --headless --path . --script tests/godot/phase5_test.gd: 14 passed, 0 failed.
godot --headless --editor --quit --path .: plugin carregou sem erro de compilação.
```
