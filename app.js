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
      estado.textContent = 'Se muestran los primeros ' + r.total + ' resultados. Afiná los filtros para ver menos.';
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
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
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
      const ventana = window.open(url, '_blank');
      if (!ventana) toast('El navegador bloqueó la ventana. Permití las ventanas emergentes.', 'error');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
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

// ============ PESTAÑAS ============
function cambiarPanel(idPanel) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('activa', t.dataset.panel === idPanel));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== idPanel; });
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

  if (recuperarSesion()) entrarAlPortal();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
  }
});
