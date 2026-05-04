# Contributing — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento define as regras e orientações para contribuir com o **Godot DevPilot MCP**.

O objetivo é manter o projeto:

- Organizado;
- Seguro;
- Testável;
- Documentado;
- Consistente;
- Útil para desenvolvedores Godot;
- Adequado para uso com assistentes de IA.

Contribuições são bem-vindas, mas devem seguir padrões técnicos claros, principalmente porque este projeto permite que uma IA altere arquivos, cenas, scripts e runtime de projetos reais.

---

## 2. Tipos de contribuição

Você pode contribuir com:

```text
- Correções de bugs;
- Novas ferramentas MCP;
- Melhorias no plugin Godot;
- Melhorias no servidor TypeScript;
- Testes;
- Documentação;
- Exemplos;
- Templates de gameplay;
- Melhorias de segurança;
- Refatorações internas;
- Traduções;
- Relatórios de bug;
- Sugestões de arquitetura.
```

---

## 3. Princípios de contribuição

## 3.1 Segurança primeiro

Nenhuma contribuição deve enfraquecer as garantias de segurança.

Toda ferramenta que altera estado deve respeitar:

```text
- path sandbox;
- read-only mode;
- dry_run quando aplicável;
- backup quando altera arquivo;
- UndoRedo quando altera cena ou nó;
- logs auditáveis;
- erros padronizados.
```

## 3.2 Clareza antes de complexidade

Preferir ferramentas pequenas, previsíveis e fáceis de testar.

Evitar contribuições que adicionem ferramentas amplas demais sem controle de escopo.

## 3.3 Documentação junto com código

Se uma contribuição altera comportamento, adiciona ferramenta ou muda segurança, a documentação correspondente deve ser atualizada.

## 3.4 Compatibilidade com Godot 4.x

O foco do projeto é Godot 4.2+.

Evitar padrões antigos de Godot 3, especialmente em GDScript e conexão de sinais.

---

## 4. Configuração do ambiente

## 4.1 Requisitos

```text
Godot 4.2+
Node.js 18+
npm, pnpm ou yarn
Git
Editor de código
Cliente MCP compatível para testes manuais
```

## 4.2 Clonar o projeto

```bash
git clone https://github.com/seu-usuario/godot-devpilot-mcp.git
cd godot-devpilot-mcp
```

## 4.3 Instalar dependências do servidor

```bash
cd mcp-server
npm install
```

## 4.4 Rodar em desenvolvimento

```bash
npm run dev
```

## 4.5 Ativar plugin na Godot

1. Copie `addons/godot_devpilot_mcp` para um projeto Godot de teste.
2. Abra a Godot.
3. Ative o plugin em `Project > Project Settings > Plugins`.
4. Verifique se a conexão WebSocket iniciou corretamente.

---

## 5. Fluxo de trabalho com Git

## 5.1 Criar branch

Use nomes claros:

```text
feature/add-scene-tools
feature/runtime-tree
fix/path-guard-windows
fix/undo-redo-remove-node
docs/update-security-guide
test/add-file-tools-tests
```

## 5.2 Commits

Use mensagens objetivas.

Formato sugerido:

```text
type(scope): description
```

Exemplos:

```text
feat(scene): add create_scene tool
fix(safety): block path traversal on Windows
docs(security): document safe trash policy
test(file): add patch_file backup tests
refactor(plugin): split dispatcher from rpc server
```

Tipos recomendados:

```text
feat
fix
docs
test
refactor
chore
security
perf
```

## 5.3 Pull Request

Todo PR deve incluir:

```text
- Descrição clara;
- Motivação;
- Lista de alterações;
- Como testar;
- Riscos;
- Screenshots, se alterar UI;
- Indicação de documentação atualizada;
- Checklist de segurança.
```

---

## 6. Checklist de Pull Request

Antes de abrir um PR, verifique:

```text
[ ] O código compila
[ ] Os testes passam
[ ] A ferramenta tem schema de entrada
[ ] A ferramenta retorna resposta padronizada
[ ] A ferramenta respeita read-only mode
[ ] A ferramenta respeita path sandbox
[ ] A ferramenta cria backup quando altera arquivo
[ ] A ferramenta usa UndoRedo quando altera cena/nó
[ ] A ferramenta suporta dry_run quando necessário
[ ] A ferramenta registra logs
[ ] Erros têm code, message, details e suggestions
[ ] Documentação foi atualizada
[ ] Exemplos foram atualizados, se necessário
[ ] Não há acesso fora de res://
[ ] Não há exclusão definitiva por padrão
```

---

## 7. Padrões para novas ferramentas MCP

## 7.1 Antes de implementar

Antes de criar uma nova ferramenta, responda:

```text
1. Qual problema ela resolve?
2. Ela já não é coberta por outra ferramenta?
3. Ela deve estar em minimal, core, full ou agentic?
4. Ela altera estado?
5. Precisa de dry_run?
6. Precisa de backup?
7. Precisa de UndoRedo?
8. Precisa de confirmação?
9. Quais erros ela pode retornar?
10. Como será testada?
```

## 7.2 Nome

Toda ferramenta deve começar com:

```text
godot_
```

Exemplos bons:

```text
godot_add_node
godot_patch_file
godot_validate_script
godot_take_game_screenshot
```

Exemplos ruins:

```text
godot_action
godot_execute
godot_update
godot_manage
```

## 7.3 Schema

Toda ferramenta deve ter schema explícito.

Exemplo:

```ts
const AddNodeSchema = z.object({
  parent_path: z.string().default("."),
  type: z.string().min(1),
  name: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
  dry_run: z.boolean().default(false)
});
```

## 7.4 Resposta

Toda ferramenta deve retornar:

```json
{
  "ok": true,
  "data": {},
  "message": "Operação concluída.",
  "warnings": [],
  "suggestions": []
}
```

Ou erro:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensagem clara.",
    "details": {},
    "suggestions": []
  }
}
```

---

## 8. Padrões para servidor TypeScript

## 8.1 Regras gerais

```text
- Usar strict mode;
- Evitar any;
- Usar Zod para validação;
- Separar registro de ferramenta da lógica interna;
- Centralizar erros;
- Escrever testes para safety modules;
- Não confiar em entrada vinda da IA;
- Evitar lógica específica da Godot que pertença ao plugin.
```

## 8.2 Estrutura esperada

```text
mcp-server/src/tools/sceneTools.ts
mcp-server/src/godot/client.ts
mcp-server/src/safety/pathGuard.ts
mcp-server/src/utils/errors.ts
```

## 8.3 Proibido

```text
- Fazer path join inseguro;
- Aceitar path absoluto sem validação;
- Escrever arquivo sem backup;
- Registrar conteúdo completo de arquivos sensíveis;
- Ignorar erro retornado pelo plugin;
- Retornar texto solto sem estrutura.
```

---

## 9. Padrões para plugin Godot

## 9.1 Regras gerais

```text
- Usar @tool;
- Manter plugin.gd pequeno;
- Separar handlers por domínio;
- Validar método recebido;
- Validar parâmetros novamente;
- Usar EditorUndoRedoManager;
- Retornar Dictionary padronizado;
- Não fazer lógica agentic dentro do plugin;
- Não acessar path fora de res:// sem política explícita.
```

## 9.2 Estrutura esperada

```text
addons/godot_devpilot_mcp/core/dispatcher.gd
addons/godot_devpilot_mcp/tools/scene_tools.gd
addons/godot_devpilot_mcp/tools/node_tools.gd
addons/godot_devpilot_mcp/core/undo_service.gd
```

## 9.3 Proibido

```text
- Mutar cena sem UndoRedo quando UndoRedo for aplicável;
- Editar .tscn manualmente quando API Godot puder ser usada;
- Retornar erro genérico sem code;
- Ignorar falhas de ClassDB;
- Assumir que sempre existe cena aberta.
```

---

## 10. Testes obrigatórios

## 10.1 Para ferramentas de arquivo

Testar:

```text
[ ] leitura de arquivo válido
[ ] path inexistente
[ ] path traversal
[ ] write com overwrite=false em arquivo existente
[ ] backup antes de overwrite
[ ] dry_run não altera arquivo
[ ] arquivo sensível bloqueado
```

## 10.2 Para ferramentas de cena/nó

Testar:

```text
[ ] cena aberta
[ ] nenhuma cena aberta
[ ] tipo de nó válido
[ ] tipo de nó inválido
[ ] parent inexistente
[ ] add_node com UndoRedo
[ ] remove_node com UndoRedo
[ ] set_property inválida
```

## 10.3 Para ferramentas agentic

Testar:

```text
[ ] execução inicial em dry_run
[ ] plano retorna arquivos afetados
[ ] aplicação exige confirmação
[ ] limite de arquivos é respeitado
[ ] backup é criado
[ ] relatório final é gerado
```

---

## 11. Documentação

## 11.1 Quando atualizar documentação

Atualize documentação quando alterar:

```text
- comportamento de ferramenta;
- schema de ferramenta;
- código de erro;
- política de segurança;
- estrutura de pastas;
- modo de instalação;
- comandos de execução;
- exemplos de uso;
- roadmap.
```

## 11.2 Documentos afetados

```text
README.md
docs/ARCHITECTURE.md
docs/TOOL_SPECIFICATION.md
docs/SECURITY.md
docs/API_REFERENCE.md
docs/EXAMPLES.md
docs/TROUBLESHOOTING.md
```

---

## 12. Relato de bugs

Um bom bug report deve conter:

```text
- Sistema operacional;
- Versão da Godot;
- Versão do Node.js;
- Cliente MCP usado;
- Modo do servidor: minimal/core/full/agentic;
- Passos para reproduzir;
- Resultado esperado;
- Resultado obtido;
- Logs relevantes;
- Screenshot, se útil;
- Projeto mínimo de reprodução, se possível.
```

Modelo:

```md
## Ambiente

- OS:
- Godot:
- Node:
- Cliente MCP:
- Modo:

## Descrição

## Passos para reproduzir

1.
2.
3.

## Resultado esperado

## Resultado obtido

## Logs
```

---

## 13. Sugestão de feature

Uma sugestão deve conter:

```text
- Problema que resolve;
- Exemplo de uso;
- Categoria da ferramenta;
- Modo sugerido;
- Riscos de segurança;
- Alternativas consideradas.
```

Modelo:

```md
## Problema

## Proposta

## Exemplo de uso

## Categoria

## Segurança

## Alternativas
```

---

## 14. Revisão de código

Ao revisar PRs, verificar:

```text
- segurança;
- clareza;
- schema;
- erros;
- logs;
- testes;
- documentação;
- compatibilidade com Godot 4;
- tamanho da mudança;
- impacto em ferramentas existentes.
```

PRs grandes devem ser divididos quando possível.

---

## 15. Licença e código externo

Não adicionar código fechado ou copiado de soluções comerciais.

Permitido:

```text
- usar APIs públicas;
- estudar documentação pública;
- usar projetos open source compatíveis com a licença;
- implementar funcionalidade equivalente por conta própria.
```

Não permitido:

```text
- copiar código de produtos pagos;
- copiar prompts privados;
- copiar binários;
- copiar assets proprietários;
- remover copyright de código de terceiros;
- misturar licença incompatível.
```

---

## 16. Código de conduta técnica

Contribuições devem manter discussão objetiva.

Priorizar:

```text
- evidência técnica;
- reprodução de bugs;
- propostas testáveis;
- revisão respeitosa;
- foco no projeto.
```

Evitar:

```text
- mudanças sem justificativa;
- discussões vagas;
- commits enormes sem contexto;
- alterações de arquitetura sem issue prévia;
- ferramentas inseguras.
```

---

## 17. Conclusão

Contribuir com o Godot DevPilot MCP exige atenção especial à segurança e à previsibilidade.

A regra geral é:

```text
Toda contribuição deve melhorar o projeto sem reduzir segurança, clareza ou testabilidade.
```

Ferramentas de IA para Godot são poderosas. Por isso, cada mudança deve ser projetada como parte de um sistema confiável, auditável e útil para criação real de jogos.

