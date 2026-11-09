// ===== Все игровые настройки в одном месте — меняй цифры здесь =====

export const GAME_TITLE = 'Долина Углей';
export const PEER_PREFIX = 'dolina-uglei-rpg-v1-';
export const WORLD_SIZE = 240;
export const WATER_LEVEL = -3;

export const CLASSES = {
  warrior: {
    name: 'Воин', hp: 160, mp: 60, mpRegen: 7, speed: 6.2, dmg: 22,
    abilities: {
      atk: { kind: 'slash', name: 'Удар мечом', cd: 0.55, mp: 0 },
      q: { kind: 'spin', name: 'Вихрь (урон вокруг)', cd: 5, mp: 25 },
      f: { kind: 'shield', name: 'Глухая оборона (-65% урона, 5 с)', cd: 14, mp: 20 },
    },
  },
  mage: {
    name: 'Маг', hp: 105, mp: 130, mpRegen: 11, speed: 6.2, dmg: 26,
    abilities: {
      atk: { kind: 'fireball', name: 'Огненный шар', cd: 0.7, mp: 4 },
      q: { kind: 'heal', name: 'Круг исцеления (лечит и поднимает союзников)', cd: 9, mp: 35 },
      f: { kind: 'nova', name: 'Ледяная волна (урон + замедление)', cd: 7, mp: 30 },
    },
  },
};

export const ENEMIES = {
  minion: { name: 'Мертвец', hp: 50, dmg: 7, speed: 3.8, range: 1.6, cd: 1.2, xp: 22, scale: 0.9, aggro: 15, radius: 0.5 },
  wolf: { name: 'Волк', hp: 40, dmg: 6, speed: 5.6, range: 1.6, cd: 1.0, xp: 18, scale: 1.0, aggro: 18, radius: 0.6 },
  skeleton: { name: 'Драугр', hp: 90, dmg: 12, speed: 3.2, range: 1.8, cd: 1.4, xp: 38, scale: 1.0, aggro: 17, radius: 0.5 },
  boss: { name: 'Гримвальд Рогатый', hp: 1100, dmg: 22, speed: 3.6, range: 3.2, cd: 1.7, xp: 600, scale: 2.2, aggro: 28, radius: 1.3 },
};

export const ZONES = {
  village: { name: 'Деревня', x: 0, z: 0, r: 22 },
  goblins: { name: 'Лагерь мертвецов', x: 58, z: 28, r: 14, enemy: 'minion', count: 8 },
  forest: { name: 'Волчий лес', x: -30, z: 62, r: 12, enemy: 'wolf', count: 6 },
  ruins: { name: 'Курган драугров', x: -58, z: -38, r: 16, enemy: 'skeleton', count: 7 },
  arena: { name: 'Арена Гримвальда', x: 18, z: -78, r: 15, enemy: 'boss', count: 1 },
};

export const QUESTS = [
  { title: 'Нашествие нежити', desc: 'Уничтожь мертвецов в их лагере', zone: 'goblins', type: 'minion', need: 8, reward: 150 },
  { title: 'Волчья стая', desc: 'Расправься с волками в лесу', zone: 'forest', type: 'wolf', need: 6, reward: 200 },
  { title: 'Проклятые руины', desc: 'Упокой драугров в древнем кургане', zone: 'ruins', type: 'skeleton', need: 7, reward: 300 },
  { title: 'Гримвальд Рогатый', desc: 'Победи рогатого демона Гримвальда на арене', zone: 'arena', type: 'boss', need: 1, reward: 800 },
];

export const ELDER_LINES = [
  'Мертвецы поднялись из земли и разбили лагерь у деревни! Прогоните их.',
  'Волки из леса нападают на путников. Нужна ваша сила!',
  'В древнем кургане пробудились драугры. Упокойте их, пока не поздно.',
  'Всё это — дело рук Гримвальда Рогатого, демона из старых сказаний. Он ждёт вас на арене — покончите с этим!',
  'Долина спасена! Вы — настоящие герои. Но враги всё ещё бродят вокруг…',
];

export const xpNeed = (lvl) => 100 + (lvl - 1) * 60;
