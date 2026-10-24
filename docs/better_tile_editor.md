# Tiles e Better Tile Editor

O MCP pode criar um atlas `TileSet` a partir de uma textura já importada no projeto. Em Godot 4.6+, também pode usar o addon opcional [Better Tile Editor](https://github.com/cidwel/BetterTileEditor) para criar terrenos, associar tiles e pintar células de um `TileMapLayer`. O addon de terceiros não é distribuído neste pacote.

## Instalação opcional

1. Instale a versão do Better Tile Editor compatível com seu Godot em `res://addons/better-tile-editor/` e ative o plugin em **Project Settings → Plugins**. Consulte as [instruções oficiais](https://github.com/cidwel/BetterTileEditor) e a [página do Godot Asset Library](https://store.godotengine.org/asset/cidwel/better-tile-editor/).
2. Instale o Godot DevPilot MCP no mesmo jogo e ative seu plugin. Para ferramentas de criação e edição, configure o cliente com `--read-write --mode full` (ou `agentic`).
3. Abra uma cena que contenha um `TileMapLayer` com `TileSet` atribuído. As ferramentas usam `node_path` relativo à raiz da cena aberta; use `"."` quando a raiz for o próprio `TileMapLayer`.
4. Chame `godot_better_tile_editor_status` para confirmar instalação e ativação. As operações de terreno exigem o arquivo `BetterTileEditor.gd`; o atlas funciona mesmo sem esse addon.

## Fluxo recomendado

1. Coloque um spritesheet no jogo e aguarde a importação do Godot. Chame `godot_create_tile_atlas` com `texture_path: "res://assets/tiles.png"`, `tileset_path: "res://assets/tileset.tres"`, `tile_width` e `tile_height`. O comando cria um tile para cada região completa da imagem, até 4096 tiles, sem inferir colisões ou regras de vizinhança.
2. Atribua `res://assets/tileset.tres` ao `TileMapLayer` e salve a cena. Abra a cena com `godot_open_scene`.
3. Chame `godot_better_tile_editor_create_terrain` com `node_path`, `name`, `color` e `terrain_type` (`match_tiles`, `match_vertices`, `category` ou `single`). Guarde o `terrain_id` retornado.
4. Associe os tiles relevantes com `godot_better_tile_editor_assign_tile`, informando `terrain_id`, `source_id` (0 para o atlas recém-criado), `atlas_x` e `atlas_y`. A associação básica identifica o terreno; regras detalhadas de vizinhança ainda podem precisar de ajuste no editor visual.
5. Use `godot_better_tile_editor_paint_terrain` com `cells: [{"x": 0, "y": 0}, ...]`. O MCP pede ao addon que coloque as células, atualize vizinhos e salve a cena. `godot_better_tile_editor_list_terrains` lista os IDs disponíveis.

Os comandos de escrita aceitam `dry_run: true`. O servidor salva uma cópia do arquivo afetado em `.godot_mcp/backups/` antes de sobrescrever um atlas, modificar um TileSet ou pintar uma cena. A operação exige cena salva. Em modo somente leitura, status e listagem funcionam; alterações são bloqueadas.

O suporte principal do DevPilot permanece Godot 4.3+. O Better Tile Editor atual exige Godot 4.6+, portanto o uso de terrenos é opcional e deve ser testado na versão do editor do seu jogo. A integração chama a API pública do addon instalado, sem copiar seu código nem criar dependência obrigatória. A criação de arte original do spritesheet continua a cargo de um editor de imagem ou pipeline de assets; o MCP transforma uma textura existente em TileSet e organiza os terrenos.
