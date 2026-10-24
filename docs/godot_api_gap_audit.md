# Cobertura prática da API do Godot

O inventário gerado em [`capability_manifest.json`](capability_manifest.json) relaciona 389 ferramentas estáticas e 129 métodos da ponte nesta versão. Esses números medem a superfície do MCP, **não** o percentual de cobertura da engine. O gerador valida referências a métodos RPC e a CI testa fluxos reais em Godot 4.3 e 4.6.3. Há uma inscrição dinâmica que exige revisão manual.

## Caminho curto para a IA

1. `devpilot_game_context` resume o jogo. `godot_health_check` confirma a ponte quando a tarefa depende do editor aberto.
2. `devpilot_find_tools` recebe uma frase em português ou inglês e devolve poucas ferramentas ativas. `godot_get_capabilities` serve para ver a lista completa.
3. `godot_get_classdb_info` consulta tipos da engine; `godot_inspect_object` examina um nó, subrecurso ou `.tres/.res` do projeto, inclusive propriedades de scripts. Inspecione antes de escolher o nome e o tipo de uma propriedade.
4. Para alterações frequentes, use ferramentas tipadas, `dry_run` quando disponível, salve a cena e verifique o resultado no editor ou em execução. `godot_execute_editor_script` é uma saída avançada sem UndoRedo automático e sem interrupção de código que fique preso.

Exemplos curtos para pedir à IA:

| Pedido | Caminho inicial |
| --- | --- |
| “Coloque um material vermelho nessa malha” | Encontrar ferramenta → inspecionar `MeshInstance3D` → atribuir `StandardMaterial3D` → definir `albedo_color` → salvar e capturar a cena. |
| “Anime a posição desta porta” | Inspecionar `AnimationPlayer` e alvo → criar animação de propriedade com duas ou mais chaves → salvar e executar. |
| “Atualize a importação deste modelo” | Conferir `.gltf/.glb.import` → `godot_reimport_asset` com parâmetros existentes → auditar glTF → revisão visual. |
| “Gere uma build” | Conferir preset → prévia de `godot_export_project` → exportar → verificar arquivo gerado e executar no destino. |

## Implementado e validado nesta rodada

| Área | Capacidade | Limite atual |
| --- | --- | --- |
| Descoberta | Catálogo por frase, modo, versão e presença do Better Tile Editor; manifesto gerado em CI | Busca por palavras, sem avaliação formal de ranking em jogos reais; quando o editor está fechado a disponibilidade do addon fica desconhecida. |
| Introspecção | `ClassDB` detalhado e paginado; `Object.get_property_list()`, métodos e sinais de instâncias | `ClassDB` não inclui classes `class_name` de scripts; por isso a inspeção da instância complementa a consulta. |
| Recursos | Criação/edição externa tipada com cópia recuperável; atribuição e mudança de subrecurso com UndoRedo | Conversão genérica cobre bool, int, float, string, Vector2, Vector3 e Color; ainda falta ampliar outros `Variant` e caminhos aninhados. |
| Animação | `AnimationLibrary`, `Animation` e trilha de propriedade com chaves reais, UndoRedo e cena salva | Não edita trilhas existentes, métodos, áudio, Bézier ou máquinas de estados. |
| Importação | Reimportação explícita de imagem, áudio e glTF/GLB; opção escalar existente pode ser alterada com cópia de `.import` | Não registra origem, licença e autoria do asset; a aparência final exige inspeção visual. |
| Exportação | Exportação headless por preset, com caminho limitado a `res://builds/` e verificação do arquivo | Exige templates instalados; a CI ainda não executa uma build exportada por plataforma. |
| GDScript e cenas | Revisão consultiva de estilo, tipos declarados e caminhos de nó; auditoria de estrutura da cena com alertas de nome e profundidade | O revisor é heurístico e não substitui o parser/avisos do Godot; achados dependem da convenção do jogo. |

As operações de recursos, animação e reimportação foram exercitadas por um projeto temporário no editor real em Godot 4.3 e 4.6.3. A exportação possui testes de preset e prévia, mas ainda precisa de integração com templates oficiais e execução do binário gerado.

## Lacunas prioritárias

| Prioridade | Família | Próximo contrato verificável |
| --- | --- | --- |
| P1 | Animação completa | Editar animação existente; suportar trilhas de método, áudio, Bézier e `AnimationTree` com estado reproduzível. |
| P1 | Asset e proveniência | Registrar origem, autor, licença e atribuição junto da configuração de importação; bloquear conclusões de “asset pronto” sem revisão visual. |
| P1 | Navegação 3D em runtime | Provar que um `NavigationAgent3D` encontra e percorre um caminho com obstáculos em uma cena de teste. |
| P1 | Build reproduzível | Criar fluxo de exportação com templates em CI, inicialização do artefato e relatório por plataforma. |
| P2 | Recursos e propriedades | Suportar `Transform`, `Rect2`, arrays, dicionários e subrecursos aninhados com esquema explícito e limites; testar alterações em scripts `class_name`. |
| P2 | Áudio e UI | Inspecionar/editar roteamento de buses e efeitos; construir temas, contêineres e estados de foco com evidência visual. |
| P2 | Física e VFX | Configurar juntas, camadas/máscaras, partículas, shaders e materiais existentes sem script arbitrário; validar no editor e no jogo. |
| P2 | Avaliação da IA | Medir escolha da ferramenta, chamadas, duração, falhas e recuperação em tarefas iguais de jogos 2D e 3D. |

O [plano de cobertura](engine_coverage_plan.md) detalha os critérios para ampliar a ponte. A arquitetura segue o [ClassDB](https://docs.godotengine.org/en/stable/classes/class_classdb.html) e a [introspecção de Object](https://docs.godotengine.org/en/stable/classes/class_object.html); operações editoriais usam [UndoRedo](https://docs.godotengine.org/en/stable/classes/class_editorundoredomanager.html), [importação](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html), [animações](https://docs.godotengine.org/en/stable/classes/class_animation.html) e [exportação pela linha de comando](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) como referências oficiais.
