# mmWave Room Card

Card do Home Assistant que mostra **em tempo real a posição de alvos** detetados por sensores mmWave, sobre uma planta do quarto com paredes, portas, janelas, mobiliário e zonas.

- Sensores com **X e Y** (Everything Presence Lite/One/Pro, LD2450, Aqara FP2, …)
- Sensores **só com distância** (Aqara FP1E, …): arco à distância medida e ponto no ângulo definido
- Zonas, zonas de exclusão e entradas, com realce quando o alvo está dentro
- Paredes, portas (simples e duplas) e janelas; o tamanho do card ajusta-se às paredes
- Rotação do sensor, cone de visão configurável (abertura, alcance e rotação só visual)
- **Editor visual** e modo `debug`

## Instalação (HACS)

1. HACS → ⋮ → **Repositórios personalizados**
2. Adiciona o URL deste repositório e escolhe a categoria **Dashboard**
3. Instala **mmWave Room Card** e recarrega o browser (Ctrl+F5)

O HACS regista o recurso automaticamente. Se usares dashboards em modo YAML, adiciona:

```yaml
resources:
  - url: /hacsfiles/mmwave-room-card/mmwave-room-card.js
    type: module
```

## Configuração mínima

```yaml
type: custom:mmwave-room-card
title: Quarto
prefix: sensor.everything_presence_lite
room:
  pos_x: -2500
  pos_y: 0
  width: 5000
  height: 5200
```

O `prefix` cria 3 alvos com as entidades `<prefix>_target_N_x` e `<prefix>_target_N_y`.

> **Nota YAML:** escreve `"y"` entre aspas se usares essa chave; o YAML 1.1 interpreta `y` solto como `true`. Por isso o card usa `pos_x` e `pos_y` em todas as coordenadas.

## Opções gerais

| Opção | Descrição | Defeito |
|---|---|---|
| `title` | Título do card | |
| `unit` | `mm`, `cm` ou `m` (unidade de todos os valores) | `mm` |
| `prefix` | Cria os alvos 1 a 3 a partir do prefixo | |
| `sensor_position` | `top`, `bottom`, `left`, `right` (orientação do desenho) | `top` |
| `flip_x` | Espelha o eixo X | `false` |
| `sensor_rotation` | Rotação do sensor em graus (roda alvos e cone) | `0` |
| `trail` | Pontos do rasto | `20` |
| `grid` | Espaçamento da grelha | 1 m |
| `show_grid_labels` | Valores da grelha nos dois eixos | `true` |
| `hide_zero` | Esconde o alvo quando x e y são 0 | `true` |
| `show_info` | Texto com posições | `true` |
| `background` | Cor de fundo | `#0f1729` |
| `debug` | Mostra valores brutos e ângulos | `false` |
| `auto_bounds` | Ajusta o tamanho às paredes | `true` |
| `margin` | Margem em redor das paredes | ¼ da grelha |
| `x_min`, `x_max`, `y_min`, `y_max` | Limites manuais (sem paredes) | ±3000 / 0–6000 |

## Alvos

```yaml
targets:
  - name: T1
    pos_x: sensor.xxx_target_1_x
    pos_y: sensor.xxx_target_1_y
  - name: Pessoa            # sensor só com distância
    distance: sensor.aqara_fp1e_distance
    distance_unit: m         # m (defeito), cm ou mm
    angle: 0                 # número, texto, esquerda/direita ou entidade
    invert_angle: false
    show_arc: true
    color: "#f59e0b"
```

## Cone do sensor

| Opção | Descrição |
|---|---|
| `show_fov` | Mostra o cone |
| `fov` | Abertura em graus (120) |
| `fov_range` | Alcance do cone |
| `fov_rotation` | Rotação só visual do cone e da seta |
| `show_sensor_arrow` | Seta de direção do sensor |

## Planta

```yaml
room: { pos_x: -2500, pos_y: 0, width: 5000, height: 5200 }
walls:
  - { pos_x1: 0, pos_y1: 0, pos_x2: 0, pos_y2: 2000 }
  - closed: true            # linha com vários pontos
    points:
      - { pos_x: -2500, pos_y: 0 }
      - { pos_x: 2500, pos_y: 0 }
      - { pos_x: 2500, pos_y: 5200 }
wall_thickness: 100
wall_color: "#cbd5e1"
doors:
  - { pos_x: -1000, pos_y: 5200, width: 1600, angle: 0, open: -90, double: true }
windows:
  - { pos_x: 600, pos_y: 0, width: 1200, angle: 0 }
furniture:
  - { label: Cama, pos_x: -800, pos_y: 1200, width: 1600, height: 2000, color: "#b8b8c0" }
```

## Zonas

```yaml
zones:
  - name: Zone 1
    type: zone              # zone | exclusion | entry
    color: "#8b5cf6"        # opcional
    points:
      - { pos_x: -2500, pos_y: 300 }
      - { pos_x: 2500, pos_y: 300 }
      - { pos_x: 2500, pos_y: 4500 }
      - { pos_x: -2500, pos_y: 4500 }
```

## Desenvolvimento

Consulta o [CHANGELOG](CHANGELOG.md). Testes: `node tests/test.js`.

O ficheiro final está em `dist/mmwave-room-card.js`. Para publicar uma versão, cria um release no GitHub (ex.: `v1.0.0`); o workflow anexa o ficheiro ao release.
