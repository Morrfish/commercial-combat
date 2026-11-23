/* Commercial Combat - starter pack opening. Only the two free, curated Starter Packs
 * are enabled; paid/random packs stay off until prices and odds are approved. */
(function () {
  'use strict';
  const Pr = window.CCProfile; const { face, detailHTML, esc } = window.CCCards;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let opening = false;

  function show() {
    window.CCNav.show('packs');
    renderIdle();
  }
  function nextIndex() { return Pr.data.starterOpened.findIndex(x => !x); }

  function renderIdle() {
    const i = nextIndex();
    const stage = $('packStage'); const reveal = $('packReveal'); const foot = $('packFoot');
    reveal.innerHTML = ''; reveal.style.flex = ''; foot.innerHTML = ''; stage.style.display = '';
    $('packDetail').innerHTML = '<p class="muted">Flip a card to read it here.</p>';
    if (i < 0) {
      stage.innerHTML = `<div class="pack-done"><h2>Both Starter Packs Opened!</h2><p>Your first deck is ready: 12 characters and 12 modifiers.</p></div>`;
      addBtn(foot, 'Go to The Showroom', '', () => window.CCShowroom.show());
      addBtn(foot, 'Quick Combat', 'danger', () => window.CCNav.quick());
      return;
    }
    $('packTitle').textContent = `Starter Pack ${i + 1} of ${Pr.data.starterOpened.length}`;
    stage.innerHTML = '';
    const pack = document.createElement('div'); pack.className = 'pack';
    pack.innerHTML = `<img class="pack-body" src="${CCA(`assets/pack-starter.webp`)}" alt="Starter Pack"><img class="pack-strip" src="${CCA(`assets/pack-torn-top-strip.webp`)}" alt="">`;
    pack.title = 'Click to open';
    pack.onclick = () => open(i, pack);
    stage.appendChild(pack);
    stage.insertAdjacentHTML('beforeend', '<p class="pack-hint">Click the pack to tear it open</p>');
  }
  function addBtn(box, label, cls, fn) { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; box.appendChild(b); return b; }

  async function open(i, pack) {
    if (opening) return; opening = true;
    const got = Pr.openStarter(i);
    if (!got) { opening = false; return renderIdle(); }
    pack.classList.add('tearing');
    await sleep(700);
    pack.classList.add('gone');
    const hint = document.querySelector('.pack-hint'); if (hint) hint.remove();
    await sleep(250);
    $('packStage').innerHTML = ''; $('packStage').style.display = 'none';
    const reveal = $('packReveal'); reveal.innerHTML = ''; reveal.style.flex = '1';
    const ids = got.characters.concat(got.modifiers);
    const slots = [];
    const rows = [document.createElement('div'), document.createElement('div')];
    rows.forEach(r => { r.className = 'reveal-row'; reveal.appendChild(r); });
    ids.forEach((id, k) => {
      const wrap = document.createElement('div'); wrap.className = 'flip'; wrap.style.animationDelay = (k * 60) + 'ms';
      const inner = document.createElement('div'); inner.className = 'flip-inner';
      const back = face(id, { back: true }); back.classList.add('flip-back');
      const front = face(id); front.classList.add('flip-front');
      inner.append(back, front); wrap.appendChild(inner);
      wrap.onclick = () => { wrap.classList.add('flipped'); $('packDetail').innerHTML = detailHTML(id); };
      rows[k < got.characters.length ? 0 : 1].appendChild(wrap); slots.push(wrap);
    });
    const foot = $('packFoot'); foot.innerHTML = '';
    addBtn(foot, 'Reveal All', 'alt', async () => { for (const s of slots) { if (!s.classList.contains('flipped')) { s.classList.add('flipped'); await sleep(90); } } });
    addBtn(foot, nextIndex() >= 0 ? 'Next Pack' : 'Done', '', () => { slots.forEach(s => s.classList.add('flipped')); renderIdle(); });
    $('packTitle').textContent = `Starter Pack ${i + 1}: 6 characters + 6 modifiers`;
    opening = false;
  }

  window.CCPacks = { show };
})();
