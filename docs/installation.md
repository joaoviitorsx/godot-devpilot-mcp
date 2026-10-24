# Instalação — GodoPilot

## Requisitos

- Godot 4.3 ou superior para abrir o jogo e ativar o plugin de editor.
- Node.js 22.12 ou superior, com npm, para obter e iniciar o servidor MCP.
- Claude Code ou Codex CLI, caso queira configuração automática do cliente correspondente.

O servidor roda na sua máquina por stdio. O plugin Godot escuta WebSocket em `127.0.0.1:6505` por padrão. O servidor só inicia quando `GODOT_MCP_PROJECT_ROOT` aponta para uma pasta com `project.godot`.

## Instalação em um jogo existente

Abra um terminal **dentro da pasta do jogo**, onde está `project.godot`, e use uma linha:

```sh
curl -fsSL https://raw.githubusercontent.com/joaoviitorsx/godot-devpilot-mcp/main/install.sh | sh
```

No Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/joaoviitorsx/godot-devpilot-mcp/main/install.ps1 | iex
```

O bootstrap usa `npm exec` para obter o pacote do GitHub. O instalador detecta Claude Code e/ou Codex CLI; se nenhum estiver disponível, explica como prosseguir. Ele copia o servidor compilado e instala suas dependências em `.godot_mcp/runtime/` **dentro do jogo**, para que a configuração do cliente continue válida mesmo após limpar o cache do npm. Um arquivo `.gdignore` evita que o Godot importe o runtime como conteúdo do jogo. Copia e ativa `addons/godot_devpilot_mcp`, configura os clientes detectados e acrescenta orientações curtas a `CLAUDE.md` e/ou `AGENTS.md`. Preserva o conteúdo existente nesses arquivos. Cada projeto recebe um nome MCP próprio.

O padrão do comando curto é **leitura e escrita** com modo `full`, para que a IA possa usar também as ferramentas especializadas. Use `--read-only` se quiser apenas inspeção; `--mode core` reduz o catálogo e `--mode agentic` inclui orquestradores. O script direto `godopilot` também aceita `--dry-run`, `--client claude|codex|both|none` e `--force`. Repetir a instalação com a mesma versão é seguro. Na atualização, o runtime antigo e o addon alterado são preservados em `.godot_mcp/install-backups/`; a primeira ativação do plugin também guarda uma cópia de `project.godot`. Outros plugins habilitados e entradas existentes em `.mcp.json` são preservados. Se `enabled` em `[editor_plugins]` tiver formato desconhecido, o instalador avisa que a ativação deve ser feita no editor.

Depois, abra o **projeto do jogo** no Godot. No painel Output deve aparecer a porta do WebSocket. O editor gera um token local em `.godot_mcp/bridge-token`, atualizado ao reiniciar o plugin; o instalador adiciona esse arquivo ao `.gitignore` do jogo. Reinicie o cliente de IA ou atualize a lista de servidores e execute `godot_health_check`, depois `devpilot_game_context`. Se a conexão falhar, confira `Project → Project Settings → Plugins` e a saída do editor.

Primeiro pedido útil à IA: “Leia `devpilot_game_context`, explique a cena principal e implemente uma pequena funcionalidade jogável. Defina critérios observáveis, valide os arquivos e execute um teste.” O MCP fornece os prompts `devpilot_feature_loop`, `devpilot_playtest_loop` e `devpilot_tile_workflow`; o cliente pode também ler o recurso `godot://project/context`. O modo `full` expõe as ferramentas especializadas, mas o acesso depende dos métodos implementados pela ponte do editor e dos addons opcionais instalados no jogo; ele não representa toda a API interna do Godot. Veja o [fluxo de desenvolvimento com IA](ai_game_development_roadmap.md).

> O cliente aponta para `.godot_mcp/runtime/dist/index.js` dentro do jogo. Se mover a pasta do jogo para outro caminho, execute novamente o instalador para atualizar os caminhos absolutos da configuração.

## Configuração dos clientes

### Claude Code

`--client claude` cria ou atualiza `.mcp.json` **na raiz do jogo** e acrescenta uma seção curta a `CLAUDE.md`. Claude Code trata o primeiro como configuração de projeto e pode pedir aprovação na primeira execução. Confira com `claude mcp list` ou `/mcp` dentro do Claude Code.

O instalador escreve uma entrada equivalente a:

```json
{
  "mcpServers": {
    "godot-devpilot-meu-jogo-id": {
      "type": "stdio",
      "command": "/caminho/para/node",
      "args": ["/caminho/do/jogo/.godot_mcp/runtime/dist/index.js"],
      "env": {
        "GODOT_MCP_PROJECT_ROOT": "/caminho/absoluto/meu-jogo",
        "GODOT_MCP_READ_ONLY": "false",
        "GODOT_MCP_MODE": "full"
      }
    }
  }
}
```

Para Claude Desktop, copie essa entrada `mcpServers` para a configuração MCP do aplicativo; o instalador não altera as preferências do Desktop.

### Codex

`--client codex` chama `codex mcp add` e grava o servidor nas configurações do Codex do usuário. O instalador também acrescenta uma seção curta a `AGENTS.md` para a IA descobrir o MCP ao iniciar uma nova sessão no jogo. Verifique com `codex mcp list`. Para remover, use `codex mcp remove <nome exibido pelo instalador>`. Se usar outro computador ou ambiente remoto, instale o servidor nesse ambiente e configure o cliente lá; o WebSocket `127.0.0.1` precisa alcançar o editor Godot local.

## Opções do instalador

```text
--project <pasta>  raiz do jogo contendo project.godot (padrão: pasta atual)
--client <nome>    auto | claude | codex | both | none (padrão: auto)
--read-only        impede que as ferramentas modifiquem o jogo
--mode <nome>      minimal | core | full | agentic (padrão: full)
--force            substitui o addon anterior com backup
--skip-build       utiliza um dist/index.js já compilado
--dry-run          valida e exibe o plano sem modificar arquivos
--help             mostra a ajuda
```

## Instalação manual

Se preferir configurar sem o instalador:

1. Em `mcp-server/`, execute `npm ci` e `npm run build`.
2. Copie `addons/godot_devpilot_mcp/` para `addons/` do seu jogo.
3. Ative o plugin no editor Godot.
4. Configure um servidor MCP stdio com comando `node`, argumento absoluto `mcp-server/dist/index.js` e variáveis `GODOT_MCP_PROJECT_ROOT` e `GODOT_MCP_READ_ONLY`.

Variáveis opcionais: `GODOT_MCP_HOST` (padrão `127.0.0.1`), `GODOT_MCP_PORT` (padrão `6505`), `GODOT_MCP_MODE` (`minimal`, `core`, `full` ou `agentic`) e `GODOT_MCP_TIMEOUT_MS` (padrão `5000`). Se mudar a porta no cliente, configure a mesma porta em `godot_devpilot_mcp/server/port` nas configurações do projeto Godot. O plugin aceita apenas loopback. Na instalação manual, adicione `/.godot_mcp/bridge-token` ao `.gitignore` do jogo.

## Pacote de distribuição

O pacote npm é gerado por `npm pack` e contém o comando `godopilot`. Para testar localmente antes da publicação, execute `npm pack --pack-destination release` neste repositório; dentro do jogo, rode `npm exec --yes --package="/caminho/para/release/godopilot-mcp-2.6.0.tgz" -- godopilot`. O pacote não requer checkout Git no computador do jogador. A publicação no registro npm permitiria `npx godopilot-mcp` no futuro; **este nome ainda não foi publicado**.

O arquivo de release tradicional continua disponível: `node scripts/package-release.mjs` produz `release/godot-devpilot-mcp-v<versão>.tar.gz` com SHA-256. Após extrair, execute `node /caminho/da/extracao/bin/godopilot.mjs` dentro da pasta do jogo.

Para trabalhar com terrenos e tiles, veja a [integração opcional com Better Tile Editor](better_tile_editor.md). Ela exige Godot 4.6+; o addon externo é instalado separadamente no jogo.

## Verificação e problemas comuns

No repositório, `npm test` em `mcp-server/` executa os testes do servidor. O instalador também possui `node --test scripts/install.test.mjs`. Com o editor aberto, `node evals/runner.js --all --project "/caminho/do/jogo"` executa os casos MCP e grava os resultados em `evals/results/`. A CI baixa o editor Godot oficial, verifica os scripts e realiza um teste de conexão autenticada.

- `project.godot missing`: execute o comando dentro da raiz do jogo, e não em `addons/` ou `scenes/`.
- MCP inicia, mas `godot_health_check` não conecta: abra o mesmo jogo no editor, habilite o plugin e confirme host/porta em ambos os lados.
- `BRIDGE_TOKEN_MISSING` ou `BRIDGE_MISMATCH`: confirme que o editor abriu o mesmo projeto, com a mesma versão do addon, e reinicie o plugin e o cliente MCP.
- Plugin não aparece: confirme `addons/godot_devpilot_mcp/plugin.cfg` dentro do jogo.
- `dist/index.js` ausente: execute o instalador sem `--skip-build`.
- Cliente parou após mover o jogo: execute o instalador novamente no novo caminho.

Referências: [plugins do editor Godot](https://docs.godotengine.org/en/stable/tutorials/plugins/editor/installing_plugins.html), [MCP no Claude Code](https://code.claude.com/docs/en/mcp), [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
