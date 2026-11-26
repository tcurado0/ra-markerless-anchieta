// =============================================================================
// config.js — Pontos de interesse (POIs) e parâmetros gerais do app
// =============================================================================
// As coordenadas abaixo são ESTIMATIVAS iniciais em torno do campus
// (Av. Dr. Adoniro Ladeira, 94 — Jundiaí/SP). Antes de gravar o vídeo,
// o grupo deve ir até cada prédio e usar o botão "Marcar minha posição aqui"
// na tela de Configuração. As coordenadas calibradas ficam salvas no
// navegador (localStorage) e podem ser exportadas em JSON e coladas aqui
// para virarem o novo padrão do projeto.
// =============================================================================

export const CAMPUS_CENTER = { lat: -23.21278, lon: -46.89295 };

export const DEFAULT_POINTS = [
  { id: 'predio1',    nome: 'Prédio 1',   lat: -23.213319, lon: -46.892950 },
  { id: 'predio2',    nome: 'Prédio 2',   lat: -23.212780, lon: -46.891875 },
  { id: 'predio3',    nome: 'Prédio 3',   lat: -23.212421, lon: -46.892755 },
  { id: 'predio4',    nome: 'Prédio 4',   lat: -23.211927, lon: -46.893439 },
  { id: 'anfiteatro', nome: 'Anfiteatro', lat: -23.213364, lon: -46.893879 },
];

export const SETTINGS = {
  minDistance: 50,        // distância mínima exigida entre os pontos (m) — requisito B
  eyeHeight: 1.5,         // altura aproximada da câmera do celular (m)
  arriveRadius: 15,       // raio para considerar "você chegou" (m)
  maxRenderDistance: 50000, // pontos mais longe que isso não são desenhados (m)
  pinBaseHeight: 4,       // altura do pino quando está "colado" no usuário (m)
  pinHeightPerMeter: 0.09,// cresce com a distância para continuar visível
  fovY: 60,               // campo de visão vertical aproximado da câmera (graus)
  gpsMaxAccuracy: 60,     // leituras piores que isso (m) são descartadas se houver melhores
  calibrationSeconds: 6,  // tempo de média do GPS ao marcar um ponto
  storageKey: 'ra-anchieta-pontos-v1',
  headingOffsetKey: 'ra-anchieta-heading-offset-v1',
};
