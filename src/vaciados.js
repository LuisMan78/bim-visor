import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as THREE from "three";

// ══════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════
const STATE = {
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

window.STATE = STATE;

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

  // Highlighter
  STATE.highlighter = STATE.components.get(OBCF.Highlighter);
  STATE.highlighter.setup({ world: STATE.world });
  STATE.highlighter.zoomToSelection = false;
  STATE.highlighter.styles.set("aprobado",  { color: COL_VACIADO.aprobado,  opacity: 1 });
  STATE.highlighter.styles.set("pendiente", { color: COL_VACIADO.pendiente, opacity: 1 });
  STATE.highlighter.styles.set("reprobado", { color: COL_VACIADO.reprobado, opacity: 1 });
  STATE.highlighter.styles.set("sinVaciar", { color: COL_VACIADO.sinVaciar, opacity: 1 });
  STATE.highlighter.styles.set("seleccion", { color: new THREE.Color(0x38BDF8), opacity: 1 });

  STATE.fragments.list.onItemSet.add(({ value: model }) => {
    STATE.model = model;
    model.useCamera(STATE.world.camera.three);
    STATE.world.scene.three.add(model.object);
    STATE.fragments.core.update(true);
    ocultarLoading();
    toast("✓ Modelo IFC cargado");
    ajustarCamara();
  });

  STATE.ifcLoader = STATE.components.get(OBC.IfcLoader);
  await STATE.ifcLoader.setup({
    autoSetWasm: false,
    wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
  });

  // Click en elemento
  const raycasters = STATE.components.get(OBC.Raycasters);
  const raycaster  = raycasters.get(STATE.world);
  container.addEventListener("click", async (e) => {
    if (e.target.closest("#info-panel")) return;
    const result = await raycaster.castRay();
    if (result && result.localId !== undefined) {
      await manejarClickElemento(result.localId);
    } else {
      cerrarInfo();
    }
  });

  toast("⚡ Visor listo");
}

// ══════════════════════════════════════════════════════
// CLICK EN ELEMENTO
// ══════════════════════════════════════════════════════
async function manejarClickElemento(localId) {
  STATE.elementoActivo = localId;
  const el = STATE.localIdToEl[localId];

  // Mostrar panel info
  const panel = document.getElementById("info-panel");
  panel.style.display = "block";
  document.getElementById("info-id").textContent = "#" + localId;
  document.getElementById("info-cat").textContent    = el?.categoria || "—";
  document.getElementById("info-nivel").textContent  = el?.nivel || "—";
  document.getElementById("info-estado").textContent = el?._est || "Sin estado";

  // Buscar si tiene vaciado
  const vaciado = STATE.vaciados.find(v => v.elementos.includes(localId));
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
  STATE.elementoActivo = null;
};

// Agregar elemento activo al formulario de vaciado
window.usarElementoEnFormulario = function() {
  if (!STATE.elementoActivo) return;
  const localId = STATE.elementoActivo;
  const el = STATE.localIdToEl[localId];

  // Evitar duplicados
  if (STATE.seleccionados.find(s => s.localId === localId)) {
    toast("Este elemento ya está en la selección");
    return;
  }

  STATE.seleccionados.push({
    localId,
    cat: el?.categoria || "Elemento",
    nivel: el?.nivel || "—",
  });

  actualizarListaSeleccionados();
  switchTab("registrar");
  toast("✓ Elemento agregado al vaciado");
};

// ══════════════════════════════════════════════════════
// SELECCIÓN DE ELEMENTOS
// ══════════════════════════════════════════════════════
function actualizarListaSeleccionados() {
  const lista = document.getElementById("elementos-sel-list");
  const emptyMsg = document.getElementById("elem-empty-msg");

  if (STATE.seleccionados.length === 0) {
    lista.innerHTML = '<div class="elem-sel-empty" id="elem-empty-msg">Haz click en elementos del modelo 3D</div>';
    return;
  }

  lista.innerHTML = STATE.seleccionados.map((s, i) => `
    <div class="elem-sel-item">
      <span class="elem-sel-name">#${s.localId} · ${s.cat} · ${s.nivel}</span>
      <span class="elem-sel-rm" onclick="quitarSeleccionado(${i})">✕</span>
    </div>
  `).join('');
}

window.quitarSeleccionado = function(i) {
  STATE.seleccionados.splice(i, 1);
  actualizarListaSeleccionados();
};

window.limpiarSeleccion = function() {
  STATE.seleccionados = [];
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

  if (!id)        { toast("⚠ Ingresa el ID de la colada"); return; }
  if (!fecha)     { toast("⚠ Ingresa la fecha del vaciado"); return; }
  if (!proveedor) { toast("⚠ Ingresa el proveedor"); return; }
  if (STATE.seleccionados.length === 0) { toast("⚠ Selecciona al menos un elemento del modelo"); return; }

  // Verificar ID único
  if (STATE.vaciados.find(v => v.id === id)) {
    toast("⚠ Ya existe un vaciado con el ID " + id);
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
    elementos: STATE.seleccionados.map(s => s.localId),
    elementosInfo: [...STATE.seleccionados],
    fechaRegistro: new Date().toISOString(),
  };

  STATE.vaciados.push(vaciado);

  // Limpiar formulario
  ["f-id","f-fecha","f-proveedor","f-remision","f-slump","f-volumen","f-responsable","f-cil7","f-cil28"]
    .forEach(id => document.getElementById(id).value = "");
  STATE.seleccionados = [];
  actualizarListaSeleccionados();

  actualizarStats();
  actualizarListaVaciados();
  actualizarAlertas();
  colorearPorVaciados();

  toast("✓ Vaciado " + id + " registrado — " + vaciado.elementos.length + " elementos");
  switchTab("vaciados");
};

// ══════════════════════════════════════════════════════
// COLOREAR MODELO POR ESTADO DE VACIADO
// ══════════════════════════════════════════════════════
window.colorearPorVaciados = async function() {
  if (!STATE.model || !STATE.highlighter) return;
  mostrarLoading("Aplicando colores de vaciado...");

  try {
    await STATE.highlighter.clear();
    const modelId = STATE.model.modelId;

    // Agrupar localIds por estado de vaciado
    const grupos = { aprobado: [], pendiente: [], reprobado: [], sinVaciar: [] };

    // Marcar todos los elementos con vaciado
    const conVaciado = new Set();
    for (const v of STATE.vaciados) {
      for (const lid of v.elementos) {
        conVaciado.add(lid);
        grupos[v.estado].push(lid);
      }
    }

    // Los demás → sinVaciar
    for (const lid of Object.keys(STATE.localIdToEl)) {
      if (!conVaciado.has(parseInt(lid))) {
        grupos.sinVaciar.push(parseInt(lid));
      }
    }

    // Aplicar colores
    for (const [estado, ids] of Object.entries(grupos)) {
      if (!ids.length) continue;
      await STATE.highlighter.highlightByID(estado, { [modelId]: new Set(ids) }, false, false);
    }

    await STATE.fragments.core.update(true);
    ocultarLoading();
    toast("✓ Modelo coloreado por estado de vaciado");
  } catch(err) {
    ocultarLoading();
    toast("Error: " + err.message);
    console.error(err);
  }
};

// ══════════════════════════════════════════════════════
// ACTUALIZAR UI
// ══════════════════════════════════════════════════════
function actualizarStats() {
  const total      = STATE.vaciados.length;
  const aprobados  = STATE.vaciados.filter(v => v.estado === "aprobado").length;
  const pendientes = STATE.vaciados.filter(v => v.estado === "pendiente").length;
  const reprobados = STATE.vaciados.filter(v => v.estado === "reprobado").length;
  document.getElementById("st-total").textContent      = total;
  document.getElementById("st-aprobados").textContent  = aprobados;
  document.getElementById("st-pendientes").textContent = pendientes;
  document.getElementById("st-reprobados").textContent = reprobados;
}

function actualizarListaVaciados() {
  const lista = document.getElementById("lista-vaciados");
  if (!STATE.vaciados.length) {
    lista.innerHTML = '<div class="elem-sel-empty">No hay vaciados registrados aún</div>';
    return;
  }
  lista.innerHTML = STATE.vaciados.slice().reverse().map(v => `
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

  for (const v of STATE.vaciados) {
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
  const v = STATE.vaciados.find(v => v.id === id);
  if (!v) return;
  toast(`${v.id} · ${v.elementos.length} elementos · Estado: ${v.estado}`);
};

// ══════════════════════════════════════════════════════
// EXPORTAR JSON
// ══════════════════════════════════════════════════════
window.exportarVaciadosJSON = function() {
  if (!STATE.vaciados.length) { toast("No hay vaciados para exportar"); return; }
  const data = {
    proyecto: STATE.jsonData?.proyecto || "Proyecto",
    fecha_export: new Date().toISOString().split("T")[0],
    version: "LF BIM Studio — Control de Vaciados v1.0",
    vaciados: STATE.vaciados,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ControlVaciados_${data.fecha_export}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("✓ Exportado ControlVaciados_" + data.fecha_export + ".json");
};

// ══════════════════════════════════════════════════════
// CARGA DE ARCHIVOS
// ══════════════════════════════════════════════════════
window.cargarIFC = async function(file) {
  if (!file) return;
  mostrarLoading("Cargando modelo IFC...");
  try {
    const buffer = await file.arrayBuffer();
    await STATE.ifcLoader.load(new Uint8Array(buffer), true, file.name.replace(".ifc",""), {
      processData: { progressCallback: (p) => {
        document.getElementById("load-txt").textContent = "Procesando... " + Math.round(p*100) + "%";
      }},
    });
    document.getElementById("dz-ifc").classList.add("loaded");
    document.getElementById("dz-ifc-txt").textContent = "✓ " + file.name;
  } catch(err) {
    ocultarLoading();
    toast("Error IFC: " + err.message);
  }
};

window.cargarJSON = function(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      STATE.jsonData = data.elementos ? data : { proyecto:"Proyecto", elementos: [] };
      STATE.elementMap = {};
      STATE.ifcGuidMap = {};
      STATE.jsonData.elementos.forEach(el => {
        el._est = normEst(el.estado_ejecucion || "");
        STATE.elementMap[el.element_id] = el;
        if (el.ifc_guid) STATE.ifcGuidMap[el.ifc_guid] = el;
      });

      // Mapear GUIDs a localIds si el modelo ya está cargado
      if (STATE.model) await mapearGuids();

      document.getElementById("dz-json").classList.add("loaded");
      document.getElementById("dz-json-txt").textContent = "✓ " + (STATE.jsonData.proyecto || file.name);
      toast("✓ JSON cargado — " + STATE.jsonData.elementos.length + " elementos");
    } catch(err) { toast("JSON inválido"); }
  };
  r.readAsText(file);
};

async function mapearGuids() {
  if (!STATE.model || !STATE.jsonData) return;
  const allGuids = STATE.jsonData.elementos.filter(el => el.ifc_guid).map(el => el.ifc_guid);
  if (!allGuids.length) return;
  const localIdsList = await STATE.model.getLocalIdsByGuids(allGuids);
  allGuids.forEach((guid, i) => {
    if (localIdsList[i] !== null && localIdsList[i] !== undefined) {
      STATE.guidToLocalId[guid] = localIdsList[i];
      STATE.localIdToEl[localIdsList[i]] = STATE.ifcGuidMap[guid];
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
async function ajustarCamara() {
  try {
    const box = new THREE.Box3();
    STATE.world.scene.three.traverse(obj => {
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
    await STATE.world.camera.controls.setLookAt(
      center.x+d, center.y+d*0.6, center.z+d,
      center.x, center.y, center.z, true
    );
  } catch(e) {}
}

function normEst(raw) {
  if (!raw) return "Sin estado";
  const n = raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if (n==="terminado") return "Terminado";
  if (n==="inspeccionado") return "Inspeccionado";
  if (n==="en proceso") return "En proceso";
  if (n==="no iniciado") return "No iniciado";
  return raw.trim();
}

function mostrarLoading(txt) {
  document.getElementById("load-txt").textContent = txt || "Cargando...";
  document.getElementById("loading").classList.add("on");
}
function ocultarLoading() {
  document.getElementById("loading").classList.remove("on");
}
function toast(msg) {
  const t = document.getElementById("toast");
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
// CARGAR JSON DE VACIADOS DESDE REVIT
// ══════════════════════════════════════════════════════
window.cargarJSONVaciados = function(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.vaciados) { V_toast("JSON de vaciados inválido"); return; }

      let importados = 0;
      for (const v of data.vaciados) {
        // Evitar duplicados por ID
        if (STATE.vaciados.find(x => x.id === v.id)) continue;

        STATE.vaciados.push({
          id: v.id,
          fecha: v.fecha || '—',
          proveedor: v.proveedor || '—',
          remision: v.remision || '—',
          fc: v.fc || 28,
          slump: v.slump,
          volumen: v.volumen,
          responsable: v.responsable || '—',
          cil7: v.cil7,
          cil28: v.cil28,
          estado: v.estado || 'pendiente',
          observaciones: v.observaciones || '',
          categorias: v.categorias || [],
          niveles: v.niveles || [],
          elementos: v.elementos || [],
          elementosInfo: [],
          fechaRegistro: new Date().toISOString(),
          origen: 'revit',
        });
        importados++;
      }

      document.getElementById('dz-vaciados').classList.add('loaded');
      document.getElementById('dz-vaciados-txt').textContent = '✓ ' + file.name;

      actualizarStats();
      actualizarListaVaciados();
      actualizarAlertas();

      V_toast('✓ ' + importados + ' vaciados importados desde Revit');
      switchTab('vaciados');
    } catch(e) {
      V_toast('Error: ' + e.message);
    }
  };
  r.readAsText(file);
};

// ══════════════════════════════════════════════════════
// REPORTE TÉCNICO PDF — TODOS LOS VACIADOS
// ══════════════════════════════════════════════════════
window.generarReportePDF = async function() {
  if (!STATE.vaciados.length) { V_toast('No hay vaciados para reportar'); return; }

  // Cargar jsPDF
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297;
  let page = 1;

  const proyecto = STATE.jsonData?.proyecto || 'Proyecto';
  const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  const vaciados = STATE.vaciados;

  function header(p) {
    // Fondo blanco
    doc.setFillColor(255,255,255);
    doc.rect(0,0,W,H,'F');

    // Banda superior
    doc.setFillColor(26,26,26);
    doc.rect(0,0,W,14,'F');
    doc.setFillColor(250,204,21);
    doc.rect(0,0,4,14,'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(9);
    doc.text('REGISTRO DE VACIADOS DE CONCRETO — NSR-10', 8, 6);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7);
    doc.setTextColor(150,150,150);
    doc.text(proyecto, 8, 11);
    doc.text('Pág. ' + p, W-10, 9, { align: 'right' });
    doc.setTextColor(250,204,21);
    doc.text('LF BIM Studio', W-10, 12.5, { align: 'right' });
  }

  function footer() {
    doc.setFillColor(245,245,245);
    doc.rect(0,H-10,W,10,'F');
    doc.setDrawColor(220,220,220);
    doc.line(0,H-10,W,H-10);
    doc.setTextColor(150,150,150);
    doc.setFont('helvetica','normal');
    doc.setFontSize(6.5);
    doc.text(
      'LF BIM Studio  ·  Ing. Luis Manuel Fuentes Perez  ·  Generado: ' + fecha + '  ·  Criterio NSR-10 C.5.6',
      W/2, H-4, { align: 'center' }
    );
  }

  // ── PORTADA ──
  doc.setFillColor(26,26,26);
  doc.rect(0,0,W,H,'F');
  doc.setFillColor(250,204,21);
  doc.rect(0,0,5,H,'F');

  // Watermark
  doc.setTextColor(35,35,35);
  doc.setFont('helvetica','bold');
  doc.setFontSize(120);
  doc.text('NSR', W/2+5, H/2+20, { align: 'center' });

  doc.setTextColor(250,204,21);
  doc.setFontSize(9);
  doc.text('LF BIM STUDIO', 14, 40);
  doc.setFontSize(28);
  doc.text('REGISTRO DE', 14, 58);
  doc.text('VACIADOS DE', 14, 74);
  doc.text('CONCRETO', 14, 90);

  doc.setFillColor(40,40,40);
  doc.rect(14, 100, W-24, 0.5, 'F');

  doc.setTextColor(180,180,180);
  doc.setFont('helvetica','normal');
  doc.setFontSize(10);
  doc.text(proyecto, 14, 112);

  doc.setTextColor(100,100,100);
  doc.setFontSize(8);
  doc.text('FECHA DE GENERACIÓN', 14, 128);
  doc.setTextColor(200,200,200);
  doc.setFontSize(10);
  doc.text(fecha, 14, 136);

  doc.setTextColor(100,100,100);
  doc.setFontSize(8);
  doc.text('TOTAL COLADAS REGISTRADAS', 14, 152);
  doc.setTextColor(250,204,21);
  doc.setFont('helvetica','bold');
  doc.setFontSize(32);
  doc.text(vaciados.length.toString(), 14, 168);

  // KPIs portada
  const aprobados  = vaciados.filter(v=>v.estado==='aprobado').length;
  const pendientes = vaciados.filter(v=>v.estado==='pendiente').length;
  const reprobados = vaciados.filter(v=>v.estado==='reprobado').length;

  const kpis = [
    {l:'Aprobados',v:aprobados,c:[34,197,94]},
    {l:'Pendientes',v:pendientes,c:[251,146,60]},
    {l:'Reprobados',v:reprobados,c:[239,68,68]},
  ];
  kpis.forEach((k,i) => {
    const x = 14 + i*60;
    doc.setFillColor(30,30,30);
    doc.rect(x, 178, 55, 20, 'F');
    doc.setFillColor(...k.c);
    doc.rect(x, 178, 55, 1.5, 'F');
    doc.setTextColor(...k.c);
    doc.setFont('helvetica','bold');
    doc.setFontSize(22);
    doc.text(k.v.toString(), x+27, 192, { align: 'center' });
    doc.setTextColor(100,100,100);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7);
    doc.text(k.l.toUpperCase(), x+27, 197, { align: 'center' });
  });

  doc.setTextColor(50,50,50);
  doc.setFont('helvetica','normal');
  doc.setFontSize(7);
  doc.text('Criterio de aceptación: NSR-10 C.5.6  ·  f'c mínimo según especificaciones', 14, H-20);
  doc.text('Ing. Luis Manuel Fuentes Perez  ·  LF BIM Studio', 14, H-14);

  // ── PÁGINAS DE VACIADOS ──
  for (const vac of vaciados) {
    doc.addPage();
    page++;
    header(page);
    footer();

    let y = 22;

    // Header del vaciado
    const estColor = vac.estado==='aprobado'?[34,197,94]:vac.estado==='reprobado'?[239,68,68]:[251,146,60];
    doc.setFillColor(248,248,248);
    doc.rect(10, y, 190, 12, 'F');
    doc.setFillColor(...estColor);
    doc.rect(10, y, 3, 12, 'F');
    doc.setTextColor(26,26,26);
    doc.setFont('helvetica','bold');
    doc.setFontSize(14);
    doc.text('Colada: ' + vac.id, 16, y+8);
    doc.setFillColor(...estColor);
    doc.roundedRect(W-50, y+2, 38, 8, 1, 1, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.text(vac.estado.toUpperCase(), W-31, y+7, { align: 'center' });
    y += 16;

    // Info general — grid 3x2
    const campos = [
      ['Fecha de vaciado', vac.fecha || '—'],
      ['Proveedor', vac.proveedor || '—'],
      ['N° Remisión', vac.remision || '—'],
      ["F'c especificado", (vac.fc || 28) + ' MPa'],
      ['Slump', vac.slump ? vac.slump + ' cm' : '—'],
      ['Volumen (remisión)', vac.volumen ? vac.volumen + ' m³ *' : '—'],
    ];

    campos.forEach(([lbl, val], i) => {
      const col = i % 3;
      const x = 10 + col * 64;
      if (col === 0 && i > 0) y += 13;
      doc.setFillColor(252,252,252);
      doc.setDrawColor(230,230,230);
      doc.rect(x, y, 60, 11, 'FD');
      doc.setTextColor(120,120,120);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7);
      doc.text(lbl.toUpperCase(), x+3, y+4);
      doc.setTextColor(26,26,26);
      doc.setFont('helvetica','bold');
      doc.setFontSize(9);
      doc.text(val.toString().substring(0,22), x+3, y+9.5);
    });
    y += 18;

    // Responsable
    doc.setFillColor(252,252,252);
    doc.setDrawColor(230,230,230);
    doc.rect(10, y, 190, 10, 'FD');
    doc.setFillColor(250,204,21);
    doc.rect(10, y, 2, 10, 'F');
    doc.setTextColor(120,120,120);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7);
    doc.text('RESPONSABLE DE VACIADO', 15, y+4);
    doc.setTextColor(26,26,26);
    doc.setFont('helvetica','bold');
    doc.setFontSize(9);
    doc.text(vac.responsable || '—', 15, y+8.5);
    y += 14;

    // Elementos afectados
    if (vac.categorias && vac.categorias.length) {
      doc.setTextColor(100,100,100);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7);
      doc.text('CATEGORÍAS ESTRUCTURALES: ' + vac.categorias.join(', '), 10, y);
      y += 5;
    }
    if (vac.niveles && vac.niveles.length) {
      doc.text('NIVELES: ' + vac.niveles.join(', ') + '  ·  ELEMENTOS: ' + (vac.elementos ? vac.elementos.length : '—'), 10, y);
      y += 8;
    }

    // Sección cilindros
    doc.setFillColor(26,26,26);
    doc.rect(10, y, 190, 7, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.text('CONTROL DE CILINDROS — NSR-10 C.5.6', 14, y+5);
    y += 10;

    // Tabla cilindros
    const cilHeaders = ['Ensayo', 'Resultado (MPa)', "F'c mín. (MPa)", 'Criterio NSR-10', 'Estado'];
    const cilColX = [10, 52, 90, 128, 170];
    doc.setFillColor(245,245,245);
    doc.rect(10, y, 190, 7, 'F');
    cilHeaders.forEach((h, i) => {
      doc.setTextColor(80,80,80);
      doc.setFont('helvetica','bold');
      doc.setFontSize(7);
      doc.text(h, cilColX[i]+2, y+5);
    });
    y += 7;

    const fcMin = (vac.fc || 28) - 3.5;
    const cilRows = [
      ['7 días', vac.cil7, '—', 'Referencia (70% f'c)', vac.cil7 ? (vac.cil7 >= (vac.fc||28)*0.7 ? '✓' : '⚠') : '—'],
      ['28 días', vac.cil28, fcMin.toFixed(1), 'Ningún result. < f'c − 3.5', vac.cil28 ? (vac.cil28 >= (vac.fc||28) ? '✓ APROBADO' : '✗ REPROBADO') : 'PENDIENTE'],
    ];

    cilRows.forEach((row, ri) => {
      doc.setFillColor(ri%2===0?250:255,ri%2===0?250:255,ri%2===0?250:255);
      doc.rect(10, y, 190, 8, 'F');
      const cols = row.map(v => v !== null && v !== undefined ? v.toString() : '—');
      const isAprobado = cols[4].includes('APROBADO');
      const isReprobado = cols[4].includes('REPROBADO');
      const isPendiente = cols[4] === 'PENDIENTE';
      cols.forEach((val, ci) => {
        const color = ci===4 ? (isAprobado?[34,163,74]:isReprobado?[200,40,40]:isPendiente?[194,100,20]:[80,80,80]) : [60,60,60];
        doc.setTextColor(...color);
        doc.setFont('helvetica', ci===4?'bold':'normal');
        doc.setFontSize(8);
        doc.text(val.substring(0,25), cilColX[ci]+2, y+5.5);
      });
      doc.setDrawColor(230,230,230);
      doc.line(10, y+8, 200, y+8);
      y += 8;
    });
    y += 6;

    // Observaciones
    if (vac.observaciones) {
      doc.setFillColor(255,252,240);
      doc.setDrawColor(220,200,150);
      const obsLines = doc.splitTextToSize(vac.observaciones, 182);
      const obsH = obsLines.length * 5 + 8;
      doc.roundedRect(10, y, 190, obsH, 1, 1, 'FD');
      doc.setFillColor(250,204,21);
      doc.rect(10, y, 2, obsH, 'F');
      doc.setTextColor(80,80,80);
      doc.setFont('helvetica','bold');
      doc.setFontSize(7);
      doc.text('OBSERVACIONES', 15, y+5);
      doc.setFont('helvetica','normal');
      doc.setFontSize(8);
      doc.setTextColor(50,50,50);
      doc.text(obsLines, 15, y+10);
      y += obsH + 8;
    }

    // Nota volumen
    doc.setTextColor(150,150,150);
    doc.setFont('helvetica','italic');
    doc.setFontSize(6.5);
    doc.text('* El volumen indicado corresponde al volumen de remisión registrado en campo, no al volumen calculado del modelo BIM.', 10, y+5);
    y += 12;

    // Firmas
    const firmaY = Math.max(y+10, H-55);
    doc.setFillColor(248,248,248);
    doc.setDrawColor(220,220,220);
    doc.roundedRect(10, firmaY, 58, 28, 1, 1, 'FD');
    doc.roundedRect(76, firmaY, 58, 28, 1, 1, 'FD');
    doc.roundedRect(142, firmaY, 58, 28, 1, 1, 'FD');
    doc.setTextColor(120,120,120);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7);
    doc.text('Residente BIM', 39, firmaY+5, { align: 'center' });
    doc.text('Laboratorio', 105, firmaY+5, { align: 'center' });
    doc.text('Interventoría', 171, firmaY+5, { align: 'center' });
    doc.setDrawColor(180,180,180);
    doc.line(18, firmaY+20, 60, firmaY+20);
    doc.line(84, firmaY+20, 126, firmaY+20);
    doc.line(150, firmaY+20, 192, firmaY+20);
    doc.setTextColor(150,150,150);
    doc.setFontSize(6.5);
    doc.text(vac.responsable ? vac.responsable.substring(0,20) : '—', 39, firmaY+24, { align: 'center' });
    doc.text('Firma laboratorio', 105, firmaY+24, { align: 'center' });
    doc.text('Firma interventoría', 171, firmaY+24, { align: 'center' });
  }

  // ── RESUMEN FINAL ──
  doc.addPage();
  page++;
  header(page);
  footer();

  let y = 22;
  doc.setFillColor(26,26,26);
  doc.rect(10, y, 190, 8, 'F');
  doc.setTextColor(250,204,21);
  doc.setFont('helvetica','bold');
  doc.setFontSize(9);
  doc.text('RESUMEN EJECUTIVO — REGISTRO DE VACIADOS', 14, y+5.5);
  y += 12;

  // Tabla resumen
  const headers = ['ID Colada', 'Fecha', 'Proveedor', "F'c", '7d (MPa)', '28d (MPa)', 'Estado'];
  const colX = [10, 38, 70, 116, 132, 152, 172];
  doc.setFillColor(240,240,240);
  doc.rect(10, y, 190, 7, 'F');
  headers.forEach((h, i) => {
    doc.setTextColor(60,60,60);
    doc.setFont('helvetica','bold');
    doc.setFontSize(7);
    doc.text(h, colX[i]+1, y+5);
  });
  y += 7;

  vaciados.forEach((v, ri) => {
    if (y > H-30) return;
    doc.setFillColor(ri%2===0?250:245,ri%2===0?250:245,ri%2===0?250:245);
    doc.rect(10, y, 190, 7, 'F');
    const estC = v.estado==='aprobado'?[34,163,74]:v.estado==='reprobado'?[200,40,40]:[194,100,20];
    const vals = [
      v.id,
      v.fecha||'—',
      (v.proveedor||'—').substring(0,18),
      (v.fc||28)+' MPa',
      v.cil7?v.cil7+' MPa':'—',
      v.cil28?v.cil28+' MPa':'—',
      v.estado.toUpperCase(),
    ];
    vals.forEach((val, ci) => {
      doc.setTextColor(ci===6?...estC:[60,60,60]);
      doc.setFont('helvetica', ci===0||ci===6?'bold':'normal');
      doc.setFontSize(7.5);
      doc.text(val.toString(), colX[ci]+1, y+5);
    });
    doc.setDrawColor(230,230,230);
    doc.line(10, y+7, 200, y+7);
    y += 7;
  });

  const nombre = 'RegistroVaciados_' + (proyecto.replace(/[^\w]/g,'_')) + '_' + new Date().toISOString().split('T')[0] + '.pdf';
  doc.save(nombre);
  V_toast('✓ Reporte técnico exportado: ' + nombre);
};

// Helpers locales
function actualizarStats() {
  const total      = STATE.vaciados.length;
  const aprobados  = STATE.vaciados.filter(v => v.estado === 'aprobado').length;
  const pendientes = STATE.vaciados.filter(v => v.estado === 'pendiente').length;
  const reprobados = STATE.vaciados.filter(v => v.estado === 'reprobado').length;
  document.getElementById('st-total').textContent      = total;
  document.getElementById('st-aprobados').textContent  = aprobados;
  document.getElementById('st-pendientes').textContent = pendientes;
  document.getElementById('st-reprobados').textContent = reprobados;
}

function actualizarListaVaciados() {
  const lista = document.getElementById('lista-vaciados');
  if (!STATE.vaciados.length) {
    lista.innerHTML = '<div class="elem-sel-empty">No hay vaciados registrados aún</div>';
    return;
  }
  lista.innerHTML = STATE.vaciados.slice().reverse().map(v => `
    <div class="vaciado-item" onclick="verVaciado('${v.id}')">
      <div class="vaciado-id">${v.id}</div>
      <div class="vaciado-info">${v.fecha} · ${v.proveedor}</div>
      <div class="vaciado-info">${v.elementos ? v.elementos.length : 0} elementos · F'c ${v.fc} MPa</div>
      <div class="vaciado-estado est-${v.estado}">${v.estado.toUpperCase()}</div>
    </div>
  `).join('');
}

function actualizarAlertas() {
  const lista = document.getElementById('lista-alertas');
  const alertas = [];
  for (const v of STATE.vaciados) {
    if (v.estado === 'pendiente') {
      const fechaVac = new Date(v.fecha);
      const hoy = new Date();
      const dias = Math.floor((hoy - fechaVac) / (1000 * 60 * 60 * 24));
      if (dias >= 25) {
        alertas.push({ tipo: 'warn', titulo: v.id + ' — Resultado 28 días próximo', body: dias + ' días transcurridos. Solicitar al laboratorio.' });
      }
    }
    if (v.estado === 'reprobado') {
      alertas.push({ tipo: 'err', titulo: v.id + ' — CILINDROS REPROBADOS ⚠', body: "F'c: " + v.fc + ' MPa · Resultado: ' + v.cil28 + ' MPa' });
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

function V_toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('on'), 3500);
}

initVisor().catch(console.error);
