/* Commercial Combat - Story Mode (data: ChatGPT's Story Mode/story-data.json, a DRAFT).
 * Rules per Story Mode/INTEGRATION.md: pick a route, then 1 of 3 starters -> exactly that
 * 12+12 deck. Normal shuffle/purchase/opening rules, 100 coins, no hidden buffs. Unlimited
 * retries with no loss. Rewards: draft collection unlocks only (no wallet payouts, no duplicates).
 */
(function () {
  'use strict';
  const S = window.CC_STORY; const Pr = window.CCProfile; const { CID } = window.CC;
  const { esc } = window.CCCards;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const bgFile = key => (S.backgrounds[key] || '').replace(/\.png$/, '.webp');
  const nameOf = id => id === 'PLAYER' ? 'You' : id === 'NARRATOR' ? '' : (S.names[id] || id);
  const DIFF = { tutorial: 'Tutorial', easy: 'Easy', standard: 'Standard' };
  let route = null;

  function setBg(key) { $('storyBg').style.backgroundImage = key ? `url(${CCA(`assets/${bgFile(key)}`)})` : `url(${CCA('assets/main-menu.webp')})`; }

  // ---------------- route select ----------------
  function show() {
    window.CCNav.show('story'); route = null; setBg(null);
    $('storyTitle').textContent = 'Story Mode'; $('storySub').textContent = `${S.setting} · Draft story`;
    $('storyBack').onclick = () => window.CCNav.home();
    const body = $('storyBody'); body.innerHTML = '';
    body.appendChild(el('p', 'story-lead', 'Choose a route. Each one is six chapters with its own starter deck. Losing costs nothing — retry as often as you like.'));
    const grid = el('div', 'routes');
    for (const r of S.routes) {
      const st = Pr.storyState(r.id);
      const card = el('button', 'route f-' + r.category);
      card.style.backgroundImage = `linear-gradient(transparent 30%, rgba(0,0,0,.85)), url(${CCA(`assets/${bgFile(r.chapters[0].background)}`)})`;
      card.innerHTML = `<img class="remb" src="${CCA(`assets/emblems/${r.category.toLowerCase()}.webp`)}" alt="">` +
        `<div class="rtext"><span class="rcat">${esc(r.category)}</span><h3>${esc(r.title)}</h3>` +
        `<span class="rprog">${!st ? 'Not started' : st.done ? '★ Complete' : `Chapter ${st.next + 1} of ${r.chapters.length}`}</span></div>`;
      card.onclick = () => openRoute(r);
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  function openRoute(r) {
    route = r;
    const st = Pr.storyState(r.id);
    if (!st) return starterChoice();
    chapterList();
  }

  // ---------------- starter choice ----------------
  function starterChoice() {
    const r = route; setBg(r.chapters[0].background);
    $('storyTitle').textContent = r.title; $('storySub').textContent = `${r.category} route · choose your starter`;
    $('storyBack').onclick = show;
    const body = $('storyBody'); body.innerHTML = '';
    body.appendChild(el('p', 'story-lead', esc(r.intro)));
    body.appendChild(el('p', 'muted', 'Choose one starter. It joins a 12-character, 12-modifier deck that you keep for this route (and add to your collection). The other two are not given.'));
    const row = el('div', 'starters');
    for (const sc of r.starter_choices) {
      const b = el('div', 'starter');
      b.appendChild(window.CCCards.face(sc.id));
      b.appendChild(el('div', 'sline', `<b>${esc(sc.name)}</b><i>“${esc(sc.opening_line)}”</i>`));
      const go = el('button', 'btn', 'Choose');
      go.title = 'Choose ' + sc.name;
      go.onclick = () => {
        Pr.storyStart(r.id, sc.id, sc.character_deck, sc.modifier_deck);
        playScene(r.chapters[0].background, [{ speaker: 'NARRATOR', text: r.intro }, { speaker: sc.id, text: sc.opening_line }], chapterList);
      };
      b.appendChild(go); row.appendChild(b);
    }
    body.appendChild(row);
  }

  // ---------------- chapter list ----------------
  function chapterList() {
    const r = route; const st = Pr.storyState(r.id);
    setBg(r.chapters[Math.min(st.next, r.chapters.length - 1)].background);
    $('storyTitle').textContent = r.title;
    $('storySub').textContent = `${r.category} route · starter: ${S.names[st.starter] || st.starter}${st.done ? ' · ★ complete' : ''}`;
    $('storyBack').onclick = show;
    const body = $('storyBody'); body.innerHTML = '';
    const list = el('div', 'chapters');
    r.chapters.forEach((ch, i) => {
      const locked = i > st.next; const won = i < st.next || (st.done && i === r.chapters.length - 1);
      const row = el('button', 'chapter' + (locked ? ' locked' : '') + (won ? ' won' : '') + (i === st.next && !st.done ? ' current' : ''));
      row.disabled = locked;
      const opp = ch.opponent_character;
      row.innerHTML = `<span class="cnum">${i + 1}</span>` +
        `<span class="cport" style="background-image:url(${CCA(`art/characters/${opp}.webp`)})"></span>` +
        `<span class="ctext"><b>${esc(ch.title)}</b><span class="muted">${locked ? 'Locked' : esc(ch.narration)}</span></span>` +
        `<span class="cmeta"><span class="diff d-${ch.battle.difficulty}">${DIFF[ch.battle.difficulty] || ch.battle.difficulty}</span>` +
        `<span>${won ? '★ Won' : locked ? '🔒' : 'vs ' + esc(S.names[opp] || opp)}</span></span>`;
      row.onclick = () => playChapter(i);
      list.appendChild(row);
    });
    body.appendChild(list);
    const foot = el('div', 'story-foot');
    const deckBtn = el('button', 'btn small ghost', 'View route deck'); deckBtn.onclick = deckModal; foot.appendChild(deckBtn);
    const reset = el('button', 'btn small ghost', 'Restart this route');
    reset.onclick = () => { if (confirm('Restart this route from chapter 1 and pick a new starter? Cards you unlocked stay in your collection.')) { Pr.storyReset(r.id); starterChoice(); } };
    foot.appendChild(reset);
    if (st.done) { const e = el('button', 'btn small', 'Replay ending'); e.onclick = () => playScene('signal', [{ speaker: 'NARRATOR', text: r.ending }], chapterList); foot.appendChild(e); }
    body.appendChild(foot);
  }

  function routeDeck() {
    const st = Pr.storyState(route.id);
    return route.starter_choices.find(s => s.id === st.starter);
  }
  function deckModal() {
    const sc = routeDeck();
    const n = el('div'); n.appendChild(el('h2', null, 'Route Deck'));
    n.appendChild(el('p', 'muted', 'Story battles on this route always use this deck.'));
    const row = el('div', 'row');
    for (const id of sc.character_deck.concat(sc.modifier_deck)) { const c = window.CCCards.face(id, { small: true }); row.appendChild(c); }
    n.appendChild(row);
    const f = el('div', 'foot'); const ok = el('button', 'btn', 'Close'); ok.onclick = window.CCNav.closeModal; f.appendChild(ok); n.appendChild(f);
    window.CCNav.openModal(n, true);
  }

  // ---------------- chapter flow ----------------
  function playChapter(i) {
    const r = route; const ch = r.chapters[i];
    const lines = [{ speaker: 'NARRATOR', text: ch.narration }].concat(ch.before.lines);
    playScene(ch.before.background || ch.background, lines, () => battle(i), `Chapter ${i + 1}: ${ch.title}`);
  }
  function battle(i) {
    const r = route; const ch = r.chapters[i]; const sc = routeDeck();
    window.CCNav.startBattle({
      kind: 'story', difficulty: ch.battle.difficulty || 'standard',
      you: { chars: sc.character_deck.map(id => CID[id]), mods: sc.modifier_deck.slice() },
      rival: { chars: ch.battle.characters.map(id => CID[id]), mods: ch.battle.modifiers.slice() },
      background: bgFile(ch.background), rivalName: S.names[ch.opponent_character] || 'Rival', rivalAvatar: ch.opponent_character,
      onEnd: result => afterBattle(i, result)
    });
  }
  function afterBattle(i, result) {
    const r = route; const ch = r.chapters[i]; const last = i === r.chapters.length - 1;
    window.CCNav.show('story');
    if (result !== 'win') {
      playScene(ch.defeat.background || ch.background, ch.defeat.lines, chapterList, result === 'draw' ? 'A draw — no ground gained' : null);
      return;
    }
    const fresh = Pr.storyWin(r.id, i, ch.rewards && ch.rewards.cards, last);
    playScene(ch.after.background || ch.background, ch.after.lines, () => {
      const finish = () => last ? playScene('signal', [{ speaker: 'NARRATOR', text: r.ending }], () => { window.CCNav.toast('Route complete!'); chapterList(); }, 'Ending') : chapterList();
      if (!fresh.length) return finish();
      const n = el('div'); n.appendChild(el('h2', null, 'New Card Unlocked!'));
      n.appendChild(el('p', 'muted', 'Added to your collection. Find it in The Showroom.'));
      const row = el('div', 'row'); fresh.forEach(id => row.appendChild(window.CCCards.face(id))); n.appendChild(row);
      const f = el('div', 'foot'); const ok = el('button', 'btn', 'Continue'); ok.onclick = () => { window.CCNav.closeModal(); finish(); }; f.appendChild(ok); n.appendChild(f);
      window.CCNav.openModal(n, false);
    });
  }

  // ---------------- dialogue scenes ----------------
  let scene = null;
  function playScene(bgKey, lines, done, heading) {
    setBg(bgKey);
    const q = lines.slice(); if (heading) q.unshift({ speaker: 'NARRATOR', text: heading, heading: true });
    scene = { q, i: -1, done };
    $('dialogue').classList.remove('hidden'); $('storyBody').classList.add('dimmed');
    advance();
  }
  function advance() {
    if (!scene) return;
    scene.i++;
    if (scene.i >= scene.q.length) return endScene();
    const l = scene.q[scene.i]; const sp = l.speaker;
    const port = $('dlgPortrait');
    if (sp === 'NARRATOR') { port.style.display = 'none'; }
    else {
      port.style.display = '';
      port.style.backgroundImage = sp === 'PLAYER' ? `url(${CCA(`assets/avatar-${Pr.data.avatar}.webp`)})` : `url(${CCA(`art/characters/${sp}.webp`)})`;
    }
    $('dlgName').textContent = nameOf(sp);
    $('dlgText').textContent = l.text;
    $('dlgText').classList.toggle('heading', !!l.heading);
    $('dialogue').classList.toggle('narrator', sp === 'NARRATOR');
  }
  function endScene() {
    const d = scene && scene.done; scene = null;
    $('dialogue').classList.add('hidden'); $('storyBody').classList.remove('dimmed');
    if (d) d();
  }
  $('dialogue').addEventListener('click', e => { if (e.target.id !== 'dlgSkip') advance(); });
  $('dlgSkip').onclick = e => { e.stopPropagation(); endScene(); };
  document.addEventListener('keydown', e => {
    if (!scene || !document.getElementById('story').classList.contains('active')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
    if (e.key === 'Escape') endScene();
  });

  window.CCStory = { show, _advance: advance };
})();
