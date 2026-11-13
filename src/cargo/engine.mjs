// Adapted from eeissn/cargo-calc at 2c5160c60cf98d7a3e89755083a1791c3fa5a9a0.
export function mountCargo(root, surface, planStorage, signal) {
  const listen = (name, handler) => window.addEventListener(name, handler, {signal});
  var $ = function (id) { return root.getElementById(id); };
  var svg = $("top");
  var NS = "http://www.w3.org/2000/svg";
  var VB_W = 900;

  var cargo = [];          // типы груза: {id, name, l, w, h, q}
  var cargoIndex = new Map();
  var units = [];          // отдельные места: {uid, cid, x, y, placed, out}
  var nextCid = 1, nextUid = 1;
  var MAX_UNITS = 1000;
  var PLAN_KEY = "cargoPlanV1";

  function quantityAllowed(q, replaced) {
    return Number.isSafeInteger(q) && q >= 1 && units.length - replaced + q <= MAX_UNITS;
  }
  var geom = { x0: 50, y0: 40, scale: 1 };
  var sideGeom = {};
  var drag = null;
  var selectedUid = null;
  var autoNote = "", autoSig = "";

  // типы упаковки: тонкие значки в одном стиле
  function ico(body) {
    return '<svg class="pk-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  var PACK_TYPES = [
    { id: "pallet", name: "Паллета", svg: ico('<rect x="5.5" y="3.5" width="13" height="12"/><path d="M12 3.5v12M5.5 9.5h13"/><rect x="3" y="15.5" width="18" height="2.5"/><path d="M4.5 18v2.5h3V18M10.5 18v2.5h3V18M16.5 18v2.5h3V18"/>') },
    { id: "box", name: "Коробка", svg: ico('<path d="M12 2.5l9 4.5v10l-9 4.5-9-4.5V7z"/><path d="M3 7l9 4.5L21 7M12 11.5v10"/><path d="M9 4l9 4.5M6 5.5l9 4.5"/>') },
    { id: "bag", name: "Мешок", svg: ico('<path d="M8.5 7C7 5.5 7.5 3 10 3c1 0 1.3.8 2 .8s1-.8 2-.8c2.5 0 3 2.5 1.5 4"/><rect x="8.2" y="7" width="7.6" height="2" rx="1"/><path d="M8 9C5 11 4.5 15 4.8 17.5L3.8 20.2c-.2.7.3 1.1 1 1.1h14.4c.7 0 1.2-.4 1-1.1l-1-2.7C19.5 15 19 11 16 9"/><path d="M12 11.8v3.4"/>') },
    { id: "barrel", name: "Бочка", svg: ico('<ellipse cx="12" cy="5" rx="7" ry="2.3"/><path d="M5 5v13.5M19 5v13.5"/><path d="M5 18.5c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3"/><path d="M5 11.8c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3"/><path d="M15.4 4.6h1.8"/>') },
    { id: "roll", name: "Рулон", svg: ico('<ellipse cx="7" cy="5.5" rx="4" ry="2"/><ellipse cx="7" cy="5.5" rx="1.5" ry=".8"/><path d="M3 5.5V19c0 1.1 1.8 2 4 2s4-.9 4-2V5.5"/><path d="M9.5 3.7H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-9"/>') }
  ];
  PACK_TYPES.forEach(function (p) { p.body = p.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, ""); });
  var curType = "pallet";
  var openLimit = null;   // у какого груза открыта настройка ограничений
  var LAYERS_ICO = '<svg class="pk-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/></svg>';
  function typeDef(id) {
    for (var i = 0; i < PACK_TYPES.length; i++) if (PACK_TYPES[i].id === id) return PACK_TYPES[i];
    return PACK_TYPES[0];
  }

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // единицы показа: внутри все хранится в сантиметрах
  var U = "cm";
  function toInput(cm) { return U === "m" ? String(+(cm / 100).toFixed(2)) : String(Math.round(cm)); }
  function fmtDim(cm) {
    return U === "m" ? String(+(cm / 100).toFixed(2)).replace(".", ",") + " м" : Math.round(cm) + " см";
  }
  function fmtNum(cm) {
    return U === "m" ? String(+(cm / 100).toFixed(2)).replace(".", ",") : String(Math.round(cm));
  }
  function cmOf(id) {
    var value = Math.round(+$(id).value * (U === "m" ? 100 : 1));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }
  var bodySize = { l: 1360, w: 245, h: 250 };
  function read() {
    return {
      l: cmOf("len") || bodySize.l, w: cmOf("wid") || bodySize.w, h: cmOf("hei") || bodySize.h,
      doorW: cmOf("door-w"), doorH: cmOf("door-h"), payload: kgOf("payload"),
      fullSupport: $("full-support").checked === true
    };
  }
  function kgOf(id) {
    var grams = Math.round(Number($(id).value) * 1000);
    return Number.isSafeInteger(grams) && grams > 0 ? grams : 0;
  }
  function stopOf(c) { return c.stop || 1; }
  function passesDoor(c, dm, d) {
    return dm.w <= (d.doorW || d.w) && c.h <= (d.doorH || d.h);
  }
  function overlapArea(a, b) {
    var da = dimsOf(a), db = dimsOf(b);
    var w = Math.min(a.x + da.l, b.x + db.l) - Math.max(a.x, b.x);
    var h = Math.min(a.y + da.w, b.y + db.w) - Math.max(a.y, b.y);
    return (w > 0 && h > 0) ? w * h : 0;
  }
  function topOf(u) { return (u.z || 0) + cargoById(u.cid).h; }

  function selectedUnit() {
    for (var i = 0; i < units.length; i++) {
      if (units[i].uid === selectedUid && units[i].placed) return units[i];
    }
    return null;
  }
  function cargoById(id) {
    return cargoIndex.get(id) || null;
  }
  // краски: крем, красный, олива, бумага, ржавчина, шалфей, сирень
  var PALETTE = [
    { f: "#f9e8ac", l: "#fff4cb", s: "#b9a85d", t: "#151413" },
    { f: "#d9534a", l: "#ea7a71", s: "#8e2a24", t: "#ffffff" },
    { f: "#a8a02e", l: "#c4bc4a", s: "#6a6410", t: "#151413" },
    { f: "#ede9e1", l: "#faf8f3", s: "#9a958a", t: "#151413" },
    { f: "#dd8b4c", l: "#eba676", s: "#8e5424", t: "#151413" },
    { f: "#8fa58b", l: "#adc2a9", s: "#4d6449", t: "#151413" },
    { f: "#b7a0c0", l: "#cfbbd6", s: "#6e5a77", t: "#151413" }
  ];
  function colorOf(c) { return PALETTE[(c.id - 1) % PALETTE.length]; }
  function fits(c, d) {
    return c.h <= d.h && [false, true].some(function (rot) {
      var dm = dimsRot(c, rot);
      return dm.l <= d.l && dm.w <= d.w && passesDoor(c, dm, d);
    });
  }
  // размер места на виде сверху с учетом поворота (поворот добавим на следующем шаге)
  function dimsOf(u) {
    var c = cargoById(u.cid);
    return u.rot ? { l: c.w, w: c.l } : { l: c.l, w: c.w };
  }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }

  // ---------- места ----------
  function syncUnits() {
    cargoIndex = new Map(cargo.map(function (c) { return [c.id, c]; }));
    units = units.filter(function (u) { return cargoById(u.cid); });
    cargo.forEach(function (c) {
      var mine = units.filter(function (u) { return u.cid === c.id; });
      while (mine.length < c.q) {
        var u = { uid: nextUid++, cid: c.id, x: 0, y: 0, placed: false, out: false, rot: false, z: 0 };
        units.push(u); mine.push(u);
      }
      while (mine.length > c.q) {
        var idx = -1;
        for (var i = mine.length - 1; i >= 0; i--) { if (!mine[i].placed) { idx = i; break; } }
        if (idx < 0) idx = mine.length - 1;
        var rm = mine.splice(idx, 1)[0];
        units.splice(units.indexOf(rm), 1);
      }
    });
  }

  // вернуть в кузов то, что вылезло после смены размеров
  function fitUnits(d) {
    units.forEach(function (u) {
      if (!u.placed) return;
      var c = cargoById(u.cid), dm = dimsOf(u);
      if (c.h > d.h || dm.l > d.l || dm.w > d.w || (u.z || 0) + c.h > d.h) { u.placed = false; u.out = false; u.z = 0; return; }
      u.x = clamp(u.x, 0, d.l - dm.l);
      u.y = clamp(u.y, 0, d.w - dm.w);
    });
  }

  function findOverlaps() {
    var set = {}, pl = units.filter(function (u) { return u.placed && !u.out; });
    for (var i = 0; i < pl.length; i++) {
      for (var j = i + 1; j < pl.length; j++) {
        var a = pl[i], b = pl[j], da = dimsOf(a), db = dimsOf(b);
        if (a.x < b.x + db.l - 0.01 && b.x < a.x + da.l - 0.01 &&
            a.y < b.y + db.w - 0.01 && b.y < a.y + da.w - 0.01 &&
            (a.z || 0) < topOf(b) - 0.01 && (b.z || 0) < topOf(a) - 0.01) {
          set[a.uid] = true; set[b.uid] = true;
        }
      }
    }
    return set;
  }

  // ---------- рисование ----------
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
    return c;
  }

  // штабели: основание на полу и все, что стоит над ним
  function computeStacks() {
    var pl = units.filter(function (u) { return u.placed && !u.out; });
    var stacks = [], map = {};
    pl.filter(function (u) { return !(u.z > 0); }).forEach(function (b) {
      var s = { base: b, units: [b], top: topOf(b) };
      stacks.push(s); map[b.uid] = s;
    });
    pl.filter(function (u) { return u.z > 0; }).sort(function (a, b) { return a.z - b.z; }).forEach(function (u) {
      var best = null, bo = 0;
      stacks.forEach(function (s) {
        var o = overlapArea(u, s.base);
        if (o > bo) { bo = o; best = s; }
      });
      if (best) { best.units.push(u); best.top = Math.max(best.top, topOf(u)); map[u.uid] = best; }
    });
    return { stacks: stacks, map: map };
  }
  function stackText(s) {
    var n = s.units.length, upper = {}, order = [];
    s.units.forEach(function (u) {
      if (u === s.base) return;
      var nm = cargoById(u.cid).name;
      if (!upper[nm]) { upper[nm] = 0; order.push(nm); }
      upper[nm]++;
    });
    var lines = ["Внизу: " + cargoById(s.base.cid).name];
    if (order.length) lines.push("Сверху: " + order.map(function (nm) { return nm + " ×" + upper[nm]; }).join(", "));
    lines.push("Всего " + n + " " + plural(n, "место", "места", "мест") + ", высота " + fmtDim(s.top));
    return lines.join("\n");
  }

  // значок типа упаковки внутри груза на виде
  function iconG(typeId, cx, cy, size, color) {
    var s = size / 24;
    var g = el("g", {
      transform: "translate(" + (cx - size / 2) + " " + (cy - size / 2) + ") scale(" + s + ")",
      fill: "none", stroke: color, "stroke-width": (1.6 / s).toFixed(2),
      "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none"
    });
    g.innerHTML = typeDef(typeId).body;
    return g;
  }
  // что нарисовать внутри груза, зависит от его размера на экране
  function unitGlyph(parent, c, col, rx, ry, rw, rh) {
    var cx = rx + rw / 2, cy = ry + rh / 2;
    var showName = rw >= 64 && rh >= 46, showIcon = rw >= 30 && rh >= 30;
    if (showIcon) {
      var size = Math.min(22, rw - 12, rh - (showName ? 28 : 12));
      if (size >= 12) parent.appendChild(iconG(c.type, cx, showName ? cy - 7 : cy, size, col.l));
    }
    if (showName || (!showIcon && rw > 44 && rh > 18)) {
      var maxCh = Math.max(Math.floor((rw - 8) / 6.5), 1);
      var label = c.name.length > maxCh ? c.name.slice(0, Math.max(maxCh - 1, 1)) + "…" : c.name;
      parent.appendChild(el("text", {
        x: cx, y: showName ? cy + 17 : cy + 4, "text-anchor": "middle",
        style: "fill:" + col.l + ";font-size:11px;font-weight:600;pointer-events:none"
      }, label));
    }
  }

  // стекло витрины: легкий блик по диагонали
  function addGlass(sv, x, y, w, h) {
    var id = "gl-" + sv.id;
    var defs = el("defs", {});
    var gr = el("linearGradient", { id: id, x1: "0", y1: "0", x2: "1", y2: "1" });
    gr.appendChild(el("stop", { offset: "0", "stop-color": "#ffffff", "stop-opacity": "0.09" }));
    gr.appendChild(el("stop", { offset: "0.5", "stop-color": "#ffffff", "stop-opacity": "0.02" }));
    gr.appendChild(el("stop", { offset: "1", "stop-color": "#ffffff", "stop-opacity": "0" }));
    defs.appendChild(gr);
    sv.appendChild(defs);
    sv.appendChild(el("rect", { x: x, y: y, width: w, height: h, rx: 3, fill: "url(#" + id + ")", "pointer-events": "none" }));
  }
  function drawTop(d) {
    var padL = 50, padR = 20, padT = 40, padB = 50;
    var maxW = VB_W - padL - padR;
    var maxH = 420;
    var scale = Math.min(maxW / d.l, maxH / d.w);
    var pw = d.l * scale, ph = d.w * scale;
    var vbH = padT + ph + padB;
    var x0 = padL, y0 = padT;
    geom = { x0: x0, y0: y0, scale: scale };

    svg.setAttribute("viewBox", "0 0 " + VB_W + " " + vbH);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var grid = el("g", { stroke: "var(--grid)", "stroke-width": 1 });
    for (var gx = 100; gx < d.l; gx += 100) {
      grid.appendChild(el("line", { x1: x0 + gx * scale, y1: y0, x2: x0 + gx * scale, y2: y0 + ph }));
    }
    for (var gy = 100; gy < d.w; gy += 100) {
      grid.appendChild(el("line", { x1: x0, y1: y0 + gy * scale, x2: x0 + pw, y2: y0 + gy * scale }));
    }

    svg.appendChild(el("rect", { x: x0, y: y0, width: pw, height: ph, rx: 3, fill: "var(--body-fill)" }));
    addGlass(svg, x0, y0, pw, ph);
    svg.appendChild(grid);
    svg.appendChild(el("rect", {
      x: x0, y: y0, width: pw, height: ph, rx: 3,
      fill: "none", stroke: "var(--frame)", "stroke-width": 2.5
    }));

    // подсказка в пустом кузове
    var anyPlaced = units.some(function (u) { return u.placed; });
    if (!anyPlaced) {
      svg.appendChild(el("text", {
        x: x0 + pw / 2, y: y0 + ph / 2 + 5, "text-anchor": "middle",
        style: "font-size:17px"
      }, cargo.length ? "Перетащи груз из таблицы сюда" : "Добавь груз в форме «Добавить груз»"));
    }

    // груз
    var over = findOverlaps();
    var lviol = limitViolators();
    var st = computeStacks();
    units.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); }).forEach(function (u) {
      if (!u.placed) return;
      var c = cargoById(u.cid), dm = dimsOf(u), col = colorOf(c);
      var rx = x0 + u.x * scale, ry = y0 + u.y * scale, rw = dm.l * scale, rh = dm.w * scale;
      var bad = !!over[u.uid] || !!lviol[u.uid], sel = u.uid === selectedUid;
      var g = el("g", { "data-uid": u.uid, "class": "unit", opacity: u.out ? 0.5 : 1 });
      if (st.map[u.uid]) g.appendChild(el("title", {}, stackText(st.map[u.uid])));
      g.appendChild(el("rect", {
        x: rx + 0.75, y: ry + 0.75, width: Math.max(rw - 1.5, 1), height: Math.max(rh - 1.5, 1), rx: 2, fill: "var(--body-fill)"
      }));
      g.appendChild(el("rect", {
        x: rx + 0.75, y: ry + 0.75, width: Math.max(rw - 1.5, 1), height: Math.max(rh - 1.5, 1), rx: 2,
        fill: col.f, "fill-opacity": (u.z || 0) > 0 ? 0.3 : 0.17,
        stroke: bad ? "var(--danger)" : ((u.z || 0) > 0 ? col.l : col.f),
        "stroke-width": bad ? 3 : 1.5
      }));
      if (sel) {
        g.appendChild(el("rect", {
          x: rx - 2.5, y: ry - 2.5, width: rw + 5, height: rh + 5, rx: 4,
          fill: "none", stroke: "var(--select)", "stroke-width": 2.5, "pointer-events": "none"
        }));
      }
      unitGlyph(g, c, col, rx, ry, rw, rh);
      svg.appendChild(g);
    });

    // значки штабелей: сколько мест друг на друге
    st.stacks.forEach(function (s) {
      var n = s.units.length;
      if (n < 2) return;
      var bd = dimsOf(s.base), bx = x0 + s.base.x * scale, by = y0 + s.base.y * scale;
      var bw = bd.l * scale, bh = bd.w * scale, label = "×" + n, pw2 = 10 + label.length * 6.4;
      if (bw < pw2 + 6 || bh < 18) return;
      svg.appendChild(el("rect", {
        x: bx + bw - pw2 - 3, y: by + 3, width: pw2, height: 14, rx: 2,
        fill: "#000", "fill-opacity": 0.8, stroke: "var(--accent)", "stroke-width": 1, "pointer-events": "none"
      }));
      svg.appendChild(el("text", {
        x: bx + bw - pw2 / 2 - 3, y: by + 13.5, "text-anchor": "middle",
        style: "fill:var(--accent);font-size:10px;font-weight:700;pointer-events:none"
      }, label));
    });

    // место, куда ляжет груз, и линии притяжения
    if (drag && drag.preview) {
      var pv = drag.preview, pd = dimsOf(pv), pcol = colorOf(cargoById(pv.cid));
      svg.appendChild(el("rect", {
        x: x0 + pv.x * scale, y: y0 + pv.y * scale, width: pd.l * scale, height: pd.w * scale, rx: 2,
        fill: pcol.f, "fill-opacity": 0.35, stroke: pcol.f,
        "stroke-width": 1.5, "stroke-dasharray": "5 4"
      }));
    }
    if (drag && drag.guides) {
      if (drag.guides.gx !== null) {
        svg.appendChild(el("line", {
          x1: x0 + drag.guides.gx * scale, y1: y0, x2: x0 + drag.guides.gx * scale, y2: y0 + ph,
          stroke: "var(--accent)", "stroke-width": 1.5, "stroke-dasharray": "4 4"
        }));
      }
      if (drag.guides.gy !== null) {
        svg.appendChild(el("line", {
          x1: x0, y1: y0 + drag.guides.gy * scale, x2: x0 + pw, y2: y0 + drag.guides.gy * scale,
          stroke: "var(--accent)", "stroke-width": 1.5, "stroke-dasharray": "4 4"
        }));
      }
    }

    // двери и кабина
    svg.appendChild(el("line", {
      x1: x0 + pw, y1: y0 + 6, x2: x0 + pw, y2: y0 + ph - 6,
      stroke: "var(--accent)", "stroke-width": 4, "stroke-linecap": "round"
    }));
    svg.appendChild(el("text", { x: x0 + pw, y: y0 - 10, "text-anchor": "end" }, "Двери"));
    svg.appendChild(el("text", { x: x0, y: y0 - 10 }, "Кабина"));

    // размер: длина
    var ly = y0 + ph + 26;
    svg.appendChild(el("line", { x1: x0, y1: ly, x2: x0 + pw, y2: ly, stroke: "var(--muted)" }));
    svg.appendChild(el("line", { x1: x0, y1: ly - 5, x2: x0, y2: ly + 5, stroke: "var(--muted)" }));
    svg.appendChild(el("line", { x1: x0 + pw, y1: ly - 5, x2: x0 + pw, y2: ly + 5, stroke: "var(--muted)" }));
    svg.appendChild(el("text", { x: x0 + pw / 2, y: ly + 18, "text-anchor": "middle" }, "Длина " + fmtDim(d.l)));

    // размер: ширина
    var lx = x0 - 18;
    svg.appendChild(el("line", { x1: lx, y1: y0, x2: lx, y2: y0 + ph, stroke: "var(--muted)" }));
    svg.appendChild(el("line", { x1: lx - 5, y1: y0, x2: lx + 5, y2: y0, stroke: "var(--muted)" }));
    svg.appendChild(el("line", { x1: lx - 5, y1: y0 + ph, x2: lx + 5, y2: y0 + ph, stroke: "var(--muted)" }));
    svg.appendChild(el("text", {
      x: lx - 8, y: y0 + ph / 2, "text-anchor": "middle",
      transform: "rotate(-90 " + (lx - 8) + " " + (y0 + ph / 2) + ")"
    }, "Ширина " + fmtDim(d.w)));

    drawSide($("side-l"), false, d);
    drawSide($("side-r"), true, d);
  }

  // ---------- вид сбоку ----------
  // flip = false: смотрим с нижнего края вида сверху (левый борт), кабина слева
  // flip = true: смотрим с верхнего края (правый борт), кабина справа
  function drawSide(sv, flip, d) {
    var padL = 50, padR = 20, padT = 40, padB = 50;
    var scale = Math.min((VB_W - padL - padR) / d.l, 260 / d.h);
    var pw = d.l * scale, ph = d.h * scale;
    var x0 = padL, y0 = padT, base = y0 + ph;
    sideGeom[flip ? "r" : "l"] = { x0: x0, base: base, scale: scale, flip: flip };
    sv.setAttribute("viewBox", "0 0 " + VB_W + " " + (padT + ph + padB));
    while (sv.firstChild) sv.removeChild(sv.firstChild);

    var grid = el("g", { stroke: "var(--grid)", "stroke-width": 1 });
    for (var gx = 100; gx < d.l; gx += 100) {
      grid.appendChild(el("line", { x1: x0 + gx * scale, y1: y0, x2: x0 + gx * scale, y2: base }));
    }
    for (var gy = 100; gy < d.h; gy += 100) {
      grid.appendChild(el("line", { x1: x0, y1: base - gy * scale, x2: x0 + pw, y2: base - gy * scale }));
    }
    sv.appendChild(el("rect", { x: x0, y: y0, width: pw, height: ph, rx: 3, fill: "var(--body-fill)" }));
    addGlass(sv, x0, y0, pw, ph);
    sv.appendChild(grid);
    sv.appendChild(el("rect", {
      x: x0, y: y0, width: pw, height: ph, rx: 3,
      fill: "none", stroke: "var(--frame)", "stroke-width": 2.5
    }));

    // дальние места рисуем первыми, ближние поверх
    var list = units.filter(function (u) { return u.placed && !u.out; });
    list.sort(function (a, b) { return (flip ? b.y - a.y : a.y - b.y) || ((a.z || 0) - (b.z || 0)); });
    list.forEach(function (u) {
      var c = cargoById(u.cid), dm = dimsOf(u), col = colorOf(c), sel = u.uid === selectedUid;
      var ux = flip ? d.l - u.x - dm.l : u.x;
      var rx = x0 + ux * scale, rw = dm.l * scale, rh = c.h * scale;
      var ry = base - ((u.z || 0) + c.h) * scale;
      var sg = el("g", { "data-uid": u.uid, "class": "unit" });
      sg.appendChild(el("rect", {
        x: rx + 0.75, y: ry + 0.75, width: Math.max(rw - 1.5, 1), height: Math.max(rh - 1.5, 1), rx: 2, fill: "var(--body-fill)"
      }));
      sg.appendChild(el("rect", {
        x: rx + 0.75, y: ry + 0.75, width: Math.max(rw - 1.5, 1), height: Math.max(rh - 1.5, 1), rx: 2,
        fill: col.f, "fill-opacity": (u.z || 0) > 0 ? 0.3 : 0.17, stroke: (u.z || 0) > 0 ? col.l : col.f, "stroke-width": 1.5
      }));
      if (sel) {
        sg.appendChild(el("rect", {
          x: rx - 2.5, y: ry - 2.5, width: rw + 5, height: rh + 5, rx: 4,
          fill: "none", stroke: "var(--select)", "stroke-width": 2.5, "pointer-events": "none"
        }));
      }
      unitGlyph(sg, c, col, rx, ry, rw, rh);
      sv.appendChild(sg);
    });

    // место, куда ляжет груз из таблицы
    if (drag && drag.preview) {
      var pv2 = drag.preview, pd2 = dimsOf(pv2), pc2 = cargoById(pv2.cid), pcol2 = colorOf(pc2);
      var pux = flip ? d.l - pv2.x - pd2.l : pv2.x;
      sv.appendChild(el("rect", {
        x: x0 + pux * scale, y: base - ((pv2.z || 0) + pc2.h) * scale,
        width: pd2.l * scale, height: pc2.h * scale, rx: 2,
        fill: pcol2.f, "fill-opacity": 0.35, stroke: pcol2.f, "stroke-width": 1.5, "stroke-dasharray": "5 4",
        "pointer-events": "none"
      }));
    }

    // кабина и двери
    var doorX = flip ? x0 : x0 + pw;
    sv.appendChild(el("line", {
      x1: doorX, y1: y0 + 6, x2: doorX, y2: base - 6,
      stroke: "var(--accent)", "stroke-width": 4, "stroke-linecap": "round"
    }));
    sv.appendChild(el("text", { x: flip ? x0 + pw : x0, y: y0 - 10, "text-anchor": flip ? "end" : "start" }, "Кабина"));
    sv.appendChild(el("text", { x: flip ? x0 : x0 + pw, y: y0 - 10, "text-anchor": flip ? "start" : "end" }, "Двери"));

    // размеры
    var ly = base + 26;
    sv.appendChild(el("line", { x1: x0, y1: ly, x2: x0 + pw, y2: ly, stroke: "var(--muted)" }));
    sv.appendChild(el("line", { x1: x0, y1: ly - 5, x2: x0, y2: ly + 5, stroke: "var(--muted)" }));
    sv.appendChild(el("line", { x1: x0 + pw, y1: ly - 5, x2: x0 + pw, y2: ly + 5, stroke: "var(--muted)" }));
    sv.appendChild(el("text", { x: x0 + pw / 2, y: ly + 18, "text-anchor": "middle" }, "Длина " + fmtDim(d.l)));
    var lx = x0 - 18;
    sv.appendChild(el("line", { x1: lx, y1: y0, x2: lx, y2: base, stroke: "var(--muted)" }));
    sv.appendChild(el("line", { x1: lx - 5, y1: y0, x2: lx + 5, y2: y0, stroke: "var(--muted)" }));
    sv.appendChild(el("line", { x1: lx - 5, y1: base, x2: lx + 5, y2: base, stroke: "var(--muted)" }));
    sv.appendChild(el("text", {
      x: lx - 8, y: y0 + ph / 2, "text-anchor": "middle",
      transform: "rotate(-90 " + (lx - 8) + " " + (y0 + ph / 2) + ")"
    }, "Высота " + fmtDim(d.h)));
  }

  // ---------- таблица ----------
  // лента с грузом внизу экрана (на телефоне): тяни плитку на любой вид
  function renderTray(d) {
    var tray = $("tray");
    if (!cargo.length) { tray.hidden = true; return; }
    tray.hidden = false;
    $("tchips").innerHTML = cargo.map(function (c) {
      var free = c.q - units.filter(function (u) { return u.cid === c.id && u.placed; }).length;
      var on = free > 0 && fits(c, d), col = colorOf(c);
      return '<div class="tchip' + (on ? '' : ' off') + '" ' + (on ? 'data-chip="' + c.id + '" ' : '') +
        'style="border-color:' + col.f + ';background:' + col.f + '2e" title="' + esc(c.name) + '">' +
        typeDef(c.type).svg + '<span class="cnt">' + free + '</span></div>';
    }).join("");
  }

  function renderCargo(d) {
    renderTray(d);
    var box = $("tbl");
    if (!cargo.length) {
      box.innerHTML = '<div class="empty">Груза пока нет. Заполни форму «Добавить груз» и нажми кнопку.</div>';
      $("total").innerHTML = "";
      return;
    }
    var html = '<p class="hint">Тяни цветную плитку в кузов. Груз притягивается к стенкам и к другому грузу. Клик по грузу выбирает его, кнопка R поворачивает. Груз можно ставить на груз: брось его на другой так, чтобы он опирался хотя бы наполовину. Чтобы убрать груз из кузова, вынеси его за пределы.</p>' +
      '<table><thead><tr><th></th><th>Груз</th><th>Д×Ш×В, ' + (U === 'm' ? 'м' : 'см') + '</th><th>Шт</th><th></th></tr></thead><tbody>';
    var totalQty = 0;
    cargo.forEach(function (c) {
      totalQty += c.q;
      var inBody = units.filter(function (u) { return u.cid === c.id && u.placed; }).length;
      var free = c.q - inBody, ok = fits(c, d);
      var chipOn = free > 0 && ok;
      var limTxt = c.limit === 0 ? 'сверху нельзя' : (c.limit > 0 ? 'сверху до ' + c.limit : '');
      html += '<tr>' +
        '<td><span class="chip' + (chipOn ? '' : ' off') + '" ' + (chipOn ? 'data-chip="' + c.id + '" ' : '') +
          'style="background:' + colorOf(c).f + '2a;border-color:' + colorOf(c).f + '70;color:' + colorOf(c).l + '" title="' + typeDef(c.type).name + (chipOn ? ': перетащи в кузов' : '') + '">' + typeDef(c.type).svg + '</span></td>' +
        '<td><div class="nm"><span>' + esc(c.name) + '</span></div>' +
          (ok ? '<div class="sub">в кузове ' + inBody + ' из ' + c.q + '</div>'
              : '<div class="miss">не помещается в кузов</div>') +
          '<div class="sub">Точка ' + stopOf(c) + (c.grams ? ' · ' + c.grams / 1000 + ' кг/место' : '') + '</div>' +
          '<div class="limrow"><button type="button" class="lim' + (c.limit !== null ? ' on' : '') + '" data-lim="' + c.id +
          '" title="Ограничения: что можно ставить сверху" aria-label="Ограничения штабелирования" aria-expanded="' + (openLimit === c.id) + '">' +
          LAYERS_ICO + '</button>' + (limTxt ? '<span>' + limTxt + '</span>' : '') + '</div></td>' +
        '<td>' + fmtNum(c.l) + '×' + fmtNum(c.w) + '×' + fmtNum(c.h) + '</td>' +
        '<td><input type="number" min="1" step="1" value="' + c.q + '" data-id="' + c.id + '" aria-label="Количество"></td>' +
        '<td><button type="button" class="del" data-del="' + c.id + '" aria-label="Удалить">×</button></td>' +
        '</tr>';
      if (openLimit === c.id) {
        var mode = c.limit === null ? 'free' : (c.limit === 0 ? 'none' : 'max');
        html += '<tr class="limtr"><td colspan="5"><div class="limbox">' +
          '<div class="limttl">Что можно ставить сверху</div>' +
          '<label class="opt"><input type="radio" name="lim-' + c.id + '" value="free" data-limid="' + c.id + '"' + (mode === 'free' ? ' checked' : '') + '> Без ограничений</label>' +
          '<label class="opt"><input type="radio" name="lim-' + c.id + '" value="none" data-limid="' + c.id + '"' + (mode === 'none' ? ' checked' : '') + '> Нельзя ставить сверху</label>' +
          '<label class="opt"><input type="radio" name="lim-' + c.id + '" value="max" data-limid="' + c.id + '"' + (mode === 'max' ? ' checked' : '') + '> Сверху не более ' +
          '<input type="number" min="1" step="1" class="limn" data-limn="' + c.id + '" value="' + (c.limit > 0 ? c.limit : 5) + '" aria-label="Сколько мест сверху"> мест</label>' +
          '</div></td></tr>';
      }
    });
    html += '</tbody></table>';
    box.innerHTML = html;

    var bodyVol = d.l * d.w * d.h / 1e6, placedN = 0, floor = 0, vol = 0;
    var grams = 0, unknown = 0, spans = new Map();
    units.forEach(function (u) {
      if (!u.placed) return;
      var c = cargoById(u.cid);
      placedN++; if (!(u.z > 0)) floor += c.l * c.w; vol += c.l * c.w * c.h / 1e6;
      if (c.grams) grams += c.grams; else unknown++;
      var stop = stopOf(c), span = spans.get(stop) || { min: Infinity, max: 0 };
      span.min = Math.min(span.min, u.x);
      span.max = Math.max(span.max, u.x + dimsOf(u).l);
      spans.set(stop, span);
    });
    var rearBoundary = d.l;
    var mixedStops = Array.from(spans.keys()).sort(function (a, b) { return a - b; }).some(function (stop) {
      var span = spans.get(stop);
      var mixed = span.max > rearBoundary;
      rearBoundary = span.min;
      return mixed;
    });
    var ov = Object.keys(findOverlaps()).length;
    var lvN = Object.keys(limitViolators()).length;
    var stk = computeStacks().stacks.filter(function (s) { return s.units.length > 1; });
    var tall = null;
    stk.forEach(function (s) { if (!tall || s.top > tall.top) tall = s; });
    $("total").innerHTML = 'В кузове: <b>' + placedN + '</b> из ' + totalQty + ' мест<br>' +
      'Занято пола: <b>' + (floor / (d.l * d.w) * 100).toFixed(0) + '%</b><br>' +
      'Масса: <b>' + (grams / 1000).toLocaleString("ru-RU") + ' кг</b>' +
      (d.payload ? ' / ' + (d.payload / 1000).toLocaleString("ru-RU") + ' кг' : '') +
      (unknown ? ' · без массы: ' + unknown : '') + '<br>' +
      (mixedStops ? '<span class="miss">Зоны выгрузки пересекаются по длине кузова.</span><br>' : '') +
      (stk.length ? 'Штабелей: <b>' + stk.length + '</b>, самый высокий: <b>' + fmtDim(tall.top) + '</b> (' + tall.units.length + ' ' + plural(tall.units.length, 'место', 'места', 'мест') + ')<br>' : '') +
      'Объем груза в кузове: <b>' + vol.toFixed(2) + '</b> м³ из ' + bodyVol.toFixed(1) + ' м³ (' +
      (vol / bodyVol * 100).toFixed(0) + '%)' +
      (lvN ? '<br><span class="miss">Превышен лимит штабелирования: ' + lvN + ' ' + plural(lvN, 'место', 'места', 'мест') + ' (красная рамка)</span>' : '') +
      (ov ? '<br><span class="miss">Наложения: ' + ov + ' мест лежат друг на друге</span>' : '');
  }

  function update(noFit) {
    var d = read();
    $("demo").disabled = cargo.length > 0;
    $("vol").textContent = (d.l * d.w * d.h / 1e6).toFixed(1);
    $("area").textContent = (d.l * d.w / 1e4).toFixed(1);
    syncUnits();
    if (!noFit) {
      bodySize = d;
      $("len").value = toInput(d.l);
      $("wid").value = toInput(d.w);
      $("hei").value = toInput(d.h);
      var placedBefore = units.filter(function (u) { return u.placed; }).length;
      fitUnits(d);
      settle(d);
      var removed = placedBefore - units.filter(function (u) { return u.placed; }).length;
      if (removed) flash("Возвращено в список груза: " + removed);
      savePlan(d);
    }
    if (selectedUid !== null && !selectedUnit()) selectedUid = null;
    $("rot").disabled = !selectedUnit();
    $("trot").disabled = !selectedUnit();
    drawTop(d);
    renderCargo(d);
    renderAutoNote();
    var hasPlaced = units.some(function (u) { return u.placed; });
    $("png").disabled = !hasPlaced; $("pdf").disabled = !hasPlaced;
  }

  // ---------- перетаскивание ----------
  // скрытый (на телефоне) вид не принимает груз
  function viewShown(sv) {
    var s = sv.closest ? sv.closest("section") : null;
    return !s || getComputedStyle(s).display !== "none";
  }
  function toCm(cx, cy) {
    if (!viewShown(svg)) return { x: -1e9, y: -1e9 };
    var pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: (p.x - geom.x0) / geom.scale, y: (p.y - geom.y0) / geom.scale };
  }
  function isInside(p, d) { return p.x >= 0 && p.x <= d.l && p.y >= 0 && p.y <= d.w; }
  function pxPerCm() {
    if (viewShown(svg)) return svg.getBoundingClientRect().width / VB_W * geom.scale;
    var keys = ["l", "r"];
    for (var i = 0; i < keys.length; i++) {
      var sv = sideSvg(keys[i]);
      if (sideGeom[keys[i]] && viewShown(sv)) return sv.getBoundingClientRect().width / VB_W * sideGeom[keys[i]].scale;
    }
    return 1;
  }

  // притяжение к стенкам и к краям другого груза
  function snapPos(dm, nx, ny, d, selfUid) {
    var thr = 14 / Math.max(pxPerCm(), 0.05);
    var others = units.filter(function (o) { return o.placed && !o.out && o.uid !== selfUid; });
    var gx = null, gy = null, bx = nx, by = ny, best;

    best = null;
    function tryX(v, guide) {
      var dist = Math.abs(v - nx);
      if (dist <= thr && (best === null || dist < best)) { best = dist; bx = v; gx = guide; }
    }
    tryX(0, 0); tryX(d.l - dm.l, d.l);
    others.forEach(function (o) {
      var od = dimsOf(o);
      if (ny < o.y + od.w + thr && ny + dm.w > o.y - thr) {
        tryX(o.x + od.l, o.x + od.l);
        tryX(o.x - dm.l, o.x);
        tryX(o.x, o.x);
        tryX(o.x + od.l - dm.l, o.x + od.l);
      }
    });

    best = null;
    function tryY(v, guide) {
      var dist = Math.abs(v - ny);
      if (dist <= thr && (best === null || dist < best)) { best = dist; by = v; gy = guide; }
    }
    tryY(0, 0); tryY(d.w - dm.w, d.w);
    others.forEach(function (o) {
      var od = dimsOf(o);
      if (bx < o.x + od.l + thr && bx + dm.l > o.x - thr) {
        tryY(o.y + od.w, o.y + od.w);
        tryY(o.y - dm.w, o.y);
        tryY(o.y, o.y);
        tryY(o.y + od.w - dm.w, o.y + od.w);
      }
    });

    return {
      x: Math.round(clamp(bx, 0, d.l - dm.l)), y: Math.round(clamp(by, 0, d.w - dm.w)),
      gx: gx, gy: gy
    };
  }

  // если груз лег на другой, сдвигаем его к ближайшей свободной стороне
  function resolve(u, d) {
    var dm = dimsOf(u);
    for (var it = 0; it < 10; it++) {
      var hit = null;
      for (var i = 0; i < units.length; i++) {
        var o = units[i];
        if (o === u || !o.placed || o.out) continue;
        var od = dimsOf(o);
        if (u.x < o.x + od.l - 0.01 && o.x < u.x + dm.l - 0.01 &&
            u.y < o.y + od.w - 0.01 && o.y < u.y + dm.w - 0.01 &&
            (u.z || 0) < topOf(o) - 0.01 && (o.z || 0) < topOf(u) - 0.01) { hit = o; break; }
      }
      if (!hit) return;
      var hd = dimsOf(hit);
      var opts = [
        { x: hit.x - dm.l, y: u.y, cost: u.x + dm.l - hit.x },
        { x: hit.x + hd.l, y: u.y, cost: hit.x + hd.l - u.x },
        { x: u.x, y: hit.y - dm.w, cost: u.y + dm.w - hit.y },
        { x: u.x, y: hit.y + hd.w, cost: hit.y + hd.w - u.y }
      ].filter(function (o) {
        return o.x >= 0 && o.y >= 0 && o.x + dm.l <= d.l && o.y + dm.w <= d.w;
      }).sort(function (a, b) { return a.cost - b.cost; });
      if (!opts.length) return;
      u.x = opts[0].x; u.y = opts[0].y;
    }
  }

  // на какой высоте встанет груз: на пол или сверху на другой груз
  // сколько мест стоит над грузом x (любого вида)
  function countAbove(x, pl) {
    var n = 0, top = topOf(x);
    pl.forEach(function (y) {
      if (y !== x && (y.z || 0) >= top - 0.5 && overlapArea(y, x) > 0.5) n++;
    });
    return n;
  }
  // нарушит ли груз u на высоте z чье-то ограничение "сверху до N"
  function limitCheck(u, z) {
    var old = u.z;
    u.z = z;
    var pl = units.filter(function (o) { return (o.placed && !o.out) || o === u; }), bad = null;
    pl.forEach(function (x) {
      if (bad || x === u) return;
      var c = cargoById(x.cid);
      if (c.limit === null || c.limit === undefined) return;
      if (!(z >= topOf(x) - 0.5 && overlapArea(u, x) > 0.5)) return;
      var n = countAbove(x, pl);
      if (n > c.limit) bad = { name: c.name, n: n, limit: c.limit };
    });
    u.z = old;
    return bad;
  }
  // места, над которыми уже стоит больше, чем разрешено (например, после смены лимита)
  function limitViolators() {
    var set = {}, pl = units.filter(function (u) { return u.placed && !u.out; });
    pl.forEach(function (x) {
      var c = cargoById(x.cid);
      if (c.limit === null || c.limit === undefined) return;
      if (countAbove(x, pl) > c.limit) set[x.uid] = true;
    });
    return set;
  }

  function placeZ(u, d) {
    var c = cargoById(u.cid), dm = dimsOf(u), below = [], z = 0;
    if (u.x < 0 || u.y < 0 || u.x + dm.l > d.l || u.y + dm.w > d.w || c.h > d.h || !passesDoor(c, dm, d)) {
      return { ok: false, reason: "bounds" };
    }
    for (var i = 0; i < units.length; i++) {
      var o = units[i];
      if (o === u || !o.placed || o.out) continue;
      if (overlapArea(u, o) > 0.5) below.push(o);
    }
    if (!below.length) return { z: 0, ok: true };
    if (below.some(function (b) { return stopOf(cargoById(b.cid)) !== stopOf(c); })) {
      return { ok: false, reason: "stop" };
    }
    below.forEach(function (b) { z = Math.max(z, topOf(b)); });
    var sup = 0;
    below.forEach(function (b) { if (Math.abs(topOf(b) - z) < 0.5) sup += overlapArea(u, b); });
    if (z + c.h > d.h) return { z: 0, ok: false, reason: "height" };
    if (sup < (d.fullSupport ? 1 : 0.5) * dm.l * dm.w) return { z: 0, ok: false, reason: "support" };
    var lb = limitCheck(u, z);
    if (lb) return { z: 0, ok: false, reason: "limit", lim: lb };
    return { z: z, ok: true };
  }

  function finalize(u, d) {
    var r = placeZ(u, d);
    if (r.ok) { u.z = r.z; return true; }

    u.z = 0;
    resolve(u, d);
    var next = placeZ(u, d);
    if (next.ok) {
      u.z = next.z;
      flash("Груз перемещён на соседнее место");
      return true;
    }
    flash("Здесь груз не помещается с учётом высоты, опоры и ограничений");
    return false;
  }

  // Проверяем опоры снизу вверх. Места без допустимой опоры возвращаем в список.
  function settle(d) {
    var pl = units.filter(function (u) { return u.placed && !u.out; })
      .sort(function (a, b) { return a.z - b.z || a.uid - b.uid; });
    pl.forEach(function (u) { u.placed = false; });
    var loadedMass = 0;
    pl.forEach(function (u) {
      var grams = cargoById(u.cid).grams || 0;
      if (d.payload && (!grams || loadedMass + grams > d.payload)) { u.z = 0; return; }
      var r = placeZ(u, d);
      if (r.ok && r.z <= u.z) {
        u.placed = true;
        u.z = r.z;
        loadedMass += grams;
      } else {
        u.z = 0;
      }
    });
  }

  // позиция для груза, брошенного из таблицы: центр под курсором, затем притяжение
  function newPos(p, c, d) {
    var rot = !(c.l <= d.l && c.w <= d.w && passesDoor(c, dimsRot(c, false), d));
    var dm = rot ? { l: c.w, w: c.l } : { l: c.l, w: c.w };
    var pos = snapPos(dm,
      clamp(p.x - dm.l / 2, 0, d.l - dm.l), clamp(p.y - dm.w / 2, 0, d.w - dm.w), d, -1);
    pos.rot = rot;
    return pos;
  }

  function unitByUid(uid) {
    for (var i = 0; i < units.length; i++) if (units[i].uid === uid) return units[i];
    return null;
  }

  // ---------- боковые виды: координаты и поиск места ----------
  function sideSvg(key) { return key === "l" ? $("side-l") : $("side-r"); }
  function sideToCm(key, cx, cy, d) {
    var sv = sideSvg(key), g = sideGeom[key];
    if (!viewShown(sv)) return { x: -1e9, z: -1e9 };
    var pt = sv.createSVGPoint();
    pt.x = cx; pt.y = cy;
    var p = pt.matrixTransform(sv.getScreenCTM().inverse());
    var ux = (p.x - g.x0) / g.scale;
    return { x: g.flip ? d.l - ux : ux, z: (g.base - p.y) / g.scale };
  }
  function insideSide(q, d) { return q.x >= 0 && q.x <= d.l && q.z >= 0 && q.z <= d.h; }

  function collides(u) {
    for (var i = 0; i < units.length; i++) {
      var o = units[i];
      if (o === u || !o.placed || o.out) continue;
      if (overlapArea(u, o) > 0.5 && (u.z || 0) < topOf(o) - 0.01 && (o.z || 0) < topOf(u) - 0.01) return true;
    }
    return false;
  }

  // на боковом виде не видно глубину, поэтому ищем место поперек кузова сами:
  // где груз встанет на нужной высоте, не заденет соседей и не нарушит ограничения
  function bestY(u, d, zWanted, prefY) {
    var dm = dimsOf(u), maxY = d.w - dm.w, cands = [0, maxY], seen = {}, best = null;
    units.forEach(function (o) {
      if (o === u || !o.placed || o.out) return;
      var od = dimsOf(o);
      cands.push(o.y, o.y + od.w, o.y - dm.w, o.y + od.w - dm.w);
    });
    cands.forEach(function (y0) {
      var y = Math.round(clamp(y0, 0, maxY));
      if (seen[y]) return;
      seen[y] = true;
      u.y = y;
      var r = placeZ(u, d);
      if (!r.ok) return;
      u.z = r.z;
      if (collides(u)) return;
      var score = Math.abs(r.z - zWanted) * 1000 + Math.abs(y - prefY);
      if (best === null || score < best.score) best = { y: y, z: r.z, score: score };
    });
    return best;
  }

  function placeSide(u, rawX, zWanted, prefY, d) {
    var dm = dimsOf(u), old = { x: u.x, y: u.y, z: u.z };
    var x = Math.round(clamp(rawX, 0, d.l - dm.l));
    u.x = x;
    var b = bestY(u, d, zWanted, prefY);
    if (b) {
      var sx = snapPos(dm, x, b.y, d, u.uid).x;
      if (sx !== x) {
        u.x = sx;
        var b2 = bestY(u, d, zWanted, prefY);
        if (b2) { x = sx; b = b2; }
      }
    }
    u.x = old.x; u.y = old.y; u.z = old.z;
    return b ? { x: x, y: b.y, z: b.z } : null;
  }

  // над каким видом сейчас курсор
  function zoneAt(cx, cy, d) {
    var p = toCm(cx, cy);
    if (isInside(p, d)) return { kind: "top", p: p };
    var keys = ["l", "r"];
    for (var i = 0; i < keys.length; i++) {
      if (!sideGeom[keys[i]]) continue;
      var q = sideToCm(keys[i], cx, cy, d);
      if (insideSide(q, d)) return { kind: "side", key: keys[i], q: q };
    }
    return null;
  }
  function freeUnitFor(cid) {
    for (var i = 0; i < units.length; i++) {
      if (units[i].cid === cid && !units[i].placed) return units[i];
    }
    return null;
  }
  // груз из таблицы брошен на боковой вид: x и высота от курсора, глубину подбираем сами
  function sideDrop(zone, c, d) {
    var u = freeUnitFor(c.id);
    if (!u) return null;
    var rot = !(c.l <= d.l && c.w <= d.w), oldRot = u.rot;
    u.rot = rot;
    var dm = dimsOf(u);
    var prefY = sideGeom[zone.key].flip ? 0 : d.w - dm.w;   // ближе к тому борту, с которого смотрим
    var res = placeSide(u, zone.q.x - dm.l / 2, zone.q.z - c.h / 2, prefY, d);
    u.rot = oldRot;
    return res ? { u: u, rot: rot, x: res.x, y: res.y, z: res.z } : null;
  }

  function moveGhost(e) {
    var c = cargoById(drag.cid), k = pxPerCm();
    var gw = Math.max(c.l * k, 20), gh = Math.max(c.w * k, 16);
    var g = drag.ghost;
    g.style.width = gw + "px"; g.style.height = gh + "px";
    g.style.left = (e.clientX - gw / 2) + "px"; g.style.top = (e.clientY + (drag.dy || 0) - gh / 2) + "px";
    g.classList.toggle("in", !!zoneAt(e.clientX, e.clientY + (drag.dy || 0), read()));
  }

  function startNew(cid, e) {
    var c = cargoById(cid);
    e.preventDefault();
    var g = document.createElement("div");
    g.className = "ghost";
    g.style.background = colorOf(c).f + "40";
    g.style.borderColor = colorOf(c).f;
    surface.appendChild(g);
    surface.classList.add("dragging");
    drag = { type: "new", pointerId: e.pointerId, cid: cid, ghost: g, dy: e.pointerType === "touch" ? -56 : 0 };
    moveGhost(e);
  }

  function snapshotPosition(u) {
    return { x: u.x, y: u.y, z: u.z, rot: u.rot, placed: u.placed, out: u.out };
  }

  function startUnit(uid, e) {
    var u = null;
    for (var i = 0; i < units.length; i++) if (units[i].uid === uid) u = units[i];
    if (!u) return;
    e.preventDefault();
    selectedUid = uid;
    units.splice(units.indexOf(u), 1);
    units.push(u);                       // поднять наверх
    var p = toCm(e.clientX, e.clientY);
    drag = { type: "unit", pointerId: e.pointerId, u: u, original: snapshotPosition(u), gx: p.x - u.x, gy: p.y - u.y };
    surface.classList.add("dragging");
  }

  function startSideUnit(uid, key, e) {
    var u = unitByUid(uid);
    if (!u) return;
    e.preventDefault();
    selectedUid = uid;
    units.splice(units.indexOf(u), 1);
    units.push(u);
    var q = sideToCm(key, e.clientX, e.clientY, read());
    drag = { type: "side", pointerId: e.pointerId, u: u, original: snapshotPosition(u), key: key, gx: q.x - u.x, gz: q.z - (u.z || 0), y0: u.y };
    surface.classList.add("dragging");
  }

  var pendingMove = null, moveFrame = 0;
  listen("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    pendingMove = e;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(function () {
      moveFrame = 0;
      var event = pendingMove;
      pendingMove = null;
      if (!signal.aborted && drag && event) moveDrag(event);
    });
  });

  function moveDrag(e) {
    drag.moved = true;
    var d = read();
    if (drag.type === "side") {
      var q = sideToCm(drag.key, e.clientX, e.clientY, d);
      if (insideSide(q, d)) {
        drag.u.out = false;
        var res = placeSide(drag.u, q.x - drag.gx, q.z - drag.gz, drag.y0, d);
        if (res) { drag.u.x = res.x; drag.u.y = res.y; drag.u.z = res.z; }
      } else {
        drag.u.out = true;
      }
      drawTop(d);
      return;
    }
    var p = toCm(e.clientX, e.clientY);
    if (drag.type === "new") {
      moveGhost(e);
      var zone = zoneAt(e.clientX, e.clientY + (drag.dy || 0), d), c0 = cargoById(drag.cid);
      drag.preview = null; drag.guides = null;
      if (zone && zone.kind === "top") {
        var np = newPos(zone.p, c0, d);
        var tmp = { uid: -1, cid: c0.id, x: np.x, y: np.y, rot: np.rot, z: 0, placed: true };
        var rz = placeZ(tmp, d);
        drag.preview = { cid: c0.id, x: np.x, y: np.y, rot: np.rot, z: rz.ok ? rz.z : 0 };
        drag.guides = { gx: np.gx, gy: np.gy };
      } else if (zone && zone.kind === "side") {
        var sd0 = sideDrop(zone, c0, d);
        if (sd0) drag.preview = { cid: c0.id, x: sd0.x, y: sd0.y, rot: sd0.rot, z: sd0.z };
      }
      drawTop(d);
      return;
    }
    var dm = dimsOf(drag.u), nx = p.x - drag.gx, ny = p.y - drag.gy;
    if (isInside(p, d)) {
      drag.u.out = false;
      var pos = snapPos(dm, clamp(nx, 0, d.l - dm.l), clamp(ny, 0, d.w - dm.w), d, drag.u.uid);
      nx = pos.x; ny = pos.y;
      drag.guides = { gx: pos.gx, gy: pos.gy };
    } else {
      drag.u.out = true;
      drag.guides = null;
    }
    drag.u.x = Math.round(nx); drag.u.y = Math.round(ny);
    if (drag.u.out) { drag.u.z = 0; } else { var r = placeZ(drag.u, d); drag.u.z = r.ok ? r.z : 0; }
    drawTop(d);
  }

  function finishDrag(e, cancel) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    if (pendingMove) drag.moved = true;
    pendingMove = null;
    var d = read(), p = toCm(e.clientX, e.clientY), inside = !cancel && isInside(p, d);
    if (drag.type === "side") {
      inside = !cancel && insideSide(sideToCm(drag.key, e.clientX, e.clientY, d), d);
    }
    if (drag.type === "new") {
      var c = cargoById(drag.cid);
      var zn = cancel ? null : zoneAt(e.clientX, e.clientY + (drag.dy || 0), d);
      if (zn && zn.kind === "top") {
        var u = freeUnitFor(drag.cid);
        if (u) {
          var np = newPos(zn.p, c, d);
          u.placed = true; u.out = false; u.rot = np.rot; u.x = np.x; u.y = np.y;
          units.splice(units.indexOf(u), 1); units.push(u);
          if (!finalize(u, d)) { u.placed = false; u.z = 0; }
        }
      } else if (zn && zn.kind === "side") {
        var sd = sideDrop(zn, c, d);
        if (sd) {
          var u2 = sd.u;
          u2.placed = true; u2.out = false; u2.rot = sd.rot; u2.x = sd.x; u2.y = sd.y; u2.z = sd.z;
          units.splice(units.indexOf(u2), 1); units.push(u2);
        } else {
          flash("Здесь нет свободного места");
        }
      }
      surface.removeChild(drag.ghost);
    } else {
      drag.u.out = false;
      if (cancel || !drag.moved) {
        Object.assign(drag.u, drag.original);
      } else if (!inside) {
        drag.u.placed = false;
        drag.u.z = 0;
      } else if (drag.type === "side") {
        var q = sideToCm(drag.key, e.clientX, e.clientY, d);
        var side = placeSide(drag.u, q.x - drag.gx, q.z - drag.gz, drag.y0, d);
        if (side) Object.assign(drag.u, side);
        else {
          Object.assign(drag.u, drag.original);
          flash("Здесь нет свободного места");
        }
      } else {
        var dm = dimsOf(drag.u);
        var pos = snapPos(dm, p.x - drag.gx, p.y - drag.gy, d, drag.u.uid);
        drag.u.x = pos.x;
        drag.u.y = pos.y;
        if (!finalize(drag.u, d)) Object.assign(drag.u, drag.original);
      }
    }
    surface.classList.remove("dragging");
    drag = null;
    update(false);
  }
  listen("pointerup", function (e) { finishDrag(e, false); });
  listen("pointercancel", function (e) { finishDrag(e, true); });

  function bindView(sv, handler) {
    sv.addEventListener("pointerdown", function (e) {
      if (drag || e.button !== 0) return;
      capture(sv, e);
      var tg = e.target;
      while (tg && tg !== sv && !(tg.getAttribute && tg.getAttribute("data-uid"))) tg = tg.parentNode;
      if (!tg || tg === sv) {
        if (selectedUid !== null) { selectedUid = null; update(true); }
        return;
      }
      handler(+tg.getAttribute("data-uid"), e);
    });
  }
  bindView(svg, startUnit);
  bindView($("side-l"), function (uid, e) { startSideUnit(uid, "l", e); });
  bindView($("side-r"), function (uid, e) { startSideUnit(uid, "r", e); });

  // ---------- события формы и таблицы ----------
  ["len", "wid", "hei"].forEach(function (id) {
    $(id).addEventListener("input", function () { update(true); });
    $(id).addEventListener("change", function () { update(false); });
  });
  ["payload", "door-w", "door-h", "full-support"].forEach(function (id) {
    $(id).addEventListener("change", function () { update(false); });
  });
  $("demo").addEventListener("click", function () {
    if (cargo.length) return;
    $("len").value = toInput(423);
    $("wid").value = toInput(213);
    $("hei").value = toInput(216);
    $("door-w").value = toInput(200);
    $("door-h").value = toInput(200);
    $("payload").value = 1400;
    $("full-support").checked = true;
    cargo = [
      { id: nextCid++, name: "Паллета с напитками", type: "pallet", l: 120, w: 80, h: 105, q: 2, limit: 0, grams: 340000, stop: 1 },
      { id: nextCid++, name: "Ящик с оборудованием", type: "pallet", l: 100, w: 95, h: 140, q: 1, limit: 0, grams: 280000, stop: 2 },
      { id: nextCid++, name: "Коробка расходников", type: "box", l: 60, w: 40, h: 42, q: 4, limit: 1, grams: 25000, stop: 2 }
    ];
    syncUnits();
    $("auto").click();
  });

  root.querySelectorAll("button[data-l]").forEach(function (b) {
    b.addEventListener("click", function () {
      $("len").value = toInput(+b.dataset.l);
      $("wid").value = toInput(+b.dataset.w);
      $("hei").value = toInput(+b.dataset.h);
      update(false);
    });
  });

  $("add").addEventListener("click", function () {
    var l = cmOf("c-l"), w = cmOf("c-w"), h = cmOf("c-h"), q = +$("c-q").value;
    if (!(l > 0 && w > 0 && h > 0)) { $("err").textContent = "Укажи длину, ширину и высоту больше нуля."; return; }
    if (!quantityAllowed(q, 0)) {
      $("err").textContent = "Укажи целое количество от 1. В одном плане может быть до " + MAX_UNITS + " мест.";
      return;
    }
    var stop = Number($("c-stop").value) || 1, grams = kgOf("c-kg");
    if (!Number.isSafeInteger(stop) || stop < 1 || ($("c-kg").value && !grams)) {
      $("err").textContent = "Укажи положительную массу и целый номер точки выгрузки.";
      return;
    }
    $("err").textContent = "";
    var name = $("c-name").value.trim() || (typeDef(curType).name + " " + nextCid);
    cargo.push({ id: nextCid++, name: name, type: curType, l: l, w: w, h: h, q: q, limit: null, grams: grams, stop: stop });
    $("c-name").value = "";
    update(false);
    if (window.matchMedia && window.matchMedia("(max-width: 1100px)").matches) surface.scrollIntoView({block:"start"});
  });

  // на касании события должны идти в элемент, который не перерисовывается
  function capture(el, e) { try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (err) {} }
  function bindChips(box) {
    box.addEventListener("pointerdown", function (e) {
      if (drag || e.button !== 0) return;
      var chip = e.target.closest ? e.target.closest("[data-chip]") : null;
      if (!chip) return;
      capture(box, e);
      startNew(+chip.getAttribute("data-chip"), e);
    });
  }
  bindChips($("tbl"));
  bindChips($("tray"));
  $("tauto").addEventListener("click", function () { $("auto").click(); });

  $("tbl").addEventListener("change", function (e) {
    var lid = e.target.getAttribute("data-limid"), ln = e.target.getAttribute("data-limn");
    if (lid || ln) {
      var lc = cargoById(+(lid || ln));
      if (lc) {
        if (ln) lc.limit = Math.max(1, Math.round(+e.target.value) || 1);
        else if (e.target.value === "free") lc.limit = null;
        else if (e.target.value === "none") lc.limit = 0;
        else lc.limit = lc.limit > 0 ? lc.limit : 5;
      }
      update(false);
      return;
    }
    var id = e.target.getAttribute("data-id");
    if (!id) return;
    var v = +e.target.value, c = cargoById(+id);
    if (!quantityAllowed(v, c.q)) {
      e.target.value = c.q;
      flash("Укажи целое количество от 1. Лимит плана: " + MAX_UNITS + " мест.");
      return;
    }
    c.q = v;
    update(false);
  });

  $("tbl").addEventListener("click", function (e) {
    var lb = e.target.closest ? e.target.closest("button[data-lim]") : null;
    if (lb) {
      var lcid = +lb.getAttribute("data-lim");
      openLimit = openLimit === lcid ? null : lcid;
      update(false);
      return;
    }
    var id = e.target.getAttribute("data-del");
    if (!id) return;
    cargo = cargo.filter(function (c) { return c.id !== +id; });
    update(false);
  });

  // ---------- умная автораскладка ----------
  function sigNow() {
    return units.filter(function (u) { return u.placed; }).map(function (u) {
      return u.uid + ":" + u.x + ":" + u.y + ":" + (u.rot ? 1 : 0) + ":" + (u.z || 0);
    }).sort().join("|");
  }
  function renderAutoNote() {
    $("autoinfo").textContent = (autoNote && autoSig === sigNow()) ? autoNote : "";
  }

  function dimsRot(c, rot) { return rot ? { l: c.w, w: c.l } : { l: c.l, w: c.w }; }

  // колонки поперек кузова (swap = false) или ряды вдоль кузова (swap = true)
  function shelfPack(items, rotOf, d, swap) {
    var res = [], x = 0, y = 0, run = 0;
    items.forEach(function (it) {
      var r = rotOf(it), dm = dimsRot(it.c, r);
      if (!swap) {
        if (y + dm.w > d.w) { x += run; y = 0; run = 0; }
        if (x + dm.l > d.l) return;
        res.push({ u: it.u, units: it.units, tower: it, x: x, y: y, rot: r });
        y += dm.w; run = Math.max(run, dm.l);
      } else {
        if (x + dm.l > d.l) { y += run; x = 0; run = 0; }
        if (y + dm.w > d.w) return;
        res.push({ u: it.u, units: it.units, tower: it, x: x, y: y, rot: r });
        x += dm.l; run = Math.max(run, dm.w);
      }
    });
    return res;
  }

  function splitFree(free, px, py, pw, ph) {
    var out = [];
    free.forEach(function (f) {
      if (px >= f.x + f.w || px + pw <= f.x || py >= f.y + f.h || py + ph <= f.y) { out.push(f); return; }
      if (px > f.x) out.push({ x: f.x, y: f.y, w: px - f.x, h: f.h });
      if (px + pw < f.x + f.w) out.push({ x: px + pw, y: f.y, w: f.x + f.w - px - pw, h: f.h });
      if (py > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: py - f.y });
      if (py + ph < f.y + f.h) out.push({ x: f.x, y: py + ph, w: f.w, h: f.y + f.h - py - ph });
    });
    function inside(a, b) { return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h; }
    return out.filter(function (a, i) {
      return !out.some(function (b, j) { return i !== j && inside(a, b) && (!inside(b, a) || j < i); });
    });
  }

  // свободные прямоугольники: каждое место ставим в лучший угол, поворачивая при необходимости
  function maxRectsPack(items, d) {
    var free = [{ x: 0, y: 0, w: d.l, h: d.w }], res = [];
    items.forEach(function (it) {
      var best = null;
      free.forEach(function (f) {
        [false, true].forEach(function (r) {
          if (r ? !it.rOk : !it.nOk) return;
          var dm = dimsRot(it.c, r);
          if (dm.l > f.w || dm.w > f.h) return;
          var s1 = Math.min(f.w - dm.l, f.h - dm.w), s2 = Math.max(f.w - dm.l, f.h - dm.w);
          if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) {
            best = { x: f.x, y: f.y, w: dm.l, h: dm.w, r: r, s1: s1, s2: s2 };
          }
        });
      });
      if (!best) return;
      res.push({ u: it.u, units: it.units, tower: it, x: best.x, y: best.y, rot: best.r });
      free = splitFree(free, best.x, best.y, best.w, best.h);
    });
    return res;
  }

  function scoreOf(pl) {
    var vol = 0, len = 0, rotN = 0, n = 0, lv = 1;
    pl.forEach(function (p) {
      var bk = p.tower, dm = dimsRot(bk.c, p.rot);
      vol += bk.vol;
      len = Math.max(len, p.x + dm.l);
      bk.nodes.forEach(function (nd) { if (nd.rot !== p.rot) rotN++; });
      n += bk.nodes.length; lv = Math.max(lv, bk.lv);
    });
    return { vol: vol, len: len, rotN: rotN, n: n, lv: lv };
  }
  // лучше: больше уложенный объем, затем короче занятая длина, затем меньше поворотов
  function isBetter(a, b) {
    if (!b) return true;
    if (a.vol !== b.vol) return a.vol > b.vol;
    if (a.len !== b.len) return a.len < b.len;
    return a.rotN < b.rotN;
  }

  // лучшая укладка "башен" на пол: башня - несколько одинаковых мест друг на друге
  function packTowers(towers, d) {
    var orders = [
      function (a, b) { return a.u.uid - b.u.uid; },
      function (a, b) { return b.c.l * b.c.w - a.c.l * a.c.w || a.u.uid - b.u.uid; },
      function (a, b) { return Math.max(b.c.l, b.c.w) - Math.max(a.c.l, a.c.w) || a.u.uid - b.u.uid; },
      function (a, b) { return Math.min(b.c.l, b.c.w) - Math.min(a.c.l, a.c.w) || a.u.uid - b.u.uid; }
    ];

    // какие типы груза можно класть и так и так
    var flex = [], seen = {};
    towers.forEach(function (it) {
      if (it.nOk && it.rOk && !seen[it.c.id]) { seen[it.c.id] = true; flex.push(it.c); }
    });
    var combos = [], comboKeys = new Set();
    function addCombo(fn) {
      var m = {};
      flex.forEach(function (c) { m[c.id] = fn(c); });
      var key = flex.map(function (c) { return m[c.id] ? "1" : "0"; }).join("");
      if (comboKeys.has(key)) return;
      comboKeys.add(key);
      combos.push(m);
    }
    addCombo(function () { return false; });
    addCombo(function () { return true; });
    addCombo(function (c) { return c.w > c.l; });   // длинной стороной вдоль кузова
    addCombo(function (c) { return c.l > c.w; });   // длинной стороной поперек
    if (flex.length <= 8 && towers.length <= 150) {
      for (var mask = 0; mask < (1 << flex.length); mask++) {
        (function (mk) { addCombo(function (c) { return !!(mk & (1 << flex.indexOf(c))); }); })(mask);
      }
    }

    var best = null;
    function consider(pl) {
      if (!pl.length) return;
      var sc = scoreOf(pl);
      if (isBetter(sc, best && best.sc)) best = { pl: pl, sc: sc };
    }
    orders.forEach(function (cmp) {
      var sorted = towers.slice().sort(cmp);
      combos.forEach(function (m) {
        var rotOf = function (it) { return (it.nOk && it.rOk) ? m[it.c.id] : it.rOk; };
        consider(shelfPack(sorted, rotOf, d, false));
        consider(shelfPack(sorted, rotOf, d, true));
      });
      if (sorted.length <= 400) consider(maxRectsPack(sorted, d));
    });
    return best;
  }

  // ---------- блоки с несколькими местами на каждом этаже ----------
  // Блок - основание и все, что стоит над ним. На верхней площади каждого места
  // может стоять несколько мест рядом, и на каждом из них - свои этажи.
  function chainOk(node) {
    for (var a = node; a; a = a.parent) {
      var lim = a.c.limit;
      if (lim !== null && lim !== undefined && a.desc + 1 > lim) return false;
    }
    return true;
  }

  // заполняем верхнюю площадь места: сначала один слой рядом друг с другом, затем этажи над каждым
  function fillSurface(node, pool, d, L, zTop) {
    if (node.depth >= L) return;
    var A = node.rot ? node.c.w : node.c.l, B = node.rot ? node.c.l : node.c.w;
    var free = [{ x: 0, y: 0, w: A, h: B }], placed = [];
    for (var i = 0; i < pool.length && free.length; i++) {
      var it = pool[i], c = it.c;
      if (it.taken || zTop + c.h > d.h || c.l * c.w > A * B) continue;
      if (!chainOk(node)) break;
      var best = null;
      free.forEach(function (f) {
        [false, true].forEach(function (r) {
          var w = r ? c.w : c.l, hh = r ? c.l : c.w;
          if (w > f.w || hh > f.h) return;
          // меньше остаток площади - лучше; при равенстве остается положение без поворота
          var waste = f.w * f.h - w * hh;
          if (!best || waste < best.waste) best = { x: f.x, y: f.y, w: w, h: hh, r: r, waste: waste };
        });
      });
      if (!best) continue;
      it.taken = true;
      var child = { u: it.u, c: c, rot: best.r, ox: node.ox + best.x, oy: node.oy + best.y, z: zTop, parent: node, children: [], desc: 0, depth: node.depth + 1 };
      node.children.push(child);
      for (var a = node; a; a = a.parent) a.desc++;
      free = splitFree(free, best.x, best.y, best.w, best.h);
      placed.push(child);
    }
    placed.forEach(function (ch) { fillSurface(ch, pool, d, L, zTop + ch.c.h); });
  }

  function buildBlocks(items, d, L) {
    var pool = items.slice().sort(function (a, b) {
      return b.c.l * b.c.w - a.c.l * a.c.w || b.c.h - a.c.h || a.u.uid - b.u.uid;
    });
    pool.forEach(function (it) { it.taken = false; });
    var blocks = [];
    pool.forEach(function (it) {
      if (it.taken) return;
      it.taken = true;
      var root = { u: it.u, c: it.c, rot: false, ox: 0, oy: 0, z: 0, parent: null, children: [], desc: 0, depth: 1 };
      if (L > 1) fillSurface(root, pool, d, L, it.c.h);
      var nodes = [], vol = 0, lv = 1;
      (function walk(nd) {
        nodes.push(nd);
        vol += nd.c.l * nd.c.w * nd.c.h;
        lv = Math.max(lv, nd.depth);
        nd.children.forEach(walk);
      })(root);
      blocks.push({ u: it.u, c: it.c, nOk: it.nOk, rOk: it.rOk, root: root, nodes: nodes, vol: vol, lv: lv });
    });
    return blocks;
  }

  // сначала пробуем без штабелей, затем разрешаем по 2, 3... места в высоту, пока все не поместится
  function smartLayout(d, candidates) {
    var items = [];
    candidates.slice().sort(function (a, b) { return a.uid - b.uid; }).forEach(function (u) {
      var c = cargoById(u.cid);
      if (c.h > d.h) return;
      var nOk = c.l <= d.l && c.w <= d.w && passesDoor(c, dimsRot(c, false), d);
      var rOk = c.w <= d.l && c.l <= d.w && passesDoor(c, dimsRot(c, true), d);
      if (nOk || rOk) items.push({ u: u, c: c, nOk: nOk, rOk: rOk });
    });
    if (!items.length) return null;

    var minH = items.reduce(function (m, it) { return Math.min(m, it.c.h); }, Infinity);
    var canStack = items.some(function (it) { return it.c.limit !== 0 && it.c.h + minH <= d.h; });
    var Lmax = canStack ? Math.min(12, Math.floor(d.h / minH)) : 1;

    var best = null;
    for (var L = 1; L <= Lmax; L++) {
      var cand = packTowers(buildBlocks(items, d, L), d);
      if (!cand) continue;
      if (isBetter(cand.sc, best && best.sc)) best = cand;
      if (cand.sc.n === items.length) break;
    }
    if (best) best.items = items;
    return best;
  }

  // ---------- второй проход: верх груза заново, подряд и через стыки ----------
  var USE_REPACK = true;
  var REPACK_DEPTH = 2;      // сколько мест можно в высоту (пока только на пол: этаж 2)

  function uniqSorted(a) {
    return a.slice().sort(function (p, q) { return p - q; }).filter(function (v, i, arr) { return i === 0 || v !== arr[i - 1]; });
  }
  function rectInside(a, b) { return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h; }

  // верхние поверхности рядом стоящих мест одной высоты сливаем в одну площадку:
  // на площадке груз можно поставить через стык между паллетами
  function maximalRects(rects) {
    var xs = [], ys = [];
    rects.forEach(function (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
    xs = uniqSorted(xs); ys = uniqSorted(ys);
    var nx = xs.length - 1, ny = ys.length - 1, filled = [], i, j;
    for (j = 0; j < ny; j++) {
      filled[j] = [];
      for (i = 0; i < nx; i++) {
        var cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        filled[j][i] = rects.some(function (r) { return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h; });
      }
    }
    var cands = [];
    for (var j1 = 0; j1 < ny; j1++) {
      var ok = [];
      for (i = 0; i < nx; i++) ok[i] = true;
      for (var j2 = j1; j2 < ny; j2++) {
        var any = false;
        for (i = 0; i < nx; i++) { ok[i] = ok[i] && filled[j2][i]; if (ok[i]) any = true; }
        if (!any) break;
        i = 0;
        while (i < nx) {
          if (!ok[i]) { i++; continue; }
          var s = i;
          while (i < nx && ok[i]) i++;
          cands.push({ x: xs[s], y: ys[j1], w: xs[i] - xs[s], h: ys[j2 + 1] - ys[j1] });
        }
      }
    }
    return cands.filter(function (a, k) {
      return !cands.some(function (b, m) { return m !== k && rectInside(a, b) && (!rectInside(b, a) || m < k); });
    });
  }

  // Берем найденную раскладку по полу и заново расставляем все, что стоит сверху:
  // подряд, слева направо, и на любой площадке целиком (включая стыки между паллетами).
  // Если новый вариант разместил меньше, возвращаем прежний.
  function repackTops(best, d) {
    var snap = units.map(function (u) { return { u: u, x: u.x, y: u.y, z: u.z, rot: u.rot, placed: u.placed }; });
    var oldN = best.sc.n;
    units.forEach(function (u) { u.placed = false; u.z = 0; u.rot = false; u.out = false; });

    var list = [], floorIds = {};
    best.pl.forEach(function (p) {
      var root = p.tower.nodes[0], dm = dimsRot(root.c, p.rot);
      root.u.x = p.x; root.u.y = p.y; root.u.rot = p.rot; root.u.z = 0; root.u.placed = true;
      list.push({ u: root.u, c: root.c, x: p.x, y: p.y, w: dm.l, h: dm.w, z: 0, depth: 1 });
      floorIds[root.u.uid] = true;
    });
    var pool = best.items.filter(function (it) { return !floorIds[it.u.uid]; }).sort(function (a, b) {
      return b.c.l * b.c.w - a.c.l * a.c.w || b.c.h - a.c.h || a.u.uid - b.u.uid;
    });

    for (var guard = 0; pool.length && guard < 60; guard++) {
      var zs = {};
      list.forEach(function (it) { if (it.depth < REPACK_DEPTH) zs[it.z + it.c.h] = true; });
      var levels = Object.keys(zs).map(Number).sort(function (a, b) { return a - b; });
      var progressed = false;

      levels.forEach(function (z) {
        if (!pool.length) return;
        var tops = list.filter(function (it) { return it.depth < REPACK_DEPTH && it.z + it.c.h === z; })
          .map(function (it) { return { x: it.x, y: it.y, w: it.w, h: it.h }; });
        var free = tops.length <= 40 ? maximalRects(tops) : tops;
        list.filter(function (it) { return it.z === z; }).forEach(function (it) { free = splitFree(free, it.x, it.y, it.w, it.h); });

        for (var pi = 0; pi < pool.length;) {
          var item = pool[pi], c = item.c, u = item.u, placedHere = false;
          if (z + c.h > d.h || !free.length) { pi++; continue; }
          var cand = [];
          free.forEach(function (f) {
            [false, true].forEach(function (r) {
              var w = r ? c.w : c.l, h = r ? c.l : c.w;
              if (w <= f.w && h <= f.h) cand.push({ x: f.x, y: f.y, r: r, w: w, h: h });
            });
          });
          cand.sort(function (a, b) { return a.x - b.x || a.y - b.y || (a.r ? 1 : 0) - (b.r ? 1 : 0); });
          for (var ci = 0; ci < cand.length && !placedHere; ci++) {
            var q = cand[ci];
            u.x = q.x; u.y = q.y; u.rot = q.r; u.z = 0; u.placed = false;
            var r2 = placeZ(u, d);
            if (!r2.ok || r2.z !== z) continue;
            u.z = z;
            if (collides(u)) continue;
            u.placed = true;
            var dep = 1;
            list.forEach(function (it) {
              if (it.z + it.c.h === z && q.x < it.x + it.w && it.x < q.x + q.w && q.y < it.y + it.h && it.y < q.y + q.h) {
                dep = Math.max(dep, it.depth + 1);
              }
            });
            list.push({ u: u, c: c, x: q.x, y: q.y, w: q.w, h: q.h, z: z, depth: dep });
            free = splitFree(free, q.x, q.y, q.w, q.h);
            pool.splice(pi, 1);
            placedHere = true; progressed = true;
          }
          if (!placedHere) { u.placed = false; u.z = 0; u.rot = false; pi++; }
        }
      });
      if (!progressed) break;
    }

    var newN = units.filter(function (u) { return u.placed; }).length;
    if (newN < oldN) {
      snap.forEach(function (s) { s.u.x = s.x; s.u.y = s.y; s.u.z = s.z; s.u.rot = s.rot; s.u.placed = s.placed; });
      return null;
    }
    var len = 0, lv = 1, rotN = 0;
    list.forEach(function (it) { len = Math.max(len, it.x + it.w); lv = Math.max(lv, it.depth); });
    units.forEach(function (u) { if (u.placed && u.rot) rotN++; });
    return { n: newN, len: len, lv: lv, rotN: rotN };
  }

  function applyLayout(best, offset) {
    best.pl.forEach(function (p) {
      p.tower.nodes.forEach(function (nd) {
        nd.u.x = offset + p.x + (p.rot ? nd.oy : nd.ox);
        nd.u.y = p.y + (p.rot ? nd.ox : nd.oy);
        nd.u.rot = nd.rot !== p.rot;
        nd.u.placed = true;
        nd.u.z = nd.z;
      });
    });
  }

  function layoutByStop(d) {
    var groups = new Map();
    units.forEach(function (u) {
      var stop = stopOf(cargoById(u.cid));
      if (!groups.has(stop)) groups.set(stop, []);
      groups.get(stop).push(u);
    });
    var stops = Array.from(groups.keys()).sort(function (a, b) { return a - b; });
    var remainingLength = d.l, remainingMass = d.payload || Infinity, skipped = 0, levels = 1;
    stops.forEach(function (stop) {
      var space = Object.assign({}, d, { l: remainingLength });
      var candidates = groups.get(stop).filter(function (u) {
        var c = cargoById(u.cid), grams = c.grams || 0;
        if (!fits(c, space)) return false;
        if (d.payload && (!grams || grams > remainingMass)) { skipped++; return false; }
        remainingMass -= grams;
        return true;
      });
      var best = smartLayout(space, candidates);
      if (best) {
        var offset = stops.length > 1 ? remainingLength - best.sc.len : 0;
        applyLayout(best, offset);
        var score = best.sc;
        if (stops.length === 1 && USE_REPACK && best.items.length <= 200) {
          score = repackTops(best, d) || score;
        }
        remainingLength -= score.len;
        levels = Math.max(levels, score.lv);
      }
      candidates.forEach(function (u) {
        if (!u.placed) remainingMass += cargoById(u.cid).grams || 0;
      });
    });
    return { len: d.l - remainingLength, lv: levels, skipped: skipped };
  }

  $("auto").addEventListener("click", function () {
    var d = read();
    units.forEach(function (u) { u.placed = false; u.out = false; u.z = 0; u.rot = false; });
    var info = layoutByStop(d);
    settle(d);
    var placed = units.filter(function (u) { return u.placed; });
    var total = units.length, n = placed.length;
    var rotated = placed.filter(function (u) { return u.rot; }).length;
    autoNote = total ? ("Автораскладка: " + n + " из " + total + " мест" +
      (n ? ", занято по длине " + fmtDim(info.len) + ", повернуто " + rotated +
        (info.lv > 1 ? ", в высоту до " + info.lv + " мест" : "") : "") +
      (n < total ? ". Не поместилось: " + (total - n) +
        (info.skipped ? ". Пропущено из-за лимита или неизвестной массы: " + info.skipped : "") : "") + ".") : "";
    update(false);
    autoSig = sigNow();
    renderAutoNote();
  });

  $("clear").addEventListener("click", function () {
    units.forEach(function (u) { u.placed = false; u.out = false; u.z = 0; });
    update(false);
  });

  // ---------- поворот ----------
  var msgTimer = null;
  function flash(text) {
    $("rot-msg").textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { if (!signal.aborted) $("rot-msg").textContent = ""; }, 2800);
  }

  function rotateSelected() {
    var u = selectedUnit();
    if (!u) return;
    var d = read(), old = dimsOf(u), nd = { l: old.w, w: old.l };
    if (nd.l > d.l || nd.w > d.w) { flash("В повернутом виде груз не помещается в кузов"); return; }
    var original = snapshotPosition(u);
    u.rot = !u.rot;
    // поворот вокруг центра
    u.x = Math.round(clamp(u.x + (old.l - nd.l) / 2, 0, d.l - nd.l));
    u.y = Math.round(clamp(u.y + (old.w - nd.w) / 2, 0, d.w - nd.w));
    if (!finalize(u, d)) Object.assign(u, original);
    update(false);
  }

  $("rot").addEventListener("click", rotateSelected);
  svg.addEventListener("dblclick", rotateSelected);
  $("side-l").addEventListener("dblclick", rotateSelected);
  $("side-r").addEventListener("dblclick", rotateSelected);
  listen("keydown", function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); rotateSelected(); }
  });

  // ---------- выбор типа упаковки ----------
  function renderTypes() {
    var box = $("types");
    box.innerHTML = PACK_TYPES.map(function (p) {
      var on = p.id === curType;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="' + (on ? "on" : "") +
        '" data-type="' + p.id + '" title="' + p.name + '" aria-label="' + p.name + '">' + p.svg + '</button>';
    }).join("");
    $("type-name").textContent = typeDef(curType).name;
  }
  $("types").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-type]") : null;
    if (!b) return;
    curType = b.getAttribute("data-type");
    renderTypes();
  });
  renderTypes();

  // ---------- выгрузка схемы в PNG и PDF ----------
  // для печати рисунки переводятся в светлую палитру: белый лист, темные линии
  var PRINT_VARS = {
    "--muted": "#5e594d", "--accent": "#b8372f", "--body-fill": "#ffffff", "--grid": "rgba(21,20,19,0.12)",
    "--frame": "#3d3a33", "--select": "none", "--danger": "#d3231f"
  };
  var PRINT_MAP = {
    "#f9e8ac": "#b08a1a", "#fff4cb": "#6b5410",
    "#d9534a": "#c0392b", "#ea7a71": "#8e2a24",
    "#a8a02e": "#7d7612", "#c4bc4a": "#565008",
    "#ede9e1": "#6f6a5c", "#faf8f3": "#3d3a33",
    "#dd8b4c": "#c06a22", "#eba676": "#8a4a14",
    "#8fa58b": "#5f7a5a", "#adc2a9": "#3d5a38",
    "#b7a0c0": "#8a6f99", "#cfbbd6": "#5f4a6e"
  };

  function printSvg(sv) {
    var vb = sv.getAttribute("viewBox").split(" ").map(Number);
    var s = new XMLSerializer().serializeToString(sv);
    s = s.replace(/var\((--[\w-]+)\)/g, function (m, n) { return PRINT_VARS[n] || m; });
    s = s.replace(/#[0-9a-fA-F]{6}\b/g, function (h) { return PRINT_MAP[h.toLowerCase()] || h; });
    s = s.replace(/^<svg/, '<svg width="' + vb[2] + '" height="' + vb[3] + '"');
    s = s.replace(/^(<svg[^>]*>)/, '$1<style>text{fill:#5e594d;font-size:11px;font-family:"IBM Plex Mono",Consolas,monospace}</style>');
    return { str: s, w: vb[2], h: vb[3] };
  }
  function loadImg(src) {
    return new Promise(function (ok, fail) {
      var im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { fail(new Error("img")); };
      im.src = src;
    });
  }
  function svgUrl(str) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str); }

  async function buildReport() {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    var d = read(), W = 1240, M = 48, CW = W - 2 * M, S = 2;

    // рисунки видов
    var views = [
      ["Вид сверху", $("top")],
      ["Вид сбоку: левый борт, кабина слева", $("side-l")],
      ["Вид сбоку: правый борт, кабина справа", $("side-r")]
    ];
    var vimgs = [];
    for (var i = 0; i < views.length; i++) {
      var ps = printSvg(views[i][1]);
      var im = await loadImg(svgUrl(ps.str));
      vimgs.push({ title: views[i][0], img: im, h: CW * ps.h / ps.w });
    }
    // значки типов для таблицы
    var icons = {};
    for (var k = 0; k < PACK_TYPES.length; k++) {
      var p = PACK_TYPES[k];
      icons[p.id] = await loadImg(svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3d3a33" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + p.body + '</svg>'));
    }

    // цифры
    var placed = units.filter(function (u) { return u.placed; }), floor = 0, vol = 0;
    placed.forEach(function (u) {
      var c = cargoById(u.cid);
      if (!(u.z > 0)) floor += c.l * c.w;
      vol += c.l * c.w * c.h / 1e6;
    });
    var bodyVol = d.l * d.w * d.h / 1e6;
    var stk = computeStacks().stacks.filter(function (s) { return s.units.length > 1; }), tall = null;
    stk.forEach(function (s) { if (!tall || s.top > tall.top) tall = s; });
    var stats = [
      ["В кузове", placed.length + " из " + units.length + " мест"],
      ["Занято пола", (floor / (d.l * d.w) * 100).toFixed(0) + "%"],
      ["Объем груза", vol.toFixed(2) + " м³ из " + bodyVol.toFixed(1) + " м³"],
      ["Штабели", stk.length ? stk.length + ", выше всех " + fmtDim(tall.top) : "нет"]
    ];

    // высота листа
    var rowH = 40, tableH = 44 + cargo.length * rowH + 10;
    var H = 40 + 96 + 100 + vimgs.reduce(function (a, v) { return a + 46 + v.h + 14; }, 0) + 50 + tableH + 90;

    var cv = document.createElement("canvas");
    cv.width = W * S; cv.height = Math.round(H * S);
    var g = cv.getContext("2d");
    g.scale(S, S);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    var SANS = '"Inter", "Segoe UI", Arial, sans-serif', MONO = '"IBM Plex Mono", Consolas, monospace';
    var y = 40;

    // шапка
    g.fillStyle = "#b63a33"; g.fillRect(M, y + 6, 14, 14);
    g.fillStyle = "#151413"; g.font = "700 34px " + SANS; g.textBaseline = "top";
    g.fillText("Раскладка груза", M + 28, y);
    g.fillStyle = "#6f6a5c"; g.font = "400 15px " + MONO; g.textAlign = "right";
    var now = new Date();
    g.fillText(now.toLocaleDateString("ru-RU") + "  " + now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), W - M, y + 10);
    g.textAlign = "left";
    y += 54;
    g.fillStyle = "#3d3a33"; g.font = "500 18px " + SANS;
    g.fillText("Кузов: " + fmtDim(d.l) + " × " + fmtDim(d.w) + " × " + fmtDim(d.h) + "  (объем " + bodyVol.toFixed(1) + " м³)", M, y);
    y += 44;

    // цифры
    var cw4 = CW / 4;
    stats.forEach(function (st, n) {
      var x = M + n * cw4;
      g.fillStyle = "#6f6a5c"; g.font = "500 12px " + MONO;
      g.fillText(st[0].toUpperCase(), x, y);
      g.fillStyle = "#151413"; g.font = "600 17px " + SANS;
      g.fillText(st[1], x, y + 20);
    });
    y += 62;
    g.strokeStyle = "#151413"; g.lineWidth = 1; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
    y += 22;

    // виды
    vimgs.forEach(function (v) {
      g.fillStyle = "#b63a33"; g.fillRect(M, y + 6, 8, 8);
      g.fillStyle = "#151413"; g.font = "500 13px " + MONO;
      g.fillText(v.title.toUpperCase(), M + 20, y + 3);
      y += 30;
      g.strokeStyle = "rgba(21,20,19,0.18)"; g.lineWidth = 1; g.strokeRect(M + 0.5, y + 0.5, CW - 1, v.h - 1);
      g.drawImage(v.img, M, y, CW, v.h);
      y += v.h + 30;
    });

    // таблица груза
    y += 4;
    g.fillStyle = "#b63a33"; g.fillRect(M, y + 6, 8, 8);
    g.fillStyle = "#151413"; g.font = "500 13px " + MONO;
    g.fillText("ГРУЗ", M + 20, y + 3);
    y += 30;
    var cols = [M + 6, M + 66, M + 430, M + 720, M + 840, M + 980];
    g.fillStyle = "#6f6a5c"; g.font = "500 11px " + MONO;
    ["", "НАЗВАНИЕ", "РАЗМЕР Д×Ш×В, " + (U === "m" ? "М" : "СМ"), "ВСЕГО", "В КУЗОВЕ", "СВЕРХУ"].forEach(function (h2, n) {
      if (h2) g.fillText(h2, cols[n], y);
    });
    y += 20;
    g.strokeStyle = "#151413"; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
    cargo.forEach(function (c) {
      var inBody = units.filter(function (u) { return u.cid === c.id && u.placed; }).length;
      var col = colorOf(c);
      var ry = y + 4;
      g.fillStyle = PRINT_MAP[col.f.toLowerCase()] || col.f; g.fillRect(cols[0], ry + 8, 16, 16);
      g.drawImage(icons[c.type] || icons.pallet, cols[1], ry + 4, 24, 24);
      g.fillStyle = "#151413"; g.font = "600 16px " + SANS; g.fillText(c.name, cols[1] + 34, ry + 7);
      g.fillStyle = "#3d3a33"; g.font = "400 15px " + MONO;
      g.fillText(fmtNum(c.l) + " × " + fmtNum(c.w) + " × " + fmtNum(c.h), cols[2], ry + 8);
      g.fillText(String(c.q), cols[3], ry + 8);
      g.fillStyle = inBody < c.q ? "#b8372f" : "#3d3a33";
      g.fillText(inBody + " из " + c.q, cols[4], ry + 8);
      g.fillStyle = "#3d3a33";
      g.fillText(c.limit === null || c.limit === undefined ? "без ограничений" : (c.limit === 0 ? "нельзя" : "до " + c.limit + " мест"), cols[5], ry + 8);
      y += rowH;
      g.strokeStyle = "rgba(21,20,19,0.14)"; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
    });

    // примечание
    y += 22;
    g.fillStyle = "#6f6a5c"; g.font = "400 13px " + SANS;
    g.fillText("Схема справочная: вес груза, крепление и допустимые нагрузки на ось не учитываются.", M, y);
    return cv;
  }

  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    surface.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function fileStamp() {
    var n = new Date(), p2 = function (v) { return (v < 10 ? "0" : "") + v; };
    return n.getFullYear() + "-" + p2(n.getMonth() + 1) + "-" + p2(n.getDate()) + "_" + p2(n.getHours()) + p2(n.getMinutes());
  }

  // PDF без библиотек: одна страница A4, внутри картинка JPEG
  function makePdf(jpeg, iw, ih) {
    var PW = 595.28, PH = 841.89, m = 22;
    var sc = Math.min((PW - 2 * m) / iw, (PH - 2 * m) / ih);
    var dw = iw * sc, dh = ih * sc, dx = (PW - dw) / 2, dy = PH - m - dh;
    var enc = new TextEncoder(), chunks = [], offs = [], len = 0;
    function push(x) { var b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); len += b.length; }
    push("%PDF-1.4\n");
    offs[1] = len; push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offs[2] = len; push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    offs[3] = len; push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
    offs[4] = len; push("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + iw + " /Height " + ih + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n");
    push(jpeg); push("\nendstream\nendobj\n");
    var content = "q " + dw.toFixed(2) + " 0 0 " + dh.toFixed(2) + " " + dx.toFixed(2) + " " + dy.toFixed(2) + " cm /Im0 Do Q";
    offs[5] = len; push("5 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream\nendobj\n");
    var xref = len, x = "xref\n0 6\n0000000000 65535 f \n";
    for (var i = 1; i <= 5; i++) x += ("0000000000" + offs[i]).slice(-10) + " 00000 n \n";
    push(x + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(chunks, { type: "application/pdf" });
  }

  async function exportAs(kind) {
    var btn = $(kind), old = btn.textContent;
    btn.disabled = true; btn.textContent = "Готовлю...";
    try {
      var cv = await buildReport();
      if (kind === "png") {
        await new Promise(function (ok) { cv.toBlob(function (b) { saveBlob(b, "raskladka_" + fileStamp() + ".png"); ok(); }, "image/png"); });
      } else {
        var b64 = cv.toDataURL("image/jpeg", 0.92).split(",")[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        saveBlob(makePdf(bytes, cv.width, cv.height), "raskladka_" + fileStamp() + ".pdf");
      }
    } catch (err) {
      flash("Не удалось подготовить файл. Попробуй еще раз.");
    }
    btn.textContent = old;
    btn.disabled = !units.some(function (u) { return u.placed; });
  }
  $("png").addEventListener("click", function () { exportAs("png"); });
  $("pdf").addEventListener("click", function () { exportAs("pdf"); });

  // ---------- вкладки видов (телефон) ----------
  root.querySelectorAll(".mtabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      surface.setAttribute("data-mv", b.getAttribute("data-mv"));
      root.querySelectorAll(".mtabs button").forEach(function (o) {
        var on = o === b;
        o.classList.toggle("on", on);
        o.setAttribute("aria-selected", on ? "true" : "false");
      });
    });
  });
  $("trot").addEventListener("click", function () { rotateSelected(); });

  // ---------- переключатель см / м ----------
  function setUnit(u) {
    var d = read();
    var form = [cmOf("c-l"), cmOf("c-w"), cmOf("c-h")];
    U = u;
    [["door-w", d.doorW], ["door-h", d.doorH]].forEach(function (entry) {
      var input = $(entry[0]);
      input.value = entry[1] ? toInput(entry[1]) : "";
      input.min = input.step = U === "m" ? "0.01" : "1";
    });
    ["c-l", "c-w", "c-h"].forEach(function (id, i) {
      var inp = $(id);
      inp.value = form[i] > 0 ? toInput(form[i]) : "";
      inp.step = U === "m" ? "0.01" : "1";
      inp.min = U === "m" ? "0.01" : "1";
    });
    var vals = [d.l, d.w, d.h], ids = ["len", "wid", "hei"];
    var maxCm = [2000, 400, 400];
    ids.forEach(function (id, i) {
      var inp = $(id);
      inp.value = toInput(vals[i]);
      inp.step = U === "m" ? "0.01" : "1";
      inp.min = U === "m" ? "0.5" : "50";
      inp.max = U === "m" ? String(maxCm[i] / 100) : String(maxCm[i]);
    });
    root.querySelectorAll(".ulab").forEach(function (e) { e.textContent = U === "m" ? "м" : "см"; });
    root.querySelectorAll(".seg button").forEach(function (b) {
      var on = b.getAttribute("data-u") === U;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    try { planStorage.setItem("cargoUnit", U); } catch (err) {}
    update(false);
  }
  root.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () { setUnit(b.getAttribute("data-u")); });
  });
  function savePlan(d) {
    try {
      planStorage.setItem(PLAN_KEY, JSON.stringify({ body: d, cargo: cargo, units: units }));
    } catch (err) {
      var status = $("storage-status");
      status.textContent = "Браузер не смог сохранить план на этом устройстве.";
      status.hidden = false;
    }
  }

  function restorePlan() {
    try {
      var plan = JSON.parse(planStorage.getItem(PLAN_KEY));
      if (!plan || !plan.body || !Array.isArray(plan.cargo) || !Array.isArray(plan.units)) return;
      function positive(value) { return Number.isSafeInteger(value) && value > 0; }
      var d = plan.body, byId = new Map(), unitIds = new Set(), quantity = 0;
      if (![d.l, d.w, d.h].every(positive)) return;
      if (![d.doorW, d.doorH, d.payload].every(function (n) { return n === undefined || n === 0 || positive(n); })) return;
      for (var c of plan.cargo) {
        if (!c || ![c.id, c.l, c.w, c.h, c.q].every(positive) || byId.has(c.id) ||
            typeof c.name !== "string" || !PACK_TYPES.some(function (p) { return p.id === c.type; }) ||
            !(c.limit === null || (Number.isSafeInteger(c.limit) && c.limit >= 0)) ||
            !(c.stop === undefined || positive(c.stop)) ||
            !(c.grams === undefined || c.grams === 0 || positive(c.grams))) return;
        quantity += c.q;
        if (quantity > MAX_UNITS) return;
        byId.set(c.id, c.q);
      }
      if (quantity !== plan.units.length) return;
      for (var u of plan.units) {
        if (!u || !positive(u.uid) || unitIds.has(u.uid) || !(byId.get(u.cid) > 0) ||
            ![u.x, u.y, u.z].every(Number.isSafeInteger) ||
            typeof u.placed !== "boolean" || typeof u.rot !== "boolean") return;
        byId.set(u.cid, byId.get(u.cid) - 1);
        unitIds.add(u.uid);
        u.out = false;
      }
      $("len").value = toInput(d.l);
      $("wid").value = toInput(d.w);
      $("hei").value = toInput(d.h);
      $("door-w").value = d.doorW ? toInput(d.doorW) : "";
      $("door-h").value = d.doorH ? toInput(d.doorH) : "";
      $("payload").value = d.payload ? d.payload / 1000 : "";
      $("full-support").checked = d.fullSupport === true;
      cargo = plan.cargo;
      units = plan.units;
      nextCid = Math.max(0, ...byId.keys()) + 1;
      nextUid = Math.max(0, ...unitIds) + 1;
    } catch (err) {}
  }

  restorePlan();
  try { if (planStorage.getItem("cargoUnit") === "m") setUnit("m"); } catch (err) {}

  update(false);
}
