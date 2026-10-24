# Plano de cobertura da engine Godot

## Objetivo e ponto de partida

Permitir que Claude Code e Codex descubram e usem os recursos relevantes do Godot para criar, executar e verificar jogos 2D e 3D, sem exigir que a pessoa conheça os nomes de centenas de ferramentas. Cobertura será medida por fluxos concluídos e por famílias da API, não pela promessa de reproduzir cada botão do editor.

O pedido do usuário define a profundidade da resposta. Uma tarefa simples deve seguir um caminho curto e claro; uma tarefa complexa deve ser dividida em marcos verificáveis. A IA deve explicar o que fará, executar o menor conjunto de operações útil e relatar o que foi realmente validado.

Hoje, `godot_get_capabilities` mostra as ferramentas ativas; `godot_get_classdb_info` consulta classes, métodos e propriedades; `godot_get_node_properties`, `godot_add_node` e `godot_set_node_property` oferecem operações genéricas para nós. Em `full` e `agentic`, `godot_execute_editor_script` permite executar GDScript arbitrário. Esse último recurso amplia o alcance da API, mas não fornece esquema de parâmetros, prévia, UndoRedo ou garantia de que a operação é segura. Deve ser uma saída avançada e explícita, não a rota normal da IA.

## Sequência após a estabilização da versão 2.8

| Etapa | Entrega | Critério de aceitação |
| --- | --- | --- |
| 1. Inventário verificável | Gerar um manifesto de ferramentas MCP, métodos RPC e versões suportadas; relacionar operações com categorias do Godot: cena, nó, recurso, importação, animação, física, navegação, áudio, UI, shader, partículas, exportação e runtime. | A geração detecta ferramenta sem método RPC correspondente, documentação desatualizada e capacidades indisponíveis por versão; CI publica um relatório resumido. |
| 2. Descoberta orientada à tarefa | Criar um catálogo consultável por objetivo, versão da engine, modo ativo e addons presentes. Cada entrada traz parâmetros mínimos, exemplo curto, efeito, prévia e verificação sugerida. | Em cenários 2D e 3D de referência, a IA escolhe a operação correta sem percorrer o catálogo inteiro; medimos chamadas até o resultado e falhas de seleção. |
| 3. Introspecção segura | Ampliar a consulta de `ClassDB` para enums, sinais, herança, tipos de argumentos, valores padrão e disponibilidade na versão em execução; expor inspeção de `Resource` e de objetos editáveis, com saída limitada e paginação. | Consultas de `Node3D`, `AnimationPlayer`, `MeshLibrary`, `NavigationRegion3D` e recursos externos retornam metadados corretos em Godot 4.3 e 4.6; propriedades não serializáveis são identificadas. |
| 4. Operações genéricas tipadas | Adicionar operações de leitura e escrita para propriedades de recursos e subrecursos, criação/atribuição por tipo, sinais e ações comuns de editor. Converter `Variant` de forma explícita; validar classe, propriedade, tipo, caminho e limites no servidor e no plugin. | Operações comuns funcionam sem GDScript arbitrário, aceitam `dry_run` quando alteram dados, retornam arquivos/nós afetados e usam UndoRedo ou cópia recuperável. Erros de tipo e caminho não alteram o projeto. |
| 5. Fluxos de produção | Completar importação e reimportação de assets com configurações e proveniência, edição de animação, materiais/shaders, áudio, UI, exportação real e verificações 3D de navegação, colisão e aparência. Priorizar pela frequência de tarefas nos projetos de exemplo. | Cada fluxo abre e salva no editor, passa por teste headless e produz uma evidência observável: recurso importado, cena válida, agente em movimento, áudio ligado ou build exportado. |
| 6. Avaliação contínua | Manter pequenos jogos de referência 2D e 3D e tarefas de ponta a ponta com resultado esperado, custo de descoberta e regressões por versão/plataforma. | A CI informa taxa de conclusão por fluxo, erros, tempo/chamadas, compatibilidade e regressões; uma operação só é marcada como coberta após teste real no Godot. |

## Experiência para tarefas simples e complexas

| Tipo de pedido | Comportamento esperado | Exemplo de verificação |
| --- | --- | --- |
| Simples: “adicione uma luz a esta cena” | Descobrir o contexto atual, escolher uma ferramenta existente, mostrar uma prévia quando houver risco de sobrescrita, aplicar e salvar. Responder em poucas frases. | O nó e seu recurso aparecem na cena salva; a cena importa sem erros. |
| Intermediário: “crie uma sala 3D com colisão e navegação” | Selecionar um fluxo existente, declarar os arquivos/nós afetados, construir em etapas e validar cada resultado antes de avançar. | A sala carrega, possui colisão e a malha de navegação gerada não está vazia. |
| Complexo: “crie um protótipo FPS com inimigos e progressão” | Inspecionar o projeto, definir uma fatia jogável e critérios observáveis, reutilizar blueprints e orquestradores existentes, executar marcos pequenos, testar e apresentar evidências e limites. | O personagem se move, o inimigo reage, a progressão muda de estado, o jogo roda sem erros e o relatório distingue testes automáticos de revisão humana. |

Os critérios de qualidade do catálogo devem incluir acerto na escolha da ferramenta, número de chamadas, tempo até uma primeira mudança jogável, taxa de conclusão, capacidade de recuperação após erro e clareza do relatório. A comparação deve usar as mesmas tarefas antes e depois da implementação.

## Contrato de implementação

1. Para cada capacidade nova, registrar nome, versões, modo, requisitos de addon, leitura ou mutação, parâmetros, resposta e erros.
2. Usar ferramentas especializadas para tarefas frequentes e a camada genérica tipada para a variedade da API. A execução de script arbitrário permanece identificada como avançada.
3. Validar no servidor e no plugin; limitar tamanho de respostas, profundidade, número de itens e tempo de operações longas. Uma resposta não deve alegar que um timeout é aplicado se o editor não consegue interromper a execução.
4. Aplicar `dry_run`, UndoRedo ou recuperação verificável a mutações; registrar operações no log. Não chamar uma consulta de somente leitura se ela puder executar métodos com efeitos colaterais.
5. Testar casos válidos, versões diferentes, parâmetros inválidos e falhas intermediárias. Documentar claramente quando uma ação exige inspeção visual ou playtest humano.
6. Reutilizar ferramentas, blueprints e orquestradores atuais antes de criar novos nomes para o mesmo fluxo. Respostas devem expor uma opção simples por padrão e detalhes técnicos sob demanda.

## Ordem inicial de implementação

Começar pelo inventário e catálogo, pois eles mostram o uso real e as lacunas antes de adicionar novas ferramentas. Depois implementar introspecção de recursos e operações genéricas tipadas. Fechar a primeira rodada com cinco fluxos: importar um modelo 3D com material, montar e percorrer navegação, criar uma animação, conectar áudio a um evento e exportar uma build de teste. A partir das falhas observadas, selecionar o próximo conjunto de capacidades.

`ClassDB` não inclui classes declaradas com `class_name` em scripts do projeto. A introspecção deverá consultar também as instâncias e scripts do jogo, sem atribuir a `ClassDB` cobertura que ela não oferece.

## Referências oficiais

- [ClassDB](https://docs.godotengine.org/en/stable/classes/class_classdb.html) para metadados das classes da engine.
- [Object](https://docs.godotengine.org/en/stable/classes/class_object.html) para propriedades, métodos e sinais dos objetos.
- [Código no editor](https://docs.godotengine.org/en/stable/tutorials/plugins/running_code_in_the_editor.html) para os limites e cuidados de scripts `@tool`.
- [Importação de recursos](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html) para perfis e reimportação.
- [Organização de cenas](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html) para composição reutilizável e baixo acoplamento.
