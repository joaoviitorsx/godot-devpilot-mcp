# Revisão técnica e estado da implementação

## Implementado em 24/10/2026

- O instalador configura Claude Code e Codex, oferece modos `minimal`, `core`, `full` e `agentic`, ignora o token local e funciona a partir de um pacote extraído sem Git. `scripts/package-release.mjs` produz arquivo `.tar.gz` e checksum SHA-256.
- Caminhos de casos, relatórios, gravações, cenários e blueprints são confinados ao projeto; IDs de snapshot e nomes derivados de JSON são validados. O rollback prepara uma cópia antes de substituir arquivos e tenta restaurar os originais se uma etapa falhar.
- A ponte WebSocket aceita apenas loopback, exige token aleatório de sessão, limita conexões e tamanho de mensagem. O cliente confirma caminho real do projeto e versões do plugin/protocolo antes de liberar chamadas.
- Os modos registram conjuntos crescentes de ferramentas e `godot_get_capabilities` informa a lista real. O runner de evals chama ferramentas MCP de verdade; os oito casos base passaram com Godot 4.6.3 no Windows. Os tools MCP de eval também executam os casos via um cliente MCP interno.
- As verificações de input, autoloads, convenções e erros de execução usadas por `devpilot_validate_project` e `godot_project_doctor` foram movidas para funções do servidor quando não existiam no dispatcher Godot.
- Fluxos compostos reutilizam as ferramentas MCP locais para criação de scripts, erros, correções e impacto; chamadas para métodos inexistentes no plugin foram removidas. A checagem de release usa o índice do projeto. O executor de prompts lê relatórios de execução locais e usa o método correto para métricas.
- CI inclui build, testes, auditoria npm, verificação de versões, empacotamento, instalação extraída, parse GDScript e teste da conexão com o editor. Vitest 5 e Node.js 22.12+ zeraram os avisos de `npm audit`.
- A integração opcional com Better Tile Editor 0.4.0 foi exercitada em Godot 4.6.3: atlas de 253 tiles, criação/listagem de terreno, associação de tile e pintura de duas células salvas na cena. Os novos scripts também passaram na verificação sintática do Godot 4.3 sem o addon externo.
- O instalador agora detecta o cliente por padrão, aceita repetição sem alterar um addon idêntico, ativa o plugin em `project.godot` e faz backup da configuração antes da primeira ativação. O fluxo de trabalho com IA tem recurso MCP de contexto, três prompts de tarefa e um runner opcional de GUT. O teste real de GUT com Godot 4.6.3 concluiu 1/1 teste.
- O bootstrap `install.sh`/`install.ps1` e o CLI `godopilot` permitem instalar a partir da pasta do jogo sem informar caminho. O runtime fica em `.godot_mcp/runtime`, então limpar o cache do npm não quebra a configuração. O instalador preserva e complementa `AGENTS.md` e `CLAUDE.md` para Codex/Claude reconhecerem a integração em novas sessões.
- A ferramenta headless mede segundos de relógio e retorna falha quando o Godot informa erros de execução. A convenção de cenas aceita nomes `snake_case`, de acordo com a documentação da engine. Próximos passos estão em [desenvolvimento de jogos com IA](ai_game_development_roadmap.md).
- A instalação inclui `.gdignore` em `.godot_mcp/runtime` para que o editor não importe dependências Node como assets do jogo. Uma instalação anterior sem esse arquivo é atualizada na próxima execução do instalador.
- A revisão 3D adicionou a auditoria estática `devpilot_audit_3d_scene` e o prompt `devpilot_3d_vertical_slice`. A auditoria acusa recursos ausentes nos blueprints ou em cenas feitas à mão, mas não substitui validação do editor, reimportação de modelos e teste de gameplay. A [trilha 3D](ai_game_development_roadmap.md#trilha-específica-para-jogos-3d) detalha os incrementos seguintes.

## Verificações ainda externas

- A CI foi adicionada ao repositório, mas sua execução em GitHub Actions depende de um push. O fluxo completo Claude Code/Codex foi exercitado pelo instalador com testes locais; a interação visual final nesses clientes precisa ser conferida nas máquinas onde forem usados.
- O editor real foi validado no Windows com Godot 4.6.3 e 4.3, incluindo `godot_health_check`. Em 4.6.3, `devpilot_build_feature` criou e validou uma cena com script e também executou a variante que roda a cena e persiste um cenário de teste (11 passos concluídos). A CI cobre Linux quando rodar; macOS ainda não foi executado. O token protege a porta contra chamadas sem autorização, mas um processo rodando na mesma conta do usuário e com acesso aos arquivos do projeto pode lê-lo.

## Histórico da revisão inicial

## Estado verificado em 24/10/2026

- A arquitetura atual tem servidor MCP em TypeScript por stdio e plugin Godot por WebSocket local. O projeto exige as duas partes instaladas e o editor aberto.
- A instalação antiga exigia compilar, copiar o addon e configurar caminhos absolutos manualmente. O novo `scripts/install.mjs` automatiza essas etapas, oferece prévia e faz backup do addon em atualizações.
- O Graphify local mapeou o servidor TypeScript, mas não reconheceu GDScript; a parte Godot foi revisada diretamente.
- A suíte original passou; posteriormente foi ampliada para 437 testes. A validação real foi concluída no Windows com Godot 4.6.3.
- A cadeia de desenvolvimento migrou para Vitest 5 e Node.js 22.12+. `npm audit` reporta zero vulnerabilidades.

## Prioridades identificadas na revisão original

### P0 — corrigir antes de distribuir para uso em jogos reais

1. **Confinar todos os caminhos de arquivos.** `evalReportTools.ts` aceita caminhos absolutos para casos e relatórios; `qaAuditTools.ts` aceita saída absoluta; `recordingTools.ts`, `tierAndCustomTools.ts` e `behaviorReplayTools.ts` compõem caminhos com nomes livres. O controle `resolveProjectPath` cobre muitas ferramentas, mas não essas rotas. Criar um resolvedor para caminhos relativos internos e nomes simples, rejeitar `..`, barras e links simbólicos que escapem do projeto, e aplicá-lo em toda leitura/escrita baseada em entrada MCP ou JSON carregado do disco. Incluir testes com caminhos absolutos, `../`, nomes em JSON e links simbólicos.
2. **Corrigir snapshots e rollback.** `iterationTools.ts` usa `id` sem validação em `.devpilot/snapshots/<id>`. Com `id="../.."`, o caminho vira a raiz do jogo; a rotina pode apagar `scenes/` e falhar ao copiar de si mesma. `snapshotMaintenanceTools.ts` repete o padrão no diff. Aceitar apenas um ID simples listado no diretório de snapshots, validar o destino real, preparar a restauração antes de substituir arquivos e retornar erro se qualquer etapa falhar. Testar rollback normal, ID malicioso, snapshot incompleto e falha de cópia.
3. **Vincular a conexão ao projeto correto.** O plugin informa `project_path` em `system.health_check`, mas `GodotClient.connect()` considera qualquer WebSocket na porta como conectado. Comparar a raiz real com `GODOT_MCP_PROJECT_ROOT` e verificar versão/protocolo antes de permitir operações no editor. Testar editor aberto em outro projeto e reconexão após trocar de projeto.
4. **Proteger o WebSocket do plugin.** `rpc_server.gd` aceita conexões locais e encaminha métodos ao dispatcher sem autenticação. O modo somente leitura existe no servidor MCP, então outro processo local que fala diretamente com a porta não passa por ele. Adicionar autenticação de sessão no bridge, limite de mensagem e uma política explícita para clientes/origens; manter loopback como padrão.

### P1 — confiabilidade e experiência de uso

5. **Fazer os modos funcionarem.** `index.ts` registra todas as famílias de ferramentas e `getModeCapabilities()` devolve a mesma lista para `minimal`, `core`, `full` e `agentic`. Definir o catálogo por modo, anunciar a lista efetivamente registrada e testar descoberta por perfil. Isto também reduz a superfície que Claude e Codex precisam examinar.
6. **Tornar os evals executáveis.** `evals/runner.js` apenas grava um resultado `pending`, apesar de `evals/README.md` dizer que chama e compara respostas MCP. Em `evalReportTools.ts`, `godot_health_check` é mapeado para `core.health_check`, enquanto o plugin implementa `system.health_check`; os outros casos também não têm `mcp_method`. Criar um runner real, ajustar o mapa ou chamar a ferramenta MCP externa, e fazer CI falhar quando um caso não tiver método resolvido.
7. **Evitar sucesso após restauração parcial.** O rollback captura exceções por item e sempre retorna sucesso. Relatar cada erro, preservar os arquivos originais até ter uma cópia pronta e só declarar sucesso quando a restauração estiver completa.
8. **Validar uma instalação limpa ponta a ponta.** Em cada sistema, criar um projeto Godot pequeno, executar o instalador para Claude Code e Codex, habilitar o plugin, executar `godot_health_check`, criar uma cena e reiniciar o editor/cliente. Registrar versões de Godot, Node e clientes. O teste automatizado atual verifica cópia e configuração, mas não substitui esse percurso. Godot oferece `--headless`, `--import` e `--check-only` para parte dessa validação em CI.

### P2 — distribuição e manutenção

9. **Preparar distribuição versionada.** Criar um arquivo de release que inclua addon, servidor compilado, lockfile, instalador e checksums. Testar o arquivo extraído em máquina sem checkout Git e só então publicar versões. O caminho absoluto do servidor permanece uma limitação quando a pasta instalada é movida.
10. **Alinhar compatibilidade e manutenção.** Automatizar CI de build, testes, auditoria de dependências de produção e verificação de versões entre `package.json`, `config.ts`, `plugin.cfg` e `dispatcher.gd`. Migrar Vitest separadamente se o projeto decidir elevar o requisito mínimo de Node. Rever a promessa de Godot 4.3+ com uma matriz real; o sandbox do repositório está salvo com 4.6.

## Referências consultadas

- [Instalação de plugins Godot](https://docs.godotengine.org/en/stable/tutorials/plugins/editor/installing_plugins.html)
- [MCP no Claude Code](https://code.claude.com/docs/en/mcp)
- [MCP no Codex, documentação oficial da OpenAI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Graphify local](https://github.com/Graphify-Labs/docs/blob/main/quickstart.mdx)
- [Linha de comando Godot para CI](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
- [Validação de origem em servidores MCP locais](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/middleware/originValidation.html)
