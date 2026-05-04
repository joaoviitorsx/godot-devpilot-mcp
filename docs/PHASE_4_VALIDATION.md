# Validação da Fase 4 — Cenas, Nós e UndoRedo

Data: 2026-05-04

Escopo: validar e fechar pendências da Fase 4 contra `docs/roadmap.md`, `docs/architecture.md`, `docs/security.md`, `docs/tool_specification.md`, `docs/api_reference.md`, `docs/contributing.md`, `docs/inicial.md` e `docs/base_audit.md`.

## 1. Ferramentas implementadas na Fase 4

Todas as ferramentas do checklist da Fase 4 estão implementadas:

```text
godot_create_scene
godot_open_scene
godot_save_scene
godot_duplicate_scene
godot_get_scene_tree
godot_get_scene_summary
godot_validate_scene
godot_audit_scene
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_get_node_properties
godot_set_node_property
godot_get_node_groups
godot_add_node_to_group
godot_remove_node_from_group
```

Status: 18/18 implementadas.

## 2. Métodos JSON-RPC implementados no plugin Godot

```text
scene.create
scene.open
scene.save
scene.duplicate
scene.get_tree
scene.get_summary
scene.validate
scene.audit
node.add
node.remove
node.rename
node.duplicate
node.reparent
node.get_properties
node.set_property
node.get_groups
node.add_to_group
node.remove_from_group
```

## 3. Arquivos TypeScript criados/alterados no servidor MCP

```text
mcp-server/src/tools/sceneTools.ts
mcp-server/src/tools/nodeTools.ts
mcp-server/src/config/modes.ts
mcp-server/src/safety/permissions.ts
mcp-server/src/safety/toolWrapper.ts
mcp-server/src/index.ts
mcp-server/tests/sceneTools.test.ts
mcp-server/tests/nodeTools.test.ts
mcp-server/tests/modes.test.ts
```

## 4. Arquivos GDScript criados/alterados no plugin

```text
addons/godot_devpilot_mcp/core/undo_service.gd
addons/godot_devpilot_mcp/core/permissions.gd
addons/godot_devpilot_mcp/core/dispatcher.gd
addons/godot_devpilot_mcp/core/rpc_server.gd
addons/godot_devpilot_mcp/plugin.gd
addons/godot_devpilot_mcp/tools/scene_tools.gd
addons/godot_devpilot_mcp/tools/node_tools.gd
tests/godot/phase4_test.gd
tests/godot/permissions_test.gd
```

## 5. Como testar cada ferramenta manualmente

Usar cliente MCP com editor Godot aberto e plugin habilitado.

| Ferramenta | Chamada mínima |
| --- | --- |
| `godot_create_scene` | `{ "scene_path": "res://scenes/TestPhase4.tscn", "root_type": "Node2D", "root_name": "TestRoot", "overwrite": true }` |
| `godot_open_scene` | `{ "scene_path": "res://scenes/TestPhase4.tscn" }` |
| `godot_add_node` | `{ "parent_path": ".", "type": "CharacterBody2D", "name": "Player" }` |
| `godot_set_node_property` | `{ "node_path": "Player", "property": "position", "value": { "x": 100, "y": 200 } }` |
| `godot_get_scene_tree` | `{ "include_properties": false, "max_depth": 10 }` |
| `godot_save_scene` | `{ "scene_path": "res://scenes/TestPhase4.tscn" }` |
| `godot_validate_scene` | `{ "scene_path": "res://scenes/TestPhase4.tscn" }` |
| `godot_audit_scene` | `{ "scene_path": "res://scenes/TestPhase4.tscn" }` |

Fluxo prático obrigatório executado via WebSocket local no editor headless:

1. Criou `res://scenes/TestPhase4.tscn` com root `Node2D` chamado `TestRoot`.
2. Abriu a cena criada.
3. Adicionou `CharacterBody2D` chamado `Player`.
4. Adicionou `Sprite2D` como filho de `Player`.
5. Alterou posição do `Player` para `Vector2(100, 200)`.
6. Renomeou `Sprite2D` para `PlayerSprite`.
7. Duplicou `PlayerSprite`.
8. Reparentou `PlayerSprite2` para `TestRoot`.
9. Adicionou `Player` ao grupo `players`.
10. Obteve grupos do `Player`.
11. Obteve propriedades do `Player`.
12. Obteve árvore da cena.
13. Salvou a cena.
14. Validou a cena.
15. Auditou a cena.

Resultado do fluxo: árvore coerente com 4 nós, grupo `players`, auditoria com `errors: 0`, `warnings: 0`.

Pendente manual: Ctrl+Z em editor gráfico interativo. O fluxo headless valida que UndoRedo registra e executa ações via `EditorUndoRedoManager`, mas não simula atalho GUI.

## 6. Resultado esperado de cada ferramenta

- Scene CRUD: cria, abre, salva, duplica e valida cenas `.tscn` dentro de `res://`.
- Scene read/audit: retorna árvore, resumo, validação e auditoria sem mutar cena.
- Node mutations: adiciona, remove, renomeia, duplica e reparenta nós via UndoRedo.
- Properties: lê propriedades visíveis no editor e define valores com coerção segura.
- Groups: lê, adiciona e remove grupos via UndoRedo.

## 7. Quais ferramentas usam UndoRedo

```text
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_set_node_property
godot_add_node_to_group
godot_remove_node_from_group
```

Se UndoRedo estiver indisponível em mutação de nó, a ferramenta retorna `UNDO_FAILED`.

## 8. Quais ferramentas suportam dry_run

```text
godot_create_scene
godot_save_scene
godot_duplicate_scene
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_set_node_property
godot_add_node_to_group
godot_remove_node_from_group
```

Dry_run é server-side e não faz roundtrip ao plugin.

## 9. Quais ferramentas criam backup

```text
godot_save_scene quando scene_path/path é informado e arquivo existe
godot_create_scene quando overwrite=true e arquivo existe
godot_duplicate_scene quando overwrite=true e destino existe
```

Backups usam `.godot_mcp/backups/YYYY-MM-DD/...` via `createFileBackup`.

## 10. Quais validações de segurança foram aplicadas

- `pathGuard.ts` no servidor para paths de cena.
- `permissions.gd` no plugin para paths de cena.
- Bloqueio de path fora de `res://` e traversal `..`.
- Read-only allowlist para ferramentas de leitura da Fase 4.
- Backup antes de sobrescrita/salvamento de cena quando path é conhecido.
- Dry_run para mutações relevantes.
- Logs auditáveis em `.godot_mcp/logs/actions.jsonl`; dry_run agora grava status `dry_run`.
- `ClassDB.can_instantiate` para tipos de nós/root.
- Root node protegido em remove/duplicate/reparent.
- Propriedade inválida retorna erro; coerção complexa inválida retorna `INVALID_PROPERTY_VALUE`.
- Mutação de nó exige UndoRedo.

## 11. O que ficou pendente da Fase 4

Pendente técnico obrigatório: nenhum item de implementação do checklist mínimo.

Pendente manual: confirmar Ctrl+Z no editor gráfico interativo. Não foi possível simular atalho GUI no headless.

## 12. Riscos técnicos conhecidos

- `godot_save_scene` só cria backup automaticamente quando o caller informa `scene_path`/`path`; sem path, o servidor não conhece o arquivo antes do plugin salvar.
- Salvamento em editor headless emite warning interno da Godot dummy renderer ao criar miniatura, mas a cena foi salva e validada.
- Auditoria inicial cobre checks estruturais básicos; pode ser expandida em fases futuras.

## 13. Bugs encontrados

Bugs fechados nesta rodada:

- `godot_audit_scene` ausente.
- `godot_save_scene` sem dry_run/backup.
- Sandbox de paths de cena incompleto.
- `UndoRedoService` usando Callable incorreto com `EditorUndoRedoManager`.
- Fallback de mutação direta quando UndoRedo era obrigatório.
- `queue_free()` em undo de nós.
- Schemas divergentes para `scene_path`, `type` e `name`.
- `godot_get_scene_tree` sem `max_depth`.
- Logs de dry_run como `success`.

Bug/limitação restante:

- Ctrl+Z precisa de validação manual no editor gráfico.

## 14. Próximos passos para iniciar a Fase 5

Gate da Fase 4:

```text
[x] create/open/save scene funcionam
[x] add/remove/rename/duplicate/reparent node funcionam
[x] set_node_property converte tipos corretamente
[x] get_scene_tree retorna árvore coerente
[x] get_node_properties filtra propriedades visíveis no editor
[~] UndoRedo funciona no editor: validado via EditorUndoRedoManager no fluxo headless; Ctrl+Z GUI pendente
[x] dry_run não altera a cena
[x] erros seguem o padrão ok/error
[x] não há mutação fora de res:// nos paths validados
[x] logs estão sendo registrados
```

Próximo passo recomendado: fazer uma confirmação humana rápida de Ctrl+Z no editor gráfico. Depois disso, iniciar Fase 5 — Scripts e validação GDScript.

## Verificação executada

```text
npm test: 17 files, 95 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/phase4_test.gd: 18 passed, 0 failed.
godot --headless --path . --script tests/godot/permissions_test.gd: passed.
godot --headless --path . --script tests/godot/project_tools_test.gd: 9 passed, 0 failed.
godot --headless --path . --script tests/godot/project_tools_extended_test.gd: 26 passed, 0 failed.
godot --headless --editor --quit --path .: passed without plugin compile errors.
Practical WebSocket editor flow: passed; saved/validated/audited res://scenes/TestPhase4.tscn.
```
