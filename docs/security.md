# Security — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento define as políticas de segurança do **Godot DevPilot MCP**.

Como o projeto permite que assistentes de IA interajam com o editor Godot, arquivos, cenas, scripts e runtime, a segurança deve ser parte central da arquitetura.

O objetivo é evitar que a IA, por erro de interpretação, ferramenta mal utilizada ou entrada inadequada, consiga:

- Alterar arquivos fora do projeto;
- Sobrescrever arquivos sem backup;
- Excluir arquivos de forma irreversível;
- Corromper cenas;
- Aplicar refatorações amplas sem revisão;
- Executar mutações sem possibilidade de desfazer;
- Rodar ações destrutivas sem confirmação;
- Gerar mudanças difíceis de auditar.

---

## 2. Princípios de segurança

## 2.1 IA não é uma fonte confiável

Toda entrada vinda da IA deve ser tratada como não confiável.

Isso inclui:

```text
- paths;
- nomes de arquivos;
- nomes de nós;
- propriedades;
- valores;
- scripts gerados;
- comandos de refatoração;
- descrições em linguagem natural;
- planos de alteração.
```

A IA pode errar, inventar caminhos, escolher arquivos incorretos ou gerar operações muito amplas. Por isso, o servidor e o plugin devem validar tudo.

## 2.2 Defesa em profundidade

A segurança deve existir em mais de uma camada.

```text
Cliente IA
  ↓
Servidor MCP valida
  ↓
Plugin Godot revalida
  ↓
Godot executa apenas operação permitida
```

Nenhuma camada deve confiar integralmente na camada anterior.

## 2.3 Segurança antes de conveniência

Quando houver conflito entre segurança e facilidade de uso, a segurança deve vencer.

Exemplos:

```text
- Melhor exigir dry_run do que aplicar uma refatoração perigosa diretamente.
- Melhor criar backup excessivo do que perder arquivo.
- Melhor bloquear path suspeito do que tentar normalizar silenciosamente.
- Melhor retornar erro do que executar comando ambíguo.
```

## 2.4 Ações devem ser auditáveis

Toda alteração relevante deve deixar rastro.

O projeto deve registrar:

```text
- ferramenta chamada;
- parâmetros relevantes;
- arquivos afetados;
- cena afetada;
- nós afetados;
- resultado;
- duração;
- erro, se houver;
- backup criado, se houver.
```

---

## 3. Modelo de ameaças

## 3.1 Ameaças principais

### 3.1.1 Sobrescrita acidental de arquivos

A IA pode tentar reescrever um script inteiro quando bastaria aplicar um patch pequeno.

Risco:

```text
Perda de código funcional.
```

Mitigações:

```text
- Preferir patch_file a write_file;
- Criar backup antes de sobrescrever;
- Exigir overwrite=true;
- Registrar diff quando possível;
- Permitir dry_run.
```

### 3.1.2 Exclusão irreversível

A IA pode excluir arquivo, cena ou diretório incorreto.

Risco:

```text
Perda de assets, scripts ou cenas.
```

Mitigações:

```text
- Não usar delete definitivo por padrão;
- Mover para .godot_mcp/trash;
- Exigir confirm=true para exclusões críticas;
- Registrar operação;
- Permitir restauração futura.
```

### 3.1.3 Path traversal

A IA ou um cliente mal configurado pode enviar caminhos como:

```text
../
../../
C:\Users\...
/home/user/...
/tmp/...
```

Risco:

```text
Acesso ou alteração fora do projeto Godot.
```

Mitigações:

```text
- Aceitar preferencialmente paths res://;
- Normalizar paths;
- Bloquear qualquer path fora do projeto;
- Validar no servidor e no plugin;
- Rejeitar paths com traversal explícito.
```

### 3.1.4 Corrupção de cenas

A IA pode alterar uma cena `.tscn` de forma inconsistente.

Risco:

```text
Cena deixar de abrir na Godot.
```

Mitigações:

```text
- Manipular cenas pela API da Godot sempre que possível;
- Evitar edição textual direta de .tscn;
- Criar backup antes de salvar;
- Validar cena após alteração;
- Usar UndoRedo em mutações do editor.
```

### 3.1.5 Refatoração perigosa

A IA pode renomear símbolos, sinais ou arquivos usados em vários pontos.

Risco:

```text
Quebra em cascata de cenas, scripts e sinais.
```

Mitigações:

```text
- impact_check antes da refatoração;
- dry_run obrigatório;
- limitar número de arquivos afetados;
- backup obrigatório;
- relatório de mudanças;
- validação após aplicação.
```

### 3.1.6 Execução descontrolada

A IA pode iniciar o projeto repetidamente ou deixar processos abertos.

Risco:

```text
Travamento, consumo excessivo de recursos, múltiplas instâncias abertas.
```

Mitigações:

```text
- Verificar is_game_running antes de rodar;
- Timeouts;
- Stop controlado;
- Limite de execuções por janela de tempo;
- Logs de runtime.
```

### 3.1.7 Alterações sem UndoRedo

A IA pode modificar a cena de forma irreversível dentro do editor.

Risco:

```text
Usuário não consegue desfazer pelo Ctrl+Z.
```

Mitigações:

```text
- Usar EditorUndoRedoManager;
- Proibir mutações diretas quando houver alternativa com UndoRedo;
- Registrar falhas de UndoRedo;
- Retornar erro se a mutação não puder ser feita com segurança.
```

### 3.1.8 Excesso de permissões

Todas as ferramentas estarem disponíveis em todos os momentos pode aumentar risco.

Risco:

```text
Ferramentas destrutivas chamadas acidentalmente.
```

Mitigações:

```text
- Modos minimal/core/full/agentic;
- Modo read-only;
- Permission presets;
- Ferramentas críticas exigem confirmação;
- Ferramentas agentic executam primeiro em dry_run.
```

---

## 4. Camadas de segurança

## 4.1 Camada do servidor MCP

O servidor MCP é a primeira barreira de segurança.

Responsabilidades:

```text
- Validar schemas;
- Validar paths;
- Aplicar modo read-only;
- Aplicar permissões;
- Criar backups;
- Controlar dry_run;
- Bloquear ferramentas indisponíveis no modo atual;
- Registrar logs;
- Normalizar erros;
- Controlar timeouts.
```

## 4.2 Camada do plugin Godot

O plugin deve revalidar a operação recebida.

Responsabilidades:

```text
- Validar método interno;
- Validar path res://;
- Validar cena aberta;
- Validar existência de nó;
- Validar tipo de nó via ClassDB;
- Validar propriedade;
- Usar UndoRedo;
- Bloquear mutações inseguras;
- Retornar erros acionáveis.
```

## 4.3 Camada de filesystem

Operações em arquivo devem passar por regras rígidas.

Responsabilidades:

```text
- Normalizar caminhos;
- Bloquear traversal;
- Criar backup;
- Usar trash seguro;
- Evitar sobrescrita sem confirmação;
- Registrar arquivos afetados.
```

## 4.4 Camada de auditoria

Toda alteração deve ser rastreável.

Responsabilidades:

```text
- Registrar chamadas;
- Registrar alterações;
- Registrar backups;
- Registrar erros;
- Registrar ferramentas bloqueadas;
- Registrar modo ativo;
- Gerar relatórios quando necessário.
```

---

## 5. Path sandbox

## 5.1 Regra principal

Toda operação de projeto deve ficar limitada ao projeto Godot.

Preferencialmente, caminhos devem usar:

```text
res://
```

Exemplos válidos:

```text
res://scripts/Player.gd
res://scenes/Main.tscn
res://assets/player.png
res://ui/HUD.tscn
```

Exemplos inválidos:

```text
../Player.gd
../../secrets.txt
C:\Users\User\Documents\file.txt
/home/user/file.txt
/tmp/file.txt
file:///etc/passwd
```

## 5.2 Regras de validação

O servidor deve:

```text
1. Rejeitar paths vazios quando o path for obrigatório.
2. Rejeitar paths com traversal explícito.
3. Resolver o path físico do projeto.
4. Normalizar o path final.
5. Garantir que o path final está dentro da raiz do projeto.
6. Converter para res:// quando possível.
```

O plugin deve:

```text
1. Rejeitar path fora de res:// para operações Godot.
2. Rejeitar path com ..
3. Rejeitar path absoluto do sistema operacional quando não permitido.
4. Retornar PATH_OUTSIDE_PROJECT em caso de falha.
```

## 5.3 Pseudocódigo no servidor

```ts
function assertInsideProject(inputPath: string, projectRoot: string): string {
  if (!inputPath || inputPath.trim().length === 0) {
    throw new SecurityError("INVALID_PARAMS", "Path vazio.");
  }

  if (inputPath.includes("..")) {
    throw new SecurityError("PATH_OUTSIDE_PROJECT", "Path traversal bloqueado.");
  }

  const normalized = normalizeProjectPath(inputPath, projectRoot);

  if (!normalized.absolutePath.startsWith(projectRoot)) {
    throw new SecurityError("PATH_OUTSIDE_PROJECT", "Acesso fora do projeto bloqueado.");
  }

  return normalized.resPath;
}
```

## 5.4 Paths internos permitidos

O projeto pode criar arquivos internos em:

```text
.godot_mcp/
```

Subpastas permitidas:

```text
.godot_mcp/backups/
.godot_mcp/logs/
.godot_mcp/trash/
.godot_mcp/screenshots/
.godot_mcp/index/
.godot_mcp/memory/
.godot_mcp/reports/
.godot_mcp/tests/
```

Essas pastas devem ficar dentro da raiz do projeto.

---

## 6. Modo read-only

## 6.1 Objetivo

O modo read-only permite que a IA analise o projeto sem alterá-lo.

Uso recomendado:

```text
- auditoria inicial;
- análise de arquitetura;
- exploração de projeto desconhecido;
- revisão de código;
- investigação de bugs antes de aplicar correção.
```

## 6.2 Ferramentas permitidas em read-only

```text
godot_health_check
godot_get_capabilities
godot_get_project_info
godot_get_project_settings
godot_get_editor_context
godot_get_open_scenes
godot_get_selected_nodes
godot_get_input_map
godot_get_autoloads
godot_list_files
godot_search_files
godot_read_file
godot_get_scene_tree
godot_get_scene_summary
godot_get_node_properties
godot_read_script
godot_validate_script
godot_get_script_symbols
godot_find_references
godot_get_signal_connections
godot_get_output_logs
godot_get_debugger_errors
godot_project_summary
godot_get_dependency_graph
godot_get_signal_map
godot_impact_check
```

## 6.3 Ferramentas bloqueadas em read-only

```text
godot_write_file
godot_patch_file
godot_delete_file_safe
godot_move_file
godot_rename_file
godot_create_scene
godot_save_scene
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_set_node_property
godot_create_script
godot_attach_script
godot_connect_signal
godot_disconnect_signal
godot_add_input_action
godot_remove_input_action
godot_add_autoload
godot_remove_autoload
godot_refactor_safely
godot_build_feature
godot_create_gameplay_system
```

## 6.4 Resposta quando bloqueado

```json
{
  "ok": false,
  "error": {
    "code": "READ_ONLY_MODE",
    "message": "A ferramenta solicitada está bloqueada porque o servidor está em modo read-only.",
    "details": {
      "tool": "godot_patch_file"
    },
    "suggestions": [
      "Execute a ferramenta em dry_run para obter um plano sem aplicar alterações.",
      "Altere o modo do servidor para core ou full com permissão de escrita."
    ]
  }
}
```

---

## 7. Dry run

## 7.1 Objetivo

`dry_run` permite simular uma operação sem alterar arquivos, cenas ou runtime.

Toda ferramenta destrutiva ou de impacto alto deve suportar `dry_run`.

## 7.2 Ferramentas que devem suportar dry_run

```text
godot_write_file
godot_patch_file
godot_move_file
godot_rename_file
godot_delete_file_safe
godot_create_scene
godot_save_scene
godot_duplicate_scene
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_set_node_property
godot_create_script
godot_attach_script
godot_connect_signal
godot_disconnect_signal
godot_add_input_action
godot_remove_input_action
godot_add_autoload
godot_remove_autoload
godot_refactor_safely
godot_build_feature
godot_create_gameplay_system
godot_run_validation_loop
```

## 7.3 Formato de resposta em dry_run

```json
{
  "ok": true,
  "data": {
    "dry_run": true,
    "would_change": true,
    "planned_changes": [
      {
        "type": "patch_file",
        "path": "res://scripts/Player.gd",
        "summary": "Substituir speed = 200 por speed = 300"
      }
    ],
    "affected_files": [
      "res://scripts/Player.gd"
    ],
    "affected_nodes": []
  },
  "message": "Dry run concluído. Nenhuma alteração foi aplicada.",
  "warnings": [],
  "suggestions": [
    "Execute novamente com dry_run=false para aplicar as alterações."
  ]
}
```

## 7.4 Regra importante

O resultado do `dry_run` deve refletir o mais fielmente possível a execução real.

Não é aceitável que `dry_run` apenas retorne uma mensagem genérica.

---

## 8. Backup automático

## 8.1 Objetivo

Evitar perda de arquivos em caso de alteração incorreta.

## 8.2 Quando criar backup

Criar backup antes de alterar arquivos existentes.

Extensões prioritárias:

```text
.gd
.tscn
.scn
.tres
.res
.cfg
.import
.json
.md
```

Ferramentas que devem criar backup:

```text
godot_write_file com overwrite=true
godot_patch_file
godot_move_file
godot_rename_file
godot_delete_file_safe
godot_save_scene
godot_refactor_safely
godot_build_feature
godot_create_gameplay_system
```

## 8.3 Estrutura de backups

```text
.godot_mcp/backups/
└── YYYY-MM-DD/
    ├── scripts/
    │   └── Player.gd.120000.bak
    ├── scenes/
    │   └── Main.tscn.120005.bak
    └── metadata.jsonl
```

## 8.4 Metadata do backup

Cada backup deve ser registrado.

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "original_path": "res://scripts/Player.gd",
  "backup_path": ".godot_mcp/backups/2026-05-03/scripts/Player.gd.120000.bak",
  "tool": "godot_patch_file",
  "reason": "Antes de aplicar patch",
  "size_bytes": 2048
}
```

## 8.5 Falha de backup

Se o backup falhar, a alteração não deve continuar.

Resposta esperada:

```json
{
  "ok": false,
  "error": {
    "code": "BACKUP_FAILED",
    "message": "Não foi possível criar backup. A alteração foi cancelada.",
    "details": {
      "path": "res://scripts/Player.gd"
    },
    "suggestions": [
      "Verifique permissões de escrita na pasta .godot_mcp/backups.",
      "Verifique se há espaço disponível em disco."
    ]
  }
}
```

---

## 9. Safe trash

## 9.1 Objetivo

Evitar exclusão irreversível.

Ferramentas de exclusão devem mover arquivos para:

```text
.godot_mcp/trash/
```

em vez de apagar definitivamente.

## 9.2 Estrutura

```text
.godot_mcp/trash/
└── YYYY-MM-DD/
    └── scripts/
        └── OldPlayer.gd.120000.deleted
```

## 9.3 Metadata

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "original_path": "res://scripts/OldPlayer.gd",
  "trash_path": ".godot_mcp/trash/2026-05-03/scripts/OldPlayer.gd.120000.deleted",
  "tool": "godot_delete_file_safe",
  "confirm": true
}
```

## 9.4 Exclusão definitiva

Exclusão definitiva não deve existir no MVP.

Se for adicionada futuramente, deve exigir:

```text
- confirm=true;
- modo específico de permissão;
- dry_run prévio;
- log explícito;
- mensagem de risco;
- confirmação humana no cliente, quando possível.
```

---

## 10. UndoRedo

## 10.1 Objetivo

Permitir que o usuário desfaça ações da IA pelo editor Godot.

Toda mutação de cena/nó deve usar `EditorUndoRedoManager` quando possível.

## 10.2 Ferramentas que devem usar UndoRedo

```text
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_set_node_property
godot_attach_script
godot_connect_signal
godot_disconnect_signal
godot_add_node_to_group
godot_remove_node_from_group
godot_create_animation_player
godot_add_keyframe
```

## 10.3 Regra de falha

Se uma mutação exige UndoRedo e o UndoRedo falhar, a ferramenta deve retornar erro.

```json
{
  "ok": false,
  "error": {
    "code": "UNDO_FAILED",
    "message": "Não foi possível registrar a ação no UndoRedo. A mutação foi cancelada.",
    "details": {
      "tool": "godot_add_node"
    },
    "suggestions": [
      "Tente executar a operação manualmente no editor.",
      "Verifique se há uma cena aberta e editável."
    ]
  }
}
```

## 10.4 Ações compostas

Ferramentas agentic que fazem várias mutações devem usar uma das estratégias:

```text
1. Uma ação UndoRedo agrupada, se tecnicamente possível.
2. Várias ações UndoRedo pequenas, com relatório claro.
3. Dry run obrigatório antes da execução.
```

---

## 11. Permission presets

## 11.1 Objetivo

Permitir diferentes níveis de controle da IA sobre o projeto.

## 11.2 Presets sugeridos

### `readonly`

Somente leitura e análise.

```text
Permite:
- leitura de projeto;
- leitura de arquivos;
- análise de cena;
- logs;
- impact_check.

Bloqueia:
- escrita;
- mutações;
- execução;
- input simulation;
- refatoração.
```

### `safe_edit`

Permite edição segura.

```text
Permite:
- patch_file com backup;
- add_node com UndoRedo;
- set_property com UndoRedo;
- create_script;
- validate_script.

Bloqueia:
- exclusão;
- refatorações amplas;
- agentic tools aplicando mudanças sem dry_run;
- alterações fora de escopo.
```

### `dev_full`

Permite desenvolvimento completo local.

```text
Permite:
- edição;
- execução;
- screenshots;
- input simulation;
- runtime analysis;
- toolkits.

Ainda exige:
- backup;
- UndoRedo;
- dry_run para ações críticas;
- logs.
```

### `agentic_guarded`

Permite ferramentas agentic, mas com proteções fortes.

```text
Permite:
- build_feature;
- fix_errors;
- create_gameplay_system;
- refactor_safely.

Exige:
- dry_run inicial;
- limite de arquivos;
- relatório de plano;
- backup;
- validação final;
- confirmação para aplicar.
```

## 11.3 Configuração exemplo

```json
{
  "security": {
    "permissionPreset": "safe_edit",
    "readOnly": false,
    "requireDryRunForAgenticTools": true,
    "maxFilesPerOperation": 10,
    "allowDelete": false
  }
}
```

---

## 12. Confirmação para ações críticas

## 12.1 Ações críticas

Devem exigir `confirm: true`:

```text
godot_delete_file_safe
godot_remove_node quando node_path é root
godot_rename_file em lote
godot_move_file em lote
godot_refactor_safely com mais de N arquivos
godot_build_feature aplicando alterações
godot_create_gameplay_system aplicando alterações
godot_clear_logs se apagar histórico persistente
godot_clear_backups se implementado futuramente
```

## 12.2 Resposta sem confirmação

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Esta operação exige confirmação explícita.",
    "details": {
      "required_param": "confirm",
      "required_value": true
    },
    "suggestions": [
      "Execute primeiro com dry_run=true para revisar o impacto.",
      "Reenvie a operação com confirm=true somente se tiver certeza."
    ]
  }
}
```

---

## 13. Logs de auditoria

## 13.1 Objetivo

Permitir rastrear tudo que a IA tentou fazer.

## 13.2 Local

```text
.godot_mcp/logs/actions.jsonl
```

## 13.3 Formato

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "request_id": "request-001",
  "source": "mcp-server",
  "tool": "godot_patch_file",
  "mode": "core",
  "permission_preset": "safe_edit",
  "params_summary": {
    "path": "res://scripts/Player.gd",
    "dry_run": false
  },
  "affected_files": [
    "res://scripts/Player.gd"
  ],
  "affected_nodes": [],
  "backup_paths": [
    ".godot_mcp/backups/2026-05-03/scripts/Player.gd.120000.bak"
  ],
  "status": "ok",
  "duration_ms": 42
}
```

## 13.4 Logs de erro

```json
{
  "timestamp": "2026-05-03T12:00:00.000Z",
  "request_id": "request-002",
  "source": "mcp-server",
  "tool": "godot_write_file",
  "status": "blocked",
  "error_code": "PATH_OUTSIDE_PROJECT",
  "message": "Acesso fora do projeto bloqueado.",
  "params_summary": {
    "path": "../../secrets.txt"
  }
}
```

## 13.5 O que não registrar

Evitar registrar conteúdo completo de arquivos grandes.

Registrar apenas:

```text
- path;
- hash opcional;
- resumo da alteração;
- tamanho;
- número de linhas afetadas.
```

---

## 14. Política para arquivos sensíveis

## 14.1 Arquivos potencialmente sensíveis

```text
.env
*.key
*.pem
*.p12
*.pfx
credentials.json
secrets.json
service-account.json
```

## 14.2 Regra

Por padrão:

```text
- Não ler arquivos sensíveis;
- Não escrever arquivos sensíveis;
- Não exibir conteúdo sensível;
- Não incluir conteúdo sensível em logs.
```

## 14.3 Resposta ao tentar ler arquivo sensível

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "A leitura deste tipo de arquivo está bloqueada por política de segurança.",
    "details": {
      "path": "res://.env"
    },
    "suggestions": [
      "Se necessário, configure uma allowlist explícita para esse arquivo."
    ]
  }
}
```

---

## 15. Segurança de scripts gerados

## 15.1 Riscos

Scripts gerados pela IA podem conter:

```text
- loops infinitos;
- chamadas desnecessárias em _process;
- acesso indevido a filesystem;
- código com sintaxe antiga;
- dependências inexistentes;
- sinais quebrados;
- uso incorreto de await;
- chamadas perigosas de OS ou ProjectSettings.
```

## 15.2 Regras

Antes de aplicar script gerado:

```text
1. Criar backup se arquivo existir.
2. Validar sintaxe.
3. Detectar padrões Godot 3 quando alvo for Godot 4.
4. Alertar uso de APIs sensíveis.
5. Preferir patch pequeno a sobrescrita total.
6. Registrar alteração.
```

## 15.3 APIs sensíveis

Alertar quando scripts gerados usarem:

```text
OS.execute
OS.create_process
DirAccess.remove_absolute
FileAccess.open com path absoluto
ProjectSettings.set_setting
Engine.time_scale
get_tree().quit
```

Nem sempre essas APIs são proibidas, mas devem gerar warning.

---

## 16. Segurança de runtime

## 16.1 Execução do projeto

Ferramentas como `godot_run_project` e `godot_run_scene` devem:

```text
- verificar se já existe execução ativa;
- evitar múltiplas instâncias acidentais;
- aceitar timeout;
- registrar início e fim;
- permitir stop controlado;
- coletar logs por execução.
```

## 16.2 Input simulation

Input simulation deve ser permitido apenas em contexto local e controlado.

Regras:

```text
- Só simular input quando runtime estiver ativo;
- Preferir InputMap actions a teclas absolutas;
- Limitar duração máxima de sequência;
- Registrar sequência executada;
- Permitir cancelamento/timeout;
- Não enviar input para aplicações externas.
```

## 16.3 Screenshots

Screenshots devem ser salvos dentro do projeto:

```text
.godot_mcp/screenshots/
```

Evitar capturar janelas externas ao jogo/editor quando possível.

---

## 17. Segurança de ferramentas agentic

## 17.1 Risco

Ferramentas agentic são mais perigosas porque coordenam múltiplas ações.

Exemplos:

```text
godot_build_feature
godot_refactor_safely
godot_create_gameplay_system
godot_fix_errors
godot_run_validation_loop
```

## 17.2 Regras obrigatórias

Ferramentas agentic devem:

```text
1. Executar primeiro em dry_run por padrão.
2. Retornar plano detalhado.
3. Listar arquivos afetados.
4. Listar cenas afetadas.
5. Listar nós afetados.
6. Listar riscos.
7. Exigir confirmação para aplicar.
8. Criar backups antes de alterar.
9. Aplicar mudanças em etapas.
10. Validar após cada etapa crítica.
11. Gerar relatório final.
```

## 17.3 Limites recomendados

```json
{
  "agenticLimits": {
    "maxFilesPerOperation": 10,
    "maxScenesPerOperation": 3,
    "maxNodesPerOperation": 30,
    "maxRuntimeSeconds": 60,
    "requireDryRun": true,
    "requireConfirm": true
  }
}
```

## 17.4 Relatório final

```json
{
  "tool": "godot_build_feature",
  "feature": "porta com chave",
  "applied": true,
  "files_created": [
    "res://scripts/Key.gd",
    "res://scripts/Door.gd"
  ],
  "files_modified": [
    "res://scenes/Level01.tscn"
  ],
  "backups": [
    ".godot_mcp/backups/2026-05-03/scenes/Level01.tscn.120000.bak"
  ],
  "validation": {
    "script_valid": true,
    "scene_valid": true,
    "runtime_errors": 0
  },
  "warnings": []
}
```

---

## 18. Política por categoria de ferramenta

## 18.1 Core Tools

Risco: baixo.

Política:

```text
- Permitidas em read-only;
- Sem backup;
- Sem UndoRedo;
- Logs básicos.
```

## 18.2 Project Tools

Risco: baixo a médio.

Política:

```text
- Leitura permitida em read-only;
- Alteração de Input Map exige dry_run;
- Alteração de Autoload exige backup/config log;
- Confirmar remoção de Autoload.
```

## 18.3 File Tools

Risco: médio a alto.

Política:

```text
- Path sandbox obrigatório;
- Backup obrigatório em alteração;
- dry_run obrigatório em exclusão;
- safe trash para delete;
- bloquear arquivos sensíveis por padrão.
```

## 18.4 Scene Tools

Risco: médio.

Política:

```text
- Backup antes de salvar;
- Preferir API da Godot a edição textual;
- Validar cena;
- Bloquear overwrite sem confirmação.
```

## 18.5 Node Tools

Risco: médio.

Política:

```text
- UndoRedo obrigatório;
- dry_run para remoção;
- bloquear remoção do root sem confirm;
- validar tipo e propriedade.
```

## 18.6 Script Tools

Risco: médio a alto.

Política:

```text
- Backup obrigatório;
- Validação de sintaxe;
- Alertar APIs sensíveis;
- Preferir patch a overwrite;
- Log de linhas afetadas.
```

## 18.7 Runtime/Input Tools

Risco: médio.

Política:

```text
- Limites de tempo;
- Não enviar input fora da Godot;
- Registrar sequências;
- Permitir stop;
- Evitar múltiplas execuções.
```

## 18.8 Agentic Tools

Risco: alto.

Política:

```text
- dry_run obrigatório inicialmente;
- confirmação obrigatória;
- limite de escopo;
- backup obrigatório;
- relatório final;
- validação após execução.
```

---

## 19. Configuração de segurança

## 19.1 Arquivo sugerido

```text
.godot_mcp/security.json
```

## 19.2 Exemplo

```json
{
  "version": "1.0",
  "permissionPreset": "safe_edit",
  "readOnly": false,
  "pathSandbox": true,
  "backup": {
    "enabled": true,
    "maxBackupsPerFile": 20,
    "maxBackupAgeDays": 30
  },
  "dryRun": {
    "requiredForDestructiveTools": true,
    "requiredForAgenticTools": true
  },
  "deletePolicy": {
    "allowSafeDelete": true,
    "allowPermanentDelete": false
  },
  "agenticLimits": {
    "maxFilesPerOperation": 10,
    "maxScenesPerOperation": 3,
    "maxNodesPerOperation": 30,
    "requireConfirm": true
  },
  "sensitiveFiles": [
    ".env",
    "*.key",
    "*.pem",
    "credentials.json",
    "secrets.json"
  ],
  "logging": {
    "enabled": true,
    "logParams": true,
    "logFileContents": false
  }
}
```

---

## 20. Checklist de segurança por implementação

Antes de aceitar uma nova ferramenta, verificar:

```text
[ ] A ferramenta tem schema de entrada?
[ ] A ferramenta valida parâmetros?
[ ] A ferramenta respeita read-only?
[ ] A ferramenta respeita path sandbox?
[ ] A ferramenta precisa de backup?
[ ] A ferramenta precisa de dry_run?
[ ] A ferramenta precisa de confirm?
[ ] A ferramenta precisa de UndoRedo?
[ ] A ferramenta registra log?
[ ] A ferramenta retorna erro acionável?
[ ] A ferramenta limita escopo?
[ ] A ferramenta evita dados excessivos na resposta?
[ ] A ferramenta tem teste de caso bloqueado?
[ ] A ferramenta tem teste de sucesso?
```

---

## 21. Testes de segurança obrigatórios

## 21.1 Path traversal

Casos que devem falhar:

```text
../file.gd
../../file.gd
res://../file.gd
C:\Users\User\file.gd
/home/user/file.gd
file:///etc/passwd
```

Erro esperado:

```text
PATH_OUTSIDE_PROJECT
```

## 21.2 Read-only

Em modo read-only, estas ferramentas devem falhar:

```text
godot_write_file
godot_patch_file
godot_add_node
godot_remove_node
godot_create_script
godot_attach_script
```

Erro esperado:

```text
READ_ONLY_MODE
```

## 21.3 Backup obrigatório

Ao aplicar `godot_patch_file`, deve existir backup antes da alteração.

Validar:

```text
[ ] backup criado
[ ] metadata registrada
[ ] path correto
[ ] arquivo restaurável
```

## 21.4 UndoRedo obrigatório

Ao aplicar `godot_add_node`, validar:

```text
[ ] nó criado
[ ] ação aparece no histórico UndoRedo
[ ] Ctrl+Z remove o nó
[ ] Ctrl+Y restaura o nó
```

## 21.5 Safe delete

Ao executar `godot_delete_file_safe`, validar:

```text
[ ] arquivo não é apagado definitivamente
[ ] arquivo é movido para .godot_mcp/trash
[ ] metadata registrada
[ ] operação exige confirm quando necessário
```

## 21.6 Agentic dry run

Ao executar `godot_build_feature`, validar:

```text
[ ] primeira execução é dry_run
[ ] plano é retornado
[ ] nenhum arquivo é alterado
[ ] arquivos afetados são listados
[ ] aplicação exige confirmação
```

---

## 22. Erros de segurança

Códigos específicos:

```text
READ_ONLY_MODE
PERMISSION_DENIED
PATH_OUTSIDE_PROJECT
SENSITIVE_FILE_BLOCKED
BACKUP_FAILED
DRY_RUN_REQUIRED
CONFIRMATION_REQUIRED
TOOL_NOT_ALLOWED
TOOL_NOT_AVAILABLE_IN_MODE
UNDO_FAILED
AGENTIC_SCOPE_TOO_LARGE
```

Formato:

```json
{
  "ok": false,
  "error": {
    "code": "DRY_RUN_REQUIRED",
    "message": "Esta ferramenta exige execução prévia em dry_run.",
    "details": {
      "tool": "godot_refactor_safely"
    },
    "suggestions": [
      "Execute a ferramenta com dry_run=true para revisar o plano."
    ]
  }
}
```

---

## 23. Política de versionamento de segurança

Mudanças em segurança devem ser registradas no changelog.

Exemplos:

```text
- Novo bloqueio de path;
- Nova extensão sensível;
- Mudança em permissões;
- Mudança em comportamento de delete;
- Mudança em backup;
- Mudança em dry_run;
- Correção de bypass.
```

Versões com correções de segurança devem ser marcadas claramente.

Exemplo:

```text
v0.4.2 — Security patch
```

---

## 24. Política de permissões futuras

No MVP, permissões podem ser locais e baseadas em configuração.

Futuramente, avaliar:

```text
- permissões por workspace;
- permissões por cliente MCP;
- allowlist de ferramentas;
- denylist de ferramentas;
- aprovação humana por operação;
- integração com UI no dock da Godot;
- prompt visual de confirmação dentro do editor;
- modo temporário de permissões.
```

---

## 25. Regras finais

## 25.1 Nunca confiar apenas no cliente

Mesmo que o cliente MCP diga que o usuário aprovou, o servidor e o plugin ainda devem validar.

## 25.2 Nunca alterar sem rastreabilidade

Toda alteração deve ter log.

## 25.3 Nunca sobrescrever sem backup

Se backup falhar, alteração deve falhar.

## 25.4 Nunca apagar definitivamente por padrão

Usar safe trash.

## 25.5 Nunca aplicar agentic tool diretamente

Gerar plano primeiro.

## 25.6 Nunca executar mutação de editor sem UndoRedo quando aplicável

Se UndoRedo for obrigatório e não puder ser usado, retornar erro.

---

## 26. Conclusão

A segurança do Godot DevPilot MCP deve ser tratada como requisito central, não como etapa posterior.

O projeto dá à IA capacidade de alterar jogos reais. Isso exige:

```text
- sandbox de paths;
- modo read-only;
- backup obrigatório;
- safe trash;
- dry_run;
- confirmação;
- UndoRedo;
- logs auditáveis;
- validação em camadas;
- limites para ferramentas agentic.
```

Com essas políticas, o Godot DevPilot MCP pode oferecer automação poderosa sem comprometer a integridade do projeto Godot do usuário.

