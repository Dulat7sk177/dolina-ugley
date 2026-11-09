// ===== Все игровые настройки в одном месте — меняй цифры здесь =====

export const GAME_TITLE = 'Долина Углей';
export const PEER_PREFIX = 'dolina-uglei-rpg-v1-';
export const WORLD_SIZE = 240;
export let WATER_LEVEL = -3; // меняется при выборе карты

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

// ===== Карты =====
const MAPS = {
  valley: {
    id: 'valley', title: 'Долина Углей', subtitle: 'Фэнтези: северная долина', waterLevel: -3, fog: 0.0062, fogColor: 0xb4bcc4, bg: 1, envI: 0.75, exposure: 0.85, bloom: 0.45,
    elder: { x: 4.5, z: 2.5, name: 'Старейшина Ольгерд' },
    names: { minion: 'Мертвец', wolf: 'Волк', skeleton: 'Драугр', boss: 'Гримвальд Рогатый' },
    zones: {
      village: { name: 'Деревня', x: 0, z: 0, r: 22 },
      goblins: { name: 'Лагерь мертвецов', x: 58, z: 28, r: 14, enemy: 'minion', count: 8 },
      forest: { name: 'Волчий лес', x: -30, z: 62, r: 12, enemy: 'wolf', count: 6 },
      ruins: { name: 'Курган драугров', x: -58, z: -38, r: 16, enemy: 'skeleton', count: 7 },
      arena: { name: 'Арена Гримвальда', x: 18, z: -78, r: 15, enemy: 'boss', count: 1 },
    },
    quests: [
      { title: 'Нашествие нежити', desc: 'Уничтожь мертвецов в их лагере', zone: 'goblins', type: 'minion', need: 8, reward: 150 },
      { title: 'Волчья стая', desc: 'Расправься с волками в лесу', zone: 'forest', type: 'wolf', need: 6, reward: 200 },
      { title: 'Проклятые руины', desc: 'Упокой драугров в древнем кургане', zone: 'ruins', type: 'skeleton', need: 7, reward: 300 },
      { title: 'Гримвальд Рогатый', desc: 'Победи рогатого демона Гримвальда на арене', zone: 'arena', type: 'boss', need: 1, reward: 800 },
    ],
    lines: [
      'Мертвецы поднялись из земли и разбили лагерь у деревни! Прогоните их.',
      'Волки из леса нападают на путников. Нужна ваша сила!',
      'В древнем кургане пробудились драугры. Упокойте их, пока не поздно.',
      'Всё это — дело рук Гримвальда Рогатого, демона из старых сказаний. Он ждёт вас на арене — покончите с этим!',
      'Долина спасена! Вы — настоящие герои. Но враги всё ещё бродят вокруг…',
    ],
    victory: 'Гримвальд Рогатый повержен! Долина спасена!',
  },
  astana: {
    id: 'astana', title: 'Астана: Мёртвый город', subtitle: 'Зомби-апокалипсис на левом берегу', waterLevel: -1.3, fog: 0.0013, fogColor: 0x5f5c57, bg: 0.22, envI: 0.6, exposure: 0.85, bloom: 0.18,
    elder: { x: 7, z: 52, name: 'Выживший Ерлан' },
    names: { minion: 'Заражённый', wolf: 'Бешеный пёс', skeleton: 'Тёмный рыцарь', boss: 'Мутант «Альфа»' },
    zones: {
      village: { name: 'Лагерь у Байтерека', x: 0, z: 45, r: 25 },
      goblins: { name: 'Бульвар Нуржол', x: -280, z: -80, r: 30, enemy: 'minion', count: 10 },
      ruins: { name: 'Хан Шатыр', x: -1530, z: -505, r: 40, enemy: 'skeleton', count: 8 },
      forest: { name: 'Северный парк', x: 567, z: -780, r: 35, enemy: 'wolf', count: 7 },
      arena: { name: 'Площадь Ак Орды', x: 950, z: 260, r: 35, enemy: 'boss', count: 1 },
    },
    quests: [
      { title: 'Зачистка бульвара', desc: 'Перебей заражённых на бульваре Нуржол', zone: 'goblins', type: 'minion', need: 10, reward: 200 },
      { title: 'Тени Хан Шатыра', desc: 'Уничтожь тёмных рыцарей у Хан Шатыра', zone: 'ruins', type: 'skeleton', need: 8, reward: 350 },
      { title: 'Стая в парке', desc: 'Разберись с бешеными псами в северном парке', zone: 'forest', type: 'wolf', need: 7, reward: 300 },
      { title: 'Мутант «Альфа»', desc: 'Убей мутанта на площади перед Ак Ордой', zone: 'arena', type: 'boss', need: 1, reward: 900 },
    ],
    lines: [
      'Город пал за одну ночь. Заражённые бродят по бульвару Нуржол — расчистите путь!',
      'У Хан Шатыра видели тёмных рыцарей. Они охраняют что-то внутри. Будьте осторожны.',
      'В северном парке завелась стая бешеных псов. Они нападают на наших разведчиков.',
      'Источник заразы — мутант «Альфа» у Ак Орды. Убейте его, и город будет спасён!',
      'Альфа мёртв! Астана снова дышит. Но заражённые ещё бродят по улицам…',
    ],
    victory: 'Мутант «Альфа» повержен! Астана спасена!',
  },
};
export const MAP_LIST = Object.values(MAPS).map((m) => ({ id: m.id, title: m.title, subtitle: m.subtitle }));
export const MAP = { ...MAPS.valley };
export const ZONES = { ...MAPS.valley.zones };
export const QUESTS = [...MAPS.valley.quests];
export const ELDER_LINES = [...MAPS.valley.lines];

// Переключение карты: данные меняются «на месте», все модули видят новые значения
export function setMap(id) {
  const m = MAPS[id] || MAPS.valley;
  for (const k of Object.keys(MAP)) delete MAP[k];
  Object.assign(MAP, m);
  for (const k of Object.keys(ZONES)) delete ZONES[k];
  Object.assign(ZONES, m.zones);
  QUESTS.splice(0, QUESTS.length, ...m.quests);
  ELDER_LINES.splice(0, ELDER_LINES.length, ...m.lines);
  for (const [k, n] of Object.entries(m.names)) ENEMIES[k].name = n;
  WATER_LEVEL = m.waterLevel;
}

export const xpNeed = (lvl) => 100 + (lvl - 1) * 60;
