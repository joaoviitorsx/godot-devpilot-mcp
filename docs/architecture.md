# Architecture — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento descreve a arquitetura técnica do **Godot DevPilot MCP**, uma integração entre assistentes de IA e a engine **Godot** usando o **Model Context Protocol (MCP)**.

O foco é definir:

- Componentes principais;
- Fluxo de comunicação;
- Responsabilidades de cada camada;
- Protocolo interno entre servidor MCP e plugin Godot;
- Estrutura modular do servidor;
- Estrutura modular do plugin;
- Regras arquiteturais para segurança, manutenção e expansão.

---

## 2. Visão geral da arquitetura

A arquitetura é composta por quatro camadas principais:

```text
Cliente de IA
Claude / Cursor / Cline / VS Code / Windsurf
        ↓
Servidor MCP
TypeScript / Node.js / stdio
        ↓
Bridge local
WebSocket / JSON-RPC
        ↓
Plugin Godot
GDScript / EditorPlugin
        ↓
Godot Editor
Cenas / Nós / Scripts / Assets / Runtime / Debugger
```

A IA não acessa a Godot diretamente. Ela chama ferramentas MCP expostas pelo servidor. O servidor valida a chamada, aplica regras de segurança e encaminha a solicitação para o plugin Godot. O plugin executa a ação dentro do editor e retorna uma resposta estruturada.

---

## 3. Componentes principais

## 3.1 Cliente de IA

O cliente de IA é a aplicação onde o usuário conversa com o modelo.

Exemplos:

- Claude Desktop;
- Cursor;
- Cline;
- Windsurf;
- VS Code com extensão MCP;
- Outros clientes compatíveis com MCP.

### Responsabilidades

- Carregar o servidor MCP;
- Exibir ferramentas disponíveis para o modelo;
- Enviar chamadas de ferramentas;
- Receber respostas;
- Permitir que o usuário aprove, revise ou oriente ações da IA.

### Não responsabilidades

O cliente de IA não deve:

- Acessar arquivos Godot diretamente;
- Modificar cenas diretamente;
- Conhecer detalhes internos do plugin;
- Ignorar validações do servidor MCP.

---

## 3.2 Servidor MCP

O servidor MCP é o ponto de entrada técnico para a IA.

Tecnologia recomendada:

```text
TypeScript + Node.js + @modelcontextprotocol/sdk + Zod
```

### Responsabilidades

- Registrar ferramentas MCP;
- Definir nomes, descrições e schemas das ferramentas;
- Validar parâmetros;
- Aplicar políticas de segurança;
- Fazer backup antes de alterações em arquivos;
- Controlar modos de operação;
- Manter conexão com o plugin Godot;
- Transformar chamadas MCP em mensagens JSON-RPC internas;
- Padronizar respostas;
- Registrar logs;
- Manter índice e memória do projeto quando necessário.

### Exemplo de ferramenta MCP

```text
godot_add_node
```

Entrada recebida da IA:

```json
{
  "parent_path": ".",
  "type": "CharacterBody2D",
  "name": "Player"
}
```

Mensagem enviada ao plugin:

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "method": "scene.add_node",
  "params": {
    "parent_path": ".",
    "type": "CharacterBody2D",
    "name": "Player"
  }
}
```

---

## 3.3 Bridge WebSocket

A comunicação entre o servidor MCP e o plugin Godot deve ocorrer por WebSocket local.

Porta padrão:

```text
6505
```

Host padrão:

```text
127.0.0.1
```

### Responsabilidades

- Manter canal bidirecional entre servidor e Godot;
- Permitir chamadas síncronas e assíncronas;
- Transportar mensagens JSON-RPC;
- Permitir heartbeat;
- Permitir reconexão automática;
- Transportar eventos futuros, como logs e status de execução.

### Por que WebSocket?

WebSocket é adequado porque:

- É local;
- É bidirecional;
- Funciona bem com Node.js;
- Pode ser usado pela Godot via GDScript;
- Permite expansão para eventos em tempo real;
- Evita dependência de APIs remotas.

---

## 3.4 Plugin Godot

O plugin roda dentro do editor Godot usando `EditorPlugin`.

Tecnologia recomendada:

```text
GDScript + @tool + EditorPlugin
```

### Responsabilidades

- Iniciar servidor WebSocket local ou aceitar conexão do servidor MCP;
- Receber mensagens JSON-RPC;
- Validar método solicitado;
- Encaminhar método para o handler correto;
- Usar APIs da Godot para executar ações;
- Usar UndoRedo em mutações do editor;
- Acessar cena atual via `EditorInterface`;
- Manipular arquivos `res://` quando apropriado;
- Ler logs, erros e estado do runtime;
- Capturar screenshots;
- Retornar resposta padronizada.

### APIs Godot relevantes

```text
EditorPlugin
EditorInterface
EditorFileSystem
EditorSelection
EditorUndoRedoManager
ProjectSettings
ResourceLoader
ResourceSaver
PackedScene
ClassDB
InputMap
DisplayServer
Viewport
SceneTree
```

---

## 4. Fluxo de chamada de ferramenta

## 4.1 Fluxo básico

```text
Usuário solicita ação
        ↓
IA escolhe ferramenta MCP
        ↓
Cliente MCP chama servidor
        ↓
Servidor valida schema
        ↓
Servidor aplica segurança
        ↓
Servidor envia JSON-RPC ao plugin
        ↓
Plugin executa ação na Godot
        ↓
Plugin retorna resultado
        ↓
Servidor formata resposta MCP
        ↓
IA apresenta resultado ao usuário
```

## 4.2 Exemplo prático: adicionar nó

Pedido do usuário:

```text
Adicione um CharacterBody2D chamado Player na cena atual.
```

Fluxo interno:

```text
1. IA chama godot_add_node
2. Servidor valida type, name e parent_path
3. Servidor envia scene.add_node ao plugin
4. Plugin verifica se existe cena aberta
5. Plugin valida tipo com ClassDB
6. Plugin cria o nó
7. Plugin adiciona com UndoRedo
8. Plugin retorna node_path
9. Servidor retorna resposta para a IA
```

Resposta esperada:

```json
{
  "ok": true,
  "data": {
    "node_path": "Player"
  },
  "message": "Nó CharacterBody2D criado com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

---

## 5. Protocolo interno

## 5.1 Formato de requisição

Toda mensagem entre servidor MCP e plugin Godot deve seguir JSON-RPC 2.0.

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "method": "scene.add_node",
  "params": {
    "parent_path": ".",
    "type": "Node2D",
    "name": "Player"
  }
}
```

## 5.2 Formato de resposta de sucesso

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "result": {
    "ok": true,
    "data": {
      "node_path": "Player"
    },
    "message": "Operação concluída com sucesso.",
    "warnings": [],
    "suggestions": []
  }
}
```

## 5.3 Formato de resposta de erro

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "error": {
    "code": "INVALID_NODE_TYPE",
    "message": "O tipo de nó informado não existe na ClassDB.",
    "details": {
      "type": "CharacterBodi2D"
    },
    "suggestions": [
      "Verifique se o tipo correto é CharacterBody2D."
    ]
  }
}
```

## 5.4 Convenção de métodos internos

Os métodos internos devem usar namespaces por domínio.

```text
project.get_info
file.read
file.write
scene.open
scene.save
scene.add_node
scene.remove_node
node.set_property
script.validate
runtime.run_project
runtime.get_errors
screenshot.take_game
input.press_action
signal.connect
analysis.dependency_graph
```

Essa separação evita colisão de nomes e facilita roteamento no dispatcher do plugin.

---

## 6. Estrutura do servidor MCP

## 6.1 Estrutura recomendada

```text
mcp-server/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── config.ts
│   │   └── modes.ts
│   ├── godot/
│   │   ├── client.ts
│   │   ├── connection.ts
│   │   ├── protocol.ts
│   │   └── schemas.ts
│   ├── tools/
│   │   ├── projectTools.ts
│   │   ├── fileTools.ts
│   │   ├── sceneTools.ts
│   │   ├── nodeTools.ts
│   │   ├── scriptTools.ts
│   │   ├── runtimeTools.ts
│   │   ├── screenshotTools.ts
│   │   ├── inputTools.ts
│   │   ├── signalTools.ts
│   │   └── agenticTools.ts
│   ├── safety/
│   │   ├── pathGuard.ts
│   │   ├── permissions.ts
│   │   ├── backup.ts
│   │   └── dryRun.ts
│   ├── indexer/
│   │   ├── projectIndexer.ts
│   │   ├── sceneIndexer.ts
│   │   ├── scriptIndexer.ts
│   │   └── dependencyGraph.ts
│   ├── memory/
│   │   ├── memoryStore.ts
│   │   ├── projectSummary.ts
│   │   └── decisionRecords.ts
│   └── utils/
│       ├── logger.ts
│       └── errors.ts
└── package.json
```

## 6.2 Responsabilidade dos módulos

### `index.ts`

Ponto de entrada do servidor.

Responsável por:

- Carregar configuração;
- Criar instância MCP;
- Registrar ferramentas conforme modo;
- Iniciar transporte stdio;
- Inicializar cliente Godot.

### `godot/client.ts`

Cliente responsável por chamar o plugin Godot.

Responsável por:

- Enviar mensagens JSON-RPC;
- Aguardar resposta;
- Controlar timeout;
- Tratar desconexões;
- Padronizar erros de conexão.

### `godot/protocol.ts`

Define tipos e helpers do protocolo interno.

Contém:

- Tipos de request;
- Tipos de response;
- Gerador de IDs;
- Normalização de erro;
- Validação de envelopes JSON-RPC.

### `tools/*.ts`

Cada arquivo registra um grupo de ferramentas MCP.

Exemplo:

```text
sceneTools.ts
```

Registra:

```text
godot_create_scene
godot_open_scene
godot_save_scene
godot_get_scene_tree
godot_add_node
godot_remove_node
```

### `safety/*`

Camada de proteção executada antes de chamadas de risco.

Responsável por:

- Validar paths;
- Bloquear acesso fora do projeto;
- Criar backup;
- Aplicar modo read-only;
- Avaliar permissões por ferramenta;
- Implementar `dry_run`.

### `indexer/*`

Camada responsável por mapear projeto.

Responsável por:

- Indexar scripts;
- Indexar cenas;
- Indexar assets;
- Construir grafo de dependências;
- Atualizar cache local.

### `memory/*`

Camada persistente de contexto.

Responsável por:

- Guardar resumo do projeto;
- Guardar decisões técnicas;
- Guardar convenções;
- Guardar histórico de sistemas de gameplay;
- Fornecer contexto compacto para IA.

---

## 7. Estrutura do plugin Godot

## 7.1 Estrutura recomendada

```text
addons/godot_devpilot_mcp/
├── plugin.cfg
├── plugin.gd
├── core/
│   ├── rpc_server.gd
│   ├── dispatcher.gd
│   ├── protocol.gd
│   ├── response_factory.gd
│   ├── permissions.gd
│   └── undo_service.gd
├── tools/
│   ├── project_tools.gd
│   ├── file_tools.gd
│   ├── scene_tools.gd
│   ├── node_tools.gd
│   ├── script_tools.gd
│   ├── signal_tools.gd
│   ├── runtime_tools.gd
│   ├── screenshot_tools.gd
│   └── input_tools.gd
├── analyzers/
│   ├── scene_analyzer.gd
│   ├── script_analyzer.gd
│   ├── signal_analyzer.gd
│   └── dependency_analyzer.gd
└── ui/
    ├── status_dock.gd
    └── action_log_panel.gd
```

## 7.2 `plugin.gd`

Arquivo principal do plugin.

Responsável por:

- Entrar e sair da árvore do editor;
- Inicializar o servidor RPC;
- Registrar dock/painel visual;
- Controlar status do plugin;
- Delegar lógica para módulos internos.

Não deve conter lógica extensa de ferramentas.

## 7.3 `rpc_server.gd`

Responsável pela conexão WebSocket.

Funções principais:

- Iniciar servidor;
- Aceitar conexão;
- Receber mensagens;
- Enviar respostas;
- Emitir eventos de status;
- Controlar heartbeat.

## 7.4 `dispatcher.gd`

Responsável por rotear métodos internos.

Exemplo:

```text
scene.add_node → SceneTools.add_node
file.read → FileTools.read_file
runtime.run_project → RuntimeTools.run_project
```

## 7.5 `protocol.gd`

Responsável por validar envelopes JSON-RPC.

Deve verificar:

- Se existe `jsonrpc`;
- Se existe `id`;
- Se existe `method`;
- Se `params` é válido;
- Se o método é suportado.

## 7.6 `response_factory.gd`

Responsável por criar respostas padronizadas.

Exemplos:

```text
success(data, message, warnings, suggestions)
error(code, message, details, suggestions)
```

## 7.7 `undo_service.gd`

Responsável por encapsular operações com `EditorUndoRedoManager`.

Deve fornecer métodos como:

```text
create_node_action
remove_node_action
set_property_action
rename_node_action
attach_script_action
connect_signal_action
```

## 7.8 `tools/*.gd`

Cada arquivo implementa operações de um domínio.

Exemplo:

```text
scene_tools.gd
```

Responsável por:

- Criar cena;
- Abrir cena;
- Salvar cena;
- Obter árvore da cena;
- Validar cena.

---

## 8. Modos de operação

O servidor MCP deve permitir carregar subconjuntos de ferramentas.

## 8.1 Minimal

Modo com ferramentas essenciais.

Uso:

```bash
node dist/index.js --mode minimal
```

Objetivo:

- Reduzir quantidade de ferramentas;
- Melhorar compatibilidade com clientes limitados;
- Focar em leitura, edição básica e debug.

## 8.2 Core

Modo recomendado para desenvolvimento diário.

Inclui:

- Projeto;
- Arquivos;
- Cenas;
- Nós;
- Scripts;
- Runtime;
- Debug;
- Screenshots;
- Input básico;
- Signals básicos.

## 8.3 Full

Modo com todas as ferramentas individuais.

Inclui:

- Toolkits 2D e 3D;
- Física;
- Animação;
- Áudio;
- Partículas;
- Shaders;
- Navegação;
- Testes;
- Análise estrutural.

## 8.4 Agentic

Modo com ferramentas compostas.

Exemplos:

```text
godot_build_feature
godot_fix_errors
godot_create_gameplay_system
godot_refactor_safely
godot_run_validation_loop
```

Essas ferramentas coordenam várias ferramentas menores internamente.

---

## 9. Segurança na arquitetura

A segurança deve ser aplicada em duas camadas.

## 9.1 Segurança no servidor MCP

O servidor deve validar antes de chamar o plugin.

Responsabilidades:

- Validar schema;
- Validar paths;
- Bloquear acesso fora do projeto;
- Aplicar modo read-only;
- Criar backup antes de escrita;
- Bloquear ferramentas críticas sem permissão;
- Implementar `dry_run`.

## 9.2 Segurança no plugin Godot

O plugin também deve validar, mesmo que o servidor já tenha validado.

Responsabilidades:

- Revalidar método;
- Revalidar path `res://`;
- Revalidar tipo de nó via ClassDB;
- Revalidar existência de cena aberta;
- Revalidar existência de nó antes de alterar;
- Usar UndoRedo em mutações;
- Retornar erro acionável.

## 9.3 Princípio arquitetural

Nenhuma camada deve confiar totalmente na anterior.

```text
IA não é confiável.
Cliente MCP não é confiável.
Servidor valida.
Plugin revalida.
Godot executa somente ações permitidas.
```

---

## 10. Sistema de logs

## 10.1 Logs do servidor

O servidor deve registrar chamadas de ferramentas.

Exemplo:

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "source": "mcp-server",
  "tool": "godot_add_node",
  "params": {
    "parent_path": ".",
    "type": "CharacterBody2D",
    "name": "Player"
  },
  "result": "ok",
  "duration_ms": 38
}
```

## 10.2 Logs do plugin

O plugin deve registrar ações executadas na Godot.

Exemplo:

```json
{
  "timestamp": "2026-05-03T12:00:00.045Z",
  "source": "godot-plugin",
  "method": "scene.add_node",
  "status": "ok",
  "details": {
    "node_path": "Player"
  }
}
```

## 10.3 Local sugerido

```text
.godot_mcp/logs/actions.jsonl
```

---

## 11. Sistema de backup

Antes de qualquer alteração em arquivo existente, o servidor deve criar backup.

Local sugerido:

```text
.godot_mcp/backups/YYYY-MM-DD/
```

Exemplo:

```text
.godot_mcp/backups/2026-05-03/scripts/Player.gd.120000.bak
```

Arquivos que devem gerar backup:

```text
.gd
.tscn
.tres
.res
.cfg
.import
```

Ferramentas afetadas:

```text
godot_write_file
godot_patch_file
godot_delete_file_safe
godot_rename_file
godot_move_file
godot_save_scene
```

---

## 12. Indexador e memória

## 12.1 Indexador

O indexador deve criar uma visão estrutural do projeto.

Arquivos sugeridos:

```text
.godot_mcp/index/scripts.json
.godot_mcp/index/scenes.json
.godot_mcp/index/assets.json
.godot_mcp/index/signals.json
.godot_mcp/index/dependencies.json
```

## 12.2 Memória do projeto

A memória deve guardar contexto textual útil para a IA.

Arquivos sugeridos:

```text
.godot_mcp/memory/project_summary.md
.godot_mcp/memory/architecture.md
.godot_mcp/memory/conventions.md
.godot_mcp/memory/decisions.md
.godot_mcp/memory/gameplay_systems.md
```

## 12.3 Regra importante

O indexador e a memória devem ser auxiliares. Eles não substituem leitura real dos arquivos quando uma alteração precisa ser feita.

---

## 13. Padrões de erro

## 13.1 Erros comuns

```text
GODOT_NOT_CONNECTED
TIMEOUT
INVALID_PARAMS
METHOD_NOT_FOUND
READ_ONLY_MODE
PATH_OUTSIDE_PROJECT
FILE_NOT_FOUND
SCENE_NOT_OPEN
NODE_NOT_FOUND
INVALID_NODE_TYPE
SCRIPT_PARSE_ERROR
RUNTIME_NOT_RUNNING
PERMISSION_DENIED
BACKUP_FAILED
UNDO_FAILED
```

## 13.2 Regras para mensagens de erro

Toda mensagem de erro deve conter:

- Código estável;
- Mensagem clara;
- Detalhes técnicos opcionais;
- Sugestões acionáveis.

Exemplo:

```json
{
  "code": "SCENE_NOT_OPEN",
  "message": "Nenhuma cena está aberta no editor.",
  "details": {},
  "suggestions": [
    "Abra uma cena no editor antes de adicionar nós.",
    "Use godot_open_scene para abrir uma cena existente."
  ]
}
```

---

## 14. Decisões arquiteturais iniciais

## 14.1 TypeScript no servidor

Motivos:

- Boa compatibilidade com o SDK MCP;
- Validação forte com Zod;
- Facilidade de integração com WebSocket;
- Ecossistema maduro;
- Boa experiência com clientes locais.

## 14.2 GDScript no plugin

Motivos:

- Integração nativa com Godot;
- Acesso direto ao editor;
- Simplicidade para usuários Godot;
- Menor barreira de instalação;
- Compatibilidade com addons.

## 14.3 JSON-RPC no protocolo interno

Motivos:

- Formato simples;
- Suporte a IDs de requisição;
- Boa separação entre sucesso e erro;
- Fácil debug;
- Compatível com mensagens assíncronas futuras.

## 14.4 WebSocket local

Motivos:

- Comunicação bidirecional;
- Baixa complexidade;
- Compatível com Node e Godot;
- Permite eventos em tempo real;
- Evita expor serviço remoto.

## 14.5 UndoRedo como regra

Motivos:

- Reduz risco de alterações irreversíveis;
- Integra com fluxo natural do editor;
- Aumenta confiança do usuário;
- Diferencia o projeto de MCPs simples que alteram diretamente a cena.

---

## 15. Fluxos críticos

## 15.1 Fluxo de conexão

```text
1. Usuário abre Godot.
2. Plugin é ativado.
3. Plugin inicia WebSocket local.
4. Cliente IA inicia servidor MCP.
5. Servidor MCP conecta ao plugin.
6. Servidor executa health check.
7. Ferramentas ficam disponíveis para IA.
```

## 15.2 Fluxo de alteração de arquivo

```text
1. IA chama godot_patch_file.
2. Servidor valida path.
3. Servidor verifica modo read-only.
4. Servidor cria backup.
5. Servidor envia patch ao plugin ou aplica patch localmente.
6. Plugin solicita rescan do filesystem se necessário.
7. Resposta retorna sucesso ou erro.
8. Log é registrado.
```

## 15.3 Fluxo de alteração de cena

```text
1. IA chama ferramenta de cena ou nó.
2. Servidor valida parâmetros.
3. Servidor envia comando ao plugin.
4. Plugin verifica cena aberta.
5. Plugin valida nós e tipos.
6. Plugin executa via UndoRedo.
7. Plugin retorna resultado.
8. Servidor registra log.
```

## 15.4 Fluxo de debug loop

```text
1. IA chama godot_run_scene.
2. Plugin executa cena atual.
3. IA chama godot_get_output_logs.
4. IA chama godot_get_debugger_errors.
5. IA localiza arquivo com erro.
6. IA aplica patch.
7. IA valida script.
8. IA roda novamente.
9. IA confirma ausência de erro.
```

---

## 16. Critérios de qualidade arquitetural

A arquitetura será considerada adequada quando atender aos seguintes critérios:

```text
- Cada camada tem responsabilidade clara.
- O servidor MCP não contém lógica específica demais do editor.
- O plugin Godot não contém lógica de decisão da IA.
- O protocolo interno é estável e versionado.
- Toda ferramenta tem schema validado.
- Toda resposta é padronizada.
- Erros são acionáveis.
- Mutações do editor usam UndoRedo.
- Alterações em arquivos geram backup.
- Acesso fora de res:// é bloqueado.
- Logs permitem auditar ações da IA.
- Novos módulos podem ser adicionados sem reescrever o núcleo.
```

---

## 17. Evolução futura da arquitetura

Possíveis expansões:

- Suporte a múltiplas instâncias da Godot;
- Suporte a múltiplos projetos;
- Painel visual dentro do editor;
- Visualizador web do estado do projeto;
- Eventos em tempo real de logs e erros;
- Integração com testes automatizados;
- Integração com Git;
- Sistema de permissões por workspace;
- Modo remoto seguro via autenticação local;
- Cache incremental do indexador;
- Análise semântica avançada de GDScript.

---

## 18. Resumo

A arquitetura do Godot DevPilot MCP deve seguir uma separação clara:

```text
IA escolhe intenção.
Servidor MCP valida e protege.
Plugin Godot executa.
Editor Godot mantém estado real.
Indexador e memória fornecem contexto.
Logs e backups garantem rastreabilidade.
```

Essa estrutura permite criar uma integração poderosa sem sacrificar segurança, previsibilidade e manutenção.

