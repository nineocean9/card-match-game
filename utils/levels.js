// utils/levels.js — 关卡配置生成器(纯逻辑,无 wx 依赖)
//
// 随关卡号 n(1 起)递增难度:
//   - themeCount : 参与主题数(1,2,3...随关卡增加,封顶可配置)
//   - need(0/N)  : 每主题要求词数,在 [minNeed, maxNeed] 随关卡浮动
//   - steps      : 步数(随关卡递增,但相对盈余量递减 -> 越往后越紧)
//   - colCount   : 牌堆列数(随关卡增加)
//   - deckSize   : 抽牌堆数量(随关卡增加)
// 同时在设置页可手动覆盖这些参数(用于自定义/测试)。
//
// 主题选取:从词库随机挑 themeCount 个,保证:
//   - 主题名唯一(同关不出现重名主题,无论 text/emoji)
//   - 每主题词数 >= need(否则换主题)
//   - 尽量 mix:若开启,可在 emoji 主题与 text 主题间混合
const WORDS = require('../data/word1.js');

// 关卡参数基准：不是把某一关写死，而是用一条平滑的难度曲线生成。
// 设计目标：
//   1~2关：教学，主题少、牌少、步数宽松；
//   3~4关：进入正式难度，约 8~9 主题、5 列，参考实机的 18~19 张桌面牌；
//   中后期：主题数、每主题需求、总牌数和隐藏信息持续增加；
//   后期虽然牌更多、主题更多，但步数缓冲也同步放宽，避免变成单纯“步数卡死”。
function levelParams(n, opt) {
  const o = opt || {};
  const base = Math.max(1, n);

  // 主题数采用“5关一个大档”的平台曲线：
  // 同一档内部缓慢增加难度，进入下一档时再增加一个主题，避免之前3关一跳导致的增长过快。
  const themeCap = Math.max(8, o.themeCount || o.themeCap || 13);
  let themeCount;
  if(base===1) themeCount=4;
  else if(base===2) themeCount=6;
  else if(base===3) themeCount=8;
  else if(base===4) themeCount=9;
  else {
    const tier=Math.floor((base-5)/5);
    themeCount=Math.min(themeCap,9+tier);
  }

  // 每主题需求不能再用一个 need 给所有主题“一刀切”。
  // 3/4关的参考难度是类似 0/3、0/7、0/6、0/4、0/7... 的分布，
  // 因此这里直接生成一组需求量，让总词卡数接近目标牌量。
  const minNeed = Math.max(3, o.minNeed || 3);
  const maxNeed = Math.max(minNeed, o.maxNeed || 10);
  let needUpper;
  if(base<=2) needUpper=6 + base;
  else if(base<=4) needUpper=7;
  else {
    const tier = Math.floor((base-5)/5);
    const pos = (base-5)%5;
    needUpper=Math.min(maxNeed, 7 + tier + Math.floor(pos/2));
  }
  const needLower=minNeed;
  // pickThemes 使用最低需求筛选主题；实际每个主题的需求在 makeLevel 中生成。
  const need=needLower;

  // 列数：第3关进入五列，后面保持五列，通过牌量/主题量增加难度。
  const colCap=Math.max(5,o.colCap||5);
  const colCount=base<=2 ? 4 : Math.min(colCap,5);
  // 主题数量和“同时可放置的主题槽位”分离：UI 永远预留5个槽位；
  // 前期第5槽锁定，进入8~10主题这一档后再解锁第5槽。
  const slotCount=base>=8 ? 5 : 4;

  // 总牌量目标：先按关卡曲线确定“中心值”，再在 ±2 内随机浮动。
  // 注意：这里的目标总牌数包含每个主题对应的1张分类卡。
  let targetBase;
  if(base===1) targetBase=28;
  else if(base===2) targetBase=42;
  else if(base===3) targetBase=61;
  else if(base===4) targetBase=63;
  else {
    const tier=Math.floor((base-5)/5);
    const pos=(base-5)%5;
    targetBase=66 + tier*10 + pos*2;
  }
  // 目标总牌数只负责确定本关的规模，不再被后面的需求分布“偷偷改大”。
  // 若随机 ±2 恰好超出当前需求上下限可表达的范围，则重新取一个合法偏移，
  // 从而仍然保证“目标值附近 ±2”，同时保证后续需求分布一定能精确凑出该总数。
  const randomDelta = Math.floor(Math.random()*5)-2;
  const totalCards=targetBase+randomDelta;

  // 桌面牌数也要有随机性：中心值仍沿用原来的难度曲线，实际开局在小范围内浮动。
  // 第3关中心约18、第4关中心约19；后期随总牌量增长，桌面占比逐渐下降。
  let tableRatio;
  if(base<=2) tableRatio=0.70;
  else if(base<=4) tableRatio=0.30+(base-3)*0.01;
  else tableRatio=Math.max(0.24,0.31-(base-4)*0.008);
  const tableCenter=Math.round(totalCards*tableRatio);
  const tableMin=Math.max(colCount,tableCenter-2);
  const tableMax=Math.min(totalCards-1,tableCenter+2);
  const tableCount=tableMin+Math.floor(Math.random()*(tableMax-tableMin+1));
  const deckSize=totalCards-tableCount;

  // 步数曲线：同一主题档内采用“先明显增加、再持平/小增”的节奏。
  // 例如 5关比4关明显增加；6关可+5；7关可持平/+5，然后进入下一档。
  let steps;
  if(base===1) steps=70;
  else if(base===2) steps=100;
  else if(base<=4) steps=130;
  else {
    const tier = Math.floor((base-5)/5);
    const pos = (base-5)%5;
    steps=150 + tier*20 + pos*3;
  }
  steps=Math.min(o.stepCap||360,steps);

  return {themeCount,need,needUpper,needs:null,totalCards,colCount,deckSize,tableCount,steps,slotCount};
}

/** 从词库挑主题:唯一名 + 词数足够 */
function pickThemes(themeCount, need, opts) {
  const o = opts || {};
  const rng = (o.rng || Math.random);
  // 候选池:词数 >= need 的主题(先按名字去重,同名保留词数最多的,保证同关无重名)
  let pool = WORDS.filter(x => x.w.length >= need);
  if (o.onlyEmoji) pool = pool.filter(x => x.kind === 'emoji' || x.kind === 'mixed');
  else if (o.allowEmoji === false) pool = pool.filter(x => x.kind !== 'emoji' && x.kind !== 'mixed');
  const byName = new Map();
  for (const t of pool) {
    const cur = byName.get(t.t);
    if (!cur || t.w.length > cur.w.length) byName.set(t.t, t);
  }
  const uniquePool = Array.from(byName.values());

  const usedNames = o.excludeNames ? new Set(o.excludeNames) : new Set();
  const picked = [];
  let guard = 0;

  // 每关至少保证一个高辨识度 Emoji 主题。低关仍保持 Emoji/文字主题分离；
  // 高难度允许 word1.js 合并出的 mixed 主题进入候选池。
  if (o.requireEmoji) {
    const emojiPool = uniquePool.filter(x => x.kind === 'emoji' || (o.allowMixed && x.kind === 'mixed'));
    const emojiCandidates = emojiPool.filter(x => x.w.length >= need);
    if (emojiCandidates.length) {
      const first = emojiCandidates[Math.floor(rng() * emojiCandidates.length)];
      usedNames.add(first.t);
      picked.push(first);
    }
  }

  while (picked.length < themeCount && guard++ < 4000) {
    const cand = uniquePool[Math.floor(rng() * uniquePool.length)];
    if (!cand) break;
    if (usedNames.has(cand.t)) continue;  // 排除指定
    usedNames.add(cand.t);                // 本关不重名(唯一池已保证),但仍防御
    picked.push(cand);
  }
  return picked;
}

/** 生成一关的完整配置 */
function makeLevel(n, opts) {
  const o = opts || {};
  const p = levelParams(n, o);
  // 每关至少一个 Emoji 主题；前期保持 Emoji 与文字主题分离，
  // 从第 8 关开始逐步允许同名 mixed 主题进入候选池。
  const themeOpts = {
    ...o,
    requireEmoji: o.requireEmoji !== false,
    allowEmoji: o.allowEmoji !== false,
    allowMixed: o.allowMixed !== undefined ? o.allowMixed : n >= 8
  };
  // 关键：先决定“每个主题需要多少张词卡”，再去词库里寻找满足这个数量的主题。
  // 不能反过来先随机主题再塞需求量，否则很容易出现：主题只有4个词，却被分配到0/7，
  // 最后 makeDeck() 的 slice() 悄悄少发牌，导致关卡总牌数低于设计目标。
  // 分类卡本身每主题占1张，所以目标词卡数 = 目标总牌数 - 主题数。
  // 先根据词库实际容量校正目标，避免目标超出可表达范围后生成 NaN。
  // 优先通过调整主题需求量满足目标；词库确实装不下时，再把目标牌数压到
  // 当前主题数量能够承载的最大值，而不是直接让关卡生成失败。
  const capacityMap = new Map();
  for (const t of WORDS) {
    const old = capacityMap.get(t.t);
    if (!old || t.w.length > old.w.length) capacityMap.set(t.t, t);
  }
  const capacityPool = Array.from(capacityMap.values()).filter(t => t.w.length >= p.need)
    .sort((a,b) => b.w.length - a.w.length);
  if (capacityPool.length < p.themeCount) p.themeCount = capacityPool.length;
  if (p.themeCount <= 0) throw new Error('词库中没有可用于生成关卡的主题');
  const minWords = p.themeCount * p.need;
  const maxWords = capacityPool.slice(0,p.themeCount).reduce((sum,t) => sum + t.w.length, 0);
  let targetWords = p.totalCards - p.themeCount;
  targetWords = Math.max(minWords, Math.min(maxWords, targetWords));
  p.totalCards = targetWords + p.themeCount;
  // 档内目标如果高于默认上限，允许本关部分主题承担更高需求；具体上限仍受词库容量约束。
  const profileUpper = Math.max(p.needUpper, Math.ceil(targetWords / p.themeCount));
  let needs = [];
  let themes = [];

  // 需求量先生成：每主题至少 minNeed，随后把剩余数量随机分配到不同主题，
  // 形成类似 3/7、6/4、7/7... 的自然分布，而不是所有主题同一个数量。
  function makeNeedProfile(){
    const arr = Array(p.themeCount).fill(p.need);
    let remain = targetWords - arr.reduce((a,b)=>a+b,0);
    let guard = 0;
    while(remain > 0 && guard++ < 10000){
      const candidates = [];
      for(let i=0;i<arr.length;i++) if(arr[i] < profileUpper) candidates.push(i);
      if(!candidates.length) return null;
      const i = candidates[Math.floor(Math.random()*candidates.length)];
      arr[i]++;
      remain--;
    }
    if(remain !== 0) return null;
    // 需求量只和主题槽位绑定，后面再随机匹配具体主题。
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }

  // 根据“已经确定的需求量”逐个匹配主题。
  // 为避免前面抢走大容量主题导致后面无主题可用，优先处理需求量最大的槽位。
  function matchThemesByNeeds(profile){
    const used = new Set();
    const result = Array(p.themeCount);
    const order = profile.map((need,i)=>({need,i})).sort((a,b)=>b.need-a.need);
    const pool = WORDS.filter(x => x.w.length >= p.need);
    const byName = new Map();
    for(const t of pool){
      const old=byName.get(t.t);
      if(!old || t.w.length>old.w.length) byName.set(t.t,t);
    }
    const unique = Array.from(byName.values());
    for(const item of order){
      let candidates = unique.filter(t => !used.has(t.t) && t.w.length >= item.need);
      if(item.i === order[0].i && themeOpts.requireEmoji){
        const emojiCandidates = candidates.filter(t => t.kind === 'emoji' || (themeOpts.allowMixed && t.kind === 'mixed'));
        if(emojiCandidates.length) candidates = emojiCandidates;
      }
      if(!candidates.length) return null;
      // 在满足词数的主题中随机选择，而不是按词数排序固定选择。
      const chosen = candidates[Math.floor(Math.random()*candidates.length)];
      result[item.i] = chosen;
      used.add(chosen.t);
    }
    // 上面的“最大需求槽”优先承担 Emoji 约束；如果它没有 Emoji，
    // 再检查其它槽位并交换到一个满足需求的 Emoji 主题。
    if(themeOpts.requireEmoji && !result.some(t => t && (t.kind === 'emoji' || (themeOpts.allowMixed && t.kind === 'mixed')))){
      const emojiCandidates = unique.filter(t => t.kind === 'emoji' || (themeOpts.allowMixed && t.kind === 'mixed'));
      for(let i=0;i<result.length;i++){
        const ec = emojiCandidates.filter(t => !used.has(t.t) && t.w.length >= profile[i]);
        if(ec.length){ result[i]=ec[Math.floor(Math.random()*ec.length)]; return result; }
      }
      return null;
    }
    return result;
  }

  for(let attempt=0; attempt<500 && themes.length !== p.themeCount; attempt++){
    const profile = makeNeedProfile();
    if(!profile) break;
    const matched = matchThemesByNeeds(profile);
    if(matched){ needs=profile; themes=matched; }
  }

  // 理论上词库足够时不会进入这里；作为兜底仍然保证需求量先于主题匹配。
  if(themes.length !== p.themeCount){
    needs = makeNeedProfile() || Array(p.themeCount).fill(p.need);
    const fallbackPool = WORDS.filter(x=>x.w.length >= p.need);
    const byName = new Map();
    for(const t of fallbackPool){ const old=byName.get(t.t); if(!old || t.w.length>old.w.length) byName.set(t.t,t); }
    const unique=Array.from(byName.values());
    themes=[];
    const used=new Set();
    for(const need of [...needs].sort((a,b)=>b-a)){
      const c=unique.filter(t=>!used.has(t.t)&&t.w.length>=need);
      if(!c.length) break;
      const t=c[Math.floor(Math.random()*c.length)]; used.add(t.t); themes.push(t);
    }
    // 这里按需求量从高到低匹配；下面会把需求量按同样顺序绑定到主题。
    themes=themes.slice(0,p.themeCount);
    if(themes.length < p.themeCount) throw new Error('词库中没有足够的主题满足本关预先分配的需求量');
  }

  const require = {};
  themes.forEach((t,i)=>{ require[t.id]=needs[i]; });

  // 实际牌量由需求量决定，再据此计算桌面/抽牌堆数量。
  // 需求分布已经以 p.totalCards - themeCount 为目标生成；这里再次校验，
  // 防止以后修改需求算法时把“目标牌数”和“实际牌数”重新分离。
  const actualTotalCards=needs.reduce((a,b)=>a+b,0)+themes.length;
  if(actualTotalCards !== p.totalCards){
    throw new Error(`关卡${n}牌数生成异常：目标${p.totalCards}，实际${actualTotalCards}`);
  }
  const totalCards=p.totalCards;
  let tableRatio;
  if(n<=2) tableRatio=0.70;
  else if(n<=4) tableRatio=0.30+(n-3)*0.01;
  else tableRatio=Math.max(0.24,0.31-(n-4)*0.008);
  let tableCount=Math.round(totalCards*tableRatio);
  tableCount=Math.max(p.colCount+2,Math.min(totalCards-1,tableCount));
  const deckSize=totalCards-tableCount;
  return {
    id: n,
    themes: themes.map(t => t.id),
    themeNames: themes.map(t => ({ id: t.id, t: t.t, kind: t.kind })),
    require,
    steps: p.steps,
    colCount: p.colCount,
    deckSize,
    tableCount,
    slotCount: p.slotCount,
  };
}

module.exports = { levelParams, pickThemes, makeLevel, WORDS };
