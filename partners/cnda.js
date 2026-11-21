/* =====================================================================
   IEC Partner Portal — the client CNDA signing surface
   (owner-facing). ONE surface for both arrivals: the in-flow
   step on the questionnaire's done screen and the link in the
   issuance email open this same page with the same token.

   The page renders the central IEC CNDA exactly as the central
   signing page does — the legal texts come from the API (which
   serves the mechanically extracted copy of cnda.html's text),
   filled live with the signer's details. IEC's side is already
   signed: the block shows Mohammed Morgan, MD, Founder & CEO,
   with the record's IEC signing date. Fields the registration
   profile genuinely holds arrive pre-filled; the rest are the
   owner's to complete — nothing is invented for him.

   The countersignature posts to the same API action; the
   executed copy is rendered and recorded SERVER-side, and this
   page then shows exactly what was recorded.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = window.PARTNER_PORTAL_LANG === 'es' ? 'es' : 'en';
  var T = {
    en: {
      kicker: 'IEC, Inc. · General CNDA',
      title: 'Sign your IEC CNDA',
      intro: 'This is IEC\u2019s single general CNDA and procuring party agreement — one signing covers every IEC asset and every IEC connection. IEC has already signed its side. The agreement below is pre-filled with your business\u2019s information from your registration; complete the remaining fields and sign to execute.',
      doc_t: 'The agreement',
      doc_p: 'The text below is the complete agreement, filled in live with the details you enter — what you read here is exactly what is executed and recorded.',
      sign_t: 'Complete the agreement and sign',
      f_effective: 'Effective date',
      f_state: 'IEC state of incorporation',
      f_party: 'Counterparty legal name',
      f_entity: 'Counterparty entity type and state',
      f_entity_ph: 'e.g., Massachusetts limited liability company',
      f_address: 'Counterparty principal address',
      f_purpose: 'Purpose',
      f_name: 'Counterparty signer\u2019s printed name',
      f_title: 'Signer title (optional)',
      f_date: 'Signature date',
      f_email: 'Signer email (from your registration)',
      f_signature: 'Typed signature',
      f_signature_ph: 'Type your full legal name',
      agree: 'I agree to sign this General CNDA and Procuring Party Agreement electronically, and I understand my typed signature above is my legal signature.',
      sign_btn: 'Sign agreement',
      signing: 'Signing and recording the executed agreement…',
      fine: 'When you sign and submit, the executed agreement is recorded by IEC, Inc. on your company record, and a confirmation is emailed to you and to IEC at info@iecincglobal.com. This one signing covers all IEC Assets.',
      iec_block_t: 'IEC, Inc. — signed',
      iec_signed_by: 'Pre-signed by IEC',
      iec_name: 'Mohammed Morgan, MD',
      iec_title: 'Founder & CEO, IEC, Inc.',
      signed_t: 'Your CNDA is executed',
      signed_p: 'Your countersignature is recorded, and the agreement stands executed on your company record. IEC will follow up with the next steps directly. The executed copy is below — you can print or save this page for your records.',
      err_invalid: 'This signing link is not active. It may have been replaced by a newer one, or it has expired — IEC can re-issue it; write to info@iecincglobal.com.',
      err_fields: 'Complete every required agreement and signature field before signing.',
      err_agree: 'Please check the box agreeing to sign electronically.',
      err_sigmatch: 'Your typed signature must match the signer\u2019s printed name exactly.',
      err_signer: 'The signing email does not match the registration this CNDA was issued to.',
      err_generic: 'Something went wrong — please try again.',
      loading: 'Loading…'
    },
    es: {
      kicker: 'IEC, Inc. · CNDA General',
      title: 'Firme su CNDA de IEC',
      intro: 'Este es el único Acuerdo General CNDA y de Parte Procuradora de IEC: una sola firma cubre cada activo de IEC y cada conexión de IEC. IEC ya firmó su parte. El acuerdo siguiente viene precompletado con la información de su empresa tomada de su registro; complete los campos restantes y firme para ejecutarlo.',
      doc_t: 'El acuerdo',
      doc_p: 'El texto siguiente es el acuerdo completo, completado en vivo con los datos que usted ingresa: lo que lee aquí es exactamente lo que se ejecuta y se registra.',
      sign_t: 'Complete el acuerdo y firme',
      f_effective: 'Fecha de entrada en vigor',
      f_state: 'Estado de constitución de IEC',
      f_party: 'Nombre legal de la contraparte',
      f_entity: 'Tipo de entidad y estado de la contraparte',
      f_entity_ph: 'p. ej., sociedad de responsabilidad limitada de Massachusetts',
      f_address: 'Dirección principal de la contraparte',
      f_purpose: 'Propósito',
      f_name: 'Nombre impreso del firmante de la contraparte',
      f_title: 'Cargo del firmante (opcional)',
      f_date: 'Fecha de firma',
      f_email: 'Correo del firmante (de su registro)',
      f_signature: 'Firma escrita',
      f_signature_ph: 'Escriba su nombre legal completo',
      agree: 'Acepto firmar electrónicamente este Acuerdo General CNDA y de Parte Procuradora, y entiendo que mi firma escrita arriba es mi firma legal.',
      sign_btn: 'Firmar el acuerdo',
      signing: 'Firmando y registrando el acuerdo ejecutado…',
      fine: 'Al firmar y enviar, IEC, Inc. registra el acuerdo ejecutado en el expediente de su empresa, y se le envía una confirmación a usted y a IEC a info@iecincglobal.com. Esta única firma cubre todos los activos de IEC.',
      iec_block_t: 'IEC, Inc. — firmado',
      iec_signed_by: 'Firmado por IEC',
      iec_name: 'Mohammed Morgan, MD',
      iec_title: 'Fundador y CEO, IEC, Inc.',
      signed_t: 'Su CNDA está ejecutado',
      signed_p: 'Su contrafirma está registrada y el acuerdo queda ejecutado en el expediente de su empresa. IEC le dará seguimiento directamente con los próximos pasos. La copia ejecutada está abajo: puede imprimir o guardar esta página para sus registros.',
      err_invalid: 'Este enlace de firma no está activo. Es posible que haya sido reemplazado por uno más nuevo o que haya vencido: IEC puede volver a emitirlo; escriba a info@iecincglobal.com.',
      err_fields: 'Complete todos los campos obligatorios del acuerdo y de la firma antes de firmar.',
      err_agree: 'Marque la casilla de aceptación de la firma electrónica.',
      err_sigmatch: 'Su firma escrita debe coincidir exactamente con el nombre impreso del firmante.',
      err_signer: 'El correo de firma no coincide con el registro al que se emitió este CNDA.',
      err_generic: 'Algo salió mal: inténtelo de nuevo.',
      loading: 'Cargando…'
    }
  };
  function t(k) { return T[LANG][k] || T.en[k] || k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var root = document.getElementById('pp-root');
  var token = new URLSearchParams(location.search).get('token') || '';
  var FOOT = '<div class="pp-front-foot"><strong>IEC, Inc.</strong> · <a href="https://iecincglobal.com">iecincglobal.com</a> · <a href="mailto:info@iecincglobal.com">info@iecincglobal.com</a></div>';
  function hero() {
    return '<div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('kicker')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('title')) + '</h1></div>';
  }
  function showError(msg) {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><p class="pp-error" style="margin:0">' + esc(msg) + '</p></div>' + FOOT + '</div>';
  }
  function showExecuted(documentHtml, signedInfo) {
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<div class="pp-card"><h1 class="pp-h1">' + esc(t('signed_t')) + '</h1>' +
      '<p class="pp-p">' + esc(t('signed_p')) + '</p>' +
      (signedInfo ? '<p class="pp-p"><strong>' + esc(signedInfo.name || '') + '</strong>' +
        (signedInfo.date ? ' · ' + esc(signedInfo.date) : '') + '</p>' : '') + '</div>' +
      '<iframe class="pp-exec-frame" title="CNDA" srcdoc="' + esc(documentHtml || '') + '"></iframe>' +
      FOOT + '</div>';
  }

  if (!token) { showError(t('err_invalid')); return; }

  fetch('/api/contractors?action=client-cnda&token=' + encodeURIComponent(token), { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
    .then(function (res) {
      if (res.status !== 200 || !res.body || !res.body.ok) { showError(t('err_invalid')); return; }
      var d = res.body;
      if (d.status === 'signed') { showExecuted(d.documentHtml, d.signed); return; }
      renderForm(d);
    })
    .catch(function () { showError(t('err_generic')); });

  function renderForm(d) {
    var texts = d.texts || [];
    var titles = d.titles || [];
    var today = new Date().toISOString().slice(0, 10);
    root.innerHTML = '<div class="pp-qwrap">' + hero() +
      '<p class="pp-front-p" style="max-width:820px;margin:0 auto 18px">' + esc(t('intro')) + '</p>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('doc_t')) + '</h2><p class="pp-p">' + esc(t('doc_p')) + '</p>' +
      '<div class="pp-doc" id="pp-cnda-doc"></div></div>' +
      '<form class="pp-card" id="pp-cnda-form"><h2 class="pp-h2">' + esc(t('sign_t')) + '</h2><div class="pp-sigform">' +
      '<div><label class="pp-label" for="f-effective">' + esc(t('f_effective')) + '</label><input class="pp-input" id="f-effective" type="date" required></div>' +
      '<div><label class="pp-label">' + esc(t('f_state')) + '</label><div class="pp-fact">' + esc(d.defaults.iecState) + '</div></div>' +
      '<div><label class="pp-label" for="f-party">' + esc(t('f_party')) + '</label><input class="pp-input" id="f-party" type="text" autocomplete="organization" required></div>' +
      '<div><label class="pp-label" for="f-entity">' + esc(t('f_entity')) + '</label><input class="pp-input" id="f-entity" type="text" placeholder="' + esc(t('f_entity_ph')) + '" required></div>' +
      '<div class="full"><label class="pp-label" for="f-address">' + esc(t('f_address')) + '</label><input class="pp-input" id="f-address" type="text" autocomplete="street-address" required></div>' +
      '<div class="full"><label class="pp-label" for="f-purpose">' + esc(t('f_purpose')) + '</label><textarea class="pp-input" id="f-purpose" rows="3" required></textarea></div>' +
      '<div><label class="pp-label" for="f-name">' + esc(t('f_name')) + '</label><input class="pp-input" id="f-name" type="text" autocomplete="name" required></div>' +
      '<div><label class="pp-label" for="f-title">' + esc(t('f_title')) + '</label><input class="pp-input" id="f-title" type="text"></div>' +
      '<div><label class="pp-label" for="f-date">' + esc(t('f_date')) + '</label><input class="pp-input" id="f-date" type="date" required></div>' +
      '<div><label class="pp-label">' + esc(t('f_email')) + '</label><div class="pp-fact">' + esc(d.prefill.email) + '</div></div>' +
      '<div class="full"><label class="pp-label" for="f-signature">' + esc(t('f_signature')) + '</label><input class="pp-input" id="f-signature" type="text" placeholder="' + esc(t('f_signature_ph')) + '" required></div>' +
      '<label class="pp-agree full"><input id="f-agree" type="checkbox" required><span>' + esc(t('agree')) + '</span></label>' +
      '<div class="full"><p class="pp-error" id="pp-cnda-error" hidden></p>' +
      '<button class="pp-btn" type="submit" id="pp-cnda-submit">' + esc(t('sign_btn')) + '</button>' +
      '<p class="pp-p" id="pp-cnda-status" style="margin-top:10px"></p>' +
      '<p class="pp-p" style="font-size:13.5px;color:#5B6B85">' + esc(t('fine')) + '</p></div>' +
      '</div></form>' + FOOT + '</div>';

    var F = function (id) { return document.getElementById(id); };
    F('f-effective').value = today;
    F('f-party').value = d.prefill.party || '';
    F('f-purpose').value = d.defaults.purpose || '';
    F('f-name').value = d.prefill.name || '';
    F('f-date').value = today;

    /* Live document render — the same substitution the central
       page performs, plus the execution preview with IEC's
       pre-applied block (typed name + the record's IEC date,
       exactly as the central page shows it). */
    function fill(text, v) {
      var map = {
        '[EFFECTIVE DATE]': v.effectiveDate || '[EFFECTIVE DATE]',
        '[STATE]': v.iecState || '[STATE]',
        '[COUNTERPARTY NAME]': v.party || '[COUNTERPARTY NAME]',
        '[ENTITY TYPE/STATE]': v.entityTypeState || '[ENTITY TYPE/STATE]',
        '[ADDRESS]': v.address || '[ADDRESS]',
        '[PURPOSE]': v.purpose || '[PURPOSE]'
      };
      Object.keys(map).forEach(function (ph) { text = text.split(ph).join(map[ph]); });
      return text;
    }
    function values() {
      return {
        effectiveDate: F('f-effective').value.trim(),
        iecState: d.defaults.iecState,
        party: F('f-party').value.trim(),
        entityTypeState: F('f-entity').value.trim(),
        address: F('f-address').value.trim(),
        purpose: F('f-purpose').value.trim()
      };
    }
    function renderDoc() {
      var v = values();
      var html = '';
      texts.forEach(function (text, i) {
        if (i > 0) html += '<h2>' + esc(titles[i] || '') + '</h2>';
        html += '<p>' + esc(fill(text, v)) + '</p>';
      });
      html += '<div class="sig-grid"><div><h3>' + esc(t('iec_block_t')) + '</h3>' +
        '<p>(' + esc(t('iec_signed_by')) + ')</p>' +
        '<p>Signature: <em>' + esc(d.iec.name) + '</em></p>' +
        '<p>Name: ' + esc(d.iec.name) + '</p><p>Title: ' + esc(d.iec.title) + '</p>' +
        '<p>Date: ' + esc(d.iec.date || '') + '</p></div>' +
        '<div><h3>' + esc(v.party || '—') + '</h3>' +
        '<p>Signature: <em>' + esc(F('f-signature').value.trim() || '—') + '</em></p>' +
        '<p>Name: ' + esc(F('f-name').value.trim() || '—') + '</p>' +
        '<p>Date: ' + esc(F('f-date').value || '—') + '</p></div></div>';
      document.getElementById('pp-cnda-doc').innerHTML = html;
    }
    ['f-effective', 'f-party', 'f-entity', 'f-address', 'f-purpose', 'f-name', 'f-date', 'f-signature'].forEach(function (id) {
      F(id).addEventListener('input', renderDoc);
    });
    renderDoc();

    F('pp-cnda-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = F('pp-cnda-error');
      err.hidden = true;
      if (!F('f-agree').checked) { err.textContent = t('err_agree'); err.hidden = false; return; }
      var v = values();
      var payload = {
        token: token,
        effectiveDate: v.effectiveDate, party: v.party,
        entityTypeState: v.entityTypeState, address: v.address, purpose: v.purpose,
        name: F('f-name').value.trim(), title: F('f-title').value.trim(),
        date: F('f-date').value, signature: F('f-signature').value.trim(),
        email: d.prefill.email, agree: true
      };
      if (!payload.effectiveDate || !payload.party || !payload.entityTypeState || !payload.address ||
          !payload.purpose || !payload.name || !payload.date || !payload.signature) {
        err.textContent = t('err_fields'); err.hidden = false; return;
      }
      var btn = F('pp-cnda-submit');
      btn.disabled = true;
      F('pp-cnda-status').textContent = t('signing');
      fetch('/api/contractors?action=client-cnda-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          btn.disabled = false;
          F('pp-cnda-status').textContent = '';
          if (res.status === 200 && res.body.ok) {
            showExecuted(res.body.documentHtml, { name: payload.name, date: payload.date });
            return;
          }
          var e = (res.body && res.body.error) || '';
          err.textContent = e === 'signature_mismatch' ? t('err_sigmatch')
            : e === 'signer_mismatch' ? t('err_signer')
            : e === 'already_signed' ? t('signed_t')
            : e === 'invalid_link' ? t('err_invalid')
            : (e === 'invalid_fields' || e === 'agreement_required') ? t('err_fields')
            : t('err_generic');
          err.hidden = false;
        })
        .catch(function () {
          btn.disabled = false;
          F('pp-cnda-status').textContent = '';
          err.textContent = t('err_generic');
          err.hidden = false;
        });
    });
  }
})();
