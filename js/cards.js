/* Shared card faces for the Showroom and pack opening (cards not in a battle). */
(function () {
  'use strict';
  const { CHAR, MOD } = window.CCProfile;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const isChar = id => id[0] === 'C';
  const artOf = id => isChar(id) ? `${CCA(`art/characters/${id}.webp`)}` : `${CCA(`art/modifiers/${id}.webp`)}`;
  const IMGS = new Set(window.CC_CARD_IMAGES || []);
  const hasImg = id => IMGS.has(id);           // finished, printed card image
  const imgOf = id => `${CCA(`cards/${id}.webp`)}`;
  const TIMING_HELP = {
    Action: 'Your Prepare step only', Either: 'Prepare, while attacking, or as your response',
    Response: 'Only as your response', Attack: 'While you are attacking', 'After attack': 'After your attack resolves'
  };

  /* opts: {small, locked, back} */
  function face(id, opts) {
    opts = opts || {};
    const n = document.createElement('div'); n.dataset.id = id;
    if (opts.back) {
      n.className = 'card back' + (opts.small ? ' small' : '');
      n.style.backgroundImage = `url(${CCA(`assets/${isChar(id) ? 'character' : 'modifier'}-back.webp`)})`;
      return n;
    }
    if (hasImg(id)) {
      const label = isChar(id) ? CHAR[id].name : MOD[id].name;
      n.className = `card full${isChar(id) ? ' f-' + CHAR[id].category : ' mod'}${opts.small ? ' small' : ''}${opts.locked ? ' locked' : ''}`;
      n.style.backgroundImage = `url(${imgOf(id)})`;
      n.title = opts.locked ? 'Not collected yet' : label;
      if (opts.locked) n.insertAdjacentHTML('beforeend', '<div class="lockmark">?</div>');
      return n;
    }
    if (isChar(id)) {
      const c = CHAR[id];
      n.className = `card f-${c.category}${opts.small ? ' small' : ''}${opts.locked ? ' locked' : ''}`;
      n.innerHTML = `<div class="bgplate" style="background-image:url(${CCA(`assets/backgrounds/${c.category.toLowerCase()}.webp`)})"></div>` +
        `<div class="art" style="background-image:url(${artOf(id)})"></div>` +
        `<div class="title">${opts.locked ? '???' : esc(c.name)}</div><div class="cost">${c.purchase_cost}</div>` +
        `<img class="emblem" src="${CCA(`assets/emblems/${c.category.toLowerCase()}.webp`)}" alt="${c.category}">` +
        `<div class="statbar"><span class="atk">${c.attack}</span><span class="def">${c.printed_defense}</span></div>`;
    } else {
      const m = MOD[id];
      n.className = `card mod${opts.small ? ' small' : ''}${opts.locked ? ' locked' : ''}`;
      n.innerHTML = `<div class="art" style="background-image:url(${artOf(id)})"></div>` +
        `<div class="title">${opts.locked ? '???' : esc(m.name)}</div><div class="cost">${m.cost}</div>` +
        `<div class="modtiming">${esc(m.timing)}</div>`;
    }
    if (opts.locked) n.insertAdjacentHTML('beforeend', '<div class="lockmark">?</div>');
    return n;
  }

  /* Detail panel HTML for any card id. */
  function detailHTML(id) {
    const pic = hasImg(id) ? `<div class="dcard" style="background-image:url(${imgOf(id)})"></div><div class="v2note">Playtest rules text (v2)</div>` : '';
    return pic + detailText(id, !!pic);
  }
  function detailText(id, compact) {
    const head = `<div class="dart" style="background-image:url(${artOf(id)})"></div>`;
    if (isChar(id)) {
      const c = CHAR[id];
      return `<div class="dhead">${compact ? '' : head}<div>` +
        `<h3>${esc(c.name)}</h3><span class="tag">${esc(c.category)}</span><span class="tag">Cost ${c.purchase_cost}</span>` +
        `<div>⚔ Attack <b>${c.attack}</b> · 🛡 Defense <b>${c.printed_defense}</b></div></div></div>` +
        `<div class="sp"><b>${esc(c.special_name)}</b> <span class="tag">+${c.special_cost} coins</span>` +
        `<span class="tag" title="${esc(TIMING_HELP[c.timing] || '')}">${esc(c.timing)}</span>${c.once_per_game ? '<span class="tag">Once per game</span>' : ''}<br>${esc(c.effect)}</div>`;
    }
    const m = MOD[id];
    return `<div class="dhead">${compact ? '' : head}<div>` +
      `<h3>${esc(m.name)}</h3><span class="tag">Modifier</span><span class="tag">${m.cost} coins</span>` +
      `<span class="tag">${esc(m.timing)}</span><div class="muted">${esc(TIMING_HELP[m.timing] || '')}</div></div></div>` +
      `<div class="sp">${esc(m.card_effect)}</div>` +
      (m.special_bonus && m.special_bonus !== 'None' ? `<div class="sp bonus"><b>Special Bonus</b><br>${esc(m.special_bonus)}</div>` : '');
  }

  window.CCCards = { face, detailHTML, detailText, isChar, esc, TIMING_HELP, hasImg, imgOf };
})();
