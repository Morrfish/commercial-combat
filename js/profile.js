/* Commercial Combat - local player profile (collection, deck, Ad Bucks).
 * Saved in this browser only. Later milestones move this to a server account
 * (required before real-money purchases).
 */
(function () {
  'use strict';
  const D = window.CC_DATA;
  const KEY = 'cc-profile-v1';
  // PLAYTEST VALUES - not approved economy numbers.
  const REWARDS = { win: 25, loss: 5, draw: 10 };
  const CHAR = {}; D.characters.forEach(c => { CHAR[c.id] = c; });
  const MOD = {}; D.modifiers.forEach(m => { MOD[m.id] = m; });

  function fresh() {
    return { v: 1, adBucks: 0, starterOpened: D.starter.map(() => false), owned: {}, deck: { chars: [], mods: [] },
      unlockAll: false, classicOpening: false, avatar: 'C077', story: {}, stats: { wins: 0, losses: 0, draws: 0 }, newCards: [] };
  }
  let P = fresh();
  let storageOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const x = JSON.parse(raw); if (x && x.v === 1) { delete x.bothSkip; P = Object.assign(fresh(), x); } }
    } catch (e) { storageOk = false; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { storageOk = false; } }
  load();

  const owns = id => P.unlockAll || (P.owned[id] || 0) > 0;
  function grant(ids) { for (const id of ids) { P.owned[id] = (P.owned[id] || 0) + 1; if (!P.newCards.includes(id)) P.newCards.push(id); } }

  function openStarter(i) {
    if (P.starterOpened[i]) return null;
    const pack = D.starter[i];
    P.starterOpened[i] = true;
    grant(pack.characters); grant(pack.modifiers);
    // When both starters are open and no deck exists yet, the guaranteed legal deck becomes the deck.
    if (P.starterOpened.every(Boolean) && !P.deck.chars.length) {
      P.deck.chars = D.starter.flatMap(p => p.characters); P.deck.mods = D.starter.flatMap(p => p.modifiers);
    }
    save();
    return { characters: pack.characters.slice(), modifiers: pack.modifiers.slice() };
  }

  function deckProblems(deck) {
    deck = deck || P.deck;
    const out = [];
    if (deck.chars.length !== 12) out.push(`Characters: ${deck.chars.length}/12`);
    if (deck.mods.length !== 12) out.push(`Modifiers: ${deck.mods.length}/12`);
    const leg = deck.chars.filter(id => CHAR[id] && CHAR[id].category === 'Legendary').length;
    if (leg > 2) out.push(`Too many Legendary characters (${leg}/2)`);
    if (new Set(deck.chars).size !== deck.chars.length || new Set(deck.mods).size !== deck.mods.length) out.push('No duplicate cards');
    const missing = deck.chars.concat(deck.mods).filter(id => !owns(id));
    if (missing.length) out.push(`${missing.length} card(s) not in your collection`);
    return out;
  }
  function setDeck(chars, mods) { P.deck = { chars: chars.slice(), mods: mods.slice() }; save(); }
  function resetToStarter() { setDeck(D.starter.flatMap(p => p.characters), D.starter.flatMap(p => p.modifiers)); }

  function recordResult(result) { // 'win' | 'loss' | 'draw'
    const earned = REWARDS[result] || 0;
    P.adBucks += earned; P.stats[result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++; save();
    return earned;
  }
  function setUnlockAll(on) { P.unlockAll = !!on; save(); }
  /* PLAYTEST ONLY - remove before any real-money release. The designer's tester code for store
     currency: COMBATCASH = +1,000 Ad Bucks; COMBATCASH<number> = that many (up to 100,000). Repeatable. */
  function redeemCode(code) {
    const m = /^COMBATCASH(\d{0,6})$/.exec(String(code || '').trim().toUpperCase().replace(/\s+/g, ''));
    if (!m) return 0;
    const amt = m[1] ? Math.min(100000, parseInt(m[1], 10)) : 1000;
    if (!(amt > 0)) return 0;
    P.adBucks += amt; save(); return amt;
  }
  // Opening rule (designer decision, 2026-11-22): BOTH players skip attacking on their own first turn.
  // classicOpening = the older v2 rule where only the first player skips (playtest option).
  function setClassicOpening(on) { P.classicOpening = !!on; save(); }
  function setAvatar(id) { P.avatar = id; save(); }
  /* Story progress per route: {starter, next (0-based chapter index), done} */
  function storyState(routeId) { return P.story[routeId] || null; }
  function storyStart(routeId, starterId, chars, mods) {
    P.story[routeId] = { starter: starterId, next: 0, done: false, wins: 0 };
    grant(chars); grant(mods); save();   // the chosen starter deck joins the collection
  }
  function storyWin(routeId, chapterIndex, rewardCards, last) {
    const s = P.story[routeId]; if (!s) return [];
    const fresh = (rewardCards || []).filter(id => !(P.owned[id] > 0));   // no duplicates from story
    grant(fresh);
    s.next = Math.max(s.next, chapterIndex + 1); s.wins++; if (last) s.done = true; save();
    return fresh;
  }
  function storyReset(routeId) { delete P.story[routeId]; save(); }
  function clearNew() { P.newCards = []; save(); }
  function resetProfile() { P = fresh(); save(); }

  window.CCProfile = {
    get data() { return P; }, get storageOk() { return storageOk; }, REWARDS, CHAR, MOD,
    owns, openStarter, deckProblems, setDeck, resetToStarter, recordResult, setUnlockAll, redeemCode, setClassicOpening, clearNew, resetProfile,
    setAvatar, storyState, storyStart, storyWin, storyReset,
    starterDone: () => P.starterOpened.every(Boolean),
    ownedCount: () => ({ chars: D.characters.filter(c => owns(c.id)).length, mods: D.modifiers.filter(m => owns(m.id)).length })
  };
})();
