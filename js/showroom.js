/* Commercial Combat - The Showroom: collection browser + deck builder. */
(function () {
  'use strict';
  const Pr = window.CCProfile; const { face, detailHTML, isChar, esc } = window.CCCards;
  const D = window.CC_DATA;
  const $ = id => document.getElementById(id);
  const FACTIONS = ['All', 'Animal', 'Human', 'Magic', 'Shadow', 'Legendary'];
  let tab = 'chars', faction = 'All', ownedOnly = false, query = '', picked = null;
  let draft = null; // working copy of the deck

  function show() {
    draft = { chars: Pr.data.deck.chars.slice(), mods: Pr.data.deck.mods.slice() };
    picked = null;
    window.CCNav.show('showroom');
    renderFilters(); renderGrid(); renderDeck(); renderDetail();
  }

  function renderFilters() {
    const f = $('srFilters'); f.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'tabs';
    for (const [k, label] of [['chars', 'Characters'], ['mods', 'Modifiers']]) {
      const b = document.createElement('button'); b.className = 'tab' + (tab === k ? ' on' : ''); b.textContent = label;
      b.onclick = () => { tab = k; renderFilters(); renderGrid(); }; tabs.appendChild(b);
    }
    f.appendChild(tabs);
    if (tab === 'chars') {
      const chips = document.createElement('div'); chips.className = 'chips';
      for (const fac of FACTIONS) {
        const b = document.createElement('button'); b.className = 'fchip' + (faction === fac ? ' on' : '') + (fac !== 'All' ? ' f-' + fac : '');
        b.innerHTML = fac === 'All' ? 'All' : `<img src="${CCA(`assets/emblems/${fac.toLowerCase()}.webp`)}" alt="">${fac}`;
        b.onclick = () => { faction = fac; renderFilters(); renderGrid(); }; chips.appendChild(b);
      }
      f.appendChild(chips);
    }
    const tools = document.createElement('div'); tools.className = 'srtools';
    tools.innerHTML = `<input id="srSearch" type="search" placeholder="Search names and effects…" value="${esc(query)}">` +
      `<label><input type="checkbox" id="srOwned" ${ownedOnly ? 'checked' : ''}> Collected only</label>`;
    f.appendChild(tools);
    $('srSearch').oninput = e => { query = e.target.value; renderGrid(); };
    $('srOwned').onchange = e => { ownedOnly = e.target.checked; renderGrid(); };
    const cnt = Pr.ownedCount();
    $('srCounts').innerHTML = `Collected <b>${cnt.chars}</b>/199 characters · <b>${cnt.mods}</b>/236 modifiers`;
  }

  function list() {
    const q = query.trim().toLowerCase();
    let items = tab === 'chars' ? D.characters : D.modifiers;
    if (tab === 'chars' && faction !== 'All') items = items.filter(c => c.category === faction);
    if (ownedOnly) items = items.filter(c => Pr.owns(c.id));
    if (q) items = items.filter(c => Pr.owns(c.id) && [c.name, c.special_name, c.effect, c.card_effect, c.special_bonus].some(t => t && t.toLowerCase().includes(q)));
    return items;
  }

  function renderGrid() {
    const g = $('srGrid'); g.innerHTML = '';
    const items = list();
    const inDeck = new Set(draft.chars.concat(draft.mods));
    const frag = document.createDocumentFragment();
    for (const c of items) {
      const owned = Pr.owns(c.id);
      const n = face(c.id, { small: true, locked: !owned });
      if (inDeck.has(c.id)) n.insertAdjacentHTML('beforeend', '<div class="indeck">IN DECK</div>');
      if (Pr.data.newCards.includes(c.id)) n.insertAdjacentHTML('beforeend', '<div class="newtag">NEW</div>');
      if (picked === c.id) n.classList.add('sel-ally');
      n.onclick = () => { picked = c.id; renderDetail(); g.querySelectorAll('.sel-ally').forEach(x => x.classList.remove('sel-ally')); n.classList.add('sel-ally'); };
      n.ondblclick = () => { if (owned) toggle(c.id); };
      frag.appendChild(n);
    }
    g.appendChild(frag);
    if (!items.length) g.innerHTML = '<p class="muted">No cards match.</p>';
  }

  function renderDetail() {
    const box = $('srDetail');
    if (!picked) { box.innerHTML = '<p class="muted">Click a card to see it. Double-click a collected card to add or remove it from your deck.</p>'; return; }
    const owned = Pr.owns(picked);
    if (!owned) { box.innerHTML = '<h3>Not collected yet</h3><p class="muted">Find this card in a pack to unlock it.</p>'; return; }
    box.innerHTML = detailHTML(picked) + `<div class="count muted">Copies owned: ${Pr.data.unlockAll ? 'unlocked (playtest)' : Pr.data.owned[picked]}</div>`;
    const b = document.createElement('div'); b.className = 'dbtns';
    const inDeck = (isChar(picked) ? draft.chars : draft.mods).includes(picked);
    const btn = document.createElement('button'); btn.className = 'btn small' + (inDeck ? ' ghost' : '');
    btn.textContent = inDeck ? 'Remove from deck' : 'Add to deck'; btn.onclick = () => toggle(picked);
    b.appendChild(btn); box.appendChild(b);
  }

  function toggle(id) {
    const arr = isChar(id) ? draft.chars : draft.mods;
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else {
      if (arr.length >= 12) return window.CCNav.toast(`Your deck already has 12 ${isChar(id) ? 'characters' : 'modifiers'}. Remove one first.`);
      if (isChar(id) && Pr.CHAR[id].category === 'Legendary' && draft.chars.filter(x => Pr.CHAR[x].category === 'Legendary').length >= 2)
        return window.CCNav.toast('A deck can hold at most 2 Legendary characters.');
      arr.push(id);
    }
    picked = id; persist(); renderGrid(); renderDeck(); renderDetail();
  }
  function persist() { Pr.setDeck(draft.chars, draft.mods); } // saved even while incomplete; battle checks validity

  function renderDeck() {
    const box = $('srDeck'); box.innerHTML = '';
    const problems = Pr.deckProblems(draft);
    const head = document.createElement('div'); head.className = 'deckhead';
    head.innerHTML = `<h3>My Deck</h3><div class="${problems.length ? 'bad' : 'good'}">${problems.length ? esc(problems.join(' · ')) : '✔ Ready for battle'}</div>`;
    box.appendChild(head);
    for (const [label, arr] of [['Characters', draft.chars], ['Modifiers', draft.mods]]) {
      box.insertAdjacentHTML('beforeend', `<div class="decksec">${label} <b>${arr.length}/12</b></div>`);
      const ul = document.createElement('div'); ul.className = 'decklist';
      const sorted = arr.slice().sort((a, b) => cost(a) - cost(b) || name(a).localeCompare(name(b)));
      for (const id of sorted) {
        const row = document.createElement('div'); row.className = 'deckrow' + (isChar(id) ? ' f-' + Pr.CHAR[id].category : ' mod');
        row.innerHTML = `<span class="dc">${cost(id)}</span><span class="dn">${esc(name(id))}</span>` +
          (isChar(id) ? `<span class="ds">⚔${Pr.CHAR[id].attack} 🛡${Pr.CHAR[id].printed_defense}</span>` : `<span class="ds">${esc(Pr.MOD[id].timing)}</span>`) +
          '<button class="x" title="Remove">✕</button>';
        row.onclick = () => { picked = id; renderDetail(); };
        row.querySelector('.x').onclick = e => { e.stopPropagation(); toggle(id); };
        ul.appendChild(row);
      }
      box.appendChild(ul);
    }
    const foot = document.createElement('div'); foot.className = 'deckfoot';
    const reset = document.createElement('button'); reset.className = 'btn small ghost'; reset.textContent = 'Reset to Starter deck';
    reset.onclick = () => { Pr.resetToStarter(); draft = { chars: Pr.data.deck.chars.slice(), mods: Pr.data.deck.mods.slice() }; renderGrid(); renderDeck(); };
    reset.disabled = !Pr.starterDone();
    const play = document.createElement('button'); play.className = 'btn small danger'; play.textContent = 'Battle with this deck';
    play.disabled = problems.length > 0; play.onclick = () => window.CCNav.quick();
    foot.append(reset, play); box.appendChild(foot);
    const avgCost = draft.chars.length ? (draft.chars.reduce((s, id) => s + cost(id), 0) / draft.chars.length).toFixed(1) : '–';
    box.insertAdjacentHTML('beforeend', `<p class="muted small">Average character cost ${avgCost}. Battle Coins: 100 per match.</p>`);
  }
  const cost = id => isChar(id) ? Pr.CHAR[id].purchase_cost : Pr.MOD[id].cost;
  const name = id => isChar(id) ? Pr.CHAR[id].name : Pr.MOD[id].name;

  function leave() { Pr.clearNew(); window.CCNav.home(); }

  window.CCShowroom = { show, leave };
})();
