const fn=`<div class="cargo-root" data-mv="top">
<header class="bar">
  <div class="brand">
    <i class="dot"></i>
    <span class="logo">План загрузки</span>
  </div>
  <div class="seg" role="group" aria-label="Единицы измерения">
    <button type="button" data-u="cm" class="on" aria-pressed="true">см</button>
    <button type="button" data-u="m" aria-pressed="false">м</button>
  </div>
</header>

<main>
  <div class="col">
  <section id="sec-body">
    <h2>Кузов и ограничения</h2>
    <label>Длина
      <span class="field"><input id="len" type="number" min="50" max="2000" step="1" value="1360"><span class="unit ulab">см</span></span>
    </label>
    <label>Ширина
      <span class="field"><input id="wid" type="number" min="50" max="400" step="1" value="245"><span class="unit ulab">см</span></span>
    </label>
    <label>Высота
      <span class="field"><input id="hei" type="number" min="50" max="400" step="1" value="250"><span class="unit ulab">см</span></span>
    </label>

    <div class="presets">
      <button type="button" data-l="1360" data-w="245" data-h="250">Еврофура 20 т, 82 м³</button>
      <button type="button" data-l="1360" data-w="245" data-h="270">Еврофура 20 т, 90 м³</button>
      <button type="button" data-l="423" data-w="213" data-h="216">Газель Next 4,2 м</button>
    </div>

    <div class="info">
      Объем кузова: <b id="vol">0</b> м³<br>
      Площадь пола: <b id="area">0</b> м²
    </div>
    <label class="demo">Лимит массы груза, кг
      <span class="field"><input id="payload" type="number" min="1" step="1" placeholder="Без лимита"></span>
    </label>
    <details>
      <summary>Размер заднего проёма</summary>
      <div class="plan-fields">
        <label>Ширина, <span class="ulab">см</span><span class="field"><input id="door-w" type="number" min="1" placeholder="Как кузов"></span></label>
        <label>Высота, <span class="ulab">см</span><span class="field"><input id="door-h" type="number" min="1" placeholder="Как кузов"></span></label>
      </div>
    </details>
    <label class="opt"><input id="full-support" type="checkbox"> Требовать полную опору штабеля</label>
    <button type="button" id="demo" class="demo">Загрузить пример рейса</button>
  </section>

  <section id="sec-cargo">
    <h2>Добавить груз</h2>
    <label>Название
      <span class="field"><input id="c-name" type="text" placeholder="Например, паллета"></span>
    </label>
    <div class="lbl">Тип упаковки: <b id="type-name">Паллета</b></div>
    <div class="types" id="types" role="radiogroup" aria-label="Тип упаковки"></div>
    <div class="row2">
      <label>Длина, <span class="ulab">см</span><span class="field"><input id="c-l" type="number" min="1" step="1" value="120"></span></label>
      <label>Ширина, <span class="ulab">см</span><span class="field"><input id="c-w" type="number" min="1" step="1" value="80"></span></label>
      <label>Высота, <span class="ulab">см</span><span class="field"><input id="c-h" type="number" min="1" step="1" value="150"></span></label>
    </div>
    <label style="margin-top:10px">Количество
      <span class="field"><input id="c-q" type="number" min="1" max="1000" step="1" value="1"><span class="unit">шт</span></span>
    </label>
    <div class="plan-fields">
      <label>Масса места, кг<span class="field"><input id="c-kg" type="number" min="0.01" step="0.01" placeholder="Не указана"></span></label>
      <label>Точка выгрузки<span class="field"><input id="c-stop" type="number" min="1" step="1" value="1"></span></label>
    </div>
    <button type="button" id="add" class="btn-main">Добавить груз</button>
    <div class="err" id="err" role="alert"></div>
  </section>
  </div>

  <div class="col" id="views-col">
  <div class="mtabs" role="tablist" aria-label="Вид кузова">
    <button type="button" role="tab" data-mv="top" class="on" aria-selected="true">Сверху</button>
    <button type="button" role="tab" data-mv="l" aria-selected="false">Левый борт</button>
    <button type="button" role="tab" data-mv="r" aria-selected="false">Правый борт</button>
  </div>
  <span class="rot-msg" id="rot-msg" role="status"></span>
  <section id="sec-views">
    <div class="viewbar">
      <p class="view-title">Вид сверху</p>
      <button type="button" id="rot" disabled>Повернуть (R)</button>
    </div>
    <div class="canvas"><svg id="top" viewBox="0 0 900 300" role="img" aria-label="Кузов, вид сверху"></svg></div>
  </section>

  <section id="sec-side-l">
    <p class="view-title">Вид сбоку: левый борт</p>
    <div class="canvas"><svg id="side-l" viewBox="0 0 900 300" role="img" aria-label="Кузов, левый борт"></svg></div>
  </section>

  <section id="sec-side-r">
    <p class="view-title">Вид сбоку: правый борт</p>
    <div class="canvas"><svg id="side-r" viewBox="0 0 900 300" role="img" aria-label="Кузов, правый борт"></svg></div>
  </section>
  </div>

  <section id="sec-total">
    <h2>Груз</h2>
    <div class="tbl-wrap" id="tbl"></div>
    <div class="total" id="total"></div>
    <p class="hint">Точка 1 выгружается первой через задние двери. Расчёт учитывает габариты и общую массу. Нагрузку на оси и крепление проверяют отдельно.</p>
    <div class="actions">
      <button type="button" id="auto">Разложить автоматически</button>
      <button type="button" id="clear">Убрать все из кузова</button>
    </div>
    <div class="autoinfo" id="autoinfo" role="status"></div>
    <p class="hint" id="storage-status" role="status" hidden></p>
    <div class="export">
      <div class="lbl">Выгрузка схемы</div>
      <div class="actions">
        <button type="button" id="png" disabled>Картинка PNG</button>
        <button type="button" id="pdf" disabled>Файл PDF</button>
      </div>
    </div>
  </section>
</main>

<div class="tray" id="tray" hidden>
  <button type="button" class="tbtn" id="tauto">Авто</button>
  <button type="button" class="tbtn" id="trot" disabled>Повернуть</button>
  <div class="tchips" id="tchips" aria-label="Груз для перетаскивания"></div>
</div>
</div>
`,pn=`.cargo-root {
    color-scheme: light;
    --bg: #151413;
    --card: #1d1c1a;
    --ink: #ece6d3;
    --cream: #f9e8ac;
    --muted: #9b9484;
    --line: rgba(249, 232, 172, 0.1);
    --fill: rgba(249, 232, 172, 0.06);
    --fill-hover: rgba(249, 232, 172, 0.12);
    --red: #c2433c;
    --accent: #e0584f;
    --danger: #ff6a5a;
    --olive: #8a8120;
    --select: #ffffff;
    --body-fill: #191816;
    --grid: rgba(249, 232, 172, 0.08);
    --frame: #7d7767;
    --display: "Sofia Sans Extra Condensed", "Fira Sans Extra Condensed", "Arial Narrow", Impact, sans-serif;
    --mono: "IBM Plex Mono", "JetBrains Mono", ui-monospace, Consolas, monospace;
    --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  .cargo-root {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 400 14px/1.5 var(--sans); -webkit-font-smoothing: antialiased;
  }
  /* зерно, как на бумаге в брендбуке */


  /* верхняя панель */
  .bar {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    height: 60px; padding: 0 24px;
    background: var(--card); border-bottom: 1px solid var(--line);
    -webkit-backdrop-filter: saturate(160%) blur(20px); backdrop-filter: saturate(160%) blur(20px);
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .dot { width: 12px; height: 12px; border-radius: 4px; background: var(--red); }
  .logo { font: 900 30px/1 var(--display); letter-spacing: 0.01em; text-transform: lowercase; color: var(--cream); }
  .badge { padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; font: 500 10px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }

  .seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--fill); }
  .seg button { margin: 0; padding: 6px 20px; border: 0; border-radius: 999px; background: transparent; font: 600 13px var(--sans); color: var(--muted); }
  .seg button:hover { color: var(--ink); background: transparent; }
  .seg button.on, .seg button.on:hover { background: var(--cream); color: #fff; }

  main {
    display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) minmax(310px, 400px); gap: 16px; align-items: start;
    max-width: 1560px; margin: 0 auto; padding: 20px 24px 48px;
  }
  .mtabs, .tray { display: none; }
  @media (max-width: 1100px) {
    main { grid-template-columns: 1fr; padding: 10px 12px 120px; gap: 14px; }
    .bar { padding: 0 14px; }
    section { padding: 14px; }
    #views-col { order: -1; gap: 10px; }
    /* на телефоне показываем один вид, а груз лежит в ленте внизу экрана */
    #sec-views, #sec-side-l, #sec-side-r { display: none; }
    .cargo-root[data-mv="top"] #sec-views, .cargo-root[data-mv="l"] #sec-side-l, .cargo-root[data-mv="r"] #sec-side-r { display: block; }
    .mtabs { display: flex; gap: 6px; position: sticky; top: 60px; z-index: 15; padding: 8px 0; background: var(--bg); }
    .mtabs button { flex: 1; margin: 0; padding: 10px 6px; border: 1px solid var(--line); border-radius: 999px; background: transparent; font: 600 13px var(--sans); color: var(--muted); }
    .mtabs button.on { border-color: var(--cream); background: var(--cream); color: #151413; }
    .tray:not([hidden]) {
      display: flex; align-items: center; gap: 8px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      background: rgba(21, 20, 19, 0.9); border-top: 1px solid var(--line);
      -webkit-backdrop-filter: saturate(160%) blur(20px); backdrop-filter: saturate(160%) blur(20px);
    }
    .tbtn { flex: none; margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; font: 600 12px var(--sans); }
    .tchips { display: flex; flex: 1; gap: 10px; overflow-x: auto; padding: 8px 6px 4px 2px; touch-action: pan-x; -webkit-overflow-scrolling: touch; }
    .tchip { position: relative; flex: none; display: grid; place-items: center; width: 56px; height: 56px; border: 1px solid; border-radius: 14px; color: var(--cream); touch-action: none; cursor: grab; }
    .tchip .pk-i { width: 28px; height: 28px; }
    .tchip.off { opacity: 0.3; cursor: not-allowed; }
    .tchip .cnt { position: absolute; top: -7px; right: -7px; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 11px; background: var(--cream); color: #151413; font: 600 11px/21px var(--mono); text-align: center; }
  }
  .col { display: grid; gap: 16px; min-width: 0; }
  main > section { min-width: 0; }
  section { margin: 0; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--card); }

  h2, .view-title {
    margin: 0 0 16px; font: 500 12px/1.2 var(--mono); letter-spacing: 0.18em; text-transform: uppercase; color: var(--cream);
  }

  label { display: block; margin-bottom: 12px; font: 500 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .field { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  input[type="number"], input[type="text"] {
    width: 100%; padding: 10px 12px; border: 1px solid transparent; border-radius: 10px; background: var(--fill);
    font: 500 15px var(--mono); letter-spacing: 0; text-transform: none; color: var(--ink);
    transition: border-color .15s, box-shadow .15s, background .15s;
  }
  input::placeholder { color: var(--muted); opacity: 0.7; font-weight: 400; }
  input:focus { outline: none; border-color: rgba(249, 232, 172, 0.55); background: var(--fill-hover); box-shadow: 0 0 0 3px rgba(249, 232, 172, 0.12); }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--cream); outline-offset: 2px; }
  .unit { min-width: 24px; font: 500 12px var(--mono); letter-spacing: 0; text-transform: none; color: var(--muted); }

  .info { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
  .info b { color: var(--ink); font-weight: 600; }

  button {
    margin: 0 6px 6px 0; padding: 8px 14px; border: 1px solid transparent; border-radius: 10px; background: var(--fill);
    font: 500 13px var(--sans); letter-spacing: 0; text-transform: none; color: var(--ink); cursor: pointer;
    transition: background .15s, color .15s, border-color .15s, transform .1s;
  }
  button:hover { background: var(--fill-hover); }
  button:active { transform: scale(0.98); }
  button:disabled { opacity: 0.35; cursor: default; }
  button:disabled:hover { background: var(--fill); }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .presets button { margin: 0; padding: 6px 12px; border-radius: 999px; font-size: 12.5px; }

  .btn-main {
    display: block; width: 100%; margin: 16px 0 0; padding: 13px 20px; border: 0; border-radius: 12px;
    background: var(--red); color: #fff7e0; font: 600 14px var(--sans); text-align: center;
  }
  .btn-main:hover { background: #3d4958; }
  .err { min-height: 18px; margin-top: 10px; font-size: 13px; color: var(--danger); }

  .types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .types button { display: grid; place-items: center; width: 46px; height: 46px; margin: 0; padding: 0; border-radius: 12px; color: var(--muted); }
  .types button:hover { color: var(--ink); }
  .types button.on { border-color: var(--cream); background: rgba(249, 232, 172, 0.12); color: var(--cream); }
  .lbl { margin-bottom: 8px; font: 500 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .lbl b { color: var(--cream); font-weight: 600; }
  .pk-i { display: block; width: 24px; height: 24px; }

  .row2 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .row2 label { margin-bottom: 0; }
  .row2 input { padding: 10px 8px; }

  .viewbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .viewbar .view-title { margin: 0 auto 0 0; }
  .viewbar button { margin: 0; }
  .rot-msg:empty { display: none; }
  .rot-msg { font-size: 12.5px; color: var(--danger); }

  .canvas { padding: 12px 12px 2px; border: 1px solid var(--line); border-radius: 12px; background: #11100f; }
  #top { overflow: visible; }
  svg { display: block; width: 100%; height: auto; }
  svg text { fill: var(--muted); font-family: var(--mono); font-size: 12px; letter-spacing: 0; }
  svg .unit { cursor: grab; touch-action: none; }

  .tbl-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { padding: 0 4px 10px; text-align: left; font: 500 10px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line); }
  td { padding: 10px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  td:nth-child(3) { font: 400 12px var(--mono); color: var(--muted); white-space: nowrap; }
  td input[type="number"] { width: 58px; padding: 6px 8px; font-size: 14px; }
  .nm { overflow-wrap: anywhere; font-weight: 600; color: var(--ink); }
  .sub { font-size: 12px; color: var(--muted); }
  .miss { margin-top: 2px; font-size: 12px; color: var(--danger); }
  .del { width: 28px; height: 28px; margin: 0; padding: 0; border-radius: 50%; background: transparent; font-size: 17px; line-height: 1; color: var(--muted); }
  .del:hover { background: var(--fill-hover); color: var(--danger); }
  .empty { padding: 4px 0; color: var(--muted); }
  .hint { margin: 0 0 14px; font-size: 12px; color: var(--muted); }
  .total { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
  .total b { color: var(--ink); font-weight: 600; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .actions button { margin: 0; }
  #auto { background: var(--cream); color: #fff; font-weight: 600; }
  #auto:hover { background: #3d4958; }
  #clear { background: transparent; color: var(--accent); }
  #clear:hover { background: var(--fill); }
  .export { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
  .export .actions { margin-top: 4px; }
  .autoinfo { margin-top: 10px; font: 400 12px var(--mono); color: var(--cream); }

  /* плитка груза: значок типа в цвете груза, ее же можно тянуть в кузов */
  .chip { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid transparent; border-radius: 10px; cursor: grab; touch-action: none; }
  .chip .pk-i { width: 22px; height: 22px; }
  .chip.off { opacity: 0.4; cursor: not-allowed; }
  .ghost { position: fixed; z-index: 50; pointer-events: none; border-radius: 4px; opacity: 0.9; border: 2px solid #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); }
  .ghost.in { opacity: 0; }
  .cargo-root.dragging, .cargo-root.dragging * { cursor: grabbing !important; user-select: none; -webkit-user-select: none; }

  .limrow { display: flex; align-items: center; gap: 4px; margin: 2px 0 0 -4px; font: 400 11px var(--mono); color: var(--accent); white-space: nowrap; }
  .lim { display: inline-grid; place-items: center; width: 22px; height: 22px; margin: 0; padding: 0; border-radius: 6px; background: transparent; color: var(--muted); opacity: 0.7; }
  .lim .pk-i { width: 14px; height: 14px; }
  .lim:hover { opacity: 1; color: var(--ink); background: var(--fill); }
  .lim.on { opacity: 1; color: var(--accent); }
  .limtr td { padding: 0 0 12px; }
  .limbox { padding: 12px 14px 6px; border-radius: 10px; background: var(--fill); }
  .limttl { margin-bottom: 10px; font: 500 10px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  label.opt { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font: 400 13px var(--sans); letter-spacing: 0; text-transform: none; color: var(--ink); }
  label.opt input[type="radio"] { margin: 0; accent-color: var(--cream); }
  label.opt input[type="number"] { width: 60px; padding: 4px 8px; font-size: 13px; }
  @media (max-width: 600px) {
    .bar { gap: 8px; padding-inline: max(14px, env(safe-area-inset-left)) max(14px, env(safe-area-inset-right)); }
    .brand { gap: 6px; }
    .logo { font-size: clamp(16px, 5vw, 21px); }
    .mtabs button, .tbtn { min-height: 44px; }
    #tchips { min-width: 0; }
    input[type="number"], input[type="text"], td input[type="number"], label.opt input[type="number"] { font-size: 16px; }
    .badge { display: none; }
    .seg button { padding: 6px 14px; }
    section { padding: 18px 16px; }
  }


  .cargo-root {
    --bg: #18191b; --card: #212225; --fill: #2b2d31; --fill-hover: #363940;
    --line: #3a3d44; --ink: #f1f2f4; --muted: #b3b7c0;
    --cream: #e0e9ff; --accent: #c0d4ff; --body-fill: #1b1d22;
    --display: var(--sans);
  }

  @media (max-width: 600px) {
    .logo { font-size: 17px; }
  }

.cargo-root {
  --bg: var(--surface); --card: var(--paper); --ink: #191a20;
  --cream: #27313e; --muted: #565864; --line: #dfe3e8;
  --fill: #f1f3f5; --fill-hover: #e7eaee; --red: #27313e;
  --accent: #375873; --danger: #923632; --select: #27313e;
  --body-fill: #f0f2f4; --grid: #dfe3e8; --frame: #8994a0;
  --display: system-ui, sans-serif; --sans: system-ui, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  .cargo-root *, .cargo-root *::before, .cargo-root *::after { animation: none !important; transition: none !important; }
}
`;function vn(K,Z,tt,st){const at=(t,e)=>window.addEventListener(t,e,{signal:st});var m=function(t){return K.getElementById(t)},T=m("top"),Mt="http://www.w3.org/2000/svg",it=900,F=[],Et=new Map,y=[],ct=1,Wt=1,zt=1e3,_t="cargoPlanV1";function Gt(t,e){return Number.isSafeInteger(t)&&t>=1&&y.length-e+t<=zt}var ut={x0:50,y0:40,scale:1},ft={},h=null,et=null,Rt="",Kt="";function gt(t){return'<svg class="pk-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+t+"</svg>"}var nt=[{id:"pallet",name:"Паллета",svg:gt('<rect x="5.5" y="3.5" width="13" height="12"/><path d="M12 3.5v12M5.5 9.5h13"/><rect x="3" y="15.5" width="18" height="2.5"/><path d="M4.5 18v2.5h3V18M10.5 18v2.5h3V18M16.5 18v2.5h3V18"/>')},{id:"box",name:"Коробка",svg:gt('<path d="M12 2.5l9 4.5v10l-9 4.5-9-4.5V7z"/><path d="M3 7l9 4.5L21 7M12 11.5v10"/><path d="M9 4l9 4.5M6 5.5l9 4.5"/>')},{id:"bag",name:"Мешок",svg:gt('<path d="M8.5 7C7 5.5 7.5 3 10 3c1 0 1.3.8 2 .8s1-.8 2-.8c2.5 0 3 2.5 1.5 4"/><rect x="8.2" y="7" width="7.6" height="2" rx="1"/><path d="M8 9C5 11 4.5 15 4.8 17.5L3.8 20.2c-.2.7.3 1.1 1 1.1h14.4c.7 0 1.2-.4 1-1.1l-1-2.7C19.5 15 19 11 16 9"/><path d="M12 11.8v3.4"/>')},{id:"barrel",name:"Бочка",svg:gt('<ellipse cx="12" cy="5" rx="7" ry="2.3"/><path d="M5 5v13.5M19 5v13.5"/><path d="M5 18.5c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3"/><path d="M5 11.8c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3"/><path d="M15.4 4.6h1.8"/>')},{id:"roll",name:"Рулон",svg:gt('<ellipse cx="7" cy="5.5" rx="4" ry="2"/><ellipse cx="7" cy="5.5" rx="1.5" ry=".8"/><path d="M3 5.5V19c0 1.1 1.8 2 4 2s4-.9 4-2V5.5"/><path d="M9.5 3.7H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-9"/>')}];nt.forEach(function(t){t.body=t.svg.replace(/^<svg[^>]*>/,"").replace(/<\/svg>$/,"")});var yt="pallet",St=null,Be='<svg class="pk-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/></svg>';function pt(t){for(var e=0;e<nt.length;e++)if(nt[e].id===t)return nt[e];return nt[0]}function C(t,e,n){var r=document.createElementNS(Mt,t);for(var l in e)r.setAttribute(l,e[l]);return n!==void 0&&(r.textContent=n),r}function Jt(t){return String(t).replace(/[&<>"]/g,function(e){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[e]})}var X="cm";function j(t){return String(X==="m"?+(t/100).toFixed(2):Math.round(t))}function J(t){return X==="m"?String(+(t/100).toFixed(2)).replace(".",",")+" м":Math.round(t)+" см"}function vt(t){return X==="m"?String(+(t/100).toFixed(2)).replace(".",","):String(Math.round(t))}function $(t){var e=Math.round(+m(t).value*(X==="m"?100:1));return Number.isSafeInteger(e)&&e>0?e:0}var Tt={l:1360,w:245,h:250};function rt(){return{l:$("len")||Tt.l,w:$("wid")||Tt.w,h:$("hei")||Tt.h,doorW:$("door-w"),doorH:$("door-h"),payload:$t("payload"),fullSupport:m("full-support").checked===!0}}function $t(t){var e=Math.round(Number(m(t).value)*1e3);return Number.isSafeInteger(e)&&e>0?e:0}function bt(t){return t.stop||1}function wt(t,e,n){return e.w<=(n.doorW||n.w)&&t.h<=(n.doorH||n.h)}function ht(t,e){var n=B(t),r=B(e),l=Math.min(t.x+n.l,e.x+r.l)-Math.max(t.x,e.x),a=Math.min(t.y+n.w,e.y+r.w)-Math.max(t.y,e.y);return l>0&&a>0?l*a:0}function _(t){return(t.z||0)+I(t.cid).h}function Lt(){for(var t=0;t<y.length;t++)if(y[t].uid===et&&y[t].placed)return y[t];return null}function I(t){return Et.get(t)||null}var Qt=[{f:"#f9e8ac",l:"#fff4cb",s:"#b9a85d",t:"#151413"},{f:"#d9534a",l:"#ea7a71",s:"#8e2a24",t:"#ffffff"},{f:"#a8a02e",l:"#c4bc4a",s:"#6a6410",t:"#151413"},{f:"#ede9e1",l:"#faf8f3",s:"#9a958a",t:"#151413"},{f:"#dd8b4c",l:"#eba676",s:"#8e5424",t:"#151413"},{f:"#8fa58b",l:"#adc2a9",s:"#4d6449",t:"#151413"},{f:"#b7a0c0",l:"#cfbbd6",s:"#6e5a77",t:"#151413"}];function Q(t){return Qt[(t.id-1)%Qt.length]}function Bt(t,e){return t.h<=e.h&&[!1,!0].some(function(n){var r=ot(t,n);return r.l<=e.l&&r.w<=e.w&&wt(t,r,e)})}function B(t){var e=I(t.cid);return t.rot?{l:e.w,w:e.l}:{l:e.l,w:e.w}}function G(t,e,n){return Math.min(Math.max(t,e),n)}function Zt(){Et=new Map(F.map(function(t){return[t.id,t]})),y=y.filter(function(t){return I(t.cid)}),F.forEach(function(t){for(var e=y.filter(function(o){return o.cid===t.id});e.length<t.q;){var n={uid:Wt++,cid:t.id,x:0,y:0,placed:!1,out:!1,rot:!1,z:0};y.push(n),e.push(n)}for(;e.length>t.q;){for(var r=-1,l=e.length-1;l>=0;l--)if(!e[l].placed){r=l;break}r<0&&(r=e.length-1);var a=e.splice(r,1)[0];y.splice(y.indexOf(a),1)}})}function Ue(t){y.forEach(function(e){if(e.placed){var n=I(e.cid),r=B(e);if(n.h>t.h||r.l>t.l||r.w>t.w||(e.z||0)+n.h>t.h){e.placed=!1,e.out=!1,e.z=0;return}e.x=G(e.x,0,t.l-r.l),e.y=G(e.y,0,t.w-r.w)}})}function te(){for(var t={},e=y.filter(function(s){return s.placed&&!s.out}),n=0;n<e.length;n++)for(var r=n+1;r<e.length;r++){var l=e[n],a=e[r],o=B(l),i=B(a);l.x<a.x+i.l-.01&&a.x<l.x+o.l-.01&&l.y<a.y+i.w-.01&&a.y<l.y+o.w-.01&&(l.z||0)<_(a)-.01&&(a.z||0)<_(l)-.01&&(t[l.uid]=!0,t[a.uid]=!0)}return t}function Ut(t,e,n,r){var l=t%10,a=t%100;return l===1&&a!==11?e:l>=2&&l<=4&&(a<10||a>=20)?n:r}function Ft(){var t=y.filter(function(r){return r.placed&&!r.out}),e=[],n={};return t.filter(function(r){return!(r.z>0)}).forEach(function(r){var l={base:r,units:[r],top:_(r)};e.push(l),n[r.uid]=l}),t.filter(function(r){return r.z>0}).sort(function(r,l){return r.z-l.z}).forEach(function(r){var l=null,a=0;e.forEach(function(o){var i=ht(r,o.base);i>a&&(a=i,l=o)}),l&&(l.units.push(r),l.top=Math.max(l.top,_(r)),n[r.uid]=l)}),{stacks:e,map:n}}function Fe(t){var e=t.units.length,n={},r=[];t.units.forEach(function(a){if(a!==t.base){var o=I(a.cid).name;n[o]||(n[o]=0,r.push(o)),n[o]++}});var l=["Внизу: "+I(t.base.cid).name];return r.length&&l.push("Сверху: "+r.map(function(a){return a+" ×"+n[a]}).join(", ")),l.push("Всего "+e+" "+Ut(e,"место","места","мест")+", высота "+J(t.top)),l.join(`
`)}function je(t,e,n,r,l){var a=r/24,o=C("g",{transform:"translate("+(e-r/2)+" "+(n-r/2)+") scale("+a+")",fill:"none",stroke:l,"stroke-width":(1.6/a).toFixed(2),"stroke-linecap":"round","stroke-linejoin":"round","pointer-events":"none"});return o.innerHTML=pt(t).body,o}function ee(t,e,n,r,l,a,o){var i=r+a/2,s=l+o/2,p=a>=64&&o>=46,c=a>=30&&o>=30;if(c){var d=Math.min(22,a-12,o-(p?28:12));d>=12&&t.appendChild(je(e.type,i,p?s-7:s,d,n.l))}if(p||!c&&a>44&&o>18){var u=Math.max(Math.floor((a-8)/6.5),1),k=e.name.length>u?e.name.slice(0,Math.max(u-1,1))+"…":e.name;t.appendChild(C("text",{x:i,y:p?s+17:s+4,"text-anchor":"middle",style:"fill:"+n.l+";font-size:11px;font-weight:600;pointer-events:none"},k))}}function ne(t,e,n,r,l){var a="gl-"+t.id,o=C("defs",{}),i=C("linearGradient",{id:a,x1:"0",y1:"0",x2:"1",y2:"1"});i.appendChild(C("stop",{offset:"0","stop-color":"#ffffff","stop-opacity":"0.09"})),i.appendChild(C("stop",{offset:"0.5","stop-color":"#ffffff","stop-opacity":"0.02"})),i.appendChild(C("stop",{offset:"1","stop-color":"#ffffff","stop-opacity":"0"})),o.appendChild(i),t.appendChild(o),t.appendChild(C("rect",{x:e,y:n,width:r,height:l,rx:3,fill:"url(#"+a+")","pointer-events":"none"}))}function At(t){var e=50,n=20,r=40,l=50,a=it-e-n,o=420,i=Math.min(a/t.l,o/t.w),s=t.l*i,p=t.w*i,c=r+p+l,d=e,u=r;for(ut={x0:d,y0:u,scale:i},T.setAttribute("viewBox","0 0 "+it+" "+c);T.firstChild;)T.removeChild(T.firstChild);for(var k=C("g",{stroke:"var(--grid)","stroke-width":1}),x=100;x<t.l;x+=100)k.appendChild(C("line",{x1:d+x*i,y1:u,x2:d+x*i,y2:u+p}));for(var f=100;f<t.w;f+=100)k.appendChild(C("line",{x1:d,y1:u+f*i,x2:d+s,y2:u+f*i}));T.appendChild(C("rect",{x:d,y:u,width:s,height:p,rx:3,fill:"var(--body-fill)"})),ne(T,d,u,s,p),T.appendChild(k),T.appendChild(C("rect",{x:d,y:u,width:s,height:p,rx:3,fill:"none",stroke:"var(--frame)","stroke-width":2.5}));var b=y.some(function(w){return w.placed});b||T.appendChild(C("text",{x:d+s/2,y:u+p/2+5,"text-anchor":"middle",style:"font-size:17px"},F.length?"Перетащи груз из таблицы сюда":"Добавь груз в форме «Добавить груз»"));var g=te(),S=oe(),A=Ft();if(y.slice().sort(function(w,R){return(w.z||0)-(R.z||0)}).forEach(function(w){if(w.placed){var R=I(w.cid),z=B(w),E=Q(R),H=d+w.x*i,U=u+w.y*i,M=z.l*i,N=z.w*i,D=!!g[w.uid]||!!S[w.uid],W=w.uid===et,q=C("g",{"data-uid":w.uid,class:"unit",opacity:w.out?.5:1});A.map[w.uid]&&q.appendChild(C("title",{},Fe(A.map[w.uid]))),q.appendChild(C("rect",{x:H+.75,y:U+.75,width:Math.max(M-1.5,1),height:Math.max(N-1.5,1),rx:2,fill:"var(--body-fill)"})),q.appendChild(C("rect",{x:H+.75,y:U+.75,width:Math.max(M-1.5,1),height:Math.max(N-1.5,1),rx:2,fill:E.f,"fill-opacity":(w.z||0)>0?.3:.17,stroke:D?"var(--danger)":(w.z||0)>0?E.l:E.f,"stroke-width":D?3:1.5})),W&&q.appendChild(C("rect",{x:H-2.5,y:U-2.5,width:M+5,height:N+5,rx:4,fill:"none",stroke:"var(--select)","stroke-width":2.5,"pointer-events":"none"})),ee(q,R,E,H,U,M,N),T.appendChild(q)}}),A.stacks.forEach(function(w){var R=w.units.length;if(!(R<2)){var z=B(w.base),E=d+w.base.x*i,H=u+w.base.y*i,U=z.l*i,M=z.w*i,N="×"+R,D=10+N.length*6.4;U<D+6||M<18||(T.appendChild(C("rect",{x:E+U-D-3,y:H+3,width:D,height:14,rx:2,fill:"#000","fill-opacity":.8,stroke:"var(--accent)","stroke-width":1,"pointer-events":"none"})),T.appendChild(C("text",{x:E+U-D/2-3,y:H+13.5,"text-anchor":"middle",style:"fill:var(--accent);font-size:10px;font-weight:700;pointer-events:none"},N)))}}),h&&h.preview){var L=h.preview,P=B(L),V=Q(I(L.cid));T.appendChild(C("rect",{x:d+L.x*i,y:u+L.y*i,width:P.l*i,height:P.w*i,rx:2,fill:V.f,"fill-opacity":.35,stroke:V.f,"stroke-width":1.5,"stroke-dasharray":"5 4"}))}h&&h.guides&&(h.guides.gx!==null&&T.appendChild(C("line",{x1:d+h.guides.gx*i,y1:u,x2:d+h.guides.gx*i,y2:u+p,stroke:"var(--accent)","stroke-width":1.5,"stroke-dasharray":"4 4"})),h.guides.gy!==null&&T.appendChild(C("line",{x1:d,y1:u+h.guides.gy*i,x2:d+s,y2:u+h.guides.gy*i,stroke:"var(--accent)","stroke-width":1.5,"stroke-dasharray":"4 4"}))),T.appendChild(C("line",{x1:d+s,y1:u+6,x2:d+s,y2:u+p-6,stroke:"var(--accent)","stroke-width":4,"stroke-linecap":"round"})),T.appendChild(C("text",{x:d+s,y:u-10,"text-anchor":"end"},"Двери")),T.appendChild(C("text",{x:d,y:u-10},"Кабина"));var O=u+p+26;T.appendChild(C("line",{x1:d,y1:O,x2:d+s,y2:O,stroke:"var(--muted)"})),T.appendChild(C("line",{x1:d,y1:O-5,x2:d,y2:O+5,stroke:"var(--muted)"})),T.appendChild(C("line",{x1:d+s,y1:O-5,x2:d+s,y2:O+5,stroke:"var(--muted)"})),T.appendChild(C("text",{x:d+s/2,y:O+18,"text-anchor":"middle"},"Длина "+J(t.l)));var v=d-18;T.appendChild(C("line",{x1:v,y1:u,x2:v,y2:u+p,stroke:"var(--muted)"})),T.appendChild(C("line",{x1:v-5,y1:u,x2:v+5,y2:u,stroke:"var(--muted)"})),T.appendChild(C("line",{x1:v-5,y1:u+p,x2:v+5,y2:u+p,stroke:"var(--muted)"})),T.appendChild(C("text",{x:v-8,y:u+p/2,"text-anchor":"middle",transform:"rotate(-90 "+(v-8)+" "+(u+p/2)+")"},"Ширина "+J(t.w))),re(m("side-l"),!1,t),re(m("side-r"),!0,t)}function re(t,e,n){var r=50,l=20,a=40,o=50,i=Math.min((it-r-l)/n.l,260/n.h),s=n.l*i,p=n.h*i,c=r,d=a,u=d+p;for(ft[e?"r":"l"]={x0:c,base:u,scale:i,flip:e},t.setAttribute("viewBox","0 0 "+it+" "+(a+p+o));t.firstChild;)t.removeChild(t.firstChild);for(var k=C("g",{stroke:"var(--grid)","stroke-width":1}),x=100;x<n.l;x+=100)k.appendChild(C("line",{x1:c+x*i,y1:d,x2:c+x*i,y2:u}));for(var f=100;f<n.h;f+=100)k.appendChild(C("line",{x1:c,y1:u-f*i,x2:c+s,y2:u-f*i}));t.appendChild(C("rect",{x:c,y:d,width:s,height:p,rx:3,fill:"var(--body-fill)"})),ne(t,c,d,s,p),t.appendChild(k),t.appendChild(C("rect",{x:c,y:d,width:s,height:p,rx:3,fill:"none",stroke:"var(--frame)","stroke-width":2.5}));var b=y.filter(function(w){return w.placed&&!w.out});if(b.sort(function(w,R){return(e?R.y-w.y:w.y-R.y)||(w.z||0)-(R.z||0)}),b.forEach(function(w){var R=I(w.cid),z=B(w),E=Q(R),H=w.uid===et,U=e?n.l-w.x-z.l:w.x,M=c+U*i,N=z.l*i,D=R.h*i,W=u-((w.z||0)+R.h)*i,q=C("g",{"data-uid":w.uid,class:"unit"});q.appendChild(C("rect",{x:M+.75,y:W+.75,width:Math.max(N-1.5,1),height:Math.max(D-1.5,1),rx:2,fill:"var(--body-fill)"})),q.appendChild(C("rect",{x:M+.75,y:W+.75,width:Math.max(N-1.5,1),height:Math.max(D-1.5,1),rx:2,fill:E.f,"fill-opacity":(w.z||0)>0?.3:.17,stroke:(w.z||0)>0?E.l:E.f,"stroke-width":1.5})),H&&q.appendChild(C("rect",{x:M-2.5,y:W-2.5,width:N+5,height:D+5,rx:4,fill:"none",stroke:"var(--select)","stroke-width":2.5,"pointer-events":"none"})),ee(q,R,E,M,W,N,D),t.appendChild(q)}),h&&h.preview){var g=h.preview,S=B(g),A=I(g.cid),L=Q(A),P=e?n.l-g.x-S.l:g.x;t.appendChild(C("rect",{x:c+P*i,y:u-((g.z||0)+A.h)*i,width:S.l*i,height:A.h*i,rx:2,fill:L.f,"fill-opacity":.35,stroke:L.f,"stroke-width":1.5,"stroke-dasharray":"5 4","pointer-events":"none"}))}var V=e?c:c+s;t.appendChild(C("line",{x1:V,y1:d+6,x2:V,y2:u-6,stroke:"var(--accent)","stroke-width":4,"stroke-linecap":"round"})),t.appendChild(C("text",{x:e?c+s:c,y:d-10,"text-anchor":e?"end":"start"},"Кабина")),t.appendChild(C("text",{x:e?c:c+s,y:d-10,"text-anchor":e?"start":"end"},"Двери"));var O=u+26;t.appendChild(C("line",{x1:c,y1:O,x2:c+s,y2:O,stroke:"var(--muted)"})),t.appendChild(C("line",{x1:c,y1:O-5,x2:c,y2:O+5,stroke:"var(--muted)"})),t.appendChild(C("line",{x1:c+s,y1:O-5,x2:c+s,y2:O+5,stroke:"var(--muted)"})),t.appendChild(C("text",{x:c+s/2,y:O+18,"text-anchor":"middle"},"Длина "+J(n.l)));var v=c-18;t.appendChild(C("line",{x1:v,y1:d,x2:v,y2:u,stroke:"var(--muted)"})),t.appendChild(C("line",{x1:v-5,y1:d,x2:v+5,y2:d,stroke:"var(--muted)"})),t.appendChild(C("line",{x1:v-5,y1:u,x2:v+5,y2:u,stroke:"var(--muted)"})),t.appendChild(C("text",{x:v-8,y:d+p/2,"text-anchor":"middle",transform:"rotate(-90 "+(v-8)+" "+(d+p/2)+")"},"Высота "+J(n.h)))}function He(t){var e=m("tray");if(!F.length){e.hidden=!0;return}e.hidden=!1,m("tchips").innerHTML=F.map(function(n){var r=n.q-y.filter(function(o){return o.cid===n.id&&o.placed}).length,l=r>0&&Bt(n,t),a=Q(n);return'<div class="tchip'+(l?"":" off")+'" '+(l?'data-chip="'+n.id+'" ':"")+'style="border-color:'+a.f+";background:"+a.f+'2e" title="'+Jt(n.name)+'">'+pt(n.type).svg+'<span class="cnt">'+r+"</span></div>"}).join("")}function De(t){He(t);var e=m("tbl");if(!F.length){e.innerHTML='<div class="empty">Груза пока нет. Заполни форму «Добавить груз» и нажми кнопку.</div>',m("total").innerHTML="";return}var n='<p class="hint">Тяни цветную плитку в кузов. Груз притягивается к стенкам и к другому грузу. Клик по грузу выбирает его, кнопка R поворачивает. Груз можно ставить на груз: брось его на другой так, чтобы он опирался хотя бы наполовину. Чтобы убрать груз из кузова, вынеси его за пределы.</p><table><thead><tr><th></th><th>Груз</th><th>Д×Ш×В, '+(X==="m"?"м":"см")+"</th><th>Шт</th><th></th></tr></thead><tbody>",r=0;F.forEach(function(g){r+=g.q;var S=y.filter(function(v){return v.cid===g.id&&v.placed}).length,A=g.q-S,L=Bt(g,t),P=A>0&&L,V=g.limit===0?"сверху нельзя":g.limit>0?"сверху до "+g.limit:"";if(n+='<tr><td><span class="chip'+(P?"":" off")+'" '+(P?'data-chip="'+g.id+'" ':"")+'style="background:'+Q(g).f+"2a;border-color:"+Q(g).f+"70;color:"+Q(g).l+'" title="'+pt(g.type).name+(P?": перетащи в кузов":"")+'">'+pt(g.type).svg+'</span></td><td><div class="nm"><span>'+Jt(g.name)+"</span></div>"+(L?'<div class="sub">в кузове '+S+" из "+g.q+"</div>":'<div class="miss">не помещается в кузов</div>')+'<div class="sub">Точка '+bt(g)+(g.grams?" · "+g.grams/1e3+" кг/место":"")+'</div><div class="limrow"><button type="button" class="lim'+(g.limit!==null?" on":"")+'" data-lim="'+g.id+'" title="Ограничения: что можно ставить сверху" aria-label="Ограничения штабелирования" aria-expanded="'+(St===g.id)+'">'+Be+"</button>"+(V?"<span>"+V+"</span>":"")+"</div></td><td>"+vt(g.l)+"×"+vt(g.w)+"×"+vt(g.h)+'</td><td><input type="number" min="1" step="1" value="'+g.q+'" data-id="'+g.id+'" aria-label="Количество"></td><td><button type="button" class="del" data-del="'+g.id+'" aria-label="Удалить">×</button></td></tr>',St===g.id){var O=g.limit===null?"free":g.limit===0?"none":"max";n+='<tr class="limtr"><td colspan="5"><div class="limbox"><div class="limttl">Что можно ставить сверху</div><label class="opt"><input type="radio" name="lim-'+g.id+'" value="free" data-limid="'+g.id+'"'+(O==="free"?" checked":"")+'> Без ограничений</label><label class="opt"><input type="radio" name="lim-'+g.id+'" value="none" data-limid="'+g.id+'"'+(O==="none"?" checked":"")+'> Нельзя ставить сверху</label><label class="opt"><input type="radio" name="lim-'+g.id+'" value="max" data-limid="'+g.id+'"'+(O==="max"?" checked":"")+'> Сверху не более <input type="number" min="1" step="1" class="limn" data-limn="'+g.id+'" value="'+(g.limit>0?g.limit:5)+'" aria-label="Сколько мест сверху"> мест</label></div></td></tr>'}}),n+="</tbody></table>",e.innerHTML=n;var l=t.l*t.w*t.h/1e6,a=0,o=0,i=0,s=0,p=0,c=new Map;y.forEach(function(g){if(g.placed){var S=I(g.cid);a++,g.z>0||(o+=S.l*S.w),i+=S.l*S.w*S.h/1e6,S.grams?s+=S.grams:p++;var A=bt(S),L=c.get(A)||{min:1/0,max:0};L.min=Math.min(L.min,g.x),L.max=Math.max(L.max,g.x+B(g).l),c.set(A,L)}});var d=t.l,u=Array.from(c.keys()).sort(function(g,S){return g-S}).some(function(g){var S=c.get(g),A=S.max>d;return d=S.min,A}),k=Object.keys(te()).length,x=Object.keys(oe()).length,f=Ft().stacks.filter(function(g){return g.units.length>1}),b=null;f.forEach(function(g){(!b||g.top>b.top)&&(b=g)}),m("total").innerHTML="В кузове: <b>"+a+"</b> из "+r+" мест<br>Занято пола: <b>"+(o/(t.l*t.w)*100).toFixed(0)+"%</b><br>Масса: <b>"+(s/1e3).toLocaleString("ru-RU")+" кг</b>"+(t.payload?" / "+(t.payload/1e3).toLocaleString("ru-RU")+" кг":"")+(p?" · без массы: "+p:"")+"<br>"+(u?'<span class="miss">Зоны выгрузки пересекаются по длине кузова.</span><br>':"")+(f.length?"Штабелей: <b>"+f.length+"</b>, самый высокий: <b>"+J(b.top)+"</b> ("+b.units.length+" "+Ut(b.units.length,"место","места","мест")+")<br>":"")+"Объем груза в кузове: <b>"+i.toFixed(2)+"</b> м³ из "+l.toFixed(1)+" м³ ("+(i/l*100).toFixed(0)+"%)"+(x?'<br><span class="miss">Превышен лимит штабелирования: '+x+" "+Ut(x,"место","места","мест")+" (красная рамка)</span>":"")+(k?'<br><span class="miss">Наложения: '+k+" мест лежат друг на друге</span>":"")}function Y(t){var e=rt();if(m("demo").disabled=F.length>0,m("vol").textContent=(e.l*e.w*e.h/1e6).toFixed(1),m("area").textContent=(e.l*e.w/1e4).toFixed(1),Zt(),!t){Tt=e,m("len").value=j(e.l),m("wid").value=j(e.w),m("hei").value=j(e.h);var n=y.filter(function(a){return a.placed}).length;Ue(e),le(e);var r=n-y.filter(function(a){return a.placed}).length;r&&lt("Возвращено в список груза: "+r),cn(e)}et!==null&&!Lt()&&(et=null),m("rot").disabled=!Lt(),m("trot").disabled=!Lt(),At(e),De(e),be();var l=y.some(function(a){return a.placed});m("png").disabled=!l,m("pdf").disabled=!l}function Ot(t){var e=t.closest?t.closest("section"):null;return!e||getComputedStyle(e).display!=="none"}function It(t,e){if(!Ot(T))return{x:-1e9,y:-1e9};var n=T.createSVGPoint();n.x=t,n.y=e;var r=n.matrixTransform(T.getScreenCTM().inverse());return{x:(r.x-ut.x0)/ut.scale,y:(r.y-ut.y0)/ut.scale}}function jt(t,e){return t.x>=0&&t.x<=e.l&&t.y>=0&&t.y<=e.w}function ae(){if(Ot(T))return T.getBoundingClientRect().width/it*ut.scale;for(var t=["l","r"],e=0;e<t.length;e++){var n=de(t[e]);if(ft[t[e]]&&Ot(n))return n.getBoundingClientRect().width/it*ft[t[e]].scale}return 1}function Pt(t,e,n,r,l){var a=14/Math.max(ae(),.05),o=y.filter(function(x){return x.placed&&!x.out&&x.uid!==l}),i=null,s=null,p=e,c=n,d;d=null;function u(x,f){var b=Math.abs(x-e);b<=a&&(d===null||b<d)&&(d=b,p=x,i=f)}u(0,0),u(r.l-t.l,r.l),o.forEach(function(x){var f=B(x);n<x.y+f.w+a&&n+t.w>x.y-a&&(u(x.x+f.l,x.x+f.l),u(x.x-t.l,x.x),u(x.x,x.x),u(x.x+f.l-t.l,x.x+f.l))}),d=null;function k(x,f){var b=Math.abs(x-n);b<=a&&(d===null||b<d)&&(d=b,c=x,s=f)}return k(0,0),k(r.w-t.w,r.w),o.forEach(function(x){var f=B(x);p<x.x+f.l+a&&p+t.l>x.x-a&&(k(x.y+f.w,x.y+f.w),k(x.y-t.w,x.y),k(x.y,x.y),k(x.y+f.w-t.w,x.y+f.w))}),{x:Math.round(G(p,0,r.l-t.l)),y:Math.round(G(c,0,r.w-t.w)),gx:i,gy:s}}function Xe(t,e){for(var n=B(t),r=0;r<10;r++){for(var l=null,a=0;a<y.length;a++){var o=y[a];if(!(o===t||!o.placed||o.out)){var i=B(o);if(t.x<o.x+i.l-.01&&o.x<t.x+n.l-.01&&t.y<o.y+i.w-.01&&o.y<t.y+n.w-.01&&(t.z||0)<_(o)-.01&&(o.z||0)<_(t)-.01){l=o;break}}}if(!l)return;var s=B(l),p=[{x:l.x-n.l,y:t.y,cost:t.x+n.l-l.x},{x:l.x+s.l,y:t.y,cost:l.x+s.l-t.x},{x:t.x,y:l.y-n.w,cost:t.y+n.w-l.y},{x:t.x,y:l.y+s.w,cost:l.y+s.w-t.y}].filter(function(c){return c.x>=0&&c.y>=0&&c.x+n.l<=e.l&&c.y+n.w<=e.w}).sort(function(c,d){return c.cost-d.cost});if(!p.length)return;t.x=p[0].x,t.y=p[0].y}}function ie(t,e){var n=0,r=_(t);return e.forEach(function(l){l!==t&&(l.z||0)>=r-.5&&ht(l,t)>.5&&n++}),n}function Ye(t,e){var n=t.z;t.z=e;var r=y.filter(function(a){return a.placed&&!a.out||a===t}),l=null;return r.forEach(function(a){if(!(l||a===t)){var o=I(a.cid);if(!(o.limit===null||o.limit===void 0)&&e>=_(a)-.5&&ht(t,a)>.5){var i=ie(a,r);i>o.limit&&(l={name:o.name,n:i,limit:o.limit})}}}),t.z=n,l}function oe(){var t={},e=y.filter(function(n){return n.placed&&!n.out});return e.forEach(function(n){var r=I(n.cid);r.limit===null||r.limit===void 0||ie(n,e)>r.limit&&(t[n.uid]=!0)}),t}function dt(t,e){var n=I(t.cid),r=B(t),l=[],a=0;if(t.x<0||t.y<0||t.x+r.l>e.l||t.y+r.w>e.w||n.h>e.h||!wt(n,r,e))return{ok:!1,reason:"bounds"};for(var o=0;o<y.length;o++){var i=y[o];i===t||!i.placed||i.out||ht(t,i)>.5&&l.push(i)}if(!l.length)return{z:0,ok:!0};if(l.some(function(c){return bt(I(c.cid))!==bt(n)}))return{ok:!1,reason:"stop"};l.forEach(function(c){a=Math.max(a,_(c))});var s=0;if(l.forEach(function(c){Math.abs(_(c)-a)<.5&&(s+=ht(t,c))}),a+n.h>e.h)return{z:0,ok:!1,reason:"height"};if(s<(e.fullSupport?1:.5)*r.l*r.w)return{z:0,ok:!1,reason:"support"};var p=Ye(t,a);return p?{z:0,ok:!1,reason:"limit",lim:p}:{z:a,ok:!0}}function Ht(t,e){var n=dt(t,e);if(n.ok)return t.z=n.z,!0;t.z=0,Xe(t,e);var r=dt(t,e);return r.ok?(t.z=r.z,lt("Груз перемещён на соседнее место"),!0):(lt("Здесь груз не помещается с учётом высоты, опоры и ограничений"),!1)}function le(t){var e=y.filter(function(r){return r.placed&&!r.out}).sort(function(r,l){return r.z-l.z||r.uid-l.uid});e.forEach(function(r){r.placed=!1});var n=0;e.forEach(function(r){var l=I(r.cid).grams||0;if(t.payload&&(!l||n+l>t.payload)){r.z=0;return}var a=dt(r,t);a.ok&&a.z<=r.z?(r.placed=!0,r.z=a.z,n+=l):r.z=0})}function se(t,e,n){var r=!(e.l<=n.l&&e.w<=n.w&&wt(e,ot(e,!1),n)),l=r?{l:e.w,w:e.l}:{l:e.l,w:e.w},a=Pt(l,G(t.x-l.l/2,0,n.l-l.l),G(t.y-l.w/2,0,n.w-l.w),n,-1);return a.rot=r,a}function Ve(t){for(var e=0;e<y.length;e++)if(y[e].uid===t)return y[e];return null}function de(t){return m(t==="l"?"side-l":"side-r")}function kt(t,e,n,r){var l=de(t),a=ft[t];if(!Ot(l))return{x:-1e9,z:-1e9};var o=l.createSVGPoint();o.x=e,o.y=n;var i=o.matrixTransform(l.getScreenCTM().inverse()),s=(i.x-a.x0)/a.scale;return{x:a.flip?r.l-s:s,z:(a.base-i.y)/a.scale}}function Dt(t,e){return t.x>=0&&t.x<=e.l&&t.z>=0&&t.z<=e.h}function ce(t){for(var e=0;e<y.length;e++){var n=y[e];if(!(n===t||!n.placed||n.out)&&ht(t,n)>.5&&(t.z||0)<_(n)-.01&&(n.z||0)<_(t)-.01)return!0}return!1}function ue(t,e,n,r){var l=B(t),a=e.w-l.w,o=[0,a],i={},s=null;return y.forEach(function(p){if(!(p===t||!p.placed||p.out)){var c=B(p);o.push(p.y,p.y+c.w,p.y-l.w,p.y+c.w-l.w)}}),o.forEach(function(p){var c=Math.round(G(p,0,a));if(!i[c]){i[c]=!0,t.y=c;var d=dt(t,e);if(d.ok&&(t.z=d.z,!ce(t))){var u=Math.abs(d.z-n)*1e3+Math.abs(c-r);(s===null||u<s.score)&&(s={y:c,z:d.z,score:u})}}}),s}function Xt(t,e,n,r,l){var a=B(t),o={x:t.x,y:t.y,z:t.z},i=Math.round(G(e,0,l.l-a.l));t.x=i;var s=ue(t,l,n,r);if(s){var p=Pt(a,i,s.y,l,t.uid).x;if(p!==i){t.x=p;var c=ue(t,l,n,r);c&&(i=p,s=c)}}return t.x=o.x,t.y=o.y,t.z=o.z,s?{x:i,y:s.y,z:s.z}:null}function Yt(t,e,n){var r=It(t,e);if(jt(r,n))return{kind:"top",p:r};for(var l=["l","r"],a=0;a<l.length;a++)if(ft[l[a]]){var o=kt(l[a],t,e,n);if(Dt(o,n))return{kind:"side",key:l[a],q:o}}return null}function fe(t){for(var e=0;e<y.length;e++)if(y[e].cid===t&&!y[e].placed)return y[e];return null}function pe(t,e,n){var r=fe(e.id);if(!r)return null;var l=!(e.l<=n.l&&e.w<=n.w),a=r.rot;r.rot=l;var o=B(r),i=ft[t.key].flip?0:n.w-o.w,s=Xt(r,t.q.x-o.l/2,t.q.z-e.h/2,i,n);return r.rot=a,s?{u:r,rot:l,x:s.x,y:s.y,z:s.z}:null}function ve(t){var e=I(h.cid),n=ae(),r=Math.max(e.l*n,20),l=Math.max(e.w*n,16),a=h.ghost;a.style.width=r+"px",a.style.height=l+"px",a.style.left=t.clientX-r/2+"px",a.style.top=t.clientY+(h.dy||0)-l/2+"px",a.classList.toggle("in",!!Yt(t.clientX,t.clientY+(h.dy||0),rt()))}function qe(t,e){var n=I(t);e.preventDefault();var r=document.createElement("div");r.className="ghost",r.style.background=Q(n).f+"40",r.style.borderColor=Q(n).f,Z.appendChild(r),Z.classList.add("dragging"),h={type:"new",pointerId:e.pointerId,cid:t,ghost:r,dy:e.pointerType==="touch"?-56:0},ve(e)}function Vt(t){return{x:t.x,y:t.y,z:t.z,rot:t.rot,placed:t.placed,out:t.out}}function We(t,e){for(var n=null,r=0;r<y.length;r++)y[r].uid===t&&(n=y[r]);if(n){e.preventDefault(),et=t,y.splice(y.indexOf(n),1),y.push(n);var l=It(e.clientX,e.clientY);h={type:"unit",pointerId:e.pointerId,u:n,original:Vt(n),gx:l.x-n.x,gy:l.y-n.y},Z.classList.add("dragging")}}function he(t,e,n){var r=Ve(t);if(r){n.preventDefault(),et=t,y.splice(y.indexOf(r),1),y.push(r);var l=kt(e,n.clientX,n.clientY,rt());h={type:"side",pointerId:n.pointerId,u:r,original:Vt(r),key:e,gx:l.x-r.x,gz:l.z-(r.z||0),y0:r.y},Z.classList.add("dragging")}}var Ct=null,xt=0;at("pointermove",function(t){!h||t.pointerId!==h.pointerId||(Ct=t,!xt&&(xt=requestAnimationFrame(function(){xt=0;var e=Ct;Ct=null,!st.aborted&&h&&e&&_e(e)})))});function _e(t){h.moved=!0;var e=rt();if(h.type==="side"){var n=kt(h.key,t.clientX,t.clientY,e);if(Dt(n,e)){h.u.out=!1;var r=Xt(h.u,n.x-h.gx,n.z-h.gz,h.y0,e);r&&(h.u.x=r.x,h.u.y=r.y,h.u.z=r.z)}else h.u.out=!0;At(e);return}var l=It(t.clientX,t.clientY);if(h.type==="new"){ve(t);var a=Yt(t.clientX,t.clientY+(h.dy||0),e),o=I(h.cid);if(h.preview=null,h.guides=null,a&&a.kind==="top"){var i=se(a.p,o,e),s={uid:-1,cid:o.id,x:i.x,y:i.y,rot:i.rot,z:0,placed:!0},p=dt(s,e);h.preview={cid:o.id,x:i.x,y:i.y,rot:i.rot,z:p.ok?p.z:0},h.guides={gx:i.gx,gy:i.gy}}else if(a&&a.kind==="side"){var c=pe(a,o,e);c&&(h.preview={cid:o.id,x:c.x,y:c.y,rot:c.rot,z:c.z})}At(e);return}var d=B(h.u),u=l.x-h.gx,k=l.y-h.gy;if(jt(l,e)){h.u.out=!1;var x=Pt(d,G(u,0,e.l-d.l),G(k,0,e.w-d.w),e,h.u.uid);u=x.x,k=x.y,h.guides={gx:x.gx,gy:x.gy}}else h.u.out=!0,h.guides=null;if(h.u.x=Math.round(u),h.u.y=Math.round(k),h.u.out)h.u.z=0;else{var f=dt(h.u,e);h.u.z=f.ok?f.z:0}At(e)}function xe(t,e){if(!(!h||t.pointerId!==h.pointerId)){xt&&cancelAnimationFrame(xt),xt=0,Ct&&(h.moved=!0),Ct=null;var n=rt(),r=It(t.clientX,t.clientY),l=!e&&jt(r,n);if(h.type==="side"&&(l=!e&&Dt(kt(h.key,t.clientX,t.clientY,n),n)),h.type==="new"){var a=I(h.cid),o=e?null:Yt(t.clientX,t.clientY+(h.dy||0),n);if(o&&o.kind==="top"){var i=fe(h.cid);if(i){var s=se(o.p,a,n);i.placed=!0,i.out=!1,i.rot=s.rot,i.x=s.x,i.y=s.y,y.splice(y.indexOf(i),1),y.push(i),Ht(i,n)||(i.placed=!1,i.z=0)}}else if(o&&o.kind==="side"){var p=pe(o,a,n);if(p){var c=p.u;c.placed=!0,c.out=!1,c.rot=p.rot,c.x=p.x,c.y=p.y,c.z=p.z,y.splice(y.indexOf(c),1),y.push(c)}else lt("Здесь нет свободного места")}Z.removeChild(h.ghost)}else if(h.u.out=!1,e||!h.moved)Object.assign(h.u,h.original);else if(!l)h.u.placed=!1,h.u.z=0;else if(h.type==="side"){var d=kt(h.key,t.clientX,t.clientY,n),u=Xt(h.u,d.x-h.gx,d.z-h.gz,h.y0,n);u?Object.assign(h.u,u):(Object.assign(h.u,h.original),lt("Здесь нет свободного места"))}else{var k=B(h.u),x=Pt(k,r.x-h.gx,r.y-h.gy,n,h.u.uid);h.u.x=x.x,h.u.y=x.y,Ht(h.u,n)||Object.assign(h.u,h.original)}Z.classList.remove("dragging"),h=null,Y(!1)}}at("pointerup",function(t){xe(t,!1)}),at("pointercancel",function(t){xe(t,!0)});function qt(t,e){t.addEventListener("pointerdown",function(n){if(!(h||n.button!==0)){me(t,n);for(var r=n.target;r&&r!==t&&!(r.getAttribute&&r.getAttribute("data-uid"));)r=r.parentNode;if(!r||r===t){et!==null&&(et=null,Y(!0));return}e(+r.getAttribute("data-uid"),n)}})}qt(T,We),qt(m("side-l"),function(t,e){he(t,"l",e)}),qt(m("side-r"),function(t,e){he(t,"r",e)}),["len","wid","hei"].forEach(function(t){m(t).addEventListener("input",function(){Y(!0)}),m(t).addEventListener("change",function(){Y(!1)})}),["payload","door-w","door-h","full-support"].forEach(function(t){m(t).addEventListener("change",function(){Y(!1)})}),m("demo").addEventListener("click",function(){F.length||(m("len").value=j(423),m("wid").value=j(213),m("hei").value=j(216),m("door-w").value=j(200),m("door-h").value=j(200),m("payload").value=1400,m("full-support").checked=!0,F=[{id:ct++,name:"Паллета с напитками",type:"pallet",l:120,w:80,h:105,q:2,limit:0,grams:34e4,stop:1},{id:ct++,name:"Ящик с оборудованием",type:"pallet",l:100,w:95,h:140,q:1,limit:0,grams:28e4,stop:2},{id:ct++,name:"Коробка расходников",type:"box",l:60,w:40,h:42,q:4,limit:1,grams:25e3,stop:2}],Zt(),m("auto").click())}),K.querySelectorAll("button[data-l]").forEach(function(t){t.addEventListener("click",function(){m("len").value=j(+t.dataset.l),m("wid").value=j(+t.dataset.w),m("hei").value=j(+t.dataset.h),Y(!1)})}),m("add").addEventListener("click",function(){var t=$("c-l"),e=$("c-w"),n=$("c-h"),r=+m("c-q").value;if(!(t>0&&e>0&&n>0)){m("err").textContent="Укажи длину, ширину и высоту больше нуля.";return}if(!Gt(r,0)){m("err").textContent="Укажи целое количество от 1. В одном плане может быть до "+zt+" мест.";return}var l=Number(m("c-stop").value)||1,a=$t("c-kg");if(!Number.isSafeInteger(l)||l<1||m("c-kg").value&&!a){m("err").textContent="Укажи положительную массу и целый номер точки выгрузки.";return}m("err").textContent="";var o=m("c-name").value.trim()||pt(yt).name+" "+ct;F.push({id:ct++,name:o,type:yt,l:t,w:e,h:n,q:r,limit:null,grams:a,stop:l}),m("c-name").value="",Y(!1),window.matchMedia&&window.matchMedia("(max-width: 1100px)").matches&&Z.scrollIntoView({block:"start"})});function me(t,e){try{t.setPointerCapture&&t.setPointerCapture(e.pointerId)}catch{}}function ge(t){t.addEventListener("pointerdown",function(e){if(!(h||e.button!==0)){var n=e.target.closest?e.target.closest("[data-chip]"):null;n&&(me(t,e),qe(+n.getAttribute("data-chip"),e))}})}ge(m("tbl")),ge(m("tray")),m("tauto").addEventListener("click",function(){m("auto").click()}),m("tbl").addEventListener("change",function(t){var e=t.target.getAttribute("data-limid"),n=t.target.getAttribute("data-limn");if(e||n){var r=I(+(e||n));r&&(n?r.limit=Math.max(1,Math.round(+t.target.value)||1):t.target.value==="free"?r.limit=null:t.target.value==="none"?r.limit=0:r.limit=r.limit>0?r.limit:5),Y(!1);return}var l=t.target.getAttribute("data-id");if(l){var a=+t.target.value,o=I(+l);if(!Gt(a,o.q)){t.target.value=o.q,lt("Укажи целое количество от 1. Лимит плана: "+zt+" мест.");return}o.q=a,Y(!1)}}),m("tbl").addEventListener("click",function(t){var e=t.target.closest?t.target.closest("button[data-lim]"):null;if(e){var n=+e.getAttribute("data-lim");St=St===n?null:n,Y(!1);return}var r=t.target.getAttribute("data-del");r&&(F=F.filter(function(l){return l.id!==+r}),Y(!1))});function ye(){return y.filter(function(t){return t.placed}).map(function(t){return t.uid+":"+t.x+":"+t.y+":"+(t.rot?1:0)+":"+(t.z||0)}).sort().join("|")}function be(){m("autoinfo").textContent=Rt&&Kt===ye()?Rt:""}function ot(t,e){return e?{l:t.w,w:t.l}:{l:t.l,w:t.w}}function we(t,e,n,r){var l=[],a=0,o=0,i=0;return t.forEach(function(s){var p=e(s),c=ot(s.c,p);if(r){if(a+c.l>n.l&&(o+=i,a=0,i=0),o+c.w>n.w)return;l.push({u:s.u,units:s.units,tower:s,x:a,y:o,rot:p}),a+=c.l,i=Math.max(i,c.w)}else{if(o+c.w>n.w&&(a+=i,o=0,i=0),a+c.l>n.l)return;l.push({u:s.u,units:s.units,tower:s,x:a,y:o,rot:p}),o+=c.w,i=Math.max(i,c.l)}}),l}function Nt(t,e,n,r,l){var a=[];t.forEach(function(i){if(e>=i.x+i.w||e+r<=i.x||n>=i.y+i.h||n+l<=i.y){a.push(i);return}e>i.x&&a.push({x:i.x,y:i.y,w:e-i.x,h:i.h}),e+r<i.x+i.w&&a.push({x:e+r,y:i.y,w:i.x+i.w-e-r,h:i.h}),n>i.y&&a.push({x:i.x,y:i.y,w:i.w,h:n-i.y}),n+l<i.y+i.h&&a.push({x:i.x,y:n+l,w:i.w,h:i.y+i.h-n-l})});function o(i,s){return i.x>=s.x&&i.y>=s.y&&i.x+i.w<=s.x+s.w&&i.y+i.h<=s.y+s.h}return a.filter(function(i,s){return!a.some(function(p,c){return s!==c&&o(i,p)&&(!o(p,i)||c<s)})})}function Ge(t,e){var n=[{x:0,y:0,w:e.l,h:e.w}],r=[];return t.forEach(function(l){var a=null;n.forEach(function(o){[!1,!0].forEach(function(i){if(!(i?!l.rOk:!l.nOk)){var s=ot(l.c,i);if(!(s.l>o.w||s.w>o.h)){var p=Math.min(o.w-s.l,o.h-s.w),c=Math.max(o.w-s.l,o.h-s.w);(!a||p<a.s1||p===a.s1&&c<a.s2)&&(a={x:o.x,y:o.y,w:s.l,h:s.w,r:i,s1:p,s2:c})}}})}),a&&(r.push({u:l.u,units:l.units,tower:l,x:a.x,y:a.y,rot:a.r}),n=Nt(n,a.x,a.y,a.w,a.h))}),r}function Ke(t){var e=0,n=0,r=0,l=0,a=1;return t.forEach(function(o){var i=o.tower,s=ot(i.c,o.rot);e+=i.vol,n=Math.max(n,o.x+s.l),i.nodes.forEach(function(p){p.rot!==o.rot&&r++}),l+=i.nodes.length,a=Math.max(a,i.lv)}),{vol:e,len:n,rotN:r,n:l,lv:a}}function ke(t,e){return e?t.vol!==e.vol?t.vol>e.vol:t.len!==e.len?t.len<e.len:t.rotN<e.rotN:!0}function Je(t,e){var n=[function(d,u){return d.u.uid-u.u.uid},function(d,u){return u.c.l*u.c.w-d.c.l*d.c.w||d.u.uid-u.u.uid},function(d,u){return Math.max(u.c.l,u.c.w)-Math.max(d.c.l,d.c.w)||d.u.uid-u.u.uid},function(d,u){return Math.min(u.c.l,u.c.w)-Math.min(d.c.l,d.c.w)||d.u.uid-u.u.uid}],r=[],l={};t.forEach(function(d){d.nOk&&d.rOk&&!l[d.c.id]&&(l[d.c.id]=!0,r.push(d.c))});var a=[],o=new Set;function i(d){var u={};r.forEach(function(x){u[x.id]=d(x)});var k=r.map(function(x){return u[x.id]?"1":"0"}).join("");o.has(k)||(o.add(k),a.push(u))}if(i(function(){return!1}),i(function(){return!0}),i(function(d){return d.w>d.l}),i(function(d){return d.l>d.w}),r.length<=8&&t.length<=150)for(var s=0;s<1<<r.length;s++)(function(d){i(function(u){return!!(d&1<<r.indexOf(u))})})(s);var p=null;function c(d){if(d.length){var u=Ke(d);ke(u,p&&p.sc)&&(p={pl:d,sc:u})}}return n.forEach(function(d){var u=t.slice().sort(d);a.forEach(function(k){var x=function(f){return f.nOk&&f.rOk?k[f.c.id]:f.rOk};c(we(u,x,e,!1)),c(we(u,x,e,!0))}),u.length<=400&&c(Ge(u,e))}),p}function $e(t){for(var e=t;e;e=e.parent){var n=e.c.limit;if(n!=null&&e.desc+1>n)return!1}return!0}function Ce(t,e,n,r,l){if(!(t.depth>=r)){for(var a=t.rot?t.c.w:t.c.l,o=t.rot?t.c.l:t.c.w,i=[{x:0,y:0,w:a,h:o}],s=[],p=0;p<e.length&&i.length;p++){var c=e[p],d=c.c;if(!(c.taken||l+d.h>n.h||d.l*d.w>a*o)){if(!$e(t))break;var u=null;if(i.forEach(function(f){[!1,!0].forEach(function(b){var g=b?d.w:d.l,S=b?d.l:d.w;if(!(g>f.w||S>f.h)){var A=f.w*f.h-g*S;(!u||A<u.waste)&&(u={x:f.x,y:f.y,w:g,h:S,r:b,waste:A})}})}),!!u){c.taken=!0;var k={u:c.u,c:d,rot:u.r,ox:t.ox+u.x,oy:t.oy+u.y,z:l,parent:t,children:[],desc:0,depth:t.depth+1};t.children.push(k);for(var x=t;x;x=x.parent)x.desc++;i=Nt(i,u.x,u.y,u.w,u.h),s.push(k)}}}s.forEach(function(f){Ce(f,e,n,r,l+f.c.h)})}}function Qe(t,e,n){var r=t.slice().sort(function(a,o){return o.c.l*o.c.w-a.c.l*a.c.w||o.c.h-a.c.h||a.u.uid-o.u.uid});r.forEach(function(a){a.taken=!1});var l=[];return r.forEach(function(a){if(!a.taken){a.taken=!0;var o={u:a.u,c:a.c,rot:!1,ox:0,oy:0,z:0,parent:null,children:[],desc:0,depth:1};n>1&&Ce(o,r,e,n,a.c.h);var i=[],s=0,p=1;(function c(d){i.push(d),s+=d.c.l*d.c.w*d.c.h,p=Math.max(p,d.depth),d.children.forEach(c)})(o),l.push({u:a.u,c:a.c,nOk:a.nOk,rOk:a.rOk,root:o,nodes:i,vol:s,lv:p})}}),l}function Ze(t,e){var n=[];if(e.slice().sort(function(p,c){return p.uid-c.uid}).forEach(function(p){var c=I(p.cid);if(!(c.h>t.h)){var d=c.l<=t.l&&c.w<=t.w&&wt(c,ot(c,!1),t),u=c.w<=t.l&&c.l<=t.w&&wt(c,ot(c,!0),t);(d||u)&&n.push({u:p,c,nOk:d,rOk:u})}}),!n.length)return null;for(var r=n.reduce(function(p,c){return Math.min(p,c.c.h)},1/0),l=n.some(function(p){return p.c.limit!==0&&p.c.h+r<=t.h}),a=l?Math.min(12,Math.floor(t.h/r)):1,o=null,i=1;i<=a;i++){var s=Je(Qe(n,t,i),t);if(s&&(ke(s.sc,o&&o.sc)&&(o=s),s.sc.n===n.length))break}return o&&(o.items=n),o}var tn=!0,Me=2;function Ee(t){return t.slice().sort(function(e,n){return e-n}).filter(function(e,n,r){return n===0||e!==r[n-1]})}function ze(t,e){return t.x>=e.x&&t.y>=e.y&&t.x+t.w<=e.x+e.w&&t.y+t.h<=e.y+e.h}function en(t){var e=[],n=[];t.forEach(function(b){e.push(b.x,b.x+b.w),n.push(b.y,b.y+b.h)}),e=Ee(e),n=Ee(n);var r=e.length-1,l=n.length-1,a=[],o,i;for(i=0;i<l;i++)for(a[i]=[],o=0;o<r;o++){var s=(e[o]+e[o+1])/2,p=(n[i]+n[i+1])/2;a[i][o]=t.some(function(b){return s>b.x&&s<b.x+b.w&&p>b.y&&p<b.y+b.h})}for(var c=[],d=0;d<l;d++){var u=[];for(o=0;o<r;o++)u[o]=!0;for(var k=d;k<l;k++){var x=!1;for(o=0;o<r;o++)u[o]=u[o]&&a[k][o],u[o]&&(x=!0);if(!x)break;for(o=0;o<r;){if(!u[o]){o++;continue}for(var f=o;o<r&&u[o];)o++;c.push({x:e[f],y:n[d],w:e[o]-e[f],h:n[k+1]-n[d]})}}}return c.filter(function(b,g){return!c.some(function(S,A){return A!==g&&ze(b,S)&&(!ze(S,b)||A<g)})})}function nn(t,e){var n=y.map(function(f){return{u:f,x:f.x,y:f.y,z:f.z,rot:f.rot,placed:f.placed}}),r=t.sc.n;y.forEach(function(f){f.placed=!1,f.z=0,f.rot=!1,f.out=!1});var l=[],a={};t.pl.forEach(function(f){var b=f.tower.nodes[0],g=ot(b.c,f.rot);b.u.x=f.x,b.u.y=f.y,b.u.rot=f.rot,b.u.z=0,b.u.placed=!0,l.push({u:b.u,c:b.c,x:f.x,y:f.y,w:g.l,h:g.w,z:0,depth:1}),a[b.u.uid]=!0});for(var o=t.items.filter(function(f){return!a[f.u.uid]}).sort(function(f,b){return b.c.l*b.c.w-f.c.l*f.c.w||b.c.h-f.c.h||f.u.uid-b.u.uid}),i=0;o.length&&i<60;i++){var s={};l.forEach(function(f){f.depth<Me&&(s[f.z+f.c.h]=!0)});var p=Object.keys(s).map(Number).sort(function(f,b){return f-b}),c=!1;if(p.forEach(function(f){if(o.length){var b=l.filter(function(E){return E.depth<Me&&E.z+E.c.h===f}).map(function(E){return{x:E.x,y:E.y,w:E.w,h:E.h}}),g=b.length<=40?en(b):b;l.filter(function(E){return E.z===f}).forEach(function(E){g=Nt(g,E.x,E.y,E.w,E.h)});for(var S=0;S<o.length;){var A=o[S],L=A.c,P=A.u,V=!1;if(f+L.h>e.h||!g.length){S++;continue}var O=[];g.forEach(function(E){[!1,!0].forEach(function(H){var U=H?L.w:L.l,M=H?L.l:L.w;U<=E.w&&M<=E.h&&O.push({x:E.x,y:E.y,r:H,w:U,h:M})})}),O.sort(function(E,H){return E.x-H.x||E.y-H.y||(E.r?1:0)-(H.r?1:0)});for(var v=0;v<O.length&&!V;v++){var w=O[v];P.x=w.x,P.y=w.y,P.rot=w.r,P.z=0,P.placed=!1;var R=dt(P,e);if(!(!R.ok||R.z!==f)&&(P.z=f,!ce(P))){P.placed=!0;var z=1;l.forEach(function(E){E.z+E.c.h===f&&w.x<E.x+E.w&&E.x<w.x+w.w&&w.y<E.y+E.h&&E.y<w.y+w.h&&(z=Math.max(z,E.depth+1))}),l.push({u:P,c:L,x:w.x,y:w.y,w:w.w,h:w.h,z:f,depth:z}),g=Nt(g,w.x,w.y,w.w,w.h),o.splice(S,1),V=!0,c=!0}}V||(P.placed=!1,P.z=0,P.rot=!1,S++)}}}),!c)break}var d=y.filter(function(f){return f.placed}).length;if(d<r)return n.forEach(function(f){f.u.x=f.x,f.u.y=f.y,f.u.z=f.z,f.u.rot=f.rot,f.u.placed=f.placed}),null;var u=0,k=1,x=0;return l.forEach(function(f){u=Math.max(u,f.x+f.w),k=Math.max(k,f.depth)}),y.forEach(function(f){f.placed&&f.rot&&x++}),{n:d,len:u,lv:k,rotN:x}}function rn(t,e){t.pl.forEach(function(n){n.tower.nodes.forEach(function(r){r.u.x=e+n.x+(n.rot?r.oy:r.ox),r.u.y=n.y+(n.rot?r.ox:r.oy),r.u.rot=r.rot!==n.rot,r.u.placed=!0,r.u.z=r.z})})}function an(t){var e=new Map;y.forEach(function(i){var s=bt(I(i.cid));e.has(s)||e.set(s,[]),e.get(s).push(i)});var n=Array.from(e.keys()).sort(function(i,s){return i-s}),r=t.l,l=t.payload||1/0,a=0,o=1;return n.forEach(function(i){var s=Object.assign({},t,{l:r}),p=e.get(i).filter(function(k){var x=I(k.cid),f=x.grams||0;return Bt(x,s)?t.payload&&(!f||f>l)?(a++,!1):(l-=f,!0):!1}),c=Ze(s,p);if(c){var d=n.length>1?r-c.sc.len:0;rn(c,d);var u=c.sc;n.length===1&&tn&&c.items.length<=200&&(u=nn(c,t)||u),r-=u.len,o=Math.max(o,u.lv)}p.forEach(function(k){k.placed||(l+=I(k.cid).grams||0)})}),{len:t.l-r,lv:o,skipped:a}}m("auto").addEventListener("click",function(){var t=rt();y.forEach(function(o){o.placed=!1,o.out=!1,o.z=0,o.rot=!1});var e=an(t);le(t);var n=y.filter(function(o){return o.placed}),r=y.length,l=n.length,a=n.filter(function(o){return o.rot}).length;Rt=r?"Автораскладка: "+l+" из "+r+" мест"+(l?", занято по длине "+J(e.len)+", повернуто "+a+(e.lv>1?", в высоту до "+e.lv+" мест":""):"")+(l<r?". Не поместилось: "+(r-l)+(e.skipped?". Пропущено из-за лимита или неизвестной массы: "+e.skipped:""):"")+".":"",Y(!1),Kt=ye(),be()}),m("clear").addEventListener("click",function(){y.forEach(function(t){t.placed=!1,t.out=!1,t.z=0}),Y(!1)});var Se=null;function lt(t){m("rot-msg").textContent=t,clearTimeout(Se),Se=setTimeout(function(){st.aborted||(m("rot-msg").textContent="")},2800)}function mt(){var t=Lt();if(t){var e=rt(),n=B(t),r={l:n.w,w:n.l};if(r.l>e.l||r.w>e.w){lt("В повернутом виде груз не помещается в кузов");return}var l=Vt(t);t.rot=!t.rot,t.x=Math.round(G(t.x+(n.l-r.l)/2,0,e.l-r.l)),t.y=Math.round(G(t.y+(n.w-r.w)/2,0,e.w-r.w)),Ht(t,e)||Object.assign(t,l),Y(!1)}}m("rot").addEventListener("click",mt),T.addEventListener("dblclick",mt),m("side-l").addEventListener("dblclick",mt),m("side-r").addEventListener("dblclick",mt),at("keydown",function(t){var e=t.target&&t.target.tagName;e==="INPUT"||e==="TEXTAREA"||t.code==="KeyR"&&!t.ctrlKey&&!t.metaKey&&!t.altKey&&(t.preventDefault(),mt())});function Te(){var t=m("types");t.innerHTML=nt.map(function(e){var n=e.id===yt;return'<button type="button" role="radio" aria-checked="'+n+'" class="'+(n?"on":"")+'" data-type="'+e.id+'" title="'+e.name+'" aria-label="'+e.name+'">'+e.svg+"</button>"}).join(""),m("type-name").textContent=pt(yt).name}m("types").addEventListener("click",function(t){var e=t.target.closest?t.target.closest("button[data-type]"):null;e&&(yt=e.getAttribute("data-type"),Te())}),Te();var on={"--muted":"#5e594d","--accent":"#b8372f","--body-fill":"#ffffff","--grid":"rgba(21,20,19,0.12)","--frame":"#3d3a33","--select":"none","--danger":"#d3231f"},Le={"#f9e8ac":"#b08a1a","#fff4cb":"#6b5410","#d9534a":"#c0392b","#ea7a71":"#8e2a24","#a8a02e":"#7d7612","#c4bc4a":"#565008","#ede9e1":"#6f6a5c","#faf8f3":"#3d3a33","#dd8b4c":"#c06a22","#eba676":"#8a4a14","#8fa58b":"#5f7a5a","#adc2a9":"#3d5a38","#b7a0c0":"#8a6f99","#cfbbd6":"#5f4a6e"};function ln(t){var e=t.getAttribute("viewBox").split(" ").map(Number),n=new XMLSerializer().serializeToString(t);return n=n.replace(/var\((--[\w-]+)\)/g,function(r,l){return on[l]||r}),n=n.replace(/#[0-9a-fA-F]{6}\b/g,function(r){return Le[r.toLowerCase()]||r}),n=n.replace(/^<svg/,'<svg width="'+e[2]+'" height="'+e[3]+'"'),n=n.replace(/^(<svg[^>]*>)/,'$1<style>text{fill:#5e594d;font-size:11px;font-family:"IBM Plex Mono",Consolas,monospace}</style>'),{str:n,w:e[2],h:e[3]}}function Ae(t){return new Promise(function(e,n){var r=new Image;r.onload=function(){e(r)},r.onerror=function(){n(new Error("img"))},r.src=t})}function Oe(t){return"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(t)}async function sn(){if(document.fonts&&document.fonts.ready)try{await document.fonts.ready}catch{}for(var t=rt(),e=1240,n=48,r=e-2*n,l=2,a=[["Вид сверху",m("top")],["Вид сбоку: левый борт, кабина слева",m("side-l")],["Вид сбоку: правый борт, кабина справа",m("side-r")]],o=[],i=0;i<a.length;i++){var s=ln(a[i][1]),p=await Ae(Oe(s.str));o.push({title:a[i][0],img:p,h:r*s.h/s.w})}for(var c={},d=0;d<nt.length;d++){var u=nt[d];c[u.id]=await Ae(Oe('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3d3a33" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+u.body+"</svg>"))}var k=y.filter(function(M){return M.placed}),x=0,f=0;k.forEach(function(M){var N=I(M.cid);M.z>0||(x+=N.l*N.w),f+=N.l*N.w*N.h/1e6});var b=t.l*t.w*t.h/1e6,g=Ft().stacks.filter(function(M){return M.units.length>1}),S=null;g.forEach(function(M){(!S||M.top>S.top)&&(S=M)});var A=[["В кузове",k.length+" из "+y.length+" мест"],["Занято пола",(x/(t.l*t.w)*100).toFixed(0)+"%"],["Объем груза",f.toFixed(2)+" м³ из "+b.toFixed(1)+" м³"],["Штабели",g.length?g.length+", выше всех "+J(S.top):"нет"]],L=40,P=44+F.length*L+10,V=236+o.reduce(function(M,N){return M+46+N.h+14},0)+50+P+90,O=document.createElement("canvas");O.width=e*l,O.height=Math.round(V*l);var v=O.getContext("2d");v.scale(l,l),v.fillStyle="#ffffff",v.fillRect(0,0,e,V);var w='"Inter", "Segoe UI", Arial, sans-serif',R='"IBM Plex Mono", Consolas, monospace',z=40;v.fillStyle="#b63a33",v.fillRect(n,z+6,14,14),v.fillStyle="#151413",v.font="700 34px "+w,v.textBaseline="top",v.fillText("Раскладка груза",n+28,z),v.fillStyle="#6f6a5c",v.font="400 15px "+R,v.textAlign="right";var E=new Date;v.fillText(E.toLocaleDateString("ru-RU")+"  "+E.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}),e-n,z+10),v.textAlign="left",z+=54,v.fillStyle="#3d3a33",v.font="500 18px "+w,v.fillText("Кузов: "+J(t.l)+" × "+J(t.w)+" × "+J(t.h)+"  (объем "+b.toFixed(1)+" м³)",n,z),z+=44;var H=r/4;A.forEach(function(M,N){var D=n+N*H;v.fillStyle="#6f6a5c",v.font="500 12px "+R,v.fillText(M[0].toUpperCase(),D,z),v.fillStyle="#151413",v.font="600 17px "+w,v.fillText(M[1],D,z+20)}),z+=62,v.strokeStyle="#151413",v.lineWidth=1,v.beginPath(),v.moveTo(n,z),v.lineTo(e-n,z),v.stroke(),z+=22,o.forEach(function(M){v.fillStyle="#b63a33",v.fillRect(n,z+6,8,8),v.fillStyle="#151413",v.font="500 13px "+R,v.fillText(M.title.toUpperCase(),n+20,z+3),z+=30,v.strokeStyle="rgba(21,20,19,0.18)",v.lineWidth=1,v.strokeRect(n+.5,z+.5,r-1,M.h-1),v.drawImage(M.img,n,z,r,M.h),z+=M.h+30}),z+=4,v.fillStyle="#b63a33",v.fillRect(n,z+6,8,8),v.fillStyle="#151413",v.font="500 13px "+R,v.fillText("ГРУЗ",n+20,z+3),z+=30;var U=[n+6,n+66,n+430,n+720,n+840,n+980];return v.fillStyle="#6f6a5c",v.font="500 11px "+R,["","НАЗВАНИЕ","РАЗМЕР Д×Ш×В, "+(X==="m"?"М":"СМ"),"ВСЕГО","В КУЗОВЕ","СВЕРХУ"].forEach(function(M,N){M&&v.fillText(M,U[N],z)}),z+=20,v.strokeStyle="#151413",v.beginPath(),v.moveTo(n,z),v.lineTo(e-n,z),v.stroke(),F.forEach(function(M){var N=y.filter(function(q){return q.cid===M.id&&q.placed}).length,D=Q(M),W=z+4;v.fillStyle=Le[D.f.toLowerCase()]||D.f,v.fillRect(U[0],W+8,16,16),v.drawImage(c[M.type]||c.pallet,U[1],W+4,24,24),v.fillStyle="#151413",v.font="600 16px "+w,v.fillText(M.name,U[1]+34,W+7),v.fillStyle="#3d3a33",v.font="400 15px "+R,v.fillText(vt(M.l)+" × "+vt(M.w)+" × "+vt(M.h),U[2],W+8),v.fillText(String(M.q),U[3],W+8),v.fillStyle=N<M.q?"#b8372f":"#3d3a33",v.fillText(N+" из "+M.q,U[4],W+8),v.fillStyle="#3d3a33",v.fillText(M.limit===null||M.limit===void 0?"без ограничений":M.limit===0?"нельзя":"до "+M.limit+" мест",U[5],W+8),z+=L,v.strokeStyle="rgba(21,20,19,0.14)",v.beginPath(),v.moveTo(n,z),v.lineTo(e-n,z),v.stroke()}),z+=22,v.fillStyle="#6f6a5c",v.font="400 13px "+w,v.fillText("Схема справочная: вес груза, крепление и допустимые нагрузки на ось не учитываются.",n,z),O}function Ie(t,e){var n=document.createElement("a");n.href=URL.createObjectURL(t),n.download=e,Z.appendChild(n),n.click(),setTimeout(function(){URL.revokeObjectURL(n.href),n.remove()},1500)}function Pe(){var t=new Date,e=function(n){return(n<10?"0":"")+n};return t.getFullYear()+"-"+e(t.getMonth()+1)+"-"+e(t.getDate())+"_"+e(t.getHours())+e(t.getMinutes())}function dn(t,e,n){var r=595.28,l=841.89,a=22,o=Math.min((r-2*a)/e,(l-2*a)/n),i=e*o,s=n*o,p=(r-i)/2,c=l-a-s,d=new TextEncoder,u=[],k=[],x=0;function f(L){var P=typeof L=="string"?d.encode(L):L;u.push(P),x+=P.length}f(`%PDF-1.4
`),k[1]=x,f(`1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
`),k[2]=x,f(`2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
`),k[3]=x,f(`3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 `+r+" "+l+`] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>
endobj
`),k[4]=x,f(`4 0 obj
<< /Type /XObject /Subtype /Image /Width `+e+" /Height "+n+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+t.length+` >>
stream
`),f(t),f(`
endstream
endobj
`);var b="q "+i.toFixed(2)+" 0 0 "+s.toFixed(2)+" "+p.toFixed(2)+" "+c.toFixed(2)+" cm /Im0 Do Q";k[5]=x,f(`5 0 obj
<< /Length `+b.length+` >>
stream
`+b+`
endstream
endobj
`);for(var g=x,S=`xref
0 6
0000000000 65535 f 
`,A=1;A<=5;A++)S+=("0000000000"+k[A]).slice(-10)+` 00000 n 
`;return f(S+`trailer
<< /Size 6 /Root 1 0 R >>
startxref
`+g+`
%%EOF
`),new Blob(u,{type:"application/pdf"})}async function Ne(t){var e=m(t),n=e.textContent;e.disabled=!0,e.textContent="Готовлю...";try{var r=await sn();if(t==="png")await new Promise(function(s){r.toBlob(function(p){Ie(p,"raskladka_"+Pe()+".png"),s()},"image/png")});else{for(var l=r.toDataURL("image/jpeg",.92).split(",")[1],a=atob(l),o=new Uint8Array(a.length),i=0;i<a.length;i++)o[i]=a.charCodeAt(i);Ie(dn(o,r.width,r.height),"raskladka_"+Pe()+".pdf")}}catch{lt("Не удалось подготовить файл. Попробуй еще раз.")}e.textContent=n,e.disabled=!y.some(function(s){return s.placed})}m("png").addEventListener("click",function(){Ne("png")}),m("pdf").addEventListener("click",function(){Ne("pdf")}),K.querySelectorAll(".mtabs button").forEach(function(t){t.addEventListener("click",function(){Z.setAttribute("data-mv",t.getAttribute("data-mv")),K.querySelectorAll(".mtabs button").forEach(function(e){var n=e===t;e.classList.toggle("on",n),e.setAttribute("aria-selected",n?"true":"false")})})}),m("trot").addEventListener("click",function(){mt()});function Re(t){var e=rt(),n=[$("c-l"),$("c-w"),$("c-h")];X=t,[["door-w",e.doorW],["door-h",e.doorH]].forEach(function(o){var i=m(o[0]);i.value=o[1]?j(o[1]):"",i.min=i.step=X==="m"?"0.01":"1"}),["c-l","c-w","c-h"].forEach(function(o,i){var s=m(o);s.value=n[i]>0?j(n[i]):"",s.step=X==="m"?"0.01":"1",s.min=X==="m"?"0.01":"1"});var r=[e.l,e.w,e.h],l=["len","wid","hei"],a=[2e3,400,400];l.forEach(function(o,i){var s=m(o);s.value=j(r[i]),s.step=X==="m"?"0.01":"1",s.min=X==="m"?"0.5":"50",s.max=String(X==="m"?a[i]/100:a[i])}),K.querySelectorAll(".ulab").forEach(function(o){o.textContent=X==="m"?"м":"см"}),K.querySelectorAll(".seg button").forEach(function(o){var i=o.getAttribute("data-u")===X;o.classList.toggle("on",i),o.setAttribute("aria-pressed",i?"true":"false")});try{tt.setItem("cargoUnit",X)}catch{}Y(!1)}K.querySelectorAll(".seg button").forEach(function(t){t.addEventListener("click",function(){Re(t.getAttribute("data-u"))})});function cn(t){try{tt.setItem(_t,JSON.stringify({body:t,cargo:F,units:y}))}catch{var e=m("storage-status");e.textContent="Браузер не смог сохранить план на этом устройстве.",e.hidden=!1}}function un(){try{let i=function(s){return Number.isSafeInteger(s)&&s>0};var t=JSON.parse(tt.getItem(_t));if(!t||!t.body||!Array.isArray(t.cargo)||!Array.isArray(t.units))return;var e=t.body,n=new Map,r=new Set,l=0;if(![e.l,e.w,e.h].every(i)||![e.doorW,e.doorH,e.payload].every(function(s){return s===void 0||s===0||i(s)}))return;for(var a of t.cargo){if(!a||![a.id,a.l,a.w,a.h,a.q].every(i)||n.has(a.id)||typeof a.name!="string"||!nt.some(function(s){return s.id===a.type})||!(a.limit===null||Number.isSafeInteger(a.limit)&&a.limit>=0)||!(a.stop===void 0||i(a.stop))||!(a.grams===void 0||a.grams===0||i(a.grams))||(l+=a.q,l>zt))return;n.set(a.id,a.q)}if(l!==t.units.length)return;for(var o of t.units){if(!o||!i(o.uid)||r.has(o.uid)||!(n.get(o.cid)>0)||![o.x,o.y,o.z].every(Number.isSafeInteger)||typeof o.placed!="boolean"||typeof o.rot!="boolean")return;n.set(o.cid,n.get(o.cid)-1),r.add(o.uid),o.out=!1}m("len").value=j(e.l),m("wid").value=j(e.w),m("hei").value=j(e.h),m("door-w").value=e.doorW?j(e.doorW):"",m("door-h").value=e.doorH?j(e.doorH):"",m("payload").value=e.payload?e.payload/1e3:"",m("full-support").checked=e.fullSupport===!0,F=t.cargo,y=t.units,ct=Math.max(0,...n.keys())+1,Wt=Math.max(0,...r)+1}catch{}}un();try{tt.getItem("cargoUnit")==="m"&&Re("m")}catch{}Y(!1)}function hn(K){const tt=K.querySelector(".cargo-host").attachShadow({mode:"open"});let st,at=new Map;K.addEventListener("close",()=>{st?.abort(),tt.replaceChildren()});function m(){const T=document.createElement("style");T.textContent=pn;const Mt=document.createElement("template");Mt.innerHTML=fn,tt.replaceChildren(T,Mt.content),st=new AbortController;const it={getItem:F=>at.get(F)??null,setItem:(F,Et)=>at.set(F,Et)};vn(tt,tt.querySelector(".cargo-root"),it,st.signal),K.showModal()}return{open:m,reset(){at=new Map}}}export{hn as createCargoSection};
