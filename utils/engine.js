// utils/engine.js — 「卡牌分类收集消除」核心引擎(纯逻辑,无 wx 依赖,可在 Node 中单测)
//
// 玩法:
//   - 每关选出若干主题(theme)。每个主题 = 1 张主题卡 + N 张词卡(题面 0/N)。
//   - 【纯随机发牌】所有牌(主题卡+词卡)混合打乱,随机分到若干「列」;列与列牌数
//     在均匀基础上加随机差异;一部分牌抽进抽牌堆。
//   - 只有每列【栈顶一张】朝上可拖;拖走后下方牌翻开。
//   - 玩家把【主题卡】拖进空槽位激活主题(显示 x/N);再把同主题【词卡】拖进槽位,
//     凑满 N 张 -> 消灭该主题,槽位复位并可复用。
//   - 场上所有牌(列 + 抽牌堆 + 抽出的牌 + 临时卡槽)清空 => 过关;步数归零 => 失败。
//
// 放置规则(拖动):
//   - 主题卡 -> 空槽位激活; 词卡 -> 自己主题槽位收集 (均扣 1 步)
//   - 词卡 -> 空堆/同主题词卡堆顶:允许 (同主题不扣步)
//   - 词卡 -> 不同主题牌堆:扣 1 步并阻止
//   - 主题卡 -> 牌堆:阻止 (主题卡只能入槽位)
//   - 临时卡槽:可放任意牌 (不扣步)
//
// 道具:
//   - 洗牌(shuffleAll):不影响已在槽位上的牌;其余所有牌(含抽牌堆、未翻开)重新洗牌
//     重发到各列,只显示顶牌;可以把底层牌洗进抽牌堆。
//   - 收牌(reclaim):自由模式,任意牌可挪到任意位置(不校验主题)。

// ---- 工具 ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}
let __uid = 0;
function uid() { return 't' + Date.now().toString(36) + '_' + (++__uid); }
function pickWords(words, n, rng) {
  const pool = words.slice();
  shuffle(pool, rng);
  return pool.slice(0, n);
}

/**
 * 把 tiles 随机分到 colCount 列,牌数在均匀基础上加差异
 * @returns {Array<Array>} piles(colCount 个数组)
 */
function dealRandom(tiles, colCount, rng) {
  const piles = [];
  for (let i = 0; i < colCount; i++) piles.push([]);
  const arr = tiles.slice();
  shuffle(arr, rng);
  // 均匀基础
  const base = Math.floor(arr.length / colCount);
  const rem = arr.length % colCount;
  // 每列初始 base,前 rem 列 +1
  const counts = new Array(colCount).fill(base);
  for (let i = 0; i < rem; i++) counts[i]++;
  // 加随机差异:随机把若干张从某列挪到另一列
  const diff = Math.max(1, Math.floor(colCount / 2));
  for (let k = 0; k < diff; k++) {
    const from = Math.floor(rng() * colCount);
    const to = Math.floor(rng() * colCount);
    if (from !== to && counts[from] > 1) { counts[from]--; counts[to]++; }
  }
  // 填入
  let idx = 0;
  for (let c = 0; c < colCount; c++) {
    for (let j = 0; j < counts[c] && idx < arr.length; j++) {
      const t = arr[idx++];
      t.col = c;
      piles[c].push(t);
    }
  }
  return piles;
}

/**
 * 构建一关(纯随机发牌)
 * @param {object} level { id, themes:[tid...], require:{tid:n}, steps, colCount, deckSize }
 * @param {object} catalogById { tid: {t, kind, w} }
 * @returns {object} state
 */
function buildLevel(level, catalogById) {
  const rng = mulberry32((level.id || 1) * 7919 + 13);
  const colCount = Math.max(1, level.colCount || 5);

  // 1) 生成全部牌(主题卡 + 词卡)
  const allTiles = [];
  const themeDefs = [];
  for (const tid of (level.themes || [])) {
    const cat = catalogById[tid];
    if (!cat) continue;
    const need = Math.max(1, Number(level.require[tid]) || 3);
    const picked = pickWords(cat.w, need, rng);
    themeDefs.push({ id: tid, t: cat.t, kind: cat.kind, need });
    // 词卡
    for (const w of picked) {
      allTiles.push({ id: uid(), tid, role: 'word', word: w, kind: cat.kind, faceUp: false, col: -1, layer: -1 });
    }
    // 主题卡
    allTiles.push({ id: uid(), tid, role: 'theme', word: cat.t, kind: cat.kind, faceUp: false, col: -1, layer: -1 });
  }

  // 2) 纯随机分列(数量均匀+差异)
  const piles = dealRandom(allTiles, colCount, rng);
  refaceAll(piles);

  // 3) 抽牌堆:从各列抽一部分词卡进 deck(增加找牌难度;也保留部分底层可洗入)
  const deck = [];
  const deckTake = Math.max(0, level.deckSize || 0);
  if (deckTake > 0) {
    const cands = [];
    for (const pile of piles) {
      for (let i = 0; i < pile.length - 1; i++) {  // 非栈顶
        const t = pile[i];
        if (t.role === 'word') cands.push(t);
      }
    }
    shuffle(cands, rng);
    let taken = 0;
    for (const t of cands) {
      if (taken >= deckTake) break;
      const pile = t.col >= 0 ? piles[t.col] : null;
      if (!pile) continue;
      const idx = pile.indexOf(t);
      if (idx < 0) continue;
      pile.splice(idx, 1);
      t.faceUp = false; t.col = -1;
      deck.push(t);
      taken++;
    }
    refaceAll(piles);
  }

  const state = {
    levelId: level.id, colCount, steps: level.steps, goalCount: themeDefs.length,
    themes: themeDefs.map(d => ({ ...d, collected: 0, done: false })),
    piles, deck, drawn: [], tempSlot: [], slots: [],
    activation: {}, finished: false, win: false, unlimited: level.steps >= 999,
    freePlace: false,   // 收牌模式:任意牌可放任意位置
  };
  return state;
}

function refaceAll(piles) {
  for (const pile of piles) {
    // 防御:去掉意外混入的空洞
    for (let i = pile.length - 1; i >= 0; i--) if (!pile[i]) pile.splice(i, 1);
    pile.forEach((t, i) => {
      t.layer = i;
      // faceUp 是"单调"的:被揭示(曾为顶)的牌永远保持 faceUp(可渲染内容),不再变回未知
      t.revealed = t.revealed || t.faceUp;
    });
    const top = pile[pile.length - 1];
    if (top) { top.faceUp = true; top.revealed = true; }
  }
}

/** 槽位数量(默认=主题数;可由设置覆盖,小于主题数需连锁) */
function initSlots(state, slotCount) {
  const n = Math.max(1, slotCount || state.goalCount);
  state.slots = [];
  for (let i = 0; i < n; i++) state.slots.push({ tid: null, cards: [], done: false });
  return state;
}

/** 定位 tile */
function locate(state, tileId) {
  for (const pile of state.piles) { const t = pile.find(x => x.id === tileId); if (t) return { kind: 'pile', tile: t, pile }; }
  for (const t of state.deck) if (t.id === tileId) return { kind: 'deck', tile: t };
  for (const t of state.drawn) if (t.id === tileId) return { kind: 'drawn', tile: t };
  for (const t of state.tempSlot) if (t.id === tileId) return { kind: 'temp', tile: t };
  for (const s of state.slots) { const t = s.cards.find(x => x.id === tileId); if (t) return { kind: 'slot', tile: t, slot: s }; }
  return null;
}

/** tile 当前是否可拖:列栈顶(faceUp)、已抽出、临时卡槽 */
function isDraggable(state, tileId) {
  const loc = locate(state, tileId);
  if (!loc) return false;
  if (loc.kind === 'pile') {
    const pile = state.piles[loc.tile.col];
    const top = pile[pile.length - 1];
    if (!top) return false;
    return top.id === tileId && top.faceUp;
  }
  return loc.kind === 'drawn' || loc.kind === 'temp';
}

/** 从状态任意位置移除 tile */
function detach(state, tileId) {
  for (const pile of state.piles) { const i = pile.findIndex(t => t.id === tileId); if (i >= 0) { pile.splice(i, 1); refaceAll(state.piles); return; } }
  const di = state.deck.findIndex(t => t.id === tileId); if (di >= 0) { state.deck.splice(di, 1); return; }
  const dpi = state.drawn.findIndex(t => t.id === tileId); if (dpi >= 0) { state.drawn.splice(dpi, 1); return; }
  const ti = state.tempSlot.findIndex(t => t.id === tileId); if (ti >= 0) { state.tempSlot.splice(ti, 1); return; }
  for (const s of state.slots) { const i = s.cards.findIndex(t => t.id === tileId); if (i >= 0) { s.cards.splice(i, 1); return; } }
}

/**
 * 同类合并:抓起起点牌,返回「整叠」可移动的牌组。
 * 规则:若起点在牌堆列中,则向【下】(相邻、更底层)找同主题、已翻开(faceUp=true)的连续词卡,
 *     连同起点一起作为一叠返回。一旦遇到主题卡、未知牌(未翻开)、或不同主题,立即停止。
 *     —— 绝不把未翻开的未知牌吞进整叠(避免"带起下方未知牌"和"卡住"问题)。
 * 若起点在抽出区/临时卡槽,则返回仅包含自身的一叠。
 * @returns {{tiles:[...], fromCol:number, fromLayer:number}}
 */
function collectBatch(state, tileId) {
  const loc = locate(state, tileId);
  if (!loc) return { tiles: [], fromCol: -1, fromLayer: -1 };
  const tile = loc.tile;
  if (loc.kind !== 'pile') return { tiles: [tile], fromCol: -1, fromLayer: -1 };
  const pile = state.piles[loc.tile.col];
  const idx = pile.indexOf(tile);
  if (idx < 0) return { tiles: [tile], fromCol: -1, fromLayer: -1 };
  const tiles = [tile];
  // 向下找连续、同主题、已翻开的词卡;遇未翻开/主题卡/不同主题即停
  let j = idx - 1;
  while (j >= 0) {
    const below = pile[j];
    if (below.faceUp === true && below.role === 'word' && below.tid === tile.tid) { tiles.unshift(below); j--; }
    else break;
  }
  return { tiles, fromCol: tile.col, fromLayer: idx };
}

/** 整叠的来源位置标识(用于"是否原位"判定) */
function batchSource(batch) {
  // {col, bottomLayer, topLayer};col=-1 表示场外
  if (batch.fromCol === -1) return { col: -1 };
  return { col: batch.fromCol, bottomLayer: batch.fromLayer, topLayer: batch.fromLayer + batch.tiles.length - 1 };
}

/**
 * 放置整叠到目标区域。
 * @param {object} state
 * @param {object} batch collectBatch 的结果 {tiles, fromCol, fromLayer}
 * @param {object} target { type:'slot'|'pile'|'temp', index? }
 * @returns {{ok, event, steps, moved, theme?}}
 *   moved: 是否发生了真实移动(用于扣步);true 表示位置有变,false(放回原位)不扣步
 */
function placeBatch(state, batch, target) {
  if (state.finished) return { ok: false, event: 'finished', steps: 0, moved: false };
  const tiles = batch.tiles;
  if (!tiles || !tiles.length) return { ok: false, event: 'notfound', steps: 0, moved: false };
  const first = tiles[0];
  const freePlace = state.freePlace || false;

  if (target.type === 'slot') {
    const slot = state.slots[target.index];
    if (!slot) return { ok: false, event: 'noslot', steps: 0, moved: false };
    // 主题卡激活(仅单张)
    if (first.role === 'theme') {
      if (tiles.length !== 1) return { ok: false, event: 'themeroll', steps: 0, moved: false };
      if (slot.tid) return { ok: false, event: 'slotbusy', steps: 0, moved: false };
      detachEach(state, tiles);
      slot.tid = first.tid;
      slot.cards = [{ ...first, faceUp: true, col: -1, layer: -1 }];
      markActivated(state, first.tid, target.index);
      return { ok: true, event: 'activate', steps: 1, moved: true, theme: state.themes.find(x => x.id === first.tid) };
    }
    // 词卡收集:整叠同主题词卡可一次放入(收集计数 += len)
    if (slot.tid === first.tid) {
      const th = state.themes.find(x => x.id === first.tid);
      if (!th || th.done) return { ok: false, event: 'themeDone', steps: 0, moved: false };
      if (tiles.some(t => t.tid !== first.tid)) return { ok: false, event: 'wrongtheme', steps: 0, moved: false };
      detachEach(state, tiles);
      for (const t of tiles) slot.cards.push({ ...t, faceUp: true, col: -1, layer: -1 });
      th.collected += tiles.length;
      if (th.collected >= th.need) { th.done = true; slot.done = true; }
      return { ok: true, event: 'collect', steps: 1, moved: true, theme: th };
    }
    return { ok: false, event: 'wrongtheme', steps: 0, moved: false };
  }

  if (target.type === 'pile') {
    const pile = state.piles[target.index];
    if (!pile) return { ok: false, event: 'nopile', steps: 0, moved: false };
    if (first.role === 'theme') return { ok: false, event: 'themetopile', steps: 0, moved: false };
    const top = pile[pile.length - 1];
    const isSamePile = batch.fromCol === target.index; // 放回原列
    // 回到原列且无其它牌被移动方向改变 => 视为原位,不扣步
    const isInPlace = isSamePile && (top ? top.id === first.id : false);
    // 收牌/空堆/同主题:允许
    const canPlace = freePlace || !top || (top.role !== 'theme' && top.tid === first.tid);
    if (!canPlace) {
      // 不同主题牌堆(或主题卡上):扣 1 步并阻止
      return { ok: false, event: (top && top.role === 'theme') ? 'ontheme' : 'wrongpile', steps: 1, moved: false };
    }
    detachEach(state, tiles);
    for (const t of tiles) pile.push({ ...t, faceUp: true, col: target.index, layer: pile.length++ });
    refaceAll(state.piles);
    const moved = !isInPlace;  // 放回原位则不扣步
    return { ok: true, event: 'place', steps: moved ? 1 : 0, moved };
  }

  if (target.type === 'temp') {
    detachEach(state, tiles);
    for (const t of tiles) state.tempSlot.push({ ...t, faceUp: true, col: -1, layer: -1 });
    return { ok: true, event: 'temp', steps: 0, moved: false };
  }

  return { ok: false, event: 'badtarget', steps: 0, moved: false };
}

/** 从各自来源移除整叠 */
function detachEach(state, tiles) {
  for (const t of tiles) detach(state, t.id);
}

/** 兼容旧签名:place 委托 placeBatch(单张);供旧调用方/测试使用 */
function place(state, tileId, target) {
  if (state.finished) return { ok: false, event: 'finished', steps: 0, moved: false };
  const batch = collectBatch(state, tileId);
  const r = placeBatch(state, batch, target);
  return r;
}
function markActivated(state, tid, slotIdx) {
  if (!state.activation[tid]) state.activation[tid] = { col: -1, slotIdx };
  state.activation[tid].slotIdx = slotIdx;
}

/** 扣步数(仅当 n>0 才扣;n 缺省视为 1) */
function step(state, n) {
  if (state.unlimited) return;
  const d = (n === undefined || n === null) ? 1 : n;
  if (d <= 0) return;
  state.steps = Math.max(0, state.steps - d);
  if (state.steps <= 0) { state.finished = true; state.win = false; }
}

/** 抽一张牌(deck -> drawn),扣 1 步 */
function draw(state) {
  if (state.finished) return { ok: false, event: 'finished' };
  if (state.deck.length === 0) return { ok: false, event: 'emptydeck' };
  const t = state.deck.pop();
  t.faceUp = true; t.col = -1; t.layer = -1;
  state.drawn.push(t);
  step(state, 1);
  return { ok: true, event: 'draw', tile: t };
}

/** 把已收集满的槽位复位(清空、复用) */
function flushSlots(state) {
  for (const s of state.slots) {
    if (s.done) { s.cards = []; s.tid = null; s.done = false; }
  }
  return state;
}

/** 结算:场上无剩余牌 => win;步数透支 => fail */
function settle(state) {
  if (state.finished) return state;
  const left =
    state.piles.reduce((n, p) => n + p.length, 0) +
    state.deck.length + state.drawn.length + state.tempSlot.length +
    state.slots.reduce((n, s) => n + (s.tid ? s.cards.length : 0), 0);
  if (left === 0) { state.finished = true; state.win = true; return state; }
  if (!state.unlimited && state.steps <= 0) { state.finished = true; state.win = false; }
  return state;
}

/** 当前可拖的牌(高亮/提示) */
function draggableTiles(state) {
  const out = [];
  for (const pile of state.piles) { const top = pile[pile.length - 1]; if (top) out.push(top); }
  for (const t of state.drawn) out.push(t);
  for (const t of state.tempSlot) out.push(t);
  return out;
}

/**
 * 洗牌道具:不动已在槽位上的牌;其余所有牌(列+抽牌堆+抽出+临时卡槽)重新洗牌重发。
 * @param {object} state
 * @param {object} opts { colCount?, deckRatio? } 可选强制参数
 * @returns {object} state
 */
function shuffleAll(state, opts) {
  const o = opts || {};
  const colCount = o.colCount || state.colCount || 5;
  const rng = (o.rng || Math.random);
  // 收集除槽位牌外的所有牌
  const all = [];
  for (const pile of state.piles) all.push(...pile);
  all.push(...state.deck);
  all.push(...state.drawn);
  all.push(...state.tempSlot);
  // 清空
  state.piles = []; state.deck = []; state.drawn = []; state.tempSlot = [];
  // 重新随机分列(数量均匀+差异)
  const piles = dealRandom(all, colCount, rng);
  refaceAll(piles);
  state.piles = piles;
  // 抽牌堆:把一部分词卡从各列抽进 deck
  const deckRatio = (o.deckRatio !== undefined ? o.deckRatio : 0.15);
  const deckTarget = Math.round(all.length * deckRatio);
  const cands = [];
  for (const pile of piles) for (let i = 0; i < pile.length - 1; i++) if (pile[i].role === 'word') cands.push(pile[i]);
  shuffle(cands, rng);
  let taken = 0;
  for (const t of cands) {
    if (taken >= deckTarget) break;
    const pile = t.col >= 0 ? piles[t.col] : null;
    if (!pile) continue;
    const idx = pile.indexOf(t);
    if (idx < 0) continue;
    pile.splice(idx, 1);
    t.faceUp = false; t.col = -1;
    state.deck.push(t);
    taken++;
  }
  refaceAll(state.piles);
  state.selected = undefined;
  return state;
}

/** 收牌道具:开启自由放置模式(任意牌可放任意 pile/槽位,不校验主题) */
function reclaim(state) {
  state.freePlace = true;
  // 一次性道具:开启后本次拖放自由;结束后关闭
  return state;
}

/** 关闭收牌自由模式 */
function clearFree(state) { state.freePlace = false; return state; }

module.exports = {
  buildLevel, initSlots, locate, isDraggable, place, placeBatch, collectBatch, draw, settle,
  flushSlots, step, draggableTiles, shuffleAll, reclaim, clearFree,
  mulberry32, shuffle, pickWords, dealRandom,
};
