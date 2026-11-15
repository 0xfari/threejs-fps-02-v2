// The match: rounds, money, the bomb and the win conditions. No three.js here —
// this module only owns numbers and the state machine, so the loop in main.js
// stays readable. It reports everything it decides as events the HUD and the
// loop drain each frame. It also keeps the match's story: first blood, damage
// dealt, and a round-by-round W/L history for the final screen.
export const FIRST_TO = 5;
export const MAX_ROUNDS = 9;
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3.5;
export const DEFUSE_SECONDS = 5;
export const BOMB_SECONDS = 30;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;

export function createGame(random) {
  const events = [];
  const state = {
    phase: 'menu', // menu | buy | playing | roundEnd | matchEnd
    round: 0,
    scoreAtk: 0,
    scoreDef: 0,
    money: 800,
    timer: 0,
    phaseTimer: 0,
    bomb: { state: 'player', site: null, timer: 0, progress: 0, pos: null, carrierBot: null },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0, headshots: 0, damageDealt: 0 },
    plan: { atkSite: 'A', defPosts: {} },
    roundHistory: [], // 'W' | 'L' per finished round, attacker POV
    firstBlood: null, // { killer, victim } of the round's first kill
  };

  function planRound() {
    const atkSite = random() < 0.5 ? 'A' : 'B';
    const other = atkSite === 'A' ? 'B' : 'A';
    const siteNode = atkSite === 'A' ? 9 : 14;
    const otherNode = other === 'A' ? 9 : 14;
    // Defenders post up: one on the called site, one mid, one on the other site.
    state.plan = {
      atkSite,
      defPosts: {
        'def-0': siteNode,
        'def-1': 3,
        'def-2': otherNode,
      },
    };
    return state.plan;
  }

  function newMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.scoreAtk = 0;
    state.scoreDef = 0;
    state.money = 800;
    state.stats = { kills: 0, deaths: 0, plants: 0, defuses: 0, headshots: 0, damageDealt: 0 };
    state.matchWinner = null;
    state.roundWinner = null;
    state.roundReason = '';
    state.roundHistory = [];
    state.firstBlood = null;
    state.bomb = { state: 'player', site: null, timer: 0, progress: 0, pos: null, carrierBot: null };
    planRound();
    state.timer = BUY_SECONDS;
    state.phaseTimer = 0;
    events.push({ type: 'matchStart', plan: state.plan });
  }

  function newRound() {
    state.round += 1;
    state.phase = 'buy';
    state.roundWinner = null;
    state.roundReason = '';
    state.firstBlood = null;
    state.bomb = { state: 'player', site: null, timer: 0, progress: 0, pos: null, carrierBot: null };
    planRound();
    state.timer = BUY_SECONDS;
    state.phaseTimer = 0;
    events.push({ type: 'roundStart', round: state.round, plan: state.plan });
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.roundWinner = winner;
    state.roundReason = reason;
    if (winner === 'atk') state.scoreAtk += 1;
    else state.scoreDef += 1;
    const playerWon = winner === 'atk';
    state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
    state.roundHistory.push(playerWon ? 'W' : 'L');
    state.phase = 'roundEnd';
    state.phaseTimer = 0;
    state.timer = 4;
    events.push({ type: 'roundEnd', winner, reason, scoreAtk: state.scoreAtk, scoreDef: state.scoreDef, money: state.money });
    if (state.scoreAtk >= FIRST_TO || state.scoreDef >= FIRST_TO || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.scoreAtk > state.scoreDef ? 'atk' : 'def';
      state.phase = 'matchEnd';
      events.push({ type: 'matchEnd', winner: state.matchWinner, scoreAtk: state.scoreAtk, scoreDef: state.scoreDef });
    }
  }

  function registerKill(killer, victim, headshot, weaponId, amount = 0) {
    if (killer && killer.isPlayer) {
      state.money += KILL_REWARD;
      state.stats.kills += 1;
      state.stats.damageDealt += amount;
      if (headshot) state.stats.headshots += 1;
    }
    if (victim && victim.isPlayer) state.stats.deaths += 1;
    if (!state.firstBlood) {
      state.firstBlood = { killer: killer ? killer.name : 'World', victim: victim ? victim.name : '?' };
      events.push({ type: 'firstBlood', killer: state.firstBlood.killer, victim: state.firstBlood.victim });
    }
    events.push({ type: 'kill', killer: killer ? killer.name : 'World', victim: victim ? victim.name : '?', headshot, weapon: weaponId, killerTeam: killer ? killer.team : null });
  }

  function update(dt, facts) {
    state.phaseTimer += dt;
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'playing';
        state.timer = ROUND_SECONDS;
        events.push({ type: 'roundLive' });
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0 && state.phase !== 'matchEnd') newRound();
      return;
    }
    if (state.phase !== 'playing') return;

    state.timer -= dt;
    const bomb = state.bomb;

    // Bomb pickup: a dropped bomb returns to the first attacker who walks over it.
    if (bomb.state === 'dropped' && bomb.pos) {
      if (facts.playerAlive && facts.playerPos) {
        const d = Math.hypot(facts.playerPos.x - bomb.pos.x, facts.playerPos.z - bomb.pos.z);
        if (d < 1.4) {
          bomb.state = 'player';
          bomb.pos = null;
          bomb.carrierBot = null;
          events.push({ type: 'bombPickup', by: 'player' });
        }
      }
      if (bomb.state === 'dropped' && facts.carrierBot && facts.carrierBot.alive) {
        const b = facts.carrierBot;
        const d = Math.hypot(b.position.x - bomb.pos.x, b.position.z - bomb.pos.z);
        if (d < 1.4) {
          bomb.state = 'bot';
          bomb.pos = null;
          bomb.carrierBot = b;
          events.push({ type: 'bombPickup', by: b.name });
        }
      }
    }

    // Planting: the carrier holds still inside a site.
    const planting =
      (bomb.state === 'player' && facts.playerPlanting) ||
      (bomb.state === 'bot' && facts.botPlanting);
    if ((bomb.state === 'player' || bomb.state === 'bot') && planting) {
      bomb.progress += dt;
      if (bomb.progress >= PLANT_SECONDS) {
        const site = bomb.state === 'player' ? facts.playerSite : facts.botSite;
        bomb.state = 'planted';
        bomb.site = site;
        bomb.timer = BOMB_SECONDS;
        bomb.progress = 0;
        if (facts.planterIsPlayer) state.stats.plants += 1;
        events.push({ type: 'bombPlanted', site });
      }
    } else if (bomb.state === 'player' || bomb.state === 'bot') {
      bomb.progress = Math.max(0, bomb.progress - dt * 2);
    }

    // The planted bomb ticks down; defenders can defuse it by holding still.
    if (bomb.state === 'planted') {
      bomb.timer -= dt;
      const defusing = facts.playerDefusing || facts.botDefusing;
      if (defusing) {
        bomb.progress += dt;
        if (bomb.progress >= DEFUSE_SECONDS) {
          bomb.state = 'defused';
          if (facts.defuserIsPlayer) state.stats.defuses += 1;
          events.push({ type: 'bombDefused' });
          endRound('def', 'Bomb defused');
          return;
        }
      } else {
        bomb.progress = Math.max(0, bomb.progress - dt * 2);
      }
      if (bomb.timer <= 0) {
        bomb.state = 'exploded';
        events.push({ type: 'bombExploded' });
        endRound('atk', 'Bomb detonated');
        return;
      }
    }

    // Elimination and time.
    if (facts.defAlive === 0) {
      endRound('atk', bomb.state === 'planted' ? 'Site cleared — bomb detonates' : 'Enemy team eliminated');
      return;
    }
    if (facts.atkAlive === 0) {
      if (bomb.state === 'planted') {
        // Attackers are dead but the bomb still ticks: the round is decided
        // by the bomb now, so wait for it instead of ending here.
      } else {
        endRound('def', 'Attackers eliminated');
        return;
      }
    }
    if (state.timer <= 0 && bomb.state !== 'planted') {
      endRound('def', 'Time expired — site held');
    }
  }

  return {
    state,
    events,
    newMatch,
    newRound,
    endRound,
    registerKill,
    update,
    drainEvents() {
      return events.splice(0, events.length);
    },
    buy(cost) {
      if (state.money < cost || state.phase !== 'buy') return false;
      state.money -= cost;
      return true;
    },
  };
}
