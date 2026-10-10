/* Lux Test lab — add-on for lux.html
   Adds a "Test" tab: start timed fragrance tests, log impressions over time,
   pull the weather for your city, rate, and keep a permanent average per fragrance.
   Data is stored inside Lux's own state (S.tt), so Lux backups include it. */
(function () {
  'use strict';
  try {
    if (typeof S === 'undefined' || typeof render !== 'function' || typeof openModal !== 'function') return;
  } catch (e) {
    return;
  }

  /* ---------- constants ---------- */
  const H = 36e5;
  const SPOTS = [
    ['LW', 'Left wrist'],
    ['RW', 'Right wrist'],
    ['LA', 'Left upper arm'],
    ['RA', 'Right upper arm']
  ];
  const TAGS = [
    'Vanilla',
    'Amber',
    'Woody',
    'Musk',
    'Tobacco',
    'Citrus',
    'Spicy',
    'Powdery',
    'Sweet',
    'Smoky',
    'Leather',
    'Fresh',
    'Aquatic',
    'Green',
    'Fruity',
    'Incense',
    'Oud',
    'Ambroxan',
    'Coffee',
    'Rose',
    'Iris',
    'Patchouli',
    'Vetiver',
    'Soapy',
    'Boozy',
    'Metallic',
    'Salty',
    'Creamy'
  ];
  const QUICK = ['Vanilla', 'Amber', 'Woody', 'Musk', 'Tobacco', 'Citrus', 'Spicy', 'Powdery'];
  const CRIT = [
    ['longevity', 'Longevity'],
    ['sillage', 'Sillage'],
    ['skin', 'Skin scent']
  ];

  /* ---------- state helpers ---------- */
  function tt() {
    if (!S.tt) S.tt = { sessions: [], city: null, venues: [] };
    if (!S.tt.sessions) S.tt.sessions = [];
    if (!S.tt.venues) S.tt.venues = [];
    return S.tt;
  }
  const mean = a => {
    a = a.filter(Number.isFinite);
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };
  const r1 = n => Math.round(n * 10) / 10;
  function relStr(ms) {
    const m = Math.max(0, Math.round(ms / 60000)),
      h = Math.floor(m / 60),
      mm = m % 60;
    return h ? h + 'h ' + String(mm).padStart(2, '0') + 'm' : mm + 'm';
  }
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dshort = t => new Date(t).toLocaleDateString(I18N.loc, { day: 'numeric', month: 'short', year: 'numeric' });
  function toLocalInput(t) {
    const d = new Date(t);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  const fromLocalInput = s => (s ? new Date(s).getTime() : Date.now());
  const isDone = s => s.status === 'done';
  const score = s => (s.rating ? mean([s.rating.longevity, s.rating.sillage, s.rating.skin]) : null);
  /* Average of several ratings of one test, per criterion (value only where it was given). */
  function avgRating(list) {
    const o = {};
    ['longevity', 'sillage', 'skin', 'value'].forEach(k => {
      const v = mean(list.map(r => (+r[k] > 0 ? +r[k] : NaN)));
      o[k] = v == null ? 0 : r1(v);
    });
    return o;
  }
  const elapsed = s => (s.fadedAt || Date.now()) - s.t0;
  const pv = s =>
    (s.pid && byId(s.pid)) || bottleOf({ key: keyOf(s) }) || { id: 't' + s.id, name: s.name, brand: s.brand, fam: s.fam || '' };
  const spotsText = s => (s.spots || []).map(c => (SPOTS.find(x => x[0] === c) || [0, c])[1]).join(' + ');
  /* What was sprayed in a test, for the rating sheet and a repeat start on the same day. */
  const sprayLine = s =>
    [spotsText(s), s.sprays + (s.sprays === 1 ? ' spray' : ' sprays'), 'sprayed ' + clock(s.t0) + ' (' + relStr(Date.now() - s.t0) + ' ago)']
      .filter(Boolean)
      .join(' \u00b7 ');
  function spotsLabel(s) {
    if (Date.now() - s.t0 > 24 * H || !s.spots || !s.spots.length) return '';
    return s.spots.map(c => (SPOTS.find(x => x[0] === c) || [0, c])[1]).join(' + ');
  }
  const WX = c =>
    c == null
      ? ''
      : c === 0
        ? 'Clear'
        : c <= 2
          ? 'Partly cloudy'
          : c === 3
            ? 'Overcast'
            : c <= 48
              ? 'Fog'
              : c <= 57
                ? 'Drizzle'
                : c <= 67
                  ? 'Rain'
                  : c <= 77
                    ? 'Snow'
                    : c <= 82
                      ? 'Showers'
                      : c <= 86
                        ? 'Snow showers'
                        : 'Thunderstorm';
  const wxLine = w =>
    w
      ? [w.temp != null ? w.temp + '°' : '', w.hum != null ? w.hum + '% humidity' : '', WX(w.code), w.city]
          .filter(Boolean)
          .join(' · ')
      : '';
  const bucket = t => (t == null ? null : t < 8 ? 'Cold' : t <= 18 ? 'Mild' : 'Warm');
  const activeList = () =>
    tt()
      .sessions.filter(s => !isDone(s))
      .sort((a, b) => b.t0 - a.t0);
  const refresh = () => {
    if (ui.tab === 'test') render();
  };
  const closeAll = () => closeModal();

  /* ---------- grouping and stats ---------- */
  /* Tests are grouped by fragrance and house, so tests of a deleted bottle and of the same fragrance
   added again later (a new bottle, a new id) share one entry and one average. */
  function keyOf(s) {
    const p = s.pid && byId(s.pid);
    return 'n:' + norm(((p ? p.brand : s.brand) || '') + ' ' + (p ? p.name : s.name));
  }
  /* The bottle that shows a tested fragrance: the linked one, else one of the same fragrance in the
   cabinet or on the wishlist (so its photo shows here too). */
  function bottleOf(g) {
    const L = S.perfumes.filter(p => keyOf({ pid: p.id }) === g.key),
      b = (g.pid && byId(g.pid)) || L.find(p => !notOwn(p.shelf)) || L[0] || null,
      gid = 'g' + g.key;
    /* a photo added in the Test lab shows until the bottle has its own */
    if (PHOTOS[gid] && (!b || !PHOTOS[b.id])) return { id: gid, name: g.name, brand: g.brand, fam: g.fam || (b && b.fam) || '' };
    return b;
  }
  function groups() {
    const map = new Map();
    tt().sessions.forEach(s => {
      const k = keyOf(s);
      let g = map.get(k);
      if (!g) {
        g = { key: k, pid: null, name: s.name, brand: s.brand, fam: s.fam || '', sessions: [] };
        map.set(k, g);
      }
      g.sessions.push(s);
      if (s.pid) {
        const p = byId(s.pid);
        if (p) {
          g.pid = p.id;
          g.name = p.name;
          g.brand = p.brand;
          g.fam = p.fam;
        }
      } /* link to a bottle that still exists */
    });
    return [...map.values()].map(g => {
      g.done = g.sessions.filter(isDone).sort((a, b) => b.t0 - a.t0);
      g.avg = mean(g.done.map(score));
      g.crit = {};
      CRIT.concat([['value', 'Value']]).forEach(
        ([k]) => (g.crit[k] = mean(g.done.map(s => (s.rating && s.rating[k] > 0 ? s.rating[k] : NaN))))
      );
      g.hours = mean(g.done.map(s => (s.fadedAt ? (s.fadedAt - s.t0) / H : NaN)));
      g.last = Math.max(...g.sessions.map(s => s.t0));
      g.buy = g.done.length ? g.done[0].wouldBuy : null;
      g.price = (
        g.sessions
          .slice()
          .sort((a, b) => b.t0 - a.t0)
          .find(s => s.price != null) || {}
      ).price;
      return g;
    });
  }
  /* Rated fragrances, best first; Share (image, text) and the tests CSV in index.html use it. */
  /* Season from your own tests: the temperature band where the fragrance scored best (null without weather). */
  function tempSeason(g) {
    const b = {};
    g.done.forEach(s => {
      const k = bucket(s.weather && s.weather.temp);
      if (k) (b[k] = b[k] || []).push(score(s));
    });
    const best = Object.keys(b).sort((x, y) => mean(b[y]) - mean(b[x]))[0];
    return best ? { Cold: 'Autumn & winter', Mild: 'Spring & autumn', Warm: 'Summer' }[best] : null;
  }
  window.LuxTT = {
    ranked: () =>
      groups()
        .filter(g => g.done.length)
        .sort((a, b) => b.avg - a.avg),
    season: tempSeason
  };
  function condStats(g) {
    const out = {};
    g.done.forEach(s => {
      const b = bucket(s.weather && s.weather.temp);
      if (b) (out[b] = out[b] || []).push(score(s));
    });
    return ['Cold', 'Mild', 'Warm']
      .map(b => (out[b] ? b + ' ' + r1(mean(out[b])) + ' (' + out[b].length + ')' : null))
      .filter(Boolean);
  }
  function tagCounts(g) {
    const c = {};
    g.sessions.forEach(s => (s.notes || []).forEach(n => (n.tags || []).forEach(t => (c[t] = (c[t] || 0) + 1))));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }

  /* ---------- weather (Open-Meteo, no key) ---------- */
  async function jget(url) {
    const ctl = new AbortController(),
      to = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw 0;
      return await r.json();
    } finally {
      clearTimeout(to);
    }
  }
  async function geocode(q) {
    try {
      const j = await jget(
        'https://geocoding-api.open-meteo.com/v1/search?name=' +
          encodeURIComponent(q) +
          '&count=5&language=en&format=json'
      );
      return (j.results || []).map(r => ({
        label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        name: r.name,
        lat: r.latitude,
        lon: r.longitude
      }));
    } catch (e) {
      return null;
    }
  }
  async function getWeather(city, t) {
    if (!city) return null;
    try {
      const ageH = (Date.now() - t) / H,
        base =
          'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon + '&timezone=auto';
      if (ageH < 1.5) {
        const j = await jget(base + '&current=temperature_2m,relative_humidity_2m,weather_code');
        const c = j.current;
        if (!c) return null;
        return {
          city: city.name || city.label,
          temp: Math.round(c.temperature_2m),
          hum: Math.round(c.relative_humidity_2m),
          code: c.weather_code,
          at: Date.now()
        };
      }
      if (ageH > 92 * 24) return null;
      const past = Math.min(92, Math.ceil(ageH / 24) + 1);
      const j = await jget(
        base + '&hourly=temperature_2m,relative_humidity_2m,weather_code&past_days=' + past + '&forecast_days=1'
      );
      const off = (j.utc_offset_seconds || 0) * 1000;
      let best = -1,
        bd = 1e18;
      (j.hourly.time || []).forEach((ts, i) => {
        const d = Math.abs(Date.parse(ts + 'Z') - off - t);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best < 0 || j.hourly.temperature_2m[best] == null) return null;
      return {
        city: city.name || city.label,
        temp: Math.round(j.hourly.temperature_2m[best]),
        hum: Math.round(j.hourly.relative_humidity_2m[best]),
        code: j.hourly.weather_code[best],
        at: Date.now()
      };
    } catch (e) {
      return null;
    }
  }
  async function attachWeather(s) {
    const w = await getWeather(tt().city, s.t0);
    if (w) {
      s.weather = w;
      save();
      if (ui.tab === 'test' && $('#modal').hidden) render();
    } else toast('Weather not available. You can enter it by hand in the test details.');
  }

  /* ---------- radar ---------- */
  function radar(axes) {
    const n = axes.length;
    if (n < 3) return '';
    const R = 62,
      cx = 100,
      cy = 88;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const poly = f =>
      axes
        .map((_, i) =>
          pt(i, R * f)
            .map(x => x.toFixed(1))
            .join(',')
        )
        .join(' ');
    let g = [1 / 3, 2 / 3, 1]
      .map(f => '<polygon points="' + poly(f) + '" fill="none" stroke="var(--line2)" stroke-width="1"/>')
      .join('');
    axes.forEach((_, i) => {
      const p = pt(i, R);
      g +=
        '<line x1="' +
        cx +
        '" y1="' +
        cy +
        '" x2="' +
        p[0].toFixed(1) +
        '" y2="' +
        p[1].toFixed(1) +
        '" stroke="var(--line)"/>';
    });
    g +=
      '<polygon points="' +
      axes
        .map((a, i) =>
          pt(i, R * clamp(a.v / 10, 0, 1))
            .map(x => x.toFixed(1))
            .join(',')
        )
        .join(' ') +
      '" fill="var(--gold)" fill-opacity=".28" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>';
    axes.forEach((a, i) => {
      const p = pt(i, R * clamp(a.v / 10, 0, 1)),
        q = pt(i, R + 15),
        c = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
      g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="var(--gold)"/>';
      g +=
        '<text x="' +
        q[0].toFixed(1) +
        '" y="' +
        (q[1] + 3).toFixed(1) +
        '" text-anchor="' +
        (c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle') +
        '" font-size="10" fill="var(--tx2)" font-family="var(--sans)">' +
        esc(a.l) +
        ' ' +
        r1(a.v) +
        '</text>';
    });
    return '<svg viewBox="-34 0 268 178" class="tt-radar" role="img" aria-label="Performance radar">' + g + '</svg>';
  }

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
.nb{position:relative}
.nb.has-live::after{content:"";position:absolute;top:8px;right:10px;width:8px;height:8px;border-radius:50%;background:var(--gold)}
.tt-act{display:flex;flex-direction:column;gap:14px}
.tt-top{display:flex;gap:16px;align-items:flex-start}
.tt-bt{flex:none;width:64px}.tt-bt .bt{width:64px;height:102px;margin:0}
.tt-id{flex:1;min-width:0}.tt-id h3{margin-bottom:2px}
.tt-clock{text-align:right;flex:none}
.tt-clock b{display:block;font:500 30px/1 var(--serif);color:var(--gold2)}
.tt-clock span{font-size:12px;color:var(--tx3)}
.tt-spot{display:inline-block;margin-top:8px;padding:4px 11px;border:1px solid var(--line2);border-radius:999px;font-size:12.5px;color:var(--tx2)}
.tt-quick{display:flex;gap:7px;flex-wrap:wrap}
.tt-quick .chip{padding:6px 13px;font-size:13px}
.tt-last{font-size:13.5px;color:var(--tx2);border-left:2px solid var(--gold);padding-left:10px}
.tt-wx{font-size:13px;color:var(--tx3)}
.tt-g{display:flex;gap:16px;align-items:center;padding:14px 4px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:12px}
.tt-g:hover{background:var(--glass)}
.tt-g .th{flex:none;width:34px;height:54px}.tt-g .th .bt{width:34px;height:54px;margin:0;filter:none}
.tt-g .mid{flex:1;min-width:0}
.tt-g .t1{font:600 18px/1.15 var(--serif)}.tt-g .t2{font-size:12.5px;color:var(--tx3)}
.tt-bars{display:flex;gap:4px;margin-top:7px}.tt-bars i{flex:1;height:4px;border-radius:4px;background:var(--line);overflow:hidden;position:relative}
.tt-bars i b{position:absolute;left:0;top:0;bottom:0;background:var(--gold)}
.tt-score{flex:none;text-align:right;font:500 32px/1 var(--serif);color:var(--gold2)}
.tt-score small{display:block;font:500 11px var(--sans);color:var(--tx3);margin-top:3px}
.tt-pick{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border:1px solid var(--line2);border-radius:12px;background:var(--bg2)}
.tt-pick small{color:var(--tx3)}.tt-pick button{color:var(--gold2);font-size:13.5px}
.tt-chk{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--tx2);margin:2px 0 14px}
.tt-chk input{width:20px;height:20px;flex:none;margin-top:1px}
.tt-radar{width:100%;max-width:330px;display:block;margin:6px auto}
.tt-note{display:flex;gap:12px;padding:10px 2px;border-bottom:1px solid var(--line);font-size:14px}
.tt-note .rt{flex:none;width:62px;color:var(--gold2);font-weight:600;font-size:13px}
.tt-note .bd{flex:1;min-width:0}.tt-note small{color:var(--tx3);display:block}
.tt-note button{color:var(--tx3);font-size:18px;width:30px;height:30px;border-radius:50%}
.tt-note button:hover{color:var(--danger)}
.tt-rng{display:flex;align-items:center;gap:14px}.tt-rng input{flex:1}
.tt-rng b{font:500 26px/1 var(--serif);min-width:44px;text-align:right;color:var(--gold2)}
.tt-scr{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:14px;margin-top:8px;min-height:52px}
.tt-tl{width:100%;height:auto;display:block}
.tt-kv{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
.tt-kv span:first-child{color:var(--tx3)}
.tt-res button{display:block;width:100%;text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:14px}
.tt-res button:hover{background:var(--glass);color:var(--gold2)}
.tt-sec{margin:26px 0 12px;display:flex;justify-content:space-between;align-items:baseline}
`;
  document.head.appendChild(css);

  /* ---------- main view ---------- */
  function activeCard(s) {
    const p = pv(s),
      last = (s.notes || []).slice(-1)[0],
      sp = spotsLabel(s);
    const done = !!s.fadedAt;
    return `<div class="card tt-act"><div class="tt-top"><div class="tt-bt">${bt(p, 1)}</div>
  <div class="tt-id"><h3>${esc(s.name)}</h3><div class="muted" style="font-size:13px">${esc(s.brand)}${s.venue ? ' \u00b7 ' + esc(s.venue) : ''}</div>${sp ? `<span class="tt-spot">${esc(sp)}</span>` : ''}</div>
  <div class="tt-clock"><b class="tt-el" data-t0="${s.t0}" data-f="${s.fadedAt || ''}">+${relStr(elapsed(s))}</b><span>${s.sprays} ${s.sprays === 1 ? 'spray' : 'sprays'}${done ? ' \u00b7 faded' : ''}</span></div></div>
  ${s.weather ? `<div class="tt-wx">${esc(wxLine(s.weather))}</div>` : ''}
  ${done ? '' : `<div class="tt-quick">${QUICK.map(t => `<button class="chip" data-ta="qnote" data-id="${s.id}" data-tag="${t}">${t}</button>`).join('')}</div>`}
  ${last ? `<div class="tt-last">+${relStr(last.t - s.t0)} \u00b7 ${esc((last.tags || []).join(', ') || last.text || 'note')}</div>` : ''}
  <div class="acts"><button class="btn sm" data-ta="note" data-id="${s.id}">Add impression</button>${done ? '' : `<button class="btn ghost sm" data-ta="fade" data-id="${s.id}">Faded out</button>`}<button class="btn ghost sm" data-ta="rate" data-id="${s.id}">Rate</button><button class="btn ghost sm" data-ta="open" data-id="${s.id}">Details</button></div></div>`;
  }
  function groupRow(g) {
    const bars = CRIT.map(([k]) => `<i><b style="width:${g.crit[k] ? g.crit[k] * 10 : 0}%"></b></i>`).join('');
    return `<div class="tt-g" data-ta="group" data-k="${esc(g.key)}" role="button" tabindex="0"><div class="th">${bt(bottleOf(g) || { id: 'g' + g.key, name: g.name, brand: g.brand, fam: g.fam }, 0.7)}</div>
  <div class="mid"><div class="t1" data-raw>${esc(g.name)}</div><div class="t2">${esc(g.brand)} \u00b7 ${g.done.length} ${g.done.length === 1 ? 'test' : 'tests'}${g.buy === 'yes' ? ' \u00b7 would buy' : ''}</div><div class="tt-bars">${bars}</div></div>
  <div class="tt-score">${r1(g.avg)}<small>average</small></div></div>`;
  }
  let TQ = '',
    TSORT = 'best';
  function listHtml() {
    let gs = groups().filter(g => g.done.length);
    const q = norm(TQ).split(' ').filter(Boolean);
    if (q.length) gs = gs.filter(g => q.every(w => norm(g.brand + ' ' + g.name).includes(w)));
    if (TSORT === 'best') gs.sort((a, b) => b.avg - a.avg);
    else if (TSORT === 'recent') gs.sort((a, b) => b.last - a.last);
    else gs.sort((a, b) => (a.brand + a.name).localeCompare(b.brand + b.name));
    if (!gs.length)
      return `<p class="muted" style="padding:16px 4px">${TQ ? 'No tested fragrance matches.' : 'Nothing rated yet. Start a test, then rate it and it lands here with a permanent average.'}</p>`;
    return gs.map(groupRow).join('');
  }
  function testHtml() {
    const all = tt().sessions,
      gs = groups().filter(g => g.done.length),
      act = activeList();
    const doneS = all.filter(isDone),
      hours = mean(doneS.map(s => (s.fadedAt ? (s.fadedAt - s.t0) / H : NaN)));
    const kp = [
      [all.length, 'Tests'],
      [gs.length, 'Rated fragrances'],
      [doneS.length ? r1(mean(doneS.map(score))) : '\u2014', 'Average score'],
      [hours != null ? r1(hours) + ' h' : '\u2014', 'Average longevity'],
      [gs.filter(g => g.buy === 'yes').length, 'Would buy']
    ];
    return `<header class="vh"><div><h1>Test lab</h1><p class="sub2">${act.length ? act.length + ' running now' : 'Timed tests, impressions and a lasting average per fragrance'}</p></div><div class="acts">${gs.length ? '<button class="btn ghost" data-ta="tshare">Share results</button>' : ''}<button class="btn" data-ta="start">Start test</button></div></header>
  ${act.length ? act.map(activeCard).join('<div style="height:14px"></div>') : `<div class="card"><p class="muted">No test running. Tap Start test the moment you spray. The clock starts then, and every impression is stamped with the time since.</p></div>`}
  <div class="kpis" style="margin-top:22px">${kp.map(x => `<div class="kpi"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('')}</div>
  <div class="card"><div class="ch" style="margin-bottom:10px"><h3>Tested fragrances</h3><div class="acts" style="align-items:center">${gs.length > 1 ? '<button class="btn ghost sm" data-ta="cmp">Compare</button>' : ''}<select data-tc="tsort" style="width:auto"><option value="best"${TSORT === 'best' ? ' selected' : ''}>Best rated</option><option value="recent"${TSORT === 'recent' ? ' selected' : ''}>Most recent</option><option value="name"${TSORT === 'name' ? ' selected' : ''}>Name</option></select></div></div>
  <div class="fg"><input data-ti="tq" placeholder="Search tested fragrances" autocomplete="off" value="${esc(TQ)}"></div><div id="ttList">${listHtml()}</div></div>`;
  }

  /* ---------- render hook + nav ---------- */
  const _render = window.render;
  function afterRender() {
    const b = $('#nav .nb[data-t="test"]');
    if (b) b.classList.toggle('has-live', activeList().length > 0);
  }
  window.render = function () {
    if (ui.tab === 'test') {
      $('#view').innerHTML = testHtml();
      $$('#nav .nb').forEach(b => b.classList.toggle('on', b.dataset.t === 'test'));
      const own = owned();
      $('#railFoot').innerHTML = own.length + ' in the cabinet<br>' + fmt(LIB.length) + ' in the library';
    } else _render();
    afterRender();
  };
  (function addNav() {
    const nav = $('#nav');
    if (!nav || nav.querySelector('[data-t="test"]')) return;
    const j = nav.querySelector('[data-t="journal"]');
    (j || nav).insertAdjacentHTML(
      j ? 'afterend' : 'beforeend',
      '<button class="nb" data-act="tab" data-t="test"><svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/></svg>Test</button>'
    );
  })();
  setInterval(() => {
    if (ui.tab === 'test')
      $$('.tt-el').forEach(el => {
        const f = +el.dataset.f;
        el.textContent = '+' + relStr((f || Date.now()) - +el.dataset.t0);
      });
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ui.tab === 'test' && $('#modal').hidden) render();
  });

  /* ---------- start sheet ---------- */
  let ST = null;
  function newST(pre) {
    return Object.assign(
      {
        pid: null,
        name: '',
        brand: '',
        fam: '',
        q: '',
        spots: [],
        n: 2,
        venue: '',
        price: '',
        earlier: false,
        t: Date.now(),
        log: false,
        city: tt().city,
        showCity: !tt().city,
        cres: null,
        cmsg: ''
      },
      pre || {}
    );
  }
  /* A test of the picked fragrance on the chosen day: starting again continues it. */
  function sameDayTest() {
    if (!ST.name) return null;
    const day = dkey(ST.earlier ? ST.t : Date.now()),
      k = keyOf({ pid: ST.pid, name: ST.name, brand: ST.brand });
    return tt().sessions.find(x => dkey(x.t0) === day && keyOf(x) === k) || null;
  }
  function startHtml() {
    const c = ST.city,
      cab = ST.pid && byId(ST.pid),
      same = sameDayTest();
    if (same)
      return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Start a test</h2>
  <div class="fg" style="margin-top:16px"><label>Fragrance</label><div class="tt-pick"><span><b>${esc(ST.name)}</b> <small>${esc(ST.brand)}</small></span><button data-ta="tclear">Change</button></div></div>
  <div class="card" style="margin:0 0 16px;padding:14px 16px"><b>Already tested ${ST.earlier ? 'that day' : 'today'}</b><p class="muted" style="margin:6px 0 0;font-size:14px">${esc(sprayLine(same))}</p><p class="muted" style="margin:6px 0 0;font-size:13px">The same sprays continue: add impressions or rate it again. Use New spray in the test if you spray more.</p></div>
  <div class="fg"><label class="tt-chk" style="margin:0"><input type="checkbox" id="ts-early" data-tc="tearly"${ST.earlier ? ' checked' : ''}> I sprayed earlier</label>${ST.earlier ? `<input type="datetime-local" id="ts-t" value="${toLocalInput(ST.t)}" max="${toLocalInput(Date.now())}" style="margin-top:8px">` : ''}</div>
  <div class="foot"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-ta="tgo">Continue ${ST.earlier ? 'that' : 'today\u2019s'} test</button></div>`;
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Start a test</h2>
  <div class="fg" style="margin-top:16px"><label>Fragrance</label>${ST.name ? `<div class="tt-pick"><span><b>${esc(ST.name)}</b> <small>${esc(ST.brand)}${cab ? (notOwn(cab.shelf) ? ' \u00b7 on your wishlist' : ' \u00b7 in cabinet') : ''}</small></span><button data-ta="tclear">Change</button></div>` : `<input id="ts-q" data-ti="tsq" placeholder="Search your cabinet or library" autocomplete="off" value="${esc(ST.q)}"><div class="sugg" id="ts-sugg"></div>`}</div>
  <div class="fg"><span class="lb">Where on the body</span><div class="chips">${SPOTS.map(([k, l]) => `<button type="button" class="chip${ST.spots.includes(k) ? ' on' : ''}" data-ta="tspot" data-v="${k}">${l}</button>`).join('')}</div></div>
  <span class="lb" style="text-align:center">Sprays</span><div class="stepper" style="margin:8px 0 16px"><button data-ta="tstep" data-d="-1" aria-label="Fewer">\u2212</button><b id="ts-n" style="font-size:44px">${ST.n}</b><button data-ta="tstep" data-d="1" aria-label="More">+</button></div>
  <div class="g2"><div class="fg"><label for="ts-venue">Where tested</label><input id="ts-venue" list="tt-venues" placeholder="Shop or home" value="${esc(ST.venue)}" autocomplete="off"><datalist id="tt-venues">${tt()
    .venues.map(v => `<option value="${esc(v)}">`)
    .join('')}</datalist></div>
  <div class="fg"><label for="ts-price">Price (${esc(cur())}, optional)</label><input id="ts-price" type="number" min="0" step="0.5" value="${esc(ST.price)}"></div></div>
  <div class="fg"><label class="tt-chk" style="margin:0"><input type="checkbox" id="ts-early" data-tc="tearly"${ST.earlier ? ' checked' : ''}> I sprayed earlier</label>${ST.earlier ? `<input type="datetime-local" id="ts-t" value="${toLocalInput(ST.t)}" max="${toLocalInput(Date.now())}" style="margin-top:8px">` : ''}</div>
  <div class="fg"><span class="lb">Weather</span>${c && !ST.showCity ? `<div class="tt-pick"><span>Weather for <b>${esc(c.name || c.label)}</b></span><button data-ta="tcity">Change</button></div>` : `<div style="display:flex;gap:8px"><input id="ts-city" placeholder="City" autocomplete="off" value="${esc(c ? c.name || c.label : '')}"><button class="btn ghost sm" data-ta="tfind" style="flex:none">Find</button><button class="btn ghost sm" data-ta="tgeo" style="flex:none">Locate me</button></div><div class="tt-res" id="ts-cres">${cityRes()}</div>`}</div>
  ${cab && !notOwn(cab.shelf) ? `<label class="tt-chk"><input type="checkbox" id="ts-log"${ST.log ? ' checked' : ''}> Also log these sprays in my cabinet (updates the ml left and the Journal)</label>` : ''}
  <div class="foot"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-ta="tgo">Start now</button></div>`;
  }
  function cityRes() {
    if (ST.cmsg) return `<p class="muted" style="padding:8px 2px;font-size:13.5px">${esc(ST.cmsg)}</p>`;
    return (ST.cres || [])
      .map((r, i) => `<button type="button" data-ta="tpickcity" data-i="${i}">${esc(r.label)}</button>`)
      .join('');
  }
  function readST() {
    const g = id => {
      const e = $('#' + id);
      return e ? e.value : undefined;
    };
    const v = g('ts-venue');
    if (v !== undefined) ST.venue = v;
    const p = g('ts-price');
    if (p !== undefined) ST.price = p;
    const t = g('ts-t');
    if (t) ST.t = fromLocalInput(t);
    const l = $('#ts-log');
    if (l) ST.log = l.checked;
  }
  function paintST() {
    const p = $('#modal .panel');
    if (p) {
      const sc = p.scrollTop;
      p.innerHTML = startHtml();
      p.scrollTop = sc;
    }
  }
  function openStart(pre) {
    ST = newST(pre);
    MODAL = 'tt';
    openModal(startHtml());
  }
  function startSession() {
    readST();
    const typed = ($('#ts-q') || {}).value;
    if (!ST.name && typed && typed.trim()) {
      ST.name = typed.trim();
      ST.brand = '';
    }
    if (!ST.name) {
      toast('Pick a fragrance first');
      return;
    }
    /* One test per fragrance per day: starting it again the same day continues that test (same
     spraying); more impressions and ratings go into it. "New spray" adds sprays to it. */
    const day = dkey(ST.earlier ? ST.t : Date.now()),
      k = keyOf({ pid: ST.pid, name: ST.name, brand: ST.brand });
    const today = tt().sessions.find(x => dkey(x.t0) === day && keyOf(x) === k);
    if (today) {
      closeAll();
      render();
      toast('Continuing today\u2019s test of ' + today.name);
      openDetail(today.id);
      return;
    }
    const s = {
      id: uid(),
      pid: ST.pid,
      name: ST.name,
      brand: ST.brand,
      fam: ST.fam,
      t0: ST.earlier ? ST.t : Date.now(),
      sprays: ST.n,
      spots: ST.spots.slice(),
      venue: ST.venue.trim(),
      price: ST.price === '' ? null : +ST.price,
      weather: null,
      notes: [],
      fadedAt: null,
      status: 'active',
      rating: null,
      wouldBuy: null,
      comment: '',
      created: Date.now()
    };
    const d = tt();
    d.sessions.push(s);
    if (s.venue && !d.venues.includes(s.venue)) d.venues.push(s.venue);
    if (ST.city) d.city = ST.city;
    const cab = s.pid && byId(s.pid);
    if (ST.log && cab && !notOwn(cab.shelf)) {
      cab.ml = Math.max(0, Math.round((cab.ml - s.sprays / rateOf(cab)) * 10) / 10);
      cab.sprays = (cab.sprays || 0) + s.sprays;
      S.wears.push({ id: uid(), pid: cab.id, t: s.t0, n: s.sprays });
    }
    save();
    closeAll();
    ui.tab = 'test';
    render();
    toast('Test started');
    if (d.city) attachWeather(s);
  }

  /* ---------- impression sheet ---------- */
  let NT = null;
  function noteHtml() {
    const s = tt().sessions.find(x => x.id === NT.sid);
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Add impression</h2><p class="muted" style="margin:4px 0 16px">${esc(s.name)} \u00b7 +${relStr(NT.t - s.t0)} after spraying</p>
  <div class="fg"><span class="lb">What do you smell</span><div class="chips">${TAGS.map(t => `<button type="button" class="chip${NT.tags.includes(t) ? ' on' : ''}" data-ta="ntag" data-v="${t}">${t}</button>`).join('')}</div></div>
  <div class="fg"><span class="lb">How strong is it</span><div class="chips">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="chip${NT.str === n ? ' on' : ''}" data-ta="nstr" data-v="${n}">${n}</button>`).join('')}<span class="muted" style="align-self:center;font-size:12.5px">1 barely, 5 loud</span></div></div>
  <div class="fg"><label for="nt-text">Your words</label><input id="nt-text" placeholder="e.g. the vanilla just came out" value="${esc(NT.text)}" autocomplete="off"></div>
  <div class="fg"><label for="nt-t">Time</label><input type="datetime-local" id="nt-t" value="${toLocalInput(NT.t)}" min="${toLocalInput(s.t0)}"></div>
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="nsave">Save impression</button></div>`;
  }
  function openNote(sid) {
    NT = { sid, tags: [], str: null, text: '', t: Date.now() };
    MODAL = 'tt';
    openModal(noteHtml());
  }
  function paintNT() {
    const t = $('#nt-text'),
      tm = $('#nt-t');
    if (t) NT.text = t.value;
    if (tm && tm.value) NT.t = fromLocalInput(tm.value);
    const p = $('#modal .panel');
    if (p) {
      const sc = p.scrollTop;
      p.innerHTML = noteHtml();
      p.scrollTop = sc;
    }
  }

  /* ---------- fade sheet ---------- */
  function openFade(sid) {
    const s = tt().sessions.find(x => x.id === sid);
    MODAL = 'tt';
    openModal(`<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>When did it fade?</h2><p class="muted" style="margin:4px 0 16px">${esc(s.name)}. The moment you could no longer smell it on your skin. This sets the longevity.</p>
  <div class="fg"><input type="datetime-local" id="fd-t" value="${toLocalInput(Date.now())}" min="${toLocalInput(s.t0)}"></div>
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="fsave" data-id="${s.id}">Save</button></div>`);
  }

  /* ---------- rating sheet ---------- */
  let RT = null;
  function rangeRow(k, label, v, min) {
    return `<div class="fg"><label>${label}</label><div class="tt-rng"><input type="range" min="${min}" max="10" step="0.5" value="${v}" data-ti="rng" data-k="${k}"><b id="rv-${k}">${v > 0 ? v : '\u2014'}</b></div></div>`;
  }
  function rateHtml() {
    const s = tt().sessions.find(x => x.id === RT.sid),
      hrs = s.fadedAt ? (s.fadedAt - s.t0) / H : null;
    const nr = (s.ratings || (s.rating ? [s.rating] : [])).length;
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Rate this test</h2><p class="muted" style="margin:4px 0 16px">${esc(s.name)} \u00b7 ${esc(s.brand)}${hrs != null ? ' \u00b7 lasted ' + relStr(hrs * H) : ''}${nr ? ` \u00b7 rating ${nr + 1}; it is averaged with the ${nr === 1 ? 'earlier one' : nr + ' earlier ones'} (now ${r1(score(s))})` : ''}</p><div class="tt-kv" style="margin:-6px 0 14px"><span>Sprayed</span><span>${esc(sprayLine(s))}</span></div>
  ${rangeRow('longevity', 'Longevity' + (hrs != null && !s.rating ? ' (suggested from the time it faded)' : ''), RT.v.longevity, 1)}${rangeRow('sillage', 'Sillage and aura', RT.v.sillage, 1)}${rangeRow('skin', 'Scent on skin', RT.v.skin, 1)}${rangeRow('value', 'Value for the price (optional, 0 to skip)', RT.v.value, 0)}
  <div class="fg"><span class="lb">Would you buy it</span><div class="chips">${[
    ['yes', 'Yes'],
    ['maybe', 'Maybe'],
    ['no', 'No']
  ]
    .map(
      ([k, l]) =>
        `<button type="button" class="chip${RT.buy === k ? ' on' : ''}" data-ta="rbuy" data-v="${k}">${l}</button>`
    )
    .join('')}</div></div>
  <div class="fg"><label for="rt-c">Short review</label><textarea id="rt-c" placeholder="Opens sharp citrus, turns into creamy vanilla musk after two hours">${esc(RT.comment)}</textarea></div>
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="rsave">Save rating</button></div>`;
  }
  function openRate(sid) {
    const s = tt().sessions.find(x => x.id === sid),
      hrs = s.fadedAt ? (s.fadedAt - s.t0) / H : null;
    const r = s.rating || {};
    RT = {
      sid,
      buy: s.wouldBuy,
      comment: s.comment || '',
      v: {
        longevity: r.longevity || (hrs != null ? clamp(Math.round(hrs * 2) / 2, 1, 10) : 5),
        sillage: r.sillage || 5,
        skin: r.skin || 5,
        value: r.value || 0
      }
    };
    MODAL = 'tt';
    openModal(rateHtml());
  }

  /* ---------- session detail ---------- */
  function timelineSvg(s) {
    const notes = s.notes || [],
      dur = Math.max(H / 2, elapsed(s), ...notes.map(n => n.t - s.t0));
    const W = 320,
      Hh = 96,
      pl = 10,
      pr = 10,
      top = 10,
      base = 74;
    const X = ms => pl + (ms / dur) * (W - pl - pr);
    let g =
      '<line x1="' +
      pl +
      '" y1="' +
      base +
      '" x2="' +
      (W - pr) +
      '" y2="' +
      base +
      '" stroke="var(--line2)" stroke-width="2" stroke-linecap="round"/>';
    const sp = notes
      .filter(n => n.strength)
      .map(n => [X(n.t - s.t0), base - 6 - ((n.strength - 1) / 4) * (base - top - 10)]);
    if (sp.length > 1)
      g +=
        '<path d="' +
        sp.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') +
        '" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/>';
    notes.forEach(n => {
      const x = X(n.t - s.t0),
        y = n.strength ? base - 6 - ((n.strength - 1) / 4) * (base - top - 10) : base;
      g +=
        '<circle cx="' +
        x.toFixed(1) +
        '" cy="' +
        y.toFixed(1) +
        '" r="4.5" fill="var(--gold)" stroke="var(--surf)" stroke-width="2"/>';
    });
    if (s.fadedAt) {
      const x = X(s.fadedAt - s.t0);
      g +=
        '<line x1="' +
        x.toFixed(1) +
        '" y1="' +
        top +
        '" x2="' +
        x.toFixed(1) +
        '" y2="' +
        base +
        '" stroke="var(--danger)" stroke-dasharray="3 3"/><text x="' +
        x.toFixed(1) +
        '" y="' +
        (top + 2) +
        '" text-anchor="end" font-size="10" fill="var(--danger)" font-family="var(--sans)">faded</text>';
    }
    g +=
      '<text x="' +
      pl +
      '" y="92" font-size="10" fill="var(--tx3)" font-family="var(--sans)">spray</text><text x="' +
      (W - pr) +
      '" y="92" text-anchor="end" font-size="10" fill="var(--tx3)" font-family="var(--sans)">+' +
      relStr(dur) +
      '</text>';
    return '<svg class="tt-tl" viewBox="0 0 ' + W + ' ' + Hh + '">' + g + '</svg>';
  }
  function scrubText(s, v) {
    const cur = (s.notes || []).filter(n => n.t - s.t0 <= v).slice(-1)[0];
    const head = '<b style="color:var(--gold2)">+' + relStr(v) + '</b> \u00b7 ';
    if (!cur) return head + '<span class="muted">before your first impression</span>';
    return (
      head +
      esc((cur.tags || []).join(', ') || cur.text || 'note') +
      (cur.strength ? ' \u00b7 strength ' + cur.strength + '/5' : '') +
      (cur.text && (cur.tags || []).length ? '<br><span class="muted">' + esc(cur.text) + '</span>' : '')
    );
  }
  function detailHtml(s) {
    const notes = (s.notes || []).slice().sort((a, b) => a.t - b.t),
      dur = Math.max(H / 2, elapsed(s), ...notes.map(n => n.t - s.t0)),
      sc = score(s),
      sp = spotsLabel(s);
    const rows = notes.length
      ? notes
          .map(
            n =>
              `<div class="tt-note"><div class="rt">+${relStr(n.t - s.t0)}</div><div class="bd">${esc((n.tags || []).join(', ') || n.text || 'Note')}${n.strength ? ' <small>strength ' + n.strength + '/5</small>' : ''}${n.text && (n.tags || []).length ? '<small>' + esc(n.text) + '</small>' : ''}<small>${clock(n.t)}</small></div><button data-ta="ndel" data-id="${s.id}" data-n="${n.id}" aria-label="Delete impression">\u00d7</button></div>`
          )
          .join('')
      : '<p class="muted" style="padding:8px 0">No impressions yet.</p>';
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>${esc(s.name)}</h2><div class="muted" style="margin-bottom:12px">${esc(s.brand)}</div>
  <div class="tt-kv"><span>Sprayed</span><span>${dshort(s.t0)}, ${clock(s.t0)}</span></div>
  <div class="tt-kv"><span>Sprays</span><span>${s.sprays}${sp ? ' \u00b7 ' + esc(sp) : ''}</span></div>
  ${s.venue ? `<div class="tt-kv"><span>Where</span><span>${esc(s.venue)}</span></div>` : ''}${s.price != null ? `<div class="tt-kv"><span>Price</span><span>${esc(cur())}${fmt(s.price)}</span></div>` : ''}
  <div class="tt-kv"><span>Weather</span><span>${s.weather ? esc(wxLine(s.weather)) : 'not set'} <button data-ta="wxedit" data-id="${s.id}" style="color:var(--gold2);margin-left:6px">edit</button></span></div>
  ${s.fadedAt ? `<div class="tt-kv"><span>Faded after</span><span>${relStr(s.fadedAt - s.t0)}</span></div>` : ''}
  ${sc != null ? `<div class="tt-kv"><span>Score</span><span><b style="color:var(--gold2);font:500 22px var(--serif)">${r1(sc)}</b> \u00b7 ${CRIT.map(([k, l]) => l + ' ' + s.rating[k]).join(' \u00b7 ')}${s.rating.value ? ' \u00b7 Value ' + s.rating.value : ''}${(s.ratings || []).length > 1 ? ' \u00b7 average of ' + s.ratings.length + ' ratings' : ''}</span></div>` : ''}
  ${s.comment ? `<p class="sub2" style="font-size:14px;font-style:italic">\u201c${esc(s.comment)}\u201d</p>` : ''}
  ${s.wouldBuy === 'yes' && !S.perfumes.some(p => norm(p.brand + ' ' + p.name) === norm((s.brand || '') + ' ' + s.name)) ? `<div class="note" style="margin:14px 0 0"><span>You would buy it.${s.price != null ? ' Price noted: ' + esc(money(s.price)) + '.' : ''}</span><button class="btn sm" data-ta="dwish" data-id="${s.id}">Add to wishlist</button></div>` : ''}
  <h3 style="margin:22px 0 4px">Timeline</h3>${timelineSvg(s)}
  ${notes.length ? `<input type="range" min="0" max="${dur}" step="60000" value="${dur}" data-ti="scrub" data-id="${s.id}" aria-label="Scrub through the test"><div class="tt-scr" id="tt-scr">${scrubText(s, dur)}</div>` : ''}
  <div style="margin-top:10px">${rows}</div>
  <div class="foot"><button class="btn danger sp" data-ta="sdel" data-id="${s.id}">Delete</button><button class="btn ghost" data-ta="note" data-id="${s.id}">Add impression</button><button class="btn ghost" data-ta="respray" data-id="${s.id}">New spray</button><button class="btn ghost" data-ta="tedit" data-id="${s.id}">Edit</button>${s.fadedAt ? '' : `<button class="btn ghost" data-ta="fade" data-id="${s.id}">Faded out</button>`}<button class="btn" data-ta="rate" data-id="${s.id}">${s.rating ? 'Rate again' : 'Rate'}</button></div>`;
  }
  /* Edit a test: fragrance, sprays, time, where on the body, where tested and price. */
  let ED = null;
  function editHtml() {
    const s = tt().sessions.find(x => x.id === ED.sid);
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Edit test</h2>
  <div class="g2" style="margin-top:14px"><div class="fg"><label for="te-n">Fragrance</label><input id="te-n" value="${esc(s.name)}"></div><div class="fg"><label for="te-b">House</label><input id="te-b" value="${esc(s.brand || '')}" list="brand-list"></div>
  <div class="fg"><label for="te-s">Sprays</label><input id="te-s" type="number" min="1" max="40" value="${s.sprays}"></div><div class="fg"><label for="te-t">Sprayed at</label><input id="te-t" type="datetime-local" value="${toLocalInput(s.t0)}"></div></div>
  <div class="fg"><span class="lb">Where on the body</span><div class="chips">${SPOTS.map(([k, l]) => `<button type="button" class="chip${ED.spots.includes(k) ? ' on' : ''}" data-ta="tespot" data-v="${k}">${l}</button>`).join('')}</div></div>
  <div class="g2"><div class="fg"><label for="te-v">Where tested</label><input id="te-v" value="${esc(s.venue || '')}"></div><div class="fg"><label for="te-p">Price (${esc(cur())}, optional)</label><input id="te-p" type="number" min="0" step="0.5" value="${s.price != null ? s.price : ''}"></div></div>
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="tesave">Save</button></div>`;
  }
  let RS = null;
  function resprayHtml() {
    const s = tt().sessions.find(x => x.id === RS.sid);
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>New spray</h2><p class="muted" style="margin:4px 0 6px">${esc(s.name)} \u00b7 ${s.sprays} ${s.sprays === 1 ? 'spray' : 'sprays'} so far today</p>
  <span class="lb" style="text-align:center">Sprays to add</span><div class="stepper"><button data-ta="rsstep" data-d="-1" aria-label="Fewer">\u2212</button><b id="rs-n">${RS.n}</b><button data-ta="rsstep" data-d="1" aria-label="More">+</button></div>
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="rssave">Add sprays</button></div>`;
  }
  function openDetail(sid) {
    const s = tt().sessions.find(x => x.id === sid);
    if (!s) return;
    MODAL = 'tt';
    openModal(detailHtml(s));
  }

  function wxEditHtml(s) {
    const w = s.weather || {};
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Weather</h2><p class="muted" style="margin:4px 0 16px">${esc(s.name)}</p>
  <div class="g2"><div class="fg"><label for="wx-t">Temperature (\u00b0C)</label><input id="wx-t" type="number" step="1" value="${w.temp != null ? w.temp : ''}"></div><div class="fg"><label for="wx-h">Humidity (%)</label><input id="wx-h" type="number" min="0" max="100" value="${w.hum != null ? w.hum : ''}"></div></div>
  ${tt().city ? `<button class="btn ghost" data-ta="wxfetch" data-id="${s.id}" style="margin-bottom:10px">Fetch for ${esc(tt().city.name || tt().city.label)}</button>` : ''}
  <div class="foot"><button class="btn ghost" data-ta="dback" data-id="${s.id}">Back</button><button class="btn" data-ta="wxsave" data-id="${s.id}">Save</button></div>`;
  }

  /* ---------- perfume (group) detail ---------- */
  function groupHtml(g) {
    const ax = CRIT.map(([k, l]) => ({ l, v: g.crit[k] }))
      .concat(g.crit.value ? [{ l: 'Value', v: g.crit.value }] : [])
      .filter(a => a.v != null);
    const cond = condStats(g),
      tags = tagCounts(g).slice(0, 10),
      inCab = g.pid && byId(g.pid);
    const onWish = S.perfumes.some(
      p => notOwn(p.shelf) && norm(p.brand + ' ' + p.name) === norm(g.brand + ' ' + g.name)
    );
    /* the bottle of this fragrance in the cabinet or on the wishlist, to open it from here */
    const mine = inCab || S.perfumes.find(p => norm(p.brand + ' ' + p.name) === norm(g.brand + ' ' + g.name));
    const rows = g.sessions
      .slice()
      .sort((a, b) => b.t0 - a.t0)
      .map(
        s =>
          `<div class="tt-g" data-ta="open" data-id="${s.id}" role="button" tabindex="0" style="padding:11px 4px"><div class="mid"><div class="t1" style="font-size:16px">${dshort(s.t0)}</div><div class="t2">${[s.venue, s.weather ? s.weather.temp + '\u00b0' : '', spotsLabel(s), isDone(s) ? '' : 'not rated'].filter(Boolean).map(esc).join(' \u00b7 ')}</div></div><div class="tt-score" style="font-size:24px">${isDone(s) ? r1(score(s)) : '\u2014'}</div></div>`
      )
      .join('');
    const gid = 'g' + g.key,
      ph = mine
        ? ''
        : `<div class="acts" style="margin-top:12px"><button type="button" class="btn ghost sm" data-ta="gphoto" data-k="${esc(g.key)}">${PHOTOS[gid] ? 'Change photo' : 'Add photo'}</button>${PHOTOS[gid] ? `<button type="button" class="btn ghost sm" data-ta="gphotoBg" data-k="${esc(g.key)}">Remove white background</button>` : ''}<a class="btn ghost sm" href="${picUrl(g, 1)}" target="_blank" rel="noopener">Find a picture online</a><input type="file" id="gpFile" accept="image/*" hidden></div>`;
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><div style="display:flex;gap:14px;align-items:center">${PHOTOS[gid] && !mine ? `<div class="th" style="width:46px;height:72px;flex:none">${bt({ id: gid, name: g.name, brand: g.brand, fam: g.fam }, 0.7)}</div>` : ''}<div><h2>${esc(g.name)}</h2><div class="muted">${esc(g.brand)}</div></div></div>${ph}
  ${inCab && !notOwn(inCab.shelf) ? '' : `<div style="margin-top:14px">${similarHtml(g.brand, g.name, g.fam, g.pid)}</div>`}
  <div class="tt-score" style="text-align:left;font-size:46px;margin:14px 0 2px">${r1(g.avg)}<small style="display:inline;margin-left:8px">average over ${g.done.length} ${g.done.length === 1 ? 'test' : 'tests'}</small></div>
  ${radar(ax)}
  ${g.hours != null ? `<div class="tt-kv"><span>Average longevity</span><span>${r1(g.hours)} h</span></div>` : ''}${g.price != null ? `<div class="tt-kv"><span>Last price</span><span>${esc(cur())}${fmt(g.price)}</span></div>` : ''}
  ${cond.length ? `<div class="tt-kv"><span>By temperature</span><span>${esc(cond.join(' \u00b7 '))}</span></div>` : ''}
  ${tags.length ? `<div style="margin:16px 0 4px"><span class="lb">What you smelled most</span><div class="chips">${tags.map(([t, c]) => `<span class="chip">${esc(t)} \u00b7 ${c}</span>`).join('')}</div></div>` : ''}
  <div style="margin:16px 0 4px"><span class="lb">Notes pyramid</span>${pyrHtml(pyrOf(g.brand, g.name)) || '<p class="muted" style="font-size:13.5px">No notes yet.</p>'}<button class="btn ghost sm" data-ta="gnotes" data-k="${esc(g.key)}" style="margin-top:8px">${pyrOf(g.brand, g.name) ? 'Edit notes' : 'Paste notes'}</button></div>
  <h3 style="margin:22px 0 2px">Tests</h3>${rows}
  <div class="foot">${mine ? `<button class="btn ghost" data-ta="gopen" data-id="${mine.id}">${notOwn(mine.shelf) ? 'Open on the wishlist' : 'Open the bottle'}</button>` : ''}${inCab ? '<button class="btn ghost" data-ta="gsync" data-k="' + esc(g.key) + '">Update cabinet ratings</button>' : onWish ? '' : '<button class="btn ghost" data-ta="gwish" data-k="' + esc(g.key) + '">Add to wishlist</button>'}<button class="btn ghost" data-ta="gcalc" data-k="${esc(g.key)}">Decant or bottle?</button>${g.done.length && groups().filter(x => x.done.length).length > 1 ? `<button class="btn ghost" data-ta="cmp" data-k="${esc(g.key)}">Compare</button>` : ''}<button class="btn" data-ta="again" data-k="${esc(g.key)}">Test again</button></div>`;
  }
  const findGroup = k => groups().find(g => g.key === k);
  const reopenGroup = k => () => {
    const g = findGroup(k);
    if (g) {
      MODAL = 'tt';
      openModal(groupHtml(g));
    }
  };

  /* ---------- compare two tested fragrances ---------- */
  const CMPB = '#8fb08a';
  function radar2(A, B) {
    const n = A.length,
      R = 62,
      cx = 100,
      cy = 88;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const poly = (ax, f) =>
      ax
        .map((a, i) =>
          pt(i, R * (f != null ? f : clamp((a.v || 0) / 10, 0, 1)))
            .map(x => x.toFixed(1))
            .join(',')
        )
        .join(' ');
    let g = [1 / 3, 2 / 3, 1]
      .map(f => '<polygon points="' + poly(A, f) + '" fill="none" stroke="var(--line2)" stroke-width="1"/>')
      .join('');
    [
      [A, 'var(--gold)'],
      [B, CMPB]
    ].forEach(([ax, c]) => {
      g +=
        '<polygon points="' +
        poly(ax) +
        '" fill="' +
        c +
        '" fill-opacity=".22" stroke="' +
        c +
        '" stroke-width="2" stroke-linejoin="round"/>';
    });
    A.forEach((a, i) => {
      const q = pt(i, R + 15),
        c = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
      g +=
        '<text x="' +
        q[0].toFixed(1) +
        '" y="' +
        (q[1] + 3).toFixed(1) +
        '" text-anchor="' +
        (c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle') +
        '" font-size="10" fill="var(--tx2)" font-family="var(--sans)">' +
        esc(a.l) +
        '</text>';
    });
    return (
      '<svg viewBox="-34 0 268 178" class="tt-radar" role="img" aria-label="Both fragrances on one radar">' +
      g +
      '</svg>'
    );
  }
  let CMP = { a: '', b: '' };
  function cmpHtml() {
    const gs = groups()
      .filter(g => g.done.length)
      .sort((x, y) => y.avg - x.avg);
    const A = gs.find(g => g.key === CMP.a) || gs[0],
      B = gs.find(g => g.key === CMP.b && g !== A) || gs.find(g => g !== A);
    CMP.a = A.key;
    CMP.b = B.key;
    const sel = k =>
      `<select data-tc="cmp" data-k="${k}" aria-label="${k === 'a' ? 'First' : 'Second'} fragrance">${gs.map(g => `<option value="${esc(g.key)}"${g.key === CMP[k] ? ' selected' : ''}>${esc(g.name)} \u00b7 ${esc(g.brand)}</option>`).join('')}</select>`;
    const ax = g => CRIT.map(([k, l]) => ({ l, v: g.crit[k] })).concat([{ l: 'Value', v: g.crit.value }]);
    const num = [
      ['Score', g => g.avg, ''],
      ['Longevity', g => g.crit.longevity, ''],
      ['Sillage', g => g.crit.sillage, ''],
      ['Skin scent', g => g.crit.skin, ''],
      ['Value', g => g.crit.value, ''],
      ['Lasted', g => g.hours, ' h']
    ];
    const txt = [
      ['Tests', g => String(g.done.length)],
      ['Would buy', g => g.buy || '\u2014'],
      ['Price', g => (g.price != null ? money(g.price) : '\u2014')],
      ['Season', g => testSeason(g) || '\u2014'],
      ['Notes', g => pyrAll(pyrOf(g.brand, g.name)).slice(0, 6).join(', ') || '\u2014'],
      [
        'Smelled most',
        g =>
          tagCounts(g)
            .slice(0, 3)
            .map(x => x[0])
            .join(', ') || '\u2014'
      ],
      [
        'Review',
        g => {
          const r = g.done.find(s => s.comment);
          return r ? '\u201c' + r.comment + '\u201d' : '\u2014';
        }
      ]
    ];
    const rows =
      num
        .map(([l, f, u]) => {
          const a = f(A),
            b = f(B);
          return `<tr><th>${l}</th><td class="${a != null && (b == null || a > b) ? 'win' : ''}">${a != null ? r1(a) + u : '\u2014'}</td><td class="${b != null && (a == null || b > a) ? 'win' : ''}">${b != null ? r1(b) + u : '\u2014'}</td></tr>`;
        })
        .join('') + txt.map(([l, f]) => `<tr><th>${l}</th><td>${esc(f(A))}</td><td>${esc(f(B))}</td></tr>`).join('');
    return `<button class="x" data-act="close" aria-label="Close">\u00d7</button><h2>Compare</h2>
  <div class="g2" style="margin-top:14px"><div class="fg">${sel('a')}</div><div class="fg">${sel('b')}</div></div>
  ${radar2(ax(A), ax(B))}<div class="cmp-key"><span><i style="background:var(--gold)"></i>${esc(A.name)}</span><span><i style="background:${CMPB}"></i>${esc(B.name)}</span></div>
  <table class="cmp"><tr><th></th><td style="color:var(--gold2);font-weight:600">${esc(A.name)}</td><td style="color:${CMPB};font-weight:600">${esc(B.name)}</td></tr>${rows}</table>
  <div class="foot"><button class="btn" data-act="close">Done</button></div>`;
  }
  function openCmp(k) {
    const gs = groups().filter(g => g.done.length);
    if (gs.length < 2) {
      toast('Rate at least two fragrances to compare');
      return;
    }
    CMP = { a: k || '', b: '' };
    MODAL = 'tt';
    openModal(cmpHtml());
  }
  /* Wishlist entry from a test, with the price noted in the test as the price seen. */
  function addWish(g) {
    const e = LIB.find(x => x.k === norm(g.brand + ' ' + g.name));
    const w = {
      id: uid(),
      name: g.name,
      brand: g.brand,
      fam: g.fam || (e && e.f) || '',
      conc: (e && e.c) || 'EDP',
      year: (e && e.y) || '',
      shelf: 'wish',
      type: 'Bottle',
      maxMl: (e && e.s) || 100,
      ml: (e && e.s) || 100,
      price: '',
      rating: 0,
      longevity: '',
      proj: 0,
      seasons: [],
      notes: '',
      created: Date.now(),
      sprays: 0
    };
    if (+g.price > 0) w.seen = +g.price;
    const gid = 'g' + (g.key || keyOf(g));
    if (PHOTOS[gid]) {
      PHOTOS[w.id] = PHOTOS[gid];
      idb.set('photo:' + w.id, PHOTOS[gid]);
    }
    S.perfumes.push(w);
    save();
    toast('Added to your wishlist');
  }

  /* ---------- actions ---------- */
  const TA = {
    start: () => openStart(),
    tshare: () => openShare('tested'),
    open: a => openDetail(a.dataset.id),
    dback: a => openDetail(a.dataset.id),
    group: a => {
      const g = findGroup(a.dataset.k);
      if (g) {
        MODAL = 'tt';
        openModal(groupHtml(g));
      }
    },
    again: a => {
      const g = findGroup(a.dataset.k);
      if (!g) return;
      closeAll();
      const k = keyOf(g),
        today = tt().sessions.find(x => dkey(x.t0) === dkey(Date.now()) && keyOf(x) === k);
      if (today) {
        toast('Continuing today\u2019s test of ' + today.name);
        openDetail(today.id);
        return;
      }
      openStart({ pid: g.pid, name: g.name, brand: g.brand, fam: g.fam });
    },
    /* a photo for a tested fragrance that is in neither the cabinet nor the wishlist */
    gphoto: a => {
      GPK = a.dataset.k;
      const f = $('#gpFile');
      if (f) f.click();
    },
    gphotoBg: async a => {
      const id = 'g' + a.dataset.k,
        u = PHOTOS[id] && (await removeWhite(PHOTOS[id]).catch(() => null));
      if (!u) return toast('No white background found');
      PHOTOS[id] = u;
      await idb.set('photo:' + id, u);
      regroup(a.dataset.k);
      toast('Background removed');
    },
    gopen: a => {
      closeAll();
      openSheet(a.dataset.id);
    },
    gwish: a => {
      const g = findGroup(a.dataset.k);
      if (!g) return;
      addWish(g);
      const g2 = findGroup(g.key);
      if (g2) $('#modal .panel').innerHTML = groupHtml(g2);
    },
    dwish: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      const g = findGroup(keyOf(s));
      addWish(Object.assign({}, g || s, { price: s.price != null ? s.price : g && g.price }));
      render();
      openDetail(s.id);
    },
    gnotes: a => {
      const g = findGroup(a.dataset.k);
      if (g) openPyr(g.brand, g.name, reopenGroup(g.key));
    },
    gcalc: a => {
      const g = findGroup(a.dataset.k);
      if (g) openCalc(calcFor({ pid: g.pid, name: g.name, brand: g.brand, price: g.price }, reopenGroup(g.key)));
    },
    cmp: a => openCmp(a.dataset.k),
    gsync: a => {
      const g = findGroup(a.dataset.k),
        p = g && g.pid && byId(g.pid);
      if (!p) return;
      p.rating = clamp(Math.round(g.avg / 2), 1, 5);
      if (g.crit.sillage) p.proj = clamp(Math.round(g.crit.sillage / 2), 1, 5);
      if (g.hours != null) p.longevity = r1(g.hours);
      save();
      toast('Cabinet ratings updated from your tests');
    },
    /* start sheet */
    tclear: () => {
      readST();
      ST.name = '';
      ST.brand = '';
      ST.pid = null;
      ST.fam = '';
      paintST();
    },
    tspot: a => {
      readST();
      const v = a.dataset.v;
      ST.spots = ST.spots.includes(v) ? ST.spots.filter(x => x !== v) : ST.spots.concat(v);
      paintST();
    },
    tstep: a => {
      ST.n = clamp(ST.n + +a.dataset.d, 1, 20);
      $('#ts-n').textContent = ST.n;
    },
    tpickc: a => {
      readST();
      const p = byId(a.dataset.id);
      if (!p) return;
      ST.pid = p.id;
      ST.name = p.name;
      ST.brand = p.brand;
      ST.fam = p.fam;
      paintST();
    },
    tpickl: a => {
      readST();
      const e = LIB[+a.dataset.i];
      if (!e) return;
      const own = S.perfumes.find(p => norm(p.brand + ' ' + p.name) === e.k);
      ST.pid = own ? own.id : null;
      ST.name = e.n;
      ST.brand = e.b;
      ST.fam = e.f;
      paintST();
    },
    tpickf: () => {
      readST();
      ST.pid = null;
      ST.name = ST.q;
      ST.brand = '';
      ST.fam = '';
      paintST();
    },
    tcity: () => {
      readST();
      ST.showCity = true;
      paintST();
    },
    tfind: async () => {
      const q = ($('#ts-city') || {}).value;
      if (!q || !q.trim()) return;
      readST();
      ST.cmsg = 'Searching\u2026';
      $('#ts-cres').innerHTML = cityRes();
      const r = await geocode(q.trim());
      if (!ST || MODAL !== 'tt') return;
      ST.cres = r || [];
      ST.cmsg =
        r === null
          ? 'Could not reach the weather service. Check your connection.'
          : r.length
            ? ''
            : 'No city found with that name.';
      const box = $('#ts-cres');
      if (box) box.innerHTML = cityRes();
    },
    tgeo: () => {
      if (!navigator.geolocation) {
        toast('Location is not available here');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          readST();
          ST.city = { name: 'My location', label: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude };
          ST.showCity = false;
          paintST();
        },
        () => toast('Location was blocked. Type your city instead.'),
        { timeout: 8000 }
      );
    },
    tpickcity: a => {
      readST();
      const r = (ST.cres || [])[+a.dataset.i];
      if (!r) return;
      ST.city = { name: r.name, label: r.label, lat: r.lat, lon: r.lon };
      ST.showCity = false;
      ST.cres = null;
      paintST();
    },
    tgo: () => startSession(),
    /* impressions */
    qnote: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      (s.notes = s.notes || []).push({ id: uid(), t: Date.now(), tags: [a.dataset.tag], strength: null, text: '' });
      save();
      render();
      toast(a.dataset.tag + ' at +' + relStr(Date.now() - s.t0));
    },
    note: a => openNote(a.dataset.id),
    ntag: a => {
      const v = a.dataset.v;
      const t = $('#nt-text');
      if (t) NT.text = t.value;
      NT.tags = NT.tags.includes(v) ? NT.tags.filter(x => x !== v) : NT.tags.concat(v);
      paintNT();
    },
    nstr: a => {
      const t = $('#nt-text');
      if (t) NT.text = t.value;
      NT.str = NT.str === +a.dataset.v ? null : +a.dataset.v;
      paintNT();
    },
    nsave: () => {
      const s = tt().sessions.find(x => x.id === NT.sid);
      if (!s) return;
      const text = ($('#nt-text').value || '').trim(),
        tm = $('#nt-t').value ? fromLocalInput($('#nt-t').value) : Date.now();
      if (!NT.tags.length && !text) {
        toast('Pick what you smell or write a few words');
        return;
      }
      (s.notes = s.notes || []).push({
        id: uid(),
        t: Math.max(tm, s.t0),
        tags: NT.tags.slice(),
        strength: NT.str,
        text
      });
      s.notes.sort((x, y) => x.t - y.t);
      save();
      render();
      openDetail(s.id);
    },
    ndel: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      s.notes = (s.notes || []).filter(n => n.id !== a.dataset.n);
      save();
      render();
      openDetail(s.id);
    },
    /* fade + rating */
    fade: a => openFade(a.dataset.id),
    fsave: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      s.fadedAt = Math.max(s.t0, fromLocalInput($('#fd-t').value));
      save();
      render();
      openRate(s.id);
    },
    rate: a => openRate(a.dataset.id),
    tedit: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      ED = { sid: s.id, spots: (s.spots || []).slice() };
      MODAL = 'tt';
      openModal(editHtml());
    },
    tespot: a => {
      const k = a.dataset.v;
      ED.spots = ED.spots.includes(k) ? ED.spots.filter(x => x !== k) : ED.spots.concat(k);
      a.classList.toggle('on');
    },
    tesave: () => {
      const s = tt().sessions.find(x => x.id === ED.sid);
      if (!s) return;
      const name = $('#te-n').value.trim(),
        brand = $('#te-b').value.trim(),
        n = clamp(Math.round(+$('#te-s').value || s.sprays), 1, 40);
      if (!name) {
        toast('Add the fragrance name');
        return;
      }
      const t0 = $('#te-t').value ? fromLocalInput($('#te-t').value) : s.t0,
        pr = $('#te-p').value;
      /* a wear logged from a cabinet bottle when the test started moves along with it */
      const w = S.wears.find(x => x.pid && x.pid === s.pid && x.t === s.t0),
        p = w && byId(w.pid);
      if (name !== s.name || brand !== (s.brand || '')) {
        const m = S.perfumes.find(q => norm(q.name) === norm(name) && norm(q.brand) === norm(brand));
        s.pid = m ? m.id : null;
        s.name = name;
        s.brand = brand;
        if (m) s.fam = m.fam;
      }
      if (w && p && w.pid === s.pid) {
        const d = n - s.sprays,
          ml = d / rateOf(p);
        p.ml = clamp(Math.round((p.ml - ml) * 10) / 10, 0, p.maxMl);
        p.sprays = Math.max(0, (p.sprays || 0) + d);
        w.n = n;
        w.t = t0;
        if (w.ml != null) w.ml = Math.max(0, Math.round((w.ml + ml) * 10) / 10);
      }
      const dt = t0 - s.t0;
      if (dt) {
        (s.notes || []).forEach(x => {
          x.t = Math.max(t0, x.t + dt);
        });
        if (s.fadedAt) s.fadedAt = Math.max(t0, s.fadedAt + dt);
      }
      s.t0 = t0;
      s.sprays = n;
      s.spots = ED.spots.slice();
      s.venue = $('#te-v').value.trim();
      s.price = pr === '' ? null : Math.max(0, +pr);
      save();
      render();
      toast('Test updated');
      openDetail(s.id);
    },
    /* new spray on the same test: adds sprays, marks the moment on the timeline, and uses up the
     cabinet bottle too when the test was logged from it */
    respray: a => {
      RS = { sid: a.dataset.id, n: 1 };
      MODAL = 'tt';
      openModal(resprayHtml());
    },
    rsstep: a => {
      RS.n = clamp(RS.n + +a.dataset.d, 1, 20);
      const b = $('#rs-n');
      if (b) b.textContent = RS.n;
    },
    rssave: () => {
      const s = tt().sessions.find(x => x.id === RS.sid);
      if (!s) return;
      const n = RS.n;
      s.sprays = (+s.sprays || 0) + n;
      (s.notes = s.notes || []).push({
        id: uid(),
        t: Date.now(),
        tags: [],
        strength: null,
        text: 'Sprayed again: ' + n + (n === 1 ? ' spray' : ' sprays')
      });
      const w = S.wears.find(x => x.pid && x.pid === s.pid && x.t === s.t0),
        p = w && byId(w.pid);
      if (p) {
        const ml = n / rateOf(p);
        p.ml = Math.max(0, Math.round((p.ml - ml) * 10) / 10);
        p.sprays = (p.sprays || 0) + n;
        w.n += n;
        if (w.ml != null) w.ml = Math.round((w.ml + ml) * 10) / 10;
      }
      save();
      render();
      toast('Added ' + n + (n === 1 ? ' spray' : ' sprays') + ' to today\u2019s test');
      openDetail(s.id);
    },
    rbuy: a => {
      const c = $('#rt-c');
      if (c) RT.comment = c.value;
      RT.buy = RT.buy === a.dataset.v ? null : a.dataset.v;
      const p = $('#modal .panel');
      const sc = p.scrollTop;
      p.innerHTML = rateHtml();
      p.scrollTop = sc;
    },
    rsave: () => {
      const s = tt().sessions.find(x => x.id === RT.sid);
      if (!s) return;
      /* Every rating is kept; the test's rating is their average (they no longer replace each other). */
      if (!s.ratings) s.ratings = s.rating ? [Object.assign({}, s.rating)] : [];
      s.ratings.push({
        longevity: RT.v.longevity,
        sillage: RT.v.sillage,
        skin: RT.v.skin,
        value: RT.v.value,
        t: Date.now()
      });
      s.rating = avgRating(s.ratings);
      s.wouldBuy = RT.buy;
      s.comment = ($('#rt-c').value || '').trim();
      s.status = 'done';
      s.ratedAt = Date.now();
      save();
      render();
      toast(
        (s.ratings.length > 1 ? 'Average of ' + s.ratings.length + ' ratings: ' : 'Rated ') +
          r1(score(s)) +
          ' \u00b7 ' +
          s.name
      );
      openDetail(s.id);
    },
    sdel: a => {
      const id = a.dataset.id;
      askConfirm(
        'Delete this test?',
        'Its impressions and rating are removed. The fragrance average updates.',
        'Delete',
        true
      ).then(ok => {
        if (!ok) return;
        const d = tt();
        d.sessions = d.sessions.filter(x => x.id !== id);
        save();
        closeAll();
        render();
        toast('Test deleted');
      });
    },
    /* weather edit */
    wxedit: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (s) {
        MODAL = 'tt';
        openModal(wxEditHtml(s));
      }
    },
    wxsave: a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      const t = $('#wx-t').value,
        h = $('#wx-h').value;
      s.weather = Object.assign({}, s.weather || {}, {
        temp: t === '' ? null : Math.round(+t),
        hum: h === '' ? null : Math.round(+h),
        city: (s.weather && s.weather.city) || 'Manual'
      });
      save();
      render();
      openDetail(s.id);
    },
    wxfetch: async a => {
      const s = tt().sessions.find(x => x.id === a.dataset.id);
      if (!s) return;
      toast('Fetching weather\u2026');
      const w = await getWeather(tt().city, s.t0);
      if (!w) {
        toast('Weather not available right now');
        return;
      }
      s.weather = w;
      save();
      render();
      openDetail(s.id);
    }
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-ta]');
    if (a && TA[a.dataset.ta]) {
      e.preventDefault();
      TA[a.dataset.ta](a, e);
    }
  });
  document.addEventListener('keydown', e => {
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      e.target.dataset &&
      e.target.dataset.ta &&
      e.target.getAttribute('role') === 'button'
    ) {
      e.preventDefault();
      TA[e.target.dataset.ta](e.target, e);
    }
  });

  const TI = {
    tq: el => {
      TQ = el.value;
      const box = $('#ttList');
      if (box) box.innerHTML = listHtml();
    },
    tsq: el => {
      const q = el.value.trim();
      ST.q = q;
      const box = $('#ts-sugg');
      if (!box) return;
      if (q.length < 2) {
        box.innerHTML = '';
        return;
      }
      const w = norm(q).split(' ').filter(Boolean);
      const cab = S.perfumes
        .filter(p => {
          const k = norm(p.brand + ' ' + p.name);
          return w.every(x => k.includes(x));
        })
        .slice(0, 4);
      const lib = libFind(q).slice(0, 6);
      box.innerHTML =
        cab
          .map(
            p =>
              `<button type="button" data-ta="tpickc" data-id="${p.id}">${esc(p.name)} <small>${esc(p.brand)} \u00b7 ${notOwn(p.shelf) ? 'on your wishlist' : 'in cabinet'}</small></button>`
          )
          .join('') +
        lib
          .map(
            i =>
              `<button type="button" data-ta="tpickl" data-i="${i}">${esc(LIB[i].n)} <small>${esc(LIB[i].b)}</small></button>`
          )
          .join('') +
        `<button type="button" data-ta="tpickf">Use \u201c${esc(q)}\u201d as typed</button>`;
    },
    rng: el => {
      const k = el.dataset.k;
      RT.v[k] = +el.value;
      const o = $('#rv-' + k);
      if (o) o.textContent = +el.value > 0 ? +el.value : '\u2014';
    },
    scrub: el => {
      const s = tt().sessions.find(x => x.id === el.dataset.id),
        o = $('#tt-scr');
      if (s && o) o.innerHTML = scrubText(s, +el.value);
    }
  };
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.ti;
    if (k && TI[k]) TI[k](e.target, e);
  });
  const TC = {
    tsort: el => {
      TSORT = el.value;
      const box = $('#ttList');
      if (box) box.innerHTML = listHtml();
    },
    cmp: el => {
      CMP[el.dataset.k] = el.value;
      if (CMP.a === CMP.b) CMP[el.dataset.k === 'a' ? 'b' : 'a'] = '';
      const p = $('#modal .panel');
      if (p) {
        const sc = p.scrollTop;
        p.innerHTML = cmpHtml();
        p.scrollTop = sc;
      }
    },
    tearly: el => {
      readST();
      ST.earlier = el.checked;
      if (el.checked) ST.t = Date.now() - H;
      paintST();
    }
  };
  let GPK = null;
  function regroup(k) {
    const g = findGroup(k);
    if (g && $('#modal .panel')) $('#modal .panel').innerHTML = groupHtml(g);
    refresh();
  }
  document.addEventListener('change', async e => {
    if (e.target.id === 'gpFile' && e.target.files[0] && GPK) {
      try {
        const url = await compressImage(e.target.files[0]),
          id = 'g' + GPK;
        PHOTOS[id] = url;
        await idb.set('photo:' + id, url);
        if (!(S.tt.photos || []).includes(id)) (S.tt.photos = S.tt.photos || []).push(id);
        save();
        regroup(GPK);
      } catch (err) {
        toast('That image could not be read');
      }
      return;
    }
    const k = e.target.dataset && e.target.dataset.tc;
    if (k && TC[k]) TC[k](e.target, e);
  });

  window.__luxTest = { groups, score, condStats, tagCounts, relStr, wxLine, radar, keyOf, openStart };
  afterRender();
})();
