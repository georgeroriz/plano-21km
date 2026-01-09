(() => {
  const VERSION = "1.0.0";
  const STORAGE_KEY = "mm21_progress_v1";

  const $ = (id) => document.getElementById(id);

  const state = {
    view: "week", // today | week | all
    plan: null,
    progress: loadProgress(),
    selectedDate: null,
    query: ""
  };

  function isoToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function parseISO(s) { // YYYY-MM-DD -> Date at local noon (avoid DST edge)
    const [y,m,d] = s.split("-").map(Number);
    return new Date(y, m-1, d, 12, 0, 0, 0);
  }

  function formatPt(dateISO) {
    const dt = parseISO(dateISO);
    return dt.toLocaleDateString("pt-BR", { weekday:"short", day:"2-digit", month:"2-digit" });
  }

  function weekRange(todayISO) {
    const dt = parseISO(todayISO);
    const day = dt.getDay(); // 0 Sun .. 6 Sat
    const diffToMon = (day === 0 ? -6 : 1 - day); // Monday start
    const mon = new Date(dt);
    mon.setDate(dt.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const toISO = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${dd}`;
    };
    return { start: toISO(mon), end: toISO(sun) };
  }

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  function getProgress(dateISO) {
    return state.progress[dateISO] || { done:false, actual:{} , notes:"" };
  }

  function setProgress(dateISO, patch) {
    const prev = getProgress(dateISO);
    const next = {
      ...prev,
      ...patch,
      actual: { ...(prev.actual || {}), ...((patch.actual)||{}) }
    };
    state.progress[dateISO] = next;
    saveProgress();
  }

  function isRest(session) {
    return (session.tags || []).includes("Descanso");
  }

  function isOverdue(session) {
    const t = isoToday();
    const p = getProgress(session.date);
    return session.date < t && !p.done && !isRest(session);
  }

  function sessionMatchesQuery(session, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    const blob = [
      session.title,
      session.objective,
      session.location,
      ...(session.tags||[]),
      ...(session.steps||[]).map(s => `${s.name} ${s.zone||""} ${s.treadmillKmh||""} ${s.details||""}`)
    ].join(" ").toLowerCase();
    return blob.includes(needle);
  }

  function nextPlannedSession() {
    const t = isoToday();
    const sessions = state.plan.sessions
      .filter(s => !isRest(s))
      .sort((a,b) => a.date.localeCompare(b.date));
    for (const s of sessions) {
      const p = getProgress(s.date);
      if (s.date >= t && !p.done) return s;
    }
    return null;
  }

  function renderTodayCard() {
    const t = isoToday();
    let todaySession = state.plan.sessions.find(s => s.date === t);
    if (!todaySession) {
      const next = nextPlannedSession();
      const el = $("todaySection");
      el.innerHTML = `
        <div class="card today">
          <div class="todayTitleRow">
            <div>
              <h3 class="todayTitle">Hoje</h3>
              <p class="small">Não há item datado para hoje. Próximo treino:</p>
            </div>
          </div>
          ${ next ? renderSessionDetail(next, true) : `<p class="small">Nenhum treino futuro encontrado.</p>` }
        </div>
      `;
      return;
    }

    // se for descanso, ainda assim destacar
    const el = $("todaySection");
    el.innerHTML = `
      <div class="card today">
        <div class="todayTitleRow">
          <div>
            <h3 class="todayTitle">Treino do dia • ${formatPt(todaySession.date)}</h3>
            <div class="metaRow">
              ${renderTags(todaySession.tags)}
              <span class="chip">${todaySession.location || "—"}</span>
              ${todaySession.distanceKm ? `<span class="chip">${todaySession.distanceKm.toFixed(1)} km</span>` : ""}
              ${todaySession.durationMin ? `<span class="chip">${todaySession.durationMin} min</span>` : ""}
            </div>
          </div>
          <div>
            ${renderStatusChip(todaySession)}
          </div>
        </div>
        <p class="small">${escapeHtml(todaySession.objective || "")}</p>
        ${renderSessionDetail(todaySession, true)}
      </div>
    `;
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return "";
    return tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("");
  }

  function renderStatusChip(session) {
    const p = getProgress(session.date);
    if (p.done) return `<span class="chip good">Feito</span>`;
    if (isOverdue(session)) return `<span class="chip bad">Atrasado</span>`;
    if (isRest(session)) return `<span class="chip warn">Descanso</span>`;
    return `<span class="chip">Pendente</span>`;
  }

  function renderSessionDetail(session, showEditor) {
    const p = getProgress(session.date);
    const steps = (session.steps || []).map(st => `
      <div class="step">
        <p class="stepName">${escapeHtml(st.name || "Etapa")}</p>
        <div class="kv">
          ${st.durationMin ? `<span class="chip">${st.durationMin} min</span>` : ""}
          ${st.distanceKm ? `<span class="chip">${Number(st.distanceKm).toFixed(1)} km</span>` : ""}
          ${st.zone ? `<span class="chip">${escapeHtml(st.zone)}</span>` : ""}
          ${st.rpe ? `<span class="chip">RPE ${escapeHtml(st.rpe)}</span>` : ""}
          ${st.hrRef ? `<span class="chip">FC ${escapeHtml(st.hrRef)}</span>` : ""}
          ${st.treadmillKmh ? `<span class="chip">Esteira ${escapeHtml(st.treadmillKmh)} km/h</span>` : ""}
        </div>
        ${st.details ? `<p class="stepDetails">${escapeHtml(st.details)}</p>` : ""}
      </div>
    `).join("");

    const notes = (session.notes || []).length
      ? `<div class="card" style="margin-top:12px">
          <strong>Observações</strong>
          <ul class="small">
            ${(session.notes||[]).map(n => `<li>${escapeHtml(n)}</li>`).join("")}
          </ul>
        </div>`
      : "";

    const post = (session.post || []).length
      ? `<div class="card" style="margin-top:12px">
          <strong>Depois do treino</strong>
          <ul class="small">
            ${(session.post||[]).map(n => `<li>${escapeHtml(n)}</li>`).join("")}
          </ul>
        </div>`
      : "";

    const editor = showEditor ? renderEditor(session, p) : "";

    return `
      <div class="grid">${steps || ""}</div>
      ${notes}
      ${post}
      ${editor}
    `;
  }

  function renderEditor(session, p) {
    const a = p.actual || {};
    return `
      <div class="card" style="margin-top:12px">
        <div class="controls">
          <label class="toggle">
            <input type="checkbox" data-action="done" data-date="${session.date}" ${p.done ? "checked" : ""} />
            <span><strong>Marcar como feito</strong></span>
          </label>
          <button class="btn btn-ghost" data-action="clear" data-date="${session.date}">Limpar registro</button>
        </div>

        <div class="form">
          <label>Distância real (km)
            <input inputmode="decimal" placeholder="ex: 12.4" value="${a.distanceKm ?? ""}" data-action="field" data-field="distanceKm" data-date="${session.date}" />
          </label>
          <label>Tempo real (min)
            <input inputmode="numeric" placeholder="ex: 52" value="${a.durationMin ?? ""}" data-action="field" data-field="durationMin" data-date="${session.date}" />
          </label>
          <label>RPE final (0–10)
            <input inputmode="numeric" placeholder="ex: 7" value="${a.rpe ?? ""}" data-action="field" data-field="rpe" data-date="${session.date}" />
          </label>
          <label>FC média (bpm)
            <input inputmode="numeric" placeholder="ex: 152" value="${a.avgHr ?? ""}" data-action="field" data-field="avgHr" data-date="${session.date}" />
          </label>
          <label>FC máxima (bpm)
            <input inputmode="numeric" placeholder="ex: 164" value="${a.maxHr ?? ""}" data-action="field" data-field="maxHr" data-date="${session.date}" />
          </label>
          <label>Observação rápida
            <input placeholder="ex: 'pesou no 2º bloco'" value="${a.quick ?? ""}" data-action="field" data-field="quick" data-date="${session.date}" />
          </label>

          <label>Notas (o que funcionou / ajustes)
            <textarea placeholder="Ex: 'Z2 ficou alto; reduzi 0,2 km/h e estabilizou.'"
              data-action="notes" data-date="${session.date}">${escapeHtml(p.notes || "")}</textarea>
          </label>
        </div>

        <div class="small">Dica: o plano planejado (plan.json) você edita no GitHub; aqui você registra o realizado.</div>
      </div>
    `;
  }

  function renderList() {
    const today = isoToday();
    const range = weekRange(today);
    let sessions = state.plan.sessions.slice().sort((a,b) => a.date.localeCompare(b.date));

    if (state.view === "today") {
      sessions = sessions.filter(s => s.date === today);
      $("listTitle").textContent = "Hoje";
      $("listHint").textContent = formatHint(sessions);
    } else if (state.view === "week") {
      sessions = sessions.filter(s => s.date >= range.start && s.date <= range.end);
      $("listTitle").textContent = "Semana";
      $("listHint").textContent = `${formatPt(range.start)} → ${formatPt(range.end)}`;
    } else {
      $("listTitle").textContent = "Tudo";
      $("listHint").textContent = formatHint(sessions);
    }

    if (state.query) {
      sessions = sessions.filter(s => sessionMatchesQuery(s, state.query));
      $("listHint").textContent = `Filtro: "${state.query}" • ${sessions.length} itens`;
    }

    const html = sessions.map(s => renderRow(s)).join("");
    $("list").innerHTML = html || `<div class="card">Nada para mostrar.</div>`;

    // auto select today if present
    const want = state.selectedDate || (sessions.find(s => s.date === today)?.date) || sessions[0]?.date;
    if (want) openDrawer(want, true);
  }

  function formatHint(sessions) {
    return `${sessions.length} itens`;
  }

  function renderRow(session) {
    const p = getProgress(session.date);
    const dotClass = p.done ? "done" : (isOverdue(session) ? "overdue" : "");
    const badges = [
      (session.tags||[])[0] ? `<span class="badge">${escapeHtml((session.tags||[])[0])}</span>` : "",
      session.distanceKm ? `<span class="badge">${session.distanceKm.toFixed(1)} km</span>` : "",
      session.durationMin ? `<span class="badge">${session.durationMin} min</span>` : ""
    ].filter(Boolean).join("");

    return `
      <div class="row" data-date="${session.date}">
        <div class="dot ${dotClass}"></div>
        <div class="rowMain">
          <p class="rowTitle">${escapeHtml(session.title || "")}</p>
          <div class="rowSub">
            <span>${formatPt(session.date)}</span>
            ${badges}
            ${p.done ? `<span class="badge" style="border-color:rgba(34,197,94,0.35);background:rgba(34,197,94,0.10)">Feito</span>` : ""}
            ${isOverdue(session) ? `<span class="badge" style="border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.10)">Atrasado</span>` : ""}
          </div>
          <div class="drawer" id="drawer-${session.date}" style="display:none"></div>
        </div>
      </div>
    `;
  }

  function openDrawer(dateISO, scrollIntoView) {
    state.selectedDate = dateISO;
    const all = document.querySelectorAll("[id^='drawer-']");
    all.forEach(el => { el.style.display = "none"; el.innerHTML = ""; });

    const drawer = document.querySelector(`#drawer-${CSS.escape(dateISO)}`);
    const session = state.plan.sessions.find(s => s.date === dateISO);
    if (!drawer || !session) return;
    drawer.style.display = "block";
    drawer.innerHTML = `<div class="card">${renderSessionDetail(session, false)}</div>`;

    if (scrollIntoView) {
      const row = document.querySelector(`.row[data-date="${CSS.escape(dateISO)}"]`);
      row?.scrollIntoView({ block:"nearest", behavior:"smooth" });
    }
  }

  function bindEvents() {
    $("btnToday").addEventListener("click", () => { state.view="today"; state.query=""; $("search").value=""; renderList(); });
    $("btnWeek").addEventListener("click", () => { state.view="week"; state.query=""; $("search").value=""; renderList(); });
    $("btnAll").addEventListener("click", () => { state.view="all"; state.query=""; $("search").value=""; renderList(); });

    $("search").addEventListener("input", (e) => {
      state.query = (e.target.value || "").trim();
      renderList();
    });

    $("btnExport").addEventListener("click", () => exportProgress());

    $("fileImport").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const obj = JSON.parse(text);
        if (typeof obj !== "object" || obj === null) throw new Error("Formato inválido");
        // merge
        state.progress = { ...state.progress, ...obj };
        saveProgress();
        renderTodayCard();
        renderList();
        alert("Importado com sucesso.");
      } catch {
        alert("Não foi possível importar. Verifique se é um JSON válido.");
      } finally {
        e.target.value = "";
      }
    });

    $("list").addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      if (!row) return;
      openDrawer(row.dataset.date, false);
    });

    // Delegated events in today editor
    $("todaySection").addEventListener("change", (e) => {
      const el = e.target;
      const dateISO = el.dataset?.date;
      const action = el.dataset?.action;
      if (!dateISO || !action) return;

      if (action === "done") {
        setProgress(dateISO, { done: el.checked });
        renderTodayCard();
        renderList();
      }
      if (action === "field") {
        const field = el.dataset.field;
        const value = el.value;
        const num = (value === "" ? "" : Number(String(value).replace(",", ".")));
        setProgress(dateISO, { actual: { [field]: (value === "" || Number.isNaN(num)) ? value : num } });
      }
    });

    $("todaySection").addEventListener("input", (e) => {
      const el = e.target;
      const dateISO = el.dataset?.date;
      const action = el.dataset?.action;
      if (!dateISO || !action) return;

      if (action === "notes") {
        setProgress(dateISO, { notes: el.value });
      }
    });

    $("todaySection").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='clear']");
      if (!btn) return;
      const dateISO = btn.dataset.date;
      if (!dateISO) return;
      if (!confirm("Limpar registro desse dia?")) return;
      delete state.progress[dateISO];
      saveProgress();
      renderTodayCard();
      renderList();
    });

    $("version").textContent = VERSION;
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0,10);
    a.download = `mm21-progresso-${ts}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (m) => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    }[m]));
  }

  async function init() {
    const res = await fetch("./plan.json", { cache:"no-store" });
    state.plan = await res.json();

    // opcional: carregar progresso versionado no repositório (progress.json)
    // - isso permite que você "sincronize" entre dispositivos via commit no GitHub
    try {
      const pr = await fetch("./progress.json", { cache:"no-store" });
      if (pr.ok) {
        const remote = await pr.json();
        if (remote && typeof remote === "object") {
          // remoto entra primeiro; local (do navegador) sobrescreve
          state.progress = { ...remote, ...state.progress };
          saveProgress();
        }
      }
    } catch {}

    // default view = week and auto focus today
    state.view = "week";
    state.selectedDate = isoToday();

    renderTodayCard();
    renderList();
    bindEvents();
  }

  init().catch(() => {
    document.body.innerHTML = "<div class='container'><div class='card'>Não foi possível carregar o plano. Verifique se plan.json está acessível.</div></div>";
  });
})();
