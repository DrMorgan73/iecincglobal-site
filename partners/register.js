/* =====================================================================
   IEC Partner Portal — the client landing for a partner's client
   link (…/r/<code> on the portal host, /partners/r/<code> in the
   site preview). Owner-facing: IEC-branded, the licensing
   explainer, and the short company profile that hands off to the
   counts-only questionnaire.

   THE HAND-OFF RULE (the defect this page exists to fix): every
   navigation URL produced here is ABSOLUTE (root-relative). The
   legacy landing navigated with a relative URL from a rewritten
   /r/<code> address, which resolved right back into the rewrite
   and destroyed the registration. The build suite carries a
   regression test that resolves this page's hand-off URL against
   the /r/<code> address and walks it through the site's rewrites.

   Attribution states come from the API: an ACTIVE partner is
   named; a paused or revoked partner is NOT named and the form
   still works — the submission is accepted and held for IEC's
   review, exactly as designed. An unknown code shows the invalid
   notice and no form.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = window.PARTNER_PORTAL_LANG === 'es' ? 'es' : 'en';
  var PREFIX = LANG === 'es' ? '/es' : '';
  var T = {
    en: {
      kicker: 'IEC, Inc. · Business Data Licensing',
      title: 'Your business data may be worth licensing',
      invited_by: 'You were invited by {name} ({company}), an IEC partner.',
      intro: 'IEC, Inc. helps business owners license their operational data to buyers who build with it. A license is not a sale: you keep full ownership of your data, the license covers defined uses for a defined term, and nothing moves without an agreement you sign.',
      range: 'Approved licensing programs in this market range from $100,000 to $5,000,000 per term. The owner\u2019s share of any license IEC closes on your data is 80%, paid when the buyer pays.',
      counts: 'The first step is a short questionnaire — counts only. IEC reviews totals, years of history, and the names of the systems you run. No individual records, no customer or patient information, ever.',
      form_t: 'Register your company',
      form_p: 'Tell IEC which company is registering. The questionnaire follows on the next screen; it takes a few minutes and asks for counts only.',
      f_business: 'Business legal name', f_owner: 'Owner contact name', f_email: 'Owner contact email',
      f_city: 'Business city', f_state: 'State', f_industry: 'What kind of business is it?',
      continue: 'Continue to the questionnaire',
      err_fields: 'Please complete the business legal name, the owner contact name, and a valid owner email — IEC needs them to register your company.',
      invalid_t: 'This link is not active',
      invalid_p: 'The link you opened does not match an IEC partner record, so nothing can be registered through it. If an IEC partner sent you this link, please ask them to check it — or write to info@iecincglobal.com and IEC will help directly.',
      loading: 'Loading…',
      ind_home_health: 'Home health', ind_physical_therapy: 'Physical therapy', ind_medical_practice: 'Medical practice',
      ind_pharmacy: 'Pharmacy', ind_gas_convenience: 'Gas / convenience', ind_general_business: 'General business'
    },
    es: {
      kicker: 'IEC, Inc. · Licencias de datos comerciales',
      title: 'Los datos de su negocio pueden valer una licencia',
      invited_by: 'Fue invitado por {name} ({company}), socio de IEC.',
      intro: 'IEC, Inc. ayuda a propietarios de negocios a licenciar sus datos operativos a compradores que los utilizan. Una licencia no es una venta: usted conserva la propiedad total de sus datos, la licencia cubre usos definidos por un plazo definido, y nada se mueve sin un acuerdo firmado por usted.',
      range: 'Los programas de licencia aprobados en este mercado van de $100,000 a $5,000,000 por plazo. La parte del propietario de cualquier licencia que IEC cierre sobre sus datos es el 80%, pagada cuando el comprador paga.',
      counts: 'El primer paso es un cuestionario breve: solo conteos. IEC revisa totales, años de historial y los nombres de los sistemas que usted usa. Nunca registros individuales, nunca información de clientes o pacientes.',
      form_t: 'Registre su empresa',
      form_p: 'Diga a IEC qué empresa se registra. El cuestionario sigue en la pantalla siguiente; toma unos minutos y pide solo conteos.',
      f_business: 'Nombre legal de la empresa', f_owner: 'Nombre del contacto propietario', f_email: 'Correo del contacto propietario',
      f_city: 'Ciudad del negocio', f_state: 'Estado', f_industry: '¿Qué tipo de negocio es?',
      continue: 'Continuar al cuestionario',
      err_fields: 'Complete el nombre legal de la empresa, el nombre del contacto propietario y un correo válido: IEC los necesita para registrar su empresa.',
      invalid_t: 'Este enlace no está activo',
      invalid_p: 'El enlace que abrió no coincide con un registro de socio de IEC, por lo que no puede registrarse nada a través de él. Si un socio de IEC le envió este enlace, pídale que lo revise, o escriba a info@iecincglobal.com y IEC le ayudará directamente.',
      loading: 'Cargando…',
      ind_home_health: 'Salud en el hogar', ind_physical_therapy: 'Fisioterapia', ind_medical_practice: 'Práctica médica',
      ind_pharmacy: 'Farmacia', ind_gas_convenience: 'Gasolinera / tienda', ind_general_business: 'Negocio general'
    }
  };
  function t(k, vars) {
    var s = T[LANG][k] || T.en[k] || k;
    if (vars) for (var key in vars) s = s.replace('{' + key + '}', vars[key]);
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var SEGMENT_BY_INDUSTRY = {
    'home-health': 'home-health', 'physical-therapy': 'pt', 'medical-practice': 'medical-practice',
    'pharmacy': 'pharmacy', 'gas-convenience': 'gas-convenience', 'general-business': 'general-business'
  };
  var INDUSTRIES = Object.keys(SEGMENT_BY_INDUSTRY);
  var root = document.getElementById('pp-root');
  var params = new URLSearchParams(location.search);
  var code = String(params.get('code') || '').trim().toUpperCase();
  if (!code) {
    var m = location.pathname.match(/\/r\/([A-Za-z0-9]+)/);
    if (m) code = m[1].toUpperCase();
  }
  function hero(sub) {
    return '<div class="pp-front"><div class="pp-front-hero"><div class="pp-front-k">' + esc(t('kicker')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('title')) + '</h1>' + (sub || '') + '</div>';
  }
  function showInvalid() {
    root.innerHTML = hero() + '<div class="pp-card" style="max-width:760px;margin:0 auto"><h2 class="pp-h2">' +
      esc(t('invalid_t')) + '</h2><p class="pp-p">' + esc(t('invalid_p')) + '</p></div></div>';
  }
  function showForm(partner) {
    var invited = partner
      ? '<p class="pp-front-p">' + esc(t('invited_by', { name: partner.name, company: partner.company || '' })) + '</p>'
      : '';
    var indOpts = INDUSTRIES.map(function (i) {
      return '<option value="' + i + '">' + esc(t('ind_' + i.replace(/-/g, '_'))) + '</option>';
    }).join('');
    root.innerHTML = hero(invited) +
      '<div class="pp-card" style="max-width:760px;margin:0 auto">' +
      '<p class="pp-p">' + esc(t('intro')) + '</p>' +
      '<p class="pp-p">' + esc(t('range')) + '</p>' +
      '<p class="pp-p">' + esc(t('counts')) + '</p>' +
      '<h2 class="pp-h2">' + esc(t('form_t')) + '</h2><p class="pp-p">' + esc(t('form_p')) + '</p>' +
      '<form id="pp-reg-form"><div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('f_business')) + '</label><input class="pp-input" id="pp-r-business" required></div>' +
      '<div><label class="pp-label">' + esc(t('f_owner')) + '</label><input class="pp-input" id="pp-r-owner" required></div>' +
      '<div><label class="pp-label">' + esc(t('f_email')) + '</label><input class="pp-input" id="pp-r-email" type="email" required></div>' +
      '<div><label class="pp-label">' + esc(t('f_industry')) + '</label><select class="pp-input" id="pp-r-industry">' + indOpts + '</select></div>' +
      '<div><label class="pp-label">' + esc(t('f_city')) + '</label><input class="pp-input" id="pp-r-city"></div>' +
      '<div><label class="pp-label">' + esc(t('f_state')) + '</label><input class="pp-input" id="pp-r-state"></div>' +
      '</div><p class="pp-error" id="pp-r-error" hidden>' + esc(t('err_fields')) + '</p>' +
      '<button class="pp-btn" type="submit">' + esc(t('continue')) + '</button></form>' +
      '</div></div>';
    document.getElementById('pp-reg-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var business = document.getElementById('pp-r-business').value.trim();
      var owner = document.getElementById('pp-r-owner').value.trim();
      var email = document.getElementById('pp-r-email').value.trim();
      var industry = document.getElementById('pp-r-industry').value;
      var err = document.getElementById('pp-r-error');
      if (!business || !owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.hidden = false; return; }
      err.hidden = true;
      var profile = {
        code: code, businessName: business, industry: industry,
        ownerName: owner, ownerEmail: email,
        city: document.getElementById('pp-r-city').value.trim(),
        state: document.getElementById('pp-r-state').value.trim()
      };
      try { sessionStorage.setItem('iecPartnerLinkProfile', JSON.stringify(profile)); } catch (e) { /* the code also travels in the URL */ }
      var slug = SEGMENT_BY_INDUSTRY[industry] || 'general-business';
      /* ABSOLUTE hand-off — see the header note. Never relative. */
      location.href = PREFIX + '/partners/questionnaire.html?segment=' + encodeURIComponent(slug) +
        '&partner=' + encodeURIComponent(code);
    });
  }
  if (!code) { showInvalid(); return; }
  root.innerHTML = hero() + '<p class="pp-sub" style="text-align:center">' + esc(t('loading')) + '</p></div>';
  fetch('/api/contractors?action=partner-link&code=' + encodeURIComponent(code), { credentials: 'same-origin' })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
    .then(function (res) {
      if (res.status !== 200 || !res.body || !res.body.ok) { showInvalid(); return; }
      showForm(res.body.partner || null);
    })
    .catch(function () { showInvalid(); });
})();
