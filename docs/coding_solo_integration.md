# Coding-Solo Integration — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento descreve como incorporar ao **Godot DevPilot MCP** as ideias e capacidades públicas do projeto `Coding-Solo/godot-mcp`, sem alterar a documentação já existente.

O objetivo não é substituir a arquitetura atual do Godot DevPilot MCP. O objetivo é adicionar uma camada complementar inspirada no `Coding-Solo/godot-mcp`, especialmente para:

- Execução externa via Godot CLI;
- Detecção do executável da Godot;
- Abertura do editor;
- Execução de projetos;
- Captura de output/debug;
- Operações batch com GDScript;
- Descoberta de projetos;
- Operações úteis fora do editor já aberto.

Este documento deve ser tratado como uma especificação adicional e independente.

---

## 2. Contexto

O Godot DevPilot MCP foi inicialmente planejado com foco em uma arquitetura baseada em plugin ativo dentro do editor Godot:

```text
AI Client
    ↓ MCP stdio
MCP Server TypeScript
    ↓ WebSocket / JSON-RPC
Godot Editor Plugin
    ↓
EditorInterface / cenas / nós / scripts / runtime
```

Essa arquitetura é adequada para interagir com o estado vivo do editor.

O projeto `Coding-Solo/godot-mcp`, por outro lado, destaca uma abordagem mais externa, baseada no controle da Godot por meio do executável da engine e scripts auxiliares.

Essa abordagem é útil para:

```text
- abrir o editor automaticamente;
- rodar projetos mesmo sem plugin ativo;
- capturar stdout/stderr;
- executar operações batch;
- automatizar testes fora do editor;
- encontrar projetos Godot em diretórios;
- executar comandos em ambientes de CI ou automação local.
```

Portanto, a decisão recomendada é transformar o Godot DevPilot MCP em uma arquitetura híbrida:

```text
Editor Bridge + CLI Bridge + Runtime Bridge + Intelligence Layer
```

---

## 3. O que o Coding-Solo/godot-mcp adiciona ao nosso mapa

## 3.1 Categoria técnica

O `Coding-Solo/godot-mcp` pertence principalmente à categoria:

```text
External CLI MCP Bridge
```

Isto significa que ele não depende exclusivamente de um plugin dentro do editor para ser útil. Ele controla a Godot a partir de fora, usando o executável da engine e operações automatizadas.

## 3.2 Capacidades relevantes

Capacidades a considerar para integração conceitual:

```text
- Detectar ou configurar caminho do executável da Godot;
- Obter versão instalada da Godot;
- Abrir o editor Godot para um projeto;
- Rodar projetos em modo debug;
- Parar execução do projeto;
- Capturar output e erros;
- Listar projetos Godot em diretórios;
- Obter informações de projeto;
- Criar cenas por operação externa;
- Adicionar nós por operação externa;
- Carregar sprites/texturas;
- Exportar MeshLibrary para GridMap;
- Gerenciar UIDs em Godot 4.4+;
- Usar variáveis como GODOT_PATH e DEBUG;
- Operar via configuração MCP simples em clientes como Cursor/Cline.
```

## 3.3 Valor estratégico

A camada inspirada no Coding-Solo resolve um problema importante:

```text
Nem sempre o editor Godot estará aberto ou o plugin estará ativo.
```

Com uma CLI Bridge, o MCP pode:

```text
1. encontrar o executável da Godot;
2. abrir o editor;
3. rodar o projeto;
4. capturar erros;
5. executar operações batch;
6. funcionar parcialmente mesmo sem editor bridge disponível.
```

---

## 4. Decisão arquitetural

## 4.1 Não substituir o Editor Bridge

A camada CLI não deve substituir o plugin Godot.

O Editor Bridge continua sendo necessário para:

```text
- ler cena atualmente aberta;
- acessar seleção atual;
- usar EditorInterface;
- usar UndoRedo;
- manipular nós com contexto do editor;
- capturar estado visual do editor;
- interagir com docks/painéis;
- operar com contexto vivo.
```

## 4.2 Adicionar CLI Bridge como camada complementar

A nova arquitetura deve ficar assim:

```text
AI Client
    ↓
MCP Server
    ├── Editor Bridge Client
    │       ↓ WebSocket / JSON-RPC
    │   Godot Editor Plugin
    │
    ├── CLI Bridge Client
    │       ↓ Process execution
    │   Godot Executable
    │
    ├── Runtime Bridge
    ├── Safety Layer
    ├── Project Indexer
    └── Agentic Orchestrator
```

## 4.3 Regra de escolha de bridge

O servidor MCP deve decidir qual bridge usar com base no tipo de operação.

```text
Operações de editor vivo        → Editor Bridge
Operações de execução externa   → CLI Bridge
Operações de runtime vivo       → Runtime Bridge
Operações batch                 → CLI Bridge ou Editor Bridge, dependendo do contexto
Operações seguras com UndoRedo  → Preferir Editor Bridge
Operações em CI                 → Preferir CLI Bridge
```

---

## 5. Quando usar Editor Bridge vs CLI Bridge

## 5.1 Usar Editor Bridge quando

```text
- o editor está aberto;
- o plugin está conectado;
- a operação depende da cena aberta;
- a operação precisa de UndoRedo;
- a operação depende de nós selecionados;
- a operação altera propriedades do editor;
- a operação precisa capturar estado visual do editor;
- a operação precisa inspecionar contexto atual.
```

Exemplos:

```text
godot_get_editor_context
godot_get_selected_nodes
godot_add_node
godot_set_node_property
godot_attach_script
godot_connect_signal
godot_take_editor_screenshot
```

## 5.2 Usar CLI Bridge quando

```text
- o editor não está aberto;
- é necessário abrir a Godot;
- é necessário rodar projeto externamente;
- é necessário capturar stdout/stderr;
- é necessário listar projetos em uma pasta;
- é necessário executar operação batch;
- é necessário rodar em CI;
- é necessário testar sem interação visual do editor.
```

Exemplos:

```text
godot_detect_executable
godot_launch_editor
godot_run_project_cli
godot_stop_project_cli
godot_get_cli_output
godot_list_projects
godot_run_batch_operation
```

## 5.3 Usar Runtime Bridge quando

```text
- o jogo está rodando;
- é necessário ler runtime tree;
- é necessário inspecionar propriedades em runtime;
- é necessário simular input;
- é necessário capturar screenshot do jogo;
- é necessário aguardar uma condição do jogo.
```

---

## 6. Novos módulos propostos

## 6.1 `cli/` no servidor MCP

Adicionar no servidor:

```text
mcp-server/src/cli/
├── godotExecutable.ts
├── godotProcess.ts
├── cliBridge.ts
├── projectDiscovery.ts
├── outputCapture.ts
├── batchRunner.ts
└── uidManager.ts
```

### Responsabilidades

```text
- localizar executável da Godot;
- validar GODOT_PATH;
- abrir editor;
- rodar projeto;
- parar processo;
- capturar output;
- executar scripts batch;
- descobrir projetos;
- gerenciar operações específicas de UID.
```

## 6.2 `bridges/` no servidor MCP

Adicionar camada abstrata:

```text
mcp-server/src/bridges/
├── bridgeTypes.ts
├── bridgeRouter.ts
├── editorBridge.ts
├── cliBridge.ts
└── runtimeBridge.ts
```

### Responsabilidade do `bridgeRouter`

Escolher automaticamente a melhor bridge:

```text
- se editor conectado, usar Editor Bridge para operações de editor;
- se editor não conectado, sugerir CLI Bridge;
- se operação for run_project, permitir CLI ou Editor;
- se operação exigir UndoRedo, não usar CLI;
- se operação for batch e segura, permitir CLI.
```

## 6.3 `batch/` para scripts auxiliares

Adicionar scripts GDScript batch:

```text
addons/godot_devpilot_mcp/batch/
├── batch_operations.gd
├── create_scene_batch.gd
├── add_node_batch.gd
├── load_sprite_batch.gd
├── export_mesh_library_batch.gd
└── uid_tools_batch.gd
```

Esses scripts podem ser executados pela Godot via CLI para tarefas específicas.

---

## 7. Ferramentas novas propostas

## 7.1 CLI Core Tools

```text
godot_detect_executable
godot_get_cli_version
godot_set_executable_path
godot_get_executable_path
godot_validate_executable_path
```

### `godot_detect_executable`

Detecta o executável da Godot no sistema.

Entrada:

```json
{}
```

Saída esperada:

```json
{
  "ok": true,
  "data": {
    "found": true,
    "path": "C:/Program Files/Godot/Godot_v4.2.2.exe",
    "version": "4.2.2"
  },
  "message": "Executável da Godot encontrado.",
  "warnings": [],
  "suggestions": []
}
```

## 7.2 CLI Project Tools

```text
godot_launch_editor
godot_list_projects
godot_get_project_info_cli
godot_validate_project_path
godot_open_project_cli
```

### `godot_launch_editor`

Abre o editor Godot em um projeto específico.

Entrada:

```json
{
  "project_path": "C:/Projects/MyGame",
  "wait_for_plugin": true,
  "timeout_ms": 15000
}
```

Saída esperada:

```json
{
  "ok": true,
  "data": {
    "launched": true,
    "pid": 12345,
    "project_path": "C:/Projects/MyGame",
    "plugin_connected": true
  },
  "message": "Editor Godot iniciado.",
  "warnings": [],
  "suggestions": []
}
```

## 7.3 CLI Runtime Tools

```text
godot_run_project_cli
godot_run_scene_cli
godot_stop_project_cli
godot_get_cli_output
godot_clear_cli_output
godot_get_process_status
godot_wait_for_process_exit
```

### `godot_run_project_cli`

Executa projeto via CLI.

Entrada:

```json
{
  "project_path": "C:/Projects/MyGame",
  "debug": true,
  "capture_output": true,
  "timeout_ms": 60000
}
```

Saída esperada:

```json
{
  "ok": true,
  "data": {
    "running": true,
    "pid": 45678,
    "output_capture": true
  },
  "message": "Projeto iniciado via CLI.",
  "warnings": [],
  "suggestions": [
    "Use godot_get_cli_output para ler logs da execução."
  ]
}
```

## 7.4 Batch Operation Tools

```text
godot_run_batch_operation
godot_create_scene_batch
godot_add_node_batch
godot_load_sprite_batch
godot_export_mesh_library_batch
godot_get_uid
godot_update_project_uids
```

### `godot_run_batch_operation`

Executa uma operação batch por GDScript via CLI.

Entrada:

```json
{
  "project_path": "C:/Projects/MyGame",
  "operation": "create_scene",
  "params": {
    "scene_path": "res://scenes/Player.tscn",
    "root_type": "CharacterBody2D",
    "root_name": "Player"
  },
  "dry_run": false
}
```

Saída esperada:

```json
{
  "ok": true,
  "data": {
    "operation": "create_scene",
    "applied": true,
    "affected_files": [
      "res://scenes/Player.tscn"
    ]
  },
  "message": "Operação batch executada com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

## 7.5 Bridge Coordination Tools

```text
godot_get_bridge_status
godot_choose_best_bridge
godot_sync_editor_and_cli_state
godot_fallback_to_cli
godot_fallback_to_editor
```

### `godot_get_bridge_status`

Retorna o status das bridges disponíveis.

Saída esperada:

```json
{
  "ok": true,
  "data": {
    "editor_bridge": {
      "available": true,
      "connected": true
    },
    "cli_bridge": {
      "available": true,
      "godot_path": "C:/Program Files/Godot/Godot.exe"
    },
    "runtime_bridge": {
      "available": true,
      "running": false
    }
  },
  "message": "Status das bridges obtido.",
  "warnings": [],
  "suggestions": []
}
```

---

## 8. Segurança para CLI Bridge

A CLI Bridge precisa seguir as mesmas regras do restante do sistema.

## 8.1 Path sandbox

Operações CLI devem validar:

```text
- project_path existe;
- project_path contém project.godot;
- paths res:// resolvem dentro do projeto;
- paths absolutos externos são bloqueados;
- scripts batch só operam dentro do projeto.
```

## 8.2 GODOT_PATH

`GODOT_PATH` deve ser validado.

Regras:

```text
- deve apontar para executável existente;
- deve ser arquivo executável;
- deve responder comando de versão;
- deve ser armazenado apenas em configuração local;
- não deve ser inferido de path enviado pela IA sem validação.
```

## 8.3 Execução de processos

Regras:

```text
- não executar shell arbitrário;
- usar spawn/execFile com argumentos separados;
- não concatenar comandos em string;
- limitar timeout;
- capturar stdout/stderr;
- registrar pid;
- permitir stop controlado;
- bloquear argumentos não permitidos.
```

## 8.4 Batch scripts

Regras:

```text
- scripts batch devem ser internos ao projeto MCP;
- operação deve ser allowlisted;
- params devem ser validados;
- dry_run deve ser suportado em operações mutáveis;
- backup deve ser criado antes de alterar arquivos;
- não aceitar GDScript arbitrário gerado pela IA para execução direta no MVP.
```

## 8.5 Logs

Toda operação CLI deve registrar:

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "bridge": "cli",
  "tool": "godot_run_project_cli",
  "project_path": "C:/Projects/MyGame",
  "pid": 45678,
  "status": "ok",
  "duration_ms": 120
}
```

---

## 9. Fallback entre bridges

## 9.1 Caso o Editor Bridge esteja indisponível

Se o usuário pedir:

```text
Abra o projeto e rode a cena principal.
```

Fluxo recomendado:

```text
1. godot_get_bridge_status
2. se editor_bridge indisponível:
   - godot_detect_executable
   - godot_launch_editor
   - aguardar plugin conectar
3. se plugin não conectar:
   - godot_run_project_cli
   - godot_get_cli_output
```

## 9.2 Caso a operação precise de UndoRedo

Se a operação exigir UndoRedo:

```text
- usar Editor Bridge;
- se Editor Bridge indisponível, não fazer fallback automático para CLI;
- retornar erro com sugestão de abrir editor/plugin.
```

Exemplo:

```json
{
  "ok": false,
  "error": {
    "code": "EDITOR_BRIDGE_REQUIRED",
    "message": "Esta operação exige Editor Bridge porque precisa de UndoRedo.",
    "details": {
      "tool": "godot_add_node"
    },
    "suggestions": [
      "Abra a Godot e ative o plugin.",
      "Use uma operação batch apenas se aceitar alteração sem UndoRedo."
    ]
  }
}
```

## 9.3 Caso a operação seja de execução/teste

Para run/test/debug, pode usar CLI Bridge:

```text
- run_project_cli;
- capture_output;
- parse errors;
- stop_project_cli.
```

---

## 10. Integração com fases do roadmap

Como este documento não altera o roadmap existente, a integração pode ser tratada como uma extensão paralela.

## 10.1 Nova Fase Complementar — CLI Bridge Foundation

Adicionar após Core MCP ou junto da Fase 1.

Escopo:

```text
- detectar Godot;
- configurar GODOT_PATH;
- obter versão;
- abrir editor;
- capturar status de processo;
- logs básicos.
```

Ferramentas:

```text
godot_detect_executable
godot_get_cli_version
godot_launch_editor
godot_get_bridge_status
```

## 10.2 Nova Fase Complementar — CLI Runtime

Adicionar junto do debug loop.

Escopo:

```text
- run_project_cli;
- run_scene_cli;
- stop_project_cli;
- get_cli_output;
- parse stdout/stderr;
- relatório de execução.
```

## 10.3 Nova Fase Complementar — Batch Operations

Adicionar após segurança e arquivos.

Escopo:

```text
- batch operation runner;
- create_scene_batch;
- add_node_batch;
- load_sprite_batch;
- export_mesh_library_batch;
- UID tools.
```

---

## 11. Ordem de implementação recomendada

## 11.1 Etapa 1 — Modelar CLI Bridge

Criar:

```text
mcp-server/src/cli/godotExecutable.ts
mcp-server/src/cli/godotProcess.ts
mcp-server/src/cli/cliBridge.ts
mcp-server/src/bridges/bridgeRouter.ts
```

Implementar:

```text
godot_detect_executable
godot_get_cli_version
godot_get_bridge_status
```

## 11.2 Etapa 2 — Launch editor

Implementar:

```text
godot_launch_editor
godot_get_process_status
```

Critério:

```text
A IA consegue abrir a Godot em um projeto usando GODOT_PATH validado.
```

## 11.3 Etapa 3 — Run project e output

Implementar:

```text
godot_run_project_cli
godot_stop_project_cli
godot_get_cli_output
```

Critério:

```text
A IA consegue rodar projeto via CLI e capturar erros.
```

## 11.4 Etapa 4 — Batch operations seguras

Implementar:

```text
godot_run_batch_operation
```

Com allowlist inicial:

```text
create_scene
add_node
load_sprite
save_scene
```

Critério:

```text
Nenhuma operação batch executa código arbitrário da IA.
```

---

## 12. Contrato das CLI Bridge Tools

Todas as ferramentas CLI devem retornar resposta padrão:

```json
{
  "ok": true,
  "data": {},
  "message": "Operação concluída.",
  "warnings": [],
  "suggestions": []
}
```

Erros específicos:

```text
GODOT_EXECUTABLE_NOT_FOUND
GODOT_EXECUTABLE_INVALID
PROJECT_PATH_INVALID
PROJECT_GODOT_NOT_FOUND
CLI_PROCESS_FAILED
CLI_PROCESS_TIMEOUT
CLI_OUTPUT_UNAVAILABLE
BATCH_OPERATION_NOT_ALLOWED
BATCH_OPERATION_FAILED
EDITOR_BRIDGE_REQUIRED
CLI_BRIDGE_UNAVAILABLE
```

---

## 13. Arquivos de configuração

## 13.1 Variáveis de ambiente

```text
GODOT_PATH
GODOT_MCP_CLI_ENABLED
GODOT_MCP_CLI_TIMEOUT_MS
GODOT_MCP_CAPTURE_OUTPUT
GODOT_MCP_DEBUG
```

## 13.2 Exemplo

```json
{
  "env": {
    "GODOT_PATH": "C:/Program Files/Godot/Godot_v4.2.2.exe",
    "GODOT_MCP_CLI_ENABLED": "true",
    "GODOT_MCP_CLI_TIMEOUT_MS": "60000",
    "GODOT_MCP_CAPTURE_OUTPUT": "true"
  }
}
```

## 13.3 Arquivo local opcional

```text
.godot_mcp/config.json
```

Exemplo:

```json
{
  "cliBridge": {
    "enabled": true,
    "godotPath": "C:/Program Files/Godot/Godot_v4.2.2.exe",
    "defaultTimeoutMs": 60000,
    "captureOutput": true
  }
}
```

---

## 14. Cuidados jurídicos e de implementação

Este documento descreve integração conceitual e funcional.

Regras:

```text
- não copiar código fechado;
- não copiar prompts privados;
- não copiar binários;
- não copiar assets;
- usar apenas ideias públicas e APIs documentadas;
- se usar código open source diretamente, respeitar a licença;
- manter implementação própria quando possível.
```

Se alguma parte do `Coding-Solo/godot-mcp` for reutilizada diretamente, registrar:

```text
- arquivo original;
- licença;
- autor;
- modificação feita;
- compatibilidade com a licença do Godot DevPilot MCP.
```

---

## 15. Benefício final para o Godot DevPilot MCP

Com a integração da abordagem Coding-Solo, o projeto passa a ter duas pernas:

```text
Editor Bridge — trabalha dentro do editor com contexto vivo e UndoRedo.
CLI Bridge    — controla Godot externamente, roda projetos e captura output.
```

Isso permite fluxos mais fortes:

```text
1. IA detecta Godot instalada.
2. IA abre editor se necessário.
3. IA conecta ao plugin.
4. IA usa Editor Bridge para editar com UndoRedo.
5. IA usa CLI Bridge para rodar e capturar output.
6. IA usa Runtime Bridge para inspecionar jogo.
7. IA gera relatório e próximos passos.
```

Resultado esperado:

```text
Godot DevPilot MCP deixa de ser apenas um MCP de editor e passa a ser uma plataforma híbrida de automação, execução, debug e desenvolvimento assistido por IA para Godot.
```

---

## 16. Conclusão

A abordagem do `Coding-Solo/godot-mcp` deve ser integrada como uma camada complementar chamada **CLI Bridge**.

Ela adiciona capacidades importantes que o plugin sozinho não cobre bem:

```text
- abrir Godot;
- detectar executável;
- rodar projeto;
- capturar output;
- operar em batch;
- funcionar em automação externa;
- apoiar debug loop e CI.
```

A recomendação final é:

```text
Manter este documento como especificação complementar.
Registrar qualquer mudança futura em documentos de fase/status.
Implementar a CLI Bridge somente depois da base de segurança da Fase 2.
Priorizar primeiro detecção de executável e status de bridge.
Adiar execução de processos, batch operations e UID tools até existirem path sandbox, logs, permissões e timeouts.
```

## 17. Status de integração no roadmap atual

Esta especificação não substitui as fases existentes. Ela cria uma trilha complementar que deve ser encaixada linearmente assim:

```text
Fase 1 concluída
    ↓
Fase 2 segurança mínima
    ↓
CLI Bridge Foundation
    ↓
CLI Runtime junto do debug loop
    ↓
Batch Operations depois das ferramentas seguras de arquivos/cenas
```

Motivo:

```text
A CLI Bridge executa processos e recebe paths do sistema. Portanto, ela depende diretamente das garantias da Fase 2 antes de expor ferramentas mutáveis ou execução externa.
```
