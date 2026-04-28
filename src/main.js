import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as THREE from "three";

const STATE = {
  components: null, world: null, fragments: null,
  ifcLoader: null, highlighter: null, model: null,
  jsonData: null, elementMap: {}, ifcGuidMap: {},
  guidToLocalId: {}, localIdToEl: {},
  coloreado: false, filtroActual: "todos",
};
window.STATE = STATE;
const HOY = new Date();

const COLORES = {
  "Terminado": new THREE.Color(0x22C55E),
  "Inspeccionado": new THREE.Color(0x38BDF8),
  "En proceso": new THREE.Color(0xFB923C),
  "No iniciado": new THREE.Color(0x52525B),
  "Sin estado": new THREE.Color(0x3F3F46),
  "atrasado": new THREE.Color(0xEF4444),
};

async function initVisor() {
  const container = document.getElementById("visor-container");
  STATE.components = new OBC.Components();
  const worlds = STATE.components.get(OBC.Worlds);
  STATE.world = worlds.create();
  STATE.world.scene = new OBC.SimpleScene(STATE.components);
  STATE.world.renderer = new OBCF.PostproductionRenderer(STATE.components, container);
  STATE.world.camera = new OBC.OrthoPerspectiveCamera(STATE.components);
  STATE.components.init();
  STATE.world.scene.setup();
  STATE.world.scene.three.background = new THREE.Color(0x0A0A0B);

  const renderer = STATE.world.renderer.three;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio * 0.75, 1.5));
  renderer.shadowMap.enabled = false;

  const grids = STATE.components.get(OBC.Grids);
  grids.create(STATE.world);

  const workerUrl = await OBC.FragmentsManager.getWorker();
  STATE.fragments = STATE.components.get(OBC.FragmentsManager);
  STATE.fragments.init(workerUrl);

  let updateTimeout = null;
  STATE.world.camera.controls.addEventListener("update", () => {
    STATE.fragments.core.update();
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => STATE.fragments.core.update(true), 100);
  });

  STATE.fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
  });

  STATE.highlighter = STATE.components.get(OBCF.Highlighter);
  STATE.highlighter.setup({ world: STATE.world });
  STATE.highlighter.zoomToSelection = false;
  for (const [estado, color] of Object.entries(COLORES)) {
    STATE.highlighter.styles.set(estado, { color, opacity: 1 });
  }

  STATE.fragments.list.onItemSet.add(({ value: model }) => {
    STATE.model = model;
    model.useCamera(STATE.world.camera.three);
    STATE.world.scene.three.add(model.object);
    STATE.fragments.core.update(true);
    ocultarLoading();
    toast("Modelo IFC cargado");
    document.getElementById("tb-project").textContent =
      STATE.jsonData ? STATE.jsonData.proyecto : "Modelo cargado";
    actualizarBtnColorear();
    ajustarCamara();
  });

  STATE.ifcLoader = STATE.components.get(OBC.IfcLoader);
  await STATE.ifcLoader.setup({
    autoSetWasm: false,
    wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
  });

  const raycasters = STATE.components.get(OBC.Raycasters);
  const raycaster = raycasters.get(STATE.world);
  container.addEventListener("click", async (e) => {
    if (e.target.closest("#panel-left") || e.target.closest("#panel-info")) return;
    const result = await raycaster.castRay();
    if (result && result.localId !== undefined) mostrarInfoElemento(result.localId);
    else cerrarInfo();
  });

  const btnFrag = document.getElementById("btn-export-frag");
  if (btnFrag) btnFrag.addEventListener("click", exportarFrag);

  toast("Visor listo");
}

async function ajustarCamara() {
  try {
    const box = new THREE.Box3();
    STATE.world.scene.three.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.computeBoundingBox();
        if (obj.geometry?.boundingBox)
          box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
      }
    });
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const d = Math.max(size.x, size.y, size.z);
    await STATE.world.camera.controls.setLookAt(
      center.x + d, center.y + d * 0.6, center.z + d,
      center.x, center.y, center.z, true
    );
  } catch (e) { }
}

window.cargarIFC = async function (file) {
  if (!file) return;
  mostrarLoading("Convirtiendo IFC...");
  if (STATE.model) {
    STATE.world.scene.three.remove(STATE.model.object);
    STATE.model = null; STATE.coloreado = false;
  }
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    await STATE.ifcLoader.load(data, true, file.name.replace(".ifc", ""), {
      processData: {
        progressCallback: (p) => {
          document.getElementById("loading-txt").textContent =
            "Procesando... " + Math.round(p * 100) + "%";
        },
      },
    });
    document.getElementById("dz-ifc").classList.add("loaded");
    document.getElementById("dz-ifc-txt").textContent = file.name;
  } catch (err) {
    ocultarLoading();
    toast("Error IFC: " + err.message);
  }
};

window.cargarJSON = function (file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      STATE.jsonData = data.elementos ? data : { proyecto: "Proyecto", elementos: [] };
      STATE.elementMap = {}; STATE.ifcGuidMap = {};
      STATE.jsonData.elementos.forEach(el => {
        el._est = normEst(el.estado_ejecucion || el.estado || "");
        STATE.elementMap[el.element_id] = el;
        if (el.ifc_guid) STATE.ifcGuidMap[el.ifc_guid] = el;
      });
      document.getElementById("dz-json").classList.add("loaded");
      document.getElementById("dz-json-txt").textContent = file.name;
      const n = Object.keys(STATE.ifcGuidMap).length;
      actualizarStats(); actualizarBtnColorear();
      toast(n > 0 ? "JSON cargado — " + n + " IFC GUIDs" : "JSON sin ifc_guid — re-exporta con v3.2");
      if (STATE.model)
        document.getElementById("tb-project").textContent = STATE.jsonData.proyecto || "Proyecto";
    } catch (err) { toast("JSON inválido"); }
  };
  reader.readAsText(file);
};

window.colorearModelo = async function () {
  if (!STATE.model || !STATE.jsonData) return;
  mostrarLoading("Coloreando modelo...");
  try {
    await aplicarColores();
    STATE.coloreado = true;
    const btnReset = document.getElementById("btn-reset");
    if (btnReset) btnReset.disabled = false;
    ocultarLoading();
  } catch (err) {
    ocultarLoading(); toast("Error: " + err.message); console.error(err);
  }
};

async function aplicarColores() {
  const hoy = new Date();
  const allGuids = STATE.jsonData.elementos.filter(el => el.ifc_guid).map(el => el.ifc_guid);
  if (!allGuids.length) { toast("Sin ifc_guid — usa script v3.2"); return; }

  document.getElementById("loading-txt").textContent = "Mapeando " + allGuids.length + " GUIDs...";
  const localIdsList = await STATE.model.getLocalIdsByGuids(allGuids);
  const guidToLocalId = {};
  allGuids.forEach((guid, i) => {
    if (localIdsList[i] !== null && localIdsList[i] !== undefined)
      guidToLocalId[guid] = localIdsList[i];
  });
  STATE.guidToLocalId = guidToLocalId;
  STATE.localIdToEl = {};

  const grupos = {
    "Terminado": [], "Inspeccionado": [], "En proceso": [],
    "No iniciado": [], "Sin estado": [], "atrasado": [],
  };

  for (const el of STATE.jsonData.elementos) {
    if (!el.ifc_guid || guidToLocalId[el.ifc_guid] === undefined) continue;
    const lid = guidToLocalId[el.ifc_guid];
    STATE.localIdToEl[lid] = el;
    const est = el._est;
    const atrasado = (() => {
      if (est === "Terminado" || est === "Inspeccionado") return false;
      const f = parseF(el.fecha_fin_plan); return f && f < hoy;
    })();
    const g = atrasado ? "atrasado" : (grupos[est] !== undefined ? est : "Sin estado");
    grupos[g].push(lid);
  }

  const mapeados = Object.keys(guidToLocalId).length;
  document.getElementById("loading-txt").textContent = "Aplicando colores a " + mapeados + " elementos...";

  try { await STATE.highlighter.clear(); } catch (e) { }

  const modelId = STATE.model.modelId;
  for (const [estado, ids] of Object.entries(grupos)) {
    if (!ids.length) continue;
    try {
      await STATE.highlighter.highlightByID(estado, { [modelId]: new Set(ids) }, false, false);
    } catch (e) { console.warn(estado, e.message); }
  }

  await STATE.fragments.core.update(true);
  toast(mapeados + " elementos coloreados");
}

window.resetColores = async function () {
  if (!STATE.model) return;
  mostrarLoading("Reseteando colores...");
  try {
    await STATE.highlighter.clear();
    STATE.coloreado = false;
    await STATE.fragments.core.update(true);
    document.querySelectorAll(".filtro-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".filtro-btn")[0].classList.add("active");
    STATE.filtroActual = "todos";
    await STATE.model.threads.invoke(STATE.model.modelId, "resetVisible", []);
    await STATE.fragments.core.update(true);
    const btnReset = document.getElementById("btn-reset");
    if (btnReset) btnReset.disabled = true;
    ocultarLoading();
    toast("✓ Colores reseteados");
  } catch (err) { ocultarLoading(); toast("Error: " + err.message); }
};

window.filtrarEstado = async function (estado, btn) {
  STATE.filtroActual = estado;
  document.querySelectorAll(".filtro-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (!STATE.model || !STATE.coloreado) return;
  mostrarLoading("Filtrando...");
  try {
    const hoy = new Date();
    const gmap = STATE.guidToLocalId || {};
    if (estado === "todos") {
      await STATE.model.threads.invoke(STATE.model.modelId, "resetVisible", []);
      await aplicarColores();
    } else {
      const vis = [], todos = [];
      for (const el of STATE.jsonData.elementos) {
        if (!el.ifc_guid || gmap[el.ifc_guid] === undefined) continue;
        const lid = gmap[el.ifc_guid];
        todos.push(lid);
        const est = el._est;
        const atrasado = (() => {
          if (est === "Terminado" || est === "Inspeccionado") return false;
          const f = parseF(el.fecha_fin_plan); return f && f < hoy;
        })();
        const estNorm = (est || "").trim();
        const estadoNorm = (estado || "").trim();
        if ((estadoNorm === "atrasado" && atrasado) || (estadoNorm !== "atrasado" && estNorm === estadoNorm && !atrasado))
          vis.push(lid);
      }
      await STATE.model.threads.invoke(STATE.model.modelId, "setVisible", [new Int32Array(todos), false]);
      if (vis.length) await STATE.model.threads.invoke(STATE.model.modelId, "setVisible", [new Int32Array(vis), true]);
    }
    await STATE.fragments.core.update(true);
    ocultarLoading();
    toast("Filtro: " + estado);
  } catch (err) { ocultarLoading(); console.error(err); toast("Error filtro: " + err.message); }
};

function mostrarInfoElemento(localId) {
  const el = STATE.localIdToEl[localId];
  document.getElementById("panel-info").style.display = "block";
  document.getElementById("info-id").textContent = "#" + localId;
  if (el) {
    const est = el._est || "Sin estado";
    const hoy = new Date();
    const atrasado = (() => {
      if (est === "Terminado" || est === "Inspeccionado") return false;
      const f = parseF(el.fecha_fin_plan); return f && f < hoy;
    })();
    const BADGE = {
      "Terminado": { bg: "#052E16", c: "#22C55E" }, "Inspeccionado": { bg: "#082F49", c: "#38BDF8" },
      "En proceso": { bg: "#1C1208", c: "#FB923C" }, "No iniciado": { bg: "#18181B", c: "#52525B" },
      "Sin estado": { bg: "#18181B", c: "#52525B" },
    };
    const b = atrasado ? { bg: "#2D0A0A", c: "#EF4444" } : (BADGE[est] || BADGE["Sin estado"]);
    const txt = atrasado ? "ATRASADO ⚠" : est.toUpperCase();
    document.getElementById("info-estado-badge").innerHTML =
      `<span class="info-estado" style="background:${b.bg};color:${b.c};border-color:${b.c}">
        <span class="info-dot" style="background:${b.c}"></span>${txt}</span>`;
    document.getElementById("info-cat").textContent = el.categoria || "—";
    document.getElementById("info-nivel").textContent = el.nivel || "—";
    document.getElementById("info-resp").textContent = el.responsable || "Sin asignar";
    document.getElementById("info-frente").textContent = el.frente_trabajo || "Sin frente";
    document.getElementById("info-pct").textContent = (el.porcentaje_avance || "0") + "%";
    document.getElementById("info-fechas").textContent = (el.fecha_fin_plan || "—") + " / " + (el.fecha_fin_real || "—");
    if (el.observaciones) {
      document.getElementById("info-obs-row").style.display = "flex";
      document.getElementById("info-obs").textContent = el.observaciones;
    } else { document.getElementById("info-obs-row").style.display = "none"; }
  } else {
    document.getElementById("info-estado-badge").innerHTML =
      `<span class="info-estado" style="background:#18181B;color:#52525B;border-color:#52525B">SIN DATOS</span>`;
    ["info-cat", "info-nivel", "info-resp", "info-frente", "info-pct", "info-fechas"]
      .forEach(id => document.getElementById(id).textContent = "—");
    document.getElementById("info-obs-row").style.display = "none";
  }
}
window.cerrarInfo = () => { document.getElementById("panel-info").style.display = "none"; };

async function exportarFrag() {
  if (!STATE.model) { toast("Carga primero un IFC"); return; }
  try {
    mostrarLoading("Exportando .frag...");
    const buffer = await STATE.model.getBuffer(false);
    const nombre = (STATE.jsonData?.proyecto || "modelo").replace(/[^\w\-]/g, "_");
    const file = new File([buffer], nombre + ".frag");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name; link.click();
    URL.revokeObjectURL(link.href);
    ocultarLoading(); toast("Guardado " + file.name);
  } catch (err) { ocultarLoading(); toast("Error: " + err.message); }
}

function normEst(raw) {
  if (!raw) return "Sin estado";
  const n = raw.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (n === "terminado" || n === "terminada") return "Terminado";
  if (n === "inspeccionado" || n === "aprobado") return "Inspeccionado";
  if (n === "en proceso" || n === "en construccion" || n === "activo") return "En proceso";
  if (n === "no iniciado" || n === "pendiente" || n === "sin iniciar") return "No iniciado";
  return raw.trim();
}
function parseF(s) {
  if (!s) return null;
  const m = s.toString().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function actualizarStats() {
  if (!STATE.jsonData) return;
  const el = STATE.jsonData.elementos, total = el.length;
  const term = el.filter(e => e._est === "Terminado" || e._est === "Inspeccionado").length;
  const proc = el.filter(e => e._est === "En proceso").length;
  const late = el.filter(e => { if (e._est === "Terminado" || e._est === "Inspeccionado") return false; const f = parseF(e.fecha_fin_plan); return f && f < HOY; }).length;
  document.getElementById("st-total").textContent = total.toLocaleString("es-CO");
  document.getElementById("st-pct").textContent = Math.round(term / total * 100) + "%";
  document.getElementById("st-proc").textContent = proc;
  document.getElementById("st-late").textContent = late;
}
function actualizarBtnColorear() {
  document.getElementById("btn-colorear").disabled = !(STATE.model && STATE.jsonData);
  const b = document.getElementById("btn-export-frag"); if (b) b.disabled = !STATE.model;
  const r = document.getElementById("btn-reset"); if (r) r.disabled = !STATE.coloreado;
}
function mostrarLoading(txt) {
  document.getElementById("loading-txt").textContent = txt || "Cargando...";
  document.getElementById("loading").classList.add("on");
}
function ocultarLoading() { document.getElementById("loading").classList.remove("on"); }
function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("on"), 3500);
}
window.dzOver = (e, id) => { e.preventDefault(); document.getElementById(id).classList.add("drag"); };
window.dzOut = (id) => { document.getElementById(id).classList.remove("drag"); };
window.dzDrop = (e, tipo) => {
  e.preventDefault();
  const id = tipo === "ifc" ? "dz-ifc" : "dz-json";
  document.getElementById(id).classList.remove("drag");
  const file = e.dataTransfer.files[0]; if (!file) return;
  if (tipo === "ifc") window.cargarIFC(file);
  if (tipo === "json") window.cargarJSON(file);
};

// Iniciar visor
initVisor().catch(console.error);