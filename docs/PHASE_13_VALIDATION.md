# Validação da Fase 13 — Toolkits Especializados

Projeto: **Godot DevPilot MCP**  
Fase: **13 — Toolkits especializados**  
Data: 2026-05-04  
Escopo: **completa (12 ferramentas distribuídas em 6 sub-toolkits)**.

---

## 1. Objetivo

Cobrir áreas verticais do Godot 4 que não cabem nos toolkits 2D/3D genéricos: Physics, Animation, Audio, Particles, Shader, Navigation.

Cada sub-toolkit entrega operações compostas (orquestração `node.add` + `set_property`) ou geradores de templates (.gdshader / instructions).

---

## 2. Ferramentas implementadas (12)

### 2.1 Physics (3)

```text
[x] godot_setup_physics_body         (RigidBody2D/3D + StaticBody2D/3D + CollisionShape + visual opcional)
[x] godot_set_collision_layers       (collision_layer + collision_mask bitmasks)
[x] godot_add_raycast_2d             (RayCast2D + target_position + enabled)
```

### 2.2 Animation (3)

```text
[x] godot_create_animation_player    (AnimationPlayer node)
[x] godot_add_animation_track        (read-only — instructions; AnimationLibrary requer editor)
[x] godot_create_animation_tree      (AnimationTree + anim_player + active=true)
```

### 2.3 Audio (2)

```text
[x] godot_create_audio_stream_player_2d  (AudioStreamPlayer2D + bus + volume + autoplay)
[x] godot_create_audio_stream_player_3d  (AudioStreamPlayer3D + bus + max_distance)
```

### 2.4 Particles (2)

```text
[x] godot_create_gpu_particles_2d    (GPUParticles2D + amount + emitting)
[x] godot_create_gpu_particles_3d    (GPUParticles3D + amount + emitting)
```

### 2.5 Shader (2)

```text
[x] godot_create_shader              (template .gdshader canvas_item ou spatial)
[x] godot_assign_shader_material     (read-only — instructions; ShaderMaterial requer editor)
```

### 2.6 Navigation (1)

```text
[x] godot_setup_navigation_region_2d (NavigationRegion2D — NavigationPolygon via inspector)
```

(NavigationRegion3D já em Phase 12.)

Arquivo: `mcp-server/src/tools/toolkit13Tools.ts`.

---

## 3. Templates embutidos

```text
SHADER_MATERIAL_TEMPLATE  shader_type canvas_item; tint + intensity uniforms
SHADER_3D_TEMPLATE        shader_type spatial; albedo + albedo_tex uniforms
```

Compatíveis com Godot 4.x sintaxe shader.

---

## 4. Limitações de design

```text
- Resources (PhysicsMaterial, AnimationLibrary, AudioStream, ParticleProcessMaterial,
  ShaderMaterial, NavigationPolygon) NÃO podem ser instanciados via JSON-RPC.
  Usuário deve atribuí-los no inspector do editor.
- Tools "instructional" (add_animation_track, assign_shader_material) retornam
  passos textuais para guiar a operação manual — não fazem mutação.
- godot_create_shader gera só o arquivo .gdshader; ShaderMaterial wrapper é manual.
- Setup de FixedJoint/Hinge/etc não coberto — usuário usa add_node manualmente.
```

---

## 5. Segurança

```text
[x] 10 ferramentas mutáveis bloqueadas em read-only.
[x] 2 read-only allowed: add_animation_track, assign_shader_material (instructional).
[x] Todas suportam dry_run com planned_changes.
[x] create_shader exige .gdshader extension (path sandbox).
[x] assign_shader_material valida .gdshader antes de retornar instructions.
[x] FILE_ALREADY_EXISTS sem overwrite=true em create_shader.
```

---

## 6. Erros padronizados

```text
INVALID_PARAMS         # path errado (extensão), filtros ausentes
FILE_ALREADY_EXISTS    # shader path existe sem overwrite
PATH_OUTSIDE_PROJECT   # res:// fora do sandbox
READ_ONLY_MODE         # mutações em read-only
```

---

## 7. Testes automatizados

`tests/toolkit13Tools.test.ts` — 22 testes:

```text
Physics:
  [x] setup_physics_body 2D adiciona RigidBody2D + CollisionShape2D + Sprite2D
  [x] setup_physics_body 3D include_visual=false skip MeshInstance3D
  [x] setup_physics_body bloqueado em read-only
  [x] set_collision_layers seta layer + mask
  [x] add_raycast_2d configura target_position + enabled

Animation:
  [x] create_animation_player adiciona AnimationPlayer
  [x] add_animation_track retorna instructions (read-only allowed)
  [x] create_animation_tree configura anim_player + active=true

Audio:
  [x] create_audio_stream_player_2d seta bus + volume_db + autoplay
  [x] create_audio_stream_player_3d aceita max_distance

Particles:
  [x] create_gpu_particles_2d defaults amount=32 emitting=true
  [x] create_gpu_particles_3d aceita amount custom

Shader:
  [x] create_shader escreve canvas_item template default
  [x] create_shader spatial template
  [x] create_shader rejeita non-.gdshader
  [x] assign_shader_material retorna instructions + valida extensão

Navigation:
  [x] setup_navigation_region_2d adiciona NavigationRegion2D
  [x] setup_navigation_region_2d dry_run não chama plugin
```

Total projeto: **28 files / 272 tests passing**.

---

## 8. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 272/272 passing
[x] 12 ferramentas Phase 13 registradas
[x] 6 sub-toolkits cobertos
[x] dry_run + read-only + path sandbox aplicados
[x] Templates GDShader válidos (Godot 4.x)
[x] Tools instructional documentam workflow para Resources

[ ] Validação manual com Godot ativo (ISSUE-020)
```

---

## 9. Testes manuais obrigatórios (Godot ativo)

```text
1. Abrir cena 2D, godot_setup_physics_body {name:"Ball", body_type:"RigidBody2D"}
   → confirmar tree Ball/Collision/Visual.
2. godot_set_collision_layers {node_path:"Ball", layer:1, mask:1} → inspector
   mostra layer/mask=1.
3. godot_add_raycast_2d {parent_path:"Ball"} → RayCast2D criado.
4. godot_create_animation_player → AnimationPlayer adicionado.
5. godot_add_animation_track → instructions retornadas (sem mutação).
6. godot_create_animation_tree {anim_player:"../AnimationPlayer"} → tree configurada.
7. godot_create_audio_stream_player_2d {bus:"SFX", volume_db:-6} → player criado.
8. godot_create_audio_stream_player_3d {max_distance:30} → player 3D criado.
9. godot_create_gpu_particles_2d {amount:128} → particles criadas.
10. godot_create_gpu_particles_3d {amount:64, emitting:false} → particles 3D criadas.
11. godot_create_shader {shader_path:"res://shaders/Test.gdshader"} → arquivo escrito.
12. godot_create_shader {shader_path:"res://shaders/Test3D.gdshader", shader_type:"spatial"}
    → arquivo escrito.
13. godot_assign_shader_material {node_path:"Sprite2D", shader_path:"res://shaders/Test.gdshader"}
    → instructions retornadas.
14. godot_setup_navigation_region_2d → NavigationRegion2D criada.
15. Atribuir NavigationPolygon via inspector + bake.
```

---

## 10. Pendências (não bloqueantes)

```text
[ ] Joint2D/Joint3D setup tools (HingeJoint3D, PinJoint2D, etc.) — futuro.
[ ] AudioBus management tools — futuro (precisa mexer em audio_bus_layout.tres).
[ ] Visual shader graph generator — fora de escopo (binário, não texto).
[x] Validação manual com Godot executada em 2026-05-04 (ISSUE-020 fechada).
[ ] Joint2D/Joint3D setup tools — futuro.
[ ] AudioBus management tools — futuro.
[ ] Visual shader graph generator — fora de escopo.
```

---

## 11. Status

```text
[x] Aprovada (escopo completo: 12 tools, 6 sub-toolkits)
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable.  
Todos os 15 testes passaram (testes 5+13 retornam instruções por limitação Resource; teste 15 requer inspector).  
Gate Fase 14: liberado.
