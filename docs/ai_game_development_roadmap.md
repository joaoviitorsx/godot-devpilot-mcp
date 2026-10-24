# Desenvolvimento de jogos com IA: fluxo e próximos passos

## O que já funciona

O MCP conecta Claude Code ou Codex ao editor Godot por uma ponte local. Em `core`, a IA pode descobrir o projeto, inspecionar arquivos, criar ou editar cenas e scripts, depurar e executar verificações. `full` acrescenta ferramentas especializadas de tiles, sistemas de jogo, áudio, animação, física, navegação, conteúdo e qualidade. `agentic` acrescenta orquestradores. Use `godot_get_capabilities` para consultar a lista real de ferramentas da instalação.

O recurso MCP `godot://project/context` e a ferramenta `devpilot_game_context` apresentam uma visão curta do jogo: cena principal, cenas, scripts, assets, addons e referências ausentes. Arquivos de addons não entram nas contagens do jogo. Os prompts `devpilot_feature_loop`, `devpilot_playtest_loop` e `devpilot_tile_workflow` dão à IA um ponto de partida orientado à tarefa. O servidor também oferece execução headless por tempo real (`devpilot_run_headless`) e execução de testes GUT quando o addon GUT estiver instalado (`devpilot_run_gut_tests`).

O Better Tile Editor é opcional, exige Godot 4.6+ e precisa ser instalado separadamente. As ferramentas de terreno só ficam disponíveis em `full` ou `agentic` e devem confirmar a presença do addon antes de operar. O Godot 4.3+ continua sendo o mínimo para as funções gerais do MCP.

Para 3D, o MCP já oferece blueprints de jogador FPS/TPS, inimigo, projétil e sala, além de ferramentas de câmera, luz, corpo físico, raycast e navegação. O novo `devpilot_audit_3d_scene` inspeciona uma cena `.tscn` em modo somente leitura e aponta formas de colisão, malhas, NavigationMesh, Environment e câmera ausentes. Use `role=playable` para exigir uma câmera declarada na cena e o prompt `devpilot_3d_vertical_slice` para orientar a criação. A auditoria é estática: instâncias, recursos criados por script, visual final e jogabilidade ainda devem ser verificados no editor e em playtest.

## Fluxo recomendado para uma funcionalidade

1. **Entender o jogo.** Leia `devpilot_game_context`, a cena relevante e seus scripts. Identifique controles, assets e dependências.
2. **Definir um resultado observável.** Escreva critérios curtos, como “ao apertar ataque, o inimigo perde vida uma vez” e “a cena abre sem erros”.
3. **Implementar uma fatia jogável.** Altere os poucos arquivos necessários, mantendo cenas reutilizáveis e pouco acopladas.
4. **Verificar por camadas.** Confira referências e parse, execute testes quando houver, rode o jogo, veja logs e capture a tela quando o comportamento visual importar.
5. **Relatar evidência.** Diga quais arquivos mudaram, quais verificações passaram, o que foi visto no jogo e o que ainda exige teste manual.

Esse ciclo combina a orientação de [cenas autocontidas do Godot](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html) com o uso de [feedback e avaliações de agentes](https://www.anthropic.com/research/demystifying-evals-for-ai-agents). Use nomes de arquivo `snake_case` e nomes de nós `PascalCase`, conforme a [organização de projeto do Godot](https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html).

## Instalação e primeiro uso

Dentro da pasta do jogo, execute o comando curto para seu sistema no [guia de instalação](installation.md). O instalador detecta Claude Code e/ou Codex CLI, instala o runtime no próprio jogo, ativa o plugin, guarda uma cópia de `project.godot` antes da ativação e configura o cliente. Abra o jogo no editor, inicie uma nova sessão de IA e peça `godot_health_check`, seguido de `devpilot_game_context`.

## Melhorias seguintes, por prioridade

| Prioridade | Trabalho | Critério de conclusão |
| --- | --- | --- |
| P1 | Validador de instalação após o primeiro início | Confirma cliente, servidor, plugin ativo, token e projeto correto com diagnóstico de cada falha. |
| P1 | Catálogo de capacidades por tarefa | A IA encontra poucas ferramentas relevantes para a tarefa, com parâmetros e exemplos atualizados, sem precisar examinar centenas de schemas. |
| P1 | Testes de gameplay repetíveis | Inputs, assertions, logs e captura de tela ficam associados ao mesmo cenário e podem rodar novamente após cada correção. |
| P1 | Matriz de integração contínua | Godot 4.3 e versão estável atual rodam parse, conexão, projetos de exemplo e um fluxo de criação de cena em Windows e Linux. |
| P2 | Diferença visual confiável | Capturas com resolução e cena fixas têm tolerância configurável e um relatório que aponta as regiões alteradas. |
| P2 | Proveniência de assets | Importações registram origem, licença, atribuição e perfil de importação antes de entrar no jogo. |
| P2 | Índice incremental | Projetos grandes atualizam apenas arquivos alterados e mantêm respostas de contexto limitadas em tamanho. |

## Pesquisa aplicada: jogos de melhor qualidade

As propostas abaixo são trabalho futuro. A revisão comparou o que o MCP já oferece (contexto do projeto, criação de cenas, execução headless, GUT, replay, presets de exportação e blueprint de localização) com práticas de design e produção. Nenhuma ferramenta atual deve apresentar um jogo como “pronto” só porque os scripts passaram no parser.

| Ordem | Recurso proposto | Evidência e contrato de aceitação |
| --- | --- | --- |
| 1 | **Brief de experiência e fatia jogável** (`devpilot_design_brief`) | Registrar público, emoção pretendida, mecânica, dinâmica esperada, ciclo principal, restrições e uma fatia que possa ser jogada do início ao fim. O framework [MDA](https://www.cs.northwestern.edu/~hunicke/MDA.pdf) relaciona mecânicas, dinâmicas e experiência do jogador; o [MIT Game Lab](https://gamelab.mit.edu/about/game-development/) descreve prototipagem e testes iterativos centrados no jogador. O MCP deve devolver critérios observáveis e associá-los aos arquivos e cenas criados. |
| 2 | **Playtest reproduzível com observações** (`devpilot_playtest_session`) | Estender o replay existente para salvar versão do jogo, cena, seed, sequência de entradas, eventos esperados, logs e capturas. Comparar execução com expectativas e produzir falhas localizadas; reservar campo para observações de pessoas, pois teste automatizado não mede diversão. A pesquisa [Play as Research](https://www.ericzimmerman.com/assets/pdfs/Iterative_Design.pdf) fundamenta ciclos de jogar, observar e revisar. |
| 3 | **Gate de qualidade por plataforma** (`devpilot_release_check`) | Agregar import/parse, GUT, referências, replay, exportação real por preset e erros de execução em um relatório com `pass/fail/needs_human_review`. Os [comandos oficiais de exportação do Godot](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) permitem validar builds, desde que templates e presets estejam instalados. Não marcar exportação como aprovada quando só um preset foi escrito. |
| 4 | **Orçamentos de desempenho medidos** (`devpilot_performance_baseline`) | Registrar hardware, resolução, renderer, cena, tempo de frame e métricas de CPU/GPU quando disponíveis; comparar com orçamento informado pelo criador. A [documentação do profiler](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/the_profiler.html) recomenda medir gargalos reais. Não inferir FPS de inspeção estática do projeto. |
| 5 | **Auditoria de acesso e idiomas** (`devpilot_player_experience_audit`) | Conferir ações do InputMap, opção de remapeamento, legibilidade de texto, legendas, indicadores que não dependam só de cor e caminhos de localização. Gerar recomendações com evidência por cena e indicar o que requer teste humano. Base: [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/), [InputMap](https://docs.godotengine.org/en/stable/tutorials/inputs/input_examples.html) e [internacionalização no Godot](https://docs.godotengine.org/en/stable/tutorials/i18n/internationalizing_games.html). |
| 6 | **Assets com proveniência e importação controlada** | A cada asset incorporado, registrar origem, autor, licença, atribuição, resolução e configuração de importação; alertar sobre ausências e incompatibilidades antes do build. O [processo de importação do Godot](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html) permite configurar parâmetros por recurso. Para tiles, manter compatibilidade opcional com Better Tile Editor. |

Antes de criar novas famílias de ferramentas, medir o custo de descoberta do catálogo atual: tempo até a IA selecionar a ferramenta correta, número de chamadas para concluir uma fatia jogável e taxa de falhas em projetos de exemplo. O catálogo por tarefa deve encaminhar às ferramentas existentes e reduzir trabalho duplicado. Um conjunto pequeno de jogos 2D e 3D, com critérios de design e builds reproduzíveis, será a base dessas avaliações.

### Trilha específica para jogos 3D

1. **Cena jogável completa:** revisar os geradores 3D que hoje criam nós sem atribuir `Mesh`, `Shape3D`, `Environment` ou `NavigationMesh`. A nova auditoria torna essas lacunas visíveis, mas o próximo incremento deve criar recursos válidos e permitir salvar, reabrir e rodar uma cena sem configuração manual. [CollisionShape3D](https://docs.godotengine.org/en/4.6/classes/class_collisionshape3d.html) depende de uma forma e [NavigationRegion3D](https://docs.godotengine.org/en/4.6/classes/class_navigationregion3d.html) de uma malha de navegação.
2. **Importação de modelos e materiais:** propor um fluxo para `.glb/.gltf` que confira escala, orientação, materiais, animações, colisão e configuração de importação, sem prometer controle de etapas que o editor ainda não expõe pela ponte MCP. Incluir uma cena de exemplo e teste real de reimportação.
3. **Qualidade visual e desempenho medido:** capturar a cena com câmera e resolução fixas, comparar o resultado com uma referência aprovada e medir tempo de frame no hardware alvo. Revisar malhas distantes, sombras e culling apenas com dados do profiler; [Godot documenta LOD de malhas](https://docs.godotengine.org/en/4.6/tutorials/3d/mesh_lod.html) e [ferramentas de perfil](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/the_profiler.html).
4. **Teste de gameplay 3D:** repetir movimento, salto, câmera, disparo e colisões em uma cena conhecida. O relatório deve associar posição e estado esperados a logs e captura, e pedir avaliação humana de sensação de controle e legibilidade.

Essas linhas são planejadas; a tabela não representa funcionalidades já implementadas. O MCP cobre as operações expostas por suas ferramentas e pela ponte Godot, não a totalidade da API interna da engine. Uma função nova precisa de contrato, implementação no servidor e, quando envolver o editor, método correspondente no plugin, além de teste real no Godot.

## Referências técnicas

- [Recursos MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) e [prompts MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts).
- [Linha de comando do Godot](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html): `--quit-after` conta iterações/frames; `devpilot_run_headless` usa um temporizador do processo para expressar segundos.
- [GUT e sua execução por CLI](https://github.com/bitwes/gut/blob/main/documentation/docs/Command-Line.md).
- [Building effective agents](https://www.anthropic.com/research/building-effective-agents).
