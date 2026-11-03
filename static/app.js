"use strict";

// ---------- utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const agora = () => Date.now() / 1000;
const hojeISO = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
const fmtData = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a.slice(2)}`; };
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const fmtKg = (n) => (n == null ? "–" : (Math.round(n * 10) / 10).toLocaleString("pt-BR"));
const ls = {
  get(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// Epley usando reps + RIR (repetições que daria para fazer): estimativa de 1RM.
const e1rm = (kg, reps, rir) => (kg > 0 && reps > 0 ? kg * (1 + (reps + (rir || 0)) / 30) : 0);
const inicioSemana = (iso) => { const d = new Date(iso + "T12:00"); const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return d.toLocaleDateString("sv-SE"); };
const imgEx = (id, k = 0) => `img/${EXERCICIOS[id]?.img}/${k}.jpg`;

// ---------- dados (servidor + fila offline) ----------
const DB = {
  regs: new Map(),
  ultimo: 0,
  fila: ls.get("treino.fila", []),

  async carregar() {
    const cache = ls.get("treino.cache", null);
    if (cache) { cache.regs.forEach((r) => this.regs.set(r.id, r)); this.ultimo = cache.ultimo; }
    this.fila.forEach((r) => this.regs.set(r.id, r));
    await this.puxar();
  },
  async puxar() {
    try {
      const r = await fetch(`api/registros?desde=${this.ultimo}`, { cache: "no-store" });
      const j = await r.json();
      let mudou = false;
      for (const reg of j.registros) {
        const atual = this.regs.get(reg.id);
        if (!atual || atual.updated_at < reg.updated_at) { this.regs.set(reg.id, reg); mudou = true; }
      }
      this.ultimo = j.agora;
      await this.enviarFila();
      this.salvarCache();
      status(true);
      return mudou;
    } catch { status(false); return false; }
  },
  async enviarFila() {
    if (!this.fila.length) return;
    const r = await fetch("api/registros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.fila) });
    if (!r.ok) throw new Error("falha ao enviar");
    this.fila = []; ls.set("treino.fila", []);
  },
  salvarCache() { ls.set("treino.cache", { ultimo: this.ultimo, regs: [...this.regs.values()] }); },
  async gravar(tipo, dados, id = uid(), apagado = false) {
    const reg = { id, tipo, perfil: dados.perfil ?? null, dados, updated_at: agora(), apagado };
    this.regs.set(id, reg);
    this.fila.push(reg); ls.set("treino.fila", this.fila);
    this.salvarCache();
    try { await this.enviarFila(); status(true); } catch { status(false); }
    return reg;
  },
  apagar(reg) { return this.gravar(reg.tipo, reg.dados, reg.id, true); },
  todos(tipo, perfil) {
    return [...this.regs.values()].filter((r) => r.tipo === tipo && !r.apagado && (perfil === undefined || r.dados.perfil === perfil));
  },
};

function status(online) {
  const el = $("#status-sync");
  const pend = DB.fila.length;
  el.textContent = online ? (pend ? `⏳ ${pend} pendente(s)` : "● sincronizado") : `○ offline${pend ? ` · ${pend} pendente(s)` : ""}`;
  el.style.color = online && !pend ? "var(--ok)" : "var(--suave)";
}

// ---------- perfis ----------
const perfis = () => DB.todos("perfil").sort((a, b) => a.dados.nome.localeCompare(b.dados.nome));
let perfilId = ls.get("treino.perfil", null);
const perfil = () => DB.regs.get(perfilId)?.dados ? DB.regs.get(perfilId) : null;
function usarPerfil(id) { perfilId = id; ls.set("treino.perfil", id); render(); }

function formPerfil(reg) {
  const d = reg?.dados || { nome: "", sexo: "M", programa: "masculino", objetivo: "hipertrofia", nascimento: "", altura: "" };
  abrirModal(`
    <h2>${reg ? "Editar perfil" : "Novo perfil"}</h2>
    <form id="f-perfil" class="linha">
      <label class="campo">Nome<input name="nome" required value="${esc(d.nome)}"></label>
      <label class="campo">Sexo<select name="sexo"><option value="M">Masculino</option><option value="F">Feminino</option></select></label>
      <label class="campo">Programa<select name="programa">${Object.entries(PROGRAMAS).map(([k, p]) => `<option value="${k}">${esc(p.nome)}</option>`).join("")}</select></label>
      <label class="campo">Objetivo<select name="objetivo"><option value="hipertrofia">Ganhar músculo</option><option value="emagrecimento">Emagrecer</option><option value="manutencao">Manter</option></select></label>
      <label class="campo">Ano de nascimento<input name="nascimento" inputmode="numeric" value="${esc(d.nascimento)}"></label>
      <label class="campo">Altura (cm)<input name="altura" inputmode="numeric" value="${esc(d.altura)}"></label>
      <div class="linha" style="width:100%;margin-top:8px">
        <button class="btn prim" type="submit">Salvar</button>
        <button class="btn" type="button" data-fechar>Cancelar</button>
        ${reg ? `<button class="btn perigo" type="button" id="apagar-perfil" style="margin-left:auto">Apagar</button>` : ""}
      </div>
    </form>`);
  const f = $("#f-perfil");
  f.sexo.value = d.sexo; f.programa.value = d.programa; f.objetivo.value = d.objetivo;
  f.sexo.onchange = () => { if (!reg) f.programa.value = f.sexo.value === "F" ? "feminino" : "masculino"; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(f));
    const novo = await DB.gravar("perfil", dados, reg?.id);
    fecharModal(); usarPerfil(novo.id);
  };
  $("#apagar-perfil")?.addEventListener("click", async () => {
    if (!confirm(`Apagar o perfil ${d.nome}? O histórico continua guardado, mas fica oculto.`)) return;
    await DB.apagar(reg); fecharModal(); usarPerfil(perfis()[0]?.id ?? null);
  });
}

function escolherPerfil() {
  abrirModal(`
    <h2>Quem está treinando?</h2>
    <div class="lista-ex">${perfis().map((p) => `
      <div class="linha entre card" style="margin:0">
        <button class="btn" data-usar="${p.id}" style="flex:1;text-align:left">${esc(p.dados.nome)} <span class="suave">· ${p.dados.sexo === "F" ? "feminino" : "masculino"}</span></button>
        <button class="btn peq" data-editar="${p.id}">Editar</button>
      </div>`).join("")}</div>
    <button class="btn prim cheio" id="novo-perfil" style="margin-top:12px">+ Novo perfil</button>`);
  $$("[data-usar]").forEach((b) => (b.onclick = () => { fecharModal(); usarPerfil(b.dataset.usar); }));
  $$("[data-editar]").forEach((b) => (b.onclick = () => formPerfil(DB.regs.get(b.dataset.editar))));
  $("#novo-perfil").onclick = () => formPerfil(null);
}

// ---------- histórico e sugestão de carga ----------
const sessoes = () => DB.todos("sessao", perfilId).sort((a, b) => (b.dados.data + b.dados.inicio).localeCompare(a.dados.data + a.dados.inicio));

function historicoEx(exId) {
  const lista = [];
  for (const s of sessoes()) {
    const it = s.dados.itens.find((i) => i.ex === exId);
    const feitas = it?.series.filter((x) => x.reps > 0) || [];
    if (feitas.length) lista.push({ data: s.dados.data, series: feitas, alvo: it });
  }
  return lista; // mais recente primeiro
}

function sugestao(item) {
  const ex = EXERCICIOS[item.ex];
  const h = historicoEx(item.ex)[0];
  if (!h) return { cls: "", txt: ex.tempo ? "Primeira vez: segure até faltar ~5 s para a falha." : "Primeira vez: escolha uma carga que deixe 1–2 repetições na reserva no fim da faixa." };
  const unidade = ex.tempo ? " s" : "";
  const topo = Math.max(...h.series.map((x) => x.kg || 0));
  const doTopo = h.series.filter((x) => (x.kg || 0) === topo);
  const reps = doTopo.map((x) => x.reps);
  const ultimo = `Último (${fmtData(h.data)}): ${ex.tempo ? "" : fmtKg(topo) + " kg × "}${reps.join(", ")}${unidade}`;
  if (ex.tempo) {
    return Math.min(...reps) >= item.max
      ? { cls: "subir", txt: `${ultimo}. Bateu ${item.max} s: passe para um abdominal com carga ou some 5–10 s.` }
      : { cls: "", txt: `${ultimo}. Tente segurar alguns segundos a mais.` };
  }
  const planejadas = item.nSeries ?? (Array.isArray(item.series) ? item.series.length : item.series);
  if (doTopo.length >= planejadas && Math.min(...reps) >= item.max) {
    const passo = ex.tipo === "composto" ? Math.max(2, topo * 0.025) : Math.max(1, topo * 0.025);
    const novo = Math.round((topo + passo) * 2) / 2;
    return { cls: "subir", txt: `${ultimo}. Bateu o topo em todas: suba para ${fmtKg(novo)} kg e mire em ${item.min}+ reps.`, kg: novo };
  }
  if (reps.filter((r) => r < item.min).length >= 2) {
    return { cls: "", txt: `${ultimo}. Ficou abaixo de ${item.min} em várias séries: mantenha ou reduza ~5–10%.`, kg: topo };
  }
  return { cls: "", txt: `${ultimo}. Mantenha ${fmtKg(topo)} kg e tente +1 repetição.`, kg: topo };
}

// ---------- treino em andamento ----------
const chaveRascunho = () => `treino.rascunho.${perfilId}`;
let rascunho = null;

function proximoDia(prog) {
  const ult = sessoes().find((s) => s.dados.programa === prog);
  return ult ? (ult.dados.dia + 1) % PROGRAMAS[prog].dias.length : 0;
}

function iniciarTreino(diaIdx) {
  const p = perfil().dados;
  const dia = PROGRAMAS[p.programa].dias[diaIdx];
  rascunho = {
    id: uid(), perfil: perfilId, programa: p.programa, dia: diaIdx, nomeDia: dia.nome,
    data: hojeISO(), inicio: new Date().toTimeString().slice(0, 5), t0: Date.now(), notas: "",
    itens: dia.itens.map((it) => {
      const sug = sugestao(it);
      return { ...it, nSeries: it.series, series: Array.from({ length: it.series }, () => ({ kg: sug.kg ?? null, reps: null, rir: null, feita: false })) };
    }),
  };
  ls.set(chaveRascunho(), rascunho); render();
}

function editarSessao(reg) {
  rascunho = { ...structuredClone(reg.dados), id: reg.id, editando: true };
  rascunho.itens.forEach((it) => it.series.forEach((s) => (s.feita = s.reps > 0)));
  ls.set(chaveRascunho(), rascunho); fecharModal(); irPara("treinar");
}

async function finalizarTreino() {
  const itens = rascunho.itens.map((it) => ({ ex: it.ex, min: it.min, max: it.max, rir: it.rir, series: it.series.filter((s) => s.reps > 0).map(({ kg, reps, rir }) => ({ kg: kg || 0, reps, rir })) })).filter((it) => it.series.length);
  if (!itens.length && !confirm("Nenhuma série registrada. Descartar o treino?")) return;
  if (itens.length) {
    const dur = rascunho.editando ? rascunho.duracao : Math.round((Date.now() - rascunho.t0) / 60000);
    const { id, perfil: pf, programa, dia, nomeDia, data, inicio, notas } = rascunho;
    await DB.gravar("sessao", { perfil: pf, programa, dia, nomeDia, data, inicio, duracao: dur, notas, itens }, id);
  }
  rascunho = null; ls.del(chaveRascunho()); pararTimer(); render();
}

// ---------- timer de descanso ----------
let timerFim = 0, timerLoop = null;
function iniciarTimer(seg) {
  timerFim = Date.now() + seg * 1000;
  $("#timer").classList.remove("oculto", "fim");
  clearInterval(timerLoop); timerLoop = setInterval(tickTimer, 250); tickTimer();
}
function tickTimer() {
  const resta = Math.round((timerFim - Date.now()) / 1000);
  const t = Math.abs(resta);
  $("#timer-tempo").textContent = `${resta < 0 ? "+" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  if (resta <= 0 && !$("#timer").classList.contains("fim")) {
    $("#timer").classList.add("fim");
    navigator.vibrate?.([300, 150, 300]);
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.connect(ctx.destination); o.frequency.value = 880; o.start(); o.stop(ctx.currentTime + 0.25); } catch {}
  }
}
function pararTimer() { clearInterval(timerLoop); $("#timer").classList.add("oculto"); }
$$("#timer [data-timer]").forEach((b) => (b.onclick = () => { const v = +b.dataset.timer; if (!v) return pararTimer(); timerFim += v * 1000; $("#timer").classList.remove("fim"); tickTimer(); }));

// ---------- telas ----------
let aba = ["treinar", "progresso", "corpo", "exercicios", "guia"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "treinar";
function irPara(nova) { aba = nova; history.replaceState(null, "", "#" + nova); $$(".abas button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba)); render(); window.scrollTo(0, 0); }
$$(".abas button").forEach((b) => (b.onclick = () => irPara(b.dataset.aba)));

const graficos = [];
function limparGraficos() { while (graficos.length) graficos.pop().destroy(); }

function render() {
  limparGraficos();
  const p = perfil();
  $("#perfil-nome").textContent = p ? p.dados.nome : "Criar perfil";
  const main = $("#conteudo");
  if (!p && aba !== "exercicios" && aba !== "guia") {
    main.innerHTML = `<div class="card"><h2>Bem-vindo 👋</h2><p>Crie um perfil para cada pessoa que vai usar o app. Cada um tem seu programa, histórico e gráficos.</p><button class="btn prim" id="primeiro">Criar perfil</button></div>`;
    $("#primeiro").onclick = () => formPerfil(null);
    return;
  }
  ({ treinar: telaTreinar, progresso: telaProgresso, corpo: telaCorpo, exercicios: telaExercicios, guia: telaGuia })[aba](main);
}

function telaTreinar(main) {
  rascunho = ls.get(chaveRascunho(), null);
  if (rascunho) return telaSessao(main);
  const p = perfil().dados;
  const prog = PROGRAMAS[p.programa];
  const prox = proximoDia(p.programa);
  const semana = inicioSemana(hojeISO());
  const naSemana = sessoes().filter((s) => inicioSemana(s.dados.data) === semana).length;
  main.innerHTML = `
    <h2>${esc(prog.nome)}</h2>
    <p class="suave">${esc(prog.resumo)} Esta semana: <b>${naSemana}/5</b> treinos.</p>
    <div class="dias">${prog.dias.map((d, i) => `
      <button class="dia ${i === prox ? "sugerido" : ""}" data-dia="${i}">
        <span class="suave">Dia ${i + 1}${i === prox ? " · próximo" : ""}</span><b>${esc(d.nome)}</b>
        <span class="suave">${d.itens.length} exercícios · ${d.itens.reduce((a, x) => a + x.series, 0)} séries</span>
      </button>`).join("")}</div>
    <h2>Histórico</h2>
    <div class="historico">${sessoes().slice(0, 30).map((s) => `
      <div class="card" data-sessao="${s.id}">
        <div class="linha entre"><b>${esc(s.dados.nomeDia)}</b><span class="suave">${fmtData(s.dados.data)}${s.dados.duracao ? ` · ${s.dados.duracao} min` : ""}</span></div>
        <div class="suave">${s.dados.itens.length} exercícios · ${s.dados.itens.reduce((a, i) => a + i.series.length, 0)} séries · ${fmtKg(volumeCarga(s.dados))} kg movidos</div>
      </div>`).join("") || `<p class="suave">Nenhum treino ainda. Toque num dia acima para começar.</p>`}</div>`;
  $$("[data-dia]").forEach((b) => (b.onclick = () => iniciarTreino(+b.dataset.dia)));
  $$("[data-sessao]").forEach((c) => (c.onclick = () => verSessao(DB.regs.get(c.dataset.sessao))));
}

const volumeCarga = (d) => d.itens.reduce((a, it) => a + (EXERCICIOS[it.ex]?.tempo ? 0 : it.series.reduce((b, s) => b + (s.kg || 0) * s.reps, 0)), 0);

function verSessao(reg) {
  const d = reg.dados;
  abrirModal(`
    <h2>${esc(d.nomeDia)} · ${fmtData(d.data)}</h2>
    <p class="suave">${d.inicio || ""}${d.duracao ? ` · ${d.duracao} min` : ""} · ${fmtKg(volumeCarga(d))} kg movidos</p>
    ${d.itens.map((it) => `<p><b>${esc(EXERCICIOS[it.ex]?.nome || it.ex)}</b><br><span class="suave">${it.series.map((s) => EXERCICIOS[it.ex]?.tempo ? `${s.reps} s` : `${fmtKg(s.kg)}×${s.reps}${s.rir != null ? ` @${s.rir}` : ""}`).join(" · ")}</span></p>`).join("")}
    ${d.notas ? `<p><i>${esc(d.notas)}</i></p>` : ""}
    <div class="linha"><button class="btn" id="ed">Editar</button><button class="btn perigo" id="ap">Apagar</button><button class="btn" data-fechar style="margin-left:auto">Fechar</button></div>`);
  $("#ed").onclick = () => editarSessao(reg);
  $("#ap").onclick = async () => { if (confirm("Apagar este treino?")) { await DB.apagar(reg); fecharModal(); render(); } };
}

function telaSessao(main) {
  const r = rascunho;
  const salvar = () => ls.set(chaveRascunho(), r);
  main.innerHTML = `
    <div class="linha entre"><h2>${esc(r.nomeDia)}${r.editando ? " (editando)" : ""}</h2><span class="suave">${fmtData(r.data)}</span></div>
    ${r.itens.map((it, i) => {
      const ex = EXERCICIOS[it.ex]; const sug = sugestao(it);
      const alternativas = Object.entries(EXERCICIOS).filter(([k, e]) => k !== it.ex && e.prim[0] === ex.prim[0]);
      return `
      <div class="card" data-item="${i}">
        <div class="ex">
          <img src="${imgEx(it.ex)}" alt="" data-anim="${it.ex}" loading="lazy">
          <div>
            <div class="linha entre"><h3>${esc(ex.nome)}</h3><button class="btn peq" data-info="${it.ex}">ⓘ</button></div>
            <div class="alvo">${it.nSeries ?? it.series.length} × ${it.min}–${it.max}${ex.tempo ? " s" : ""} <span class="suave">· RIR ${esc(it.rir)}</span></div>
            <div class="sugestao ${sug.cls}">${esc(sug.txt)}</div>
          </div>
        </div>
        <table class="series"><thead><tr><th>#</th>${ex.tempo ? "" : "<th>kg</th>"}<th>${ex.tempo ? "seg" : "reps"}</th><th>RIR</th><th></th></tr></thead><tbody>
          ${it.series.map((s, j) => `
            <tr class="${s.feita ? "feita" : ""}" data-serie="${j}">
              <td class="suave">${j + 1}</td>
              ${ex.tempo ? "" : `<td><input inputmode="decimal" data-k="kg" value="${s.kg ?? ""}" placeholder="kg"></td>`}
              <td><input inputmode="numeric" data-k="reps" value="${s.reps ?? ""}" placeholder="${it.min}–${it.max}"></td>
              <td><select data-k="rir"><option value="">–</option>${[0, 1, 2, 3, 4].map((v) => `<option ${s.rir === v ? "selected" : ""}>${v}</option>`).join("")}<option value="5" ${s.rir === 5 ? "selected" : ""}>5+</option></select></td>
              <td><button class="check" data-feita>✓</button></td>
            </tr>`).join("")}
        </tbody></table>
        <div class="linha" style="margin-top:8px">
          <button class="btn peq" data-mais>+ série</button>
          <button class="btn peq" data-menos>− série</button>
          ${alternativas.length ? `<select data-trocar style="margin-left:auto;max-width:55%"><option value="">Trocar exercício…</option>${alternativas.map(([k, e]) => `<option value="${k}">${esc(e.nome)}</option>`).join("")}</select>` : ""}
        </div>
      </div>`;
    }).join("")}
    <div class="card"><label class="campo">Anotações do treino<textarea id="notas" rows="2" placeholder="Sono, dor, energia, máquina diferente…">${esc(r.notas)}</textarea></label></div>
    <div class="linha"><button class="btn ok" id="fim" style="flex:1">Finalizar treino</button><button class="btn perigo" id="descartar">Descartar</button></div>`;

  $$("[data-item]").forEach((card) => {
    const it = r.itens[+card.dataset.item];
    const ex = EXERCICIOS[it.ex];
    $$("tr[data-serie]", card).forEach((tr) => {
      const s = it.series[+tr.dataset.serie];
      $$("[data-k]", tr).forEach((inp) => (inp.onchange = () => {
        const v = inp.dataset.k === "rir" ? (inp.value === "" ? null : +inp.value) : num(inp.value);
        s[inp.dataset.k] = v;
        // carga digitada se propaga para as séries seguintes ainda vazias
        if (inp.dataset.k === "kg") it.series.slice(+tr.dataset.serie + 1).forEach((o) => { if (!o.feita) o.kg = v; });
        salvar();
        if (inp.dataset.k === "kg") $$("tr[data-serie]", card).forEach((t2) => { const o = it.series[+t2.dataset.serie]; const i2 = $('[data-k="kg"]', t2); if (i2 && document.activeElement !== i2) i2.value = o.kg ?? ""; });
      }));
      $("[data-feita]", tr).onclick = () => {
        $$("[data-k]", tr).forEach((inp) => inp.onchange());
        if (!s.feita && !(s.reps > 0)) { $('[data-k="reps"]', tr).focus(); return; }
        s.feita = !s.feita; tr.classList.toggle("feita", s.feita); salvar();
        if (s.feita) iniciarTimer(ex.tipo === "composto" ? 150 : 90);
      };
    });
    $("[data-mais]", card).onclick = () => { const u = it.series.at(-1); it.series.push({ kg: u?.kg ?? null, reps: null, rir: null, feita: false }); salvar(); render(); };
    $("[data-menos]", card).onclick = () => { if (it.series.length > 1) { it.series.pop(); salvar(); render(); } };
    const tr = $("[data-trocar]", card);
    if (tr) tr.onchange = () => { if (!tr.value) return; it.ex = tr.value; const sug = sugestao(it); it.series.forEach((s) => { if (!s.feita) s.kg = sug.kg ?? null; }); salvar(); render(); };
  });
  $$("[data-info]").forEach((b) => (b.onclick = () => verExercicio(b.dataset.info)));
  $$("img[data-anim]").forEach((img) => (img.onclick = () => verExercicio(img.dataset.anim)));
  $("#notas").oninput = (e) => { r.notas = e.target.value; salvar(); };
  $("#fim").onclick = finalizarTreino;
  $("#descartar").onclick = () => { if (confirm(r.editando ? "Sair sem salvar as alterações?" : "Descartar este treino?")) { rascunho = null; ls.del(chaveRascunho()); pararTimer(); render(); } };
}

// ---------- progresso ----------
function telaProgresso(main) {
  const ss = sessoes();
  if (!ss.length) { main.innerHTML = `<h2>Progresso</h2><p class="suave">Registre alguns treinos e os gráficos aparecem aqui.</p>`; return; }
  const exComDados = [...new Set(ss.flatMap((s) => s.dados.itens.map((i) => i.ex)))].filter((e) => EXERCICIOS[e] && !EXERCICIOS[e].tempo);
  const semanaAtual = inicioSemana(hojeISO());
  const semanas = [...new Set(ss.map((s) => inicioSemana(s.dados.data)))].sort();
  const quatro = new Date(); quatro.setDate(quatro.getDate() - 28);
  const ult28 = ss.filter((s) => new Date(s.dados.data + "T12:00") >= quatro).length;

  main.innerHTML = `
    <h2>Progresso</h2>
    <div class="kpis">
      <div class="kpi"><span class="suave">Treinos</span><b>${ss.length}</b></div>
      <div class="kpi"><span class="suave">Últimos 28 dias</span><b>${ult28}</b><span class="suave">${(ult28 / 4).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/semana</span></div>
      <div class="kpi"><span class="suave">Semanas treinadas</span><b>${semanas.length}</b></div>
      <div class="kpi"><span class="suave">Carga total movida</span><b>${fmtKg(ss.reduce((a, s) => a + volumeCarga(s.dados), 0) / 1000)} t</b></div>
    </div>

    <div class="card">
      <div class="linha entre"><h3>Evolução por exercício</h3>
        <select id="sel-ex">${exComDados.map((e) => `<option value="${e}">${esc(EXERCICIOS[e].nome)}</option>`).join("")}</select></div>
      <p class="suave">1RM estimado (Epley com reps + RIR) e a maior carga de cada treino. Subindo = ganhando força.</p>
      <div class="grafico"><canvas id="g-ex"></canvas></div>
      <div id="recordes" class="suave" style="margin-top:8px"></div>
    </div>

    <div class="card">
      <div class="linha entre"><h3>Séries por músculo</h3>
        <select id="sel-sem">${semanas.slice().reverse().map((w) => `<option value="${w}">${w === semanaAtual ? "Esta semana" : "Semana de " + fmtData(w)}</option>`).join("")}</select></div>
      <p class="suave">Faixa verde = 10–20 séries semanais (zona recomendada). Secundários contam meia série.</p>
      <div id="volume"></div>
    </div>

    <div class="card">
      <h3>Treinos por semana</h3>
      <div class="grafico" style="height:180px"><canvas id="g-freq"></canvas></div>
    </div>`;

  const desenhaEx = () => {
    const exId = $("#sel-ex").value;
    const h = historicoEx(exId).slice().reverse();
    const pts = h.map((x) => ({ data: x.data, e1: Math.max(...x.series.map((s) => e1rm(s.kg, s.reps, s.rir))), top: Math.max(...x.series.map((s) => s.kg || 0)) }));
    graficos.splice(0).forEach((g) => g.destroy());
    graficos.push(linha($("#g-ex"), pts.map((p) => fmtData(p.data)), [
      { label: "1RM estimado", data: pts.map((p) => Math.round(p.e1 * 10) / 10), cor: cssVar("--destaque") },
      { label: "Maior carga", data: pts.map((p) => p.top), cor: cssVar("--suave") },
    ]));
    const melhor = pts.reduce((m, p) => (p.e1 > (m?.e1 || 0) ? p : m), null);
    const prim = pts[0];
    const ganho = prim && melhor ? ((melhor.e1 / prim.e1 - 1) * 100) : 0;
    $("#recordes").innerHTML = melhor ? `Recorde: <b>${fmtKg(melhor.e1)} kg</b> de 1RM estimado em ${fmtData(melhor.data)} · maior carga usada <b>${fmtKg(Math.max(...pts.map((p) => p.top)))} kg</b> · ${ganho >= 0 ? "+" : ""}${ganho.toFixed(1)}% desde o primeiro registro` : "";
    graficos.push(frequencia());
  };
  const desenhaVol = () => {
    const w = $("#sel-sem").value;
    const vol = Object.fromEntries(Object.keys(MUSCULOS).map((m) => [m, 0]));
    ss.filter((s) => inicioSemana(s.dados.data) === w).forEach((s) => s.dados.itens.forEach((it) => {
      const ex = EXERCICIOS[it.ex]; if (!ex) return;
      const n = it.series.length;
      ex.prim.forEach((m) => (vol[m] += n)); ex.sec.forEach((m) => (vol[m] += n / 2));
    }));
    const max = 24;
    $("#volume").innerHTML = Object.entries(vol).map(([m, v]) => `
      <div class="vol-linha"><span>${MUSCULOS[m]}</span>
        <div class="vol-barra"><div class="vol-faixa" style="left:${(10 / max) * 100}%;width:${(10 / max) * 100}%"></div><div class="vol-valor" style="width:${Math.min(v, max) / max * 100}%"></div></div>
        <b style="text-align:right">${v.toLocaleString("pt-BR")}</b></div>`).join("");
  };
  const frequencia = () => {
    const ultimas = semanas.slice(-12);
    return barras($("#g-freq"), ultimas.map(fmtData), ultimas.map((w) => ss.filter((s) => inicioSemana(s.dados.data) === w).length));
  };
  $("#sel-ex").onchange = desenhaEx; $("#sel-sem").onchange = desenhaVol;
  if (exComDados.length) desenhaEx(); else graficos.push(frequencia());
  desenhaVol();
}

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function baseOpcoes() {
  const grade = cssVar("--borda"), txt = cssVar("--suave");
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: txt, boxWidth: 12 } } },
    scales: { x: { ticks: { color: txt, maxRotation: 0, autoSkip: true }, grid: { color: grade } }, y: { ticks: { color: txt }, grid: { color: grade } } },
  };
}
function linha(canvas, labels, series) {
  return new Chart(canvas, { type: "line", data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, borderColor: s.cor, backgroundColor: s.cor, tension: 0.25, pointRadius: 3, spanGaps: true, borderDash: s.tracejado ? [5, 4] : undefined })) }, options: baseOpcoes() });
}
function barras(canvas, labels, dados) {
  const o = baseOpcoes(); o.plugins.legend.display = false; o.scales.y.ticks.stepSize = 1; o.scales.y.suggestedMax = 5;
  return new Chart(canvas, { type: "bar", data: { labels, datasets: [{ data: dados, backgroundColor: cssVar("--destaque"), borderRadius: 6 }] }, options: o });
}

// ---------- corpo e calorias ----------
const medidas = () => DB.todos("corpo", perfilId).sort((a, b) => a.dados.data.localeCompare(b.dados.data));
const CAMPOS_CORPO = [["peso", "Peso (kg)"], ["cintura", "Cintura (cm)"], ["quadril", "Quadril (cm)"], ["braco", "Braço (cm)"], ["coxa", "Coxa (cm)"], ["gordura", "Gordura (%)"]];

function telaCorpo(main) {
  const ms = medidas();
  const ult = ms.at(-1)?.dados;
  const p = perfil().dados;
  main.innerHTML = `
    <h2>Corpo</h2>
    <form id="f-corpo" class="card linha">
      <label class="campo">Data<input type="date" name="data" value="${hojeISO()}"></label>
      ${CAMPOS_CORPO.map(([k, l]) => `<label class="campo">${l}<input name="${k}" inputmode="decimal" placeholder="${ult?.[k] != null ? fmtKg(ult[k]) : ""}"></label>`).join("")}
      <button class="btn prim cheio" type="submit">Registrar medidas</button>
      <p class="suave" style="margin:0">Dica: pese-se em jejum, de manhã, e olhe a média da semana — o peso do dia varia 1–2 kg por água.</p>
    </form>
    ${ms.length ? `<div class="card"><h3>Peso</h3><div class="grafico"><canvas id="g-peso"></canvas></div><div id="tendencia" class="suave"></div></div>
      <div class="card"><h3>Medidas</h3><p class="suave">Variação em cm desde o primeiro registro de cada medida.</p><div class="grafico"><canvas id="g-med"></canvas></div></div>
      <div class="card"><h3>Registros</h3>${ms.slice().reverse().slice(0, 20).map((m) => `<div class="linha entre" style="padding:4px 0;border-bottom:1px solid var(--borda)"><span>${fmtData(m.dados.data)}</span><span class="suave">${CAMPOS_CORPO.filter(([k]) => m.dados[k] != null).map(([k, l]) => `${l.split(" ")[0]} ${fmtKg(m.dados[k])}`).join(" · ")}</span><button class="btn peq perigo" data-apagar="${m.id}">✕</button></div>`).join("")}</div>` : ""}
    <div class="card" id="calc"></div>`;

  $("#f-corpo").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const dados = { perfil: perfilId, data: f.data.value };
    let algum = false;
    CAMPOS_CORPO.forEach(([k]) => { const v = num(f[k].value); if (v != null) { dados[k] = v; algum = true; } });
    if (!algum) return alert("Preencha pelo menos uma medida.");
    await DB.gravar("corpo", dados); render();
  };
  $$("[data-apagar]").forEach((b) => (b.onclick = async () => { if (confirm("Apagar este registro?")) { await DB.apagar(DB.regs.get(b.dataset.apagar)); render(); } }));

  if (ms.length) {
    const pesos = ms.filter((m) => m.dados.peso != null);
    const media = pesos.map((_, i) => { const jan = pesos.slice(Math.max(0, i - 6), i + 1); return Math.round(jan.reduce((a, m) => a + m.dados.peso, 0) / jan.length * 10) / 10; });
    graficos.push(linha($("#g-peso"), pesos.map((m) => fmtData(m.dados.data)), [
      { label: "Peso", data: pesos.map((m) => m.dados.peso), cor: cssVar("--suave") },
      { label: "Média (7 registros)", data: media, cor: cssVar("--destaque") },
    ]));
    if (pesos.length >= 2) {
      const a = pesos[0].dados, b = pesos.at(-1).dados;
      const dias = Math.max(1, (new Date(b.data) - new Date(a.data)) / 864e5);
      const porSem = (b.peso - a.peso) / dias * 7;
      const pct = porSem / a.peso * 100;
      let leitura = "";
      if (p.objetivo === "emagrecimento") leitura = pct > -0.25 ? "Perda lenta: se faz 2–3 semanas assim, reduza ~150–200 kcal/dia ou some passos." : pct < -1.2 ? "Perda rápida demais: risco de perder músculo; coma um pouco mais." : "Ritmo bom (0,25–1% por semana).";
      else if (p.objetivo === "hipertrofia") leitura = pct < 0 ? "Peso caindo: para ganhar músculo, coma um pouco mais." : pct > 0.6 ? "Subindo rápido: parte disso é gordura; pode reduzir um pouco." : "Ritmo bom para ganho de massa (até ~0,25–0,5% por semana).";
      $("#tendencia").textContent = `Tendência: ${porSem >= 0 ? "+" : ""}${porSem.toFixed(2)} kg/semana (${pct.toFixed(2)}%). ${leitura}`;
    }
    const comp = CAMPOS_CORPO.slice(1, 5).filter(([k]) => ms.some((m) => m.dados[k] != null));
    const cores = [cssVar("--destaque"), cssVar("--ok"), "#4c6ef5", "#ae3ec9"];
    graficos.push(linha($("#g-med"), ms.map((m) => fmtData(m.dados.data)), comp.map(([k, l], i) => { const base = ms.find((m) => m.dados[k] != null).dados[k]; return { label: l.split(" ")[0], data: ms.map((m) => (m.dados[k] != null ? Math.round((m.dados[k] - base) * 10) / 10 : null)), cor: cores[i] }; })));
  }
  calculadora($("#calc"), p, ms.filter((m) => m.dados.peso != null).at(-1)?.dados.peso);
}

function calculadora(el, p, pesoAtual) {
  const idade = p.nascimento ? new Date().getFullYear() - +p.nascimento : "";
  el.innerHTML = `
    <h3>Calorias e proteína</h3>
    <p class="suave">Estimativa (Mifflin-St Jeor). Use como ponto de partida e ajuste pela tendência do peso após 2–3 semanas.</p>
    <form id="f-cal" class="linha">
      <label class="campo">Peso (kg)<input name="peso" inputmode="decimal" value="${pesoAtual ?? ""}"></label>
      <label class="campo">Altura (cm)<input name="altura" inputmode="numeric" value="${esc(p.altura)}"></label>
      <label class="campo">Idade<input name="idade" inputmode="numeric" value="${idade}"></label>
      <label class="campo">Atividade fora da academia<select name="fator">
        <option value="1.375">Sentado o dia todo (&lt;5 mil passos)</option>
        <option value="1.55" selected>Moderado (5–10 mil passos)</option>
        <option value="1.725">Ativo (&gt;10 mil passos ou trabalho físico)</option></select></label>
    </form>
    <div id="res-cal" style="margin-top:10px"></div>`;
  const f = $("#f-cal");
  const calc = () => {
    const peso = num(f.peso.value), alt = num(f.altura.value), id = num(f.idade.value);
    if (!peso || !alt || !id) { $("#res-cal").innerHTML = `<span class="suave">Preencha peso, altura e idade.</span>`; return; }
    const tmb = 10 * peso + 6.25 * alt - 5 * id + (p.sexo === "F" ? -161 : 5);
    const manut = tmb * +f.fator.value;
    const alvo = p.objetivo === "emagrecimento" ? manut * 0.8 : p.objetivo === "hipertrofia" ? manut * 1.1 : manut;
    const prot = peso * (p.objetivo === "emagrecimento" ? 2.0 : 1.8);
    const r = (n) => Math.round(n / 10) * 10;
    $("#res-cal").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="suave">Manutenção</span><b>${r(manut)} kcal</b></div>
        <div class="kpi"><span class="suave">Meta (${p.objetivo === "emagrecimento" ? "−20%" : p.objetivo === "hipertrofia" ? "+10%" : "manter"})</span><b>${r(alvo)} kcal</b></div>
        <div class="kpi"><span class="suave">Proteína/dia</span><b>${Math.round(prot)} g</b><span class="suave">${p.objetivo === "emagrecimento" ? "2,0" : "1,8"} g/kg</span></div>
      </div>`;
  };
  $$("input,select", f).forEach((i) => (i.oninput = calc)); calc();
}

// ---------- exercícios e guia ----------
function telaExercicios(main) {
  main.innerHTML = `
    <h2>Exercícios</h2>
    <div class="linha"><input id="busca" placeholder="Buscar…" style="flex:1"><select id="filtro-m"><option value="">Todos os músculos</option>${Object.entries(MUSCULOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    <div class="lista-ex" id="lista" style="margin-top:10px"></div>`;
  const desenha = () => {
    const q = $("#busca").value.toLowerCase(), m = $("#filtro-m").value;
    $("#lista").innerHTML = Object.entries(EXERCICIOS)
      .filter(([, e]) => e.nome.toLowerCase().includes(q) && (!m || e.prim.includes(m) || e.sec.includes(m)))
      .map(([k, e]) => `<button class="item-ex" data-ex="${k}"><img src="${imgEx(k)}" alt="" loading="lazy"><div><b>${esc(e.nome)}</b><br>${e.prim.map((x) => `<span class="tag">${MUSCULOS[x]}</span>`).join("")}<span class="suave"> ${e.tipo}</span></div></button>`).join("");
    $$("[data-ex]").forEach((b) => (b.onclick = () => verExercicio(b.dataset.ex)));
  };
  $("#busca").oninput = desenha; $("#filtro-m").onchange = desenha; desenha();
}

function verExercicio(id) {
  const e = EXERCICIOS[id];
  const h = perfil() ? historicoEx(id).slice(0, 5) : [];
  abrirModal(`
    <h2>${esc(e.nome)}</h2>
    <div class="galeria"><img src="${imgEx(id, 0)}" alt="Posição inicial"><img src="${imgEx(id, 1)}" alt="Posição final"></div>
    <p>${e.prim.map((m) => `<span class="tag">${MUSCULOS[m]}</span>`).join("")}${e.sec.map((m) => `<span class="tag" style="opacity:.6">${MUSCULOS[m]}</span>`).join("")}</p>
    <p>${esc(e.desc)}</p>
    <h3>Dicas</h3><ul>${e.dicas.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    <h3>Erros comuns</h3><ul>${e.erros.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    ${h.length ? `<h3>Seus últimos registros</h3>${h.map((x) => `<div class="suave">${fmtData(x.data)}: ${x.series.map((s) => e.tempo ? `${s.reps} s` : `${fmtKg(s.kg)}×${s.reps}`).join(" · ")}</div>`).join("")}` : ""}
    <p class="suave" style="font-size:.75rem">Imagens: free-exercise-db (domínio público).</p>
    <button class="btn cheio" data-fechar>Fechar</button>`);
}

function telaGuia(main) {
  main.innerHTML = `<h2>Guia baseado em evidência</h2>` + GUIA.map((g) => `<div class="card guia"><h3>${g.titulo}</h3><ul>${g.itens.map((i) => `<li>${i}</li>`).join("")}</ul></div>`).join("");
}

// ---------- menu: backup ----------
function menu() {
  abrirModal(`
    <h2>Menu</h2>
    <div class="lista-ex">
      <button class="btn" id="m-perfis">Perfis</button>
      <button class="btn" id="m-csv">Exportar séries (CSV) deste perfil</button>
      <button class="btn" id="m-json">Baixar backup completo (JSON)</button>
      <label class="btn" style="text-align:center">Restaurar backup (JSON)<input type="file" id="m-imp" accept=".json" hidden></label>
      <button class="btn" data-fechar>Fechar</button>
    </div>
    <p class="suave" id="m-info"></p>`);
  fetch("api/info").then((r) => r.json()).then((i) => ($("#m-info").textContent = `Servidor: ${i.no}${i.par ? ` · sincroniza com ${i.par}` : ""}`)).catch(() => {});
  $("#m-perfis").onclick = escolherPerfil;
  $("#m-json").onclick = () => baixar(`treino-backup-${hojeISO()}.json`, JSON.stringify([...DB.regs.values()], null, 1), "application/json");
  $("#m-csv").onclick = () => {
    if (!perfil()) return;
    const linhas = [["data", "treino", "exercicio", "serie", "kg", "reps", "rir"]];
    sessoes().slice().reverse().forEach((s) => s.dados.itens.forEach((it) => it.series.forEach((x, i) => linhas.push([s.dados.data, s.dados.nomeDia, EXERCICIOS[it.ex]?.nome || it.ex, i + 1, x.kg, x.reps, x.rir ?? ""]))));
    baixar(`treino-${perfil().dados.nome}-${hojeISO()}.csv`, linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n"), "text/csv");
  };
  $("#m-imp").onchange = async (e) => {
    try {
      const regs = JSON.parse(await e.target.files[0].text());
      const r = await fetch("api/registros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(regs) });
      const j = await r.json(); await DB.puxar(); alert(`${j.gravados} registro(s) restaurado(s).`); fecharModal(); render();
    } catch (err) { alert("Arquivo inválido: " + err.message); }
  };
}
function baixar(nome, conteudo, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + conteudo], { type: tipo })); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- modal ----------
function abrirModal(html) {
  $("#modal-corpo").innerHTML = html;
  const d = $("#modal"); if (!d.open) d.showModal();
  $$("[data-fechar]", d).forEach((b) => (b.onclick = fecharModal));
}
function fecharModal() { $("#modal").close(); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });

$("#btn-perfil").onclick = () => (perfis().length ? escolherPerfil() : formPerfil(null));
$("#btn-menu").onclick = menu;

// ---------- início ----------
(async () => {
  await DB.carregar();
  if (!perfil()) perfilId = perfis()[0]?.id ?? null;
  irPara(aba);
  // puxa alterações de outros aparelhos; não redesenha no meio de um treino
  setInterval(async () => { if (await DB.puxar() && !rascunho && !$("#modal").open) render(); }, 30000);
})();
