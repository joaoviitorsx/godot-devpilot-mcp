# Validação da Fase 9 — Project Intelligence

Projeto: **Godot DevPilot MCP**  
Fase: **9 — Project Intelligence**  
Data: 2026-05-04

---

## 1. Objetivo

Indexar o projeto, construir grafos de dependências e mapas de sinais, detectar sistemas de gameplay, analisar arquitetura e validar convenções.

100% server-side (TypeScript) — funciona sem sessão Godot ativa.

---

## 2. Ferramentas implementadas (10)

```text
godot_project_summary
godot_build_dependency_graph
godot_get_dependency_graph
godot_build_signal_map
godot_get_signal_map
godot_impact_check
godot_trace_flow
godot_detect_gameplay_systems
godot_analyze_architecture
godot_validate_conventions
```

Arquivos:
- `mcp-server/src/indexer/projectIndexer.ts`
- `mcp-server/src/tools/intelligenceTools.ts`

Cache: `.godot_mcp/intel/dependency_graph.json`, `.godot_mcp/intel/signal_map.json`.

---

## 3. Indexador

`projectIndexer.ts` provê:

```text
indexProject(root)              → ProjectFile[]    (scan recursivo, ignora .godot/.godot_mcp/node_modules/.git)
classifyByExt(name)             → ProjectFileKind  (scene/script/resource/asset/other)
buildProjectSummary(root)       → ProjectSummary   (counts + main_scene + largest_files)
buildDependencyGraph(root)      → DependencyGraph  (edges: preload/load/extends/scene_resource)
buildSignalMap(root)            → SignalConnection[]  (parsed de [connection] em .tscn)
checkConventions(files)         → ConventionViolation[]  (PascalCase scenes, snake_case assets, etc.)
```

---

## 4. Segurança

```text
[x] godot_project_summary               read-only allowed
[x] godot_get_dependency_graph          read-only allowed
[x] godot_get_signal_map                read-only allowed
[x] godot_impact_check                  read-only allowed
[x] godot_trace_flow                    read-only allowed
[x] godot_detect_gameplay_systems       read-only allowed
[x] godot_analyze_architecture          read-only allowed
[x] godot_validate_conventions          read-only allowed
[x] godot_build_dependency_graph        bloqueado em read-only (escreve cache)
[x] godot_build_signal_map              bloqueado em read-only (escreve cache)
```

---

## 5. Testes automatizados

`tests/intelligenceTools.test.ts` — 16 testes:

```text
[x] classifyByExt acerta extensões comuns
[x] indexProject ignora .godot
[x] buildProjectSummary retorna counts e main_scene
[x] buildDependencyGraph captura preload + load + scene_resource
[x] buildSignalMap parseia connection lines
[x] checkConventions flagra BadName.png
[x] godot_project_summary retorna data.summary
[x] godot_build_dependency_graph cacheia
[x] godot_get_dependency_graph constrói quando sem cache
[x] godot_impact_check rename_signal afeta scenes
[x] godot_impact_check delete_file flagra dependents
[x] godot_trace_flow encontra path Player→Bullet
[x] godot_detect_gameplay_systems detecta player+enemy
[x] godot_analyze_architecture retorna hubs e signals
[x] godot_validate_conventions reporta violations
[x] read-only bloqueia build mas permite summary
```

---

## 6. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 207/207 passing
[x] 10 ferramentas Phase 9 registradas
[x] Indexer testado em projeto sample
[x] Cache em .godot_mcp/intel/ funciona
[x] Convenções básicas (PascalCase scenes/scripts, snake_case assets) detectadas
```

---

## 7. Limitações conhecidas

```text
[ ] Indexação de signals limitada a [connection] em .tscn — connect() em runtime via código
    GDScript não é capturado (precisaria de runtime introspection — Fase 8)
[ ] checkConventions tem regras simples — usuário pode customizar via Phase 10
    set_convention + futura tool validate_against_conventions
[ ] Dependency graph não resolve paths relativos em extends (apenas literais)
[ ] trace_flow é DFS limitado a max_depth — pode perder caminhos longos
```

---

## 8. Status

```text
[x] Aprovada (sem dependências de Godot ativo)
```

Gate Fase 10: liberado.
