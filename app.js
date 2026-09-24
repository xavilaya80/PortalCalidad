/**
 * PORTAL CALIDAD - Frontend
 *
 * Importante sobre permisos: lo que este archivo hace con el rol es puramente
 * cosmetico (esconder botones para no confundir a quien no puede usarlos). La
 * decision real la toma el backend en cada peticion. Si alguien edita este
 * archivo desde el navegador para mostrarse los botones de edicion, igual va a
 * recibir un 403 al intentar guardar.
 */

// ============ CONFIGURACION ============
// Pegar aca la URL /exec del despliegue del portal (NO la de AppCalidad).
/*
 * URL del despliegue del portal (Apps Script, termina en /exec).
 *
 * NO es la de AppCalidad: son dos proyectos distintos con dos URLs distintas.
 * Si esto queda con un texto que no sea una direccion valida, el navegador manda
 * el POST a la propia pagina de GitHub Pages, que solo sirve archivos, y la
 * respuesta es un error 405.
 */
const PORTAL_URL = 'https://script.google.com/macros/s/AKfycby-g67rvd3sGRXueL-e3uomNnKAj9NtlMYBCy6R0LYxIeftx47iE1m8VDZDMdtwhOnh/exec';

// ============ ESTADO ============
let sesion = null;        // { token, usuario, rol }
let columnasSpecs = [];
let productos = [];
let filaEditando = null;

// ============ ACCESOS ============
const $ = (id) => document.getElementById(id);

// ============ SESION EN MEMORIA + sessionStorage ============
/*
 * sessionStorage y no localStorage: la sesion muere al cerrar la pestaña. En un
 * computador compartido de planta eso importa, porque evita que el siguiente que
 * se siente quede con la sesion de otro abierta.
 */
function guardarSesion(s) {
  sesion = s;
  try { sessionStorage.setItem('portal_sesion', JSON.stringify(s)); } catch (e) {}
}

function recuperarSesion() {
  try {
    const bruto = sessionStorage.getItem('portal_sesion');
    if (bruto) sesion = JSON.parse(bruto);
  } catch (e) { sesion = null; }
  return sesion;
}

function cerrarSesion(mensaje) {
  sesion = null;
  try { sessionStorage.removeItem('portal_sesion'); } catch (e) {}
  $('pantallaApp').hidden = true;
  $('pantallaLogin').hidden = false;
  $('inputClave').value = '';
  if (mensaje) mostrarErrorLogin(mensaje);
}

// ============ LLAMADAS AL BACKEND ============
/*
 * Content-Type text/plain a proposito: con application/json el navegador dispara
 * una peticion OPTIONS previa (preflight) que Apps Script no responde, y la
 * llamada falla por CORS. Es el mismo truco que usa AppCalidad.
 */
async function llamar(action, extra = {}) {
  const cuerpo = Object.assign({ action }, extra);
  if (sesion && sesion.token) cuerpo.token = sesion.token;

  let respuesta;
  try {
    respuesta = await fetch(PORTAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow'
    });
  } catch (err) {
    throw new Error('Sin conexión con el servidor. Revisá la red e intentá de nuevo.');
  }

  if (!respuesta.ok) throw new Error('El servidor respondió con error ' + respuesta.status + '.');

  let datos;
  try {
    datos = await respuesta.json();
  } catch (err) {
    throw new Error('Respuesta inesperada del servidor.');
  }

  if (datos.code === 401) {
    cerrarSesion('Tu sesión expiró. Ingresá de nuevo.');
    throw new Error('Sesión expirada.');
  }
  return datos;
}

// ============ AVISOS ============
let toastTimer = null;
function toast(texto, tipo = 'ok') {
  const t = $('toast');
  t.textContent = texto;
  t.className = 'toast toast-' + tipo;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

function mostrarErrorLogin(texto) {
  const p = $('loginError');
  p.textContent = texto;
  p.hidden = !texto;
}

// ============ LOGIN ============
async function iniciarSesion() {
  const usuario = $('inputUsuario').value;
  const clave = $('inputClave').value;
  mostrarErrorLogin('');

  if (!usuario) return mostrarErrorLogin('Seleccioná tu usuario.');
  if (!clave) return mostrarErrorLogin('Ingresá tu clave.');

  const boton = $('btnLogin');
  boton.disabled = true;
  boton.textContent = 'Verificando...';

  try {
    const r = await llamar('login', { usuario, clave });
    if (r.status !== 'success') return mostrarErrorLogin(r.message || 'No se pudo ingresar.');

    guardarSesion({ token: r.token, usuario: r.usuario, rol: r.rol });
    entrarAlPortal();
  } catch (err) {
    mostrarErrorLogin(err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Ingresar';
  }
}

function entrarAlPortal() {
  $('pantallaLogin').hidden = true;
  $('pantallaApp').hidden = false;

  const esJefa = sesion.rol === 'jefa';
  const nombre = sesion.usuario.charAt(0).toUpperCase() + sesion.usuario.slice(1);
  $('badgeUsuario').textContent = nombre + ' · ' + (esJefa ? 'Edición' : 'Solo lectura');
  $('badgeUsuario').className = 'badge ' + (esJefa ? 'badge-jefa' : 'badge-lector');

  $('specsModo').textContent = esJefa
    ? 'Podés modificar las especificaciones. Cada cambio queda registrado con tu usuario.'
    : 'Vista de solo lectura. Para modificar, consultá con la jefa de calidad.';

  cargarSpecs();
}

// ============ ESPECIFICACIONES ============
async function cargarSpecs() {
  const estado = $('specsEstado');
  estado.hidden = false;
  estado.textContent = 'Cargando especificaciones...';
  $('tablaSpecs').hidden = true;

  try {
    const r = await llamar('listarSpecs');
    if (r.status !== 'success') {
      estado.textContent = r.message || 'No se pudieron cargar las especificaciones.';
      return;
    }
    columnasSpecs = r.columnas || [];
    productos = r.productos || [];

    if (!productos.length) {
      estado.textContent = 'No hay productos cargados en la planilla.';
      return;
    }
    estado.hidden = true;
    dibujarSpecs();
  } catch (err) {
    estado.textContent = err.message;
  }
}

function dibujarSpecs() {
  const filtro = $('buscarSpec').value.toLowerCase().trim();
  const esJefa = sesion.rol === 'jefa';

  const head = $('specsHead');
  head.innerHTML = '';
  columnasSpecs.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    head.appendChild(th);
  });
  if (esJefa) {
    const th = document.createElement('th');
    th.textContent = 'Acción';
    head.appendChild(th);
  }

  const body = $('specsBody');
  body.innerHTML = '';

  const visibles = productos.filter(p =>
    !filtro || columnasSpecs.some(c => String(p[c] || '').toLowerCase().includes(filtro))
  );

  if (!visibles.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columnasSpecs.length + (esJefa ? 1 : 0);
    td.className = 'celda-vacia';
    td.textContent = 'Ningún producto coincide con la búsqueda.';
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    visibles.forEach(p => {
      const tr = document.createElement('tr');
      columnasSpecs.forEach(c => {
        const td = document.createElement('td');
        td.textContent = p[c] || '-';
        tr.appendChild(td);
      });
      if (esJefa) {
        const td = document.createElement('td');
        const b = document.createElement('button');
        b.className = 'btn btn-mini';
        b.textContent = 'Editar';
        b.addEventListener('click', () => abrirModal(p));
        td.appendChild(b);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
  }

  $('tablaSpecs').hidden = false;
}

// ============ MODAL DE EDICION ============
function abrirModal(producto) {
  filaEditando = producto._fila;
  const contenedor = $('modalCampos');
  contenedor.innerHTML = '';
  $('modalError').hidden = true;
  $('modalTitulo').textContent = 'Editar: ' + (producto[columnasSpecs[0]] || '');

  columnasSpecs.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'campo';

    const label = document.createElement('label');
    label.textContent = c;
    label.setAttribute('for', 'campo_' + i);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'campo_' + i;
    input.value = producto[c] || '';
    input.dataset.columna = c;

    // La primera columna es el identificador del producto. Dejarla editable
    // permitiria renombrar un producto y desconectarlo de todo el historial
    // de inspecciones que ya lo referencia.
    if (i === 0) {
      input.disabled = true;
      input.title = 'El identificador no se puede modificar.';
    }

    div.appendChild(label);
    div.appendChild(input);
    contenedor.appendChild(div);
  });

  $('modalSpec').hidden = false;
}

function cerrarModal() {
  $('modalSpec').hidden = true;
  filaEditando = null;
}

async function guardarModal() {
  if (!filaEditando) return;

  const valores = {};
  let invalido = null;

  $('modalCampos').querySelectorAll('input').forEach(inp => {
    if (inp.disabled) return;
    const v = inp.value.trim();
    if (v.charAt(0) === '=') invalido = inp.dataset.columna;
    valores[inp.dataset.columna] = v;
  });

  const err = $('modalError');
  if (invalido) {
    err.textContent = 'El valor de "' + invalido + '" no puede empezar con "=".';
    err.hidden = false;
    return;
  }
  err.hidden = true;

  const boton = $('modalGuardar');
  boton.disabled = true;
  boton.textContent = 'Guardando...';

  try {
    const r = await llamar('guardarSpec', { fila: filaEditando, valores });
    if (r.status !== 'success') {
      err.textContent = r.message || 'No se pudo guardar.';
      err.hidden = false;
      return;
    }
    cerrarModal();
    toast(r.cambios ? 'Especificación actualizada.' : 'No había cambios que guardar.');
    cargarSpecs();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar cambios';
  }
}

// ============ PDFs ============
async function buscarPdfs() {
  const estado = $('pdfsEstado');
  estado.hidden = false;
  estado.textContent = 'Buscando...';
  $('tablaPdfs').hidden = true;

  const filtros = {
    texto: $('fTexto').value.trim(),
    tipo: $('fTipo').value,
    maquina: $('fMaquina').value.trim(),
    turno: $('fTurno').value,
    desde: $('fDesde').value,
    hasta: $('fHasta').value
  };

  try {
    const r = await llamar('listarPDFs', { filtros });
    if (r.status !== 'success') {
      estado.textContent = r.message || 'No se pudo consultar.';
      return;
    }
    if (!r.archivos.length) {
      estado.textContent = 'No se encontraron reportes con esos filtros.';
      return;
    }
    dibujarPdfs(r.archivos);
    estado.hidden = !r.truncado;
    if (r.truncado) {
      // Ahora son los MAS RECIENTES, no los primeros que devolvio Drive.
      estado.textContent = 'Se muestran los ' + r.total + ' reportes más recientes. ' +
        'Quedaron ' + (r.truncados || 0) + ' fuera: usá los filtros para acotar la búsqueda.';
    }
  } catch (err) {
    estado.textContent = err.message;
  }
}

function dibujarPdfs(archivos) {
  const body = $('pdfsBody');
  body.innerHTML = '';

  archivos.forEach(a => {
    const tr = document.createElement('tr');

    [a.nombre, a.tipo, a.maquina || '-', a.fecha || '-', a.turno || '-', a.kb + ' KB']
      .forEach((valor, i) => {
        const td = document.createElement('td');
        td.textContent = valor;
        if (i === 0) td.className = 'celda-nombre';
        tr.appendChild(td);
      });

    const tdAcc = document.createElement('td');
    tdAcc.className = 'celda-acciones';

    const bVer = document.createElement('button');
    bVer.className = 'btn btn-mini';
    bVer.textContent = 'Ver';
    bVer.addEventListener('click', () => obtenerPdf(a, 'ver', bVer));

    const bBajar = document.createElement('button');
    bBajar.className = 'btn btn-mini';
    bBajar.textContent = 'Descargar';
    bBajar.addEventListener('click', () => obtenerPdf(a, 'descargar', bBajar));

    const bImp = document.createElement('button');
    bImp.className = 'btn btn-mini';
    bImp.textContent = 'Imprimir';
    bImp.addEventListener('click', () => obtenerPdf(a, 'imprimir', bImp));

    tdAcc.append(bVer, bBajar, bImp);
    tr.appendChild(tdAcc);
    body.appendChild(tr);
  });

  $('tablaPdfs').hidden = false;
}

/*
 * El backend manda el PDF en base64. Aca se reconstruye como Blob y se le da una
 * URL local (blob:) que solo existe en este navegador. Nunca hay un enlace a
 * Drive, por eso la carpeta puede quedar privada.
 */
function base64ABlob(base64) {
  /*
   * Se limpia la cadena antes de decodificar.
   *
   * atob es estricto: un solo salto de linea o espacio en el base64 lo hace
   * fallar, y el error que produce no dice nada util. El resultado para el
   * inspector era "no se puede abrir el archivo", como si el PDF estuviera roto
   * cuando en realidad lo que fallo fue la reconstruccion en el navegador.
   */
  const limpio = String(base64 || '').replace(/[\r\n\s]/g, '');
  if (!limpio) throw new Error('El servidor devolvió el archivo vacío.');

  let binario;
  try {
    binario = atob(limpio);
  } catch (e) {
    throw new Error('El archivo llegó dañado desde el servidor. Probá de nuevo.');
  }

  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

  // Un PDF valido empieza con "%PDF". Si no, es mejor decirlo aca que dejar que
  // el visor del navegador muestre una pantalla en blanco sin explicacion.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new Error('El contenido recibido no es un PDF válido.');
  }

  return new Blob([bytes], { type: 'application/pdf' });
}

async function obtenerPdf(archivo, modo, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = '...';

  try {
    const r = await llamar('descargarPDF', { id: archivo.id });
    if (r.status !== 'success') { toast(r.message || 'No se pudo abrir el archivo.', 'error'); return; }

    const url = URL.createObjectURL(base64ABlob(r.base64));

    if (modo === 'descargar') {
      const a = document.createElement('a');
      a.href = url;
      a.download = r.nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // El revoke se demora a proposito: si se libera de inmediato, algunos
      // navegadores cancelan la descarga antes de terminarla.
      setTimeout(() => URL.revokeObjectURL(url), 20000);

    } else if (modo === 'imprimir') {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      iframe.onload = () => {
        try { iframe.contentWindow.print(); }
        catch (e) { window.open(url, '_blank'); }
      };
      document.body.appendChild(iframe);
      setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 60000);

    } else {
      /*
       * Un enlace con target=_blank en vez de window.open: Chrome lo trata como
       * navegacion iniciada por el usuario y no como ventana emergente, asi que
       * abre el visor de PDF sin depender de que el bloqueo este desactivado.
       */
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Margen amplio: revocar antes de que el visor termine de leer el blob
      // deja la pestaña en blanco.
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function limpiarFiltros() {
  ['fTexto', 'fMaquina', 'fDesde', 'fHasta'].forEach(id => { $(id).value = ''; });
  $('fTipo').value = '';
  $('fTurno').value = '';
  $('pdfsEstado').hidden = false;
  $('pdfsEstado').textContent = 'Usá los filtros y presioná Buscar.';
  $('tablaPdfs').hidden = true;
}

// ============ ANÁLISIS DE TENDENCIA ============
/*
 * Esta pantalla vivia en AppCalidad y se movio aqui.
 *
 * El motivo es de peso, literalmente: sus graficos necesitan el valor de CADA
 * cavidad de CADA ronda, y en la app de terreno ese dato viajaba junto al
 * historial, o sea despues de cada guardado. Con siete dias y moldes de hasta 24
 * cavidades la respuesta llegaba a varios megabytes y Apps Script no alcanzaba a
 * servirla: el historial dejaba de cargar y guardar una ronda tardaba minutos.
 *
 * Aqui el costo se paga una vez, cuando alguien abre la pestaña, y no interfiere
 * con el trabajo en planta. De paso hay pantalla grande: se grafican ocho
 * mediciones en vez de tres y se agrega la tabla de valores por ronda.
 */

let analisisProductos = [];
let analisisVariables = [];
let analisisRondas = [];
let analisisTolerancias = {};
let analisisChart = null;
let analisisCatalogoCargado = false;

async function cargarCatalogoAnalisis() {
  if (analisisCatalogoCargado) return;

  const estado = $('aEstado');
  estado.hidden = false;
  estado.textContent = 'Cargando productos...';

  try {
    const r = await llamar('analisisCatalogo');
    if (r.status !== 'success') { estado.textContent = r.message || 'No se pudo cargar.'; return; }

    analisisProductos = r.productos || [];

    analisisVariables = r.variables || [];
    const selVar = $('aVariable');
    selVar.innerHTML = '';
    analisisVariables.forEach(v => {
      const o = document.createElement('option');
      o.value = v.clave; o.textContent = v.etiqueta;
      selVar.appendChild(o);
    });

    // El rango por defecto son los ultimos 30 dias de datos que existan, no los
    // ultimos 30 del calendario: si la planta paro una semana, igual se ve algo.
    if (r.hasta) {
      $('aHasta').value = r.hasta;
      const d = new Date(r.hasta + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - 30);
      const desde = d.toISOString().slice(0, 10);
      $('aDesde').value 	= (r.desde && desde < r.desde) ? r.desde : desde;
    }

    analisisCatalogoCargado = true;
    estado.textContent = 'Elegí un producto y presioná Analizar.';
  } catch (err) {
    estado.textContent = err.message;
  }
}

async function analizar() {
  const producto = $('aProducto').value;
  if (!producto) return;

  const estado = $('aEstado');
  estado.hidden = false;
  estado.textContent = 'Leyendo mediciones...';
  $('aResultado').hidden = true;

  const boton = $('btnAnalizar');
  boton.disabled = true;
  boton.textContent = 'Analizando...';

  try {
    const r = await llamar('analisisDatos', {
      producto,
      desde: $('aDesde').value,
      hasta: $('aHasta').value
    });

    if (r.status !== 'success') { estado.textContent = r.message || 'No se pudo analizar.'; return; }

    analisisRondas = r.rondas || [];
    analisisTolerancias = r.tolerancias || {};

    if (!analisisRondas.length) {
      estado.textContent = 'No hay rondas de ese producto en el período elegido.';
      return;
    }

    poblarCavidades();
    $('aVariable').disabled = false;
    $('aCavidad').disabled = false;
    estado.hidden = true;
    $('aResultado').hidden = false;
    dibujarAnalisis();
  } catch (err) {
    estado.textContent = err.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Analizar';
  }
}

/* Cuantas cavidades llego a tener el molde en el periodo cargado. */
function poblarCavidades() {
  let max = 1;
  analisisRondas.forEach(r => {
    (r.porCavidad || []).forEach(t => { max = Math.max(max, Number(t[0]) || 1); });
  });

  const sel = $('aCavidad');
  const previo = sel.value;
  sel.innerHTML = '<option value="">Todas (promedio)</option>';
  for (let i = 1; i <= max; i++) {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = 'Cavidad ' + i;
    sel.appendChild(o);
  }
  if (previo && Number(previo) <= max) sel.value = previo;
}

/*
 * Arma las series del grafico.
 *
 * Con "Todas" se dibuja el promedio del molde MAS una banda de minimo y maximo
 * entre cavidades. Esa banda es el dato que importa: si se abre, el molde esta
 * desbalanceado aunque el promedio siga centrado, y eso no se ve mirando solo el
 * promedio.
 */
function seriesAnalisis(idx, cavidad) {
  const promedio = [], minimos = [], maximos = [];
  const cav = cavidad === '' ? null : Number(cavidad);

  analisisRondas.forEach(r => {
    const tuplas = Array.isArray(r.porCavidad) ? r.porCavidad : [];

    if (cav !== null) {
      const t = tuplas.find(x => Number(x[0]) === cav);
      const v = t ? t[idx] : null;
      promedio.push(typeof v === 'number' ? v : null);
      minimos.push(null);
      maximos.push(null);
      return;
    }

    const vals = tuplas.map(t => t[idx]).filter(v => typeof v === 'number');
    if (!vals.length) { promedio.push(null); minimos.push(null); maximos.push(null); return; }

    promedio.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    minimos.push(Math.min(...vals));
    maximos.push(Math.max(...vals));
  });

  return { promedio, minimos, maximos };
}

function dibujarAnalisis() {
  const clave = $('aVariable').value;
  const cavidad = $('aCavidad').value;

  const idx = analisisVariables.findIndex(v => v.clave === clave) + 1;  // +1: la tupla arranca con la cavidad
  const variable = analisisVariables.find(v => v.clave === clave) || { etiqueta: clave };
  if (idx < 1) return;

  const serie = seriesAnalisis(idx, cavidad);
  const etiquetas = analisisRondas.map(r => r.fecha.slice(5) + ' ' + r.hora);
  const lim = analisisTolerancias[clave] || null;

  const datasets = [{
    label: cavidad === '' ? 'Promedio del molde' : 'Cavidad ' + cavidad,
    data: serie.promedio,
    borderColor: '#0284c7',
    backgroundColor: 'rgba(2,132,199,0.15)',
    borderWidth: 2,
    pointRadius: 3,
    tension: 0.25,
    spanGaps: true
  }];

  if (cavidad === '') {
    // La banda se dibuja como dos lineas finas rellenas entre si.
    datasets.push({
      label: 'Máximo entre cavidades',
      data: serie.maximos,
      borderColor: 'rgba(148,163,184,0.7)',
      borderWidth: 1,
      pointRadius: 0,
      fill: '+1',
      backgroundColor: 'rgba(148,163,184,0.12)',
      tension: 0.25,
      spanGaps: true
    });
    datasets.push({
      label: 'Mínimo entre cavidades',
      data: serie.minimos,
      borderColor: 'rgba(148,163,184,0.7)',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0.25,
      spanGaps: true
    });
  }

  if (lim) {
    if (lim.max !== null) datasets.push(lineaLimite('Máximo', lim.max, etiquetas.length));
    if (lim.min !== null) datasets.push(lineaLimite('Mínimo', lim.min, etiquetas.length));
  }

  if (analisisChart) analisisChart.destroy();
  analisisChart = new Chart($('aChart').getContext('2d'), {
    type: 'line',
    data: { labels: etiquetas, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#cbd5e1', boxWidth: 14 } },
        title: { display: true, text: variable.etiqueta, color: '#f8fafc', font: { size: 14 } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', maxRotation: 60, minRotation: 40 }, grid: { color: 'rgba(148,163,184,0.12)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.12)' } }
      }
    }
  });

  dibujarTablaAnalisis(idx);
  escribirLeyenda(serie, lim);
}

function lineaLimite(nombre, valor, largo) {
  return {
    label: nombre + ' de especificación',
    data: new Array(largo).fill(valor),
    borderColor: '#dc2626',
    borderWidth: 1.5,
    borderDash: [6, 4],
    pointRadius: 0,
    fill: false
  };
}

function dibujarTablaAnalisis(idx) {
  const body = $('aTablaBody');
  body.innerHTML = '';

  analisisRondas.forEach(r => {
    const vals = (r.porCavidad || []).map(t => t[idx]).filter(v => typeof v === 'number');

    const tr = document.createElement('tr');
    const celdas = vals.length
      ? [r.fecha, r.hora, r.maquina, vals.length,
         redondear(Math.min(...vals)),
         redondear(vals.reduce((a, b) => a + b, 0) / vals.length),
         redondear(Math.max(...vals)),
         redondear(Math.max(...vals) - Math.min(...vals))]
      : [r.fecha, r.hora, r.maquina, 0, '-', '-', '-', '-'];

    celdas.forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function redondear(n) {
  return (Math.round(n * 100) / 100).toString();
}

function escribirLeyenda(serie, lim) {
  const p = $('aLeyenda');
  const conDato = serie.promedio.filter(v => v !== null).length;

  if (!lim) {
    p.className = 'analisis-leyenda analisis-leyenda-aviso';
    p.textContent = 'Este producto no tiene rango cargado en Productos_Specs, ' +
                    'así que el gráfico va sin líneas de referencia.';
    return;
  }

  const fuera = serie.promedio.filter(v => v !== null &&
    ((lim.min !== null && v < lim.min) || (lim.max !== null && v > lim.max))).length;

  p.className = 'analisis-leyenda' + (fuera > 0 ? ' analisis-leyenda-aviso' : '');
  p.textContent = fuera > 0
    ? `${fuera} de ${conDato} ronda(s) con el promedio fuera de especificación.`
    : `Las ${conDato} rondas tienen el promedio dentro de especificación.`;
}

/*
 * Buscador de producto con lista filtrable.
 *
 * Mismo control que usa AppCalidad en terreno. Un desplegable comun con mas de
 * cien productos de nombre largo obliga a recorrer la lista entera a mano; aca se
 * escriben tres letras y queda.
 *
 * El nombre elegido se guarda en un campo oculto para no depender de lo que se
 * vea escrito: si alguien teclea algo parecido pero no elige de la lista, el
 * campo queda vacio y el boton Analizar sigue deshabilitado.
 */
function setupBuscadorProducto() {
  const input = $('aBuscaProducto');
  const oculto = $('aProducto');
  const drop = $('aDropProducto');
  if (!input || !drop) return;

  const mostrar = () => {
    const filtro = input.value.toLowerCase().trim();
    drop.innerHTML = '';

    /*
     * Se muestra el NOMBRE y se guarda el CODIGO.
     *
     * La cabecera de inspecciones guarda el codigo del producto, no su nombre,
     * asi que el backend necesita el codigo para buscar. Pero el inspector
     * conoce el nombre: es lo que ve en terreno al elegir el producto.
     *
     * El filtro mira los dos, por si alguien busca por codigo.
     */
    const encontrados = analisisProductos.filter(p =>
      p.nombre.toLowerCase().includes(filtro) || p.id.toLowerCase().includes(filtro));

    if (!encontrados.length) {
      const vacio = document.createElement('div');
      vacio.className = 'combobox-item sin-coincidencias';
      vacio.textContent = analisisProductos.length
        ? 'Sin coincidencias'
        : 'Todavía no se cargaron los productos';
      drop.appendChild(vacio);
    } else {
      encontrados.forEach(p => {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.textContent = p.nombre;
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          input.value = p.nombre;
          oculto.value = p.id;
          $('btnAnalizar').disabled = false;
          drop.style.display = 'none';
        });
        drop.appendChild(item);
      });
    }
    drop.style.display = 'block';
  };

  input.addEventListener('focus', mostrar);
  input.addEventListener('click', mostrar);
  input.addEventListener('input', () => {
    // Escribir invalida la eleccion anterior: evita analizar un producto que ya
    // no es el que figura en pantalla.
    oculto.value = '';
    $('btnAnalizar').disabled = true;
    mostrar();
  });

  // Un clic fuera cierra la lista.
  document.addEventListener('click', (e) => {
    if (e.target !== input && !drop.contains(e.target)) drop.style.display = 'none';
  });
}

// ============ PESTAÑAS ============
function cambiarPanel(idPanel) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('activa', t.dataset.panel === idPanel));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== idPanel; });

  // El catalogo del analisis se pide recien al abrir su pestaña: no tiene sentido
  // cargarlo para quien solo viene a bajar un PDF.
  if (idPanel === 'panelAnalisis') cargarCatalogoAnalisis();
}

// ============ ARRANQUE ============
document.addEventListener('DOMContentLoaded', () => {
  $('btnLogin').addEventListener('click', iniciarSesion);
  $('inputClave').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });

  $('btnSalir').addEventListener('click', () => cerrarSesion(''));
  $('btnRecargarSpecs').addEventListener('click', cargarSpecs);
  $('buscarSpec').addEventListener('input', () => { if (productos.length) dibujarSpecs(); });

  $('btnBuscarPdfs').addEventListener('click', buscarPdfs);
  $('btnLimpiarPdfs').addEventListener('click', limpiarFiltros);
  $('fTexto').addEventListener('keydown', e => { if (e.key === 'Enter') buscarPdfs(); });

  $('modalCerrar').addEventListener('click', cerrarModal);
  $('modalCancelar').addEventListener('click', cerrarModal);
  $('modalGuardar').addEventListener('click', guardarModal);
  $('modalSpec').addEventListener('click', e => { if (e.target.id === 'modalSpec') cerrarModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modalSpec').hidden) cerrarModal(); });

  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => cambiarPanel(t.dataset.panel)));

  setupBuscadorProducto();
  $('btnAnalizar').addEventListener('click', analizar);
  // Cambiar medicion o cavidad solo repinta: los datos ya estan en memoria.
  $('aVariable').addEventListener('change', dibujarAnalisis);
  $('aCavidad').addEventListener('change', dibujarAnalisis);

  if (recuperarSesion()) entrarAlPortal();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
  }
});
