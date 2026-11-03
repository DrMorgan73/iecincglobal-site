/* IEC, Inc. — embedded mutual NDA (guided review + execution flow).
   Ported 2026-11-03 from the proven MEDEXEC/CURAVIA website flows
   (same instrument, same server pipeline: POST
   https://app.getmedexec.com/api/nda/submit with product "iec").
   The signing is recorded server-side BEFORE delivery; the executed
   PDF is emailed to IEC and to the signer (signer copy from
   info@iecincglobal.com) and returned for download. No silent
   failure: a failed submit shows an error and offers no download. */
(function () {
  "use strict";

  // The executed instrument is IEC's standard Mutual Non-Disclosure
  // Agreement — the same final text the MEDEXEC and CURAVIA website
  // flows execute (IEC is the named party for every product). Until
  // now iecincglobal.com had no embedded NDA; this flow is the
  // corporate door required by the NDA-gate rule: the public pages are
  // an overview, and specifics about any IEC asset are shared only
  // under a signed NDA. The only text adaptation for the corporate
  // site is the Purpose example in Section 1, made generic for IEC
  // business discussions (a signer-entered Purpose replaces it in the
  // executed copy, exactly as on the product sites).
  var agreementTexts = [
  "This Mutual Non-Disclosure Agreement (\"Agreement\") is entered into as of [EFFECTIVE DATE] (\"Effective Date\"), by and between:\n\nInternational Empire Consultants, Inc., a [STATE] corporation with its principal place of business at 923 Hyde Park Ave, Boston, MA 02136 (\"IEC\"), and\n\n[COUNTERPARTY NAME], a [ENTITY TYPE/STATE] with its principal place of business at [ADDRESS] (\"Counterparty\").\n\nIEC and Counterparty are each a \"Party\" and together the \"Parties.\" Each Party may disclose Confidential Information to the other in connection with discussions regarding [PURPOSE — e.g., \"a potential business engagement with IEC, Inc.\"] (the \"Purpose\").",
  "\"Confidential Information\" means all non-public information disclosed by one Party (the \"Disclosing Party\") to the other (the \"Receiving Party\"), whether orally, visually, or in writing, that is designated as confidential or that a reasonable person would understand to be confidential given the circumstances of disclosure. It includes, without limitation: product designs, software, source code, algorithms, technical documentation, business plans, pricing, customer and patient-related information (subject to Section 9), financial data, and marketing strategies.\n\nExclusions. Confidential Information does not include information that: (a) is or becomes publicly available without breach of this Agreement; (b) was already known to the Receiving Party without a duty of confidentiality, as shown by written records; (c) is independently developed by the Receiving Party without use of or reference to the Disclosing Party's Confidential Information; or (d) is rightfully received from a third party without a duty of confidentiality.",
  "The Receiving Party shall: (a) hold the Disclosing Party's Confidential Information in strict confidence; (b) use it solely for the Purpose; (c) not disclose it to any third party except as permitted in Section 3; and (d) protect it with at least the same degree of care it uses for its own confidential information, and in no event less than reasonable care.",
  "The Receiving Party may disclose Confidential Information to its and its affiliates' employees, contractors, and professional advisors who have a need to know for the Purpose and who are bound by confidentiality obligations at least as protective as this Agreement. The Receiving Party remains responsible for any breach by such persons.",
  "If the Receiving Party is required by law, regulation, or court order to disclose Confidential Information, it shall (to the extent legally permitted) promptly notify the Disclosing Party and cooperate to seek confidential treatment, disclosing only the minimum information legally required.",
  "Nothing in this Agreement grants any intellectual property license or right, by implication or otherwise. Neither Party is obligated to enter into any further agreement or transaction. All Confidential Information is provided \"as is.\"",
  "Upon the Disclosing Party's written request, or upon termination of discussions regarding the Purpose, the Receiving Party shall promptly return or destroy all Confidential Information (including copies), except for one archival copy retained for legal compliance, which remains subject to this Agreement.",
  "This Agreement takes effect on the Effective Date and continues for two (2) years. The obligations in Sections 1–4 and 6 survive for two (2) years from the date of each disclosure. Notwithstanding the foregoing, the Receiving Party's obligations with respect to Confidential Information that qualifies as a trade secret under applicable law shall survive for so long as such information remains a trade secret.",
  "The Parties acknowledge that breach may cause irreparable harm for which monetary damages are inadequate, and the Disclosing Party is entitled to seek injunctive relief in addition to any other remedies.",
  "If any disclosure involves protected health information (\"PHI\") as defined by HIPAA, the Parties shall execute a Business Associate Agreement before any PHI is disclosed, and this Agreement does not authorize the disclosure of PHI.",
  "This Agreement is the entire agreement on confidentiality for the Purpose and supersedes prior discussions on that subject. It may not be amended except in a signed writing. Neither Party may assign it without the other's written consent, except to a successor in a merger or asset sale. If any provision is unenforceable, the remainder continues in effect. This Agreement is governed by the laws of the Commonwealth of Massachusetts, without regard to conflict-of-law rules. The Parties consent to the exclusive jurisdiction of the state and federal courts located in the Commonwealth of Massachusetts for any dispute arising under this Agreement. No waiver of any provision of this Agreement is effective unless in a signed writing, and no waiver of one breach constitutes waiver of any other. It may be executed in counterparts, including by electronic signature.",
  "IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.\n\nInternational Empire Consultants, Inc. — pre-signed by IEC\n\nSignature: Mohammed Morgan, MD  Name: Mohammed Morgan, MD\n\nTitle: Founder & CEO  Date: the date the executed copy is issued\n\n[COUNTERPARTY NAME]\n\nSignature: ___________________________  Name: ___________________________\n\nTitle: ___________________________  Date: ___________________________"
];

  var enMeta = [
  [
"Parties & purpose",
"Parties",
"Identify both parties, the effective date, and the specific business purpose for sharing information."
  ],
  [
"1. Confidential Information",
"Confidential info",
"Defines protected information and the four documented exclusions."
  ],
  [
"2. Obligations",
"Obligations",
"Use the information only for the stated Purpose and protect it with at least reasonable care."
  ],
  [
"3. Permitted disclosures",
"Permitted access",
"Disclosure is limited to need-to-know personnel and advisors under equally protective duties."
  ],
  [
"4. Legally compelled disclosure",
"Legal disclosure",
"Give notice when permitted, seek confidential treatment, and disclose only the legal minimum."
  ],
  [
"5. No license; no obligation",
"No license",
"Sharing information grants no intellectual-property rights and creates no duty to proceed."
  ],
  [
"6. Return or destruction",
"Return / destroy",
"Return or destroy information when requested or when discussions end, subject to one compliance copy."
  ],
  [
"7. Term and survival",
"Term",
"The agreement and ordinary confidentiality duties last two years; trade-secret duties survive while the information remains a trade secret."
  ],
  [
"8. Remedies",
"Remedies",
"A breach may justify injunctive relief in addition to other remedies."
  ],
  [
"9. Protected health information",
"PHI",
"A Business Associate Agreement is required before any PHI is disclosed."
  ],
  [
"10. General",
"General",
"Massachusetts law and exclusive Massachusetts venue apply; amendments and waivers must be signed writings."
  ],
  [
"Execution",
"Signature",
"Both parties execute the agreement as of the Effective Date, including by electronic signature."
  ]
];

  var esMeta = [
  [
"Partes y propósito",
"Partes",
"Identifique a ambas partes, la fecha de vigencia y el propósito comercial específico."
  ],
  [
"1. Información confidencial",
"Info. confidencial",
"Define la información protegida y las cuatro exclusiones documentadas."
  ],
  [
"2. Obligaciones",
"Obligaciones",
"Use la información solo para el Propósito y protéjala con al menos cuidado razonable."
  ],
  [
"3. Divulgaciones permitidas",
"Acceso permitido",
"El acceso se limita a personal y asesores que necesitan conocerla y tienen deberes equivalentes."
  ],
  [
"4. Divulgación exigida por ley",
"Divulgación legal",
"Avise cuando esté permitido, procure trato confidencial y divulgue solo el mínimo legal."
  ],
  [
"5. Sin licencia ni obligación",
"Sin licencia",
"Compartir información no concede derechos de propiedad intelectual ni obliga a continuar."
  ],
  [
"6. Devolución o destrucción",
"Devolver / destruir",
"Devuelva o destruya la información cuando se solicite o terminen las conversaciones, salvo una copia legal."
  ],
  [
"7. Plazo y supervivencia",
"Plazo",
"El acuerdo y los deberes ordinarios duran dos años; los secretos comerciales siguen protegidos mientras mantengan esa condición."
  ],
  [
"8. Remedios",
"Remedios",
"Un incumplimiento puede justificar medidas cautelares además de otros remedios."
  ],
  [
"9. Información médica protegida",
"PHI",
"Se requiere un Acuerdo de Asociado Comercial antes de divulgar PHI."
  ],
  [
"10. General",
"General",
"Rigen las leyes de Massachusetts y la jurisdicción exclusiva de Massachusetts; cambios y renuncias deben firmarse."
  ],
  [
"Firma",
"Firma",
"Ambas partes firman el acuerdo desde la Fecha de Vigencia, incluso de forma electrónica."
  ]
];

  function makeSections(meta) {
    return meta.map(function (item, index) {
      return { title: item[0], short: item[1], summary: item[2], text: agreementTexts[index] };
    });
  }

  var sections = { en: makeSections(enMeta), es: makeSections(esMeta) };

  var ui = {
    en: {
      sections: "Document sections", label: "Mutual NDA · Section", of: "of", prev: "← Previous", review: "Mark reviewed & continue", reviewed: "Reviewed · Continue", reset: "Reset (start fresh)", resetDone: "Cleared. Starting fresh.", guide: "IEC document guide", limit: "Section-by-section explanations grounded in this agreement", placeholder: "Ask about confidentiality, term, venue…", ask: "Ask", hello: "I’ll help you review this agreement section by section. Ask a question, or use one of the prompts below.", quick: ["How long does it last?", "Where are disputes heard?", "Can PHI be shared?"], finalLabel: "Final step · Signer copy", finalTitle: "Complete the agreement and sign", finalIntro: "All sections have been reviewed. Complete every agreement detail and add the counterparty signer’s typed signature.", effectiveDate: "Effective date", iecState: "IEC state of incorporation", party: "Counterparty legal name", entityTypeState: "Counterparty entity type and state", address: "Counterparty principal address", purposeLabel: "Purpose", printed: "Counterparty signer’s printed name", date: "Signature date", title: "Signer title (optional)", typed: "Typed signature", typedPlaceholder: "Type your full legal name", download: "Sign agreement", downloadCopy: "Download signed copy (PDF)", email: "Signer email for the executed copy", sending: "Signing and sending the executed copies…", sendFailed: "The executed copy could not be delivered. Nothing was emailed — check your connection and sign again.", fine: "When you sign and submit, the executed NDA is recorded by IEC, Inc., and an executed PDF copy is emailed to IEC at info@iecincglobal.com and to you at the email address above. You can also download the signed PDF for your own records.", ready: "Agreement signed and recorded. An executed PDF copy was emailed to IEC and to your email address.", changed: "Agreement details changed. Sign again to re-issue the executed copy.", missing: "Complete every required agreement and signature field before signing.", incompleteReview: "Review every section before signing.", fallback: "I can only answer from this agreement. Try asking about the term, exclusions, permitted access, required disclosure, PHI, Massachusetts venue, return or destruction, or signatures.", term: "The Agreement continues for two years from the Effective Date. Sections 1–4 and 6 survive for two years from each disclosure. Trade-secret duties survive for as long as the information remains a trade secret.", exclude: "The agreement excludes information that becomes public without breach, was already known without a confidentiality duty and can be documented, is independently developed without use of the disclosed information, or is rightfully received from a third party without a confidentiality duty.", access: "Access is limited to the receiving party’s and its affiliates’ employees, contractors, and professional advisors who need the information for the Purpose and are bound by obligations at least as protective as this Agreement.", purpose: "Confidential Information may be used only for the completed Purpose stated by the parties.", disclosure: "If disclosure is legally required, the receiving party must, when legally permitted, promptly notify the disclosing party, cooperate to seek confidential treatment, and disclose only the legal minimum.", return: "On written request or when discussions end, Confidential Information must be returned or destroyed, except for one archival copy kept for legal compliance.", owner: "The Agreement grants no intellectual-property license or right. Neither party is obligated to enter a further agreement or transaction.", phi: "The Agreement does not authorize disclosure of protected health information. The parties must execute a Business Associate Agreement before any PHI is disclosed.", venue: "Massachusetts law governs. The parties consent to exclusive jurisdiction in the state and federal courts located in the Commonwealth of Massachusetts. A waiver is effective only in a signed writing, and waiving one breach does not waive another.", signature: "The parties may execute the Agreement in counterparts, including by electronic signature. Complete every required agreement detail before adding the counterparty signature."
    },
    es: {
      sections: "Secciones del documento", label: "NDA mutuo · Sección", of: "de", prev: "← Anterior", review: "Marcar revisada y continuar", reviewed: "Revisada · Continuar", reset: "Restablecer (empezar de nuevo)", resetDone: "Borrado. Empezando de nuevo.", guide: "Guía de documentos IEC", limit: "Explicaciones sección por sección basadas en este acuerdo", placeholder: "Pregunte sobre confidencialidad, plazo, jurisdicción…", ask: "Preguntar", hello: "Le ayudaré a revisar este acuerdo sección por sección. Haga una pregunta o use una de las opciones siguientes.", quick: ["¿Cuánto dura?", "¿Dónde se resuelven disputas?", "¿Se puede compartir PHI?"], finalLabel: "Paso final · Copia del firmante", finalTitle: "Complete el acuerdo y firme", finalIntro: "Se revisaron todas las secciones. Complete todos los datos del acuerdo y añada la firma escrita del firmante de la contraparte.", effectiveDate: "Fecha de vigencia", iecState: "Estado de constitución de IEC", party: "Nombre legal de la contraparte", entityTypeState: "Tipo de entidad y estado de la contraparte", address: "Dirección principal de la contraparte", purposeLabel: "Propósito", printed: "Nombre del firmante de la contraparte", date: "Fecha de firma", title: "Cargo del firmante (opcional)", typed: "Firma escrita", typedPlaceholder: "Escriba su nombre legal completo", download: "Firmar acuerdo", downloadCopy: "Descargar copia firmada (PDF)", email: "Correo del firmante para la copia ejecutada", sending: "Firmando y enviando las copias ejecutadas…", sendFailed: "La copia ejecutada no pudo entregarse. No se envió ningún correo: verifique su conexión y firme de nuevo.", fine: "Al firmar y enviar, el NDA ejecutado queda registrado por IEC, Inc., y se envía una copia ejecutada en PDF por correo a IEC a info@iecincglobal.com y a usted a la dirección indicada arriba. También puede descargar el PDF firmado para sus registros.", ready: "Acuerdo firmado y registrado. Se envió una copia ejecutada en PDF por correo a IEC y a su dirección.", changed: "Los datos del acuerdo cambiaron. Firme de nuevo para emitir la copia ejecutada.", missing: "Complete todos los campos obligatorios del acuerdo y la firma antes de firmar.", incompleteReview: "Revise todas las secciones antes de firmar.", fallback: "Solo puedo responder usando este acuerdo. Pregunte sobre el plazo, exclusiones, acceso permitido, divulgación legal, PHI, jurisdicción de Massachusetts, devolución o destrucción, o firmas.", term: "El Acuerdo continúa durante dos años desde la Fecha de Vigencia. Las Secciones 1–4 y 6 sobreviven durante dos años desde cada divulgación. Los deberes sobre secretos comerciales sobreviven mientras la información siga siendo un secreto comercial.", exclude: "Se excluye la información que se hace pública sin incumplimiento, que ya se conocía sin deber de confidencialidad y puede documentarse, que se desarrolla independientemente o que se recibe legítimamente de un tercero sin deber de confidencialidad.", access: "El acceso se limita a empleados, contratistas y asesores profesionales de la parte receptora y sus afiliadas que necesiten la información para el Propósito y estén sujetos a deberes al menos tan protectores como este Acuerdo.", purpose: "La Información Confidencial solo puede usarse para el Propósito completado por las partes.", disclosure: "Si la ley exige divulgar, la parte receptora debe, cuando la ley lo permita, avisar de inmediato, cooperar para procurar trato confidencial y divulgar solo el mínimo legal.", return: "A solicitud escrita o al terminar las conversaciones, la Información Confidencial debe devolverse o destruirse, salvo una copia archivada para cumplimiento legal.", owner: "El Acuerdo no concede ninguna licencia ni derecho de propiedad intelectual. Ninguna parte está obligada a celebrar otro acuerdo o transacción.", phi: "El Acuerdo no autoriza divulgar información médica protegida. Las partes deben firmar un Acuerdo de Asociado Comercial antes de divulgar PHI.", venue: "Rige la ley de Massachusetts. Las partes aceptan jurisdicción exclusiva de los tribunales estatales y federales de Massachusetts. Una renuncia solo es efectiva por escrito y firmada; renunciar a un incumplimiento no renuncia a otro.", signature: "Las partes pueden firmar el Acuerdo en ejemplares separados, incluso con firma electrónica. Complete todos los datos obligatorios antes de añadir la firma de la contraparte."
    }
  };

  var lang = "en";
  var current = 0;
  var reviewed = {};
  var navList = document.getElementById("doc-nav-list");
  var chatLog = document.getElementById("chat-log");
  var signaturePanel = document.getElementById("signature-panel");
  var agreementFieldIds = ["effective-date", "iec-state", "party-name", "entity-type-state", "counterparty-address", "agreement-purpose"];
  var signerFieldIds = ["printed-name", "signature-date", "signer-title", "typed-signature", "signer-email"];
  var PURPOSE_PLACEHOLDER = '[PURPOSE — e.g., "a potential business engagement with IEC, Inc."]';

  function getAgreementData() {
    return {
      effectiveDate: document.getElementById("effective-date").value,
      iecState: document.getElementById("iec-state").value.trim(),
      party: document.getElementById("party-name").value.trim(),
      entityTypeState: document.getElementById("entity-type-state").value.trim(),
      address: document.getElementById("counterparty-address").value.trim(),
      purpose: document.getElementById("agreement-purpose").value.trim()
    };
  }

  function fillAgreementText(text, data) {
    var values = {
      "[EFFECTIVE DATE]": data.effectiveDate || "[EFFECTIVE DATE]",
      "[STATE]": data.iecState || "[STATE]",
      "[COUNTERPARTY NAME]": data.party || "[COUNTERPARTY NAME]",
      "[ENTITY TYPE/STATE]": data.entityTypeState || "[ENTITY TYPE/STATE]",
      "[ADDRESS]": data.address || "[ADDRESS]"
    };
    values[PURPOSE_PLACEHOLDER] = data.purpose || PURPOSE_PLACEHOLDER;
    Object.keys(values).forEach(function (placeholder) {
      text = text.split(placeholder).join(values[placeholder]);
    });
    return text;
  }

  function renderNav() {
    navList.innerHTML = "";
    sections[lang].forEach(function (section, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nda-nav-btn" + (index === current ? " current" : "") + (reviewed[index] ? " reviewed" : "");
      btn.setAttribute("aria-current", index === current ? "step" : "false");
      btn.innerHTML = '<span class="dot">' + (reviewed[index] ? "✓" : (index + 1)) + '</span><span>' + section.short + '</span>';
      btn.addEventListener("click", function () { current = index; renderDocument(); });
      navList.appendChild(btn);
    });
    var count = Object.keys(reviewed).length;
    document.getElementById("progress-bar").style.width = ((count / sections[lang].length) * 100) + "%";
  }

  function renderDocument() {
    var section = sections[lang][current];
    var t = ui[lang];
    document.getElementById("doc-label").textContent = t.label + " " + (current + 1) + " " + t.of + " " + sections[lang].length;
    document.getElementById("doc-title").textContent = section.title;
    document.getElementById("doc-summary").textContent = section.summary;
    document.getElementById("doc-copy").textContent = fillAgreementText(section.text, getAgreementData());
    document.getElementById("prev-section").textContent = t.prev;
    document.getElementById("prev-section").disabled = current === 0;
    document.getElementById("review-section").textContent = reviewed[current] ? t.reviewed : t.review;
    renderNav();
  }

  function addBubble(kind, text) {
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble " + kind;
    bubble.textContent = text;
    chatLog.appendChild(bubble);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderAssistant(reset) {
    var t = ui[lang];
    document.getElementById("sections-label").textContent = t.sections;
    document.getElementById("reset-matter").textContent = t.reset;
    document.getElementById("assistant-name").textContent = t.guide;
    document.getElementById("assistant-limit").textContent = t.limit;
    document.getElementById("chat-question").placeholder = t.placeholder;
    document.getElementById("chat-send").textContent = t.ask;
    document.getElementById("signature-label").textContent = t.finalLabel;
    document.getElementById("signature-title").textContent = t.finalTitle;
    document.getElementById("signature-intro").textContent = t.finalIntro;
    document.getElementById("effective-date-label").textContent = t.effectiveDate;
    document.getElementById("iec-state-label").textContent = t.iecState;
    document.getElementById("party-label").textContent = t.party;
    document.getElementById("entity-type-state-label").textContent = t.entityTypeState;
    document.getElementById("address-label").textContent = t.address;
    document.getElementById("purpose-label").textContent = t.purposeLabel;
    document.getElementById("printed-label").textContent = t.printed;
    document.getElementById("signer-email-label").textContent = t.email;
    document.getElementById("date-label").textContent = t.date;
    document.getElementById("title-label").textContent = t.title;
    document.getElementById("typed-label").textContent = t.typed;
    document.getElementById("typed-signature").placeholder = t.typedPlaceholder;
    document.getElementById("download-signed").textContent = t.download;
    document.getElementById("download-copy").textContent = t.downloadCopy;
    document.getElementById("signature-fine").textContent = t.fine;
    var quick = document.getElementById("quick-asks");
    quick.innerHTML = "";
    t.quick.forEach(function (question) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = question;
      btn.addEventListener("click", function () { answerQuestion(question); });
      quick.appendChild(btn);
    });
    if (reset) {
      chatLog.innerHTML = "";
      addBubble("agent", t.hello);
    }
  }

  function answerQuestion(question) {
    var t = ui[lang];
    var q = question.toLowerCase();
    addBubble("user", question);
    var answer = t.fallback;
    if (/long|term|last|dur|plazo|tiempo/.test(q)) answer = t.term;
    else if (/exclude|not confidential|exception|exclu|no es confidencial/.test(q)) answer = t.exclude;
    else if (/who|access|see|share|quién|acceso|ver|compart/.test(q)) answer = t.access;
    else if (/purpose|use|propósito|usar|uso/.test(q)) answer = t.purpose;
    else if (/law|required|court|disclos|ley|orden|divulg/.test(q)) answer = t.disclosure;
    else if (/return|destroy|delete|devol|destru|elimin/.test(q)) answer = t.return;
    else if (/own|license|intellectual|propiedad|licencia/.test(q)) answer = t.owner;
    else if (/phi|hipaa|health information|información médica|salud protegida/.test(q)) answer = t.phi;
    else if (/venue|jurisdiction|massachusetts|waiver|court|jurisdic|tribunal|renuncia/.test(q)) answer = t.venue;
    else if (/sign|electronic|signature|firma|electrónica/.test(q)) answer = t.signature;
    addBubble("agent", answer);
  }

  document.getElementById("prev-section").addEventListener("click", function () {
    if (current > 0) { current -= 1; renderDocument(); }
  });

  document.getElementById("review-section").addEventListener("click", function () {
    reviewed[current] = true;
    var nextMissing = -1;
    sections[lang].some(function (_, index) {
      if (!reviewed[index]) { nextMissing = index; return true; }
      return false;
    });
    if (nextMissing !== -1) {
      current = current < sections[lang].length - 1 && !reviewed[current + 1] ? current + 1 : nextMissing;
      renderDocument();
      return;
    }
    renderDocument();
    signaturePanel.classList.add("visible");
    signaturePanel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  document.getElementById("reset-matter").addEventListener("click", function () {
    var t = ui[lang];
    reviewed = {};
    current = 0;
    signaturePanel.classList.remove("visible");
    document.getElementById("download-copy").hidden = true;
    signedPdf = null;
    signedData = null;
    document.getElementById("signature-form").reset();
    document.getElementById("chat-question").value = "";
    document.getElementById("form-status").textContent = "";
    var resetNow = new Date();
    document.getElementById("signature-date").value = new Date(resetNow.getTime() - resetNow.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    renderDocument();
    renderAssistant(true);
    document.getElementById("reset-status").textContent = t.resetDone;
    document.getElementById("doc-title").focus({ preventScroll: true });
  });

  document.getElementById("chat-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = document.getElementById("chat-question");
    var value = input.value.trim();
    if (!value) return;
    input.value = "";
    answerQuestion(value);
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char];
    });
  }

  function iecSignatureBlock(data) {
    // IEC's signature is pre-applied in the website: every executed copy
    // goes out with both signatures. The date is a token: the server
    // replaces it with the actual date the executed copy is issued —
    // never with the client-entered Effective Date.
    return '<div><h3>International Empire Consultants, Inc.</h3>'
      + '<p>(Pre-signed by IEC)</p>'
      + '<p>Signature: <em>Mohammed Morgan, MD</em></p>'
      + '<p>Name: Mohammed Morgan, MD</p>'
      + '<p>Title: Founder &amp; CEO</p>'
      + '<p>Date: [IEC EXECUTION DATE]</p></div>';
  }

  function buildSignedHtml(data) {
    var docSections = sections.en.slice(0, 11).map(function (section, index) {
      var heading = index === 0 ? "" : '<h2>' + escapeHtml(section.title) + '</h2>';
      return '<section' + (index === 0 ? ' class="intro"' : '') + '>' + heading + '<p>' + escapeHtml(fillAgreementText(section.text, data)) + '</p></section>';
    }).join("");
    var signatureBlock = '<section class="execution"><h2>Execution</h2><p><strong>IN WITNESS WHEREOF</strong>, the Parties have executed this Agreement as of the Effective Date.</p><div class="signatures">'
      + iecSignatureBlock(data)
      + '<div><h3>' + escapeHtml(data.party) + '</h3><p>Signature: <em>' + escapeHtml(data.signature) + '</em></p><p>Name: ' + escapeHtml(data.name) + '</p><p>Title: ' + escapeHtml(data.title || "—") + '</p><p>Date: ' + escapeHtml(data.date) + '</p></div></div></section>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IEC Mutual Non-Disclosure Agreement</title></head><body><header><h1>Mutual Non-Disclosure Agreement</h1><p>International Empire Consultants, Inc. and ' + escapeHtml(data.party) + '</p></header>' + docSections + signatureBlock + '</body></html>';
  }

  // The executed copy is a PDF generated and recorded by the server;
  // a successful submit returns its exact bytes, and this downloads
  // them — the same PDF that was emailed to IEC and to the signer.
  var signedPdf = null;
  var signedData = null;

  function downloadSignedPdf() {
    if (!signedPdf) return;
    var binary = atob(signedPdf.base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = signedPdf.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  agreementFieldIds.concat(signerFieldIds).forEach(function (fieldId) {
    document.getElementById(fieldId).addEventListener("input", function () {
      if (agreementFieldIds.indexOf(fieldId) !== -1) renderDocument();
      if (!signedData) return;
      signedData = null;
      signedPdf = null;
      document.getElementById("download-copy").hidden = true;
      document.getElementById("form-status").textContent = ui[lang].changed;
    });
  });

  document.getElementById("signature-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var t = ui[lang];
    var form = event.currentTarget;
    var status = document.getElementById("form-status");
    var allReviewed = sections[lang].every(function (_, index) { return reviewed[index]; });
    if (!allReviewed) {
      status.textContent = t.incompleteReview;
      return;
    }
    if (!form.checkValidity()) {
      status.textContent = t.missing;
      form.reportValidity();
      return;
    }
    var data = getAgreementData();
    data.name = document.getElementById("printed-name").value.trim();
    data.date = document.getElementById("signature-date").value;
    data.title = document.getElementById("signer-title").value.trim();
    data.signature = document.getElementById("typed-signature").value.trim();
    data.email = document.getElementById("signer-email").value.trim();
    if (!data.effectiveDate || !data.iecState || !data.party || !data.entityTypeState || !data.address || !data.purpose || !data.name || !data.date || !data.signature || !data.email) {
      status.textContent = t.missing;
      return;
    }
    // No silent failure: success is shown ONLY after the server
    // confirms it recorded the signing and emailed the executed PDF
    // to IEC and to the signer. Any failure says so, with signing
    // again as the retry.
    var submitButton = document.getElementById("download-signed");
    submitButton.disabled = true;
    status.textContent = t.sending;
    fetch("https://app.getmedexec.com/api/nda/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "iec",
        effectiveDate: data.effectiveDate,
        iecState: data.iecState,
        party: data.party,
        entityTypeState: data.entityTypeState,
        address: data.address,
        purpose: data.purpose,
        name: data.name,
        title: data.title,
        date: data.date,
        signature: data.signature,
        signerEmail: data.email,
        documentHtml: buildSignedHtml(data)
      })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (body) {
        return { ok: response.ok && !!body && body.ok === true, body: body };
      });
    }).then(function (result) {
      submitButton.disabled = false;
      if (!result.ok || !result.body.pdfBase64) {
        signedData = null;
        signedPdf = null;
        document.getElementById("download-copy").hidden = true;
        status.textContent = t.sendFailed;
        return;
      }
      signedData = data;
      signedPdf = { base64: result.body.pdfBase64, fileName: result.body.fileName };
      status.textContent = t.ready;
      document.getElementById("download-copy").hidden = false;
    }).catch(function () {
      submitButton.disabled = false;
      signedData = null;
      signedPdf = null;
      document.getElementById("download-copy").hidden = true;
      status.textContent = t.sendFailed;
    });
  });

  document.getElementById("download-copy").addEventListener("click", function () {
    downloadSignedPdf();
  });

  window.iecLegalSetLanguage = function (l) {
    lang = l === "es" ? "es" : "en";
    current = Math.min(current, sections[lang].length - 1);
    document.querySelector('.doc-nav').setAttribute('aria-label', lang === 'es' ? 'Acuerdo mutuo de confidencialidad' : 'Mutual NDA');
    document.querySelector('.assistant-panel').setAttribute('aria-label', lang === 'es' ? 'Asistente de documentos' : 'Document assistant');
    document.getElementById("chat-question").setAttribute('aria-label', lang === 'es' ? 'Pregunte sobre este acuerdo' : 'Ask about this agreement');
    renderDocument();
    renderAssistant(true);
  };


  // EN/ES toggle inside the NDA section (the corporate site has no
  // global language switcher; the guided review is bilingual itself).
  var langEnBtn = document.getElementById("nda-lang-en");
  var langEsBtn = document.getElementById("nda-lang-es");
  function markLangButtons() {
    if (!langEnBtn || !langEsBtn) return;
    langEnBtn.classList.toggle("active", lang !== "es");
    langEsBtn.classList.toggle("active", lang === "es");
  }
  if (langEnBtn) langEnBtn.addEventListener("click", function () { window.iecLegalSetLanguage("en"); markLangButtons(); });
  if (langEsBtn) langEsBtn.addEventListener("click", function () { window.iecLegalSetLanguage("es"); markLangButtons(); });
  markLangButtons();

  var now = new Date();
  var localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.getElementById("signature-date").value = localDate;
  renderDocument();
  renderAssistant(true);
})();

