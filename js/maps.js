// Фасад карт: остальной код берёт рельеф и столкновения отсюда, а не из конкретного мира
import * as valley from './world.js';
import * as astana from './astana.js';
import { pointBlocked as towerBlocked } from './buildings.js';
import { setMap } from './config.js';

export let getHeight = valley.getHeight;
export let resolveCollision = valley.resolveCollision;
export let colliders = valley.colliders;
export let loadWorldAssets = valley.loadWorldAssets;
export let buildWorld = valley.buildWorld;
export let cameraBlocked = (x, y, z) => towerBlocked(x, y, z, 0.25);
export let currentMap = 'valley';

export function useMap(id) {
  setMap(id);
  currentMap = id === 'astana' ? 'astana' : 'valley';
  const m = currentMap === 'astana' ? astana : valley;
  getHeight = m.getHeight;
  resolveCollision = m.resolveCollision;
  colliders = m.colliders;
  loadWorldAssets = m.loadWorldAssets;
  buildWorld = m.buildWorld;
  cameraBlocked = currentMap === 'astana' ? astana.cameraBlocked : (x, y, z) => towerBlocked(x, y, z, 0.25);
}
