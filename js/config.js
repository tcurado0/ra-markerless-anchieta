export const CAMPUS_CENTER = { lat: -23.21278, lon: -46.89295 };

export const DEFAULT_POINTS = [
  { id: 'predio1',    nome: 'Prédio 1',   lat: -23.213319, lon: -46.892950 },
  { id: 'predio2',    nome: 'Prédio 2',   lat: -23.212780, lon: -46.891875 },
  { id: 'predio3',    nome: 'Prédio 3',   lat: -23.212421, lon: -46.892755 },
  { id: 'predio4',    nome: 'Prédio 4',   lat: -23.211927, lon: -46.893439 },
  { id: 'anfiteatro', nome: 'Anfiteatro', lat: -23.213364, lon: -46.893879 },
];

export const SETTINGS = {
  minDistance: 50,
  eyeHeight: 1.5,
  arriveRadius: 15,
  maxRenderDistance: 50000,
  pinBaseHeight: 4,
  pinHeightPerMeter: 0.09,
  fovY: 60,
  gpsMaxAccuracy: 60,
  calibrationSeconds: 6,
  storageKey: 'ra-anchieta-pontos-v1',
  headingOffsetKey: 'ra-anchieta-heading-offset-v1',
};
