/* =====================================================================
   IEC Partner Portal — SIGN FROM LINK (Nov 25, 2026).
   DrMorgan's order: "either they can sign from link or I can
   send invitation." This page is the link door: identity ->
   CNDA signed in full -> Contractor Referral Agreement accepted
   in full -> the activation link is emailed. The invitation
   door (Desk send-invitation) is unchanged; both doors end at
   the same activation gate — nothing opens until BOTH
   signatures stand.

   The page holds a 24h single-purpose signing token from
   sign-start. It authorizes only the two signing steps for
   this one record; the activation link travels by email only
   (mailbox ownership). A partner who was invited by another
   partner arrives at /join/<code>, which lands here with the
   invite code carried into sign-start (attribution preserved).

   The legal texts come from the API: the CNDA sections filled
   with the signer's record values, and the agreement's own
   HTML — what is read here is exactly what is signed.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = window.PARTNER_PORTAL_LANG === 'es' ? 'es' : 'en';
  var T = {
    en: {
      kicker: 'IEC, Inc. · Partner Portal',
      title: 'Sign and join the IEC Partner Portal',
      intro: 'Sign IEC\u2019s two partner instruments here — the confidentiality agreement (CNDA) and the Contractor Referral Agreement — and your portal account is created. Your personal activation link is then emailed to you.',
      invited_by: 'You were invited by {name} ({company}).',
      step1_t: 'Step 1 of 3 — Your information',
      step1_p: 'Tell us who is signing. These details fill your agreements.',
      f_name: 'Full legal name',
      f_company: 'Company / business name',
      f_email: 'Email',
      f_phone: 'Phone',
      f_type: 'Type of business',
      f_street: 'Street address',
      f_city: 'City',
      f_state: 'State',
      f_zip: 'ZIP',
      f_website: 'Website',
      f_heard: 'How did you hear about IEC?',
      f_notes: 'Anything else we should know?',
      continue_btn: 'Continue to the agreements',
      starting: 'Preparing your agreements…',
      step2_t: 'Step 2 of 3 — Confidentiality Agreement (CNDA)',
      step2_p: 'Read the complete agreement below — it is filled with your information. Sign it by typing your full legal name.',
      step3_t: 'Step 3 of 3 — Contractor Referral Agreement',
      step3_p: 'Read the complete agreement below, including the referral fee schedule in Exhibit A. Accept it by typing your full legal name.',
      signing_as: 'Signing as: {name} ({company})',
      already_signed: 'This instrument is already signed on your record.',
      f_typed: 'Type your full legal name to sign',
      f_typed_ph: 'Your full legal name',
      agree_cnda: 'I agree to sign this General CNDA and Procuring Party Agreement electronically, and I understand my typed name above is my legal signature.',
      agree_agr: 'I accept this Contractor Referral Agreement, and I understand my typed name above is my legal signature.',
      sign_btn: 'Sign',
      accept_btn: 'Accept and sign',
      signing: 'Recording your signature…',
      done_t: 'Your signatures are recorded',
      done_p: 'Both instruments are signed on your record. We have emailed your personal activation link — open it to enter your portal: your dashboard, your client registrations, and your pipeline. The link is yours alone; please do not forward it. It stays valid for 7 days.',
      done_p2: 'If the email does not arrive within a few minutes, check your spam folder — or write to info@iecincglobal.com.',
      err_fields: 'Complete every required field before continuing.',
      err_dup: 'This email is already registered with the IEC partner program. If that is you, write to info@iecincglobal.com and we will take it from there.',
      err_rate: 'Too many attempts for now — wait a little and try again, or write to info@iecincglobal.com.',
      err_name: 'Type your full legal name exactly as it appears on your record.',
      err_agree: 'Please check the box agreeing to sign electronically.',
      err_token: 'This signing session has ended. Start again from Step 1 — your record is kept and you will resume where you left off.',
      err_email: 'Your signatures are recorded, but the activation email could not be sent just now. Press the button again to retry, or write to info@iecincglobal.com.',
      err_generic: 'Something went wrong — please try again.',
      retry_btn: 'Send my activation link',
      loading: 'Loading…'
    },
    es: {
      kicker: 'IEC, Inc. · Portal de Socios',
      title: 'Firme y únase al Portal de Socios de IEC',
      intro: 'Firme aquí los dos instrumentos de socio de IEC — el acuerdo de confidencialidad (CNDA) y el Acuerdo de Referencia de Contratista — y su cuenta del portal quedará creada. Luego le enviaremos por correo su enlace personal de activación.',
      invited_by: 'Fue invitado por {name} ({company}).',
      step1_t: 'Paso 1 de 3 — Su información',
      step1_p: 'Díganos quién firma. Estos datos completan sus acuerdos.',
      f_name: 'Nombre legal completo',
      f_company: 'Nombre de la empresa / negocio',
      f_email: 'Correo electrónico',
      f_phone: 'Teléfono',
      f_type: 'Tipo de negocio',
      f_street: 'Dirección',
      f_city: 'Ciudad',
      f_state: 'Estado',
      f_zip: 'Código postal',
      f_website: 'Sitio web',
      f_heard: '¿Cómo supo de IEC?',
      f_notes: '¿Algo más que debamos saber?',
      continue_btn: 'Continuar a los acuerdos',
      starting: 'Preparando sus acuerdos…',
      step2_t: 'Paso 2 de 3 — Acuerdo de Confidencialidad (CNDA)',
      step2_p: 'Lea el acuerdo completo a continuación: viene completado con su información. Fírmelo escribiendo su nombre legal completo.',
      step3_t: 'Paso 3 de 3 — Acuerdo de Referencia de Contratista',
      step3_p: 'Lea el acuerdo completo a continuación, incluida la tabla de tarifas de referencia del Anexo A. Acéptelo escribiendo su nombre legal completo.',
      signing_as: 'Firmando como: {name} ({company})',
      already_signed: 'Este instrumento ya está firmado en su expediente.',
      f_typed: 'Escriba su nombre legal completo para firmar',
      f_typed_ph: 'Su nombre legal completo',
      agree_cnda: 'Acepto firmar electrónicamente este Acuerdo General CNDA y de Parte Procuradora, y entiendo que mi nombre escrito arriba es mi firma legal.',
      agree_agr: 'Acepto este Acuerdo de Referencia de Contratista, y entiendo que mi nombre escrito arriba es mi firma legal.',
      sign_btn: 'Firmar',
      accept_btn: 'Aceptar y firmar',
      signing: 'Registrando su firma…',
      done_t: 'Sus firmas están registradas',
      done_p: 'Ambos instrumentos están firmados en su expediente. Le enviamos por correo su enlace personal de activación: ábralo para entrar a su portal: su panel, sus registros de clientes y su cartera. El enlace es solo suyo; por favor no lo reenvíe. Es válido por 7 días.',
      done_p2: 'Si el correo no llega en unos minutos, revise su carpeta de correo no deseado, o escriba a info@iecincglobal.com.',
      err_fields: 'Complete todos los campos obligatorios antes de continuar.',
      err_dup: 'Este correo ya está registrado en el programa de socios de IEC. Si es usted, escriba a info@iecincglobal.com y nosotros nos encargamos.',
      err_rate: 'Demasiados intentos por ahora: espere un poco e inténtelo de nuevo, o escriba a info@iecincglobal.com.',
      err_name: 'Escriba su nombre legal completo exactamente como aparece en su expediente.',
      err_agree: 'Marque la casilla de aceptación de la firma electrónica.',
      err_token: 'Esta sesión de firma terminó. Comience de nuevo desde el Paso 1: su expediente se conserva y continuará donde quedó.',
      err_email: 'Sus firmas están registradas, pero el correo de activación no pudo enviarse en este momento. Pulse el botón de nuevo para reintentarlo, o escriba a info@iecincglobal.com.',
      err_generic: 'Algo salió mal: inténtelo de nuevo.',
      retry_btn: 'Enviar mi enlace de activación',
      loading: 'Cargando…'
    }
  };
  function t(k) { return T[LANG][k] || T.en[k] || k; }
  function tf(k, vars) {
    var s = t(k);
    Object.keys(vars || {}).forEach(function (key) { s = s.split('{' + key + '}').join(vars[key]); });
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var root = document.getElementById('pp-root');
  var FOOT = '<div class="pp-front-foot"><strong>IEC, Inc.</strong> · <a href="https://iecincglobal.com">iecincglobal.com</a> · <a href="mailto:info@iecincglobal.com">info@iecincglobal.com</a></div>';
  function hero() {
    return '<div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('kicker')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('title')) + '</h1></div>';
  }
  function showError(msg) {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><p class="pp-error" style="margin:0">' + esc(msg) + '</p></div>' + FOOT + '</div>';
  }
  function api(action, opts) {
    opts = opts || {};
    var url = '/api/contractors?action=' + encodeURIComponent(action);
    if (opts.token) url += '&token=' + encodeURIComponent(opts.token);
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' } };
    if (opts.body) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    });
  }

  /* The invite code: /join/<code> in the path, or ?code= on the
     sign link itself. */
  var inviteCode = '';
  var joinMatch = /\/join\/([^/?#]+)/.exec(location.pathname || '');
  if (joinMatch) { try { inviteCode = decodeURIComponent(joinMatch[1]); } catch (e) { inviteCode = joinMatch[1]; } }
  if (!inviteCode) inviteCode = new URLSearchParams(location.search).get('code') || '';

  var state = { token: '', contractor: null };

  /* ---- Step 1: identity ---- */
  function renderIdentity(inviterName) {
    var typeOpts = ['Data network introductions', 'Clinical services', 'Consulting', 'Business services', 'Other']
      .map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<p class="pp-front-p" style="max-width:820px;margin:0 auto 18px">' + esc(t('intro')) + '</p>' +
      (inviterName ? '<p class="pp-front-p" style="max-width:820px;margin:0 auto 18px"><strong>' + esc(inviterName) + '</strong></p>' : '') +
      '<form class="pp-card" id="pp-sign-form"><h2 class="pp-h2">' + esc(t('step1_t')) + '</h2>' +
      '<p class="pp-p">' + esc(t('step1_p')) + '</p><div class="pp-form-grid">' +
      '<div><label class="pp-label" for="sg-name">' + esc(t('f_name')) + '</label><input class="pp-input" id="sg-name" autocomplete="name" required></div>' +
      '<div><label class="pp-label" for="sg-company">' + esc(t('f_company')) + '</label><input class="pp-input" id="sg-company" autocomplete="organization" required></div>' +
      '<div><label class="pp-label" for="sg-email">' + esc(t('f_email')) + '</label><input class="pp-input" id="sg-email" type="email" autocomplete="email" required></div>' +
      '<div><label class="pp-label" for="sg-phone">' + esc(t('f_phone')) + '</label><input class="pp-input" id="sg-phone" autocomplete="tel" required></div>' +
      '<div><label class="pp-label" for="sg-type">' + esc(t('f_type')) + '</label><select class="pp-input" id="sg-type">' + typeOpts + '</select></div>' +
      '<div><label class="pp-label" for="sg-street">' + esc(t('f_street')) + '</label><input class="pp-input" id="sg-street" autocomplete="street-address"></div>' +
      '<div><label class="pp-label" for="sg-city">' + esc(t('f_city')) + '</label><input class="pp-input" id="sg-city" autocomplete="address-level2"></div>' +
      '<div><label class="pp-label" for="sg-state">' + esc(t('f_state')) + '</label><input class="pp-input" id="sg-state" autocomplete="address-level1"></div>' +
      '<div><label class="pp-label" for="sg-zip">' + esc(t('f_zip')) + '</label><input class="pp-input" id="sg-zip" autocomplete="postal-code"></div>' +
      '<div><label class="pp-label" for="sg-website">' + esc(t('f_website')) + '</label><input class="pp-input" id="sg-website"></div>' +
      '<div><label class="pp-label" for="sg-heard">' + esc(t('f_heard')) + '</label><input class="pp-input" id="sg-heard"></div>' +
      '</div><div><label class="pp-label" for="sg-notes">' + esc(t('f_notes')) + '</label><textarea class="pp-input" id="sg-notes" rows="3"></textarea></div>' +
      '<input type="text" id="sg-hp" autocomplete="off" style="display:none" tabindex="-1">' +
      '<p class="pp-error" id="sg-error" hidden></p>' +
      '<button class="pp-btn" type="submit" id="sg-submit">' + esc(t('continue_btn')) + '</button>' +
      '</form>' + FOOT + '</div>';

    var form = document.getElementById('pp-sign-form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = document.getElementById('sg-error');
      var btn = document.getElementById('sg-submit');
      err.hidden = true;
      btn.disabled = true; btn.textContent = t('starting');
      var val = function (id) { return document.getElementById(id).value; };
      api('sign-start', { body: {
        name: val('sg-name'), company: val('sg-company'), email: val('sg-email'),
        phone: val('sg-phone'), contractorType: val('sg-type'),
        street: val('sg-street'), city: val('sg-city'), state: val('sg-state'), zip: val('sg-zip'),
        website: val('sg-website'), heardAbout: val('sg-heard'), notes: val('sg-notes'),
        company_site_hp: val('sg-hp'),
        inviteCode: inviteCode || undefined
      } }).then(function (res) {
        btn.disabled = false; btn.textContent = t('continue_btn');
        if (res.status === 200 && res.body && res.body.ok && res.body.token) {
          state.token = res.body.token;
          state.contractor = res.body.contractor || null;
          if (res.body.next === 'agreement') renderAgreement();
          else if (res.body.next === 'complete') complete();
          else renderCnda();
          return;
        }
        var e = res.body && res.body.error;
        err.textContent = e === 'already_registered' ? t('err_dup')
          : e === 'rate_limited' ? t('err_rate')
          : e === 'invalid_fields' ? t('err_fields') : t('err_generic');
        err.hidden = false;
      }).catch(function () {
        btn.disabled = false; btn.textContent = t('continue_btn');
        err.textContent = t('err_generic'); err.hidden = false;
      });
    });
  }

  function signingAsLine() {
    if (!state.contractor) return '';
    return '<p class="pp-p"><strong>' + esc(tf('signing_as', {
      name: state.contractor.name || '', company: state.contractor.company || ''
    })) + '</strong></p>';
  }

  /* ---- Step 2: the CNDA ---- */
  function renderCnda() {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><p class="pp-p">' + esc(t('loading')) + '</p></div>' + FOOT + '</div>';
    api('sign-cnda', { token: state.token }).then(function (res) {
      if (res.status !== 200 || !res.body || !res.body.ok) { showError(t('err_token')); return; }
      var d = res.body;
      if (d.contractor) state.contractor = d.contractor;
      var docHtml = (d.sections || []).map(function (s, i) {
        return (i === 0 ? '' : '<h2>' + esc(s.title) + '</h2>') + '<p>' + esc(s.text) + '</p>';
      }).join('');
      var signed = d.ndaStatus === 'signed';
      root.innerHTML = '<div class="pp-qwrap">' + hero() +
        '<div class="pp-card"><h2 class="pp-h2">' + esc(t('step2_t')) + '</h2>' +
        '<p class="pp-p">' + esc(t('step2_p')) + '</p>' + signingAsLine() +
        '<div class="pp-doc">' + docHtml + '</div></div>' +
        (signed
          ? '<div class="pp-card"><p class="pp-ok" style="margin:0">' + esc(t('already_signed')) + '</p></div>'
          : '<form class="pp-card" id="pp-cnda-sign-form"><div class="pp-sigform">' +
            '<div class="full"><label class="pp-label" for="sg-typed">' + esc(t('f_typed')) + '</label>' +
            '<input class="pp-input" id="sg-typed" type="text" autocomplete="name" placeholder="' + esc(t('f_typed_ph')) + '" required></div>' +
            '<label class="pp-agree full"><input id="sg-agree" type="checkbox" required><span>' + esc(t('agree_cnda')) + '</span></label>' +
            '<div class="full"><p class="pp-error" id="sg-error" hidden></p>' +
            '<button class="pp-btn" type="submit" id="sg-submit">' + esc(t('sign_btn')) + '</button></div>' +
            '</div></form>') +
        FOOT + '</div>';
      if (signed) { renderAgreement(); return; }
      document.getElementById('pp-cnda-sign-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var err = document.getElementById('sg-error');
        var btn = document.getElementById('sg-submit');
        err.hidden = true;
        if (!document.getElementById('sg-agree').checked) { err.textContent = t('err_agree'); err.hidden = false; return; }
        btn.disabled = true; btn.textContent = t('signing');
        api('sign-cnda', { body: {
          token: state.token,
          typedName: document.getElementById('sg-typed').value,
          accept: true
        } }).then(function (r2) {
          btn.disabled = false; btn.textContent = t('sign_btn');
          if (r2.status === 200 && r2.body && r2.body.ok) {
            if (r2.body.next === 'complete') complete(); else renderAgreement();
            return;
          }
          var e = r2.body && r2.body.error;
          err.textContent = e === 'name_mismatch' ? t('err_name')
            : e === 'invalid_token' ? t('err_token')
            : e === 'invalid_fields' ? t('err_fields') : t('err_generic');
          err.hidden = false;
        }).catch(function () {
          btn.disabled = false; btn.textContent = t('sign_btn');
          err.textContent = t('err_generic'); err.hidden = false;
        });
      });
    }).catch(function () { showError(t('err_generic')); });
  }

  /* ---- Step 3: the Contractor Referral Agreement ---- */
  function renderAgreement() {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><p class="pp-p">' + esc(t('loading')) + '</p></div>' + FOOT + '</div>';
    api('sign-agreement', { token: state.token }).then(function (res) {
      if (res.status !== 200 || !res.body || !res.body.ok) { showError(t('err_token')); return; }
      var d = res.body;
      if (d.contractor) state.contractor = d.contractor;
      var signed = d.agreementStatus === 'signed';
      root.innerHTML = '<div class="pp-qwrap">' + hero() +
        '<div class="pp-card"><h2 class="pp-h2">' + esc(t('step3_t')) + '</h2>' +
        '<p class="pp-p">' + esc(t('step3_p')) + '</p>' + signingAsLine() +
        '<div class="pp-doc"><div class="pp-agreement">' + (d.html || '') + '</div></div></div>' +
        (signed
          ? '<div class="pp-card"><p class="pp-ok" style="margin:0">' + esc(t('already_signed')) + '</p></div>'
          : '<form class="pp-card" id="pp-agr-sign-form"><div class="pp-sigform">' +
            '<div class="full"><label class="pp-label" for="sg-typed">' + esc(t('f_typed')) + '</label>' +
            '<input class="pp-input" id="sg-typed" type="text" autocomplete="name" placeholder="' + esc(t('f_typed_ph')) + '" required></div>' +
            '<label class="pp-agree full"><input id="sg-agree" type="checkbox" required><span>' + esc(t('agree_agr')) + '</span></label>' +
            '<div class="full"><p class="pp-error" id="sg-error" hidden></p>' +
            '<button class="pp-btn" type="submit" id="sg-submit">' + esc(t('accept_btn')) + '</button></div>' +
            '</div></form>') +
        FOOT + '</div>';
      if (signed) { complete(); return; }
      document.getElementById('pp-agr-sign-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var err = document.getElementById('sg-error');
        var btn = document.getElementById('sg-submit');
        err.hidden = true;
        if (!document.getElementById('sg-agree').checked) { err.textContent = t('err_agree'); err.hidden = false; return; }
        btn.disabled = true; btn.textContent = t('signing');
        api('sign-agreement', { body: {
          token: state.token,
          typedName: document.getElementById('sg-typed').value,
          accept: true
        } }).then(function (r2) {
          btn.disabled = false; btn.textContent = t('accept_btn');
          if (r2.status === 200 && r2.body && r2.body.ok) {
            if (r2.body.next === 'cnda') renderCnda(); else complete();
            return;
          }
          var e = r2.body && r2.body.error;
          err.textContent = e === 'name_mismatch' ? t('err_name')
            : e === 'invalid_token' ? t('err_token')
            : e === 'invalid_fields' ? t('err_fields') : t('err_generic');
          err.hidden = false;
        }).catch(function () {
          btn.disabled = false; btn.textContent = t('accept_btn');
          err.textContent = t('err_generic'); err.hidden = false;
        });
      });
    }).catch(function () { showError(t('err_generic')); });
  }

  /* ---- Completion: the activation link is emailed ---- */
  function complete() {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><p class="pp-p">' + esc(t('loading')) + '</p></div>' + FOOT + '</div>';
    api('sign-complete', { body: { token: state.token } }).then(function (res) {
      if (res.status === 200 && res.body && res.body.ok) {
        root.innerHTML = '<div class="pp-qwrap">' + hero() +
          '<div class="pp-card"><h1 class="pp-h1">' + esc(t('done_t')) + '</h1>' +
          '<p class="pp-p">' + esc(t('done_p')) + '</p>' +
          '<p class="pp-p">' + esc(t('done_p2')) + '</p></div>' + FOOT + '</div>';
        return;
      }
      if (res.body && res.body.error === 'signatures_pending') {
        if (res.body.next === 'cnda') renderCnda(); else renderAgreement();
        return;
      }
      if (res.body && res.body.error === 'invalid_token') { showError(t('err_token')); return; }
      /* The email could not go out: the signing token is still
         alive server-side, so offer the retry. */
      root.innerHTML = '<div class="pp-qwrap">' + hero() +
        '<div class="pp-card"><p class="pp-error">' + esc(t('err_email')) + '</p>' +
        '<button class="pp-btn" id="sg-retry" type="button">' + esc(t('retry_btn')) + '</button></div>' + FOOT + '</div>';
      document.getElementById('sg-retry').addEventListener('click', complete);
    }).catch(function () { showError(t('err_generic')); });
  }

  /* Boot: name the inviter when the link carries a partner
     invite code (the same resolution the join page used), then
     Step 1. */
  if (inviteCode) {
    fetch('/api/contractors?action=resolve-invite&code=' + encodeURIComponent(inviteCode), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        var line = '';
        if (j && j.ok && j.partner) line = tf('invited_by', { name: j.partner.name || '', company: j.partner.company || '' });
        renderIdentity(line);
      })
      .catch(function () { renderIdentity(''); });
  } else {
    renderIdentity('');
  }
})();
