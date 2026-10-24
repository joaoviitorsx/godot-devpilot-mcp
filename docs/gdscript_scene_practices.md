# GDScript e cenas: práticas para a IA aplicar

Este guia orienta a criação de código e nós. As recomendações seguem o [guia oficial de estilo de GDScript](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_styleguide.html), [tipagem estática](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html), [organização de cenas](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html), [organização do projeto](https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html) e [avisos de GDScript](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/warning_system.html). Convenções do jogo já existente têm precedência quando forem deliberadas e consistentes.

## Ao criar ou mudar um script

1. Leia o script, a cena que o usa e os sinais/recursos relacionados. Mantenha uma responsabilidade clara; divida um sistema quando partes precisarem ser reutilizadas ou testadas de forma independente.
2. Use `snake_case` em arquivos, funções, variáveis e sinais; `PascalCase` para `class_name` e nomes de nós; `CONSTANT_CASE` para constantes comuns. Um `const` que carrega uma classe com `preload` pode usar `PascalCase`.
3. Anote tipos em interfaces públicas, parâmetros e retornos quando isso esclarecer o contrato. Use `:=` somente quando a inferência for clara. Tipagem é opcional no Godot; trate ausência de tipo como oportunidade de revisão, não erro automático.
4. Prefira `and`, `or`, `not`, linhas legíveis e uma instrução por linha. Use `@export` para parâmetros de design que o editor deve mostrar e `@onready` para dependências internas de nós.
5. Evite caminhos rígidos que sobem para fora da própria cena. Quando uma cena reutilizável depende de outra, exponha a dependência ou conecte sinais no pai. Se a configuração for obrigatória, `_get_configuration_warnings()` pode orientar quem edita a cena.
6. Valide no parser do Godot e observe os avisos configurados pelo projeto. Use `devpilot_review_gdscript` como revisão consultiva; ela não substitui compilação, testes ou playtest.

## Ao criar nós e cenas

1. Escolha o nó mais específico que atende ao comportamento; não adicione scripts a nós que só carregam dados ou recursos.
2. Defina um ponto de entrada claro para o jogo. Mantenha mundos, interface e sistemas com responsabilidades reconhecíveis, ajustando a hierarquia ao projeto em vez de impor uma árvore fixa.
3. Coloque um nó como filho quando sua vida útil depender do pai. Encapsule em uma `PackedScene` quando o conjunto precisar de identidade e reuso.
4. Guarde assets próximos da cena que os usa quando isso tornar o projeto mais navegável; use diretórios compartilhados para recursos de uso amplo. Evite renomear nós sem procurar referências de `NodePath` e conexões.
5. Use `godot_analyze_scene_architecture` e `godot_audit_scene` para encontrar problemas concretos. Profundidade alta é um sinal de revisão estrutural, não uma medida direta de desempenho. Muitos filhos do mesmo tipo e nós sem script são situações normais.

## Fluxo curto da IA

`devpilot_game_context` → `devpilot_find_tools` → inspecionar cena e propriedades → editar uma fatia pequena → `devpilot_review_gdscript` e validação do Godot → executar a cena → conferir logs e comportamento observável.

Para mudanças grandes, documente a estrutura pretendida em uma frase antes de criar os nós. Ao concluir, relate o que foi validado automaticamente e o que depende de julgamento visual ou de jogabilidade.
