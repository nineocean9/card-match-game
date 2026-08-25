// 词库清理版（在 words.js 基础上过滤不合理主题，并调整节日主题）
// 说明：不改动原 words.js；运行时可由需要处替换引用为本文件。
const base = require('./words.js');

const REMOVE = new Set([
  '哲学价值','游戏属性','状态',
  '形容词','介词','数＋量','ABCC','AABB','AABC','叠词',
  '反义词组合','近义词组','同音不同字','颠倒成词','数字结尾',
  '含“三”成语','含“云”字','含木字旁','双人旁'
]);

// Emoji 质量筛选：优先保留一眼能认出的具体物体/动物/食物/交通工具等。
// 明显容易混淆的一组不进入关卡候选池（例如一串相近的笑脸、纯色圆点）。
const LOW_CLARITY_EMOJI = new Set([
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳',
  '🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤'
]);

function emojiClarity(item) {
  if (item.kind !== 'emoji') return 1;
  const ws = item.w || [];
  if (ws.length < 4) return 0;
  const low = ws.filter(x => LOW_CLARITY_EMOJI.has(x)).length;
  // 一个主题中大多数都是相似笑脸/色点时，辨识度过低。
  if (low / ws.length >= 0.6) return 0;
  return 1;
}

// 同名的文字主题 + Emoji 主题，在高难度阶段允许合并成一个 mixed 主题。
// 低难度仍然可以只使用其中一种表现形式。
const merged = new Map();
for (const item of base) {
  const prev = merged.get(item.t);
  if (!prev) merged.set(item.t, { ...item, w: [...item.w] });
  else {
    const seen = new Set(prev.w);
    for (const w of item.w) if (!seen.has(w)) prev.w.push(w);
    if (prev.kind !== item.kind) prev.kind = 'mixed';
  }
}

const result = [];
for (const item of merged.values()) {
  if (item.kind === 'emoji' && !emojiClarity(item)) continue;
  if (REMOVE.has(item.t)) continue;

  // 原“欧美节日装饰”统一并入“节日装饰”，保留中外代表性节日装饰。
  if (item.t === '欧美节日装饰') {
    result.push({ ...item, t: '节日装饰' });
    continue;
  }

  // 原“西方节日”改为“节日”，中国节日为主体、保留外国重大节日。
  if (item.t === '西方节日') {
    result.push({
      ...item,
      t: '节日',
      w: ['春节','元宵','清明','端午','七夕','中秋','重阳','冬至','圣诞节','情人节','万圣节','复活节','感恩节']
    });
    continue;
  }

  // 原“节日”主题改名，避免与上面的综合节日主题重名。
  if (item.t === '节日') {
    result.push({ ...item, t: '节日装饰' });
    continue;
  }

  result.push(item);
}

module.exports = result;
