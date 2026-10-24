# Proposta de nome para distribuição

## Nome recomendado: GodoPilot

**Assinatura:** *GodoPilot — seu copiloto para criar jogos no Godot.*

“Godo” remete imediatamente ao Godot; “Pilot” descreve o papel do MCP ao lado de Claude, Codex e outros clientes. O nome é curto, pronunciável em português e inglês, e abrange cenas, scripts, tiles, testes e fluxos de criação. Na apresentação pública, usar **GodoPilot for Godot** como descrição; o nome técnico do servidor pode ser **GodoPilot MCP**.

Uma busca exploratória na web em 24/10/2026 não encontrou uso evidente de “GodoPilot” no contexto de software ou game development. Isso não equivale a uma busca de marcas, domínios e lojas. Antes de publicar, verificar marca no INPI e em mercados de interesse, domínio, GitHub, npm e Asset Library. A comunicação deve identificar o produto como ferramenta independente da comunidade e seguir as [orientações oficiais do Godot](https://godotengine.org/press/) para o uso do nome e da identidade visual.

Alternativas: **GodoNauta** (mais autoral, forte em português) e **GodoSail** (mais próximo da proposta inicial SceneSail). A busca encontrou um projeto Godot chamado [GodoForge](https://github.com/Dragonboon), portanto esse nome foi descartado.

## Migração sugerida após a escolha do nome

1. Atualizar nome visível, descrição, ícone, documentação e exemplos.
2. Publicar um release com aliases para o antigo identificador MCP e instruções de atualização para quem já instalou `godot-devpilot-mcp`.
3. Renomear pacote, comando, addon e identificadores internos em etapas, mantendo compatibilidade por pelo menos uma versão de transição.
4. Validar instalação limpa e atualização com Claude Code e Codex, além da matriz Godot 4.3+ e Better Tile Editor 4.6+.

O nome atual permanece nos identificadores técnicos enquanto a marca é avaliada, evitando quebrar instalações existentes.

## Ícone

O ícone do GodoPilot é um controle de jogo azul com rosto amigável, direcional branco e botões laranja. O azul remete ao ecossistema Godot; a silhueta e o rosto foram desenhados para identificar este projeto de forma própria. O símbolo oficial do Godot não é usado como marca do MCP, conforme as [diretrizes de uso do Godot Engine](https://godotengine.org/press/).

- Fonte vetorial: [`logos/export/logo.svg`](../logos/export/logo.svg).
- Prévia dos três conceitos e conferência em 64, 32 e 16 pixels: [`logos/preview.html`](../logos/preview.html).
- Ícone do projeto de desenvolvimento Godot: [`icon.svg`](../icon.svg), derivado em 128 × 128 pixels para preservar o tamanho dos sprites nas cenas de demonstração.
- Exportações PNG estão em `logos/export/`, de 16 a 2048 pixels.

O processo de criação seguiu a [logo-designer-skill](https://github.com/neonwatty/logo-designer-skill) (licença MIT), com três direções originais e teste de legibilidade em tamanhos pequenos. O conceito **Controle** foi escolhido para a versão final. O GodoPilot é independente e não endossado pelo projeto Godot.
