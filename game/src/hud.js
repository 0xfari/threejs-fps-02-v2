// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, the
// kill feed, the buy menu, the minimap and the overlay screens. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
// Two extra readouts ride along: a scope vignette for the LW-50, a damage
// direction arc that points at whoever just shot the player, and round pips
// that show the match's W/L history at a glance.
import { WEAPONS, GRENADE_PRICE, SMOKE_PRICE, ARMOR_PRICE } from './weapons.js';

const BUY_ITEMS = [
  { id: 'VK9', key: '1' },
  { id: 'AR77', key: '2' },
  { id: 'LW50', key: '3' },
  { id: 'grenade', key: '4', name: 'HE Grenade', price: GRENADE_PRICE, desc: 'Hold G to throw. Blast damage in a radius.' },
  { id: 'smoke', key: '5', name: 'Smoke Grenade', price: SMOKE_PRICE, desc: 'Hold H to throw. Blocks sight for 12 seconds.' },
  { id: 'armor', key: '6', name: 'Kevlar Vest', price: ARMOR_PRICE, desc: 'Halves incoming damage for the round.' },
];

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    overlayStats: $('overlay-stats'), play: $('play'),
    health: $('health-value'), healthBar: $('health-bar'), armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    grenades: $('grenade-count'), money: $('money-value'),
    timer: $('timer-value'), timerBox: $('timer'),
    scoreAtk: $('score-atk'), scoreDef: $('score-def'), roundLabel: $('round-label'),
    aliveAtk: $('alive-atk'), aliveDef: $('alive-def'),
    killfeed: $('killfeed'), hitmarker: $('hitmarker'), crosshair: $('crosshair'),
    damage: $('damage'), banner: $('banner'), bombStatus: $('bomb-status'),
    buyMenu: $('buy-menu'), buyMoney: $('buy-money'), buyItems: $('buy-items'),
    minimap: $('minimap'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    plantLabel: $('plant-label'), hint: $('hint'),
    scope: $('scope-overlay'), damageDir: $('damage-dir'), roundPips: $('round-pips'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let damageDirTimer = 0;
  let buyOpen = false;
  let onBuyHandler = null;
  let onPlayHandler = null;
  const last = { hp: -1, armor: -1, mag: -1, reserve: -1, money: -1, timer: '', atk: -1, def: -1, round: -1, nades: -1, smokes: -1, pips: '' };

  // Build the buy menu once.
  for (const item of BUY_ITEMS) {
    const def = WEAPONS[item.id];
    const name = def ? def.name : item.name;
    const price = def ? def.price : item.price;
    const desc = def ? def.desc : item.desc;
    const row = document.createElement('div');
    row.className = 'buy-item';
    row.dataset.id = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${name}</span><span class="buy-desc">${desc}</span><span class="buy-price">$${price}</span>`;
    row.addEventListener('click', () => { if (onBuyHandler) onBuyHandler(item.id); });
    els.buyItems.appendChild(row);
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp, armor) {
      if (hp === last.hp && armor === last.armor) return;
      last.hp = hp;
      last.armor = armor;
      els.health.textContent = String(Math.max(0, Math.ceil(hp)));
      els.healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      els.healthBar.classList.toggle('low', hp <= 30);
      els.armor.textContent = armor ? 'KEVLAR' : '';
    },
    setAmmo(mag, reserve, grenades, smokes = 0) {
      if (mag === last.mag && reserve === last.reserve && grenades === last.nades && smokes === last.smokes) return;
      last.mag = mag;
      last.reserve = reserve;
      last.nades = grenades;
      last.smokes = smokes;
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammo.classList.toggle('empty', mag === 0);
      els.grenades.textContent = `${grenades > 0 ? `◉ ${grenades}` : ''}${smokes > 0 ? ` ☁ ${smokes}` : ''}`;
    },
    setMoney(value) {
      if (value === last.money) return;
      last.money = value;
      els.money.textContent = `$${value}`;
      els.buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, planted) {
      const text = fmtTime(seconds);
      if (text === last.timer) return;
      last.timer = text;
      els.timer.textContent = text;
      els.timerBox.classList.toggle('planted', !!planted);
    },
    setScore(atk, def, round) {
      if (atk === last.atk && def === last.def && round === last.round) return;
      last.atk = atk;
      last.def = def;
      last.round = round;
      els.scoreAtk.textContent = String(atk);
      els.scoreDef.textContent = String(def);
      els.roundLabel.textContent = `ROUND ${round} · FIRST TO 5`;
    },
    setAlive(atk, def) {
      els.aliveAtk.textContent = '●'.repeat(Math.max(0, atk));
      els.aliveDef.textContent = '●'.repeat(Math.max(0, def));
    },
    setRoundHistory(history) {
      const text = history.join(' ');
      if (text === last.pips) return;
      last.pips = text;
      els.roundPips.textContent = text;
      els.roundPips.classList.toggle('has', history.length > 0);
    },
    setSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    setScope(scoped) {
      els.scope.hidden = !scoped;
      els.crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    },
    showDamageDir(angleRad) {
      // angleRad: 0 = ahead, positive = to the player's right. Rotate the arc.
      els.damageDir.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      els.damageDir.classList.add('on');
      clearTimeout(damageDirTimer);
      damageDirTimer = setTimeout(() => els.damageDir.classList.remove('on'), 650);
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      els.damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => els.damage.classList.remove('on'), 220);
    },
    banner(text, holdMs = 2600) {
      els.banner.textContent = text;
      els.banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('on'), holdMs);
    },
    hideBanner() {
      els.banner.classList.remove('on');
      els.banner.textContent = '';
      clearTimeout(bannerTimer);
    },
    addKill(killer, victim, headshot, weapon) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      row.innerHTML = `<span class="kf-killer">${killer}</span><span class="kf-weapon">${headshot ? '◎ ' : ''}${weapon || ''}</span><span class="kf-victim">${victim}</span>`;
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    setBomb(text) {
      els.bombStatus.textContent = text || '';
      els.bombStatus.hidden = !text;
    },
    setPlant(label, progress) {
      if (!label) {
        els.plantBar.hidden = true;
        return;
      }
      els.plantBar.hidden = false;
      els.plantLabel.textContent = label;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setHint(text) {
      els.hint.textContent = text || '';
      els.hint.hidden = !text;
    },
    showOverlay(mode, data = {}) {
      const titles = {
        menu: ['EMBERLINE', 'A tactical FPS in a dusk yard. Plant the spike at A or B, or eliminate the other team. First to 5 rounds takes the match.'],
        paused: ['Paused', 'Click to resume.'],
        roundEnd: [data.title || 'Round over', data.copy || ''],
        matchEnd: [data.title || 'Match over', data.copy || ''],
      };
      const [title, copy] = titles[mode] || titles.menu;
      els.overlayTitle.textContent = title;
      els.overlayCopy.textContent = copy;
      els.overlayStats.innerHTML = data.stats || '';
      els.play.textContent = mode === 'menu' ? 'Click to play' : mode === 'matchEnd' ? 'Play again' : mode === 'roundEnd' ? 'Next round' : 'Click to resume';
      els.overlay.hidden = false;
      els.crosshair.style.display = 'none';
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
      els.crosshair.style.display = '';
    },
    onPlay(handler) {
      onPlayHandler = handler;
      els.play.addEventListener('click', () => { if (onPlayHandler) onPlayHandler(); });
    },
    openBuy(money, owned) {
      buyOpen = true;
      els.buyMenu.hidden = false;
      els.buyMoney.textContent = `$${money}`;
      for (const row of els.buyItems.children) {
        const id = row.dataset.id;
        const def = WEAPONS[id];
        const price = def ? def.price : (id === 'grenade' ? GRENADE_PRICE : id === 'smoke' ? SMOKE_PRICE : ARMOR_PRICE);
        const isOwned = id === 'grenade' ? owned.grenades > 0 : id === 'smoke' ? owned.smokes > 0 : id === 'armor' ? owned.armor : owned[id];
        row.classList.toggle('owned', !!isOwned);
        row.classList.toggle('cant', money < price && !isOwned);
      }
    },
    closeBuy() {
      buyOpen = false;
      els.buyMenu.hidden = true;
    },
    isBuyOpen() { return buyOpen; },
    onBuy(handler) { onBuyHandler = handler; },
    buyKey(id) {
      if (onBuyHandler) onBuyHandler(id);
    },
    drawMinimap(player, bots, bomb) {
      const b = world.bounds;
      const W = els.minimap.width;
      const H = els.minimap.height;
      const sx = (x) => ((x - b.minX) / (b.maxX - b.minX)) * W;
      const sz = (z) => ((z - b.minZ) / (b.maxZ - b.minZ)) * H;
      mapCtx.clearRect(0, 0, W, H);
      mapCtx.fillStyle = 'rgba(20,18,16,0.85)';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.fillStyle = '#6b5a44';
      for (const r of world.map2d) mapCtx.fillRect(sx(r.x), sz(r.z), Math.max(1, (r.w / (b.maxX - b.minX)) * W), Math.max(1, (r.d / (b.maxZ - b.minZ)) * H));
      for (const [key, site] of Object.entries(world.sites)) {
        mapCtx.fillStyle = '#ff7a1a';
        mapCtx.font = 'bold 11px system-ui, sans-serif';
        mapCtx.textAlign = 'center';
        mapCtx.fillText(key, sx(site.center.x), sz(site.center.z) + 4);
      }
      const dot = (x, z, color, r = 3) => {
        mapCtx.fillStyle = color;
        mapCtx.beginPath();
        mapCtx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
        mapCtx.fill();
      };
      if (bomb && bomb.state === 'dropped' && bomb.pos) dot(bomb.pos.x, bomb.pos.z, '#ff7a1a', 4);
      if (bomb && bomb.state === 'planted') dot(world.sites[bomb.site].center.x, world.sites[bomb.site].center.z, '#ff5340', 5);
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 'atk') dot(bot.position.x, bot.position.z, '#57b6ff');
        else if (bot.spottedUntil > 0) dot(bot.position.x, bot.position.z, '#ff5340');
      }
      // Player arrow.
      mapCtx.save();
      mapCtx.translate(sx(player.position.x), sz(player.position.z));
      mapCtx.rotate(-player.yaw);
      mapCtx.fillStyle = '#ece5d8';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4, 5);
      mapCtx.lineTo(-4, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
