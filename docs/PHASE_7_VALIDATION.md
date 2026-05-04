# Validação da Fase 7 — Screenshots e Input Simulation

Projeto: **Godot DevPilot MCP**  
Fase: **7 — Screenshots e Input Simulation**  
Data: 2026-05-04  
Dependências: Fases 0–6 aprovadas (ver `docs/PHASE_0_TO_5_VALIDATION_REPORT.md` e `docs/PHASE_6_VALIDATION.md`).

---

## 1. Objetivo da Fase 7

Adicionar ao Godot DevPilot MCP:

- Captura de screenshots do jogo, do editor e do viewport da cena editada.
- Comparação byte-a-byte de screenshots capturados.
- Simulação de inputs (Input Map actions, teclas e mouse) durante execução do jogo.
- Execução de sequências de inputs (base para testes E2E).

Fase 7 **não inclui**:
- Pixel diff visual (apenas hash + size + byte diff baseline).
- Captura por OCR ou análise semântica.
- Runtime analysis ou inspeção remota (Fase 8).
- Project intelligence (Fase 9).

---

## 2. Ferramentas implementadas

### 2.1 Screenshot Tools (4)

```text
godot_take_game_screenshot     — captura screenshot do jogo em execução
godot_take_editor_screenshot   — captura screenshot do editor
godot_get_viewport_image       — captura viewport da cena editada (2D/3D)
godot_compare_screenshots      — compara dois PNGs (hash, size, dimensões, byte diff)
```

### 2.2 Input Tools (9)

```text
godot_press_action          — pressiona ação do Input Map (com hold opcional)
godot_release_action        — libera ação do Input Map
godot_press_key             — pressiona tecla (com hold opcional)
godot_release_key           — libera tecla
godot_tap_key               — press + release imediato
godot_mouse_move            — move cursor para (x, y)
godot_mouse_click           — clique em (x, y) com botão configurável
godot_mouse_drag            — drag de (from_x, from_y) até (to_x, to_y)
godot_run_input_sequence    — executa sequência de eventos com waits
```

### 2.3 Totais

```text
Ferramentas Phase 7:        13
Ferramentas total projeto:  73+
```

---

## 3. Métodos JSON-RPC adicionados ao plugin

```text
screenshot.take_game        → ScreenshotTools.take_game_screenshot()
screenshot.take_editor      → ScreenshotTools.take_editor_screenshot()
screenshot.get_viewport     → ScreenshotTools.get_viewport_image()
input.press_action          → InputTools.press_action()        [coroutine]
input.release_action        → InputTools.release_action()
input.press_key             → InputTools.press_key()           [coroutine]
input.release_key           → InputTools.release_key()
input.tap_key               → InputTools.tap_key()
input.mouse_move            → InputTools.mouse_move()
input.mouse_click           → InputTools.mouse_click()
input.mouse_drag            → InputTools.mouse_drag()
input.run_sequence          → InputTools.run_input_sequence()  [coroutine]
```

Arquivos:
- `addons/godot_devpilot_mcp/tools/screenshot_tools.gd`
- `addons/godot_devpilot_mcp/tools/input_tools.gd`

Refatoração de suporte: `dispatcher.dispatch()` e `rpc_server._handle_message()` agora aguardam (`await`) métodos de input que usam `SceneTreeTimer` para hold-and-release.

---

## 4. Localização dos screenshots

Padrão: `res://.godot_mcp/screenshots/<kind>_<timestamp>.png`

```text
.godot_mcp/screenshots/game_2026-05-04T14-35-19-000Z.png
.godot_mcp/screenshots/editor_2026-05-04T14-35-19-000Z.png
.godot_mcp/screenshots/viewport_2026-05-04T14-35-19-000Z.png
```

`output_path` pode ser fornecido explicitamente — sempre dentro de `res://` e terminando em `.png`.

---

## 5. Regras de segurança da Fase 7

```text
[x] godot_take_game_screenshot       bloqueado em read-only.
[x] godot_take_editor_screenshot     bloqueado em read-only.
[x] godot_get_viewport_image         bloqueado em read-only.
[x] godot_compare_screenshots        permitido em read-only (apenas leitura).
[x] godot_press_action               bloqueado em read-only.
[x] godot_release_action             bloqueado em read-only.
[x] godot_press_key                  bloqueado em read-only.
[x] godot_release_key                bloqueado em read-only.
[x] godot_tap_key                    bloqueado em read-only.
[x] godot_mouse_move                 bloqueado em read-only.
[x] godot_mouse_click                bloqueado em read-only.
[x] godot_mouse_drag                 bloqueado em read-only.
[x] godot_run_input_sequence         bloqueado em read-only.
[x] Output path validado via path sandbox (res:// obrigatório, .png obrigatório).
[x] Plugin valida res:// e .png antes de salvar.
[x] Input simulation requer jogo rodando — RUNTIME_NOT_RUNNING se não rodando.
[x] Action inválida → INPUT_ACTION_NOT_FOUND.
[x] Keycode inválido → INVALID_KEYCODE.
[x] Captura sem editor → EDITOR_NOT_AVAILABLE.
[x] Falha de save → SCREENSHOT_FAILED com error_code do Godot.
```

---

## 6. Erros padronizados

```text
PATH_OUTSIDE_PROJECT          # path fora de res://
INVALID_PARAMS                # path não termina em .png, action vazia, etc.
SCREENSHOT_NOT_FOUND          # arquivos para compare_screenshots não existem
SCREENSHOT_FAILED             # falha de captura ou save_png
RUNTIME_NOT_RUNNING           # input sem jogo rodando, take_game sem jogo
INPUT_ACTION_NOT_FOUND        # action não existe no InputMap
INVALID_KEYCODE               # nome de tecla não reconhecido
INVALID_SEQUENCE_STEP         # step type desconhecido em run_input_sequence
EDITOR_NOT_AVAILABLE          # plugin sem EditorInterface (headless)
READ_ONLY_MODE                # ferramenta mutável em read-only
```

---

## 7. Testes automatizados TypeScript

### 7.1 `tests/screenshotTools.test.ts` (12 testes)

```text
[x] compareScreenshotFiles identifica idênticos.
[x] compareScreenshotFiles identifica diferentes.
[x] compareScreenshotFiles reporta dimensões diferentes.
[x] godot_take_game_screenshot bloqueado em read-only.
[x] godot_take_editor_screenshot bloqueado em read-only.
[x] godot_compare_screenshots permitido em read-only.
[x] godot_take_game_screenshot delega para screenshot.take_game.
[x] godot_take_editor_screenshot rejeita output não-png.
[x] godot_take_game_screenshot rejeita path fora de res://.
[x] godot_get_viewport_image delega para screenshot.get_viewport.
[x] compare retorna SCREENSHOT_NOT_FOUND quando arquivos não existem.
[x] compare rejeita inputs não-png.
```

### 7.2 `tests/inputTools.test.ts` (18 testes)

```text
[x] read-only bloqueia 9 input tools (9 testes parametrizados).
[x] godot_press_action delega input.press_action com action+duration_ms.
[x] godot_press_action default duration_ms=0.
[x] godot_release_action delega input.release_action.
[x] godot_press_key delega input.press_key.
[x] godot_tap_key delega input.tap_key.
[x] godot_mouse_move delega x/y.
[x] godot_mouse_click default button="left".
[x] godot_mouse_drag aceita button customizado.
[x] godot_run_input_sequence forwards sequence array.
```

### 7.3 Resultado total

```text
Test Files:  21 passed (21)
Tests:       164 passed (164)
Duration:    ~1.5s
```

---

## 8. Critério de aprovação

```text
[x] npm run build passa sem erros.
[x] npm test passa (164/164).
[x] 13 ferramentas Phase 7 registradas no servidor MCP.
[x] Plugin: screenshot_tools.gd e input_tools.gd criados.
[x] Dispatcher integra screenshot.* e input.* com await onde necessário.
[x] rpc_server.gd refatorado para suportar dispatch coroutine.
[x] Capabilities advertise screenshots: true, input_simulation: true.
[x] compare_screenshots permitido em read-only.
[x] Demais ferramentas mutáveis bloqueadas em read-only.
[x] Path sandbox aplicado a todos output_path.
[x] RUNTIME_NOT_RUNNING para inputs e game screenshot quando jogo parado.
[x] Erros padronizados conforme contrato ok=false/error.

[ ] Teste prático com Godot editor + jogo rodando (pendência manual — seção 9).
```

---

## 9. Testes manuais obrigatórios (requerem Godot ativo)

Execute com servidor MCP conectado e Godot editor aberto:

### 9.1 Screenshots

```text
1. Chamar godot_take_editor_screenshot → confirmar PNG em
   .godot_mcp/screenshots/editor_*.png e width/height > 0.
2. Abrir cena 2D, chamar godot_get_viewport_image → confirmar PNG criado.
3. Chamar godot_run_project, aguardar jogo rodar.
4. Chamar godot_take_game_screenshot → confirmar PNG criado.
5. Chamar godot_take_game_screenshot novamente.
6. Chamar godot_compare_screenshots com os dois PNGs do jogo
   → esperar identical=false (frames diferentes).
7. Chamar godot_compare_screenshots com mesmo PNG nos dois inputs
   → esperar identical=true.
8. Chamar godot_take_game_screenshot com jogo parado
   → esperar RUNTIME_NOT_RUNNING.
9. Chamar godot_take_editor_screenshot com output_path "../bad.png"
   → esperar PATH_OUTSIDE_PROJECT.
10. Chamar godot_take_editor_screenshot com output_path "res://x.txt"
    → esperar INVALID_PARAMS.
```

### 9.2 Input simulation

```text
1. Iniciar projeto via godot_run_project com Input Map contendo "jump".
2. Chamar godot_press_action {action:"jump", duration_ms:300}
   → esperar Action input dispatched.
3. Verificar visualmente que o jogo recebeu o input.
4. Chamar godot_press_action {action:"acao_inexistente"}
   → esperar INPUT_ACTION_NOT_FOUND.
5. Chamar godot_tap_key {keycode:"Space"} → esperar success.
6. Chamar godot_press_key {keycode:"Tecla_Inexistente"}
   → esperar INVALID_KEYCODE.
7. Chamar godot_mouse_click {x:400, y:300} → esperar success.
8. Chamar godot_mouse_drag {from_x:100, from_y:100, to_x:200, to_y:200}.
9. Chamar godot_run_input_sequence com mix de action_press, key_tap,
   wait, mouse_click → confirmar events_executed igual ao tamanho da sequência.
10. Parar o jogo (godot_stop_project) e tentar godot_press_action
    → esperar RUNTIME_NOT_RUNNING.
```

---

## 10. Pendências conhecidas (não bloqueantes)

```text
[ ] godot_take_game_screenshot: screen_get_image retorna null no Wayland/Fedora —
    fix aplicado em 2026-05-04 (fallback para editor viewport). Captura precisa
    do game viewport aguarda EditorDebuggerPlugin (Fase 8 — ISSUE-010).
[ ] godot_compare_screenshots faz diff byte-a-byte (não pixel-aware) — duas
    PNGs visualmente similares mas com metadata/timestamp diferentes serão
    classificadas como diferentes. Pixel diff requer decoder PNG dedicado.
[ ] Input simulation funciona via Input.parse_input_event() — eventos chegam
    ao loop principal mas alguns sistemas (UI focus, network input) podem
    não responder igual a input físico real.
[x] Testes manuais da seção 9 executados e aprovados em 2026-05-04.
```

---

## 11. Status

```text
[x] Aprovada
[ ] Aprovada com ressalvas (testes manuais com Godot ativo pendentes)
[ ] Reprovada
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable (fedora).  
Todos os 20 testes manuais (seção 9.1 + 9.2) passaram.  
Bug corrigido: `screenshot_tools.gd` — fallback para editor viewport quando `screen_get_image` retorna null (Wayland).

---

## 12. Gate para iniciar Fase 8 — Runtime Analysis

```text
[x] npm run build passa.
[x] npm test passa.
[x] 13 ferramentas Phase 7 registradas.
[x] Plugin GDScript validado por análise estática.
[x] Testes manuais da seção 9 aprovados em sessão Godot real (2026-05-04).
[x] Issues abertas para pendências da seção 10.
```

Gate Fase 8 desbloqueado.
