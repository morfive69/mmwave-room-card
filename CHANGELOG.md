# Changelog

## 2.0.0

**Correções**
- Estilos isolados em Shadow DOM: o CSS do card já não afeta outros cards (antes `svg`, `.grid`, `.info`… eram globais).
- No editor visual, o card deixava de mostrar os alvos depois de cada alteração até uma entidade mudar. Corrigido.
- Texto de configuração (título, nomes, cores, entidades) é escapado: já não parte o HTML.
- `grid: 0`, limites invertidos ou grelhas muito densas já não bloqueiam o browser.
- Limites por defeito escalados à unidade (antes eram sempre em mm, mesmo com `unit: m`).
- Aberturas de portas e janelas feitas com máscara SVG, sem depender da cor de fundo.

**Desempenho**
- Atualizações agrupadas por frame: x e y recebidos em eventos separados já não fazem o alvo "saltar" na diagonal.
- Só recalcula quando uma entidade usada pelo card muda.
- Configuração normalizada uma única vez; formas inválidas (zonas, paredes, portas…) são ignoradas em vez de gerarem erros.
- Rasto só regista pontos quando o alvo se move.

**Melhorias**
- Etiqueta das zonas no centroide do polígono.
- Textos do card em português e inglês (segue o idioma do Home Assistant).
- `getGridOptions` para a vista de secções; `prefers-reduced-motion` respeitado.
- Espessura das paredes e margem por defeito deixam de depender de `grid` (0,1 m e 0,25 m).
- Testes automáticos em `tests/test.js` (`node tests/test.js`).

Todas as opções da v1 continuam a funcionar.
