/* =====================================================================
   IEC Partner Portal — the counts-only questionnaire (owner-
   facing), reached from the portal's client landing
   (partners/register.js) with the partner code in the URL and
   the company profile in sessionStorage (the same
   iecPartnerLinkProfile shape the site's form uses).

   The field renderer and answer collector replicate the public
   form's semantics exactly — same question sets (loaded from
   partners/segments-data.js, generated from the approved form),
   same answer strings — so a portal submission is
   indistinguishable in shape from a site submission. Submissions
   post to the same endpoint, which applies the identifier scan,
   the duplicate guard, and the credit/hold routing.

   Every navigation URL produced here is ABSOLUTE (root-
   relative) — the hand-off rule from the link defect.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = window.PARTNER_PORTAL_LANG === 'es' ? 'es' : 'en';
  var PREFIX = LANG === 'es' ? '/es' : '';
  var T = {
    en: {
      kicker: 'IEC, Inc. · Business Data Licensing',
      title: 'Data evaluation questionnaire',
      expl: 'Counts only: IEC reviews totals, distributions, years of history, and the names of the systems you run — never individual records, never customer or patient information. An answer containing an email address, a phone number, or an ID number will be refused and nothing will be saved.',
      segment: 'Business type',
      contact_t: 'Who is submitting?',
      c_name: 'Your name', c_business: 'Business name', c_email: 'Email', c_phone: 'Phone (optional)',
      detail_ph: 'Details / names (where the question asks)',
      submit: 'Submit the questionnaire', sending: 'Sending…',
      err_name: 'Please enter your name so IEC knows who submitted the questionnaire.',
      err_email: 'Please enter a valid email address — that is how IEC follows up with you.',
      err_identifier: 'One of the answers contains an email address, a phone number, or an ID number. Counts only — please remove it and submit again. Nothing was saved.',
      err_duplicate: 'This business is already registered with IEC. A business registers once — IEC will follow up with the registration on record.',
      err_generic: 'Something went wrong — please try again.',
      done_t: 'Thank you — your questionnaire is with IEC',
      done_credited: 'Your company is registered and your questionnaire is in IEC\u2019s review queue. IEC follows up with the next steps directly.',
      done_held: 'IEC has received your registration and questionnaire and will review them directly. IEC follows up with the next steps.',
      done_plain: 'IEC has your questionnaire and will follow up with the next steps directly.',
      need_profile: 'This questionnaire follows the registration step. Please start from the registration page so IEC can connect your answers to your company.'
    },
    es: {
      kicker: 'IEC, Inc. · Licencias de datos comerciales',
      title: 'Cuestionario de evaluación de datos',
      expl: 'Solo conteos: IEC revisa totales, distribuciones, años de historial y los nombres de los sistemas que usted usa — nunca registros individuales, nunca información de clientes o pacientes. Una respuesta con un correo, un teléfono o un número de identificación será rechazada y no se guardará nada.',
      segment: 'Tipo de negocio',
      contact_t: '¿Quién envía el cuestionario?',
      c_name: 'Su nombre', c_business: 'Nombre del negocio', c_email: 'Correo', c_phone: 'Teléfono (opcional)',
      detail_ph: 'Detalles / nombres (donde la pregunta lo pide)',
      submit: 'Enviar el cuestionario', sending: 'Enviando…',
      err_name: 'Ingrese su nombre para que IEC sepa quién envió el cuestionario.',
      err_email: 'Ingrese un correo válido: así es como IEC le dará seguimiento.',
      err_identifier: 'Una de las respuestas contiene un correo, un teléfono o un número de identificación. Solo conteos: quítelo y envíe de nuevo. No se guardó nada.',
      err_duplicate: 'Esta empresa ya está registrada con IEC. Una empresa se registra una vez: IEC dará seguimiento con el registro existente.',
      err_generic: 'Algo salió mal: inténtelo de nuevo.',
      done_t: 'Gracias: su cuestionario está con IEC',
      done_credited: 'Su empresa está registrada y su cuestionario está en la fila de revisión de IEC. IEC le dará seguimiento directamente con los próximos pasos.',
      done_held: 'IEC recibió su registro y su cuestionario y los revisará directamente. IEC le dará seguimiento con los próximos pasos.',
      done_plain: 'IEC tiene su cuestionario y le dará seguimiento directamente con los próximos pasos.',
      need_profile: 'Este cuestionario sigue al paso de registro. Comience desde la página de registro para que IEC pueda conectar sus respuestas con su empresa.'
    }
  };
  function t(k) { return T[LANG][k] || T.en[k] || k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var SEGMENTS = window.IEC_SEGMENTS || {};
  var params = new URLSearchParams(location.search);
  var slugs = Object.keys(SEGMENTS);
  var current = slugs.indexOf(params.get('segment')) >= 0 ? params.get('segment') : 'pharmacy';
  var partnerCode = String(params.get('partner') || '').trim().toUpperCase();
  var profile = null;
  try { profile = JSON.parse(sessionStorage.getItem('iecPartnerLinkProfile') || 'null'); } catch (e) { profile = null; }
  if (!partnerCode && profile && profile.code) partnerCode = String(profile.code).toUpperCase();
  var root = document.getElementById('pp-root');

  /* A link arrival carries its profile from the landing; without
     it (and without a partner code) there is nothing to connect
     the answers to — send the owner back to the registration
     step, absolutely. A direct visit WITH a code but no profile
     (a fresh tab, say) goes back to the landing for that code. */
  if (partnerCode && !profile) {
    location.replace(PREFIX + '/partners/r/' + encodeURIComponent(partnerCode));
    return;
  }

  var segOptions = slugs.map(function (slug) {
    return '<option value="' + esc(slug) + '"' + (slug === current ? ' selected' : '') + '>' + esc(SEGMENTS[slug].title) + '</option>';
  }).join('');
  root.innerHTML =
    '<div class="pp-qwrap"><div class="pp-front-hero"><div class="pp-front-k">' + esc(t('kicker')) + '</div>' +
    '<h1 class="pp-front-h">' + esc(t('title')) + '</h1>' +
    '<p class="pp-front-p">' + esc(t('expl')) + '</p></div>' +
    '<div class="pp-card"><label class="pp-label" for="pp-seg">' + esc(t('segment')) + '</label>' +
    '<select class="pp-input" id="pp-seg" style="max-width:340px">' + segOptions + '</select></div>' +
    '<form id="pp-q-form"><div id="pp-q-sections"></div>' +
    '<div class="pp-card"><h2 class="pp-h2">' + esc(t('contact_t')) + '</h2><div class="pp-form-grid">' +
    '<div><label class="pp-label">' + esc(t('c_name')) + '</label><input class="pp-input" id="pp-c-name"></div>' +
    '<div><label class="pp-label">' + esc(t('c_business')) + '</label><input class="pp-input" id="pp-c-business"></div>' +
    '<div><label class="pp-label">' + esc(t('c_email')) + '</label><input class="pp-input" id="pp-c-email" type="email"></div>' +
    '<div><label class="pp-label">' + esc(t('c_phone')) + '</label><input class="pp-input" id="pp-c-phone"></div>' +
    '</div>' +
    '<input type="text" id="pp-c-website" autocomplete="off" style="display:none" tabindex="-1">' +
    '<p class="pp-error" id="pp-q-error" hidden></p>' +
    '<button class="pp-btn" type="submit" id="pp-q-submit">' + esc(t('submit')) + '</button></div></form></div>';

  if (profile) {
    if (profile.ownerName) document.getElementById('pp-c-name').value = profile.ownerName;
    if (profile.businessName) document.getElementById('pp-c-business').value = profile.businessName;
    if (profile.ownerEmail) document.getElementById('pp-c-email').value = profile.ownerEmail;
  }

  var host = document.getElementById('pp-q-sections');
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  /* Renderer replicated from the approved public form — the
     answer strings a portal submission produces are identical
     in shape to the site form's. */
  function render(slug) {
    host.innerHTML = '';
    SEGMENTS[slug].sections.forEach(function (section) {
      var fs = el('fieldset', 'pp-card pp-qsection');
      var lg = el('legend', 'pp-h2', section.title);
      fs.appendChild(lg);
      section.fields.forEach(function (f) {
        var wrap = el('div', 'qfield');
        wrap.dataset.qid = 'q' + f.n;
        wrap.dataset.label = 'Q' + f.n + '. ' + f.label;
        wrap.dataset.type = f.type;
        var lab = el('label', 'pp-label');
        lab.appendChild(document.createTextNode(f.n + '. ' + f.label));
        wrap.appendChild(lab);
        if (f.type === 'text') {
          var inp = el('input', 'pp-input qval'); inp.type = 'text';
          wrap.appendChild(inp);
        } else if (f.type === 'area') {
          var ta = el('textarea', 'pp-input qval'); ta.rows = 3;
          wrap.appendChild(ta);
        } else if (f.type === 'checks' || f.type === 'choice') {
          var box = el('div', 'pp-qchecks');
          f.options.forEach(function (opt) {
            var l = el('label');
            var i = el('input');
            i.type = f.type === 'checks' ? 'checkbox' : 'radio';
            i.name = 'q' + f.n + '_' + slug;
            i.value = opt;
            l.appendChild(i);
            l.appendChild(document.createTextNode(opt));
            box.appendChild(l);
          });
          wrap.appendChild(box);
          if (f.detail) {
            var d = el('input', 'pp-input qdetail qdetailval pp-qdetail');
            d.type = 'text';
            d.placeholder = t('detail_ph');
            wrap.appendChild(d);
          }
        } else if (f.type === 'fields') {
          var grid = el('div', 'pp-form-grid');
          f.subs.forEach(function (s) {
            var cell = el('div');
            var sl = el('label', 'pp-label', s);
            var si = el('input', 'pp-input qsubval');
            si.type = 'text';
            si.dataset.sub = s;
            cell.appendChild(sl); cell.appendChild(si);
            grid.appendChild(cell);
          });
          wrap.appendChild(grid);
        }
        fs.appendChild(wrap);
      });
      host.appendChild(fs);
    });
  }
  function collectAnswers() {
    var answers = {};
    host.querySelectorAll('.qfield').forEach(function (wrap) {
      var type = wrap.dataset.type;
      var val = '';
      if (type === 'text' || type === 'area') {
        val = wrap.querySelector('.qval').value.trim();
      } else if (type === 'checks') {
        var picked = [];
        wrap.querySelectorAll('input[type=checkbox]:checked').forEach(function (c) { picked.push(c.value); });
        val = picked.join(', ');
        var det = wrap.querySelector('.qdetailval');
        if (det && det.value.trim()) val = (val ? val + ' — ' : '') + det.value.trim();
      } else if (type === 'choice') {
        var r = wrap.querySelector('input[type=radio]:checked');
        val = r ? r.value : '';
        var det2 = wrap.querySelector('.qdetailval');
        if (det2 && det2.value.trim()) val = (val ? val + ' — ' : '') + det2.value.trim();
      } else if (type === 'fields') {
        var parts = [];
        wrap.querySelectorAll('.qsubval').forEach(function (si) {
          if (si.value.trim()) parts.push(si.dataset.sub + ': ' + si.value.trim());
        });
        val = parts.join(' · ');
      }
      if (val) answers[wrap.dataset.label] = val;
    });
    return answers;
  }
  render(current);
  document.getElementById('pp-seg').addEventListener('change', function (ev) {
    current = ev.target.value;
    var u = new URL(location.href);
    u.searchParams.set('segment', current);
    history.replaceState(null, '', u);
    render(current);
  });

  function showDone(kind) {
    try { sessionStorage.removeItem('iecPartnerLinkProfile'); } catch (e) {}
    var msg = kind === 'credited' ? t('done_credited') : kind === 'held' ? t('done_held') : t('done_plain');
    root.innerHTML = '<div class="pp-qwrap"><div class="pp-card"><h1 class="pp-h1">' + esc(t('done_t')) + '</h1>' +
      '<p class="pp-p">' + esc(msg) + '</p></div></div>';
  }
  document.getElementById('pp-q-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = document.getElementById('pp-q-error');
    err.hidden = true;
    var name = document.getElementById('pp-c-name').value.trim();
    var email = document.getElementById('pp-c-email').value.trim();
    if (!name) { err.textContent = t('err_name'); err.hidden = false; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = t('err_email'); err.hidden = false; return; }
    var btn = document.getElementById('pp-q-submit');
    btn.disabled = true;
    btn.textContent = t('sending');
    var payload = {
      segment: current,
      contact: {
        name: name,
        business: document.getElementById('pp-c-business').value.trim(),
        email: email,
        phone: document.getElementById('pp-c-phone').value.trim()
      },
      answers: collectAnswers(),
      company_website: document.getElementById('pp-c-website').value,
      partnerCode: partnerCode || undefined,
      partnerProfile: profile ? {
        businessName: profile.businessName || '',
        city: profile.city || '',
        state: profile.state || ''
      } : undefined
    };
    fetch('/api/questionnaire-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = t('submit');
        if (res.status === 200 && res.body.ok) {
          var st = res.body.attribution && res.body.attribution.status;
          showDone(st === 'credited' ? 'credited' : st === 'held' ? 'held' : 'plain');
          return;
        }
        var e = (res.body && res.body.error) || '';
        err.textContent = e === 'identifier_content' ? t('err_identifier')
          : e === 'already_registered' ? t('err_duplicate')
          : t('err_generic');
        err.hidden = false;
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = t('submit');
        err.textContent = t('err_generic');
        err.hidden = false;
      });
  });
})();
