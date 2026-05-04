# Troubleshooting — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento reúne problemas comuns, causas prováveis e soluções para o **Godot DevPilot MCP**.

Ele cobre falhas relacionadas a:

- Instalação;
- Servidor MCP;
- Plugin Godot;
- WebSocket;
- Cliente MCP;
- Ferramentas;
- Segurança;
- Arquivos;
- Cenas e nós;
- Scripts;
- Runtime;
- Screenshots;
- Input simulation.

---

## 2. Checklist rápido

Antes de investigar um problema específico, verificar:

```text
[ ] A Godot está aberta?
[ ] O projeto Godot correto está aberto?
[ ] O plugin Godot DevPilot MCP está ativo?
[ ] O servidor MCP está rodando?
[ ] O cliente MCP está configurado corretamente?
[ ] A porta do servidor e do plugin é a mesma?
[ ] Node.js está instalado?
[ ] npm install foi executado?
[ ] npm run build foi executado?
[ ] O modo do servidor permite a ferramenta usada?
[ ] O projeto não está em modo read-only?
```

---

# 3. Problemas de conexão

## 3.1 Erro: `GODOT_NOT_CONNECTED`

### Sintoma

A ferramenta `godot_health_check` retorna:

```text
GODOT_NOT_CONNECTED
```

### Causas prováveis

```text
- Godot não está aberta;
- Plugin não está ativo;
- Porta incorreta;
- Servidor MCP iniciou antes do plugin;
- Firewall bloqueou localhost;
- Plugin falhou ao iniciar WebSocket.
```

### Soluções

1. Abrir o projeto na Godot.
2. Confirmar que o plugin está ativo:

```text
Project > Project Settings > Plugins
```

3. Conferir o Output da Godot.

Mensagem esperada:

```text
[Godot DevPilot MCP] WebSocket iniciado em 127.0.0.1:6505
```

4. Confirmar configuração do cliente MCP:

```json
{
  "GODOT_MCP_HOST": "127.0.0.1",
  "GODOT_MCP_PORT": "6505"
}
```

5. Reiniciar o servidor MCP.

---

## 3.2 Erro: `TIMEOUT`

### Sintoma

A chamada demora e retorna timeout.

### Causas prováveis

```text
- Plugin travado;
- Godot ocupada processando outra operação;
- Ferramenta pesada;
- WebSocket conectado, mas sem resposta;
- Erro não tratado no plugin.
```

### Soluções

```text
1. Verificar Output da Godot.
2. Reiniciar o plugin.
3. Reiniciar o servidor MCP.
4. Reduzir escopo da ferramenta.
5. Aumentar timeout temporariamente.
6. Criar issue com logs se persistir.
```

---

## 3.3 Porta já está em uso

### Sintoma

O plugin não consegue iniciar WebSocket na porta 6505.

### Causas prováveis

```text
- Outra instância da Godot está usando a porta;
- Outro processo está usando 6505;
- Plugin antigo não encerrou corretamente.
```

### Soluções

Alterar porta no servidor MCP:

```json
{
  "GODOT_MCP_PORT": "6506"
}
```

E configurar o plugin para a mesma porta.

No Windows, verificar porta:

```bash
netstat -ano | findstr :6505
```

No Linux/macOS:

```bash
lsof -i :6505
```

---

# 4. Problemas no cliente MCP

## 4.1 Cliente não mostra ferramentas

### Causas prováveis

```text
- Configuração MCP inválida;
- Caminho do servidor errado;
- build não foi gerado;
- Node.js não está no PATH;
- servidor encerra ao iniciar;
- JSON de configuração inválido.
```

### Soluções

Verificar se o arquivo existe:

```text
mcp-server/dist/index.js
```

Rodar manualmente:

```bash
node mcp-server/dist/index.js
```

Verificar configuração:

```json
{
  "mcpServers": {
    "godot-devpilot-mcp": {
      "command": "node",
      "args": ["C:/caminho/godot-devpilot-mcp/mcp-server/dist/index.js"]
    }
  }
}
```

---

## 4.2 Ferramenta não está disponível

### Erro

```text
TOOL_NOT_AVAILABLE_IN_MODE
```

### Causa

O modo atual não carrega a ferramenta.

Exemplo:

```text
godot_build_feature não está disponível em modo core.
```

### Solução

Alterar modo:

```json
{
  "GODOT_MCP_MODE": "agentic"
}
```

Modos:

```text
minimal
core
full
agentic
```

---

# 5. Problemas de segurança

## 5.1 Erro: `READ_ONLY_MODE`

### Sintoma

Ferramenta mutável é bloqueada.

### Causa

Servidor está em modo read-only.

### Solução

Desativar read-only:

```json
{
  "GODOT_MCP_READONLY": "false"
}
```

Ou usar apenas ferramentas de leitura.

---

## 5.2 Erro: `PATH_OUTSIDE_PROJECT`

### Sintoma

Ferramenta de arquivo bloqueia o path.

### Causas prováveis

```text
- Path absoluto usado incorretamente;
- Path contém ..;
- Arquivo está fora de res://;
- Cliente enviou path do sistema operacional.
```

### Solução

Usar path Godot:

```text
res://scripts/Player.gd
```

Evitar:

```text
../scripts/Player.gd
C:\Users\...
/home/user/...
```

---

## 5.3 Erro: `BACKUP_FAILED`

### Causas prováveis

```text
- Sem permissão de escrita;
- Pasta .godot_mcp não pôde ser criada;
- Disco cheio;
- Arquivo bloqueado pelo sistema;
- Antivírus bloqueando escrita.
```

### Soluções

```text
1. Verificar permissões da pasta do projeto.
2. Criar manualmente .godot_mcp/backups.
3. Verificar espaço em disco.
4. Fechar programas que bloqueiam o arquivo.
5. Rodar Godot/editor com permissão adequada.
```

---

## 5.4 Erro: `DRY_RUN_REQUIRED`

### Causa

A ferramenta exige simulação antes de aplicar.

### Solução

Executar com:

```json
{
  "dry_run": true
}
```

Depois revisar o plano e aplicar com:

```json
{
  "dry_run": false,
  "confirm": true
}
```

---

# 6. Problemas com plugin Godot

## 6.1 Plugin não aparece na lista

### Causas prováveis

```text
- Pasta está no local errado;
- plugin.cfg ausente;
- plugin.gd ausente;
- Nome de pasta incorreto;
- Godot não recarregou addons.
```

### Estrutura correta

```text
seu-projeto/
└── addons/
    └── godot_devpilot_mcp/
        ├── plugin.cfg
        └── plugin.gd
```

### Soluções

```text
1. Conferir estrutura.
2. Reiniciar Godot.
3. Verificar erros no Output.
4. Validar plugin.cfg.
```

---

## 6.2 Plugin ativa, mas não conecta

### Causas prováveis

```text
- WebSocket não iniciou;
- Porta ocupada;
- Erro em script @tool;
- Falha no dispatcher;
- Godot bloqueou script por erro de sintaxe.
```

### Soluções

```text
1. Abrir Output da Godot.
2. Procurar erros em vermelho.
3. Testar porta diferente.
4. Desativar e ativar plugin.
5. Reiniciar Godot.
```

---

# 7. Problemas com cenas e nós

## 7.1 Erro: `SCENE_NOT_OPEN`

### Causa

A ferramenta exige uma cena aberta, mas nenhuma cena está ativa.

### Solução

Abrir cena:

```text
godot_open_scene
```

Ou criar cena:

```text
godot_create_scene
```

---

## 7.2 Erro: `INVALID_NODE_TYPE`

### Causa

Tipo de nó não existe na ClassDB.

Exemplo errado:

```text
CharactrBody2D
```

Correto:

```text
CharacterBody2D
```

### Solução

Consultar:

```text
godot_get_classdb_info
```

---

## 7.3 Erro: `NODE_NOT_FOUND`

### Causas prováveis

```text
- node_path incorreto;
- cena errada aberta;
- nó foi renomeado;
- path deveria ser relativo ao root;
- nó existe apenas em runtime, não no editor.
```

### Solução

Obter árvore da cena:

```text
godot_get_scene_tree
```

Verificar o caminho correto.

---

## 7.4 UndoRedo não funciona

### Causas prováveis

```text
- Ferramenta ainda não usa UndoRedo;
- Operação foi feita diretamente;
- Cena não está em estado editável;
- Erro no undo_service.gd.
```

### Solução

```text
1. Verificar logs do plugin.
2. Confirmar se ferramenta exige UndoRedo.
3. Criar issue com ferramenta e passos.
```

---

# 8. Problemas com scripts

## 8.1 Erro: `SCRIPT_PARSE_ERROR`

### Causa

O script tem erro de sintaxe.

### Solução

Usar:

```text
godot_validate_script
```

Depois corrigir via:

```text
godot_patch_script
```

---

## 8.2 Script usa sintaxe antiga de Godot 3

### Exemplo antigo

```gdscript
button.connect("pressed", self, "_on_pressed")
```

### Godot 4 recomendado

```gdscript
button.pressed.connect(_on_pressed)
```

### Solução

Executar validação com alvo Godot 4:

```json
{
  "godot_version_target": "4.x"
}
```

---

## 8.3 Script não anexa ao nó

### Erros possíveis

```text
SCRIPT_NOT_FOUND
SCRIPT_ATTACH_FAILED
NODE_NOT_FOUND
```

### Soluções

```text
1. Verificar se o script existe.
2. Verificar se o nó existe.
3. Validar se o script tem extends compatível.
4. Usar godot_get_scene_tree.
5. Usar godot_validate_script.
```

---

# 9. Problemas de runtime

## 9.1 Erro: `RUNTIME_NOT_RUNNING`

### Causa

Ferramenta exige jogo rodando.

Exemplos:

```text
godot_get_runtime_tree
godot_press_action
godot_take_game_screenshot
```

### Solução

Executar:

```text
godot_run_project
```

ou:

```text
godot_run_scene
```

---

## 9.2 Projeto não inicia

### Causas prováveis

```text
- Main scene não configurada;
- Erro de script;
- Cena inválida;
- Godot já está rodando outra instância;
- Falha em recurso importado.
```

### Soluções

```text
1. Verificar project_info.
2. Verificar main_scene.
3. Rodar godot_get_debugger_errors.
4. Rodar godot_get_output_logs.
5. Validar scripts principais.
```

---

## 9.3 Input simulation não funciona

### Causas prováveis

```text
- Runtime não está ativo;
- Ação não existe no Input Map;
- Janela do jogo não está focada;
- Ferramenta usa ação errada;
- Duração muito curta.
```

### Soluções

```text
1. Verificar runtime com godot_is_game_running.
2. Listar input actions com godot_get_input_map.
3. Usar godot_press_action em vez de tecla absoluta.
4. Aumentar duration_ms.
```

---

# 10. Problemas com screenshots

## 10.1 Erro: `SCREENSHOT_FAILED`

### Causas prováveis

```text
- Runtime não está ativo;
- Viewport indisponível;
- Caminho de saída inválido;
- Pasta .godot_mcp/screenshots não existe;
- Permissão de escrita ausente.
```

### Soluções

```text
1. Verificar se jogo está rodando.
2. Criar pasta .godot_mcp/screenshots.
3. Verificar path de saída.
4. Usar output_path padrão.
5. Conferir logs do plugin.
```

---

# 11. Problemas com ferramentas agentic

## 11.1 Ferramenta não aplica alterações

### Causa comum

Ferramentas agentic executam primeiro em `dry_run`.

### Solução

Revisar o plano e aplicar com:

```json
{
  "dry_run": false,
  "confirm": true
}
```

---

## 11.2 Erro: `AGENTIC_SCOPE_TOO_LARGE`

### Causa

A ferramenta tentou afetar muitos arquivos, cenas ou nós.

### Solução

Reduzir escopo:

```json
{
  "scope": "current_scene",
  "max_files": 5
}
```

---

# 12. Coleta de informações para issue

Ao reportar problema, incluir:

```text
- Sistema operacional;
- Versão da Godot;
- Versão do Node.js;
- Cliente MCP;
- Modo do servidor;
- Ferramenta chamada;
- Entrada usada;
- Resposta recebida;
- Logs do servidor;
- Logs da Godot;
- Passos para reproduzir.
```

Modelo:

```md
## Ambiente

- OS:
- Godot:
- Node.js:
- Cliente MCP:
- Modo:

## Problema

## Passos para reproduzir

1.
2.
3.

## Resultado esperado

## Resultado obtido

## Logs
```

---

## 13. Comandos úteis

## 13.1 Verificar Node

```bash
node --version
npm --version
```

## 13.2 Reinstalar dependências

```bash
cd mcp-server
rm -rf node_modules package-lock.json
npm install
```

No Windows PowerShell:

```powershell
cd mcp-server
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

## 13.3 Recompilar

```bash
npm run build
```

## 13.4 Rodar servidor manualmente

```bash
node dist/index.js
```

## 13.5 Verificar porta

Windows:

```bash
netstat -ano | findstr :6505
```

Linux/macOS:

```bash
lsof -i :6505
```

---

## 14. Conclusão

A maioria dos problemas do Godot DevPilot MCP tende a cair em uma destas categorias:

```text
- plugin não ativo;
- porta incorreta;
- servidor não iniciado;
- modo errado;
- read-only ativado;
- path inválido;
- cena não aberta;
- runtime não ativo.
```

O primeiro diagnóstico deve sempre ser:

```text
1. godot_health_check
2. godot_get_project_info
3. godot_get_editor_context
4. logs do servidor
5. Output da Godot
```

