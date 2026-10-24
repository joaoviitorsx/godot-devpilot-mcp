# Auditoria técnica e plano de cobertura de jogos — 2026-10-24

## Escopo e evidência

Esta revisão percorreu o instalador, o servidor MCP, a ponte GDScript, o índice do projeto, a descoberta de ferramentas, protótipos, tiles, exportação, testes e CI. O objetivo é permitir que a IA componha recursos da engine para conceitos 2D e 3D sem confundir um modelo inicial com um jogo validado.

No checkout analisado, `tools/list` no modo `full` anunciou 388 ferramentas em aproximadamente 218 KB de JSON. No modo `core`, foram 191 ferramentas em aproximadamente 102 KB; em `agentic`, 398 em aproximadamente 224 KB. Essa medição é do catálogo anunciado ao cliente, não de cobertura integral da API Godot. O catálogo grande aumenta o custo de descoberta para clientes de IA e torna a qualidade do roteamento mais importante.

Foram executados 483 testes do servidor, cinco testes do instalador e o smoke de tiles pela ponte real em Godot 4.3 e 4.6.3 no Windows. O plugin iniciou no Godot 4.6.3 neste repositório e, em projetos isolados, no 4.3. A tentativa de abrir o repositório inteiro no Godot 4.3 causou um crash do editor; o problema não se repetiu em um projeto mínimo nem em uma cópia reduzida do jogo com o mesmo addon. A causa exata do crash no checkout completo não foi estabelecida; a configuração do repositório declara recursos do Godot 4.6.

## Problemas corrigidos nesta revisão

| Área | Falha observada | Ajuste |
| --- | --- | --- |
| Respostas da ponte | Um resultado `{}` ou incompleto virava `ok: true`. | O protocolo agora exige um envelope de resultado válido e retorna `INVALID_PLUGIN_RESULT` quando a operação não é confirmada. |
| Blueprints | Geradores podiam continuar após falha de RPC e terminar com sucesso. | A primeira falha interrompe o blueprint com a etapa e o erro do editor. |
| Plano de jogo | Gêneros desconhecidos viravam `topdown` 2D. | O plano preserva `custom`, registra a dimensão 3D quando explícita e impede aplicação automática incompatível; o fluxo de produção genérico orienta a composição. |
| Protótipos | Um plano parcialmente aplicado era anunciado como jogável. | Falhas viram `PROTOTYPE_INCOMPLETE`; geração sem erros continua marcada como scaffold até playtest. |
| Contexto | `run/main_scene="uid://..."` não era resolvido. | O contexto consulta os cabeçalhos `.tscn` e informa o caminho resolvido quando único. |
| Indexação | Contexto e análise repetiam varreduras de arquivos. | Uma lista indexada é reutilizada; metadados são consultados em lotes limitados a 32 arquivos. Neste checkout, o índice caiu de cerca de 116–141 ms para 38–46 ms; o contexto ficou em cerca de 42–51 ms. Medições locais, não promessa para todos os discos. |
| Tiles | `set_cell` e `fill_rect` declaravam sucesso sem TileSet ou tile válido. | A ponte valida TileSet, source, atlas/alternativa e limita o retângulo a 65.536 células. O blueprint de plataforma usa `TileMapLayer` vazio e explicita o trabalho de arte/colisão. |
| Exportação | Ao sobrescrever, um arquivo antigo podia ser confundido com um build novo. | O destino antigo é salvo e removido antes da exportação; em falha, o arquivo anterior é restaurado. |
| Descoberta | Palavras comuns em português dominavam a busca; consultas por gênero retornavam ferramentas aleatórias. | Stop words e sinônimos de mecânicas melhoram a busca, e lacunas de ferramenta dedicada são sinalizadas. |
| Orquestração | Fluxos `godot_*` compostos devolviam `ok: true` quando uma etapa do editor falhava. | A falha agora interrompe o fluxo e retorna `WORKFLOW_INCOMPLETE` com a etapa, resultados anteriores e indicação de mudanças parciais. |
| Alegações de jogabilidade | Um cenário com apenas cena ou HUD era descrito como jogável; o loop de execução alegava conferir erros sem inspecionar logs. | As saídas distinguem scaffold de jogo testado; o loop se identifica como smoke de inicialização e orienta a checagem de erros. |
| CI de capacidades | Alterações nas descrições de ferramentas não foram refletidas no manifesto, interrompendo a CI após build e testes passarem. | O manifesto foi regenerado e `node scripts/capability-report.mjs --check` passou novamente. |

## Lacunas priorizadas

### P0 — Provar o fluxo de criação de jogo

Criar uma matriz de jogos pequenos que cubra perspectiva, interação e arquitetura: plataforma 2D, puzzle, estratégia por turnos, ritmo, corrida 3D e multiplayer local/online. Cada caso deve ter critérios observáveis: abertura da cena, entrada, regras, UI, áudio quando aplicável, salvar/carregar, teste de comportamento e exportação. Um caso passa somente quando o jogo roda e a ação do jogador produz o estado esperado. Arquivos gerados ou parser limpo não bastam.

Os blueprints existentes são pontos de partida. Vários ainda precisam de TileSet, formas de colisão, recursos exportados ou ligações de cena. Eles devem ganhar testes jogáveis e recursos completos por etapas, sem prometer um jogo pronto em uma chamada.

### P1 — Capacidade genérica da engine

O catálogo cobre muitas operações, mas não há ferramenta dedicada para rede/multiplayer, veículos ou sincronização de ritmo. Estratégia por turnos pode ser composta com scripts, sinais e máquina de estados, mas não possui workflow específico. Priorizar primitivas com contratos claros e inspeção via ClassDB antes de criar novos blueprints por gênero. Para rede, uma trilha própria deve contemplar autoridade, replicação, latência e teste com dois processos, usando as APIs oficiais do Godot.

O MCP deve distinguir três estados para qualquer pedido: ferramenta dedicada, composição com primitivas existentes, ou recurso ainda sem ponte. `devpilot_find_tools` agora sinaliza parte dessas lacunas, mas sua pontuação continua heurística; recomendações por intenção e testes de relevância em português e inglês são o próximo incremento.

### P1 — Transações e confirmação

Operações compostas ainda podem deixar cenas ou scripts parciais. Adotar snapshots por fluxo, estágio de prévia, confirmação de cada RPC, rollback recuperável e relatório de arquivos realmente alterados. A exportação restaura o arquivo principal, mas presets que criam vários arquivos, como Web, precisam de isolamento e validação de todos os artefatos. As respostas MCP deveriam expor `structuredContent` e schemas de saída nos fluxos principais, preservando o texto JSON para clientes antigos.

### P1 — Desempenho e escala

O índice é O(F) em número de arquivos por varredura; o grafo de dependências é O(B) em bytes de scripts e cenas textuais. O ganho atual reduz latência de I/O, sem mudar a complexidade assintótica. Para jogos grandes, adicionar cache incremental com invalidação por alterações e limites de leitura, sem servir dados obsoletos após edição. `tilemap.fill_rect` é O(largura × altura) no thread do editor; dividir pinturas extensas em lotes com orçamento por frame. Em blueprints, controlar contagens de entidades e RPCs para impedir milhares de chamadas acidentais.

O catálogo completo de 218 KB também pede uma estratégia de exposição progressiva. Uma futura camada de tarefas poderia anunciar um conjunto pequeno de ferramentas estáveis e carregar capacidades especializadas por domínio, mantendo um caminho explícito para consultar o catálogo completo. A busca atual em 388 ferramentas é barata; o problema maior é relevância e volume entregue ao cliente.

### P2 — Código e distribuição

O revisor GDScript atual usa expressões regulares; complementá-lo com warnings do próprio editor, validação de parser e testes de cena. Manter cenas reutilizáveis autocontidas e dependências externas explícitas. O instalador passou nos testes de mesclagem e recuperação, mas o bootstrap busca `main` mutável; para distribuição pública, publicar releases versionadas com checksum, canal estável e procedimento de atualização/rollback. O comando curto pode permanecer igual e apontar internamente para uma versão estável.

## Referências técnicas

- [Organização de cenas do Godot](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html): cenas autocontidas e dependências explícitas.
- [Formato TSCN e UIDs](https://docs.godotengine.org/en/4.6/engine_details/file_formats/tscn.html): identidade de cenas e referência `uid://`.
- [TileMapLayer no Godot 4.6](https://docs.godotengine.org/en/4.6/classes/class_tilemaplayer.html): substituto recomendado para o `TileMap` depreciado.
- [Otimização geral do Godot](https://docs.godotengine.org/en/4.5/tutorials/performance/general_optimization.html): medir gargalos antes de otimizar.
- [Ferramentas no protocolo MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): descoberta, paginação e respostas estruturadas.
- [Linha de comando do Godot](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html): execução headless, validação e automação.
