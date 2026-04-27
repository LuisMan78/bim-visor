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
  "Terminado":     new THREE.Color(0x22C55E),
  "Inspeccionado": new THREE.Color(0x38BDF8),
  "En proceso":    new THREE.Color(0xFB923C),
  "No iniciado":   new THREE.Color(0x52525B),
  "Sin estado":    new THREE.Color(0x3F3F46),
  "atrasado":      new THREE.Color(0xEF4444),
};

async function initVisor() {
  const container = document.getElementById("visor-container");
  STATE.components = new OBC.Components();
  const worlds = STATE.components.get(OBC.Worlds);
  STATE.world = worlds.create();
  STATE.world.scene    = new OBC.SimpleScene(STATE.components);
  STATE.world.renderer = new OBCF.PostproductionRenderer(STATE.components, container);
  STATE.world.camera   = new OBC.OrthoPerspectiveCamera(STATE.components);
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
  const raycaster  = raycasters.get(STATE.world);
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
      center.x+d, center.y+d*0.6, center.z+d,
      center.x, center.y, center.z, true
    );
  } catch(e) {}
}

window.cargarIFC = async function(file) {
  if (!file) return;
  mostrarLoading("Convirtiendo IFC...");
  if (STATE.model) {
    STATE.world.scene.three.remove(STATE.model.object);
    STATE.model = null; STATE.coloreado = false;
  }
  try {
    const buffer = await file.arrayBuffer();
    const data   = new Uint8Array(buffer);
    await STATE.ifcLoader.load(data, true, file.name.replace(".ifc",""), {
      processData: {
        progressCallback: (p) => {
          document.getElementById("loading-txt").textContent =
            "Procesando... " + Math.round(p*100) + "%";
        },
      },
    });
    document.getElementById("dz-ifc").classList.add("loaded");
    document.getElementById("dz-ifc-txt").textContent = file.name;
  } catch(err) {
    ocultarLoading();
    toast("Error IFC: " + err.message);
  }
};

window.cargarJSON = function(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      STATE.jsonData = data.elementos ? data : { proyecto:"Proyecto", elementos:[] };
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
        document.getElementById("tb-project").textContent = STATE.jsonData.proyecto||"Proyecto";
    } catch(err) { toast("JSON inválido"); }
  };
  reader.readAsText(file);
};

window.colorearModelo = async function() {
  if (!STATE.model || !STATE.jsonData) return;
  mostrarLoading("Coloreando modelo...");
  try {
    await aplicarColores();
    STATE.coloreado = true;
    const btnReset = document.getElementById("btn-reset");
    if (btnReset) btnReset.disabled = false;
    ocultarLoading();
  } catch(err) {
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
    "Terminado":[],"Inspeccionado":[],"En proceso":[],
    "No iniciado":[],"Sin estado":[],"atrasado":[],
  };

  for (const el of STATE.jsonData.elementos) {
    if (!el.ifc_guid || guidToLocalId[el.ifc_guid] === undefined) continue;
    const lid = guidToLocalId[el.ifc_guid];
    STATE.localIdToEl[lid] = el;
    const est = el._est;
    const atrasado = (() => {
      if (est==="Terminado"||est==="Inspeccionado") return false;
      const f = parseF(el.fecha_fin_plan); return f && f < hoy;
    })();
    const g = atrasado ? "atrasado" : (grupos[est]!==undefined ? est : "Sin estado");
    grupos[g].push(lid);
  }

  const mapeados = Object.keys(guidToLocalId).length;
  document.getElementById("loading-txt").textContent = "Aplicando colores a " + mapeados + " elementos...";

  try { await STATE.highlighter.clear(); } catch(e) {}

  const modelId = STATE.model.modelId;
  for (const [estado, ids] of Object.entries(grupos)) {
    if (!ids.length) continue;
    try {
      await STATE.highlighter.highlightByID(estado, { [modelId]: new Set(ids) }, false, false);
    } catch(e) { console.warn(estado, e.message); }
  }

  await STATE.fragments.core.update(true);
  toast(mapeados + " elementos coloreados");
}

window.resetColores = async function() {
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
  } catch(err) { ocultarLoading(); toast("Error: " + err.message); }
};

window.filtrarEstado = async function(estado, btn) {
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
        if (!el.ifc_guid || gmap[el.ifc_guid]===undefined) continue;
        const lid = gmap[el.ifc_guid];
        todos.push(lid);
        const est = el._est;
        const atrasado = (() => {
          if (est==="Terminado"||est==="Inspeccionado") return false;
          const f=parseF(el.fecha_fin_plan); return f&&f<hoy;
        })();
        const estNorm = (est||"").trim();
        const estadoNorm = (estado||"").trim();
        if ((estadoNorm==="atrasado"&&atrasado)||(estadoNorm!=="atrasado"&&estNorm===estadoNorm&&!atrasado))
          vis.push(lid);
      }
      await STATE.model.threads.invoke(STATE.model.modelId, "setVisible", [new Int32Array(todos), false]);
      if (vis.length) await STATE.model.threads.invoke(STATE.model.modelId, "setVisible", [new Int32Array(vis), true]);
    }
    await STATE.fragments.core.update(true);
    ocultarLoading();
    toast("Filtro: " + estado);
  } catch(err) { ocultarLoading(); console.error(err); toast("Error filtro: " + err.message); }
};

function mostrarInfoElemento(localId) {
  const el = STATE.localIdToEl[localId];
  document.getElementById("panel-info").style.display = "block";
  document.getElementById("info-id").textContent = "#" + localId;
  if (el) {
    const est = el._est||"Sin estado";
    const hoy = new Date();
    const atrasado = (() => {
      if (est==="Terminado"||est==="Inspeccionado") return false;
      const f=parseF(el.fecha_fin_plan); return f&&f<hoy;
    })();
    const BADGE = {
      "Terminado":{bg:"#052E16",c:"#22C55E"},"Inspeccionado":{bg:"#082F49",c:"#38BDF8"},
      "En proceso":{bg:"#1C1208",c:"#FB923C"},"No iniciado":{bg:"#18181B",c:"#52525B"},
      "Sin estado":{bg:"#18181B",c:"#52525B"},
    };
    const b = atrasado?{bg:"#2D0A0A",c:"#EF4444"}:(BADGE[est]||BADGE["Sin estado"]);
    const txt = atrasado?"ATRASADO ⚠":est.toUpperCase();
    document.getElementById("info-estado-badge").innerHTML =
      `<span class="info-estado" style="background:${b.bg};color:${b.c};border-color:${b.c}">
        <span class="info-dot" style="background:${b.c}"></span>${txt}</span>`;
    document.getElementById("info-cat").textContent    = el.categoria||"—";
    document.getElementById("info-nivel").textContent  = el.nivel||"—";
    document.getElementById("info-resp").textContent   = el.responsable||"Sin asignar";
    document.getElementById("info-frente").textContent = el.frente_trabajo||"Sin frente";
    document.getElementById("info-pct").textContent    = (el.porcentaje_avance||"0")+"%";
    document.getElementById("info-fechas").textContent = (el.fecha_fin_plan||"—")+" / "+(el.fecha_fin_real||"—");
    if (el.observaciones) {
      document.getElementById("info-obs-row").style.display = "flex";
      document.getElementById("info-obs").textContent = el.observaciones;
    } else { document.getElementById("info-obs-row").style.display = "none"; }
  } else {
    document.getElementById("info-estado-badge").innerHTML =
      `<span class="info-estado" style="background:#18181B;color:#52525B;border-color:#52525B">SIN DATOS</span>`;
    ["info-cat","info-nivel","info-resp","info-frente","info-pct","info-fechas"]
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
    const nombre = (STATE.jsonData?.proyecto||"modelo").replace(/[^\w\-]/g,"_");
    const file = new File([buffer], nombre+".frag");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name; link.click();
    URL.revokeObjectURL(link.href);
    ocultarLoading(); toast("Guardado "+file.name);
  } catch(err) { ocultarLoading(); toast("Error: "+err.message); }
}

function normEst(raw) {
  if (!raw) return "Sin estado";
  const n = raw.toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if (n==="terminado"||n==="terminada") return "Terminado";
  if (n==="inspeccionado"||n==="aprobado") return "Inspeccionado";
  if (n==="en proceso"||n==="en construccion"||n==="activo") return "En proceso";
  if (n==="no iniciado"||n==="pendiente"||n==="sin iniciar") return "No iniciado";
  return raw.trim();
}
function parseF(s) {
  if (!s) return null;
  const m = s.toString().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1],+m[2]-1,+m[3]) : null;
}
function actualizarStats() {
  if (!STATE.jsonData) return;
  const el=STATE.jsonData.elementos, total=el.length;
  const term=el.filter(e=>e._est==="Terminado"||e._est==="Inspeccionado").length;
  const proc=el.filter(e=>e._est==="En proceso").length;
  const late=el.filter(e=>{ if(e._est==="Terminado"||e._est==="Inspeccionado")return false; const f=parseF(e.fecha_fin_plan);return f&&f<HOY; }).length;
  document.getElementById("st-total").textContent=total.toLocaleString("es-CO");
  document.getElementById("st-pct").textContent=Math.round(term/total*100)+"%";
  document.getElementById("st-proc").textContent=proc;
  document.getElementById("st-late").textContent=late;
}
function actualizarBtnColorear() {
  document.getElementById("btn-colorear").disabled=!(STATE.model&&STATE.jsonData);
  const b=document.getElementById("btn-export-frag"); if(b) b.disabled=!STATE.model;
  const r=document.getElementById("btn-reset"); if(r) r.disabled=!STATE.coloreado;
}
function mostrarLoading(txt) {
  document.getElementById("loading-txt").textContent=txt||"Cargando...";
  document.getElementById("loading").classList.add("on");
}
function ocultarLoading() { document.getElementById("loading").classList.remove("on"); }
function toast(msg) {
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on");
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove("on"),3500);
}
window.dzOver=(e,id)=>{ e.preventDefault(); document.getElementById(id).classList.add("drag"); };
window.dzOut=(id)=>{ document.getElementById(id).classList.remove("drag"); };
window.dzDrop=(e,tipo)=>{
  e.preventDefault();
  const id=tipo==="ifc"?"dz-ifc":"dz-json";
  document.getElementById(id).classList.remove("drag");
  const file=e.dataTransfer.files[0]; if(!file) return;
  if(tipo==="ifc") window.cargarIFC(file);
  if(tipo==="json") window.cargarJSON(file);
};



// ══════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════
const VSTATE = {
  components: null, world: null, fragments: null,
  ifcLoader: null, highlighter: null, model: null,
  jsonData: null,
  elementMap: {},    // element_id → elemento JSON
  ifcGuidMap: {},    // ifc_guid   → elemento JSON
  guidToLocalId: {}, // ifc_guid   → localId
  localIdToEl: {},   // localId    → elemento JSON
  // Vaciados
  vaciados: [],      // lista de vaciados registrados
  seleccionados: [], // elementos seleccionados para nuevo vaciado [{localId, guid, cat, nivel}]
  elementoActivo: null, // elemento clickeado en el visor
};

window.VSTATE = VSTATE;

// Colores para vaciados
const COL_VACIADO = {
  aprobado:  new THREE.Color(0x22C55E),
  pendiente: new THREE.Color(0xFB923C),
  reprobado: new THREE.Color(0xEF4444),
  sinVaciar: new THREE.Color(0x3F3F46),
};

// ══════════════════════════════════════════════════════
// INICIALIZAR VISOR
// ══════════════════════════════════════════════════════
async function initVaciados() {
  const container = document.getElementById("V-visor-container");
  VSTATE.components = new OBC.Components();
  const worlds = VSTATE.components.get(OBC.Worlds);
  VSTATE.world = worlds.create();
  VSTATE.world.scene    = new OBC.SimpleScene(VSTATE.components);
  VSTATE.world.renderer = new OBCF.PostproductionRenderer(VSTATE.components, container);
  VSTATE.world.camera   = new OBC.OrthoPerspectiveCamera(VSTATE.components);
  VSTATE.components.init();
  VSTATE.world.scene.setup();
  VSTATE.world.scene.three.background = new THREE.Color(0x0A0A0B);

  const grids = VSTATE.components.get(OBC.Grids);
  grids.create(VSTATE.world);

  const workerUrl = await OBC.FragmentsManager.getWorker();
  VSTATE.fragments = VSTATE.components.get(OBC.FragmentsManager);
  VSTATE.fragments.init(workerUrl);

  let updateTimeout = null;
  VSTATE.world.camera.controls.addEventListener("update", () => {
    VSTATE.fragments.core.update();
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => VSTATE.fragments.core.update(true), 100);
  });

  VSTATE.fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
  });

  // Highlighter
  VSTATE.highlighter = VSTATE.components.get(OBCF.Highlighter);
  VSTATE.highlighter.setup({ world: VSTATE.world });
  VSTATE.highlighter.zoomToSelection = false;
  VSTATE.highlighter.styles.set("aprobado",  { color: COL_VACIADO.aprobado,  opacity: 1 });
  VSTATE.highlighter.styles.set("pendiente", { color: COL_VACIADO.pendiente, opacity: 1 });
  VSTATE.highlighter.styles.set("reprobado", { color: COL_VACIADO.reprobado, opacity: 1 });
  VSTATE.highlighter.styles.set("sinVaciar", { color: COL_VACIADO.sinVaciar, opacity: 1 });
  VSTATE.highlighter.styles.set("seleccion", { color: new THREE.Color(0x38BDF8), opacity: 1 });

  VSTATE.fragments.list.onItemSet.add(({ value: model }) => {
    VSTATE.model = model;
    model.useCamera(VSTATE.world.camera.three);
    VSTATE.world.scene.three.add(model.object);
    VSTATE.fragments.core.update(true);
    V_ocultarLoading();
    V_toast("✓ Modelo IFC cargado");
    V_ajustarCamara();
  });

  VSTATE.ifcLoader = VSTATE.components.get(OBC.IfcLoader);
  await VSTATE.ifcLoader.setup({
    autoSetWasm: false,
    wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
  });

  // Click en elemento
  const raycasters = VSTATE.components.get(OBC.Raycasters);
  const raycaster  = raycasters.get(VSTATE.world);
  container.addEventListener("click", async (e) => {
    if (e.target.closest("#info-panel")) return;
    const result = await raycaster.castRay();
    if (result && result.localId !== undefined) {
      await manejarClickElemento(result.localId);
    } else {
      cerrarInfo();
    }
  });

  V_toast("⚡ Visor listo");
}

// ══════════════════════════════════════════════════════
// CLICK EN ELEMENTO
// ══════════════════════════════════════════════════════
async function manejarClickElemento(localId) {
  VSTATE.elementoActivo = localId;
  const el = VSTATE.localIdToEl[localId];

  // Mostrar panel info
  const panel = document.getElementById("info-panel");
  panel.style.display = "block";
  document.getElementById("V-info-id").textContent = "#" + localId;
  document.getElementById("V-info-cat").textContent    = el?.categoria || "—";
  document.getElementById("V-info-nivel").textContent  = el?.nivel || "—";
  document.getElementById("info-estado").textContent = el?._est || "Sin estado";

  // Buscar si tiene vaciado
  const vaciado = VSTATE.vaciados.find(v => v.elementos.includes(localId));
  if (vaciado) {
    document.getElementById("info-vaciado-row").style.display = "block";
    document.getElementById("info-vaciado").textContent = vaciado.id + " · " + vaciado.fecha;
    document.getElementById("info-cil-row").style.display = "block";
    document.getElementById("info-cil").textContent =
      vaciado.cil28 ? vaciado.cil28 + " MPa — " + vaciado.estado : "Pendiente";
  } else {
    document.getElementById("info-vaciado-row").style.display = "none";
    document.getElementById("info-cil-row").style.display = "none";
  }
}

window.cerrarInfo = function() {
  document.getElementById("info-panel").style.display = "none";
  VSTATE.elementoActivo = null;
};

// Agregar elemento activo al formulario de vaciado
window.usarElementoEnFormulario = function() {
  if (!VSTATE.elementoActivo) return;
  const localId = VSTATE.elementoActivo;
  const el = VSTATE.localIdToEl[localId];

  // Evitar duplicados
  if (VSTATE.seleccionados.find(s => s.localId === localId)) {
    V_toast("Este elemento ya está en la selección");
    return;
  }

  VSTATE.seleccionados.push({
    localId,
    cat: el?.categoria || "Elemento",
    nivel: el?.nivel || "—",
  });

  actualizarListaSeleccionados();
  switchTab("registrar");
  V_toast("✓ Elemento agregado al vaciado");
};

// ══════════════════════════════════════════════════════
// SELECCIÓN DE ELEMENTOS
// ══════════════════════════════════════════════════════
function actualizarListaSeleccionados() {
  const lista = document.getElementById("elementos-sel-list");
  const emptyMsg = document.getElementById("elem-empty-msg");

  if (VSTATE.seleccionados.length === 0) {
    lista.innerHTML = '<div class="elem-sel-empty" id="elem-empty-msg">Haz click en elementos del modelo 3D</div>';
    return;
  }

  lista.innerHTML = VSTATE.seleccionados.map((s, i) => `
    <div class="elem-sel-item">
      <span class="elem-sel-name">#${s.localId} · ${s.cat} · ${s.nivel}</span>
      <span class="elem-sel-rm" onclick="quitarSeleccionado(${i})">✕</span>
    </div>
  `).join('');
}

window.quitarSeleccionado = function(i) {
  VSTATE.seleccionados.splice(i, 1);
  actualizarListaSeleccionados();
};

window.limpiarSeleccion = function() {
  VSTATE.seleccionados = [];
  actualizarListaSeleccionados();
};

// ══════════════════════════════════════════════════════
// REGISTRAR VACIADO
// ══════════════════════════════════════════════════════
window.registrarVaciado = function() {
  const id          = document.getElementById("f-id").value.trim();
  const fecha       = document.getElementById("f-fecha").value;
  const proveedor   = document.getElementById("f-proveedor").value.trim();
  const remision    = document.getElementById("f-remision").value.trim();
  const fc          = parseFloat(document.getElementById("f-fc").value);
  const slump       = document.getElementById("f-slump").value;
  const volumen     = document.getElementById("f-volumen").value;
  const responsable = document.getElementById("f-responsable").value.trim();
  const cil7        = document.getElementById("f-cil7").value ? parseFloat(document.getElementById("f-cil7").value) : null;
  const cil28       = document.getElementById("f-cil28").value ? parseFloat(document.getElementById("f-cil28").value) : null;

  if (!id)        { V_toast("⚠ Ingresa el ID de la colada"); return; }
  if (!fecha)     { V_toast("⚠ Ingresa la fecha del vaciado"); return; }
  if (!proveedor) { V_toast("⚠ Ingresa el proveedor"); return; }
  if (VSTATE.seleccionados.length === 0) { V_toast("⚠ Selecciona al menos un elemento del modelo"); return; }

  // Verificar ID único
  if (VSTATE.vaciados.find(v => v.id === id)) {
    V_toast("⚠ Ya existe un vaciado con el ID " + id);
    return;
  }

  // Calcular estado según NSR-10
  let estado = "pendiente";
  if (cil28 !== null) {
    // Criterio NSR-10 C.5.6: ningún resultado < F'c - 3.5 MPa
    if (cil28 >= fc && cil28 >= (fc - 3.5)) {
      estado = "aprobado";
    } else {
      estado = "reprobado";
    }
  }

  const vaciado = {
    id, fecha, proveedor, remision,
    fc, slump, volumen, responsable,
    cil7, cil28, estado,
    elementos: VSTATE.seleccionados.map(s => s.localId),
    elementosInfo: [...VSTATE.seleccionados],
    fechaRegistro: new Date().toISOString(),
  };

  VSTATE.vaciados.push(vaciado);

  // Limpiar formulario
  ["f-id","f-fecha","f-proveedor","f-remision","f-slump","f-volumen","f-responsable","f-cil7","f-cil28"]
    .forEach(id => document.getElementById(id).value = "");
  VSTATE.seleccionados = [];
  actualizarListaSeleccionados();

  actualizarStats();
  actualizarListaVaciados();
  actualizarAlertas();
  colorearPorVaciados();

  V_toast("✓ Vaciado " + id + " registrado — " + vaciado.elementos.length + " elementos");
  switchTab("vaciados");
};

// ══════════════════════════════════════════════════════
// COLOREAR MODELO POR ESTADO DE VACIADO
// ══════════════════════════════════════════════════════
window.colorearPorVaciados = async function() {
  if (!VSTATE.model || !VSTATE.highlighter) return;
  V_mostrarLoading("Aplicando colores de vaciado...");

  try {
    await VSTATE.highlighter.clear();
    const modelId = VSTATE.model.modelId;

    // Agrupar localIds por estado de vaciado
    const grupos = { aprobado: [], pendiente: [], reprobado: [], sinVaciar: [] };

    // Marcar todos los elementos con vaciado
    const conVaciado = new Set();
    for (const v of VSTATE.vaciados) {
      for (const lid of v.elementos) {
        conVaciado.add(lid);
        grupos[v.estado].push(lid);
      }
    }

    // Los demás → sinVaciar
    for (const lid of Object.keys(VSTATE.localIdToEl)) {
      if (!conVaciado.has(parseInt(lid))) {
        grupos.sinVaciar.push(parseInt(lid));
      }
    }

    // Aplicar colores
    for (const [estado, ids] of Object.entries(grupos)) {
      if (!ids.length) continue;
      await VSTATE.highlighter.highlightByID(estado, { [modelId]: new Set(ids) }, false, false);
    }

    await VSTATE.fragments.core.update(true);
    V_ocultarLoading();
    V_toast("✓ Modelo coloreado por estado de vaciado");
  } catch(err) {
    V_ocultarLoading();
    V_toast("Error: " + err.message);
    console.error(err);
  }
};

// ══════════════════════════════════════════════════════
// ACTUALIZAR UI
// ══════════════════════════════════════════════════════
function V_V_actualizarStats() {
  const total      = VSTATE.vaciados.length;
  const aprobados  = VSTATE.vaciados.filter(v => v.estado === "aprobado").length;
  const pendientes = VSTATE.vaciados.filter(v => v.estado === "pendiente").length;
  const reprobados = VSTATE.vaciados.filter(v => v.estado === "reprobado").length;
  document.getElementById("V-st-total").textContent      = total;
  document.getElementById("st-aprobados").textContent  = aprobados;
  document.getElementById("st-pendientes").textContent = pendientes;
  document.getElementById("st-reprobados").textContent = reprobados;
}

function actualizarListaVaciados() {
  const lista = document.getElementById("lista-vaciados");
  if (!VSTATE.vaciados.length) {
    lista.innerHTML = '<div class="elem-sel-empty">No hay vaciados registrados aún</div>';
    return;
  }
  lista.innerHTML = VSTATE.vaciados.slice().reverse().map(v => `
    <div class="vaciado-item" onclick="verVaciado('${v.id}')">
      <div class="vaciado-id">${v.id}</div>
      <div class="vaciado-info">${v.fecha} · ${v.proveedor}</div>
      <div class="vaciado-info">${v.elementos.length} elementos · F'c ${v.fc} MPa</div>
      <div class="vaciado-estado est-${v.estado}">${v.estado.toUpperCase()}</div>
    </div>
  `).join('');
}

function actualizarAlertas() {
  const lista = document.getElementById("lista-alertas");
  const alertas = [];

  for (const v of VSTATE.vaciados) {
    // Alerta: pendiente de resultado a 28 días
    if (v.estado === "pendiente") {
      const fechaVac = new Date(v.fecha);
      const hoy = new Date();
      const diasTranscurridos = Math.floor((hoy - fechaVac) / (1000 * 60 * 60 * 24));
      if (diasTranscurridos >= 25) {
        alertas.push({
          tipo: "warn",
          titulo: `${v.id} — Resultado 28 días próximo`,
          body: `Vaciado del ${v.fecha}. Han transcurrido ${diasTranscurridos} días. Solicitar resultado al laboratorio.`
        });
      }
    }
    // Alerta: reprobado
    if (v.estado === "reprobado") {
      alertas.push({
        tipo: "err",
        titulo: `${v.id} — CILINDROS REPROBADOS ⚠`,
        body: `F'c especificado: ${v.fc} MPa · Resultado 28 días: ${v.cil28} MPa · ${v.elementos.length} elementos afectados. Notificar a interventoría.`
      });
    }
  }

  if (!alertas.length) {
    lista.innerHTML = '<div class="elem-sel-empty">Sin alertas activas</div>';
    return;
  }

  lista.innerHTML = alertas.map(a => `
    <div class="alerta-box alerta-${a.tipo}">
      <div class="alerta-title">${a.titulo}</div>
      <div class="alerta-body">${a.body}</div>
    </div>
  `).join('');
}

window.verVaciado = function(id) {
  const v = VSTATE.vaciados.find(v => v.id === id);
  if (!v) return;
  V_toast(`${v.id} · ${v.elementos.length} elementos · Estado: ${v.estado}`);
};

// ══════════════════════════════════════════════════════
// EXPORTAR JSON
// ══════════════════════════════════════════════════════
window.exportarVaciadosJSON = function() {
  if (!VSTATE.vaciados.length) { V_toast("No hay vaciados para exportar"); return; }
  const data = {
    proyecto: VSTATE.jsonData?.proyecto || "Proyecto",
    fecha_export: new Date().toISOString().split("T")[0],
    version: "LF BIM Studio — Control de Vaciados v1.0",
    vaciados: VSTATE.vaciados,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ControlVaciados_${data.fecha_export}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  V_toast("✓ Exportado ControlVaciados_" + data.fecha_export + ".json");
};

// ══════════════════════════════════════════════════════
// CARGA DE ARCHIVOS
// ══════════════════════════════════════════════════════
window.cargarIFC = async function(file) {
  if (!file) return;
  V_mostrarLoading("Cargando modelo IFC...");
  try {
    const buffer = await file.arrayBuffer();
    await VSTATE.ifcLoader.load(new Uint8Array(buffer), true, file.name.replace(".ifc",""), {
      processData: { progressCallback: (p) => {
        document.getElementById("load-txt").textContent = "Procesando... " + Math.round(p*100) + "%";
      }},
    });
    document.getElementById("V-dz-ifc").classList.add("loaded");
    document.getElementById("V-dz-ifc-txt").textContent = "✓ " + file.name;
  } catch(err) {
    V_ocultarLoading();
    V_toast("Error IFC: " + err.message);
  }
};

window.cargarJSON = function(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      VSTATE.jsonData = data.elementos ? data : { proyecto:"Proyecto", elementos: [] };
      VSTATE.elementMap = {};
      VSTATE.ifcGuidMap = {};
      VSTATE.jsonData.elementos.forEach(el => {
        el._est = V_normEst(el.estado_ejecucion || "");
        VSTATE.elementMap[el.element_id] = el;
        if (el.ifc_guid) VSTATE.ifcGuidMap[el.ifc_guid] = el;
      });

      // Mapear GUIDs a localIds si el modelo ya está cargado
      if (VSTATE.model) await mapearGuids();

      document.getElementById("V-dz-json").classList.add("loaded");
      document.getElementById("V-dz-json-txt").textContent = "✓ " + (VSTATE.jsonData.proyecto || file.name);
      V_toast("✓ JSON cargado — " + VSTATE.jsonData.elementos.length + " elementos");
    } catch(err) { V_toast("JSON inválido"); }
  };
  r.readAsText(file);
};

async function mapearGuids() {
  if (!VSTATE.model || !VSTATE.jsonData) return;
  const allGuids = VSTATE.jsonData.elementos.filter(el => el.ifc_guid).map(el => el.ifc_guid);
  if (!allGuids.length) return;
  const localIdsList = await VSTATE.model.getLocalIdsByGuids(allGuids);
  allGuids.forEach((guid, i) => {
    if (localIdsList[i] !== null && localIdsList[i] !== undefined) {
      VSTATE.guidToLocalId[guid] = localIdsList[i];
      VSTATE.localIdToEl[localIdsList[i]] = VSTATE.ifcGuidMap[guid];
    }
  });
}

// ══════════════════════════════════════════════════════
// BADGE RESULTADO EN TIEMPO REAL
// ══════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("f-cil28").addEventListener("input", () => {
    const cil28 = parseFloat(document.getElementById("f-cil28").value);
    const fc    = parseFloat(document.getElementById("f-fc").value);
    const badge = document.getElementById("badge-estado");
    if (isNaN(cil28)) {
      badge.style.background = "#18181B";
      badge.style.color = "#52525B";
      badge.style.border = "1px solid #27272A";
      badge.textContent = "—";
    } else if (cil28 >= fc && cil28 >= (fc - 3.5)) {
      badge.style.background = "#052E16";
      badge.style.color = "#22C55E";
      badge.style.border = "1px solid #22C55E";
      badge.textContent = "OK";
    } else {
      badge.style.background = "#2D0A0A";
      badge.style.color = "#EF4444";
      badge.style.border = "1px solid #EF4444";
      badge.textContent = "FALLA";
    }
  });

  // Fecha por defecto: hoy
  document.getElementById("f-fecha").value = new Date().toISOString().split("T")[0];
});

// ══════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════
window.switchTab = function(tab) {
  ["registrar","vaciados","alertas"].forEach(t => {
    document.getElementById("tab-" + t).classList.toggle("active", t === tab);
    document.getElementById("pane-" + t).style.display = t === tab ? "block" : "none";
  });
};

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
async function V_V_ajustarCamara() {
  try {
    const box = new THREE.Box3();
    VSTATE.world.scene.three.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry?.computeBoundingBox();
        if (obj.geometry?.boundingBox)
          box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
      }
    });
    if (box.isEmpty()) return;
    const center = new THREE.Vector3(); box.getCenter(center);
    const size   = new THREE.Vector3(); box.getSize(size);
    const d = Math.max(size.x, size.y, size.z);
    await VSTATE.world.camera.controls.setLookAt(
      center.x+d, center.y+d*0.6, center.z+d,
      center.x, center.y, center.z, true
    );
  } catch(e) {}
}

function V_V_normEst(raw) {
  if (!raw) return "Sin estado";
  const n = raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if (n==="terminado") return "Terminado";
  if (n==="inspeccionado") return "Inspeccionado";
  if (n==="en proceso") return "En proceso";
  if (n==="no iniciado") return "No iniciado";
  return raw.trim();
}

function V_V_mostrarLoading(txt) {
  document.getElementById("load-txt").textContent = txt || "Cargando...";
  document.getElementById("V-loading").classList.add("on");
}
function V_V_ocultarLoading() {
  document.getElementById("V-loading").classList.remove("on");
}
function V_V_toast(msg) {
  const t = document.getElementById("V-toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("on"), 3500);
}

window.dzOver = (e, id) => { e.preventDefault(); document.getElementById(id).classList.add("drag"); };
window.dzOut  = (id)    => { document.getElementById(id).classList.remove("drag"); };
window.dzDrop = (e, tipo) => {
  e.preventDefault();
  const id = tipo === "ifc" ? "dz-ifc" : "dz-json";
  document.getElementById(id).classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (tipo === "ifc")  window.cargarIFC(file);
  if (tipo === "json") window.cargarJSON(file);
};

// ══════════════════════════════════════════════════════
// INICIAR
// ══════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════
// ROUTER — detectar módulo según URL
// ══════════════════════════════════════════════════════
if (window.location.pathname.includes('vaciados')) {
  // Mostrar módulo vaciados, ocultar visor
  const mv = document.getElementById('modulo-vaciados');
  const vv = document.getElementById('modulo-visor');
  if (mv) mv.style.display = 'block';
  if (vv) vv.style.display = 'none';
  initVaciados().catch(console.error);
} else {
  // Mostrar visor, ocultar vaciados
  const mv = document.getElementById('modulo-vaciados');
  const vv = document.getElementById('modulo-visor');
  if (vv) vv.style.display = 'block';
  if (mv) mv.style.display = 'none';
  initVisor().catch(console.error);
}
