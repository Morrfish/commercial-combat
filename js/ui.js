/* Commercial Combat - battle screen controller (human vs bot). */
(function () {
  'use strict';
  const { Game, C, M, S, card, hp, atk, cat, randomDeck, starterDeck } = window.CC;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const charArt = cid => `${CCA(`art/characters/${C[cid].id}.webp`)}`;
  const modArt = mid => `${CCA(`art/modifiers/${mid}.webp`)}`;
  const emblem = c => `${CCA(`assets/emblems/${c.toLowerCase()}.webp`)}`;
  const TIMING_HELP = {
    Action: 'Your Prepare step only', Either: 'Prepare, while attacking, or as your response',
    Response: 'Only as your response', Attack: 'While you are attacking', 'After attack': 'After your attack resolves'
  };

  let G = null, HUMAN = 0, BOT = 1;
  let mode = 'idle';          // idle | human | attack | after | bot | over
  let sel = { ally: null, enemy: null };
  let detailKey = null;       // {type:'unit'|'mod', key}
  let busy = false;

  // ---------------- screens ----------------
  const Pr = window.CCProfile;
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  function home() {
    const P = Pr.data; const done = Pr.starterDone();
    $('walletBucks').textContent = P.adBucks;
    $('avatarImg').src = `${CCA(`assets/avatar-${P.avatar}.webp`)}`;
    $('btnPacks').style.display = done ? 'none' : '';
    $('btnQuick').classList.toggle('ghost', !done);
    $('titleRecord').textContent = `Record ${P.stats.wins}W–${P.stats.losses}L${P.stats.draws ? '–' + P.stats.draws + 'D' : ''}` + (Pr.storageOk ? '' : ' · progress can\'t be saved in this browser');
    show('title');
  }
  $('btnQuick').onclick = startQuick;
  $('btnHow').onclick = howTo;
  $('btnPacks').onclick = () => window.CCPacks.show();
  $('btnShowroom').onclick = () => window.CCShowroom.show();
  $('packBack').onclick = home;
  $('srBack').onclick = () => window.CCShowroom.leave();
  $('btnOptions').onclick = optionsModal;
  $('btnStory').onclick = () => window.CCStory.show();
  $('btnRules').onclick = () => openRulebook();
  $('btnRules2').onclick = () => openRulebook();
  $('btnAvatar').onclick = avatarModal;

  // Rulebook: an overlay iframe, so opening it never resets a battle.
  let rbReturn = null;
  function openRulebook(page) {
    rbReturn = document.activeElement;
    const f = $('rbFrame');
    const want = 'rulebook/index.html' + (page ? '#' + page : '');
    if (!f.getAttribute('src') || page) f.setAttribute('src', want);
    $('rulebook').classList.remove('hidden'); $('rbClose').focus();
  }
  function closeRulebook() { $('rulebook').classList.add('hidden'); if (rbReturn && rbReturn.focus) rbReturn.focus(); }
  $('rbClose').onclick = closeRulebook;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('rulebook').classList.contains('hidden')) closeRulebook(); });

  function avatarModal() {
    const n = el('div'); n.appendChild(el('h2', null, 'Choose Your Avatar'));
    const row = el('div', 'row avatars');
    for (const id of AVATARS) {
      const b = el('button', 'avatarpick' + (Pr.data.avatar === id ? ' on' : ''), `<img src="${CCA(`assets/avatar-${id}.webp`)}" alt="">`);
      b.title = window.CC.C[window.CC.CID[id]].name;
      b.onclick = () => { Pr.setAvatar(id); closeModal(); home(); };
      row.appendChild(b);
    }
    n.appendChild(row);
    const f = el('div', 'foot'); const c = el('button', 'btn ghost', 'Cancel'); c.onclick = closeModal; f.appendChild(c); n.appendChild(f);
    openModal(n, true);
  }
  $('btnQuit').onclick = () => confirmModal('Leave this battle?', 'The match will be lost.', () => { mode = 'idle'; home(); });
  $('rGraveBtn').onclick = () => graveModal(BOT);
  $('yGraveBtn').onclick = () => graveModal(HUMAN);
  const fastBox = $('fast');
  try { fastBox.checked = localStorage.getItem('cc-fast') === '1'; } catch (e) { /* storage blocked */ }
  fastBox.onchange = () => { try { localStorage.setItem('cc-fast', fastBox.checked ? '1' : '0'); } catch (e) { /* ignore */ } };
  const pace = ms => fastBox.checked ? Math.round(ms * 0.3) : ms;

  // ---------------- modal helpers ----------------
  function openModal(node, dismissable) {
    const box = $('modalBox'); box.innerHTML = ''; box.appendChild(node);
    $('modal').classList.remove('hidden');
    $('modal').onclick = dismissable ? (e => { if (e.target.id === 'modal') closeModal(); }) : null;
  }
  function closeModal() { $('modal').classList.add('hidden'); }
  function confirmModal(title, text, yes) {
    const n = el('div'); n.appendChild(el('h2', null, esc(title))); n.appendChild(el('p', null, esc(text)));
    const f = el('div', 'foot'); const no = el('button', 'btn ghost', 'Cancel'); const ok = el('button', 'btn danger', 'Yes');
    no.onclick = closeModal; ok.onclick = () => { closeModal(); yes(); }; f.append(no, ok); n.appendChild(f); openModal(n, true);
  }
  let toastTimer = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }

  function howTo() {
    const n = el('div', 'howto');
    n.innerHTML = `<h2>How to Play</h2>
      <ul>
        <li><b>Win:</b> at the end of a player's own turn, if they have no characters in play, they lose. You always get one turn to rebuild.</li>
        <li><b>Battle Coins:</b> both players start with 100 for the whole match. Buying characters, specials (the + cost) and modifiers all spend them. There is no income.</li>
        <li><b>Each turn:</b> draw a character and a modifier. You may buy <b>one</b> character, use <b>one</b> special, play <b>one</b> modifier, and make <b>one</b> attack.</li>
        <li><b>New characters</b> can't attack or use specials until your next turn. <b>Neither player can attack on their own first turn</b> (buying, specials and modifiers are still allowed).</li>
        <li><b>Damage stays.</b> Defense is health. Guard blocks damage for one battle; Exposure is negative Guard.</li>
        <li><b>Responses:</b> once per opposing turn you may answer an attack or modifier with a Response/Either special or modifier.</li>
        <li><b>Targets:</b> click one of your characters (blue) and an enemy (red). Specials and modifiers use those as their targets when they can.</li>
      </ul>`;
    const f = el('div', 'foot'); const ok = el('button', 'btn', 'Got it'); ok.onclick = closeModal; f.appendChild(ok); n.appendChild(f); openModal(n, true);
  }

  // ---------------- game start ----------------
  function optionsModal() {
    const n = el('div');
    n.innerHTML = `<h2>Playtest Options</h2><p class="muted">For testing only. These won't exist in the released game.</p>
      <label class="optrow"><input type="checkbox" id="optUnlock" ${Pr.data.unlockAll ? 'checked' : ''}> Unlock every card in The Showroom (to test deck building)</label>
      <label class="optrow"><input type="checkbox" id="optSkip" ${Pr.data.classicOpening ? 'checked' : ''}> Old opening rule: only the <b>first</b> player skips their opening attack
        <span class="muted small">(Default now: both players skip attacking on their own first turn. Bot tests: 54% vs 42% first-seat wins.)</span></label>
      <p class="muted small">Ad Bucks per match (playtest values): win ${Pr.REWARDS.win}, draw ${Pr.REWARDS.draw}, loss ${Pr.REWARDS.loss}. Prices and pack odds aren't set yet, so the pack store stays closed.</p>
      <div class="optrow codebox"><b>Tester code</b> <span class="muted small">Adds Ad Bucks to this browser's wallet.</span>
        <div class="coderow"><input id="optCode" type="text" autocomplete="off" spellcheck="false" placeholder="Enter code">
        <button class="btn small" id="optRedeem">Redeem</button></div>
        <span class="small" id="optCodeMsg">Wallet: ${Pr.data.adBucks} Ad Bucks</span></div>`;
    const f = el('div', 'foot');
    const reset = el('button', 'btn danger small', 'Start over (erase progress)');
    reset.onclick = () => confirmModal('Erase all progress?', 'Your collection, deck, Ad Bucks and record will be reset. This can\'t be undone.', () => { Pr.resetProfile(); home(); });
    const ok = el('button', 'btn', 'Done'); ok.onclick = () => { closeModal(); home(); };
    f.append(reset, ok); n.appendChild(f); openModal(n, true);
    $('optUnlock').onchange = e => Pr.setUnlockAll(e.target.checked);
    $('optSkip').onchange = e => Pr.setClassicOpening(e.target.checked);
    const redeem = () => {
      const amt = Pr.redeemCode($('optCode').value);
      $('optCodeMsg').textContent = amt ? `+${amt} Ad Bucks added. Wallet: ${Pr.data.adBucks} Ad Bucks` : 'That code isn\'t valid.';
      $('optCodeMsg').style.color = amt ? 'var(--green)' : 'var(--red)';
      if (amt) { $('optCode').value = ''; $('walletBucks').textContent = Pr.data.adBucks; }
    };
    $('optRedeem').onclick = redeem;
    $('optCode').onkeydown = e => { if (e.key === 'Enter') redeem(); };
  }

  function startQuick() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    let s = seed; const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    let you;
    const problems = Pr.deckProblems();
    if (AUTO && problems.length) you = starterDeck();
    else if (!Pr.starterDone() && !Pr.data.deck.chars.length) {
      const n = el('div'); n.innerHTML = '<h2>Open Your Starter Packs</h2><p>Your first deck comes from your two free Starter Packs. Open them first!</p>';
      const f = el('div', 'foot'); const go = el('button', 'btn', 'Open Packs'); go.onclick = () => { closeModal(); window.CCPacks.show(); };
      f.appendChild(go); n.appendChild(f); openModal(n, true); return;
    } else if (problems.length) {
      toast('Your deck isn\'t ready: ' + problems.join(' · ')); window.CCShowroom.show(); return;
    } else you = { chars: Pr.data.deck.chars.map(id => window.CC.CID[id]), mods: Pr.data.deck.mods.slice() };
    const rival = randomDeck(rng, you.chars);
    startBattle({ you, rival, seed, difficulty: 'standard', kind: 'quick' });
  }

  /* cfg: {you:{chars:[cid idx], mods}, rival:{...}, seed?, difficulty:'tutorial'|'easy'|'standard',
           kind:'quick'|'story', background?, rivalName?, rivalAvatar?: card id, onEnd?(result)} */
  let CFG = { kind: 'quick', difficulty: 'standard' };
  function startBattle(cfg) {
    CFG = Object.assign({ difficulty: 'standard', kind: 'quick' }, cfg);
    const seed = cfg.seed || ((Math.random() * 2 ** 31) >>> 0);
    HUMAN = Math.random() < 0.5 ? 0 : 1; BOT = 1 - HUMAN;
    const decks = []; const mods = [];
    decks[HUMAN] = cfg.you.chars; mods[HUMAN] = cfg.you.mods; decks[BOT] = cfg.rival.chars; mods[BOT] = cfg.rival.mods;
    const auto = [true, true]; auto[HUMAN] = false;
    G = new Game(decks, mods, { seed, autoOpen: auto, bothSkipOpening: !Pr.data.classicOpening });
    sel = { ally: null, enemy: null }; detailKey = null; mode = 'idle'; busy = false; lastLogLen = -1; slotOf = {};
    $('ySeat').textContent = HUMAN === 0 ? '· goes first' : '· goes second';
    $('rSeat').textContent = BOT === 0 ? '· goes first' : '· goes second';
    $('rName').textContent = CFG.rivalName || 'Rival';
    $('rAvatar').src = `${CCA(`assets/${CFG.rivalAvatar && hasAvatar(CFG.rivalAvatar) ? 'avatar-' + CFG.rivalAvatar : 'avatar-C089'}.webp`)}`;
    if (CFG.rivalAvatar && !hasAvatar(CFG.rivalAvatar)) $('rAvatar').src = `${CCA(`art/characters/${CFG.rivalAvatar}.webp`)}`;
    $('yAvatar').src = `${CCA(`assets/avatar-${Pr.data.avatar}.webp`)}`;
    $('battle').style.backgroundImage = CFG.background ? `url(${CCA(`assets/${CFG.background}`)})` : '';
    show('battle'); render(); openingModal();
  }
  const AVATARS = ['C001', 'C003', 'C077', 'C083', 'C089', 'C104', 'C161', 'C163', 'C173', 'C184', 'C186', 'C187'];
  const hasAvatar = id => AVATARS.includes(id);
  /* AI level: decisions only - never extra coins or stats. */
  function botWants() {
    if (CFG.difficulty === 'tutorial') return false;      // buys and attacks only
    if (CFG.difficulty === 'easy') return Math.random() < 0.5;
    return true;
  }

  function openingModal() {
    const picks = [];
    const n = el('div');
    n.appendChild(el('h2', null, 'Choose Your Opening Team'));
    n.appendChild(el('p', 'muted', `Pick two characters to put in play. Their cost comes out of your 100 Battle Coins. ${HUMAN === 0 ? 'You go first.' : 'Your rival goes first.'} ${Pr.data.classicOpening ? (HUMAN === 0 ? 'You can\'t attack on turn 1.' : '') : 'Neither player can attack on their own first turn.'}`));
    const row = el('div', 'row'); n.appendChild(row);
    const info = el('div', 'muted'); const f = el('div', 'foot'); const go = el('button', 'btn', 'Start Battle');
    const hand = G.ps[HUMAN].hand.slice();
    function refresh() {
      row.innerHTML = '';
      for (const uid of hand) {
        const u = G.units[uid]; const c = card(u);
        const legendClash = c.category === 'Legendary' && picks.some(x => cat(G.units[x]) === 'Legendary' && x !== uid);
        const cardNode = unitCard(u, { small: false, inHand: true });
        if (picks.includes(uid)) cardNode.classList.add('sel-ally');
        else if (picks.length >= 2 || legendClash) cardNode.classList.add('dim');
        cardNode.onclick = () => {
          showDetail({ type: 'unit', key: uid });
          if (picks.includes(uid)) picks.splice(picks.indexOf(uid), 1);
          else if (picks.length < 2 && !legendClash) picks.push(uid);
          refresh();
        };
        row.appendChild(cardNode);
      }
      const cost = picks.reduce((s, x) => s + card(G.units[x]).purchase_cost, 0);
      info.textContent = `Selected ${picks.length}/2 · cost ${cost} · ${100 - cost} coins left for the rest of the match`;
      go.disabled = picks.length !== Math.min(2, hand.length);
    }
    go.onclick = () => {
      if (!G.openingBuy(HUMAN, picks.slice())) { toast('Those two can\'t be bought together.'); return; }
      closeModal(); G.note(`P${HUMAN + 1} opens with ${picks.map(x => card(G.units[x]).name).join(' and ')}`); render(); nextTurn();
    };
    f.append(info, go); n.appendChild(f); refresh(); openModal(n, false);
  }

  // ---------------- turn loop ----------------
  async function nextTurn() {
    if (G.over) return gameOver();
    const p = G.startTurn();
    sel = { ally: null, enemy: null };
    if (p === HUMAN) { mode = 'human'; render(); toast(!G.attackGate(HUMAN) && G.ps[HUMAN].own_turns === 1 ? 'Your turn — no attacks on your opening turn' : 'Your turn'); return; }
    mode = 'bot'; render();
    await sleep(pace(700));
    try { await botTurn(); } catch (e) { console.error(e); toast('Rival error: ' + e.message); }
    endTurn();
  }
  function endTurn() {
    G.endTurn(); mode = 'idle'; render();
    try { G.invariants(); } catch (e) { console.error('Invariant', e); }
    if (G.over) return gameOver();
    setTimeout(nextTurn, pace(350));
  }

  function gameOver() {
    mode = 'over'; render();
    const won = G.winner === HUMAN; const draw = G.winner === null;
    const n = el('div', 'endbanner');
    const word = draw ? 'Draw' : won ? 'Victory!' : 'Defeat';
    n.appendChild(el('div', 'banner', `<img src="${CCA(`assets/banner-${draw ? 'draw' : won ? 'victory' : 'defeat'}.webp`)}" alt=""><span>${word}</span>`));
    const why = G.reason === 'stalled' ? 'Two full rounds passed with nothing changing.' : G.reason === 'turn_cap' ? 'The turn limit was reached.' :
      draw ? 'Both teams were wiped out.' : won ? 'Your rival has no characters left in play.' : 'You have no characters left in play.';
    n.appendChild(el('p', null, esc(why) + ` <span class="muted">(${G.turn} turns)</span>`));
    if (CFG.kind === 'story') {   // story: no wallet payouts (draft rule); the story screen handles rewards
      const f = el('div', 'foot'); f.style.justifyContent = 'center';
      const look = el('button', 'btn ghost', 'View Board'); look.onclick = closeModal;
      const go = el('button', 'btn', 'Continue'); go.onclick = () => { closeModal(); CFG.onEnd(draw ? 'draw' : won ? 'win' : 'loss'); };
      f.append(look, go); n.appendChild(f); lastEnd = n; openModal(n, false);
      return;
    }
    if (!AUTO) { // the test autopilot must not change the real profile
      const earned = Pr.recordResult(draw ? 'draw' : won ? 'win' : 'loss');
      n.appendChild(el('div', 'reward', `<img src="${CCA(`assets/currency-ad-bucks-128.webp`)}" alt="">+${earned} Ad Bucks <span class="muted">· total ${Pr.data.adBucks}</span>`));
    }
    const f = el('div', 'foot'); f.style.justifyContent = 'center';
    const again = el('button', 'btn', 'Play Again'); again.onclick = () => { closeModal(); startQuick(); };
    const menu = el('button', 'btn ghost', 'Main Menu'); menu.onclick = () => { closeModal(); home(); };
    const look = el('button', 'btn ghost', 'View Board'); look.onclick = closeModal;
    f.append(menu, look, again); n.appendChild(f); lastEnd = n; openModal(n, false);
  }
  let lastEnd = null;   // the results panel, reopened by "Results" after View Board

  // ---------------- human actions ----------------
  function prepCtx() {
    if (mode === 'human') {
      const own = G.ps[HUMAN].field; const foe = G.ps[BOT].field;
      G.ctx = { phase: 'prepare', a: own.includes(sel.ally) ? sel.ally : null, d: foe.includes(sel.enemy) ? sel.enemy : null };
    } else if (mode === 'after') G.ctx.phase = 'after';
  }
  function canAct() { return !busy && ['human', 'attack', 'after'].includes(mode) && G.active === HUMAN && !G.over; }

  function humanBuy(uid) {
    if (!canAct() || mode !== 'human') return toast('Buy characters during your Prepare step.');
    const a = G.ps[HUMAN];
    if (a.bought) return toast('You already bought a character this turn.');
    if (!G.buy_candidates(HUMAN).includes(uid)) {
      const c = card(G.units[uid]);
      if (a.field.length >= 5) return toast('Your field is full (5 characters).');
      if (c.category === 'Legendary' && G.field(HUMAN).some(u => cat(u) === 'Legendary')) return toast('Only one Legendary may be in play.');
      return toast('Not enough Battle Coins.');
    }
    G.buy(HUMAN, uid); sel.ally = uid; render();
  }
  async function humanSpecial(uid) {
    if (!canAct()) return;
    const u = G.units[uid]; const c = card(u);
    if (G.ps[HUMAN].special) return toast('You already used a special this turn.');
    if (mode === 'after') return toast('Specials can\'t be used after the attack.');
    if (mode === 'human' && sel.ally !== uid && !G.ps[HUMAN].field.includes(sel.ally)) sel.ally = uid;
    prepCtx();
    if (mode === 'human' && !G.ctx.a) G.ctx.a = uid;
    if (!G.trial(HUMAN, 'special', uid)) return toast(whyNoSpecial(u));
    busy = true; render();
    try {
      const plan = await planAction('special', uid, `${c.special_name} (${c.name})`);
      if (plan) G.adopt(plan.state);
    } finally { clearChoice(); busy = false; render(); flashLog(); }
  }

  // ---------------- player choices (targets, cards to take/discard, copies...) ----------------
  function runForced(kind, key, picks, record) {
    G.forced = { p: HUMAN, picks }; G.recording = record ? HUMAN : null; G.decisions = record ? [] : null;
    const t = G.trial(HUMAN, kind, key);
    clearChoice();
    return t;
  }
  function clearChoice() { if (G) { G.forced = null; G.recording = null; G.decisions = null; } }
  function sig(g) {   // everything a choice can change, nothing cosmetic (log, decision bookkeeping)
    return JSON.stringify([g.ps.map(p => [p.field, p.hand, p.deck, p.grave, p.mhand, p.mgrave, p.mdeck, p.coins, p.grant, p.discount]),
      Object.values(g.units).map(u => [u.uid, u.damage, u.controller, u.once, u.temporary, u.marks.map(m => [m.k, m.v, m.expires, m.next, m.scope])]), g.ctx]);
  }
  /* Asks the player only for decisions that change the outcome. Returns {state, picks} or null. */
  async function planAction(kind, key, title) {
    const picks = [];
    for (let guard = 0; guard < 16; guard++) {
      const t = runForced(kind, key, picks, true);
      if (!t) { toast('That choice isn\'t legal here.'); return null; }
      const decs = t.decisions || [];
      let asked = false;
      for (let i = picks.length; i < decs.length; i++) {
        const d = decs[i];
        if (d.ids.length <= d.n || AUTO) { picks.push(d.chosen); continue; }
        const outcomes = {};
        let distinct = new Set();
        if (d.n === 1) {
          for (const id of d.ids) { const tt = runForced(kind, key, picks.concat([[id]]), false); outcomes[id] = tt; distinct.add(tt ? sig(tt) : 'X'); }
          const legal = d.ids.filter(id => outcomes[id]);
          if (distinct.size <= 1 || legal.length <= 1) { picks.push(legal.length === 1 ? [legal[0]] : d.chosen); continue; }
        }
        const choice = await askChoice(d, title, outcomes);
        if (!choice) return null;
        picks.push(choice); asked = true; break;
      }
      if (!asked) return { state: t, picks };
    }
    return null;
  }
  const CHOICE_TEXT = {
    ally: 'Choose your character', other: 'Choose another of your characters', enemy: 'Choose an enemy character',
    attacker: 'Choose which character gets the extra attack', redirect: 'Choose the new defender',
    grave: 'Choose a card from your graveyard', anygrave: 'Choose an Animal from either graveyard', take: 'Choose a card to put into your hand',
    discard: 'Choose a card to discard', bottom: 'Choose a card to put on the bottom of your deck', return: 'Choose cards from your hand to put into your deck',
    copy: 'Choose whose printed Attack to copy', search: 'Choose a Legendary to put into your hand', hand: 'Choose a character from your hand to put into play',
    copymod: 'Choose a modifier to copy'
  };
  function askChoice(d, title, outcomes) {
    return new Promise(resolve => {
      const chosen = [];
      const n = el('div');
      const plural = d.n > 1 ? ` (${d.n})` : '';
      let what = CHOICE_TEXT[d.label] || 'Make a choice';
      if (d.info && d.info.cat && (d.label === 'ally' || d.label === 'enemy')) what += ` — ${d.info.cat}`;
      n.appendChild(el('h2', null, esc(what + plural)));
      n.appendChild(el('p', 'muted', esc(title)));
      const row = el('div', 'row'); n.appendChild(row);
      const f = el('div', 'foot');
      const cancel = el('button', 'btn ghost', 'Cancel'); const ok = el('button', 'btn', 'Confirm');
      f.append(cancel, ok); n.appendChild(f);
      const draw = () => {
        row.innerHTML = '';
        for (const id of d.ids) {
          const isUnit = /^\d:\d+$/.test(id);
          const node = isUnit ? unitCard(G.units[id], { small: true, inHand: !G.ps.some(p => p.field.includes(id)) }) : modCard(id, { small: true });
          const illegal = d.n === 1 && outcomes && outcomes[id] === null;
          if (illegal) { node.classList.add('dim'); node.title = 'Not a legal choice'; }
          if (chosen.includes(id)) node.classList.add('sel-ally');
          node.onclick = () => {
            showDetail(isUnit ? { type: 'unit', key: id } : { type: 'mod', key: id });
            if (illegal) return toast('That one isn\'t a legal choice.');
            const i = chosen.indexOf(id);
            if (i >= 0) chosen.splice(i, 1); else { if (chosen.length >= d.n) chosen.shift(); chosen.push(id); }
            draw();
          };
          row.appendChild(node);
        }
        ok.disabled = chosen.length !== d.n;
      };
      cancel.onclick = () => { closeModal(); resolve(null); };
      ok.onclick = () => { closeModal(); resolve(chosen.slice()); };
      // start with the suggested pick selected
      for (const id of d.chosen) if (!(outcomes && outcomes[id] === null)) chosen.push(id);
      draw(); openModal(n, false);
    });
  }
  function whyNoSpecial(u) {
    const c = card(u); const s = S[u.cid];
    if (!G.ready(u, true)) return `${c.name} just arrived — specials work from your next turn.`;
    if (G.flag(u, 'silence')) return `${c.name} is silenced.`;
    if (u.once && s.once) return `${c.special_name} was already used this game.`;
    if (G.special_cost(HUMAN, u) > G.ps[HUMAN].coins) return 'Not enough Battle Coins.';
    if (c.timing === 'Response') return `${c.special_name} can only be used as a response.`;
    if (c.timing === 'Action' && mode !== 'human') return `${c.special_name} is an Action — use it in your Prepare step.`;
    return `${c.special_name} has no legal target right now. Try selecting a different ally or enemy.`;
  }
  async function humanModifier(mid) {
    if (!canAct()) return;
    const m = M[mid];
    if (G.ps[HUMAN].modifier) return toast('You already played a modifier this turn.');
    if (m.cost > G.ps[HUMAN].coins) return toast('Not enough Battle Coins.');
    prepCtx();
    if (!G.mod_mode(HUMAN, m)) return toast(`${m.name}: ${TIMING_HELP[m.timing] || m.timing}.`);
    if (!G.trial(HUMAN, 'modifier', mid)) return toast(`${m.name} has no legal target right now.`);
    busy = true; render();
    let pick = null;
    try {
      const plan = await planAction('modifier', mid, m.name);
      if (!plan) return;
      // the player's picks stay in force while the rival considers a response (re-runs use them)
      G.forced = { p: HUMAN, picks: plan.picks };
      const res = G.modifierOptions(HUMAN, mid, plan.state);
      if (!res) return toast(`${m.name} has no legal target right now.`);
      pick = botWants() ? G.botPickModifierResponse(res) : null;
      G.finishModifier(res.before, pick ? pick.state : res.t);
    } finally { clearChoice(); busy = false; render(); flashLog(); }
    if (pick) toast(`Rival responds with ${optName(pick, G)}!`);
  }
  function humanDeclare() {
    if (!canAct()) return;
    const extra = mode === 'after';
    const atks = G.attackers(HUMAN, extra).map(u => u.uid); const defs = G.defenders(HUMAN, extra).map(u => u.uid);
    if (!atks.includes(sel.ally)) return toast('Select one of your ready characters to attack with.');
    if (!defs.includes(sel.enemy)) return toast('Select an enemy character to attack.');
    G.declareAttack(HUMAN, sel.ally, sel.enemy, extra); mode = 'attack'; render();
  }
  async function humanFight() {
    if (!canAct() || mode !== 'attack') return;
    busy = true; render();
    const auid = G.ctx.a, duid = G.ctx.d;
    if (!G.ps[BOT].response && !G.ctx.cancel && botWants()) {
      const r = G.best(BOT, 'attack');
      if (r) { G.adopt(r[2]); toast(`Rival responds with ${optName({ kind: r[0], key: r[1] }, G)}!`); render(); await sleep(pace(900)); }
    }
    await animateBattle(auid, G.ctx.d || duid);
    G.finishBattle(HUMAN); busy = false; mode = 'after'; render();
    if (G.ps[HUMAN].grant && !G.ps[HUMAN].extra) toast('You earned an extra attack!');
  }
  async function humanEndTurn() {
    if (!canAct()) return;
    if (mode === 'attack') return toast('Finish the declared attack first.');
    busy = true;
    try { if (!AUTO) await chooseDiscards(); } finally { busy = false; }
    mode = 'idle'; endTurn();
  }
  /* Rulebook p.9: at cleanup, discard down to 5 characters and 5 modifiers - the player chooses. */
  function chooseDiscards() {
    const a = G.ps[HUMAN];
    const overC = a.hand.length - 5, overM = a.mhand.length - 5;
    if (overC <= 0 && overM <= 0) return Promise.resolve();
    return new Promise(resolve => {
      const pickC = [], pickM = [];
      const n = el('div');
      n.appendChild(el('h2', null, 'Hand Limit'));
      n.appendChild(el('p', null, `You may keep 5 characters and 5 modifiers. Choose ${[overC > 0 ? overC + ' character' + (overC > 1 ? 's' : '') : '', overM > 0 ? overM + ' modifier' + (overM > 1 ? 's' : '') : ''].filter(Boolean).join(' and ')} to discard.`));
      const row = el('div', 'row'); n.appendChild(row);
      const f = el('div', 'foot'); const go = el('button', 'btn danger', 'Discard'); f.appendChild(go); n.appendChild(f);
      const draw = () => {
        row.innerHTML = '';
        if (overC > 0) for (const uid of a.hand) {
          const c = unitCard(G.units[uid], { small: true, inHand: true });
          if (pickC.includes(uid)) c.classList.add('sel-enemy');
          c.onclick = () => { showDetail({ type: 'unit', key: uid }); const i = pickC.indexOf(uid); if (i >= 0) pickC.splice(i, 1); else if (pickC.length < overC) pickC.push(uid); draw(); };
          row.appendChild(c);
        }
        if (overM > 0) for (const mid of a.mhand) {
          const c = modCard(mid, { small: true });
          if (pickM.includes(mid)) c.classList.add('sel-enemy');
          c.onclick = () => { showDetail({ type: 'mod', key: mid }); const i = pickM.indexOf(mid); if (i >= 0) pickM.splice(i, 1); else if (pickM.length < overM) pickM.push(mid); draw(); };
          row.appendChild(c);
        }
        go.disabled = pickC.length !== Math.max(0, overC) || pickM.length !== Math.max(0, overM);
      };
      go.onclick = () => {
        for (const uid of pickC) G.zone(uid, 'grave');
        for (const mid of pickM) { a.mhand.splice(a.mhand.indexOf(mid), 1); a.mgrave.push(mid); }
        G.note(`P${HUMAN + 1} discards ${[...pickC.map(x => card(G.units[x]).name), ...pickM.map(x => M[x].name)].join(', ')} (hand limit)`);
        closeModal(); render(); resolve();
      };
      draw(); openModal(n, false);
    });
  }

  // ---------------- bot turn ----------------
  async function botTurn() {
    const p = BOT; const a = G.ps[p];
    const cands = G.buy_candidates(p);
    if (cands.length) {
      const pick = cands.reduce((b, x) => (b === null || G.unit_value(x) / Math.max(1, card(G.units[x]).purchase_cost) > G.unit_value(b) / Math.max(1, card(G.units[b]).purchase_cost)) ? x : b, null);
      G.buy(p, pick); render(); await sleep(pace(800));
    }
    for (let i = 0; i < 2 && !G.over; i++) {
      if (!botWants()) break;
      G.ctx = Object.assign(G.planned(p), { phase: 'prepare' });
      const best = G.best(p, 'prepare');
      if (!best) break;
      if (best[0] === 'modifier') await botModifier(p, best[1], best[2]);
      else { G.adopt(best[2]); render(); }
      await sleep(pace(900));
    }
    for (const extra of [false, true]) {
      if (G.over) break;
      if (extra && !G.ps[p].grant) break;
      if (!G.botAttack(p, extra)) continue;
      render(); await sleep(pace(900));
      const r1 = !G.ps[p].special && botWants() ? G.best(p, 'attack', ['special']) : null;
      if (r1) { G.adopt(r1[2]); render(); await sleep(pace(700)); }
      const r2 = !G.ps[p].modifier && botWants() ? G.best(p, 'attack', ['modifier']) : null;
      if (r2) { await botModifier(p, r2[1], r2[2]); await sleep(pace(700)); }
      if (!G.ps[HUMAN].response && !G.ctx.cancel) {
        G.ctx.phase = 'attack';
        const opts = G.legalPlays(HUMAN);
        if (opts.length) {
          const chosen = await askResponse('attack', opts);
          if (chosen) { G.adopt(chosen.state); render(); await sleep(pace(500)); }
        }
      }
      const auid = G.ctx.a, duid = G.ctx.d;
      await animateBattle(auid, duid);
      G.finishBattle(p); render(); await sleep(pace(700));
      if (!extra && !G.ps[p].modifier && botWants()) {
        const r3 = G.best(p, 'after', ['modifier']);
        if (r3) { await botModifier(p, r3[1], r3[2]); await sleep(pace(700)); }
      }
    }
  }
  async function botModifier(p, mid, prepared) {
    const res = G.modifierOptions(p, mid, prepared);
    if (!res) return;
    let chosen = null;
    if (res.options.length) { render(); chosen = await askResponse('modifier', res.options, mid, res.t); }
    G.finishModifier(res.before, chosen ? chosen.state : res.t); render();
  }

  function optName(o, g) {
    if (o.kind === 'special') { const u = g.units[o.key]; return card(u).special_name + ' (' + card(u).name + ')'; }
    return M[o.key].name;
  }
  function battlePreview(g) {
    const a = g.units[g.ctx.a], d = g.units[g.ctx.d];
    if (!a || !d || g.ctx.cancel) return g.ctx.cancel ? 'Attack canceled' : '';
    if (!g.ps[g.active].field.includes(a.uid) || !g.ps[1 - g.active].field.includes(d.uid)) return 'Attack fizzles';
    const dmg = g.damage_prediction(a, d);
    return `${card(d).name} takes ${dmg}${dmg >= hp(d) ? ' — defeated' : ''}`;
  }
  let askResponse = function (kind, options, mid, unanswered) {
    return new Promise(resolve => {
      const n = el('div');
      if (kind === 'attack') {
        const a = G.units[G.ctx.a], d = G.units[G.ctx.d];
        n.appendChild(el('h2', null, 'Incoming Attack!'));
        const vs = el('div', 'versus'); vs.append(unitCard(a, {}), el('div', 'vs', 'VS'), unitCard(d, {})); n.appendChild(vs);
        n.appendChild(el('p', null, `If you don't respond: <b>${esc(battlePreview(G))}</b>. You get one response per rival turn.`));
      } else {
        n.appendChild(el('h2', null, 'Rival Plays a Modifier'));
        n.appendChild(el('p', null, `<b>${esc(M[mid].name)}</b> — ${esc(M[mid].card_effect)}`));
        n.appendChild(el('p', 'muted', 'You may answer it with one response (once per rival turn).'));
      }
      for (const o of options) {
        const row = el('div', 'opt');
        const art = el('div', 'oart'); art.style.backgroundImage = `url(${o.kind === 'special' ? charArt(G.units[o.key].cid) : modArt(o.key)})`;
        let text;
        if (o.kind === 'special') { const u = G.units[o.key]; const c = card(u); text = `<b>${esc(c.special_name)}</b> · ${esc(c.name)} · ${G.special_cost(HUMAN, u)} coins<br>${esc(c.effect)}`; }
        else { const m = M[o.key]; text = `<b>${esc(m.name)}</b> · modifier · ${m.cost} coins<br>${esc(m.card_effect)}`; }
        const result = kind === 'attack' ? battlePreview(o.state) : (o.state.ctx && o.state.log.slice(-2).some(l => /canceled/.test(l.text)) ? 'Cancels it' : '');
        row.append(art, el('div', 'otext', text), el('div', 'oresult', esc(result)));
        row.onclick = () => { closeModal(); resolve(o); };
        n.appendChild(row);
      }
      const f = el('div', 'foot'); const pass = el('button', 'btn ghost', 'No response'); pass.onclick = () => { closeModal(); resolve(null); };
      f.appendChild(pass); n.appendChild(f); openModal(n, false);
    });
  }

  async function animateBattle(auid, duid) {
    const g2 = G.clone(); const pre = g2.units[duid] ? hp(g2.units[duid]) : 0;
    const aNode = document.querySelector(`[data-uid="${CSS.escape(auid)}"]`); const dNode = document.querySelector(`[data-uid="${CSS.escape(duid || '')}"]`);
    if (G.ctx.cancel) { if (dNode) floatText(dNode, 'Canceled', true); await sleep(pace(600)); return; }
    if (aNode) aNode.classList.add('attacking');
    await sleep(pace(300));
    g2.resolve_battle();
    const post = g2.units[duid] && g2.ps[g2.units[duid].controller].field.includes(duid) ? hp(g2.units[duid]) : 0;
    const dmg = Math.max(0, pre - post);
    if (dNode) { dNode.classList.add('hit'); floatText(dNode, dmg ? '-' + dmg : '0', !dmg); }
    await sleep(pace(650));
  }
  function floatText(node, text, zero) { const f = el('div', 'float' + (zero ? ' zero' : ''), esc(text)); node.appendChild(f); }

  // ---------------- rendering ----------------
  function badgesFor(u) {
    const out = [];
    const add = (cls, t, title) => out.push(`<span class="badge ${cls}" title="${esc(title)}">${t}</span>`);
    const A = G.amount(u, 'a'), AP = G.amount(u, 'ap'), Gd = G.amount(u, 'g'), EX = G.amount(u, 'ex');
    const ic = n => `<img src="${CCA(`assets/ui-${n}.webp`)}" alt="">`;
    if (A) add('up', ic('attack') + '+' + A, `+${A} Attack in its next battle`);
    if (AP) add('down', ic('attack') + '−' + AP, `−${AP} Attack`);
    if (Gd) add('up', ic('guard') + Gd, `${Gd} Guard (blocks damage once)`);
    if (EX) add('down', ic('exposure') + EX, `${EX} Exposure (takes extra damage)`);
    const scoped = u.marks.filter(m => ['a', 'g', 'ap', 'ex'].includes(m.k) && m.scope && Object.keys(m.scope).length && G.relevant(m, u, null, null) === false && m.expires >= G.turn);
    if (scoped.length) add('info', '✦', 'Has conditional battle effects');
    if (G.flag(u, 'stun')) add('down', ic('stun') + 'Stun', 'Cannot attack');
    if (G.flag(u, 'silence')) add('down', ic('silence') + 'Silence', 'Cannot use specials');
    if (G.flag(u, 'no_attack')) add('down', 'No atk', 'Cannot attack this turn');
    if (G.flag(u, 'rescue')) add('info', 'Rescue', 'Returns instead of being defeated');
    if (G.flag(u, 'counter')) add('info', 'Counter', 'Hits back when attacked');
    if (G.flag(u, 'replace_a') !== null) add('info', 'Copy', 'Uses a different printed Attack');
    if (u.temporary) add('info', u.temporary === 'control' ? 'Borrowed' : 'Revived', 'Leaves at the end of this turn');
    if (u.dodge) add('info', 'Dodge', 'Dodge ready');
    return out.join('');
  }
  /* Health display from ChatGPT's Health UI art (Health UI/INTEGRATION.txt):
     gold frame + clipped healthy/critical fill (critical at <=35%), and a value plate with
     the emerald heart and digit images. Values are the unchanged engine health (hp / printed Defense). */
  /* Game board spaces, in board.webp coordinates (2000 x 1333 grid). The rival's half is the
     printed mirror image. chars[] = Legendary, Animal, Human, Shadow, Magic spaces. */
  const MAT = {
    you: { row: 1031, mid: 740, chars: [275, 490, 706, 921, 1136], mods: [1352, 1567], cdeck: 60, mdeck: 1782,
      grave: 60, battle: 810, special: 1032, coin: [305, 783] },
    rival: { row: 73, mid: 366, chars: [1567, 1352, 1136, 921, 706], mods: [490, 275], cdeck: 1782, mdeck: 60,
      grave: 1782, battle: 1032, special: 810, coin: [1383, 433] }
  };
  const SLOT_CATS = ['Legendary', 'Animal', 'Human', 'Shadow', 'Magic'];
  function matZone(x, y, cls) {
    const z = el('div', 'mz' + (cls ? ' ' + cls : ''));
    z.style.left = (x / 20) + '%'; z.style.top = (y / 13.33) + '%';
    return z;
  }
  /* Characters keep the space they were put in. A new one takes its category's space when free
     (the marks are reminders, not restrictions - rulebook p.4), otherwise the first open space. */
  let slotOf = {};
  function assignSlots(p) {
    const field = G.ps[p].field; const out = [null, null, null, null, null];
    const pending = [];
    for (const uid of field) {
      const s = slotOf[uid];
      if (s !== undefined && s >= 0 && s < 5 && !out[s] && slotOf[uid + '@'] === p) out[s] = uid; else pending.push(uid);
    }
    for (const uid of pending) {
      let s = SLOT_CATS.indexOf(cat(G.units[uid]));
      if (s < 0 || out[s]) s = out.indexOf(null);
      if (s < 0) continue;
      out[s] = uid; slotOf[uid] = s; slotOf[uid + '@'] = p;
    }
    return out;
  }
  /* What each player has resolving this turn, read from the game log:
     modifiers played (they sit in the modifier spaces until cleanup) and the special used. */
  let MOD_BY_NAME = null;
  function turnPlays() {
    if (!MOD_BY_NAME) { MOD_BY_NAME = {}; for (const m of Object.values(M)) MOD_BY_NAME[m.name] = m.id; }
    const out = [{ mods: [], special: null }, { mods: [], special: null }];
    for (const l of G.log) {
      if (l.turn !== G.turn) continue;
      let m = /^P(\d) plays (.+) \(\d+\)$/.exec(l.text);
      if (m && MOD_BY_NAME[m[2]]) { out[+m[1] - 1].mods.push(MOD_BY_NAME[m[2]]); continue; }
      m = /^P(\d) uses (.+)'s .+ \(\d+\)$/.exec(l.text);
      if (m) {
        const p = +m[1] - 1;
        const u = Object.values(G.units).find(x => card(x).name === m[2] && x.controller === p && G.ps[p].field.includes(x.uid))
          || Object.values(G.units).find(x => card(x).name === m[2]);
        if (u) out[p].special = u;
      }
    }
    return out;
  }
  const HP_IMG = n => `${CCA(`assets/health/health-${n}.png`)}`;
  function healthHUD(n, u) {
    const max = card(u).printed_defense, cur = hp(u);
    const pct = Math.max(0, Math.min(100, 100 * cur / max));
    const bar = el('div', 'hpframe');
    bar.style.backgroundImage = `url(${HP_IMG('bar-frame')})`;
    const fill = el('div', 'hpfill');
    fill.style.backgroundImage = `url(${HP_IMG(pct <= 35 ? 'fill-critical' : 'fill-healthy')})`;
    fill.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    bar.appendChild(fill);
    const plate = el('div', 'hpplate' + (u.damage ? ' hurt' : ''));
    plate.style.backgroundImage = `url(${HP_IMG('value-plate')})`;
    const digits = String(cur) + '/' + String(max);
    plate.innerHTML = `<img class="hpheart" src="${HP_IMG('emblem')}" alt="">` +
      `<span class="hpdigits">${[...digits].map(ch => `<img src="${HP_IMG(ch === '/' ? 'digit-slash' : 'digit-' + ch)}" alt="">`).join('')}</span>` +
      `<span class="sr-only">Health ${cur} of ${max}</span>`;
    plate.style.setProperty('--nd', digits.length);
    plate.title = `Health ${cur} / ${max}`;
    n.append(bar, plate);
  }
  function unitCard(u, o) {
    o = o || {}; const c = card(u);
    const n = el('div', `card f-${c.category}${o.small ? ' small' : ''}`); n.dataset.uid = u.uid;
    if (CCCards.hasImg(c.id)) { // finished printed card + live overlays
      n.classList.add('full'); n.style.backgroundImage = `url(${CCCards.imgOf(c.id)})`; n.title = c.name;
      const inPlayF = !o.inHand && G.ps.some(p => p.field.includes(u.uid));
      if (inPlayF) {
        healthHUD(n, u);
        const b = badgesFor(u); if (b) n.appendChild(el('div', 'badges', b));
        if (!G.ready(u)) n.appendChild(el('div', 'zz', '💤'));
      }
      return n;
    }
    const bgplate = el('div', 'bgplate'); bgplate.style.backgroundImage = `url(${CCA(`assets/backgrounds/${c.category.toLowerCase()}.webp`)})`;
    const art = el('div', 'art'); art.style.backgroundImage = `url(${charArt(u.cid)})`;
    n.append(bgplate, art, el('div', 'title', esc(c.name)), el('div', 'cost', c.purchase_cost));
    const em = el('img', 'emblem'); em.src = emblem(c.category); em.alt = c.category; n.appendChild(em);
    const inPlay = !o.inHand && G.ps.some(p => p.field.includes(u.uid));
    if (inPlay) {
      healthHUD(n, u);
      n.appendChild(el('div', 'statbar', `<span class="atk">${c.attack}</span><span class="def">${hp(u)}/${c.printed_defense}</span>`));
      const b = badgesFor(u); if (b) n.appendChild(el('div', 'badges', b));
      if (!G.ready(u)) n.appendChild(el('div', 'zz', '💤'));
    } else n.appendChild(el('div', 'statbar', `<span class="atk">${c.attack}</span><span class="def">${c.printed_defense}</span>`));
    return n;
  }
  function modCard(mid, o) {
    o = o || {}; const m = M[mid];
    const n = el('div', `card mod${o.small ? ' small' : ''}`); n.dataset.mid = mid;
    if (CCCards.hasImg(mid)) { n.classList.add('full'); n.style.backgroundImage = `url(${CCCards.imgOf(mid)})`; n.title = m.name; return n; }
    const art = el('div', 'art'); art.style.backgroundImage = `url(${modArt(mid)})`;
    n.append(art, el('div', 'title', esc(m.name)), el('div', 'cost', m.cost), el('div', 'modtiming', esc(m.timing)));
    return n;
  }

  function render() {
    if (!G) return;
    const you = G.ps[HUMAN], riv = G.ps[BOT];
    $('rCoins').textContent = riv.coins; $('yCoins').textContent = you.coins;
    $('rHand').textContent = riv.hand.length; $('rMHand').textContent = riv.mhand.length;
    $('rDecks').textContent = `${riv.deck.length} / ${riv.mdeck.length}`; $('yDecks').textContent = `${you.deck.length} / ${you.mdeck.length}`;
    $('rGrave').textContent = riv.grave.length; $('yGrave').textContent = you.grave.length;
    const myTurn = G.active === HUMAN && ['human', 'attack', 'after'].includes(mode);
    const chip = (k, used) => `<span class="${used ? 'off' : 'on'}"><img src="${CCA(`assets/ui-${k.toLowerCase()}.webp`)}" alt="">${k}</span>`;
    $('yAllow').innerHTML = myTurn ? [['Buy', you.bought], ['Special', you.special], ['Modifier', you.modifier], ['Attack', you.normal]]
      .map(([k, used]) => chip(k, used)).join('') : (G.active === BOT ? chip('Response', you.response) : '');

    // the game board: each card in its printed space
    const attackers = myTurn ? G.attackers(HUMAN, mode === 'after').map(u => u.uid) : [];
    const plays = turnPlays();
    for (const [p, box] of [[BOT, $('rField')], [HUMAN, $('yField')]]) {
      box.innerHTML = '';
      const Z = p === HUMAN ? MAT.you : MAT.rival; const ps = G.ps[p];
      const attacking = G.ctx && G.ctx.phase === 'attack' && G.ctx.a && G.active === p && ps.field.includes(G.ctx.a) ? G.ctx.a : null;
      const slots = assignSlots(p);
      const unitNode = u => {
        const n = unitCard(u, {});
        if (sel.ally === u.uid) n.classList.add('sel-ally');
        if (sel.enemy === u.uid) n.classList.add('sel-enemy');
        if (G.ctx && G.ctx.phase === 'attack' && (G.ctx.a === u.uid)) n.classList.add('sel-ally');
        if (G.ctx && G.ctx.phase === 'attack' && (G.ctx.d === u.uid)) n.classList.add('sel-enemy');
        if (p === HUMAN && mode === 'human' && attackers.includes(u.uid) && !sel.ally) n.classList.add('playable');
        n.onclick = () => clickUnit(u.uid, p);
        return n;
      };
      // character spaces (Legendary, Animal, Human, Shadow, Magic - reminders only, any category may sit anywhere)
      slots.forEach((uid, i) => {
        const z = matZone(Z.chars[i], Z.row); z.title = '';
        if (uid && uid !== attacking) z.appendChild(unitNode(G.units[uid]));
        box.appendChild(z);
      });
      // Battle space: the attacking character moves here while its attack resolves
      const bz = matZone(Z.battle, Z.mid); if (attacking) bz.appendChild(unitNode(G.units[attacking])); box.appendChild(bz);
      // Special Zone: the character whose special is resolving this turn
      const sz = matZone(Z.special, Z.mid);
      const su = plays[p].special;
      if (su) { const n = unitCard(su, { inHand: true }); delete n.dataset.uid; n.classList.add('ghost'); n.onclick = () => showDetail({ type: 'unit', key: su.uid });
        sz.append(n, el('div', 'mcap', esc(card(su).special_name))); }
      box.appendChild(sz);
      // modifier spaces: modifiers played this turn (discarded at cleanup)
      plays[p].mods.slice(-2).forEach((mid, i) => {
        const z = matZone(Z.mods[i], Z.row); const n = modCard(mid, {}); n.onclick = () => showDetail({ type: 'mod', key: mid });
        z.appendChild(n); box.appendChild(z);
      });
      // decks (face down) with counts
      for (const [x, n, img, what] of [[Z.cdeck, ps.deck.length, 'character-back', 'Character deck'], [Z.mdeck, ps.mdeck.length, 'modifier-back', 'Modifier deck']]) {
        const z = matZone(x, Z.row); z.title = `${what}: ${n} card${n === 1 ? '' : 's'}`;
        if (n) { const b = el('div', 'cardback' + (n > 1 ? ' stack' : '')); b.style.backgroundImage = `url(${CCA(`assets/${img}.webp`)})`; z.appendChild(b); }
        z.appendChild(el('div', 'mcount', n)); box.appendChild(z);
      }
      // graveyard: top card face up; click to look through it
      const gz = matZone(Z.grave, Z.mid, 'grave'); const gN = ps.grave.length + ps.mgrave.length;
      gz.title = `Graveyard: ${ps.grave.length} character${ps.grave.length === 1 ? '' : 's'}, ${ps.mgrave.length} modifier${ps.mgrave.length === 1 ? '' : 's'} (click to view)`;
      if (ps.grave.length) { const n = unitCard(G.units[ps.grave[ps.grave.length - 1]], { inHand: true }); delete n.dataset.uid; gz.appendChild(n); }
      else if (ps.mgrave.length) gz.appendChild(modCard(ps.mgrave[ps.mgrave.length - 1], {}));
      if (gN) gz.appendChild(el('div', 'mcount', gN));
      gz.onclick = () => graveModal(p); box.appendChild(gz);
      // coin reserve
      const cz = matZone(Z.coin[0], Z.coin[1], 'coins'); cz.title = `${p === HUMAN ? 'Your' : 'Rival'} Battle Coins`;
      cz.innerHTML = `<img src="${CCA(`assets/currency-battle-coins-64.webp`)}" alt=""><span>${ps.coins}</span>`; box.appendChild(cz);
    }
    // hand
    const h = $('yHand'); h.innerHTML = '';
    const buyable = myTurn && mode === 'human' && !you.bought ? G.buy_candidates(HUMAN) : [];
    for (const uid of you.hand) {
      const n = unitCard(G.units[uid], { small: true, inHand: true });
      if (buyable.includes(uid)) n.classList.add('playable'); else if (myTurn) n.classList.add('dim');
      n.onclick = () => { showDetail({ type: 'unit', key: uid }); };
      n.ondblclick = () => humanBuy(uid);
      h.appendChild(n);
    }
    const mh = $('yMHand'); mh.innerHTML = '';
    for (const mid of you.mhand) {
      const n = modCard(mid, { small: true });
      if (myTurn && !you.modifier && M[mid].cost <= you.coins) { prepCtxPeek(); if (G.mod_mode(HUMAN, M[mid])) n.classList.add('playable'); }
      n.onclick = () => showDetail({ type: 'mod', key: mid });
      n.ondblclick = () => humanModifier(mid);
      mh.appendChild(n);
    }
    renderMid(); renderLog(); showDetail(detailKey, true);
  }
  function prepCtxPeek() { if (mode === 'human') G.ctx.phase = 'prepare'; else if (mode === 'after') G.ctx.phase = 'after'; }

  function renderMid() {
    $('turnLabel').textContent = G.turn === 0 ? 'Opening' : `Turn ${G.turn}` + (G.active === HUMAN ? ' · Your turn' : ' · Rival\'s turn');
    const hint = {
      human: 'Prepare: buy, use a special, play a modifier — then attack.',
      attack: 'Attacking: you may add an attack special or modifier, then Fight.',
      after: G.ps[HUMAN].grant && !G.ps[HUMAN].extra ? 'Extra attack available — select attacker and target.' : 'After attack: play an After-attack modifier or end your turn.',
      bot: 'Rival is thinking…', idle: '', over: 'Match over.'
    }[mode] || '';
    $('phaseHint').textContent = hint;
    const fc = $('forecast'); fc.innerHTML = '';
    let a = null, d = null;
    if (G.ctx && G.ctx.phase === 'attack' && G.ctx.a) { a = G.units[G.ctx.a]; d = G.units[G.ctx.d]; }
    else if (G.active === HUMAN && sel.ally && sel.enemy && G.ps[HUMAN].field.includes(sel.ally) && G.ps[BOT].field.includes(sel.enemy)) { a = G.units[sel.ally]; d = G.units[sel.enemy]; }
    if (a && d && G.ps.some(p => p.field.includes(a.uid)) && G.ps.some(p => p.field.includes(d.uid))) {
      const dmg = G.damage_prediction(a, d);
      fc.innerHTML = `${esc(card(a).name)} → ${esc(card(d).name)}: <span class="big">${dmg}</span> damage${dmg >= hp(d) ? ' · <span style="color:var(--red)">defeats it</span>' : ` · ${hp(d) - dmg} health left`}`;
    }
    const acts = $('actions'); acts.innerHTML = '';
    const btn = (label, cls, fn, dis) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; b.disabled = !!dis || busy; acts.appendChild(b); };
    if (mode === 'human') {
      const canAtk = G.attackGate(HUMAN) && G.attackers(HUMAN).length;
      btn('Attack', 'danger', humanDeclare, !canAtk || !sel.ally || !sel.enemy);
      btn('End Turn', 'ghost', humanEndTurn);
    } else if (mode === 'attack') {
      btn('Fight!', 'danger', humanFight);
    } else if (mode === 'after') {
      const ex = G.ps[HUMAN].grant && !G.ps[HUMAN].extra && G.attackers(HUMAN, true).length;
      if (ex) btn('Extra Attack', 'danger', humanDeclare, !sel.ally || !sel.enemy);
      btn('End Turn', '', humanEndTurn);
    } else if (mode === 'over' && lastEnd) {
      btn('Results', '', () => openModal(lastEnd, false));
    }
  }

  function clickUnit(uid, owner) {
    showDetail({ type: 'unit', key: uid });
    if (!G || G.active !== HUMAN || !['human', 'after'].includes(mode)) { render(); return; }
    if (owner === HUMAN) sel.ally = sel.ally === uid ? null : uid; else sel.enemy = sel.enemy === uid ? null : uid;
    render();
  }

  function showDetail(k, quiet) {
    detailKey = k; const box = $('detail');
    if (!k || !G) return;
    box.innerHTML = '';
    if (k.type === 'unit') {
      const u = G.units[k.key]; if (!u) return;
      const c = card(u); const s = S[u.cid];
      const inPlay = G.ps.some(p => p.field.includes(u.uid));
      if (CCCards.hasImg(c.id)) {
        const dc = el('div', 'dcard'); dc.style.backgroundImage = `url(${CCCards.imgOf(c.id)})`;
        if (inPlay) healthHUD(dc, u);
        box.append(dc, el('div', 'v2note', 'Playtest rules text (v2)'));
      } else if (inPlay) { const w = el('div', 'dhp'); healthHUD(w, u); box.appendChild(w); }
      const head = el('div', 'dhead'); const art = el('div', 'dart'); art.style.backgroundImage = `url(${charArt(u.cid)})`;
      if (CCCards.hasImg(c.id)) art.style.display = 'none';
      const info = el('div', null, `<h3>${esc(c.name)}</h3><span class="tag">${esc(c.category)}</span><span class="tag">Cost ${c.purchase_cost}</span>` +
        `<div>⚔ Attack <b>${c.attack}</b> · 🛡 Defense <b>${inPlay ? hp(u) + '/' : ''}${c.printed_defense}</b></div>` +
        (u.owner !== u.controller ? '<div class="muted">Temporarily controlled</div>' : '') +
        `<div class="muted">${u.owner === HUMAN ? 'Yours' : 'Rival\'s'}${inPlay ? ' · in play' : G.ps[u.owner].grave.includes(u.uid) ? ' · graveyard' : ''}</div>`);
      head.append(art, info); box.appendChild(head);
      box.appendChild(el('div', 'sp', `<b>${esc(c.special_name)}</b> <span class="tag">+${c.special_cost} coins</span><span class="tag" title="${esc(TIMING_HELP[c.timing] || '')}">${esc(c.timing)}</span>${s.once ? '<span class="tag">Once per game</span>' : ''}<br>${esc(c.effect)}`));
      if (inPlay) {
        const live = [];
        if (!G.ready(u)) live.push('Not ready yet (arrived this turn).');
        if (u.once && s.once) live.push('Special already used this game.');
        if (u.damage) live.push(`${u.damage} damage taken.`);
        if (live.length) box.appendChild(el('div', 'live', esc(live.join(' '))));
      }
      const b = el('div', 'dbtns');
      if (canAct() && u.controller === HUMAN && inPlay && mode !== 'after') {
        const sb = el('button', 'btn small', `Use ${esc(c.special_name)} (${G.special_cost(HUMAN, u)})`);
        sb.disabled = G.ps[HUMAN].special; sb.onclick = () => humanSpecial(u.uid); b.appendChild(sb);
      }
      if (canAct() && mode === 'human' && G.ps[HUMAN].hand.includes(u.uid)) {
        const bb = el('button', 'btn small', `Buy for ${G.buyCost(HUMAN, u.uid)}`); bb.disabled = G.ps[HUMAN].bought || !G.buy_candidates(HUMAN).includes(u.uid);
        bb.onclick = () => humanBuy(u.uid); b.appendChild(bb);
      }
      if (b.children.length) box.appendChild(b);
    } else {
      const m = M[k.key]; if (!m) return;
      if (CCCards.hasImg(m.id)) { const dc = el('div', 'dcard'); dc.style.backgroundImage = `url(${CCCards.imgOf(m.id)})`; box.append(dc, el('div', 'v2note', 'Playtest rules text (v2)')); }
      const head = el('div', 'dhead'); const art = el('div', 'dart'); art.style.backgroundImage = `url(${modArt(m.id)})`;
      if (CCCards.hasImg(m.id)) art.style.display = 'none';
      head.append(art, el('div', null, `<h3>${esc(m.name)}</h3><span class="tag">Modifier</span><span class="tag">${m.cost} coins</span><span class="tag" title="${esc(TIMING_HELP[m.timing] || '')}">${esc(m.timing)}</span><div class="muted">${esc(TIMING_HELP[m.timing] || '')}</div>`));
      box.appendChild(head);
      box.appendChild(el('div', 'sp', esc(m.card_effect)));
      if (m.special_bonus && m.special_bonus !== 'None') box.appendChild(el('div', 'sp bonus', '<b>Special Bonus</b><br>' + esc(m.special_bonus)));
      if (canAct() && G.ps[HUMAN].mhand.includes(m.id) && mode !== 'attack' || (canAct() && mode === 'attack' && G.ps[HUMAN].mhand.includes(m.id))) {
        const b = el('div', 'dbtns'); const pb = el('button', 'btn small', `Play (${m.cost})`); pb.disabled = G.ps[HUMAN].modifier; pb.onclick = () => humanModifier(m.id);
        b.appendChild(pb); box.appendChild(b);
      }
    }
  }

  let lastLogLen = 0;
  function renderLog() {
    const box = $('log');
    if (G.log.length === lastLogLen && box.children.length) return;
    lastLogLen = G.log.length; box.innerHTML = '';
    const me = `P${HUMAN + 1}`, them = `P${BOT + 1}`;
    for (const l of G.log.slice(-120)) {
      let t = esc(l.text).replace(new RegExp('\\b' + me + '\\b', 'g'), '<span class="you">You</span>').replace(new RegExp('\\b' + them + '\\b', 'g'), '<span class="rival">Rival</span>');
      box.appendChild(el('div', null, `<span class="t">T${l.turn}</span>${t}`));
    }
    box.scrollTop = box.scrollHeight;
  }
  function flashLog() { renderLog(); }

  function graveModal(p) {
    if (!G) return;
    const n = el('div'); n.appendChild(el('h2', null, (p === HUMAN ? 'Your' : 'Rival') + ' Graveyard'));
    const row = el('div', 'row');
    for (const uid of G.ps[p].grave) { const c = unitCard(G.units[uid], { small: true, inHand: true }); c.onclick = () => showDetail({ type: 'unit', key: uid }); row.appendChild(c); }
    for (const mid of G.ps[p].mgrave) { const c = modCard(mid, { small: true }); c.onclick = () => showDetail({ type: 'mod', key: mid }); row.appendChild(c); }
    if (!row.children.length) row.appendChild(el('p', 'muted', 'Empty.'));
    n.appendChild(row);
    const f = el('div', 'foot'); const ok = el('button', 'btn', 'Close'); ok.onclick = closeModal; f.appendChild(ok); n.appendChild(f); openModal(n, true);
  }

  // ---------------- test autopilot (?autoplay) - plays the human seat through the UI paths ----------------
  const AUTO = /[?&]autoplay/.test(location.search);
  const stats = { games: 0, wins: 0, losses: 0, draws: 0, errors: [] };
  window.addEventListener('error', e => stats.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => stats.errors.push(String(e.reason && e.reason.stack || e.reason)));
  if (AUTO) {
    fastBox.checked = true;
    const origPace = pace;
    const realAsk = askResponse;
    askResponse = function (kind, options) { // pick what the bot would pick
      let best = null, value = -Infinity;
      for (const o of options) { const v = kind === 'attack' ? o.state.projected(HUMAN) : o.state.score(HUMAN); if (v > value) { value = v; best = o; } }
      return Promise.resolve(Math.random() < 0.5 ? best : null);
    };
    const tick = async () => {
      try {
        if (!$('modal').classList.contains('hidden')) {
          const go = [...document.querySelectorAll('#modalBox button')].find(b => /Start Battle|Play Again/.test(b.textContent));
          if (/Start Battle/.test(go && go.textContent || '')) { // opening: click first two affordable cards
            [...document.querySelectorAll('#modalBox .card')].slice(0, 2).forEach(c => c.click());
          }
          if (go && /Play Again/.test(go.textContent)) {
            stats.games++; if (G.winner === HUMAN) stats.wins++; else if (G.winner === null) stats.draws++; else stats.losses++;
            if (stats.games >= +(new URLSearchParams(location.search).get('autoplay') || 3)) { window.CC_AUTOSTATS = stats; return; }
          }
          if (go) go.click();
        } else if (canAct()) {
          const a = G.ps[HUMAN];
          if (mode === 'human') {
            if (!a.bought) { const c = G.buy_candidates(HUMAN); if (c.length) humanBuy(c[Math.floor(Math.random() * c.length)]); }
            const plan = G.planned(HUMAN); sel.ally = plan.a; sel.enemy = plan.d;
            if (!a.special) { const u = G.field(HUMAN)[Math.floor(Math.random() * Math.max(1, a.field.length))]; if (u) humanSpecial(u.uid); }
            if (!a.modifier && a.mhand.length) humanModifier(a.mhand[Math.floor(Math.random() * a.mhand.length)]);
            const cs = G.attack_candidates(HUMAN);
            if (cs.length) { sel.ally = cs[0][1]; sel.enemy = cs[0][2]; humanDeclare(); } else humanEndTurn();
          } else if (mode === 'attack') { await humanFight(); }
          else if (mode === 'after') {
            if (!a.modifier && a.mhand.length) humanModifier(a.mhand[0]);
            const cs = G.attack_candidates(HUMAN, true);
            if (cs.length) { sel.ally = cs[0][1]; sel.enemy = cs[0][2]; humanDeclare(); } else humanEndTurn();
          }
        } else if (mode === 'idle' && document.getElementById('title').classList.contains('active')) startQuick();
      } catch (e) { stats.errors.push(String(e.stack || e)); }
      setTimeout(tick, 60);
    };
    window.CC_AUTOSTATS_LIVE = stats;
    setTimeout(tick, 200);
  }

  window.CCUI = { get G() { return G; }, get mode() { return mode; }, HUMAN: () => HUMAN, render };
  window.CCNav = { show, home, quick: startQuick, toast, startBattle, openModal, closeModal, rulebook: openRulebook };
  home();
})();
