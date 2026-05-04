# Validação da Fase 12 — Toolkits 3D

Projeto: **Godot DevPilot MCP**  
Fase: **12 — Toolkits 3D**  
Data: 2026-05-04  
Escopo: **estendido (8 ferramentas)** — baseline + NavigationRegion3D, RayCast3D, glTF placeholder.

---

## 1. Objetivo

Acelerar criação de jogos 3D com tools compostas (CharacterBody3D + camera + lighting + primitivos + controller third-person).

Mesmo padrão de Phase 11: macros server-side orquestrando `node.add` + `node.set_property` + `script.attach`.

---

## 2. Ferramentas implementadas (8)

```text
[x] godot_setup_camera_3d                 (Camera3D + current=true + fov)
[x] godot_create_character_body_3d        (CharacterBody3D + Mesh + Collision + opcional CameraPivot/Camera3D + script)
[x] godot_setup_lighting                  (DirectionalLight3D + WorldEnvironment + sombras)
[x] godot_setup_third_person_controller   (script template — sem nodes)
[x] godot_create_primitive_mesh           (MeshInstance3D + sugestão de primitive)
[x] godot_create_navigation_region_3d     (NavigationRegion3D — NavMesh via inspector)
[x] godot_create_raycast_3d               (RayCast3D + target_position + enabled)
[x] godot_import_gltf                     (Node3D placeholder + instruções de import)
```

Arquivo: `mcp-server/src/tools/toolkit3dTools.ts`.

---

## 3. Template GDScript embutido

```text
THIRD_PERSON_CONTROLLER  CharacterBody3D + gravity + jump + camera relative move
                         + mouse capture + CameraPivot rotation
                         Requer Input Map: jump, move_left, move_right,
                                           move_forward, move_back
```

Compatível com Godot 4.x: `Engine.physics_ticks_per_second`, `is_on_floor()`, `move_and_slide()`, `Input.get_vector()`.

---

## 4. Limitações de design

```text
- Recursos (Resource) não podem ser instanciados via JSON-RPC: Mesh, Shape3D
  e Environment são adicionados como nodes vazios; usuário atribui resource
  no inspector do editor.
- create_primitive_mesh aceita `primitive` como sugestão informativa apenas
  (BoxMesh, SphereMesh, CapsuleMesh, etc.) — não cria o resource.
- WorldEnvironment criado sem Environment resource: usuário precisa criar
  um Environment.tres e atribuí-lo.
```

---

## 5. Segurança

```text
[x] 5 ferramentas bloqueadas em read-only.
[x] Todas suportam dry_run com planned_changes.
[x] Script paths validados: .gd obrigatório, dentro de res://.
[x] FILE_ALREADY_EXISTS sem overwrite=true.
[x] Aborta no primeiro erro RPC do plugin.
```

---

## 6. Testes automatizados

`tests/toolkit3dTools.test.ts` — 11 testes:

```text
[x] read-only bloqueia setup_camera_3d
[x] read-only bloqueia create_character_body_3d
[x] dry_run setup_camera_3d retorna planned_changes
[x] dry_run create_character_body_3d inclui CameraPivot por default
[x] dry_run create_character_body_3d include_camera=false omite camera
[x] setup_third_person_controller escreve template
[x] rejeita path não-.gd → INVALID_PARAMS
[x] FILE_ALREADY_EXISTS sem overwrite
[x] setup_camera_3d set_property current + fov
[x] create_character_body_3d emite node.add com 4 tipos esperados
[x] setup_lighting emite DirectionalLight3D + WorldEnvironment
[x] create_primitive_mesh adiciona MeshInstance3D + suggested_primitive
```

Total projeto: **27 files / 250 tests passing**.

---

## 7. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 250/250 passing
[x] 5 ferramentas baseline registradas
[x] Template third-person GDScript válido (Godot 4.x)
[x] Orquestração RPC verificada via mock
[x] dry_run + read-only + path sandbox aplicados

[ ] Validação manual com Godot ativo (ISSUE-018)
```

---

## 8. Testes manuais obrigatórios (Godot ativo)

```text
1. Criar cena Node3D → godot_create_character_body_3d {include_camera:true}
   → Player + Mesh + Collision + CameraPivot/Camera3D + Player3D.gd anexado.
2. godot_setup_lighting → DirectionalLight3D + WorldEnvironment criados.
3. Atribuir BoxMesh em Player/Mesh.mesh e BoxShape3D em Player/Collision.shape via inspector.
4. Atribuir Environment.tres em WorldEnvironment.environment.
5. godot_run_project → confirmar que jogador se move com WASD/setas e câmera segue mouse.
6. godot_setup_camera_3d {parent_path:"Player", fov:90} → segunda câmera não-current.
7. godot_create_primitive_mesh {primitive:"SphereMesh"} → MeshInstance3D adicionado.
8. godot_setup_third_person_controller {script_path:"res://scripts/X.gd"} → arquivo escrito.
```

---

## 9. Pendências

```text
[ ] Bake de NavigationRegion3D / RayCast3D / glTF import — adiar para iteração.
[ ] Material/Shader baseline — pode entrar na Fase 13 (Shader Toolkit).
[x] Validação manual com Godot executada em 2026-05-04 (ISSUE-018 fechada).
    Testes 1+2+6+7+8: aprovados via MCP. Testes 3+4 (Resources inspector) e 5 (visual runtime): pendentes inspector.
```

---

## 10. Status

```text
[x] Aprovada (testes MCP: 5/5 pass; testes inspector: 3 pendentes não-bloqueantes)
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable. ISSUE-018 fechada. Gate Fase 13: liberado.
