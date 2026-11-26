# RA Markerless — Campus UniAnchieta

Atividade 03 — Realidade Aumentada Markerless (Prof. Clayton Valdo) — Centro Universitário Padre Anchieta.

Web app de **Realidade Aumentada baseada em localização** (sem marcador impresso): o celular usa
**GPS + bússola + giroscópio** para desenhar, sobre a imagem da câmera, um **pino 3D** (modelo
`map_pin.fbx`) na posição de cada prédio do campus, com o **nome do prédio logo acima**.

Pontos mapeados: **Prédio 1, Prédio 2, Prédio 3, Prédio 4 e Anfiteatro** — todos com pelo menos
**50 m** de distância entre si (o app valida isso automaticamente).

## Como usar

1. Abra o link hospedado (**precisa ser HTTPS**) no celular — Chrome (Android) ou Safari (iPhone).
2. Toque em **Iniciar Realidade Aumentada** e permita câmera, localização e sensores de movimento.
3. Aponte o celular ao redor: os pinos aparecem na direção de cada prédio com nome e distância.
   O radar (canto superior direito) e o cartão inferior indicam o prédio mais próximo e para onde virar.
4. Ao chegar a menos de 15 m de um ponto, o pino fica verde e aparece “Você chegou”.

**Modo simulação (PC):** botão *Modo simulação* na tela inicial. Arraste para olhar em volta e use
W/A/S/D ou as setas (Shift = correr). URL direta: `index.html?sim=1&e=0&n=-140&h=0`
(`e`/`n` = metros a leste/norte do centro do campus, `h` = rumo em graus).

## Calibração dos pontos (fazer no campus antes de gravar o vídeo)

As coordenadas iniciais são estimativas. No campus, abra ⚙︎ → vá até a frente de cada prédio →
**📍 Marcar aqui** (média do GPS por 6 s) → **Salvar**. Depois use **Exportar JSON** e substitua
`data/pontos.json` no repositório para que a calibração valha para todos os aparelhos.

## Estrutura

```
index.html            tela única do app (camadas: vídeo, WebGL, rótulos, HUD)
css/style.css         estilos
js/main.js            orquestração: permissões, laço de render, rótulos, radar, guia, calibração, simulação
js/config.js          pontos padrão e parâmetros (distância mínima, tamanhos, FOV…)
js/geo.js             Haversine, rumo, conversão lat/lon → ENU (metros), GPS com filtro
js/orientation.js     DeviceOrientation → quaternion (Android absoluto / iOS webkitCompassHeading)
js/renderer.js        WebGL puro: shaders Phong, pino 3D, anel no chão, projeção dos rótulos
js/math3d.js          matrizes 4x4 e quaternions
js/points.js          carregar/salvar/importar/exportar pontos (localStorage + JSON)
js/pinMesh.js         malha do pino GERADA a partir do FBX (não editar)
data/pontos.json      coordenadas dos prédios
assets/models/map_pin.fbx   modelo 3D original fornecido
tools/fbx_parser.py   leitor de FBX binário (sem dependências)
tools/fbx_to_js.py    converte o FBX em js/pinMesh.js
```

Regerar a malha: `python3 tools/fbx_to_js.py assets/models/map_pin.fbx js/pinMesh.js`

Sem dependências externas nem etapa de build: qualquer hospedagem estática com HTTPS serve
(GitHub Pages, Netlify, Vercel, Firebase Hosting…). Para testar local: `python3 -m http.server`
e abrir `http://localhost:8000/?sim=1`.
