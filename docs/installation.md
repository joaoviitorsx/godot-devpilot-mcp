# Installation — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento descreve o processo de instalação do **Godot DevPilot MCP**.

Ele cobre:

- Requisitos;
- Instalação do servidor MCP;
- Instalação do plugin Godot;
- Configuração em clientes MCP;
- Verificação da conexão;
- Modos de execução;
- Estrutura esperada após instalação;
- Problemas comuns de instalação.

---

## 2. Requisitos

## 2.1 Godot

Versão recomendada:

```text
Godot 4.2 ou superior
```

O projeto será desenvolvido com foco em Godot 4.x.

Godot 3.x não é alvo inicial.

## 2.2 Node.js

Versão recomendada:

```text
Node.js 18 ou superior
```

Verificar versão:

```bash
node --version
```

## 2.3 Gerenciador de pacotes

Um dos seguintes:

```text
npm
pnpm
yarn
```

Recomendado inicialmente:

```text
npm
```

## 2.4 Cliente MCP

Um cliente compatível com Model Context Protocol.

Exemplos:

```text
Claude Desktop
Cursor
Cline
Windsurf
VS Code com suporte MCP
```

## 2.5 Sistema operacional

Suporte planejado:

```text
Windows
Linux
macOS
```

---

## 3. Estrutura esperada do projeto

Após clonar o repositório, a estrutura esperada é:

```text
godot-devpilot-mcp/
├── addons/
│   └── godot_devpilot_mcp/
├── mcp-server/
├── docs/
├── examples/
└── tests/
```

O projeto possui duas partes principais:

```text
mcp-server/                  Servidor MCP em TypeScript
addons/godot_devpilot_mcp/   Plugin Godot em GDScript
```

---

## 4. Instalação do servidor MCP

## 4.1 Clonar o repositório

```bash
git clone https://github.com/seu-usuario/godot-devpilot-mcp.git
cd godot-devpilot-mcp
```

## 4.2 Entrar na pasta do servidor

```bash
cd mcp-server
```

## 4.3 Instalar dependências

Com npm:

```bash
npm install
```

Com pnpm:

```bash
pnpm install
```

Com yarn:

```bash
yarn install
```

## 4.4 Compilar servidor

```bash
npm run build
```

Resultado esperado:

```text
mcp-server/dist/
```

## 4.5 Rodar em modo desenvolvimento

```bash
npm run dev
```

## 4.6 Rodar em modo produção local

```bash
npm run start
```

---

## 5. Instalação do plugin Godot

## 5.1 Copiar addon para o projeto Godot

Dentro do seu projeto Godot, deve existir uma pasta:

```text
addons/
```

Copie:

```text
godot-devpilot-mcp/addons/godot_devpilot_mcp
```

para:

```text
seu-projeto-godot/addons/godot_devpilot_mcp
```

Estrutura esperada:

```text
seu-projeto-godot/
├── project.godot
├── addons/
│   └── godot_devpilot_mcp/
│       ├── plugin.cfg
│       ├── plugin.gd
│       ├── core/
│       └── tools/
```

## 5.2 Ativar plugin na Godot

1. Abrir o projeto na Godot.
2. Ir em:

```text
Project > Project Settings > Plugins
```

3. Procurar:

```text
Godot DevPilot MCP
```

4. Marcar como ativo.

## 5.3 Verificar porta WebSocket

Por padrão, o plugin deve iniciar na porta:

```text
6505
```

Mensagem esperada no Output da Godot:

```text
[Godot DevPilot MCP] WebSocket iniciado em 127.0.0.1:6505
```

---

## 6. Configuração do cliente MCP

## 6.1 Configuração genérica

Exemplo:

```json
{
  "mcpServers": {
    "godot-devpilot-mcp": {
      "command": "node",
      "args": [
        "C:/caminho/godot-devpilot-mcp/mcp-server/dist/index.js"
      ],
      "env": {
        "GODOT_MCP_HOST": "127.0.0.1",
        "GODOT_MCP_PORT": "6505",
        "GODOT_MCP_MODE": "core"
      }
    }
  }
}
```

No Linux/macOS:

```json
{
  "mcpServers": {
    "godot-devpilot-mcp": {
      "command": "node",
      "args": [
        "/home/user/godot-devpilot-mcp/mcp-server/dist/index.js"
      ],
      "env": {
        "GODOT_MCP_HOST": "127.0.0.1",
        "GODOT_MCP_PORT": "6505",
        "GODOT_MCP_MODE": "core"
      }
    }
  }
}
```

## 6.2 Variáveis de ambiente

```text
GODOT_MCP_HOST       Host do plugin Godot. Padrão: 127.0.0.1
GODOT_MCP_PORT       Porta WebSocket. Padrão: 6505
GODOT_MCP_MODE       minimal, core, full ou agentic
GODOT_MCP_READONLY   true ou false
GODOT_MCP_LOG_LEVEL  debug, info, warn ou error
```

## 6.3 Modos disponíveis

```text
minimal   ferramentas essenciais
core      modo recomendado para desenvolvimento diário
full      todas as ferramentas granulares
agentic   ferramentas compostas e de alto nível
```

Exemplo:

```json
{
  "GODOT_MCP_MODE": "minimal"
}
```

---

## 7. Verificação da instalação

## 7.1 Checklist

```text
[ ] Node.js instalado
[ ] Dependências instaladas
[ ] Servidor compilado
[ ] Plugin copiado para addons/
[ ] Plugin ativado na Godot
[ ] Porta 6505 iniciada
[ ] Cliente MCP configurado
[ ] health_check funcionando
```

## 7.2 Teste pelo cliente de IA

Solicite ao assistente:

```text
Verifique a conexão com a Godot.
```

A ferramenta esperada:

```text
godot_health_check
```

Resposta esperada:

```json
{
  "ok": true,
  "data": {
    "connected": true
  },
  "message": "Godot DevPilot MCP conectado.",
  "warnings": [],
  "suggestions": []
}
```

## 7.3 Teste de contexto do projeto

Solicite:

```text
Mostre as informações do projeto Godot aberto.
```

Ferramenta esperada:

```text
godot_get_project_info
```

---

## 8. Estrutura criada no projeto Godot

Durante o uso, o plugin/servidor pode criar:

```text
.godot_mcp/
├── backups/
├── logs/
├── trash/
├── screenshots/
├── index/
├── memory/
├── reports/
└── tests/
```

## 8.1 Backups

```text
.godot_mcp/backups/
```

Guarda cópias antes de alterações.

## 8.2 Logs

```text
.godot_mcp/logs/actions.jsonl
```

Registra chamadas de ferramentas.

## 8.3 Trash seguro

```text
.godot_mcp/trash/
```

Recebe arquivos removidos por `delete_file_safe`.

## 8.4 Screenshots

```text
.godot_mcp/screenshots/
```

Guarda capturas do editor ou jogo.

---

## 9. Instalação em modo desenvolvimento com projeto de teste

Fluxo recomendado para desenvolvedores:

```text
1. Clonar godot-devpilot-mcp
2. Criar projeto Godot vazio chamado mcp-test-project
3. Copiar addon para o projeto
4. Ativar plugin
5. Rodar servidor MCP em npm run dev
6. Configurar cliente MCP apontando para tsx ou dist
7. Executar health_check
8. Testar create_scene, add_node e save_scene
```

Exemplo de configuração usando `tsx`:

```json
{
  "mcpServers": {
    "godot-devpilot-mcp-dev": {
      "command": "npx",
      "args": [
        "tsx",
        "C:/caminho/godot-devpilot-mcp/mcp-server/src/index.ts"
      ],
      "env": {
        "GODOT_MCP_MODE": "core"
      }
    }
  }
}
```

---

## 10. Atualização

## 10.1 Atualizar servidor

```bash
cd godot-devpilot-mcp
git pull
cd mcp-server
npm install
npm run build
```

## 10.2 Atualizar plugin

Copiar novamente:

```text
addons/godot_devpilot_mcp
```

para o projeto Godot.

Depois:

```text
Desativar plugin → Ativar plugin novamente
```

ou reiniciar a Godot.

---

## 11. Desinstalação

## 11.1 Remover plugin

No projeto Godot:

1. Desativar plugin em `Project Settings > Plugins`.
2. Remover pasta:

```text
addons/godot_devpilot_mcp
```

## 11.2 Remover arquivos internos

Opcionalmente remover:

```text
.godot_mcp/
```

Atenção: essa pasta pode conter backups e logs.

## 11.3 Remover configuração MCP

Remover entrada `godot-devpilot-mcp` do cliente MCP.

---

## 12. Problemas comuns de instalação

## 12.1 Servidor não conecta à Godot

Verificar:

```text
- Godot está aberta?
- Plugin está ativo?
- Porta 6505 está correta?
- Firewall bloqueou conexão local?
- GODOT_MCP_HOST está como 127.0.0.1?
```

## 12.2 Cliente MCP não encontra o servidor

Verificar:

```text
- Caminho em args está correto?
- npm run build foi executado?
- dist/index.js existe?
- Node.js está no PATH?
```

## 12.3 Plugin não aparece na Godot

Verificar:

```text
- plugin.cfg existe?
- plugin.gd existe?
- Pasta está em addons/godot_devpilot_mcp?
- Projeto foi reiniciado após copiar addon?
```

## 12.4 Porta ocupada

Alterar porta:

```json
{
  "GODOT_MCP_PORT": "6506"
}
```

E configurar o plugin para a mesma porta.

---

## 13. Instalação recomendada para MVP

Para a primeira versão funcional, a instalação mínima será:

```text
1. Copiar plugin para addons/
2. Ativar plugin na Godot
3. Instalar servidor MCP
4. Configurar cliente MCP
5. Rodar health_check
```

O objetivo do MVP é validar o fluxo:

```text
Cliente IA → Servidor MCP → Plugin Godot → Editor Godot
```

---

## 14. Conclusão

A instalação do Godot DevPilot MCP envolve duas partes: servidor MCP e plugin Godot.

Se ambas estiverem configuradas corretamente, o usuário poderá usar um cliente de IA compatível com MCP para interagir com o editor Godot de forma segura e estruturada.

