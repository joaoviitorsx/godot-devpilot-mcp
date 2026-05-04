# Development Guide — Godot DevPilot MCP

## 1. Objetivo deste documento

Este guia orienta o desenvolvimento técnico do **Godot DevPilot MCP**.

Ele descreve como estruturar, implementar, testar e evoluir o projeto, cobrindo:

- Ambiente de desenvolvimento;
- Estrutura do repositório;
- Servidor MCP em TypeScript;
- Plugin Godot em GDScript;
- Protocolo interno JSON-RPC;
- Implementação de ferramentas;
- Segurança;
- Logs;
- Testes;
- Fluxo recomendado de desenvolvimento.

---

## 2. Requisitos de desenvolvimento

## 2.1 Software necessário

```text
Godot 4.2 ou superior
Node.js 18 ou superior
npm, pnpm ou yarn
Git
Editor de código, preferencialmente VS Code ou Cursor
Cliente MCP compatível, como Claude Desktop, Cursor ou Cline
```

## 2.2 Conhecimentos recomendados

```text
TypeScript
Node.js
Model Context Protocol
GDScript
Godot EditorPlugin
WebSocket
JSON-RPC
Arquitetura de ferramentas para IA
```

## 2.3 Sistemas operacionais alvo

```text
Windows
Linux
macOS
```

No MVP, priorizar Windows e Linux, por serem ambientes comuns de desenvolvimento Godot.

---

## 3. Estrutura geral do projeto

```text
godot-devpilot-mcp/
├── addons/
│   └── godot_devpilot_mcp/
│       ├── plugin.cfg
│       ├── plugin.gd
│       ├── core/
│       ├── tools/
│       ├── analyzers/
│       └── ui/
│
├── mcp-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config/
│   │   ├── godot/
│   │   ├── tools/
│   │   ├── safety/
│   │   ├── indexer/
│   │   ├── memory/
│   │   └── utils/
│   ├── package.json
│   └── tsconfig.json
│
├── visualizer/
├── docs/
├── examples/
└── tests/
```

---

## 4. Ambiente local

## 4.1 Clonar repositório

```bash
 git clone https://github.com/seu-usuario/godot-devpilot-mcp.git
 cd godot-devpilot-mcp
```

## 4.2 Instalar dependências do servidor MCP

```bash
 cd mcp-server
 npm install
```

Ou, se o projeto usar pnpm:

```bash
 cd mcp-server
 pnpm install
```

## 4.3 Rodar servidor em modo desenvolvimento

```bash
 npm run dev
```

Script esperado no `package.json`:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  }
}
```

## 4.4 Ativar plugin na Godot

1. Copiar `addons/godot_devpilot_mcp` para um projeto Godot.
2. Abrir o projeto na Godot.
3. Ir em `Project > Project Settings > Plugins`.
4. Ativar `Godot DevPilot MCP`.
5. Verificar o painel ou output do editor para confirmar a porta WebSocket.

Porta padrão:

```text
6505
```

---

## 5. Servidor MCP

## 5.1 Responsabilidade

O servidor MCP é responsável por:

```text
- Registrar ferramentas MCP;
- Validar entradas com schemas;
- Aplicar segurança;
- Chamar o plugin Godot;
- Padronizar respostas;
- Registrar logs;
- Gerenciar modos de ferramentas;
- Controlar timeouts e conexão.
```

## 5.2 Estrutura recomendada

```text
mcp-server/src/
├── index.ts
├── config/
│   ├── config.ts
│   └── modes.ts
├── godot/
│   ├── client.ts
│   ├── connection.ts
│   ├── protocol.ts
│   └── schemas.ts
├── tools/
├── safety/
├── indexer/
├── memory/
└── utils/
```

## 5.3 `index.ts`

Responsável por iniciar o servidor MCP.

Deve:

```text
1. Carregar configuração.
2. Criar instância MCP.
3. Criar cliente Godot.
4. Registrar ferramentas conforme modo.
5. Iniciar transporte stdio.
```

Exemplo conceitual:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/config";
import { GodotClient } from "./godot/client";
import { registerProjectTools } from "./tools/projectTools";

const config = loadConfig();
const godot = new GodotClient(config.godot);

const server = new McpServer({
  name: "godot-devpilot-mcp",
  version: "0.1.0"
});

registerProjectTools(server, godot, config);

const transport = new StdioServerTransport();
await server.connect(transport);
```

## 5.4 Cliente Godot

O cliente Godot encapsula a comunicação com o plugin.

Responsabilidades:

```text
- Abrir conexão WebSocket;
- Enviar request JSON-RPC;
- Aguardar resposta;
- Controlar timeout;
- Reconnect;
- Normalizar erros.
```

Exemplo conceitual:

```ts
export class GodotClient {
  async call<T>(method: string, params: unknown): Promise<T> {
    const request = createJsonRpcRequest(method, params);
    const response = await this.connection.send(request);
    return normalizeResponse<T>(response);
  }
}
```

---

## 6. Plugin Godot

## 6.1 Responsabilidade

O plugin Godot executa ações reais no editor.

Responsabilidades:

```text
- Receber mensagens do servidor MCP;
- Validar protocolo;
- Roteá-las para handlers;
- Usar APIs da Godot;
- Executar UndoRedo;
- Retornar resposta padronizada;
- Registrar logs locais.
```

## 6.2 Estrutura recomendada

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
│   └── script_tools.gd
└── analyzers/
```

## 6.3 `plugin.gd`

Deve ser pequeno.

Responsabilidades:

```text
- Inicializar o RPC server;
- Registrar painel visual, se existir;
- Encerrar conexão no _exit_tree;
- Delegar lógica para módulos.
```

Exemplo conceitual:

```gdscript
@tool
extends EditorPlugin

var rpc_server

func _enter_tree():
    rpc_server = preload("res://addons/godot_devpilot_mcp/core/rpc_server.gd").new()
    rpc_server.setup(get_editor_interface())
    rpc_server.start(6505)

func _exit_tree():
    if rpc_server:
        rpc_server.stop()
```

## 6.4 Dispatcher

O dispatcher converte métodos internos em chamadas aos módulos.

Exemplo:

```text
project.get_info → ProjectTools.get_info
scene.add_node → NodeTools.add_node
file.read → FileTools.read_file
```

---

## 7. Protocolo interno

## 7.1 Request

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

## 7.2 Success response

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "result": {
    "ok": true,
    "data": {
      "node_path": "Player"
    },
    "message": "Nó criado com sucesso.",
    "warnings": [],
    "suggestions": []
  }
}
```

## 7.3 Error response

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "error": {
    "code": "INVALID_NODE_TYPE",
    "message": "Tipo de nó inválido.",
    "details": {
      "type": "CharactrBody2D"
    },
    "suggestions": [
      "Verifique se o tipo correto é CharacterBody2D."
    ]
  }
}
```

---

## 8. Como implementar uma nova ferramenta

## 8.1 Passo 1 — Definir a ferramenta

Antes de implementar, registrar:

```text
- Nome MCP;
- Descrição;
- Categoria;
- Modo: minimal/core/full/agentic;
- Schema de entrada;
- Resposta esperada;
- Riscos;
- Necessidade de dry_run;
- Necessidade de backup;
- Necessidade de UndoRedo.
```

## 8.2 Passo 2 — Criar schema no servidor

Exemplo com Zod:

```ts
const AddNodeSchema = z.object({
  parent_path: z.string().default("."),
  type: z.string().min(1),
  name: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
  dry_run: z.boolean().default(false)
});
```

## 8.3 Passo 3 — Registrar ferramenta MCP

```ts
server.tool(
  "godot_add_node",
  "Adiciona um nó à cena aberta na Godot.",
  AddNodeSchema.shape,
  async (input) => {
    enforcePermissions("godot_add_node", input, config);

    const result = await godot.call("scene.add_node", input);

    return toMcpResponse(result);
  }
);
```

## 8.4 Passo 4 — Implementar handler no plugin

```gdscript
func add_node(params: Dictionary) -> Dictionary:
    var parent_path = params.get("parent_path", ".")
    var type = params.get("type", "")
    var name = params.get("name", "")

    if not ClassDB.class_exists(type):
        return ResponseFactory.error(
            "INVALID_NODE_TYPE",
            "Tipo de nó inválido.",
            { "type": type },
            ["Verifique o nome da classe na ClassDB."]
        )

    # Executar com UndoRedo
    return UndoService.add_node(parent_path, type, name, params)
```

## 8.5 Passo 5 — Adicionar testes

Testar pelo menos:

```text
- caso de sucesso;
- parâmetro inválido;
- modo read-only;
- dry_run;
- falha de conexão;
- erro retornado pelo plugin.
```

---

## 9. Segurança durante desenvolvimento

## 9.1 Regras obrigatórias

Toda ferramenta mutável deve verificar:

```text
[ ] read-only mode
[ ] permissões
[ ] dry_run, quando aplicável
[ ] backup, quando altera arquivo
[ ] UndoRedo, quando altera cena/nó
[ ] path sandbox, quando usa path
[ ] log da operação
```

## 9.2 Não implementar atalhos inseguros

Evitar:

```text
- escrever diretamente em .tscn sem necessidade;
- aceitar path absoluto sem validação;
- remover arquivos definitivamente;
- sobrescrever scripts sem backup;
- manipular nós sem UndoRedo;
- retornar erro genérico.
```

---

## 10. Logs

## 10.1 Logs do servidor

Arquivo sugerido:

```text
.godot_mcp/logs/actions.jsonl
```

Formato:

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "tool": "godot_patch_file",
  "status": "ok",
  "duration_ms": 42,
  "affected_files": ["res://scripts/Player.gd"]
}
```

## 10.2 Logs do plugin

O plugin também pode registrar eventos locais para debugging.

```text
.godot_mcp/logs/plugin.jsonl
```

---

## 11. Testes

## 11.1 Testes do servidor

Ferramentas sugeridas:

```text
Vitest
tsx
mock WebSocket server
```

Cobrir:

```text
- schemas;
- pathGuard;
- backup;
- permissions;
- dry_run;
- conversão de resposta;
- tratamento de timeout.
```

## 11.2 Testes do plugin

Cobrir:

```text
- dispatcher;
- response_factory;
- validação de protocolo;
- validação de ClassDB;
- scene tools;
- node tools;
- undo_service.
```

## 11.3 Testes E2E

Fluxo mínimo:

```text
1. Iniciar Godot com projeto de teste.
2. Ativar plugin.
3. Iniciar servidor MCP.
4. Executar health_check.
5. Criar cena.
6. Adicionar nó.
7. Criar script.
8. Anexar script.
9. Salvar cena.
10. Rodar cena.
11. Obter logs.
```

---

## 12. Convenções de TypeScript

## 12.1 Regras

```text
- Usar strict mode;
- Evitar any;
- Validar entrada com Zod;
- Separar tool registration de lógica de negócio;
- Usar tipos explícitos para respostas;
- Centralizar erros;
- Escrever testes para safety modules.
```

## 12.2 Padrão de módulos

```text
tools/projectTools.ts      → registra ferramentas MCP
godot/client.ts            → comunica com plugin
safety/pathGuard.ts        → valida paths
utils/errors.ts            → erros padronizados
```

---

## 13. Convenções de GDScript

## 13.1 Regras

```text
- Usar @tool nos scripts do plugin;
- Manter plugin.gd pequeno;
- Separar tools por domínio;
- Retornar Dictionary padronizado;
- Validar entradas;
- Usar EditorUndoRedoManager;
- Não fazer lógica de IA no plugin;
- Não acessar arquivos fora de res:// sem necessidade explícita.
```

## 13.2 Padrão de resposta

```gdscript
return ResponseFactory.success(
    { "node_path": node_path },
    "Nó criado com sucesso."
)
```

Erro:

```gdscript
return ResponseFactory.error(
    "NODE_NOT_FOUND",
    "Nó não encontrado.",
    { "node_path": node_path },
    ["Verifique o caminho do nó na cena atual."]
)
```

---

## 14. Fluxo de desenvolvimento recomendado

Para cada nova feature:

```text
1. Atualizar TOOL_SPECIFICATION.md se necessário.
2. Criar schema no servidor.
3. Registrar ferramenta MCP.
4. Criar método interno JSON-RPC.
5. Implementar handler no plugin.
6. Aplicar segurança.
7. Adicionar logs.
8. Adicionar testes.
9. Testar com projeto Godot real.
10. Atualizar documentação.
```

---

## 15. Checklist antes de abrir PR

```text
[ ] Código compila
[ ] Testes passam
[ ] Ferramenta tem schema
[ ] Ferramenta tem erro padronizado
[ ] Ferramenta respeita read-only
[ ] Ferramenta respeita path sandbox
[ ] Backup implementado quando necessário
[ ] UndoRedo implementado quando necessário
[ ] dry_run implementado quando necessário
[ ] Logs implementados
[ ] Documentação atualizada
[ ] Exemplo de uso adicionado quando aplicável
```

---

## 16. Conclusão

O desenvolvimento do Godot DevPilot MCP deve priorizar estabilidade, segurança e clareza arquitetural.

A regra principal é:

```text
Não adicionar ferramentas rapidamente sem schema, segurança, teste e documentação.
```

O projeto será mais forte se cada ferramenta for previsível, auditável e útil para o fluxo real de criação de jogos com Godot.

