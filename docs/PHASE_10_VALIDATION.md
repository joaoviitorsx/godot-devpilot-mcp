# Validação da Fase 10 — Project Memory

Projeto: **Godot DevPilot MCP**  
Fase: **10 — Project Memory**  
Data: 2026-05-04

---

## 1. Objetivo

Persistir contexto entre sessões: resumo do projeto, arquitetura, convenções, ADRs, sistemas de gameplay e tarefa atual. Tudo em arquivos markdown sob `.godot_mcp/memory/`.

100% server-side (TypeScript).

---

## 2. Ferramentas implementadas (8)

```text
godot_update_project_memory       — escreve qualquer slot de memória
godot_get_project_memory          — lê project_summary.md
godot_get_architecture_notes      — lê architecture.md
godot_get_conventions             — lê conventions.md
godot_set_convention              — adiciona/atualiza regra em conventions.md
godot_create_decision_record      — cria ADR numerado em decisions/
godot_search_memory               — grep across .md files
godot_get_current_task_context    — lê current_task.md
```

Arquivo: `mcp-server/src/tools/memoryTools.ts`.

Layout em disco:

```text
.godot_mcp/memory/
├── project_summary.md
├── architecture.md
├── conventions.md
├── gameplay_systems.md
├── current_task.md
└── decisions/
    ├── 0001-<slug>.md
    ├── 0002-<slug>.md
    └── ...
```

---

## 3. Slots reconhecidos por update_project_memory

```text
summary             → project_summary.md
architecture        → architecture.md
conventions         → conventions.md
gameplay_systems    → gameplay_systems.md
current_task        → current_task.md
```

Modos: `append:false` (overwrite, padrão) ou `append:true`.

---

## 4. Segurança

```text
[x] godot_get_project_memory          read-only allowed
[x] godot_get_architecture_notes      read-only allowed
[x] godot_get_conventions             read-only allowed
[x] godot_search_memory               read-only allowed
[x] godot_get_current_task_context    read-only allowed
[x] godot_update_project_memory       bloqueado em read-only
[x] godot_set_convention              bloqueado em read-only
[x] godot_create_decision_record      bloqueado em read-only
[x] Slot validado por enum (Zod) — apenas valores conhecidos aceitos
[x] ADR numerado sequencialmente, slug normalizado (lowercase, hifens)
[x] set_convention usa upsert por chave (substitui bloco existente)
```

---

## 5. Testes automatizados

`tests/memoryTools.test.ts` — 10 testes:

```text
[x] update + get summary roundtrip
[x] get_project_memory found=false sem arquivo
[x] update append=true preserva conteúdo
[x] set_convention escreve regra
[x] set_convention upsert chave existente
[x] create_decision_record escreve ADR 0001
[x] create_decision_record incrementa numeração 0002
[x] search_memory encontra substring em vários arquivos
[x] get_current_task_context retorna conteúdo
[x] read-only bloqueia update mas permite get
```

Total projeto: 24 files / 207 tests passing.

---

## 6. Integração com Fase 9

Fluxo recomendado:

```text
1. godot_project_summary (Phase 9)             → gera estatísticas
2. godot_update_project_memory file=summary    → persiste markdown gerado
3. godot_validate_conventions (Phase 9)        → lista violations
4. godot_set_convention (Phase 10)             → registra regras aceitas
5. godot_create_decision_record (Phase 10)     → ADR para decisões grandes
```

---

## 7. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 207/207 passing
[x] 8 ferramentas Phase 10 registradas
[x] Layout .godot_mcp/memory/ criado on-demand
[x] ADR numbering sequencial verificado
[x] Convention upsert verificado
[x] Search markdown across diretório verificado
```

---

## 8. Status

```text
[x] Aprovada (sem dependência de Godot ativo)
```

Gate Fase 11: liberado, mas Fases 11–13 (Toolkits 2D/3D/especializados) são compostas e devem ser implementadas em iterações separadas.
