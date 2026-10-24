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
