/* Commercial Combat - v2 rules engine.
 * Line-for-line port of the Codex handoff's reference-engine/full_engine.py
 * (explicit effect specs; card prose is never parsed). Turn flow is split into
 * steps so a human can play one seat; bot heuristics are unchanged.
 */
(function () {
  'use strict';
  const D = window.CC_DATA;
  const C = D.characters;
  const S = D.specs;
  const M = {};
  D.modifiers.forEach(m => { M[m.id] = m; });
  const REF = {};
  C.forEach((c, i) => { REF[c.ref] = i; });
  const NAMES = {};
  C.forEach((c, i) => { NAMES[c.name] = i; });
  const CID = {};
  C.forEach((c, i) => { CID[c.id] = i; });

  function ref(name) {
    const exact = REF[name.toLowerCase()];
    if (exact !== undefined) return exact;
    const squash = s => s.replace(/\./g, '').replace(/ /g, '');
    const want = squash(name.toLowerCase());
    const found = Object.keys(REF).filter(n => squash(n) === want).map(n => REF[n]);
    if (found.length === 1) return found[0];
    throw new Error('Unknown reference ' + name);
  }

  const card = u => C[u.cid];
  const hp = u => Math.max(0, C[u.cid].printed_defense - u.damage);
  const atk = u => C[u.cid].attack;
  const cat = u => C[u.cid].category;
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const maxBy = (arr, f) => arr.reduce((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);
  const minBy = (arr, f) => arr.reduce((b, x) => (b === undefined || f(x) < f(b) ? x : b), undefined);
  const remove = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };
  const truthy = v => !(v === null || v === undefined || v === false || v === 0 || v === '' ||
    (Array.isArray(v) && v.length === 0));
  // Stable sort descending by key tuple (Python sorted(..., reverse=True) on tuples).
  function sortDesc(arr, keyf) {
    return arr.map((x, i) => [keyf(x), i, x]).sort((p, q) => {
      for (let k = 0; k < p[0].length; k++) {
        const a = +p[0][k], b = +q[0][k];
        if (a !== b) return b - a;
      }
      return p[1] - q[1];
    }).map(t => t[2]);
  }

  function newPlayer() {
    return { coins: 100, deck: [], hand: [], field: [], grave: [], mdeck: [], mhand: [], mgrave: [],
      own_turns: 0, special: false, modifier: false, response: false, bought: false, normal: false,
      extra: false, grant: null, cease: false, discount: 0 };
  }

  const COMBAT_K = new Set(['a', 'g', 'ap', 'ex', 'replace_a', 'set_a', 'ignore_enemy_a', 'ignore_enemy_g',
    'ignore_ex', 'ignore_ap', 'block_bonus', 'block_special_bonus', 'rescue', 'rescue_once', 'counter',
    'no_attack_after', 'onkill_draw', 'onkill_extra', 'return_after', 'after_ap', 'honest', 'pocket']);

  class Game {
    /* decks: [[cid,...],[cid,...]] (12 unique each); mdecks: [[mid,...],[mid,...]].
       autoOpen[p]: bot picks opening characters; otherwise call openingBuy(). */
    constructor(decks, mdecks, opts) {
      opts = opts || {};
      this.rs = (opts.seed >>> 0) || 1;
      this.units = {}; this.ps = [newPlayer(), newPlayer()];
      this.turn = 0; this.active = 0; this.winner = null; this.over = false; this.reason = '';
      this.logging = opts.logging !== false; this.log = []; this.effects = opts.effects !== false;
      this.knowledge = [[], []];
      this.used = {}; this.used_bonus = {}; this.used_once_mod = []; this.changed = 0; this.stall = 0;
      this.ctx = {}; this.targets = new Set(); this.blocked = new Set(); this.block_negative = new Set();
      this.battle_n = 0; this.turnStart = 0;
      // Experimental rule (Opening Turn Comparison, not the v2 default): nobody attacks on their own first turn.
      this.bothSkipOpening = !!opts.bothSkipOpening;
      // Player choices: every engine decision goes through pick(). forced = {p, picks:[[ids]...]}
      // replays a human's picks by decision order; recording = seat whose decisions are logged.
      this.forced = null; this.recording = null; this.decisions = null; this.actor = null; this.decN = 0;
      const autoOpen = opts.autoOpen || [true, true];
      for (const p of [0, 1]) {
        for (const cid of decks[p]) {
          const uid = p + ':' + cid;
          this.units[uid] = { uid, cid, owner: p, controller: p, damage: 0, ready_at: 0, entered: -1,
            ready_override: false, marks: [], once: false, dodge: false, charge: false, attacked: -1,
            no_rebuy: -1, temporary: '' };
          this.ps[p].deck.push(uid);
        }
        this.ps[p].mdeck = mdecks[p].slice();
        if (opts.shuffle !== false) { this.shuffle(this.ps[p].deck); this.shuffle(this.ps[p].mdeck); }
        this.draw(p, 5 + (p === 0 ? (opts.opening_bonus || 0) : 0)); this.draw(p, 3, true);
        if (autoOpen[p]) this.autoOpening(p);
      }
      this.changed = 0;
    }
    // ---- infrastructure ----
    rand() { // mulberry32, state kept in this.rs so clones stay deterministic
      let t = (this.rs = (this.rs + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
    choice(a) { return a[Math.floor(this.rand() * a.length)]; }
    count(obj, k) { obj[k] = (obj[k] || 0) + 1; }
    note(s) { if (this.logging) this.log.push({ turn: this.turn, text: s }); }
    clone() {
      const g = Object.create(Game.prototype);
      const data = {};
      for (const k of Object.keys(this)) data[k] = this[k];
      Object.assign(g, structuredClone(data));
      return g;
    }
    adopt(g) { for (const k of Object.keys(g)) this[k] = g[k]; }
    /* A decision point. ids are in the bot's preference order, so with no forced pick the
       result is exactly the reference engine's choice (first n). */
    pick(label, ids, n = 1, info = null) {
      n = Math.min(n, ids.length);
      const i = this.decN = (this.decN || 0) + 1;
      let out = ids.slice(0, n);
      const f = this.forced && this.forced.p === this.actor ? this.forced.picks[i - 1] : null;
      if (f && f.length === n && new Set(f).size === n && f.every(x => ids.includes(x))) out = f.slice();
      if (this.recording !== null && this.recording === this.actor && this.decisions) this.decisions.push({ label, ids: ids.slice(), n, chosen: out.slice(), info });
      return out;
    }
    pickOne(label, ids, info) { return this.pick(label, ids, 1, info)[0]; }
    field(p) { return this.ps[p].field.map(u => this.units[u]); }
    draw(p, n = 1, mod = false) {
      const a = this.ps[p]; const deck = mod ? a.mdeck : a.deck; const hand = mod ? a.mhand : a.hand;
      const k = Math.min(n, deck.length);
      for (let i = 0; i < k; i++) hand.push(deck.shift());
    }
    unit_value(uid) { const u = this.units[uid]; return atk(u) * 0.7 + hp(u) * 0.6 + 5; }
    ready(u, special = false) {
      return (u.ready_override || this.ps[u.controller].own_turns >= u.ready_at) && (!special || !u.temporary);
    }
    eligible(p, u, special = false) {
      if (!this.ps[p].field.includes(u.uid) || !this.ready(u, special)) return false;
      if (this.flag(u, 'silence') && special) return false;
      if (this.flag(u, 'stun') && !special) return false;
      if (this.flag(u, 'no_attack') && !special) return false;
      return true;
    }
    buy_candidates(p) {
      const a = this.ps[p];
      if (a.field.length >= 5) return [];
      const hasleg = this.field(p).some(u => cat(u) === 'Legendary');
      return a.hand.filter(uid => {
        const u = this.units[uid];
        return u.no_rebuy !== this.turn && Math.max(1, card(u).purchase_cost - a.discount) <= a.coins &&
          !(hasleg && cat(u) === 'Legendary');
      });
    }
    buyCost(p, uid) { return Math.max(1, card(this.units[uid]).purchase_cost - this.ps[p].discount); }
    buy(p, uid, opening = false, ready = false) {
      const a = this.ps[p];
      if (!this.buy_candidates(p).includes(uid) || (a.bought && !opening)) return false;
      const u = this.units[uid]; const cost = Math.max(1, card(u).purchase_cost - a.discount); a.discount = 0;
      if (cost > a.coins) return false;
      a.coins -= cost; remove(a.hand, uid); a.field.push(uid); this.reset_unit(u);
      u.controller = p; u.entered = this.turn; u.ready_at = a.own_turns + 1; u.ready_override = ready || opening;
      if (!opening) a.bought = true;
      this.changed++; this.count(this.used, 'deploy:' + u.cid);
      this.note(`P${p + 1} buys ${card(u).name} for ${cost}`); return true;
    }
    autoOpening(p) {
      for (let i = 0; i < 2; i++) {
        const cand = this.buy_candidates(p);
        if (cand.length) this.buy(p, maxBy(cand, uid => this.unit_value(uid) / Math.max(1, card(this.units[uid]).purchase_cost)), true);
      }
    }
    openingBuy(p, uids) { // human opening: pay for chosen characters together
      for (const uid of uids) if (!this.buy(p, uid, true)) return false;
      this.changed = 0; return true;
    }
    reset_unit(u) { u.damage = 0; u.marks = []; u.dodge = false; u.charge = false; u.temporary = ''; u.ready_override = false; }
    zone(uid, destination, p = null, top = false) {
      const u = this.units[uid]; const owner = p === null ? u.owner : p;
      for (const a of this.ps) for (const attr of ['field', 'hand', 'deck', 'grave']) remove(a[attr], uid);
      u.marks = []; u.dodge = false; u.charge = false; u.temporary = ''; u.ready_override = false; u.controller = owner;
      const z = this.ps[owner][destination];
      if (top) z.unshift(uid); else z.push(uid);
      this.targets.add(uid); this.changed++;
    }
    hurt(uid, n) {
      const u = this.units[uid];
      if (this.blocked.has(uid)) return;
      u.damage += Math.max(0, n);
      if (n) this.changed++;
      if (hp(u) === 0 && this.ps[u.controller].field.includes(uid)) this.kill(uid);
    }
    kill(uid) {
      const u = this.units[uid]; const rescue = this.flag(u, 'rescue'); const onceflag = this.flag(u, 'rescue_once');
      if (rescue) {
        if (onceflag) u.once = true;
        this.zone(uid, rescue === 'hand' ? 'hand' : 'deck', null, rescue === 'deck');
        this.note(card(u).name + ' is defeated and rescued');
      } else { this.zone(uid, 'grave'); this.note(card(u).name + ' is defeated'); }
    }
    expires(p) { return this.turn + (p === this.active ? 2 : 1); }
    mark(uid, kind, value, p, next = true, scope = null, end = null, source = 'special') {
      if (this.blocked.has(uid)) return;
      if (this.block_negative.has(uid) && (kind === 'ap' || kind === 'ex')) return;
      this.targets.add(uid);
      this.units[uid].marks.push({ k: kind, v: value, expires: end === null ? this.expires(p) : end,
        end_expire: end !== null, next, scope, battle: this.battle_n, source });
      this.changed++;
    }
    relevant(m, u, opp = null, attacking = null) {
      if (m.expires < this.turn) return false;
      const scope = m.scope;
      if (!scope || Object.keys(scope).length === 0) return true;
      if (scope.opp && (!opp || opp.uid !== scope.opp)) return false;
      if (has(scope, 'attacking') && scope.attacking !== attacking) return false;
      const qual = scope.qual || {};
      const hasQual = Object.keys(qual).length > 0;
      if (hasQual && !opp) return false;
      if (hasQual) {
        if (has(qual, 'mind') && card(opp).printed_defense < qual.mind) return false;
        if (has(qual, 'maxd') && card(opp).printed_defense > qual.maxd) return false;
        if (has(qual, 'mina') && atk(opp) < qual.mina) return false;
        if (qual.higher_a && atk(opp) <= atk(u)) return false;
        if (has(qual, 'cat') && cat(opp) !== qual.cat) return false;
        if (has(qual, 'cost') && card(opp).purchase_cost > qual.cost) return false;
        if (qual.nonlegend && cat(opp) === 'Legendary') return false;
      }
      return true;
    }
    vals(u, k, opp = null, attacking = null) { return u.marks.filter(m => m.k === k && this.relevant(m, u, opp, attacking)).map(m => m.v); }
    flag(u, k, opp = null, attacking = null) {
      const a = this.vals(u, k, opp, attacking);
      if (!a.length) return null;
      const numeric = a.every(v => typeof v === 'number' || typeof v === 'boolean');
      if (!['replace_a', 'set_a', 'rescue', 'pocket'].includes(k) && numeric) {
        if (a.every(v => typeof v === 'boolean')) return a.some(v => v);
        return Math.max(...a.map(Number));
      }
      return a[a.length - 1];
    }
    amount(u, k, opp = null, attacking = null) { return Math.min(15, Math.max(0, ...this.vals(u, k, opp, attacking).map(Number))); }
    attack_value(a, d = null, attacking = true) {
      const fixed = this.flag(a, 'set_a', d, attacking);
      if (fixed !== null) return fixed;
      let base = this.flag(a, 'replace_a', d, attacking);
      if (base === null) base = atk(a);
      let bonus = this.amount(a, 'a', d, attacking);
      if (truthy(this.flag(a, 'block_bonus', d, attacking)) || truthy(this.flag(a, 'honest', d, attacking))) bonus = 0;
      if (truthy(this.flag(a, 'block_special_bonus', d, attacking)))
        bonus = Math.min(15, Math.max(0, ...a.marks.filter(m => m.k === 'a' && m.source === 'modifier' && this.relevant(m, a, d, attacking)).map(m => m.v)));
      if (d) bonus = Math.max(0, bonus - (this.flag(d, 'ignore_enemy_a', a, !attacking) || 0));
      const pen = Math.max(0, this.amount(a, 'ap', d, attacking) - (this.flag(a, 'ignore_ap', d, attacking) || 0));
      if (truthy(this.flag(a, 'honest', d, attacking))) return atk(a);
      return Math.max(0, base + bonus - pen);
    }
    guard_value(d, a = null) {
      if (truthy(this.flag(d, 'honest', a, false))) return 0;
      let g = this.amount(d, 'g', a, false); let ex = this.amount(d, 'ex', a, false);
      if (truthy(this.flag(d, 'ignore_g', a, false))) g = 0;
      if (truthy(this.flag(d, 'ignore_ex', a, false))) ex = Math.max(0, ex - this.flag(d, 'ignore_ex', a, false));
      if (a) g = Math.max(0, g - (this.flag(a, 'ignore_enemy_g', d, true) || 0));
      return g - ex;
    }
    damage_prediction(a, d) {
      const v = this.attack_value(a, d);
      return v === 0 ? 0 : Math.max(0, v - this.guard_value(d, a));
    }
    clean(u, negative = true, n = 1, ex_only = false, one_each = false) {
      const kinds = ex_only ? ['ex'] : (negative ? ['ap', 'ex'] : ['a', 'g']);
      let targets = sortDesc(u.marks.filter(m => kinds.includes(m.k)), m => [m.v]);
      if (one_each) targets = kinds.map(k => targets.find(m => m.k === k)).filter(Boolean);
      else targets = targets.slice(0, n);
      for (const m of targets) remove(u.marks, m);
      if (targets.length) this.changed++;
      return targets.length;
    }
    has_ally(p, name) { const r = ref(name); return this.field(p).some(u => u.cid === r); }
    matches(u, s, source = null) {
      return (!s.cat || cat(u) === s.cat) && (!s.other || !source || u.uid !== source.uid) &&
        (!s.nonlegend || cat(u) !== 'Legendary') && (!has(s, 'cost') || card(u).purchase_cost <= s.cost) &&
        (!has(s, 'maxa') || atk(u) <= s.maxa);
    }
    select(p, s, source = null, enemy = false) {
      let units = this.field(enemy ? 1 - p : p).filter(u => this.matches(u, s, source));
      const prefer = this.ctx[enemy && p !== this.active ? 'a' : enemy ? 'd' : p !== this.active ? 'd' : 'a'];
      units = sortDesc(units, u => [u.uid === prefer ? 1 : 0, this.unit_value(u.uid)]);
      if (s.different_cats) { const seen = new Set(); units = units.filter(u => { if (seen.has(cat(u))) return false; seen.add(cat(u)); return true; }); }
      const n = has(s, 'n') ? s.n : 1;
      if (units.length < (has(s, 'required_n') ? s.required_n : 1)) return [];
      const chosen = this.pick(enemy ? 'enemy' : 'ally', units.map(u => u.uid), n,
        { cat: s.cat || null, other: !!s.other, nonlegend: !!s.nonlegend }).map(id => this.units[id]);
      if (p !== this.active && !enemy && this.ctx.d && chosen.every(u => u.uid !== this.ctx.d)) return [];
      if (p !== this.active && enemy && this.ctx.a && chosen.every(u => u.uid !== this.ctx.a)) return [];
      return chosen;
    }
    buff(u, s, p, source = null, origin = 'special', scope = null, next = true) {
      const vals = {};
      for (const k of ['a', 'g', 'ap', 'ex', 'ignore_ex', 'ignore_ap', 'ignore_enemy_a', 'ignore_enemy_g', 'replace_a', 'set_a', 'rescue', 'rescue_once', 'no_attack_after', 'onkill_draw', 'onkill_extra', 'return_after', 'after_ap', 'honest'])
        if (has(s, k)) vals[k] = s[k];
      if (truthy(s.choice)) vals[p !== this.active ? 'g' : 'a'] = s.choice;
      if (s.replace_d) vals.replace_a = card(u).printed_defense;
      if (s.conditional_ally && this.has_ally(p, s.conditional_ally))
        for (const key of ['a', 'g', 'ex']) if (has(s, 'alt_' + key)) vals[key] = s['alt_' + key];
      if (s.conditional_any && s.conditional_any.some(n => this.has_ally(p, n))) vals.g = s.alt_g;
      if (s.only_cat && this.field(p).filter(x => cat(x) === s.only_cat).length === 1) vals.a = s.alt_a;
      if (s.no_other_cat && !this.field(p).some(x => x.cid !== u.cid && cat(x) === s.no_other_cat)) vals.a = s.alt_a;
      if (s.target_mind && card(u).printed_defense >= s.target_mind) vals.a = s.alt_a;
      if (s.low_attack_guard && atk(u) <= 10) { delete vals.a; vals.g = 10; }
      if (s.scale_cat) {
        const us = this.field(p).concat(s.scale_both ? this.field(1 - p) : []);
        const count = us.filter(x => cat(x) === s.scale_cat && (!s.scale_other || x.uid !== u.uid)).length;
        for (const key of ['a', 'g']) if (has(s, key + '_scale')) vals[key] = Math.min(has(s, 'cap') ? s.cap : 15, count * s[key + '_scale']);
      }
      if (s.grave_guard_cat) {
        let n = 0; for (const a of this.ps) for (const x of a.grave) if (cat(this.units[x]) === s.grave_guard_cat) n++;
        vals.g = Math.min(15, 3 * n);
      }
      if (s.grave_bonus_cat && this.ps[p].grave.some(x => cat(this.units[x]) === s.grave_bonus_cat)) vals.a = s.grave_a;
      if (s.cleanse_ex) this.clean(u, true, 99, true);
      if (s.cleanse_one) this.clean(u);
      if (truthy(vals.rescue_once)) u.once = true;
      for (const [k, v] of Object.entries(vals)) if (v !== false && v !== null && v !== undefined) this.mark(u.uid, k, v, p, next, scope, null, origin);
      if (s.no_source_attack && source) this.mark(source.uid, 'no_attack', true, p, false, null, this.turn);
      if (s.self_ap && source) this.mark(source.uid, 'ap', s.self_ap, p);
      if (s.self_replace_d && source) this.mark(source.uid, 'replace_a', card(source).printed_defense, p);
      if (s.bottom_top && this.ps[p].deck.length) { this.ps[p].deck.push(this.ps[p].deck.shift()); this.changed++; }
      if (s.peek_enemy && this.ps[1 - p].hand.length) this.knowledge[p].push(this.choice(this.ps[1 - p].hand));
      if (s.peek && this.ps[p].deck.length) this.knowledge[p].push(this.ps[p].deck[0]);
      if (s.conditional_draw && this.has_ally(p, s.conditional_draw)) { this.draw(p); this.changed++; }
    }
    asc(ids) { return sortDesc(ids, x => [-this.unit_value(x)]); }   // = Python min() order
    desc(ids) { return sortDesc(ids, x => [this.unit_value(x)]); }   // = Python max() order
    discard_char(p) {
      if (!this.ps[p].hand.length) return false;
      const uid = this.pickOne('discard', this.asc(this.ps[p].hand)); this.zone(uid, 'grave'); return true;
    }
    special_cost(p, u) { return Math.max(0, card(u).special_cost + (this.flag(u, 'tax') || 0) - (this.flag(u, 'discount') || 0)); }
    activate(p, uid) {
      this.actor = p; this.decN = 0;
      if (!this.ps[p].field.includes(uid)) return false;
      const u = this.units[uid]; const s = S[u.cid]; const timing = C[u.cid].timing; const response = p !== this.active;
      if (!this.eligible(p, u, true) || (u.once && s.once)) return false;
      if (response) {
        if (this.ps[p].response || !['Response', 'Either'].includes(timing)) return false;
        if (this.ctx.honest || this.ctx.no_special) return false;
      } else if (this.ps[p].special || timing === 'Response') return false;
      else if (timing === 'Action' && (this.ctx.phase || 'prepare') !== 'prepare') return false;
      const cost = this.special_cost(p, u);
      if (cost > this.ps[p].coins) return false;
      if (response && ['self', 'copy_grave', 'copy_ally', 'copy_enemy', 'dodge', 'defend'].includes(s.op) && uid !== this.ctx.d) return false;
      if (!this.special_effect(p, u, s)) return false;
      this.ps[p].coins -= cost;
      u.marks = u.marks.filter(m => m.k !== 'discount' && m.k !== 'tax');
      if (s.once) u.once = true;
      if (response) this.ps[p].response = true; else this.ps[p].special = true;
      this.count(this.used, 'special:' + u.cid); this.changed++;
      this.note(`P${p + 1} uses ${card(u).name}'s ${card(u).special_name} (${cost})`); return true;
    }
    special_effect(p, u, s) {
      const op = s.op; let a = this.ps[p]; const opp = this.ps[1 - p];
      const foe = this.units[this.ctx[p !== this.active ? 'a' : 'd']];
      if (s.discard && !this.discard_char(p)) return false;
      if (op === 'self') {
        if (s.charge && !u.charge) return false;
        if (s.require_other_cat && !this.field(p).some(x => x.uid !== u.uid && cat(x) === s.require_other_cat)) return false;
        if (s.require_other_animal_mina && !this.field(p).some(x => x.uid !== u.uid && cat(x) === 'Animal' && atk(x) >= s.require_other_animal_mina)) return false;
        const filters = [['foe_mind', f => card(f).printed_defense >= s.foe_mind], ['foe_maxd', f => card(f).printed_defense <= s.foe_maxd],
          ['foe_mina', f => atk(f) >= s.foe_mina], ['foe_higher_a', f => atk(f) > atk(u)], ['foe_cat', f => cat(f) === s.foe_cat],
          ['foe_cats', f => s.foe_cats.includes(cat(f))], ['foe_cost', f => card(f).purchase_cost <= s.foe_cost], ['foe_nonlegend', f => cat(f) !== 'Legendary']];
        if (filters.some(([k, fun]) => has(s, k) && (!foe || !fun(foe)))) return false;
        if (s.normal_only && a.normal) return false;
        const q = Object.assign({}, s);
        if (s.foe_positive_guard_alt && foe && this.guard_value(foe, u) > 0) q.a = s.foe_positive_guard_alt;
        if (s.rescue) q.rescue_once = true;
        let scope = s.attack_only ? { attacking: true } : null;
        const qual = {};
        for (const key of ['mind', 'maxd', 'mina', 'cost', 'nonlegend', 'cat']) if (has(s, 'foe_' + key)) qual[key] = s['foe_' + key];
        if (s.foe_higher_a) qual.higher_a = true;
        if (s.foe_cats && foe) qual.cat = cat(foe);
        if (Object.keys(qual).length) scope = Object.assign({}, scope || {}, { qual, consume_any: true });
        this.buff(u, q, p, null, 'special', scope);
        if (s.foe_animal_ap && foe && cat(foe) === 'Animal') this.mark(foe.uid, 'ap', s.foe_animal_ap, p);
        return true;
      }
      if (op === 'buff' || op === 'cleanse') {
        const ts = this.select(p, s, u);
        if (!ts.length) return false;
        if (s.also_self) ts.push(u);
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i]; const q = Object.assign({}, s);
          if (s.split) delete q[i === 0 ? 'g' : 'a'];
          if (s.low_pair_g && ts.every(x => atk(x) <= 15)) q.g = s.low_pair_g;
          if (op === 'cleanse') {
            const removed = this.clean(t, true, has(s, 'nremove') ? s.nremove : 1, !!s.ex_only, !!s.one_each);
            if (!removed && !s.g) return false;
          }
          if (s.bonus_cat && cat(t) !== s.bonus_cat) delete q.g;
          this.buff(t, q, p, u);
        }
        if (s.enemy_ex) {
          const targets = this.select(p, {}, u, true);
          if (!targets.length) return false;
          this.mark(targets[0].uid, 'ex', s.enemy_ex, p);
        }
        return true;
      }
      if (op === 'enemy') {
        const ts = this.select(p, s, u, true);
        if (!ts.length) return false;
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i];
          if (s.foe_d_higher && card(t).printed_defense <= card(u).printed_defense) return false;
          const q = Object.assign({}, s);
          if (s.split) delete q[i === 0 ? 'ex' : 'ap'];
          if (s.foe_higher_a_alt && atk(t) > atk(u)) q.ap = s.foe_higher_a_alt;
          if (s.conditional_ally && this.has_ally(p, s.conditional_ally)) q.ex = s.alt_ex;
          if (s.ex_scale_cat) q.ex = Math.min(has(s, 'cap') ? s.cap : 15, 5 * this.field(p).filter(x => cat(x) === s.ex_scale_cat && (!s.ex_scale_other || x.uid !== u.uid)).length);
          if (s.ex_grave_cat) q.ex = Math.min(15, 5 * a.grave.filter(x => cat(this.units[x]) === s.ex_grave_cat).length);
          const scope = s.source_attack ? { opp: u.uid, attacking: false } : null;
          for (const k of ['ap', 'ex', 'block_bonus', 'block_special_bonus']) if (truthy(q[k])) this.mark(t.uid, k, q[k], p, true, scope);
          if (s.ignore_positive) { this.mark(t.uid, 'block_bonus', true, p); this.mark(t.uid, 'ignore_g', true, p); }
          if (s.ignore_g || s.ignore_g_ex) this.mark(t.uid, 'ignore_g', true, p, true, scope);
          if (s.ignore_g_ex) this.mark(t.uid, 'ignore_ex', 99, p, true, scope);
          for (const k of ['stun', 'silence', 'noextra']) if (s[k]) this.mark(t.uid, k, true, p, false, null, s.end_this_turn ? this.turn : this.turn + 1);
          if (s.remove_positive) this.clean(t, false, s.remove_positive);
          if (s.reduce_positive_a) for (const m of t.marks) if (m.k === 'a') m.v = Math.max(0, m.v - s.reduce_positive_a);
          if (s.swap_positive) {
            const aa = this.amount(t, 'a'); const gg = this.amount(t, 'g'); t.marks = t.marks.filter(m => m.k !== 'a' && m.k !== 'g');
            this.mark(t.uid, 'a', gg, p); this.mark(t.uid, 'g', aa, p);
          }
        }
        if (s.self_ex) this.mark(u.uid, 'ex', s.self_ex, p);
        if (s.self_a) this.mark(u.uid, 'a', s.self_a, p);
        if (s.solo_a && a.field.length === 1) this.mark(u.uid, 'a', s.solo_a, p);
        if (s.other_cat_guard) {
          const us = this.select(p, { cat: s.other_cat_guard, other: true }, u);
          if (!us.length) return false;
          this.mark(us[0].uid, 'g', s.other_g, p);
        }
        return true;
      }
      if (op === 'defend') {
        if (!foe || p === this.active) return false;
        if (s.ap) this.mark(foe.uid, 'ap', s.ap, p, false);
        if (s.g) this.mark(u.uid, 'g', s.g, p, false);
        if (s.counter) this.mark(u.uid, 'counter', s.counter, p, false);
        return true;
      }
      if (op === 'look') {
        if (!a.deck.length) return false;
        const n = Math.min(has(s, 'n') ? s.n : 1, a.deck.length); let top = a.deck.slice(0, n); const rest = a.deck.slice(n);
        if (s.draw_if_animals) {
          if (this.field(p).filter(x => cat(x) === 'Animal').length >= s.draw_if_animals) this.draw(p);
          else a.deck = rest.concat(top);
        } else if (s.take) {
          const valid = top.filter(x => this.matches(this.units[x], s));
          const chosen = valid.length ? this.pickOne('take', this.desc(valid)) : null;
          if (chosen) { remove(top, chosen); a.hand.push(chosen); }
          if (s.discard_rest) { a.deck = rest; for (const x of top) this.zone(x, 'grave'); }
          else if (!chosen && s.leave_failure) { /* leave deck unchanged */ }
          else a.deck = rest.concat(top);
        } else if (s.order) {
          top = sortDesc(top, x => [this.unit_value(x)]);
          a.deck = ([2, 3].includes(s.n) || u.cid === 161) ? top.slice(0, 1).concat(rest, top.slice(1)) : top.concat(rest);
        }
        this.changed++; return true;
      }
      if (op === 'recover') {
        const valid = a.grave.filter(x => this.matches(this.units[x], s));
        if (!valid.length) return false;
        const x = this.pickOne('grave', this.desc(valid)); this.zone(x, s.top ? 'deck' : 'hand', null, !!s.top); return true;
      }
      if (op === 'draw_bottom' || op === 'draw_discard' || op === 'bottom_draw2') {
        if (!a.deck.length) return false;
        if (op === 'bottom_draw2') {
          if (!a.hand.length) return false;
          const x = this.pickOne('bottom', this.asc(a.hand)); this.zone(x, 'deck'); this.draw(p, 2);
        } else {
          this.draw(p);
          if (!a.hand.length) return false;
          const x = this.pickOne(op === 'draw_bottom' ? 'bottom' : 'discard', this.asc(a.hand)); this.zone(x, op === 'draw_bottom' ? 'deck' : 'grave');
        }
        this.changed++; return true;
      }
      if (['bounce', 'bounce_buff', 'bounce_recover_top', 'chef_recover'].includes(op)) {
        const us = (s.self_only || op === 'bounce_recover_top' || op === 'chef_recover') ? [u] : this.select(p, s, u);
        if (!us.length) return false;
        const picked = us[0];
        if (op === 'bounce_buff') {
          const extra = this.field(p).filter(t => cat(t) === s.cat && t.uid !== picked.uid && t.uid !== u.uid);
          if (!extra.length) return false;
          this.mark(extra[0].uid, 'g', s.g, p);
        }
        if (op === 'bounce_recover_top' || op === 'chef_recover') {
          const valid = a.grave.filter(x => cat(this.units[x]) === (op === 'chef_recover' ? 'Shadow' : s.cat) && (op !== 'chef_recover' || card(this.units[x]).purchase_cost <= 6));
          if (!valid.length) return false;
          this.zone(this.pickOne('grave', this.desc(valid)), op === 'chef_recover' ? 'hand' : 'deck', null, op !== 'chef_recover');
        }
        this.zone(picked.uid, 'hand');
        if (s.no_rebuy) picked.no_rebuy = this.turn;
        if (s.self_g) this.mark(u.uid, 'g', s.self_g, p);
        if (s.draw) this.draw(p, s.draw);
        for (let i = 0; i < (s.discard_after || 0); i++) this.discard_char(p);
        if (s.bottom_top && a.deck.length) a.deck.push(a.deck.shift());
        if (s.look_after) { const k = s.look_after; a.deck.splice(0, k, ...sortDesc(a.deck.slice(0, k), x => [this.unit_value(x)])); }
        return true;
      }
      if (op === 'recycle_modifier') {
        if (!a.mgrave.length) return false;
        a.mdeck.push(a.mgrave.pop()); this.shuffle(a.mdeck); this.draw(p, 1, true); this.changed++; return true;
      }
      if (op === 'sacrifice_aoe') {
        this.zone(u.uid, 'grave');
        for (const uid of opp.field.slice()) this.hurt(uid, s.damage);
        return true;
      }
      if (op === 'replace_defender') {
        if (p === this.active || this.ctx.d !== u.uid) return false;
        const choices = a.hand.filter(x => cat(this.units[x]) === 'Animal' && card(this.units[x]).purchase_cost + this.special_cost(p, u) <= a.coins);
        if (!choices.length) return false;
        const x = this.pickOne('hand', this.desc(choices)); const nu = this.units[x]; a.coins -= card(nu).purchase_cost;
        this.zone(u.uid, 'hand'); this.zone(x, 'field', p); this.reset_unit(nu); nu.ready_at = a.own_turns + 1; nu.entered = this.turn; this.ctx.d = x; return true;
      }
      if (op === 'copy_grave' || op === 'copy_enemy' || op === 'copy_ally') {
        let choices;
        if (op === 'copy_grave') { choices = []; for (const pp of this.ps) for (const x of pp.grave) choices.push(this.units[x]); }
        else choices = this.field(op === 'copy_enemy' ? 1 - p : p).filter(x => x.uid !== u.uid && this.matches(x, s));
        if (!choices.length) return false;
        if (p !== this.active && op !== 'copy_grave') this.mark(u.uid, 'g', 10, p);
        else {
          const src = this.units[this.pickOne('copy', sortDesc(choices, x => [atk(x)]).map(x => x.uid))];
          this.mark(u.uid, 'replace_a', Math.min(30, atk(src)), p);
        }
        if (op === 'copy_grave') this.mark(u.uid, 'g', 5, p);
        return true;
      }
      if (op === 'grave_exchange') {
        const choices = a.grave.filter(x => cat(this.units[x]) !== 'Legendary'); const n = Math.min(2, choices.length, a.hand.length);
        if (!n) return false;
        const take = this.pick('grave', this.desc(choices), n);
        const give = this.pick('return', this.asc(a.hand), n);
        for (const x of give) this.zone(x, 'deck');
        for (const x of take) this.zone(x, 'hand');
        return true;
      }
      if (op === 'legend_search') {
        const choices = a.deck.filter(x => cat(this.units[x]) === 'Legendary');
        if (!choices.length) return false;
        this.zone(this.pickOne('search', this.desc(choices)), 'hand'); this.shuffle(a.deck);
        if (a.field.length === 1) this.mark(u.uid, 'a', 10, p);
        return true;
      }
      if (op === 'charmer_extra' || op === 'quartet_extra') {
        if (a.grant || a.extra || this.flag(u, 'noextra')) return false;
        if (op === 'quartet_extra') {
          if (hp(u) <= 5) return false;
          this.hurt(u.uid, 5);
        } else if (!(this.field(p).filter(x => cat(x) === 'Magic').length === 1 && this.field(1 - p).some(x => cat(x) === 'Magic'))) {
          const choices = a.hand.filter(x => cat(this.units[x]) === 'Magic');
          if (!choices.length) return false;
          this.zone(this.pickOne('discard', this.asc(choices)), 'grave');
        }
        a.grant = { uid: u.uid, penalty: 0 }; return true;
      }
      if (op === 'dodge') {
        if (!u.dodge || p === this.active) return false;
        this.ctx.cancel = true; return true;
      }
      if (op === 'bapple') {
        const n = new Set(this.field(p).filter(x => x.uid !== u.uid && !['Shadow', 'Legendary'].includes(cat(x))).map(cat)).size;
        const cin = a.grave.some(x => card(this.units[x]).name === 'Cinnamonster');
        if (!n && !cin) return false;
        this.mark(u.uid, 'a', Math.min(15, 5 * n), p);
        if (cin) { const ts = this.select(p, {}, u, true); if (ts.length) this.mark(ts[0].uid, 'ex', 5, p); }
        return true;
      }
      throw new Error('Not implemented op ' + op);
    }
    // ---- modifiers ----
    mod_ally(p, m) {
      if (p !== this.active) return this.units[this.ctx.d];
      const named = NAMES[m.paired_character || ''];
      const choices = this.field(p).filter(u => u.cid === named);
      let def;
      if (choices.length) def = choices[0];
      else { const u = this.units[this.ctx.a]; def = u && u.controller === p ? u : (this.field(p).length ? maxBy(this.field(p), atk) : undefined); }
      if (!def) return undefined;
      // Player choice of ally; default (first) is the reference engine's pick.
      const order = [def.uid].concat(sortDesc(this.field(p).filter(u => u.uid !== def.uid), u => [atk(u)]).map(u => u.uid));
      return this.units[this.pickOne('ally', order, { modifier: m.id })];
    }
    mod_mode(p, m) {
      const phase = this.ctx.phase || 'prepare'; const t = m.timing;
      if (p !== this.active) return ['Response', 'Either'].includes(t) && ['attack', 'mod'].includes(phase) && !this.ps[p].response;
      return (t === 'Action' && phase === 'prepare') || (['Attack', 'Either'].includes(t) && phase === 'attack') || (t === 'After attack' && phase === 'after');
    }
    play_mod(p, mid) {
      this.actor = p; this.decN = 0;
      const m = M[mid]; let a = this.ps[p]; const response = p !== this.active;
      if (!a.mhand.includes(mid) || m.cost > a.coins || !this.mod_mode(p, m)) return false;
      if (!response && a.modifier) return false;
      this.targets = new Set();
      if (!this.mod_effect(p, m)) return false;
      a = this.ps[p];
      a.coins -= m.cost; remove(a.mhand, mid);
      const key = p + ':' + mid;
      if (this.ctx.return_modifier) { delete this.ctx.return_modifier; a.mhand.push(mid); this.used_once_mod.push(key); }
      else a.mgrave.push(mid);
      if (response) a.response = true; else a.modifier = true;
      this.count(this.used, 'modifier:' + mid); this.changed++;
      this.note(`P${p + 1} plays ${m.name} (${m.cost})`); return true;
    }
    mod_effect(p, m, base_only = false) {
      const mid = m.id; let mech = m.mechanic; let a = this.ps[p]; const q = this.ps[1 - p];
      if (mech === 'bespoke') mech = null;
      let ally = this.mod_ally(p, m); let foe = this.units[this.ctx[p !== this.active ? 'a' : 'd']];
      if (foe && foe.controller === p) foe = undefined;
      if (!foe && this.field(1 - p).length) foe = minBy(this.field(1 - p), hp);
      // In Prepare the active player chooses the enemy; in a battle the participants are fixed.
      if (foe && p === this.active && (this.ctx.phase || 'prepare') === 'prepare') {
        const order = [foe.uid].concat(sortDesc(this.field(1 - p).filter(u => u.uid !== foe.uid), u => [-hp(u)]).map(u => u.uid));
        foe = this.units[this.pickOne('enemy', order, { modifier: m.id })];
      }
      const paired = NAMES[m.paired_character || ''];
      let bonus = !base_only && paired !== undefined && !!ally && ally.cid === paired;
      if (mech === 'scout' || mech === 'echo') bonus = !base_only && this.field(p).some(u => u.cid === paired);
      const self = this;
      const mark = (u, k, v, next = null, scope = null, end = null) => {
        if (next === null) next = m.timing === 'Action';
        if (u) self.mark(u.uid, k, v, p, next, scope, end, 'modifier');
      };
      const addbuff = (u, kw) => { if (u) self.buff(u, kw, p, null, 'modifier', null, m.timing === 'Action'); };
      const choose_other = u => {
        const order = sortDesc(self.field(p), x => [atk(x)]).filter(x => !u || x.uid !== u.uid).map(x => x.uid);
        return order.length ? self.units[self.pickOne('other', order)] : undefined;
      };
      if (mech) {
        if (!['scout', 'echo'].includes(mech) && !ally) return false;
        if (['guard', 'rescue', 'counter', 'evade', 'intercept'].includes(mech) && p === this.active) return false;
        if (['strike', 'pierce', 'break', 'hunt', 'rush', 'steal', 'pounce', 'rend', 'duplicate', 'feint'].includes(mech) && p !== this.active) return false;
        if (['guard', 'rescue', 'counter', 'evade', 'intercept', 'pierce', 'break', 'hunt', 'steal', 'pounce', 'rend', 'feint'].includes(mech) && !foe) return false;
        if (mech === 'guard') addbuff(ally, { g: bonus ? 15 : 5 });
        else if (mech === 'strike') addbuff(ally, { a: bonus ? 15 : 5 });
        else if (mech === 'pierce') { mark(foe, 'ex', bonus ? 10 : 5); if (bonus) mark(ally, 'a', 5); }
        else if (mech === 'rescue') { addbuff(ally, { g: 10 }); if (bonus) mark(ally, 'rescue', 'hand'); }
        else if (mech === 'counter') { mark(foe, 'ap', 5); if (bonus) mark(ally, 'g', 10); }
        else if (mech === 'rally') {
          this.buff(ally, { a: 5, g: 5 }, p, null, 'modifier');
          const other = choose_other(ally);
          if (bonus && other) this.buff(other, { a: 5, g: 5 }, p, null, 'modifier');
        } else if (mech === 'break') {
          const cands = sortDesc(foe.marks.filter(x => x.k === 'g'), x => [x.v]);
          if (cands.length) remove(foe.marks, cands[0]);
          if (bonus) mark(foe, 'ex', 10);
        } else if (mech === 'evade') { if (bonus) this.ctx.cancel = true; else mark(ally, 'g', 5); }
        else if (mech === 'suppress') {
          if (!foe) return false;
          mark(foe, 'silence', true, null, null, this.turn + 1);
          if (bonus) mark(foe, 'ex', 5, true);
        } else if (mech === 'scout') {
          if (!a.mdeck.length) return false;
          const top = a.mdeck.slice(0, 3); a.mdeck.splice(0, 3, ...sortDesc(top, x => [-M[x].cost]));
          if (bonus) {
            if (a.mdeck.length > 1) a.mdeck.push(a.mdeck.splice(Math.min(2, a.mdeck.length - 1), 1)[0]);
            const named = this.field(p).find(u => u.cid === paired); mark(named, 'g', 5, true);
          }
        } else if (mech === 'tax') {
          if (!foe) return false;
          mark(foe, 'tax', bonus ? 4 : 2, null, null, this.turn + 1);
        } else if (mech === 'intercept') {
          let choices = this.field(p).filter(u => u.uid !== this.ctx.d);
          if (!choices.length || this.ctx.redirected) return false;
          choices = sortDesc(choices, u => [u.cid === paired ? 1 : 0, hp(u) + this.guard_value(u, foe)]);
          ally = choices[0]; bonus = !base_only && ally.cid === paired;
          this.ctx.d = ally.uid; this.ctx.redirected = true;
          if (bonus) mark(ally, 'g', 10);
        } else if (mech === 'battery') {
          if (!this.eligible(p, ally, true)) return false;
          mark(ally, 'discount', bonus ? 4 : 2, null, null, this.turn);
        } else if (mech === 'ward') {
          const affected = (this.ctx.pending_targets || []).map(x => this.units[x]).filter(u => u.controller === p);
          if (!this.ctx.pending_mid || !affected.length) return false;
          ally = affected.find(u => u.cid === paired) || affected[0]; bonus = !base_only && ally.cid === paired;
          this.block_negative.add(ally.uid);
          if (bonus) { if (!this.ctx.block_control) this.ctx.block_control = []; this.ctx.block_control.push(ally.uid); }
        } else if (mech === 'hunt') { if (atk(foe) > atk(ally)) mark(ally, 'a', 10); if (bonus) mark(ally, 'g', 5); }
        else if (mech === 'rush') addbuff(ally, { a: bonus ? 10 : 5, g: bonus ? 5 : 0 });
        else if (mech === 'adapt') addbuff(ally, p === this.active ? { a: 10, g: bonus ? 5 : 0 } : { g: 10, a: bonus ? 5 : 0 });
        else if (mech === 'cleanse') { this.clean(ally); if (bonus) addbuff(ally, { a: 5, g: 5 }); }
        else if (mech === 'steal') {
          addbuff(ally, { g: 5 }); mark(foe, 'ex', 5);
          if (bonus) {
            const before = this.attack_value(foe, ally, false); mark(foe, 'ap', 5);
            const amount = before - this.attack_value(foe, ally, false); mark(ally, 'a', Math.max(0, amount));
          }
        } else if (mech === 'pounce') { if (!this.ctx.extra) mark(ally, 'a', 10); if (bonus) mark(foe, 'ex', 5); }
        else if (mech === 'puppet') {
          if (!foe) return false;
          mark(foe, 'ap', 5, true);
          if (bonus) mark(foe, 'silence', true, null, null, this.turn + 1);
        } else if (mech === 'relay') {
          const other = choose_other(ally);
          if (!other) return false;
          if (bonus) mark(other, 'a', 10, true);
          else { mark(ally, 'a', 5, true); mark(other, 'a', 5, true); }
        } else if (mech === 'echo') {
          const choices = a.grave.filter(x => cat(this.units[x]) !== 'Legendary');
          if (!choices.length) return false;
          this.zone(this.pickOne('grave', this.desc(choices)), 'hand');
          if (bonus) mark(this.field(p).find(u => u.cid === paired), 'g', 10, true);
        } else if (mech === 'rend') mark(foe, 'ex', bonus && cat(foe) === 'Animal' ? 15 : 10);
        else if (mech === 'entomb') {
          if (!foe) return false;
          mark(foe, 'stun', true, null, null, this.turn + 1);
          if (bonus) mark(foe, 'silence', true, null, null, this.turn + 1);
        } else if (mech === 'duplicate') {
          const other = choose_other(ally);
          if (!other) return false;
          mark(ally, 'replace_a', Math.min(bonus ? 30 : 20, Math.max(...this.field(p).filter(u => u.uid !== ally.uid).map(atk))));
        } else if (mech === 'feint') {
          mark(ally, 'a', 5);
          const choices = this.field(1 - p).filter(u => u.uid !== this.ctx.d);
          if (bonus && choices.length && !this.ctx.redirected) { this.ctx.d = this.pickOne('redirect', sortDesc(choices, u => [-hp(u)]).map(u => u.uid)); this.ctx.redirected = true; }
        } else throw new Error('Not implemented mechanic ' + mech);
      } else if (/^M0(0[1-9]|1[0-3])$/.test(mid)) {
        if (mid === 'M001') {
          if (!base_only && this.field(p).some(u => card(u).name === 'The Fogmaster')) {
            const choices = []; for (const pp of this.ps) for (const x of pp.grave) if (cat(this.units[x]) === 'Animal') choices.push(x);
            if (choices.length) { this.zone(this.pickOne('anygrave', this.desc(choices)), 'hand'); bonus = true; }
            else if (!this.control(p, foe, 'Animal')) return false;
          } else if (!this.control(p, foe, 'Animal')) return false;
        } else if (mid === 'M002') {
          if (!foe) return false;
          mark(foe, p === this.active ? 'ex' : 'ap', p === this.active ? 5 : 10);
        } else if (mid === 'M003') {
          const choices = this.field(p).filter(u => this.eligible(p, u) && !this.flag(u, 'noextra'));
          const enemies = this.field(1 - p).filter(u => card(u).printed_defense > atk(u));
          if (!choices.length || !enemies.length || a.grant) return false;
          ally = this.units[this.pickOne('attacker', sortDesc(choices, atk_ => [atk(atk_)]).map(u => u.uid))];
          bonus = !base_only && card(ally).name === 'The Mighty Fistnikov';
          foe = bonus ? minBy(enemies, hp) : this.units[this.pickOne('enemy', sortDesc(enemies, u => [-hp(u)]).map(u => u.uid))];
          a.grant = { uid: ally.uid, penalty: 0, target: bonus ? null : foe.uid };
        } else if (mid === 'M004') {
          if (!ally || a.field.length >= 5) return false;
          const choices = a.hand.filter(x => atk(this.units[x]) < atk(ally) / 2 && card(this.units[x]).purchase_cost + m.cost <= a.coins);
          if (!choices.length) return false;
          const uid = this.pickOne('hand', this.desc(choices)); const u = this.units[uid]; a.coins -= card(u).purchase_cost;
          this.zone(uid, 'field', p); this.reset_unit(u); u.ready_override = true; u.entered = this.turn; u.ready_at = a.own_turns + 1;
          if (!base_only) {
            const value = card(ally).name === 'Lord Berryon' ? 10 : cat(ally) === 'Shadow' ? 5 : 0;
            if (value) { mark(u, 'a', value, true); bonus = true; }
          }
        } else if (mid === 'M005' || mid === 'M011') {
          if (!this.ctx.pending_mid) return false;
          this.ctx.cancel_mod = true;
          if (!base_only) {
            if (mid === 'M005' && this.field(p).some(u => card(u).name === 'Bronzeback') && !this.used_once_mod.includes(p + ':' + mid)) { this.ctx.return_modifier = true; bonus = true; }
            else if (mid === 'M005' && this.field(p).some(u => cat(u) === 'Human')) { if (ally) { mark(ally, 'g', 5, true); bonus = true; } }
            else if (mid === 'M011' && this.field(p).some(u => card(u).name === 'Rattlebeak') && foe) { mark(foe, 'ex', 5, true); bonus = true; }
          }
        } else if (mid === 'M006') {
          if (!q.field.length) return false;
          for (const id of this.pick('enemy', this.desc(q.field.slice()), 2)) addbuff(this.units[id], { ap: 5, ex: 5 });
          if (!base_only && a.grave.some(x => card(this.units[x]).name === 'King Yumhamum') && ally) { mark(ally, 'a', 5, true); mark(ally, 'g', 5, true); bonus = true; }
        } else if (mid === 'M007') {
          if (!ally || !foe || p !== this.active) return false;
          mark(foe, 'ex', 10); mark(ally, 'g', !base_only && cat(ally) === 'Human' ? 15 : 10);
          if (!base_only && cat(ally) === 'Human') bonus = true;
          if (!base_only && card(ally).name === 'The Triple Threat') {
            const before = this.attack_value(foe, ally, false); mark(foe, 'ap', 10); mark(ally, 'a', Math.max(0, before - this.attack_value(foe, ally, false))); bonus = true;
          }
        } else if (mid === 'M008' || mid === 'M013') {
          const ready = mid === 'M013' || (!base_only && this.field(p).some(u => card(u).name === 'Barron BonBoo'));
          if (!this.control(p, foe, null, ready, mid === 'M013' ? 5 : 10)) return false;
          if (mid === 'M008' && ready) bonus = true;
        } else if (mid === 'M009') {
          if (!ally || p !== this.active) return false;
          mark(ally, 'a', Math.min(15, atk(ally)));
          if (!base_only && cat(ally) === 'Animal') { mark(ally, 'g', 5); bonus = true; }
        } else if (mid === 'M010') {
          const choices = a.grave.filter(x => cat(this.units[x]) !== 'Legendary');
          if (a.field.length >= 5 || !choices.length) return false;
          const uid = this.pickOne('grave', this.desc(choices)); const u = this.units[uid];
          this.zone(uid, 'field', p); this.reset_unit(u); u.temporary = 'revive'; u.ready_override = true; u.ready_at = a.own_turns + 1; u.entered = this.turn;
          if (!base_only) {
            const val = this.field(p).some(x => card(x).name === 'Count Chalko') ? 10 : this.field(p).some(x => cat(x) === 'Magic') ? 5 : 0;
            if (val) { mark(u, 'a', val, true); bonus = true; }
          }
        } else if (mid === 'M012') {
          const choices = [];
          for (const pp of this.ps) for (const x of pp.mgrave) if (m.copy_whitelist.includes(x) && !choices.includes(x)) choices.push(x);
          const trials = [];
          for (const x of choices) {
            const t = this.clone(); t.forced = null; t.recording = null;   // inner evaluation, no player prompts
            if (t.mod_effect(p, M[x], true)) trials.push([x, t]);
          }
          if (!trials.length) return false;
          // Default = best-scoring copy (Python max: first highest); the player may choose another.
          const order = sortDesc(trials, tr => [tr[1].score(p)]);
          const want = this.pickOne('copymod', order.map(tr => tr[0]));
          const best = order.find(tr => tr[0] === want)[1];
          const keep = { forced: this.forced, recording: this.recording, decisions: this.decisions, actor: this.actor, decN: this.decN };
          this.adopt(best); Object.assign(this, keep); a = this.ps[p];
          if (!base_only) {
            if (this.field(p).some(u => card(u).name === 'Brutess the Barbarian') && !this.used_once_mod.includes(p + ':' + mid)) { this.ctx.return_modifier = true; bonus = true; }
            else if (this.field(p).some(u => cat(u) === 'Animal')) {
              ally = this.mod_ally(p, m);
              if (ally) { mark(ally, 'a', 5, true); bonus = true; }
            }
          }
        }
      } else {
        const name = m.name;
        if (['Second Wind', 'Hold the Line', 'Cracked Guard', 'Dull the Edge', 'Borrowed Courage', 'Last Crumb', 'Mirror Plate', 'Empty Throne', 'Pocket Reserve'].includes(name)) {
          if (!ally) return false;
          if (['Hold the Line', 'Dull the Edge'].includes(name) && p === this.active) return false;
          if (['Cracked Guard', 'Borrowed Courage', 'Mirror Plate', 'Empty Throne', 'Pocket Reserve'].includes(name) && p !== this.active) return false;
          if (name === 'Second Wind') addbuff(ally, { a: 5, g: 5 });
          else if (name === 'Hold the Line') mark(ally, 'g', 10);
          else if (name === 'Cracked Guard') { if (!foe) return false; mark(foe, 'ex', 10); }
          else if (name === 'Dull the Edge') { if (!foe) return false; mark(foe, 'ap', 10); }
          else if (name === 'Borrowed Courage') { if (foe && atk(ally) < atk(foe)) mark(ally, 'a', 10); }
          else if (name === 'Last Crumb') { if (a.field.length !== 1) return false; addbuff(ally, { a: 10, g: 10 }); }
          else if (name === 'Mirror Plate') { mark(ally, 'replace_a', Math.min(25, card(ally).printed_defense)); mark(ally, 'block_bonus', true); }
          else if (name === 'Empty Throne') { if (foe && cat(foe) === 'Legendary' && cat(ally) !== 'Legendary') mark(ally, 'a', 10); }
          else if (name === 'Pocket Reserve') { mark(ally, 'a', 5); mark(ally, 'pocket', mid); }
        } else if (name === 'Smoke and Crumbs' || name === 'Ceasefire Bell') {
          if (p === this.active || !this.ctx.a) return false;
          this.ctx.cancel = true;
          if (name === 'Ceasefire Bell') this.ps[this.active].cease = true;
        } else if (name === 'Emergency Patch') {
          if (!ally || !this.clean(ally)) return false;
        } else if (name === 'Switchboard') {
          const choices = this.field(p).filter(u => u.uid !== this.ctx.d);
          if (p === this.active || !choices.length || this.ctx.redirected) return false;
          this.ctx.d = maxBy(choices, u => hp(u) + this.guard_value(u, foe)).uid; this.ctx.redirected = true;
        } else if (name === 'Open Ledger') {
          if (!a.mdeck.length) return false;
          a.mdeck.splice(0, 3, ...sortDesc(a.mdeck.slice(0, 3), x => [-M[x].cost]));
        } else if (name === 'Cold Snap') {
          if (!foe) return false;
          mark(foe, 'block_bonus', true, true);
        } else if (name === 'Clean Slate') {
          if (!ally || !foe) return false;
          for (const u of [ally, foe]) u.marks = u.marks.filter(x => !['a', 'ap', 'g', 'ex', 'replace_a', 'set_a', 'block_bonus', 'ignore_g', 'ignore_ex'].includes(x.k));
        } else if (name === 'Sealed Envelope') {
          if (!ally) return false;
          mark(ally, 'sealed', true, false);
        } else if (name === 'Loose Change') a.discount = 4;
        else if (name === 'Overtime') {
          const uid = this.ctx.last_attacker; const u = this.units[uid];
          if (!a.normal || a.grant || a.extra || !u || !a.field.includes(uid) || this.flag(u, 'noextra')) return false;
          a.grant = { uid, penalty: 10 };
        } else if (name === 'Lockout') {
          if (!foe) return false;
          mark(foe, 'silence', true, null, null, this.turn + 1);
        } else if (name === 'Return Receipt') {
          if (p === this.active || !ally) return false;
          mark(ally, 'rescue', 'hand');
        } else if (name === 'Crosswind') {
          const us = [ally, foe].filter(Boolean).sort((x, y) => (x.controller === p) - (y.controller === p));
          let found = false;
          for (const u of us) {
            const vs = u.marks.filter(x => x.k === 'a');
            if (vs.length) { remove(u.marks, maxBy(vs, x => x.v)); found = true; break; }
          }
          if (!found) return false;
        } else if (name === 'Shared Shelter') {
          if (!this.field(p).length) return false;
          for (const id of this.pick('ally', sortDesc(this.field(p), u => [-hp(u)]).map(u => u.uid), 2)) mark(this.units[id], 'g', 5, true);
        } else if (name === 'Honest Duel') {
          if (!ally || !foe) return false;
          mark(ally, 'honest', true); mark(foe, 'honest', true); this.ctx.honest = true;
        } else throw new Error('Not implemented modifier ' + mid + ' ' + name);
      }
      if (bonus) this.count(this.used_bonus, mid);
      return true;
    }
    control(p, u, catName = null, ready = false, penalty = 0) {
      if (!u || u.controller === p || cat(u) === 'Legendary' || (catName && cat(u) !== catName) || this.ps[p].field.length >= 5) return false;
      this.targets.add(u.uid);
      if (this.blocked.has(u.uid) || (this.ctx.block_control || []).includes(u.uid)) return true;
      remove(this.ps[u.controller].field, u.uid); this.ps[p].field.push(u.uid); u.controller = p; u.temporary = 'control'; u.ready_override = ready;
      if (ready) this.mark(u.uid, 'ap', penalty, p, false, null, this.turn);
      else this.mark(u.uid, 'no_attack', true, p, false, null, this.turn);
      this.changed++; return true;
    }
    score(p) {
      const val = q => {
        const a = this.ps[q]; let v = a.coins * 0.32 + a.field.reduce((s, x) => s + this.unit_value(x), 0);
        v += a.hand.reduce((s, x) => s + Math.min(8, atk(this.units[x]) * 0.12 + card(this.units[x]).printed_defense * 0.08), 0);
        v += a.mhand.length * 1.3 + a.deck.length * 0.2 + a.mdeck.length * 0.1;
        for (const u of this.field(q)) {
          const own_planned = u.uid === this.ctx.a && q === this.active && this.ctx.phase === 'prepare';
          const foe_planned = u.uid === this.ctx.d && q !== this.active && this.ctx.phase === 'prepare';
          v += this.amount(u, 'a') * 0.55 + this.amount(u, 'g') * (own_planned ? 0 : 0.25) - this.amount(u, 'ap') * (foe_planned ? 0 : 0.45) - this.amount(u, 'ex') * 0.35;
          v -= this.flag(u, 'stun') ? 8 : 0; v -= this.flag(u, 'silence') ? 3 : 0;
        }
        if (a.grant) v += 5;
        return v;
      };
      return val(p) - val(1 - p);
    }
    // ---- attacks ----
    attackGate(p, extra = false) {
      const a = this.ps[p];
      const opening = this.bothSkipOpening ? a.own_turns <= 1 : (this.turn === 1 && p === 0);
      return !(a.cease || opening || (extra && (!a.grant || a.extra || !a.normal)) || (!extra && a.normal));
    }
    attackers(p, extra = false) {
      if (!this.attackGate(p, extra)) return [];
      const a = this.ps[p];
      let us = this.field(p).filter(u => this.eligible(p, u));
      if (extra) us = us.filter(u => (!a.grant.uid || u.uid === a.grant.uid) && !this.flag(u, 'noextra'));
      return us;
    }
    defenders(p, extra = false) {
      const a = this.ps[p];
      return this.field(1 - p).filter(v => !(extra && a.grant && a.grant.target && a.grant.target !== v.uid));
    }
    attack_candidates(p, extra = false) {
      const out = [];
      for (const u of this.attackers(p, extra)) for (const v of this.defenders(p, extra)) {
        const damage = this.damage_prediction(u, v); const points = Math.min(hp(v), damage) + (damage >= hp(v) ? 0.7 * atk(v) + 5 : 0);
        if (damage > 0) out.push([points, u.uid, v.uid]);
      }
      return out.sort((x, y) => y[0] - x[0] || (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0) || (y[2] > x[2] ? 1 : y[2] < x[2] ? -1 : 0));
    }
    planned(p) {
      const cs = this.attack_candidates(p);
      if (cs.length) return { a: cs[0][1], d: cs[0][2] };
      const own = this.field(p); const foe = this.field(1 - p);
      return { a: own.length ? maxBy(own, atk).uid : null, d: foe.length ? minBy(foe, hp).uid : null };
    }
    trial(p, kind, key) {
      const g = this.clone();
      const ok = kind === 'special' ? g.activate(p, key) : g.play_mod(p, key);
      return ok ? g : null;
    }
    projected(p) {
      const g = this.clone();
      if (g.ctx.a && g.ctx.d) g.resolve_battle();
      return g.score(p);
    }
    best(p, phase, kinds = ['special', 'modifier']) {
      this.ctx.phase = phase;
      const baseline = p !== this.active && phase === 'attack' ? this.projected(p) : this.score(p);
      const choices = [];
      if (kinds.includes('special')) for (const u of this.field(p)) choices.push(['special', u.uid]);
      if (kinds.includes('modifier')) for (const m of this.ps[p].mhand) choices.push(['modifier', m]);
      let best = null; let gain = 0.01;
      for (const [kind, key] of choices) {
        const t = this.trial(p, kind, key);
        if (t === null) continue;
        let value;
        if (p !== this.active && phase === 'attack') value = t.projected(p) - baseline;
        else if (phase === 'attack') { const old = this.clone(); old.resolve_battle(); const nw = t.clone(); nw.resolve_battle(); value = nw.score(p) - old.score(p); }
        else value = t.score(p) - baseline;
        if (value > gain) { best = [kind, key, t]; gain = value; }
      }
      return best;
    }
    /* Legal plays for player p in the current ctx/phase: [{kind,key,state}] */
    legalPlays(p, kinds = ['special', 'modifier']) {
      const out = [];
      if (kinds.includes('special')) for (const u of this.field(p)) { const t = this.trial(p, 'special', u.uid); if (t) out.push({ kind: 'special', key: u.uid, state: t }); }
      if (kinds.includes('modifier')) for (const m of this.ps[p].mhand) { const t = this.trial(p, 'modifier', m); if (t) out.push({ kind: 'modifier', key: m, state: t }); }
      return out;
    }
    /* Step 1 of modifier_with_response: returns options for the defender. */
    modifierOptions(p, mid, prepared = null) {
      let before = this.clone(); let t = prepared !== null ? prepared : this.trial(p, 'modifier', mid);
      if (t === null) return null;
      const defender = 1 - p;
      const targets = new Set(t.targets);
      const sealed = [...targets].filter(x => before.units[x] && before.units[x].controller === defender && before.flag(before.units[x], 'sealed'));
      if (targets.size === 1 && sealed.length) {
        sealed.forEach(x => before.blocked.add(x));
        t = before.trial(p, 'modifier', mid);
        if (t === null) return null;
        for (const uid of sealed) t.units[uid].marks = t.units[uid].marks.filter(x => x.k !== 'sealed');
        t.blocked.clear();
      }
      const options = [];
      if (!before.ps[defender].response) {
        const responsebase = before.clone(); Object.assign(responsebase.ctx, { phase: 'mod', pending_mid: mid, pending_targets: [...targets] });
        const affected = [...targets].filter(x => before.units[x] && before.units[x].controller === defender);
        if (affected.length) responsebase.ctx.d = affected[0];
        const candidates = responsebase.ps[defender].mhand.map(m => ['modifier', m]).concat(responsebase.field(defender).map(u => ['special', u.uid]));
        for (const [kind, key] of candidates) {
          const rt = responsebase.trial(defender, kind, key);
          if (rt === null) continue;
          let candidate;
          if (rt.ctx.cancel_mod) {
            rt.ps[p].coins -= M[mid].cost; remove(rt.ps[p].mhand, mid); rt.ps[p].mgrave.push(mid); rt.ps[p].modifier = true; rt.count(rt.used, 'modifier:' + mid);
            rt.note(`P${p + 1}'s ${M[mid].name} is canceled`);
            candidate = rt;
          } else {
            for (const [k, v] of Object.entries(before.ctx)) if (k !== 'pending_mid' && k !== 'pending_targets') rt.ctx[k] = v;
            candidate = rt.trial(p, 'modifier', mid);
            if (candidate === null) continue;
          }
          options.push({ kind, key, state: candidate, score: candidate.score(defender) });
        }
      }
      return { before, t, defender, options, value: t.score(defender) };
    }
    /* Step 2: adopt the chosen outcome (option state or the unanswered t). */
    finishModifier(before, t) {
      t.blocked.clear(); t.block_negative.clear(); delete t.ctx.block_control; delete t.ctx.pending_mid; delete t.ctx.pending_targets;
      if (!t.ctx.redirected) for (const k of ['a', 'd']) if (before.ctx[k]) t.ctx[k] = before.ctx[k];
      this.adopt(t); return true;
    }
    botPickModifierResponse(res) {
      let best = null; let value = res.value;
      for (const o of res.options) if (o.score > value + 0.01) { best = o; value = o.score; }
      return best;
    }
    modifier_with_response(p, mid, prepared = null) {
      const res = this.modifierOptions(p, mid, prepared);
      if (!res) return false;
      const pick = this.botPickModifierResponse(res);
      return this.finishModifier(res.before, pick ? pick.state : res.t);
    }
    resolve_battle() {
      const auid = this.ctx.a; const duid = this.ctx.d; const p = this.active;
      if (!auid || !duid) return;
      const a = this.units[auid]; const d = this.units[duid];
      if (this.ctx.cancel) {
        for (const u of [a, d]) u.marks = u.marks.filter(m => !(COMBAT_K.has(m.k) && !m.next && !m.end_expire && m.battle === this.battle_n));
        this.note('The attack is canceled'); return;
      }
      if (!this.ps[p].field.includes(auid) || !this.ps[1 - p].field.includes(duid)) return;
      const damage = this.damage_prediction(a, d); const will_kill = damage >= hp(d);
      const counter = this.flag(d, 'counter', a, false) || 0;
      const drawkill = this.flag(a, 'onkill_draw', d, true); const extrakill = this.flag(a, 'onkill_extra', d, true);
      const pocket = this.flag(a, 'pocket', d, true); const returns = this.flag(a, 'return_after', d, true); const afterap = this.flag(a, 'after_ap', d, true);
      const stop = this.flag(a, 'no_attack_after', d, true);
      this.lastBattle = { a: auid, d: duid, damage, killed: will_kill };
      this.note(`${card(a).name} attacks ${card(d).name} for ${damage}`);
      this.hurt(d.uid, damage); this.count(this.used, 'battle');
      if (this.ps[d.controller].field.includes(d.uid) && hp(d) > 0) {
        if (d.cid === 189) d.dodge = true;
        if (counter) { this.note(`${card(d).name} counters for ${counter}`); this.hurt(a.uid, counter); }
      }
      if (will_kill && this.ps[p].field.includes(a.uid)) {
        if (drawkill) this.draw(p);
        if (extrakill && !this.ps[p].grant && !this.ps[p].extra) this.ps[p].grant = { uid: a.uid, penalty: 10 };
      }
      if (!this.ps[p].field.includes(a.uid) && pocket) {
        if (this.ps[p].mgrave.includes(pocket)) { remove(this.ps[p].mgrave, pocket); this.ps[p].mhand.push(pocket); }
      }
      for (const [u, other, role] of [[a, d, true], [d, a, false]]) {
        const consume = m => {
          const scope = m.scope || {};
          const any_battle = scope.consume_any && (!has(scope, 'attacking') || scope.attacking === role);
          return COMBAT_K.has(m.k) && !m.end_expire && (this.relevant(m, u, other, role) || any_battle);
        };
        u.marks = u.marks.filter(m => !consume(m));
      }
      if (afterap && this.ps[p].field.includes(a.uid)) this.mark(a.uid, 'ap', afterap, p, false, null, this.turn);
      if (stop && this.ps[p].field.includes(a.uid)) this.mark(a.uid, 'no_attack', true, p, false, null, this.turn);
      if (returns && this.ps[p].field.includes(a.uid)) this.zone(a.uid, 'hand');
    }
    declareAttack(p, auid, duid, extra = false) {
      const a = this.ps[p];
      if (extra) { a.extra = true; if (a.grant.penalty) this.mark(auid, 'ap', a.grant.penalty, p, false, null, this.turn); }
      else a.normal = true;
      this.units[auid].attacked = this.turn; this.units[auid].charge = false;
      this.battle_n++; this.ctx = { a: auid, d: duid, phase: 'attack', extra };
      this.note(`P${p + 1} declares ${card(this.units[auid]).name} → ${card(this.units[duid]).name}${extra ? ' (extra attack)' : ''}`);
    }
    finishBattle(p) {
      const auid = this.ctx.a;
      this.resolve_battle(); this.ctx.last_attacker = auid; this.ctx.phase = 'after';
    }
    // ---- turn steps ----
    startTurn() {
      this.turn++; const p = (this.turn - 1) % 2; this.active = p; const a = this.ps[p]; a.own_turns++;
      a.special = a.modifier = a.bought = a.normal = a.extra = a.cease = false; a.grant = null; a.discount = 0; this.ps[1 - p].response = false;
      for (const u of Object.values(this.units)) u.marks = u.marks.filter(m => m.expires > this.turn || (m.expires === this.turn && m.end_expire));
      this.turnStart = this.changed; this.startedField = a.field.slice();
      this.draw(p); this.draw(p, 1, true);
      this.ctx = { phase: 'prepare' };
      return p;
    }
    endTurn() {
      const p = this.active; const a = this.ps[p];
      for (const uid of a.field.slice()) {
        const u = this.units[uid];
        if (u.temporary === 'revive') this.zone(uid, 'grave');
        else if (u.temporary === 'control') {
          remove(a.field, uid); this.ps[u.owner].field.push(uid); u.controller = u.owner; u.temporary = ''; u.ready_override = false;
        } else if (u.cid === 140 && this.startedField.includes(uid) && u.attacked !== this.turn) u.charge = true;
      }
      for (const pp of this.ps) for (const uid of pp.field) this.units[uid].marks = this.units[uid].marks.filter(m => !(m.end_expire && m.expires <= this.turn));
      while (a.hand.length > 5) this.zone(minBy(a.hand, x => this.unit_value(x)), 'grave');
      while (a.mhand.length > 5) { let bi = 0; a.mhand.forEach((x, i) => { if (M[x].cost > M[a.mhand[bi]].cost) bi = i; }); a.mgrave.push(a.mhand.splice(bi, 1)[0]); }
      this.ctx = {};
      if (!a.field.length) { this.over = true; this.winner = this.ps[1 - p].field.length ? 1 - p : null; this.reason = 'empty_field'; }
      this.stall = this.changed !== this.turnStart ? 0 : this.stall + 1;
      if (!this.over && this.stall >= 4) { this.over = true; this.reason = 'stalled'; }
      if (!this.over && this.turn >= 120) { this.over = true; this.reason = 'turn_cap'; }
    }
    /* Bot plays its whole main phase synchronously. respond(defenderSeat, kind, info) lets
       the human answer: returns chosen option or null. Used only in headless self-play. */
    botAttack(p, extra) {
      const choices = this.attack_candidates(p, extra);
      if (!choices.length) return false;
      this.declareAttack(p, choices[0][1], choices[0][2], extra);
      return true;
    }
    take_turn() { // headless self-play (both seats bots) - mirrors full_engine.take_turn
      const p = this.startTurn(); const a = this.ps[p];
      const choices = this.buy_candidates(p);
      if (choices.length) this.buy(p, maxBy(choices, uid => this.unit_value(uid) / Math.max(1, card(this.units[uid]).purchase_cost)));
      for (let i = 0; i < 2 && this.effects; i++) {
        this.ctx = Object.assign(this.planned(p), { phase: 'prepare' });
        const best = this.best(p, 'prepare');
        if (!best) break;
        if (best[0] === 'modifier') this.modifier_with_response(p, best[1], best[2]); else this.adopt(best[2]);
      }
      for (const extra of [false, true]) {
        if (extra && !this.ps[p].grant) break;
        if (!this.botAttack(p, extra)) continue;
        if (this.effects && !this.ps[p].special) { const r = this.best(p, 'attack', ['special']); if (r) this.adopt(r[2]); }
        if (this.effects && !this.ps[p].modifier) { const r = this.best(p, 'attack', ['modifier']); if (r) this.modifier_with_response(p, r[1], r[2]); }
        if (this.effects && !this.ps[1 - p].response && !this.ctx.cancel) { const r = this.best(1 - p, 'attack'); if (r) this.adopt(r[2]); }
        this.finishBattle(p);
        if (this.effects && !extra && !this.ps[p].modifier) { const r = this.best(p, 'after', ['modifier']); if (r) this.modifier_with_response(p, r[1], r[2]); }
      }
      this.endTurn(); this.invariants();
    }
    invariants() {
      const positions = [];
      this.ps.forEach((a, p) => {
        if (!(a.coins >= 0 && a.coins <= 100)) throw new Error('coins ' + p + ' ' + a.coins);
        if (a.field.length > 5) throw new Error('field size');
        if (a.field.filter(x => cat(this.units[x]) === 'Legendary').length > 1) throw new Error('legendary');
        for (const z of ['deck', 'hand', 'field', 'grave']) positions.push(...a[z]);
        if (a.mdeck.length + a.mhand.length + a.mgrave.length !== 12) throw new Error('modifier count ' + p);
        for (const uid of a.field) { const u = this.units[uid]; if (u.controller !== p || hp(u) <= 0) throw new Error('field unit ' + uid); }
      });
      if (positions.length !== Object.keys(this.units).length || new Set(positions).size !== positions.length) throw new Error('unit positions');
    }
    run() { while (!this.over) this.take_turn(); return this; }
  }

  // ---- deck helpers ----
  function randomDeck(rng, exclude) {
    exclude = exclude || [];
    const pool = C.map((c, i) => i).filter(i => !exclude.includes(i));
    const shuffled = pool.map(i => [rng(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const out = []; let leg = 0;
    for (const i of shuffled) {
      if (out.length >= 12) break;
      if (C[i].category === 'Legendary') { if (leg >= 2) continue; leg++; }
      out.push(i);
    }
    const mods = D.modifiers.map(m => m.id).map(id => [rng(), id]).sort((a, b) => a[0] - b[0]).slice(0, 12).map(x => x[1]);
    return { chars: out, mods };
  }
  function starterDeck() {
    const chars = []; const mods = [];
    for (const p of D.starter) { chars.push(...p.characters.map(id => CID[id])); mods.push(...p.modifiers); }
    return { chars, mods };
  }

  window.CC = { Game, C, M, S, CID, card, hp, atk, cat, randomDeck, starterDeck };
})();
