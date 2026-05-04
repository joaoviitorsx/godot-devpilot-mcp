# Validação Consolidada — Fases 0 a 5

Projeto: **Godot DevPilot MCP**  
Escopo: validação acumulada das Fases 0, 1, 2, 3, 4 e 5 antes de avançar para a Fase 6 — Debug Loop.

---

## 1. Objetivo deste documento

Este documento define um processo formal para validar tudo que foi implementado das Fases 0 a 5 do Godot DevPilot MCP.

Ele deve ser usado para confirmar que o projeto possui uma base estável antes de avançar para recursos de runtime, debug loop, screenshots, input simulation e ferramentas agentic.

A validação cobre:

```text
Fase 0 — Preparação, auditoria e documentação
Fase 1 — Core MCP e protocolo
Fase 2 — Segurança e confiabilidade
Fase 3 — Ferramentas essenciais de projeto
Fase 4 — Cenas, nós e UndoRedo
Fase 5 — Scripts e validação GDScript
```

Este documento também define:

- critérios de aceite;
- testes obrigatórios;
- ferramentas esperadas;
- arquivos esperados;
- riscos conhecidos;
- pendências aceitáveis;
- bloqueios para avanço;
- relatório final de aprovação.

---

## 2. Status geral esperado

Ao fim da Fase 5, o projeto deve ser capaz de:

```text
1. Iniciar um servidor MCP TypeScript.
2. Conectar ao plugin Godot via WebSocket/JSON-RPC.
3. Responder health checks.
4. Retornar informações do projeto Godot.
5. Aplicar políticas básicas de segurança.
6. Validar paths dentro de res://.
7. Registrar logs auditáveis.
8. Criar backups antes de alterações críticas.
9. Criar, abrir, salvar, duplicar e validar cenas.
10. Adicionar, remover, renomear, duplicar e reparentar nós.
11. Alterar propriedades de nós com coerção segura.
12. Usar UndoRedo nas mutações de editor.
13. Criar, ler, editar e anexar scripts GDScript.
14. Validar scripts GDScript.
15. Consultar informações básicas da ClassDB.
16. Retornar erros estruturados e acionáveis.
```

---

## 3. Critério global de aprovação

A validação consolidada só deve ser considerada aprovada se:

```text
[ ] npm run build passa sem erros.
[ ] npm test passa sem erros.
[ ] Plugin Godot compila sem erros.
[ ] Godot abre o projeto com o plugin ativo.
[ ] Servidor MCP conecta ao plugin.
[ ] godot_health_check retorna ok=true.
[ ] Todas as ferramentas das Fases 0 a 5 existem no modo correto.
[ ] Ferramentas de leitura funcionam em read-only.
[ ] Ferramentas mutáveis são bloqueadas em read-only.
[ ] path sandbox bloqueia traversal e paths externos.
[ ] backups são criados onde obrigatório.
[ ] dry_run não altera arquivos, cenas ou nós.
[ ] logs são registrados em .godot_mcp/logs/actions.jsonl.
[ ] UndoRedo funciona no editor para mutações de nós e attach_script.
[ ] create/open/save scene funcionam.
[ ] create/read/patch/attach/validate script funcionam.
[ ] Erros seguem o contrato ok=false/error.
[ ] Não há ferramenta avançando para Fase 6 sem aprovação.
```

---

# 4. Validação da Fase 0 — Preparação e auditoria

## 4.1 Objetivo da fase

Confirmar que o projeto possui documentação, estrutura inicial e auditoria das bases públicas usadas como referência.

## 4.2 Documentos esperados

```text
README.md
docs/ARCHITECTURE.md
docs/TOOL_GAP_ANALYSIS.md
docs/TOOL_SPECIFICATION.md
docs/ROADMAP.md
docs/SECURITY.md
docs/DEVELOPMENT_GUIDE.md
docs/CONTRIBUTING.md
docs/API_REFERENCE.md
docs/INSTALLATION.md
docs/TROUBLESHOOTING.md
docs/EXAMPLES.md
```

Documentos complementares recomendados:

```text
docs/CODING_SOLO_INTEGRATION.md
docs/PHASE_0_VALIDATION.md
docs/PHASE_1_VALIDATION.md
docs/PHASE_4_VALIDATION.md
docs/PHASE_5_VALIDATION.md
```

## 4.3 Auditorias esperadas

A auditoria deve mencionar, quando aplicável:

```text
- tomyud1/godot-mcp
- Coding-Solo/godot-mcp
- Godot MCP Pro
- GDAI MCP
- GodotIQ
- outras referências públicas consideradas
```

## 4.4 Checklist da Fase 0

```text
[ ] README.md existe e descreve o projeto.
[ ] ROADMAP.md existe e define fases do projeto.
[ ] ARCHITECTURE.md existe e define a arquitetura MCP + plugin.
[ ] SECURITY.md existe e define regras de segurança.
[ ] TOOL_SPECIFICATION.md existe e define ferramentas e respostas.
[ ] API_REFERENCE.md existe ou está planejado.
[ ] Documentação de instalação existe.
[ ] Documentação de troubleshooting existe.
[ ] Auditoria das bases públicas foi registrada.
[ ] Nenhum código fechado/proprietário foi copiado.
[ ] Licenças open source usadas foram registradas.
```

## 4.5 Critério de aprovação

A Fase 0 é aprovada se:

```text
- a estrutura documental mínima existe;
- o escopo técnico está claro;
- as referências públicas foram mapeadas;
- a base do projeto está pronta para implementação.
```

## 4.6 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
```

Ressalvas:

```text
-
```

---

# 5. Validação da Fase 1 — Core MCP e protocolo

## 5.1 Objetivo da fase

Validar a fundação técnica de comunicação entre cliente MCP, servidor TypeScript e plugin Godot.

## 5.2 Arquivos esperados no servidor MCP

```text
mcp-server/package.json
mcp-server/tsconfig.json
mcp-server/src/index.ts
mcp-server/src/config/config.ts
mcp-server/src/config/modes.ts
mcp-server/src/godot/client.ts
mcp-server/src/godot/connection.ts
mcp-server/src/godot/protocol.ts
mcp-server/src/godot/schemas.ts
mcp-server/src/tools/coreTools.ts
mcp-server/src/utils/errors.ts
mcp-server/src/utils/logger.ts
```

Os nomes exatos podem variar, mas as responsabilidades devem existir.

## 5.3 Arquivos esperados no plugin Godot

```text
addons/godot_devpilot_mcp/plugin.cfg
addons/godot_devpilot_mcp/plugin.gd
addons/godot_devpilot_mcp/core/rpc_server.gd
addons/godot_devpilot_mcp/core/dispatcher.gd
addons/godot_devpilot_mcp/core/protocol.gd
addons/godot_devpilot_mcp/core/response_factory.gd
```

## 5.4 Ferramentas esperadas

```text
godot_health_check
godot_ping
godot_get_capabilities
godot_get_connection_status
godot_get_protocol_version
```

Opcionalmente já nesta fase:

```text
godot_get_project_info
```

## 5.5 Métodos JSON-RPC esperados

```text
core.health_check
core.ping
core.get_capabilities
core.get_connection_status
core.get_protocol_version
project.get_info
```

Os nomes podem variar, mas devem estar documentados.

## 5.6 Testes obrigatórios

```text
[ ] Servidor MCP inicia sem erro.
[ ] Plugin Godot ativa sem erro de compilação.
[ ] WebSocket inicia na porta configurada.
[ ] Cliente MCP consegue chamar godot_health_check.
[ ] godot_health_check retorna ok=true.
[ ] godot_get_capabilities retorna modo e lista de features.
[ ] Timeout retorna erro padronizado.
[ ] Plugin desconectado retorna GODOT_NOT_CONNECTED.
[ ] JSON-RPC inválido retorna erro estruturado.
```

## 5.7 Comandos de verificação

```bash
cd mcp-server
npm install
npm run build
npm test
```

Teste Godot:

```bash
godot --headless --editor --quit --path .
```

## 5.8 Critério de aprovação

A Fase 1 é aprovada se:

```text
- servidor inicia;
- plugin inicia;
- comunicação MCP → servidor → plugin funciona;
- health_check e capabilities retornam resposta padronizada;
- erros de conexão são tratados corretamente.
```

## 5.9 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
```

Ressalvas:

```text
-
```

---

# 6. Validação da Fase 2 — Segurança e confiabilidade

## 6.1 Objetivo da fase

Confirmar que a camada de segurança básica foi implementada antes de permitir mutações em arquivos, cenas e nós.

## 6.2 Módulos esperados

Servidor:

```text
mcp-server/src/safety/pathGuard.ts
mcp-server/src/safety/backup.ts
mcp-server/src/safety/dryRun.ts
mcp-server/src/safety/permissions.ts
mcp-server/src/safety/toolWrapper.ts
mcp-server/src/utils/logger.ts
mcp-server/src/utils/errors.ts
```

Plugin:

```text
addons/godot_devpilot_mcp/core/permissions.gd
addons/godot_devpilot_mcp/core/response_factory.gd
addons/godot_devpilot_mcp/core/protocol.gd
```

Pastas internas esperadas:

```text
.godot_mcp/backups/
.godot_mcp/logs/
.godot_mcp/trash/
```

## 6.3 Recursos obrigatórios

```text
[ ] Path sandbox.
[ ] Bloqueio de traversal `..`.
[ ] Bloqueio de paths fora de res://.
[ ] Modo read-only.
[ ] Permission presets ou camada equivalente.
[ ] Backup service.
[ ] dry_run helper.
[ ] Action logger em JSONL.
[ ] Safe trash ou design preparado.
[ ] Erros padronizados de segurança.
```

## 6.4 Testes obrigatórios de segurança

### 6.4.1 Path traversal

Devem falhar:

```text
../file.gd
../../file.gd
res://../file.gd
C:\Users\User\file.gd
/home/user/file.gd
file:///etc/passwd
```

Erro esperado:

```text
PATH_OUTSIDE_PROJECT
```

### 6.4.2 Read-only

Em modo read-only, devem falhar:

```text
godot_write_file
godot_patch_file
godot_create_scene
godot_add_node
godot_remove_node
godot_create_script
godot_attach_script
```

Erro esperado:

```text
READ_ONLY_MODE
```

### 6.4.3 Dry run

Quando `dry_run=true`:

```text
[ ] nenhum arquivo é alterado;
[ ] nenhuma cena é salva;
[ ] nenhum nó é criado/removido;
[ ] resposta informa planned_changes ou equivalente;
[ ] log registra status dry_run.
```

### 6.4.4 Backup

Antes de sobrescrever arquivo existente:

```text
[ ] backup é criado em .godot_mcp/backups/YYYY-MM-DD/;
[ ] metadata ou log referencia backup;
[ ] se backup falhar, alteração é bloqueada.
```

### 6.4.5 Logs

```text
[ ] .godot_mcp/logs/actions.jsonl existe.
[ ] chamadas bem-sucedidas são registradas.
[ ] erros são registrados.
[ ] dry_run é registrado como dry_run, não success genérico.
[ ] conteúdo completo de arquivos sensíveis não é registrado.
```

## 6.5 Critério de aprovação

A Fase 2 é aprovada se:

```text
- nenhuma mutação perigosa ocorre sem validação;
- read-only bloqueia mutações;
- path sandbox é efetivo;
- backup funciona onde obrigatório;
- logs registram ações;
- erros seguem contrato padronizado.
```

## 6.6 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
```

Ressalvas:

```text
-
```

---

# 7. Validação da Fase 3 — Ferramentas essenciais de projeto

## 7.1 Objetivo da fase

Validar que a IA consegue entender o projeto Godot aberto e consultar configurações básicas.

## 7.2 Ferramentas esperadas

```text
godot_get_project_info
godot_get_project_settings
godot_get_godot_version
godot_get_editor_context
godot_get_open_scenes
godot_get_selected_nodes
godot_get_input_map
godot_add_input_action
godot_remove_input_action
godot_get_autoloads
godot_add_autoload
godot_remove_autoload
```

Dependendo do escopo implementado, algumas ferramentas podem ter sido adiadas, mas isso deve estar justificado em relatório.

## 7.3 Métodos JSON-RPC esperados

```text
project.get_info
project.get_settings
project.get_godot_version
editor.get_context
editor.get_open_scenes
editor.get_selected_nodes
input.get_map
input.add_action
input.remove_action
autoload.get_all
autoload.add
autoload.remove
```

## 7.4 Testes obrigatórios

```text
[ ] godot_get_project_info retorna nome, path, versão e main scene quando disponível.
[ ] godot_get_godot_version retorna versão real da Godot.
[ ] godot_get_editor_context retorna cena atual e status de execução.
[ ] godot_get_input_map lista ações do projeto.
[ ] godot_add_input_action respeita dry_run.
[ ] godot_add_input_action cria ação real quando dry_run=false.
[ ] godot_remove_input_action respeita dry_run.
[ ] ferramentas mutáveis são bloqueadas em read-only.
[ ] godot_get_autoloads retorna autoloads existentes.
[ ] add/remove autoload, se implementados, criam backup ou log adequado.
```

## 7.5 Verificação manual sugerida

```text
1. Abrir projeto Godot.
2. Chamar godot_get_project_info.
3. Chamar godot_get_editor_context.
4. Chamar godot_get_input_map.
5. Criar ação test_action com dry_run=true.
6. Confirmar que action não foi criada.
7. Criar action com dry_run=false.
8. Confirmar no Project Settings > Input Map.
9. Remover action.
```

## 7.6 Critério de aprovação

A Fase 3 é aprovada se:

```text
- informações principais do projeto são retornadas corretamente;
- contexto do editor é consultável;
- Input Map é consultável e manipulável com segurança;
- Autoloads são consultáveis ou pendência está documentada;
- respostas seguem contrato padronizado.
```

## 7.7 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
```

Ressalvas:

```text
-
```

---

# 8. Validação da Fase 4 — Cenas, nós e UndoRedo

## 8.1 Objetivo da fase

Validar manipulação segura de cenas e nós no editor Godot.

## 8.2 Ferramentas esperadas

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

## 8.3 Métodos JSON-RPC esperados

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

## 8.4 Ferramentas que devem usar UndoRedo

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

## 8.5 Ferramentas que devem suportar dry_run

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

## 8.6 Teste prático obrigatório

Executar em projeto Godot com plugin ativo:

```text
1. Criar res://scenes/TestPhase4.tscn com root Node2D chamado TestRoot.
2. Abrir a cena criada.
3. Adicionar CharacterBody2D chamado Player.
4. Adicionar Sprite2D como filho de Player.
5. Alterar posição do Player para Vector2(100, 200).
6. Renomear Sprite2D para PlayerSprite.
7. Duplicar PlayerSprite.
8. Reparentar PlayerSprite2 para TestRoot.
9. Adicionar Player ao grupo players.
10. Obter grupos do Player.
11. Obter propriedades do Player.
12. Obter árvore da cena.
13. Salvar cena.
14. Validar cena.
15. Auditar cena.
```

Resultado esperado:

```text
[ ] Árvore coerente.
[ ] Player existe.
[ ] PlayerSprite existe.
[ ] PlayerSprite duplicado existe.
[ ] Reparent funcionou.
[ ] Player pertence ao grupo players.
[ ] Auditoria retorna errors: 0.
[ ] Cena salva e reabre corretamente.
```

## 8.7 Teste manual de UndoRedo GUI

Este teste deve ser feito no editor gráfico, não apenas headless.

```text
1. Abrir cena de teste.
2. Executar godot_add_node para criar Node2D chamado UndoTest.
3. Confirmar visualmente que UndoTest apareceu.
4. Pressionar Ctrl+Z.
5. Confirmar visualmente que UndoTest desapareceu.
6. Pressionar Ctrl+Y.
7. Confirmar visualmente que UndoTest voltou.
8. Executar godot_set_node_property em UndoTest.position.
9. Pressionar Ctrl+Z.
10. Confirmar que position voltou ao valor anterior.
```

Status:

```text
[ ] Aprovado
[ ] Pendente
[ ] Reprovado
```

Observações:

```text
-
```

## 8.8 Riscos conhecidos da Fase 4

Registrar aqui riscos aceitos:

```text
- godot_save_scene sem scene_path explícito pode não criar backup server-side.
- Auditoria de cena pode cobrir apenas checks básicos inicialmente.
- Headless não substitui 100% validação visual do UndoRedo no editor gráfico.
```

## 8.9 Critério de aprovação

A Fase 4 é aprovada se:

```text
- todas as ferramentas esperadas existem;
- fluxo prático obrigatório passa;
- mutações usam UndoRedo;
- dry_run não altera cena;
- backup funciona nos cenários previstos;
- path sandbox bloqueia paths inválidos;
- erros são padronizados.
```

## 8.10 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
```

Ressalvas:

```text
-
```

---

# 9. Validação da Fase 5 — Scripts e validação GDScript

## 9.1 Objetivo da fase

Validar criação, leitura, edição, anexação e validação de scripts GDScript.

## 9.2 Ferramentas esperadas da Fase 5.1

```text
godot_create_script
godot_read_script
godot_patch_script
godot_attach_script
godot_validate_script
godot_get_classdb_info
```

## 9.3 Ferramentas esperadas da Fase 5.2

```text
godot_get_script_symbols
godot_get_script_dependencies
godot_find_references
godot_format_script
```

Se Fase 5.2 ainda não foi implementada, registrar como pendência planejada, não como falha, desde que o escopo acordado tenha sido Fase 5.1.

## 9.4 Métodos JSON-RPC esperados

```text
script.create
script.read
script.patch
script.attach
script.validate
script.get_symbols
script.get_dependencies
script.find_references
script.format
classdb.get_info
```

## 9.5 Ferramentas que devem criar backup

```text
godot_create_script quando overwrite=true e arquivo existe
godot_patch_script sempre que altera arquivo existente
godot_format_script quando altera arquivo existente
```

## 9.6 Ferramentas que devem suportar dry_run

```text
godot_create_script
godot_patch_script
godot_attach_script
godot_format_script
```

## 9.7 Ferramenta que deve usar UndoRedo

```text
godot_attach_script
```

## 9.8 Segurança obrigatória

```text
[ ] read_script respeita path sandbox.
[ ] read_script bloqueia arquivos sensíveis.
[ ] create_script bloqueia path fora de res://.
[ ] create_script cria backup se overwrite=true.
[ ] patch_script cria backup obrigatório.
[ ] patch_script exige old_text ou mecanismo de patch seguro.
[ ] attach_script valida nó e script.
[ ] attach_script usa UndoRedo.
[ ] validate_script não altera arquivo.
[ ] get_classdb_info não altera estado.
```

## 9.9 Teste prático obrigatório da Fase 5.1

Executar em projeto Godot com plugin ativo:

```text
1. Criar res://scenes/TestPhase5.tscn com root CharacterBody2D chamado Player.
2. Criar res://scripts/Player.gd com extends CharacterBody2D.
3. Ler o script criado.
4. Validar o script criado.
5. Anexar o script ao nó Player.
6. Salvar a cena.
7. Reabrir a cena.
8. Confirmar que Player possui script anexado.
9. Aplicar patch no script alterando speed de 200 para 300.
10. Confirmar que backup foi criado.
11. Validar script novamente.
12. Consultar ClassDB para CharacterBody2D.
```

## 9.10 Script base recomendado para teste

```gdscript
extends CharacterBody2D

@export var speed: float = 200.0

func _physics_process(_delta: float) -> void:
    var direction := Vector2.ZERO
    direction.x = Input.get_axis("move_left", "move_right")
    direction.y = Input.get_axis("move_up", "move_down")

    if direction.length() > 1.0:
        direction = direction.normalized()

    velocity = direction * speed
    move_and_slide()
```

## 9.11 Teste de validação de erro GDScript

Criar script inválido temporário:

```gdscript
extends Node

func _ready()
    print("missing colon")
```

Resultado esperado de `godot_validate_script`:

```json
{
  "ok": true,
  "data": {
    "valid": false,
    "errors": [
      {
        "file": "res://scripts/InvalidTest.gd",
        "line": 3,
        "column": 1,
        "message": "..."
      }
    ]
  },
  "message": "Script validado com erros.",
  "warnings": [],
  "suggestions": []
}
```

Se a Godot não fornecer coluna, aceitar `column: null` ou campo ausente, desde que `file`, `line` e `message` existam quando possível.

## 9.12 Teste de warning para padrões Godot 3

Script com padrão antigo:

```gdscript
extends Node

func _ready() -> void:
    $Button.connect("pressed", self, "_on_pressed")
```

Resultado esperado:

```text
[ ] validate_script retorna warning de padrão antigo.
[ ] warning sugere sintaxe Godot 4: button.pressed.connect(_on_pressed).
```

## 9.13 Teste de símbolos

Para script:

```gdscript
extends CharacterBody2D

signal health_changed(value)

@export var speed: float = 200.0
var health: int = 100

func damage(amount: int) -> void:
    health -= amount
    health_changed.emit(health)
```

Resultado esperado de `godot_get_script_symbols`:

```text
[ ] extends: CharacterBody2D
[ ] signals: health_changed
[ ] exports: speed
[ ] variables: health
[ ] functions: damage
```

## 9.14 Teste de dependências

Verificar se o script analyzer identifica dependências simples como:

```text
preload("res://...")
load("res://...")
extends "res://..."
class_name
```

Resultado esperado:

```text
[ ] dependências diretas listadas.
[ ] paths inválidos retornam warning.
```

## 9.15 Teste de find references

Criar referência a um símbolo ou arquivo e validar:

```text
[ ] godot_find_references encontra ocorrências em scripts.
[ ] retorna path, linha e trecho.
[ ] respeita limite de resultados.
```

## 9.16 Critério de aprovação

A Fase 5 é aprovada se:

```text
- create/read/patch/attach/validate script funcionam;
- patch_script cria backup;
- attach_script usa UndoRedo;
- validate_script identifica script válido e inválido;
- path sandbox funciona;
- arquivos sensíveis são bloqueados;
- get_classdb_info retorna dados úteis;
- ferramentas analíticas implementadas, se incluídas no escopo, retornam dados coerentes;
- erros seguem contrato padronizado.
```

## 9.17 Status

```text
[ ] Aprovada
[ ] Aprovada com ressalvas
[ ] Reprovada
[ ] Parcial — apenas Fase 5.1 aprovada
```

Ressalvas:

```text
-
```

---

# 10. Teste integrado Fases 0 a 5

## 10.1 Objetivo

Validar que as fases funcionam em conjunto.

## 10.2 Fluxo integrado obrigatório

Executar o seguinte fluxo completo:

```text
1. Iniciar Godot com plugin ativo.
2. Iniciar servidor MCP.
3. Executar godot_health_check.
4. Executar godot_get_capabilities.
5. Executar godot_get_project_info.
6. Criar res://scenes/IntegratedPhase0To5.tscn com root CharacterBody2D chamado Player.
7. Criar res://scripts/IntegratedPlayer.gd.
8. Anexar script ao Player.
9. Adicionar Sprite2D como filho do Player.
10. Adicionar CollisionShape2D como filho do Player.
11. Alterar position do Player para Vector2(64, 128).
12. Adicionar Player ao grupo players.
13. Salvar cena.
14. Obter árvore da cena.
15. Ler script.
16. Validar script.
17. Aplicar patch alterando speed de 200 para 300.
18. Confirmar backup do script.
19. Validar script novamente.
20. Validar cena.
21. Auditar cena.
22. Confirmar logs em actions.jsonl.
23. Confirmar que nenhum path fora de res:// foi aceito.
```

## 10.3 Resultado esperado

```text
[ ] Todas as chamadas retornam ok=true, exceto testes negativos planejados.
[ ] Cena criada e salva corretamente.
[ ] Script criado, anexado e validado.
[ ] Backup criado no patch.
[ ] Logs registrados.
[ ] Auditoria de cena sem errors.
[ ] UndoRedo disponível para mutações de editor.
```

---

# 11. Testes negativos obrigatórios

## 11.1 Path inválido

Chamar leitura ou criação com:

```text
../outside.gd
res://../outside.gd
```

Esperado:

```text
PATH_OUTSIDE_PROJECT
```

## 11.2 Read-only

Ativar read-only e tentar:

```text
godot_create_scene
godot_add_node
godot_create_script
godot_patch_script
godot_attach_script
```

Esperado:

```text
READ_ONLY_MODE
```

## 11.3 Tipo de nó inválido

Chamar:

```json
{
  "parent_path": ".",
  "type": "CharactrBody2D",
  "name": "Player"
}
```

Esperado:

```text
INVALID_NODE_TYPE
```

## 11.4 Propriedade inválida

Chamar:

```json
{
  "node_path": "Player",
  "property": "propriedade_inexistente",
  "value": true
}
```

Esperado:

```text
INVALID_PROPERTY
```

## 11.5 Script inexistente

Chamar attach:

```json
{
  "node_path": "Player",
  "script_path": "res://scripts/DoesNotExist.gd"
}
```

Esperado:

```text
SCRIPT_NOT_FOUND
```

## 11.6 Script inválido

Validar script com erro de sintaxe.

Esperado:

```text
valid=false
errors.length > 0
```

---

# 12. Testes automatizados esperados

## 12.1 TypeScript

```text
mcp-server/tests/coreTools.test.ts
mcp-server/tests/projectTools.test.ts
mcp-server/tests/security/pathGuard.test.ts
mcp-server/tests/security/permissions.test.ts
mcp-server/tests/security/backup.test.ts
mcp-server/tests/sceneTools.test.ts
mcp-server/tests/nodeTools.test.ts
mcp-server/tests/scriptTools.test.ts
mcp-server/tests/modes.test.ts
```

## 12.2 Godot/GDScript

```text
tests/godot/core_test.gd
tests/godot/permissions_test.gd
tests/godot/project_tools_test.gd
tests/godot/phase4_test.gd
tests/godot/script_tools_test.gd
tests/godot/phase5_test.gd
```

## 12.3 Comandos esperados

```bash
cd mcp-server
npm test
npm run build
```

```bash
godot --headless --path . --script tests/godot/phase4_test.gd
godot --headless --path . --script tests/godot/phase5_test.gd
godot --headless --path . --script tests/godot/permissions_test.gd
godot --headless --editor --quit --path .
```

---

# 13. Relatório de evidências

Preencher ao final da validação.

## 13.1 Ambiente

```text
Sistema operacional:
Godot version:
Node.js version:
npm/pnpm/yarn version:
Cliente MCP usado:
Modo MCP:
Data da validação:
Responsável:
```

## 13.2 Resultados dos comandos

```text
npm run build:
npm test:
godot headless plugin compile:
godot phase4_test:
godot phase5_test:
fluxo WebSocket prático:
Ctrl+Z GUI:
```

## 13.3 Ferramentas validadas

```text
Core:
[ ] godot_health_check
[ ] godot_ping
[ ] godot_get_capabilities
[ ] godot_get_connection_status
[ ] godot_get_protocol_version

Project:
[ ] godot_get_project_info
[ ] godot_get_project_settings
[ ] godot_get_godot_version
[ ] godot_get_editor_context
[ ] godot_get_open_scenes
[ ] godot_get_selected_nodes
[ ] godot_get_input_map
[ ] godot_add_input_action
[ ] godot_remove_input_action
[ ] godot_get_autoloads
[ ] godot_add_autoload
[ ] godot_remove_autoload

Scene:
[ ] godot_create_scene
[ ] godot_open_scene
[ ] godot_save_scene
[ ] godot_duplicate_scene
[ ] godot_get_scene_tree
[ ] godot_get_scene_summary
[ ] godot_validate_scene
[ ] godot_audit_scene

Node:
[ ] godot_add_node
[ ] godot_remove_node
[ ] godot_rename_node
[ ] godot_duplicate_node
[ ] godot_reparent_node
[ ] godot_get_node_properties
[ ] godot_set_node_property
[ ] godot_get_node_groups
[ ] godot_add_node_to_group
[ ] godot_remove_node_from_group

Script:
[ ] godot_create_script
[ ] godot_read_script
[ ] godot_patch_script
[ ] godot_attach_script
[ ] godot_validate_script
[ ] godot_get_classdb_info
[ ] godot_get_script_symbols
[ ] godot_get_script_dependencies
[ ] godot_find_references
[ ] godot_format_script
```

---

# 14. Pendências permitidas antes da Fase 6

Algumas pendências podem ser aceitas sem bloquear a Fase 6, desde que documentadas:

```text
[ ] Ctrl+Z GUI ainda não validado, mas UndoRedo headless passou.
[ ] format_script ainda não implementado, se Fase 5.2 foi separada.
[ ] get_script_dependencies limitado a padrões simples.
[ ] find_references limitado a busca textual inicial.
[ ] audit_scene cobre apenas checks estruturais básicos.
[ ] save_scene sem scene_path explícito não cria backup server-side.
```

Essas pendências devem virar issues antes da versão 1.0.

---

# 15. Pendências bloqueantes antes da Fase 6

As pendências abaixo devem bloquear avanço:

```text
[ ] health_check falha.
[ ] plugin não compila.
[ ] npm run build falha.
[ ] npm test falha em core/security.
[ ] path sandbox permite traversal.
[ ] read-only permite mutação.
[ ] dry_run altera estado real.
[ ] backups obrigatórios não são criados.
[ ] add_node/set_property não usam UndoRedo.
[ ] create_scene/open_scene/save_scene não funcionam.
[ ] create_script/read_script/patch_script não funcionam.
[ ] attach_script não usa UndoRedo.
[ ] validate_script não detecta script inválido.
[ ] erros não seguem padrão ok/error.
[ ] logs não são registrados.
```

---

# 16. Gate para iniciar Fase 6 — Debug Loop

Só iniciar a Fase 6 se:

```text
[ ] Fase 0 aprovada.
[ ] Fase 1 aprovada.
[ ] Fase 2 aprovada.
[ ] Fase 3 aprovada.
[ ] Fase 4 aprovada ou aprovada com ressalva não bloqueante.
[ ] Fase 5 aprovada ou Fase 5.1 aprovada com Fase 5.2 planejada.
[ ] Teste integrado Fases 0 a 5 passou.
[ ] Pendências bloqueantes estão zeradas.
[ ] Issues foram abertas para pendências não bloqueantes.
```

## 16.1 Decisão final

```text
[ ] Autorizado iniciar Fase 6
[ ] Não autorizado iniciar Fase 6
[ ] Autorizado iniciar Fase 6 com ressalvas
```

Ressalvas:

```text
-
```

---

# 17. Prompt recomendado para pedir validação à IA implementadora

Use este prompt no ambiente onde o código está sendo desenvolvido:

```text
Revise a implementação atual do Godot DevPilot MCP contra o documento docs/PHASE_0_TO_5_VALIDATION.md.

Gere um relatório chamado docs/PHASE_0_TO_5_VALIDATION_REPORT.md contendo:

1. Status da Fase 0
2. Status da Fase 1
3. Status da Fase 2
4. Status da Fase 3
5. Status da Fase 4
6. Status da Fase 5
7. Ferramentas implementadas por fase
8. Ferramentas pendentes por fase
9. Testes executados
10. Saída resumida dos testes
11. Pendências bloqueantes
12. Pendências não bloqueantes
13. Issues recomendadas
14. Decisão: pode ou não iniciar Fase 6

Não implemente a Fase 6 ainda.
Apenas valide as Fases 0 a 5.
```

---

# 18. Conclusão

Este documento serve como gate formal antes da Fase 6.

Até a Fase 5, o Godot DevPilot MCP deve ter uma base sólida para:

```text
- comunicação MCP;
- plugin Godot;
- segurança;
- contexto de projeto;
- cenas;
- nós;
- UndoRedo;
- scripts;
- validação GDScript.
```

A Fase 6 adicionará runtime/debug loop. Por isso, é importante não avançar se a base ainda estiver instável.

Regra final:

```text
Não iniciar runtime/debug loop enquanto cenas, nós, scripts, segurança e logs não estiverem confiáveis.
```

