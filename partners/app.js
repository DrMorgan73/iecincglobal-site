/* =====================================================================
   IEC Partner Portal — standalone app.
   ---------------------------------------------------------------------
   The portal is its own product: this shell is the whole partner
   experience (front door, agreement step, and the six sections —
   Dashboard · My referrals · Earnings · Invited partners ·
   Resources · Settings). No marketing-site chrome, no Suite, no
   Desk: a partner enters only through his own activation link
   and sees only his own data, served by /api/contractors.

   Preview mode: open with ?demo=1 to walk the whole portal on a
   built-in sample dataset (the TEST AUDIT test partner). Demo
   mode never calls the API and never saves anything.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = window.PARTNER_PORTAL_LANG === 'es' ? 'es' : 'en';

  /* ------------------------- i18n ------------------------- */
  var T = {
    en: {
      product: 'Partner Portal', loading: 'Loading your portal…',
      nav_dashboard: 'Dashboard', nav_referrals: 'My referrals', nav_earnings: 'Earnings',
      nav_partners: 'Invited partners', nav_resources: 'Resources', nav_settings: 'Settings',
      sign_out: 'Sign out', questions: 'Questions? Write to',
      welcome: 'Welcome', status: 'Status',
      agreement: 'Referral Agreement', nda: 'NDA', signed: 'signed', pending: 'pending',
      frozen_paused: 'Your portal is paused. This is a read-only view of your clients — nothing can be added or changed while paused.',
      frozen_revoked: 'Your partnership is revoked. This is a frozen, read-only view of your clients — nothing can be added or changed, and your clients\u2019 steps do not move.',
      fast_start: 'Your fast start', next_step: 'Next step', fs_agreement: 'Accept your agreement', fs_link: 'Copy your client link',
      fs_education: 'Attend a partner education session', fs_payouts: 'Set up your payouts',
      stat_referrals: 'Referrals', stat_payable: 'Payable', stat_paid: 'Paid', stat_projected: 'Projected',
      your_client_link: 'Your client link',
      link_expl: 'Email this IEC link to a business owner you are introducing. It opens your personal IEC registration page: the owner registers his company and completes the short counts-only questionnaire, and the client is credited to you. The link stays yours while your partnership is active; if your portal is paused or revoked, registrations through it are held for IEC\u2019s review instead.',
      your_link: 'Your link', copy_link: 'Copy the link', link_copied: 'Link copied.',
      copy_hint: 'Select the text and copy it manually.',
      qr_hint: 'Owners can also scan this code to open your registration page.',
      email_template: 'Ready-to-send email — copy it into your own email, adjust anything above the link, and send it from your address',
      copy_email: 'Copy the email', email_copied: 'Email copied — paste it into your own email.',
      edu_highlights: 'Start learning', edu_film_t: 'The Partner Program film (3 minutes)',
      edu_film_d: 'How the program works, what a partner does, and how fees are earned.',
      edu_webinar_t: 'Partner education webinar', edu_webinar_d: 'The full walk-through: your role, your portal, counts only, and the process from introduction to closed license.',
      edu_guides_t: 'Guides & sharing', edu_guides_d: 'IEC\u2019s partner guides, scripts and templates — in the Resources section.',
      watch: 'Watch', open_resources: 'Open Resources',
      referrals_title: 'My referrals', referrals_sub: 'Your companies only — each one\u2019s stage, timeline, and the amount IEC has approved.',
      col_business: 'Business', col_type: 'Type', col_stage: 'Stage', col_contact: 'Contact', col_date: 'Date', col_approved: 'Amount approved', col_fee: 'Your fee',
      no_clients: 'No clients yet — add your first one.', add_client: 'Add a client',
      back_referrals: '← Back to my referrals',
      stage_progress: 'Progress', timeline: 'Timeline — every step, dated',
      amount_approved: 'Amount approved by IEC', amount_pending: 'IEC has not approved an amount for this client yet. The approved amount appears here the moment IEC approves it — IEC never estimates one in advance.',
      your_fee: 'Your fee on this client',
      fee_none: 'No fee yet — your fee is set when this client\u2019s first license closes.',
      fee_line: 'Owner gross {gross} · your fee {fee}',
      fee_paid_on: ' · paid on {date}', fee_due: ' · due within 15 days after IEC is paid',
      profile: 'Client profile', answers: 'Questionnaire answers (counts only)',
      no_answers: 'No answers recorded yet — they appear here when the questionnaire is answered.',
      owner_contact: 'Owner contact', business_type: 'Business type', registered_through: 'Registered through',
      through_link: 'Your client link', through_you: 'You entered this client',
      location: 'Location', locations: 'Locations', employees: 'Full-time employees', desk_staff: 'Local desk staff',
      systems: 'Systems', years_records: 'Years of records', added_on: 'Added',
      send_q: 'Send the owner the questionnaire, then record that you sent it:',
      open_q: 'Open the client questionnaire', i_sent_q: 'I sent the questionnaire',
      q_ref: 'Questionnaire submission on record: {ref}',
      step_record_fail: 'That step could not be recorded — please try again.',
      qual_title: 'First, a quick qualification check',
      qual_expl: 'This program starts at 20+ local desk staff (remote and offshore desk staff count). Healthcare, legal, accounting, energy and engineering businesses qualify at any headcount.',
      qual_band: 'How many local desk staff does the business have on payroll?',
      qual_industry: 'What kind of business is it?',
      band_under: 'Under 20', band_2034: '20–34', band_3575: '35–75', band_76200: '76–200', band_over: 'Over 200',
      qual_continue: 'Continue', qual_fail: 'This business does not qualify yet: the program starts at 20+ local desk staff for this business type. When its desk team grows to 20 or more, you can register it here.',
      add_expl: 'Add a business owner you are introducing to IEC\u2019s data-licensing program. A client can be registered by one partner only — first to register wins; if the business is already registered, your add will be refused without naming anyone. Counts only: totals and distributions, never individual records, never patient or customer information.',
      f_business: 'Business legal name', f_owner: 'Owner contact name', f_email: 'Owner contact email',
      f_locations: 'Locations (count)', f_employees: 'Full-time employees', f_systems: 'Systems they run (names)',
      f_years: 'Years of records', add_this: 'Add this client', adding: 'Adding your client…',
      added_ok: 'Client added. Open the client below to send the questionnaire.',
      err_nda: 'Please complete both signatures first — clients open once IEC records them.',
      err_already: 'This business is already registered. A client can be registered by one partner only.',
      err_identifier: 'One of the answers contains an email address, a phone number or an ID number. Counts only — please remove it and save again. Nothing was saved.',
      err_session: 'Your session ended — please use your activation link to sign in again.',
      err_fields: 'Please check the fields and try again.', err_generic: 'Something went wrong — please try again.',
      q_title: 'Client information — the counts-only questionnaire',
      q_expl: 'Answer with the owner what you already know; anything left blank can be completed by the owner on the questionnaire itself. Counts only — an answer containing an email address, a phone number or an ID number will be refused and nothing will be saved.',
      earnings_title: 'Earnings', earnings_sub: 'Your referral fees — projected from IEC-approved amounts only, payable when earned, paid when IEC pays you.',
      e_projected_n: 'Fees on amounts IEC has approved, licenses not yet closed', e_payable_n: 'Earned and due to you', e_paid_n: 'Paid out to you', e_earned: 'Earned to date',
      schedule_title: 'Your referral fee schedule', schedule_adopted: 'Schedule adopted',
      schedule_fine: 'Your fee is 3% of the first $250,000 of the owner\u2019s gross on a client\u2019s first closed license — the gross the owner receives — plus 1% of the owner\u2019s gross above $250,000, with no cap. Paid once per client, on their first closed license only (renewals earn no fee), within 15 days after IEC is paid. The fee is payable by IEC and is never deducted from any amount payable to the owner.',
      col_gross: 'Owner gross — first closed license',
      payout_title: 'Getting paid', payout_set: 'Payouts are set up: {method} · account ending {last4}.',
      payout_notset: 'Your payouts are not set up yet. Add your payout method in Settings so IEC can pay your fees without delay.',
      method_wire: 'Wire transfer', method_check: 'Check', go_settings: 'Open Settings',
      tax_title: 'Tax form — W-9 / W-8BEN', tax_on: 'Tax form on file — {type}, uploaded {date}. To replace it, upload a new one.',
      tax_off: 'IEC needs your tax form before your first fee can be paid. Upload your completed W-9 (or W-8BEN, if that is the form that applies to you) — PDF, PNG or JPG, up to 10 MB. IEC keeps it on file with your payout record.',
      tax_type: 'Form type', tax_upload: 'Upload tax form', tax_uploading: 'Uploading…', tax_ok: 'Your tax form is on file with IEC.', tax_fail: 'That file could not be uploaded — please use a PDF, PNG or JPG under 10 MB and try again.',
      agr_accepted_line: 'Agreement accepted — version {version}, {when}.',
      agr_email_note: 'Receiving the agreement by email alone does not count as acceptance — acceptance happens here, in your portal, and IEC records the version and the exact time.',
      agr_status_office: 'Agreement: signed — recorded by the IEC office {when}.',
      doc_view_agreement: 'View agreement', doc_view_cnda: 'View CNDA', doc_download_pdf: 'Download PDF',
      doc_back: 'Back', doc_your_copy: 'Your signed copy',
      doc_agr_heading: 'IEC Contractor Referral Agreement', doc_cnda_heading: 'Confidentiality Agreement (CNDA)',
      doc_load_fail: 'This document could not be loaded — please try again.',
      doc_ndaline: 'NDA: signed — recorded by IEC.',
      downloads: 'Downloads', dl_plan: 'Download plan summary (PDF)', dl_csv: 'Download earnings (CSV)',
      partners_title: 'Invited partners', partners_sub: 'Partners you personally invited to IEC. IEC\u2019s program is direct: you see only your own invitees — no levels, no network, and no partner ever sees another partner\u2019s earnings.',
      your_invite_link: 'Your invitation link', invite_expl: 'Send this link to someone who should become an IEC partner. His request arrives connected to you, and he appears in your list below once he asks for access.',
      invite_message: 'Ready invite message — copy it into your own email or message',
      copy_message: 'Copy the message', message_copied: 'Message copied.',
      col_partner: 'Partner', col_company: 'Company', col_joined: 'Requested',
      no_invited: 'You have not invited any partners yet — send your invitation link to your first one.',
      resources_title: 'Resources', resources_sub: 'Your IEC education shelf — everything IEC-branded, produced by IEC for its partners.',
      res_getting_started: 'Getting Started', res_webinars: 'Webinars', res_guides: 'Guides & sharing', res_brand: 'Brand downloads',
      slot_in_production: 'In production — IEC is preparing this item; it appears here when it is published.',
      res_how_t: 'How licensing works', res_how_d: 'The owner-facing explanation of data licensing — what it is, what it is not, and how a license closes.',
      res_firstweek_t: 'Your first week', res_firstweek_d: 'Copy your client link. Send it to two owners you know. Register one company yourself. Attend the partner education session. Set up your payouts.',
      res_owner_webinar_t: 'The owner webinar', res_owner_webinar_d: 'IEC\u2019s data-licensing webinar for business owners — share it with owners who want the full picture before they register.',
      res_logo_t: 'IEC logo package', res_logo_d: 'The IEC, Inc. logo for your partner materials — use it as provided; IEC branding is never altered.',
      dl_logo: 'Download the IEC logo',
      settings_title: 'Settings', settings_sub: 'Your profile, your IEC email, and how IEC pays you.',
      s_profile: 'Profile', s_company: 'Company', s_phone: 'Mobile / phone', s_street: 'Street address', s_city: 'City', s_state: 'State', s_zip: 'ZIP',
      s_website: 'Website', s_save: 'Save profile', s_saved: 'Profile saved.',
      s_identity: 'Your name and sign-in email are your identity of record — they match your signed agreement and do not change here. Write to info@iecincglobal.com if either ever needs correcting.',
      s_iec_email: 'Your IEC email', s_iec_email_expl: 'IEC assigns and provisions your program mailbox — you only receive it. Use it for program business; sign in through IEC webmail or add it to your mail app. IEC suspends the mailbox if a partnership is paused or revoked.',
      assigned_by: 'Assigned by IEC',
      s_payout: 'Payout settings', s_method: 'Payout method', s_last4: 'Account last 4 digits',
      s_last4_hint: 'Only the last 4 digits — never enter a full account number here. IEC confirms full payout details with you directly.',
      s_save_payout: 'Save payout settings', s_payout_saved: 'Payout settings saved.',
      front_hero_k: 'IEC, Inc. · Partner Portal',
      front_hero_t: 'The IEC Partner Portal',
      front_hero_p: 'The private portal for IEC\u2019s partners: register the companies you introduce, follow each one through the process, and track your referral fees. Everything here is IEC, Inc. — partners work with IEC directly.',
      front_enter_t: 'Enter your portal',
      front_enter_p: 'Your portal is personal: sign in below with the one-time activation code from the link IEC emailed you, once both of your signatures stand — the Contractor Referral Agreement and the NDA. Sign-in sets your access for 30 days.',
      front_enter_p2: 'Lost your link, or never received one? Write to info@iecincglobal.com and IEC will re-issue it.',
      signin_t: 'Sign in',
      signin_p: 'Enter the activation code from your IEC invitation link — or paste the full link — and your dashboard opens. The code works once, and only once both of your signatures stand.',
      signin_label: 'Activation code or full sign-in link',
      signin_btn: 'Sign in to my portal',
      signin_working: 'Signing you in…',
      signin_failed: 'That code or link did not work — it may have expired or already been used. Write to info@iecincglobal.com and IEC will re-issue your sign-in link.',
      signin_first: 'Your sign-in link is valid. One signature step comes first — your portal opens as soon as both signatures stand.',
      forgot_link: 'Forgot your sign-in link?',
      forgot_p: 'Enter the email on your partner record and we will email you a fresh sign-in link. A fresh link replaces any sign-in link you were sent before.',
      forgot_label: 'Email on your partner record',
      forgot_btn: 'Email me a new sign-in link',
      forgot_working: 'Sending…',
      forgot_sent: 'If that email matches an active partner record, a new sign-in link is on its way. Check your inbox — the link works once.',
      pointer_new: 'New to IEC?',
      pointer_link: 'Request access on the Partner Portal page',
      front_req_t: 'Request access',
      front_req_p: 'Not a partner yet? Request access below. IEC reviews every request; signing the agreement and the NDA comes before any access opens.',
      invited_by_line: 'You were invited by {name} ({company}). Your request arrives connected to your inviter.',
      join_title: 'Join as an IEC partner',
      su_name: 'Your full legal name', su_company: 'Your company', su_email: 'Email', su_phone: 'Phone',
      su_type: 'What best describes you?', su_street: 'Business street address', su_city: 'City', su_state: 'State', su_zip: 'ZIP',
      su_website: 'Website', su_heard: 'How did you hear about IEC?', su_notes: 'Anything IEC should know?',
      su_send: 'Send the request', su_sending: 'Sending…',
      su_ok: 'Thank you — your request is with IEC. The next step is signing: IEC will send your Contractor Referral Agreement and the NDA, and your portal opens once both signatures are recorded.',
      su_dup: 'This email is already registered with the IEC partner program. If that is you, write to info@iecincglobal.com and we will take it from there.',
      agr_title: 'One step before your portal opens',
      agr_expl: 'Your activation link is valid. The IEC Contractor Referral Agreement below is your signature step: read it in full, type your full legal name exactly as it appears on your invitation record, and accept. IEC records your acceptance — name, time, and the agreement version — as your signature.',
      agr_for: 'Agreement for {name} · {company}',
      agr_status_signed: 'Agreement accepted — version {version}, recorded {when}.',
      agr_typed: 'Type your full legal name', agr_accept: 'I have read the agreement and I accept it — this is my signature',
      agr_sign_btn: 'Accept and sign', agr_name_mismatch: 'Type your full legal name exactly as it appears on your invitation record.',
      agr_fail: 'That acceptance could not be recorded — please try again.',
      nda_step_t: 'The confidentiality step',
      nda_step_p: 'One signature remains: IEC\u2019s confidentiality agreement (NDA). Sign it, and once IEC has recorded it your portal opens through this same activation link.',
      nda_open: 'Open the NDA to sign',
      agr_done_t: 'Both signatures stand',
      agr_done_p: 'Your agreement and your NDA are both recorded. Open your portal:',
      agr_open_btn: 'Open my portal',
      demo_ribbon: 'Preview — sample data (TEST AUDIT test partner). Nothing here is saved.',
      demo_blocked: 'Preview only — sample data, nothing is saved.',
      stage_added: 'Added', stage_questionnaire_sent: 'Questionnaire sent', stage_questionnaire_answered: 'Questionnaire answered',
      stage_assessment_done: 'Assessment done', stage_cnda_sent: 'NDA sent', stage_cnda_signed: 'NDA signed',
      stage_ready_to_register: 'Ready to register', stage_registered: 'Registered',
      stage_intake_review: 'Data intake review', stage_valuation_packaging: 'Valuation and packaging',
      stage_presented: 'Presented', stage_buyer_diligence: 'Diligence', stage_offer_received: 'Offer received',
      stage_negotiating_terms: 'Negotiating terms', stage_license_sent: 'License sent', stage_license_signed: 'License signed',
      stage_data_delivery: 'Data delivery', stage_acceptance_review: 'Acceptance review', stage_awaiting_payment: 'Awaiting payment',
      stage_deal_closed: 'Deal closed', stage_fee_earned: 'Fee earned', stage_fee_paid: 'Fee paid',
      ind_home_health: 'Home health', ind_physical_therapy: 'Physical therapy', ind_medical_practice: 'Medical practice',
      ind_pharmacy: 'Pharmacy', ind_gas_convenience: 'Gas / convenience', ind_general_business: 'General business'
    },
    es: {
      product: 'Portal de Socios', loading: 'Cargando su portal…',
      nav_dashboard: 'Panel', nav_referrals: 'Mis referidos', nav_earnings: 'Ganancias',
      nav_partners: 'Socios invitados', nav_resources: 'Recursos', nav_settings: 'Configuración',
      sign_out: 'Cerrar sesión', questions: '¿Preguntas? Escriba a',
      welcome: 'Bienvenido', status: 'Estado',
      agreement: 'Acuerdo de Referidos', nda: 'NDA', signed: 'firmado', pending: 'pendiente',
      frozen_paused: 'Su portal está en pausa. Esta es una vista de solo lectura de sus clientes: nada puede agregarse ni cambiarse durante la pausa.',
      frozen_revoked: 'Su asociación está revocada. Esta es una vista congelada y de solo lectura de sus clientes: nada puede agregarse ni cambiarse, y los pasos de sus clientes no avanzan.',
      fast_start: 'Su inicio rápido', next_step: 'Siguiente paso', fs_agreement: 'Acepte su acuerdo', fs_link: 'Copie su enlace de cliente',
      fs_education: 'Asista a una sesión de educación para socios', fs_payouts: 'Configure sus pagos',
      stat_referrals: 'Referidos', stat_payable: 'Por pagar', stat_paid: 'Pagado', stat_projected: 'Proyectado',
      your_client_link: 'Su enlace de cliente',
      link_expl: 'Envíe este enlace de IEC a un propietario de negocio que usted presente. Abre su página personal de registro de IEC: el propietario registra su empresa y completa el breve cuestionario de solo conteos, y el cliente se acredita a usted. El enlace sigue siendo suyo mientras su asociación esté activa; si su portal se pausa o se revoca, los registros que lleguen por él quedan retenidos para revisión de IEC.',
      your_link: 'Su enlace', copy_link: 'Copiar el enlace', link_copied: 'Enlace copiado.',
      copy_hint: 'Seleccione el texto y cópielo manualmente.',
      qr_hint: 'Los propietarios también pueden escanear este código para abrir su página de registro.',
      email_template: 'Correo listo para enviar: cópielo en su propio correo, ajuste lo que desee antes del enlace y envíelo desde su dirección',
      copy_email: 'Copiar el correo', email_copied: 'Correo copiado: péguelo en su propio correo.',
      edu_highlights: 'Empiece a aprender', edu_film_t: 'La película del Programa de Socios (3 minutos)',
      edu_film_d: 'Cómo funciona el programa, qué hace un socio y cómo se ganan las comisiones.',
      edu_webinar_t: 'Seminario web de educación para socios', edu_webinar_d: 'El recorrido completo: su rol, su portal, solo conteos, y el proceso desde la presentación hasta la licencia cerrada.',
      edu_guides_t: 'Guías y materiales para compartir', edu_guides_d: 'Las guías, guiones y plantillas de IEC para socios, en la sección Recursos.',
      watch: 'Ver', open_resources: 'Abrir Recursos',
      referrals_title: 'Mis referidos', referrals_sub: 'Solo sus empresas: la etapa de cada una, su línea de tiempo y el monto que IEC ha aprobado.',
      col_business: 'Empresa', col_type: 'Tipo', col_stage: 'Etapa', col_contact: 'Contacto', col_date: 'Fecha', col_approved: 'Monto aprobado', col_fee: 'Su comisión',
      no_clients: 'Aún no tiene clientes: agregue el primero.', add_client: 'Agregar un cliente',
      back_referrals: '← Volver a mis referidos',
      stage_progress: 'Progreso', timeline: 'Línea de tiempo: cada paso, con fecha',
      amount_approved: 'Monto aprobado por IEC', amount_pending: 'IEC aún no ha aprobado un monto para este cliente. El monto aprobado aparece aquí en el momento en que IEC lo aprueba: IEC nunca estima uno por adelantado.',
      your_fee: 'Su comisión por este cliente',
      fee_none: 'Aún no hay comisión: su comisión se fija cuando se cierra la primera licencia de este cliente.',
      fee_line: 'Monto bruto del propietario {gross} · su comisión {fee}',
      fee_paid_on: ' · pagada el {date}', fee_due: ' · pagadera dentro de los 15 días posteriores al pago a IEC',
      profile: 'Perfil del cliente', answers: 'Respuestas del cuestionario (solo conteos)',
      no_answers: 'Aún no hay respuestas registradas: aparecen aquí cuando se responde el cuestionario.',
      owner_contact: 'Contacto del propietario', business_type: 'Tipo de negocio', registered_through: 'Registrado mediante',
      through_link: 'Su enlace de cliente', through_you: 'Usted registró este cliente',
      location: 'Ubicación', locations: 'Ubicaciones', employees: 'Empleados a tiempo completo', desk_staff: 'Personal de escritorio local',
      systems: 'Sistemas', years_records: 'Años de registros', added_on: 'Agregado',
      send_q: 'Envíe el cuestionario al propietario y luego registre que lo envió:',
      open_q: 'Abrir el cuestionario del cliente', i_sent_q: 'Envié el cuestionario',
      q_ref: 'Envío del cuestionario en registro: {ref}',
      step_record_fail: 'Ese paso no pudo registrarse: inténtelo de nuevo.',
      qual_title: 'Primero, una verificación rápida de calificación',
      qual_expl: 'Este programa comienza con 20 o más personas de personal de escritorio local (el personal remoto y offshore cuenta). Los negocios de salud, legal, contabilidad, energía e ingeniería califican con cualquier cantidad de personal.',
      qual_band: '¿Cuánto personal de escritorio local tiene el negocio en nómina?',
      qual_industry: '¿Qué tipo de negocio es?',
      band_under: 'Menos de 20', band_2034: '20–34', band_3575: '35–75', band_76200: '76–200', band_over: 'Más de 200',
      qual_continue: 'Continuar', qual_fail: 'Este negocio aún no califica: el programa comienza con 20 o más personas de personal de escritorio local para este tipo de negocio. Cuando su equipo de escritorio llegue a 20 o más, podrá registrarlo aquí.',
      add_expl: 'Agregue a un propietario de negocio que usted presenta al programa de licencias de datos de IEC. Un cliente solo puede ser registrado por un socio: el primero en registrarlo gana; si la empresa ya está registrada, su registro será rechazado sin nombrar a nadie. Solo conteos: totales y distribuciones, nunca registros individuales, nunca información de pacientes o clientes.',
      f_business: 'Nombre legal de la empresa', f_owner: 'Nombre del contacto propietario', f_email: 'Correo del contacto propietario',
      f_locations: 'Ubicaciones (cantidad)', f_employees: 'Empleados a tiempo completo', f_systems: 'Sistemas que usan (nombres)',
      f_years: 'Años de registros', add_this: 'Agregar este cliente', adding: 'Agregando su cliente…',
      added_ok: 'Cliente agregado. Abra el cliente abajo para enviar el cuestionario.',
      err_nda: 'Complete primero ambas firmas: los clientes se abren cuando IEC las registra.',
      err_already: 'Esta empresa ya está registrada. Un cliente solo puede ser registrado por un socio.',
      err_identifier: 'Una de las respuestas contiene un correo, un teléfono o un número de identificación. Solo conteos: quítelo y guarde de nuevo. No se guardó nada.',
      err_session: 'Su sesión terminó: use su enlace de activación para ingresar de nuevo.',
      err_fields: 'Revise los campos e inténtelo de nuevo.', err_generic: 'Algo salió mal: inténtelo de nuevo.',
      q_title: 'Información del cliente: el cuestionario de solo conteos',
      q_expl: 'Responda con el propietario lo que ya sabe; lo que quede en blanco puede completarlo el propietario en el propio cuestionario. Solo conteos: una respuesta con un correo, un teléfono o un número de identificación será rechazada y no se guardará nada.',
      earnings_title: 'Ganancias', earnings_sub: 'Sus comisiones por referidos: proyectadas solo desde montos aprobados por IEC, por pagar cuando se ganan, pagadas cuando IEC le paga.',
      e_projected_n: 'Comisiones sobre montos que IEC ha aprobado, licencias aún no cerradas', e_payable_n: 'Ganado y pendiente de pago', e_paid_n: 'Pagado a usted', e_earned: 'Ganado hasta la fecha',
      schedule_title: 'Su escala de comisiones por referidos', schedule_adopted: 'Escala adoptada',
      schedule_fine: 'Su comisión es el 3% de los primeros $250,000 del monto bruto del propietario en la primera licencia cerrada de un cliente — el bruto que recibe el propietario — más el 1% del bruto del propietario por encima de $250,000, sin tope. Se paga una vez por cliente, solo en su primera licencia cerrada (las renovaciones no generan comisión), dentro de los 15 días posteriores al pago a IEC. La comisión la paga IEC y nunca se deduce de ningún monto pagadero al propietario.',
      col_gross: 'Monto bruto del propietario — primera licencia cerrada',
      payout_title: 'Cómo cobra', payout_set: 'Sus pagos están configurados: {method} · cuenta terminada en {last4}.',
      payout_notset: 'Sus pagos aún no están configurados. Agregue su método de pago en Configuración para que IEC pueda pagarle sus comisiones sin demora.',
      method_wire: 'Transferencia bancaria', method_check: 'Cheque', go_settings: 'Abrir Configuración',
      tax_title: 'Formulario fiscal — W-9 / W-8BEN', tax_on: 'Formulario fiscal en archivo — {type}, subido el {date}. Para reemplazarlo, suba uno nuevo.',
      tax_off: 'IEC necesita su formulario fiscal antes de poder pagar su primera comisión. Suba su W-9 completo (o el W-8BEN, si es el formulario que le aplica): PDF, PNG o JPG, hasta 10 MB. IEC lo guarda en archivo con su registro de pagos.',
      tax_type: 'Tipo de formulario', tax_upload: 'Subir formulario fiscal', tax_uploading: 'Subiendo…', tax_ok: 'Su formulario fiscal está en archivo con IEC.', tax_fail: 'Ese archivo no pudo subirse: use un PDF, PNG o JPG de menos de 10 MB e inténtelo de nuevo.',
      agr_accepted_line: 'Acuerdo aceptado — versión {version}, {when}.',
      agr_email_note: 'Recibir el acuerdo por correo electrónico no cuenta como aceptación: la aceptación ocurre aquí, en su portal, e IEC registra la versión y la hora exacta.',
      agr_status_office: 'Acuerdo: firmado — registrado por la oficina de IEC el {when}.',
      doc_view_agreement: 'Ver el acuerdo', doc_view_cnda: 'Ver el CNDA', doc_download_pdf: 'Descargar PDF',
      doc_back: 'Volver', doc_your_copy: 'Su copia firmada',
      doc_agr_heading: 'Acuerdo de Referidos de IEC', doc_cnda_heading: 'Acuerdo de Confidencialidad (CNDA)',
      doc_load_fail: 'Este documento no pudo cargarse: inténtelo de nuevo.',
      doc_ndaline: 'NDA: firmado — registrado por IEC.',
      downloads: 'Descargas', dl_plan: 'Descargar resumen del plan (PDF)', dl_csv: 'Descargar ganancias (CSV)',
      partners_title: 'Socios invitados', partners_sub: 'Los socios que usted invitó personalmente a IEC. El programa de IEC es directo: usted ve solo a sus propios invitados — sin niveles, sin red, y ningún socio ve jamás las ganancias de otro.',
      your_invite_link: 'Su enlace de invitación', invite_expl: 'Envíe este enlace a alguien que debería convertirse en socio de IEC. Su solicitud llega conectada a usted, y aparece en su lista abajo cuando pide acceso.',
      invite_message: 'Mensaje de invitación listo: cópielo en su propio correo o mensaje',
      copy_message: 'Copiar el mensaje', message_copied: 'Mensaje copiado.',
      col_partner: 'Socio', col_company: 'Empresa', col_joined: 'Solicitado',
      no_invited: 'Aún no ha invitado a ningún socio: envíe su enlace de invitación al primero.',
      resources_title: 'Recursos', resources_sub: 'Su biblioteca de educación de IEC: todo con la marca IEC, Inc., producido por IEC para sus socios.',
      res_getting_started: 'Primeros pasos', res_webinars: 'Seminarios web', res_guides: 'Guías y materiales para compartir', res_brand: 'Descargas de marca',
      slot_in_production: 'En producción: IEC está preparando este material; aparecerá aquí cuando se publique.',
      res_how_t: 'Cómo funciona el licenciamiento', res_how_d: 'La explicación para propietarios sobre el licenciamiento de datos: qué es, qué no es, y cómo se cierra una licencia.',
      res_firstweek_t: 'Su primera semana', res_firstweek_d: 'Copie su enlace de cliente. Envíelo a dos propietarios que conoce. Registre una empresa usted mismo. Asista a la sesión de educación para socios. Configure sus pagos.',
      res_owner_webinar_t: 'El seminario web para propietarios', res_owner_webinar_d: 'El seminario de IEC sobre licenciamiento de datos para propietarios de negocios: compártalo con propietarios que quieran el panorama completo antes de registrarse.',
      res_logo_t: 'Paquete del logotipo de IEC', res_logo_d: 'El logotipo de IEC, Inc. para sus materiales de socio: úselo tal como se entrega; la marca IEC nunca se altera.',
      dl_logo: 'Descargar el logotipo de IEC',
      settings_title: 'Configuración', settings_sub: 'Su perfil, su correo de IEC y cómo IEC le paga.',
      s_profile: 'Perfil', s_company: 'Empresa', s_phone: 'Móvil / teléfono', s_street: 'Dirección', s_city: 'Ciudad', s_state: 'Estado', s_zip: 'Código postal',
      s_website: 'Sitio web', s_save: 'Guardar perfil', s_saved: 'Perfil guardado.',
      s_identity: 'Su nombre y su correo de ingreso son su identidad de registro: coinciden con su acuerdo firmado y no cambian aquí. Escriba a info@iecincglobal.com si alguno necesita corrección.',
      s_iec_email: 'Su correo de IEC', s_iec_email_expl: 'IEC asigna y provisiona su buzón del programa: usted solo lo recibe. Úselo para asuntos del programa; ingrese por el webmail de IEC o agréguelo a su aplicación de correo. IEC suspende el buzón si una asociación se pausa o se revoca.',
      assigned_by: 'Asignado por IEC',
      s_payout: 'Configuración de pagos', s_method: 'Método de pago', s_last4: 'Últimos 4 dígitos de la cuenta',
      s_last4_hint: 'Solo los últimos 4 dígitos: nunca ingrese un número de cuenta completo aquí. IEC confirma los datos completos de pago directamente con usted.',
      s_save_payout: 'Guardar configuración de pagos', s_payout_saved: 'Configuración de pagos guardada.',
      front_hero_k: 'IEC, Inc. · Portal de Socios',
      front_hero_t: 'El Portal de Socios de IEC',
      front_hero_p: 'El portal privado para los socios de IEC: registre las empresas que presenta, siga a cada una durante el proceso y controle sus comisiones por referidos. Todo aquí es IEC, Inc.: los socios trabajan directamente con IEC.',
      front_enter_t: 'Ingrese a su portal',
      front_enter_p: 'Su portal es personal: inicie sesión abajo con el código de activación único del enlace que IEC le envió por correo, cuando ambas firmas estén registradas: el Acuerdo de Referidos y el NDA. El acceso dura 30 días.',
      front_enter_p2: '¿Perdió su enlace o nunca lo recibió? Escriba a info@iecincglobal.com y IEC se lo reemitirá.',
      signin_t: 'Iniciar sesión',
      signin_p: 'Ingrese el código de activación de su enlace de invitación de IEC — o pegue el enlace completo — y se abrirá su panel. El código funciona una sola vez, y solo cuando ambas firmas están registradas.',
      signin_label: 'Código de activación o enlace completo de acceso',
      signin_btn: 'Ingresar a mi portal',
      signin_working: 'Ingresando…',
      signin_failed: 'Ese código o enlace no funcionó: puede haber vencido o ya haberse usado. Escriba a info@iecincglobal.com y IEC le reemitirá su enlace de acceso.',
      signin_first: 'Su enlace de acceso es válido. Primero viene un paso de firma: su portal se abre en cuanto ambas firmas estén registradas.',
      forgot_link: '¿Olvidó su enlace de acceso?',
      forgot_p: 'Ingrese el correo de su registro de socio y le enviaremos un enlace de acceso nuevo. Un enlace nuevo reemplaza cualquier enlace que le hayamos enviado antes.',
      forgot_label: 'Correo de su registro de socio',
      forgot_btn: 'Enviarme un enlace nuevo',
      forgot_working: 'Enviando…',
      forgot_sent: 'Si ese correo coincide con un registro de socio activo, un nuevo enlace de acceso va en camino. Revise su bandeja de entrada: el enlace funciona una sola vez.',
      pointer_new: '¿Nuevo en IEC?',
      pointer_link: 'Solicite acceso en la página del Portal de Socios',
      front_req_t: 'Solicitar acceso',
      front_req_p: '¿Aún no es socio? Solicite acceso abajo. IEC revisa cada solicitud; la firma del acuerdo y del NDA viene antes de que se abra cualquier acceso.',
      invited_by_line: 'Usted fue invitado por {name} ({company}). Su solicitud llega conectada a quien lo invitó.',
      join_title: 'Únase como socio de IEC',
      su_name: 'Su nombre legal completo', su_company: 'Su empresa', su_email: 'Correo', su_phone: 'Teléfono',
      su_type: '¿Qué lo describe mejor?', su_street: 'Dirección comercial', su_city: 'Ciudad', su_state: 'Estado', su_zip: 'Código postal',
      su_website: 'Sitio web', su_heard: '¿Cómo supo de IEC?', su_notes: '¿Algo que IEC debería saber?',
      su_send: 'Enviar la solicitud', su_sending: 'Enviando…',
      su_ok: 'Gracias: su solicitud está con IEC. El siguiente paso es firmar: IEC le enviará su Acuerdo de Referidos y el NDA, y su portal se abre cuando ambas firmas estén registradas.',
      su_dup: 'Este correo ya está registrado en el programa de socios de IEC. Si es usted, escriba a info@iecincglobal.com y lo resolvemos desde ahí.',
      agr_title: 'Un paso antes de que su portal se abra',
      agr_expl: 'Su enlace de activación es válido. El Acuerdo de Referidos de IEC a continuación es su paso de firma: léalo completo, escriba su nombre legal completo exactamente como aparece en su registro de invitación, y acepte. IEC registra su aceptación — nombre, hora y la versión del acuerdo — como su firma.',
      agr_for: 'Acuerdo para {name} · {company}',
      agr_status_signed: 'Acuerdo aceptado — versión {version}, registrado el {when}.',
      agr_typed: 'Escriba su nombre legal completo', agr_accept: 'He leído el acuerdo y lo acepto: esta es mi firma',
      agr_sign_btn: 'Aceptar y firmar', agr_name_mismatch: 'Escriba su nombre legal completo exactamente como aparece en su registro de invitación.',
      agr_fail: 'Esa aceptación no pudo registrarse: inténtelo de nuevo.',
      nda_step_t: 'El paso de confidencialidad',
      nda_step_p: 'Queda una firma: el acuerdo de confidencialidad (NDA) de IEC. Fírmelo, y cuando IEC lo haya registrado su portal se abre con este mismo enlace de activación.',
      nda_open: 'Abrir el NDA para firmar',
      agr_done_t: 'Ambas firmas están registradas',
      agr_done_p: 'Su acuerdo y su NDA están registrados. Abra su portal:',
      agr_open_btn: 'Abrir mi portal',
      demo_ribbon: 'Vista previa — datos de muestra (socio de prueba TEST AUDIT). Nada de esto se guarda.',
      demo_blocked: 'Solo vista previa: datos de muestra, nada se guarda.',
      stage_added: 'Agregado', stage_questionnaire_sent: 'Cuestionario enviado', stage_questionnaire_answered: 'Cuestionario respondido',
      stage_assessment_done: 'Evaluación realizada', stage_cnda_sent: 'NDA enviado', stage_cnda_signed: 'NDA firmado',
      stage_ready_to_register: 'Listo para registrar', stage_registered: 'Registrado',
      stage_intake_review: 'Revisión de ingreso de datos', stage_valuation_packaging: 'Valoración y empaquetado',
      stage_presented: 'Presentado', stage_buyer_diligence: 'Diligencia', stage_offer_received: 'Oferta recibida',
      stage_negotiating_terms: 'Negociación de términos', stage_license_sent: 'Licencia enviada', stage_license_signed: 'Licencia firmada',
      stage_data_delivery: 'Entrega de datos', stage_acceptance_review: 'Revisión de aceptación', stage_awaiting_payment: 'En espera de pago',
      stage_deal_closed: 'Acuerdo cerrado', stage_fee_earned: 'Comisión ganada', stage_fee_paid: 'Comisión pagada',
      ind_home_health: 'Salud en el hogar', ind_physical_therapy: 'Fisioterapia', ind_medical_practice: 'Práctica médica',
      ind_pharmacy: 'Farmacia', ind_gas_convenience: 'Gasolina / conveniencia', ind_general_business: 'Negocio general'
    }
  };
  function t(k) { return (T[LANG] && T[LANG][k]) || T.en[k] || k; }
  function tf(k, vars) {
    var s = t(k);
    for (var key in vars) s = s.replace('{' + key + '}', vars[key]);
    return s;
  }

  var STAGES = ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed',
    'ready_to_register', 'registered', 'intake_review', 'valuation_packaging', 'presented', 'buyer_diligence',
    'offer_received', 'negotiating_terms', 'license_sent', 'license_signed', 'data_delivery', 'acceptance_review',
    'awaiting_payment', 'deal_closed', 'fee_earned', 'fee_paid'];
  function stageLabel(s) { return t('stage_' + s) || s; }
  var INDUSTRIES = ['home-health', 'physical-therapy', 'medical-practice', 'pharmacy', 'gas-convenience', 'general-business'];
  function indLabel(i) { return t('ind_' + String(i).replace(/-/g, '_')) || i; }
  var BANDS = ['under-20', '20-34', '35-75', '76-200', 'over-200'];
  function bandLabel(b) {
    return { 'under-20': t('band_under'), '20-34': t('band_2034'), '35-75': t('band_3575'), '76-200': t('band_76200'), 'over-200': t('band_over') }[b] || b;
  }
  var EXEMPT = ['home-health', 'physical-therapy', 'medical-practice', 'pharmacy'];

  /* ------------------- demo fixture ------------------- */
  /* Sample dataset for ?demo=1 — the TEST AUDIT test partner and
     clearly synthetic clients. Mirrors the `me` payload shape. */
  var DEMO_QR = '<svg xmlns="http://www.w3.org/2000/svg" width="185" height="185" viewBox="0 0 185 185" role="img" aria-label="QR code"><rect width="185" height="185" fill="#FFFFFF"/><path d="M20 20h5v5h-5zM25 20h5v5h-5zM30 20h5v5h-5zM35 20h5v5h-5zM40 20h5v5h-5zM45 20h5v5h-5zM50 20h5v5h-5zM60 20h5v5h-5zM70 20h5v5h-5zM75 20h5v5h-5zM85 20h5v5h-5zM90 20h5v5h-5zM95 20h5v5h-5zM110 20h5v5h-5zM130 20h5v5h-5zM135 20h5v5h-5zM140 20h5v5h-5zM145 20h5v5h-5zM150 20h5v5h-5zM155 20h5v5h-5zM160 20h5v5h-5zM20 25h5v5h-5zM50 25h5v5h-5zM65 25h5v5h-5zM70 25h5v5h-5zM80 25h5v5h-5zM95 25h5v5h-5zM105 25h5v5h-5zM110 25h5v5h-5zM120 25h5v5h-5zM130 25h5v5h-5zM160 25h5v5h-5zM20 30h5v5h-5zM30 30h5v5h-5zM35 30h5v5h-5zM40 30h5v5h-5zM50 30h5v5h-5zM60 30h5v5h-5zM70 30h5v5h-5zM80 30h5v5h-5zM85 30h5v5h-5zM105 30h5v5h-5zM120 30h5v5h-5zM130 30h5v5h-5zM140 30h5v5h-5zM145 30h5v5h-5zM150 30h5v5h-5zM160 30h5v5h-5zM20 35h5v5h-5zM30 35h5v5h-5zM35 35h5v5h-5zM40 35h5v5h-5zM50 35h5v5h-5zM70 35h5v5h-5zM95 35h5v5h-5zM105 35h5v5h-5zM110 35h5v5h-5zM130 35h5v5h-5zM140 35h5v5h-5zM145 35h5v5h-5zM150 35h5v5h-5zM160 35h5v5h-5zM20 40h5v5h-5zM30 40h5v5h-5zM35 40h5v5h-5zM40 40h5v5h-5zM50 40h5v5h-5zM70 40h5v5h-5zM80 40h5v5h-5zM95 40h5v5h-5zM100 40h5v5h-5zM110 40h5v5h-5zM130 40h5v5h-5zM140 40h5v5h-5zM145 40h5v5h-5zM150 40h5v5h-5zM160 40h5v5h-5zM20 45h5v5h-5zM50 45h5v5h-5zM60 45h5v5h-5zM65 45h5v5h-5zM70 45h5v5h-5zM75 45h5v5h-5zM85 45h5v5h-5zM90 45h5v5h-5zM110 45h5v5h-5zM130 45h5v5h-5zM160 45h5v5h-5zM20 50h5v5h-5zM25 50h5v5h-5zM30 50h5v5h-5zM35 50h5v5h-5zM40 50h5v5h-5zM45 50h5v5h-5zM50 50h5v5h-5zM60 50h5v5h-5zM70 50h5v5h-5zM80 50h5v5h-5zM90 50h5v5h-5zM100 50h5v5h-5zM110 50h5v5h-5zM120 50h5v5h-5zM130 50h5v5h-5zM135 50h5v5h-5zM140 50h5v5h-5zM145 50h5v5h-5zM150 50h5v5h-5zM155 50h5v5h-5zM160 50h5v5h-5zM65 55h5v5h-5zM70 55h5v5h-5zM75 55h5v5h-5zM85 55h5v5h-5zM110 55h5v5h-5zM115 55h5v5h-5zM120 55h5v5h-5zM20 60h5v5h-5zM30 60h5v5h-5zM50 60h5v5h-5zM55 60h5v5h-5zM70 60h5v5h-5zM75 60h5v5h-5zM85 60h5v5h-5zM95 60h5v5h-5zM110 60h5v5h-5zM120 60h5v5h-5zM135 60h5v5h-5zM150 60h5v5h-5zM160 60h5v5h-5zM30 65h5v5h-5zM35 65h5v5h-5zM40 65h5v5h-5zM45 65h5v5h-5zM60 65h5v5h-5zM70 65h5v5h-5zM80 65h5v5h-5zM100 65h5v5h-5zM105 65h5v5h-5zM115 65h5v5h-5zM130 65h5v5h-5zM135 65h5v5h-5zM155 65h5v5h-5zM160 65h5v5h-5zM30 70h5v5h-5zM35 70h5v5h-5zM40 70h5v5h-5zM50 70h5v5h-5zM60 70h5v5h-5zM65 70h5v5h-5zM75 70h5v5h-5zM80 70h5v5h-5zM85 70h5v5h-5zM90 70h5v5h-5zM95 70h5v5h-5zM100 70h5v5h-5zM115 70h5v5h-5zM120 70h5v5h-5zM140 70h5v5h-5zM145 70h5v5h-5zM150 70h5v5h-5zM160 70h5v5h-5zM25 75h5v5h-5zM35 75h5v5h-5zM40 75h5v5h-5zM45 75h5v5h-5zM65 75h5v5h-5zM75 75h5v5h-5zM90 75h5v5h-5zM110 75h5v5h-5zM120 75h5v5h-5zM130 75h5v5h-5zM140 75h5v5h-5zM145 75h5v5h-5zM25 80h5v5h-5zM30 80h5v5h-5zM40 80h5v5h-5zM45 80h5v5h-5zM50 80h5v5h-5zM55 80h5v5h-5zM65 80h5v5h-5zM75 80h5v5h-5zM85 80h5v5h-5zM90 80h5v5h-5zM100 80h5v5h-5zM120 80h5v5h-5zM130 80h5v5h-5zM135 80h5v5h-5zM160 80h5v5h-5zM35 85h5v5h-5zM60 85h5v5h-5zM65 85h5v5h-5zM80 85h5v5h-5zM85 85h5v5h-5zM90 85h5v5h-5zM100 85h5v5h-5zM110 85h5v5h-5zM115 85h5v5h-5zM120 85h5v5h-5zM130 85h5v5h-5zM135 85h5v5h-5zM155 85h5v5h-5zM160 85h5v5h-5zM20 90h5v5h-5zM25 90h5v5h-5zM35 90h5v5h-5zM40 90h5v5h-5zM45 90h5v5h-5zM50 90h5v5h-5zM60 90h5v5h-5zM65 90h5v5h-5zM95 90h5v5h-5zM110 90h5v5h-5zM115 90h5v5h-5zM125 90h5v5h-5zM130 90h5v5h-5zM160 90h5v5h-5zM25 95h5v5h-5zM30 95h5v5h-5zM35 95h5v5h-5zM40 95h5v5h-5zM45 95h5v5h-5zM55 95h5v5h-5zM70 95h5v5h-5zM75 95h5v5h-5zM85 95h5v5h-5zM125 95h5v5h-5zM130 95h5v5h-5zM20 100h5v5h-5zM25 100h5v5h-5zM30 100h5v5h-5zM50 100h5v5h-5zM55 100h5v5h-5zM80 100h5v5h-5zM85 100h5v5h-5zM110 100h5v5h-5zM115 100h5v5h-5zM120 100h5v5h-5zM130 100h5v5h-5zM135 100h5v5h-5zM160 100h5v5h-5zM35 105h5v5h-5zM40 105h5v5h-5zM45 105h5v5h-5zM55 105h5v5h-5zM65 105h5v5h-5zM75 105h5v5h-5zM100 105h5v5h-5zM105 105h5v5h-5zM115 105h5v5h-5zM120 105h5v5h-5zM130 105h5v5h-5zM135 105h5v5h-5zM150 105h5v5h-5zM155 105h5v5h-5zM160 105h5v5h-5zM20 110h5v5h-5zM25 110h5v5h-5zM45 110h5v5h-5zM50 110h5v5h-5zM85 110h5v5h-5zM90 110h5v5h-5zM95 110h5v5h-5zM115 110h5v5h-5zM120 110h5v5h-5zM130 110h5v5h-5zM140 110h5v5h-5zM145 110h5v5h-5zM160 110h5v5h-5zM40 115h5v5h-5zM65 115h5v5h-5zM90 115h5v5h-5zM95 115h5v5h-5zM110 115h5v5h-5zM115 115h5v5h-5zM125 115h5v5h-5zM130 115h5v5h-5zM135 115h5v5h-5zM20 120h5v5h-5zM25 120h5v5h-5zM35 120h5v5h-5zM40 120h5v5h-5zM45 120h5v5h-5zM50 120h5v5h-5zM60 120h5v5h-5zM75 120h5v5h-5zM85 120h5v5h-5zM90 120h5v5h-5zM95 120h5v5h-5zM105 120h5v5h-5zM115 120h5v5h-5zM120 120h5v5h-5zM125 120h5v5h-5zM130 120h5v5h-5zM135 120h5v5h-5zM140 120h5v5h-5zM145 120h5v5h-5zM155 120h5v5h-5zM60 125h5v5h-5zM65 125h5v5h-5zM85 125h5v5h-5zM90 125h5v5h-5zM95 125h5v5h-5zM110 125h5v5h-5zM120 125h5v5h-5zM140 125h5v5h-5zM145 125h5v5h-5zM150 125h5v5h-5zM160 125h5v5h-5zM20 130h5v5h-5zM25 130h5v5h-5zM30 130h5v5h-5zM35 130h5v5h-5zM40 130h5v5h-5zM45 130h5v5h-5zM50 130h5v5h-5zM60 130h5v5h-5zM70 130h5v5h-5zM95 130h5v5h-5zM100 130h5v5h-5zM120 130h5v5h-5zM130 130h5v5h-5zM140 130h5v5h-5zM160 130h5v5h-5zM20 135h5v5h-5zM50 135h5v5h-5zM65 135h5v5h-5zM70 135h5v5h-5zM75 135h5v5h-5zM80 135h5v5h-5zM85 135h5v5h-5zM95 135h5v5h-5zM115 135h5v5h-5zM120 135h5v5h-5zM140 135h5v5h-5zM155 135h5v5h-5zM160 135h5v5h-5zM20 140h5v5h-5zM30 140h5v5h-5zM35 140h5v5h-5zM40 140h5v5h-5zM50 140h5v5h-5zM65 140h5v5h-5zM75 140h5v5h-5zM85 140h5v5h-5zM105 140h5v5h-5zM115 140h5v5h-5zM120 140h5v5h-5zM125 140h5v5h-5zM130 140h5v5h-5zM135 140h5v5h-5zM140 140h5v5h-5zM145 140h5v5h-5zM155 140h5v5h-5zM160 140h5v5h-5zM20 145h5v5h-5zM30 145h5v5h-5zM35 145h5v5h-5zM40 145h5v5h-5zM50 145h5v5h-5zM65 145h5v5h-5zM75 145h5v5h-5zM100 145h5v5h-5zM110 145h5v5h-5zM115 145h5v5h-5zM120 145h5v5h-5zM125 145h5v5h-5zM140 145h5v5h-5zM145 145h5v5h-5zM150 145h5v5h-5zM160 145h5v5h-5zM20 150h5v5h-5zM30 150h5v5h-5zM35 150h5v5h-5zM40 150h5v5h-5zM50 150h5v5h-5zM60 150h5v5h-5zM65 150h5v5h-5zM75 150h5v5h-5zM90 150h5v5h-5zM95 150h5v5h-5zM100 150h5v5h-5zM105 150h5v5h-5zM125 150h5v5h-5zM140 150h5v5h-5zM155 150h5v5h-5zM160 150h5v5h-5zM20 155h5v5h-5zM50 155h5v5h-5zM70 155h5v5h-5zM75 155h5v5h-5zM85 155h5v5h-5zM95 155h5v5h-5zM100 155h5v5h-5zM110 155h5v5h-5zM120 155h5v5h-5zM125 155h5v5h-5zM130 155h5v5h-5zM135 155h5v5h-5zM145 155h5v5h-5zM20 160h5v5h-5zM25 160h5v5h-5zM30 160h5v5h-5zM35 160h5v5h-5zM40 160h5v5h-5zM45 160h5v5h-5zM50 160h5v5h-5zM60 160h5v5h-5zM70 160h5v5h-5zM75 160h5v5h-5zM80 160h5v5h-5zM85 160h5v5h-5zM90 160h5v5h-5zM100 160h5v5h-5zM105 160h5v5h-5zM120 160h5v5h-5zM125 160h5v5h-5zM130 160h5v5h-5zM135 160h5v5h-5zM145 160h5v5h-5zM160 160h5v5h-5z" fill="#0E2A47"/></svg>';
  function demoMe() {
    var H = function (status, at, note) { return { status: status, at: at, note: note || null }; };
    var client = function (o) {
      return Object.assign({
        locations: null, employees: null, systems: null, yearsRecords: null,
        questionnaireAnswers: null, questionnaireSubmissionId: null,
        source: 'partner-entered', attributionStatus: 'credited',
        businessCity: '', businessState: '', licenseValue: null, ownerGross: null,
        feeAmount: null, feePaidAt: null, pipelineNote: null, pipelineUpdatedAt: null,
        history: [], deskStaffBand: '', amountApproved: false, approvedAmount: null, approvedAt: null
      }, o);
    };
    return {
      ok: true, demo: true,
      contractor: {
        id: 'demo-test-audit', email: 'test-audit-2026-11-21@example.com',
        name: 'TEST AUDIT 2026-11-21', company: 'TEST AUDIT 2026-11-21 LLC',
        status: 'active', ndaStatus: 'signed', agreementStatus: 'signed',
        agreementSignedAt: '2026-11-21T15:05:00Z', agreementAcceptedName: 'TEST AUDIT 2026-11-21',
        agreementAcceptedVersion: 'IEC-CRA-2026-11-12', agreementAcceptedVia: 'portal', phone: '(617) 555-0100',
        addressStreet: '100 Test Street', addressCity: 'Boston', addressState: 'MA', addressZip: '02136',
        website: '', source: 'public-signup', contractorType: 'Data network introductions',
        payoutMethod: 'wire', payoutLast4: '6789', w9OnFile: true, w9UploadedAt: '2026-11-21T15:20:00Z',
        createdAt: '2026-11-21T14:58:00Z', activatedAt: '2026-11-21T15:06:00Z'
      },
      frozen: false,
      clients: [
        client({ id: 'demo-c1', businessName: 'TEST AUDIT Client LLC', ownerName: 'Test Owner', ownerEmail: 'owner@test-audit-client.example', industry: 'general-business',
          status: 'registered', pipelineStatus: 'added', createdAt: '2026-11-21T15:31:00Z', locations: 2, employees: 34, deskStaffBand: '20-34',
          history: [H('added', '2026-11-21T15:31:00Z')] }),
        client({ id: 'demo-c2', businessName: 'Harbor Point Home Care LLC', ownerName: 'Dana Whitaker', ownerEmail: 'dana@harborpoint.example', industry: 'home-health',
          status: 'registered', pipelineStatus: 'questionnaire_answered', source: 'link', createdAt: '2026-11-19T10:12:00Z',
          locations: 3, employees: 58, yearsRecords: 9, questionnaireSubmissionId: 'demo-sub-2026-1102',
          history: [H('added', '2026-11-19T10:12:00Z'), H('questionnaire_answered', '2026-11-19T10:12:00Z')] }),
        client({ id: 'demo-c3', businessName: 'Northgate Retail Group Inc', ownerName: 'Marcus Bell', ownerEmail: 'mbell@northgate.example', industry: 'gas-convenience',
          status: 'registered', pipelineStatus: 'registered', createdAt: '2026-11-10T09:00:00Z', locations: 6, employees: 120, deskStaffBand: '76-200',
          history: [H('added', '2026-11-10T09:00:00Z'), H('questionnaire_sent', '2026-11-10T11:30:00Z'), H('questionnaire_answered', '2026-11-12T14:05:00Z'), H('assessment_done', '2026-11-14T10:00:00Z'), H('cnda_sent', '2026-11-15T09:15:00Z'), H('cnda_signed', '2026-11-17T16:40:00Z'), H('ready_to_register', '2026-11-18T10:20:00Z'), H('registered', '2026-11-18T10:21:00Z')] }),
        client({ id: 'demo-c4', businessName: 'Bay State Therapy Group LLC', ownerName: 'Priya Nair', ownerEmail: 'priya@baystatetherapy.example', industry: 'physical-therapy',
          status: 'registered', pipelineStatus: 'valuation_packaging', createdAt: '2026-11-05T13:00:00Z', locations: 5, employees: 86,
          amountApproved: true, approvedAmount: 216000, approvedAt: '2026-11-20T12:00:00Z',
          history: [H('added', '2026-11-05T13:00:00Z'), H('questionnaire_sent', '2026-11-05T15:00:00Z'), H('questionnaire_answered', '2026-11-07T09:30:00Z'), H('assessment_done', '2026-11-10T10:10:00Z'), H('cnda_sent', '2026-11-11T09:00:00Z'), H('cnda_signed', '2026-11-13T11:45:00Z'), H('ready_to_register', '2026-11-14T10:00:00Z'), H('registered', '2026-11-14T10:05:00Z'), H('intake_review', '2026-11-17T14:00:00Z'), H('valuation_packaging', '2026-11-20T12:30:00Z')] }),
        client({ id: 'demo-c5', businessName: 'Commonwealth Medical Practice PC', ownerName: 'Robert Chen', ownerEmail: 'rchen@commonwealthmed.example', industry: 'medical-practice',
          status: 'license_closed', pipelineStatus: 'deal_closed', createdAt: '2026-10-28T10:00:00Z', locations: 2, employees: 44,
          ownerGross: 500000, feeAmount: 10000, amountApproved: true, approvedAmount: 500000, approvedAt: '2026-11-15T10:00:00Z',
          history: [H('added', '2026-10-28T10:00:00Z'), H('questionnaire_answered', '2026-10-30T09:00:00Z'), H('registered', '2026-11-08T10:00:00Z'), H('intake_review', '2026-11-10T10:00:00Z'), H('valuation_packaging', '2026-11-13T10:00:00Z'), H('presented', '2026-11-16T10:00:00Z'), H('offer_received', '2026-11-18T10:00:00Z'), H('license_signed', '2026-11-20T10:00:00Z'), H('awaiting_payment', '2026-11-20T12:00:00Z'), H('deal_closed', '2026-11-21T09:00:00Z'), H('fee_earned', '2026-11-21T09:00:00Z')] }),
        client({ id: 'demo-c6', businessName: 'Old Colony Pharmacy Inc', ownerName: 'Grace Osei', ownerEmail: 'grace@oldcolony.example', industry: 'pharmacy',
          status: 'fee_paid', pipelineStatus: 'deal_closed', createdAt: '2026-10-12T10:00:00Z', locations: 4, employees: 63,
          ownerGross: 250000, feeAmount: 7500, feePaidAt: '2026-11-19T10:00:00Z', amountApproved: true, approvedAmount: 250000, approvedAt: '2026-10-30T10:00:00Z',
          history: [H('added', '2026-10-12T10:00:00Z'), H('registered', '2026-10-25T10:00:00Z'), H('deal_closed', '2026-11-04T10:00:00Z'), H('fee_earned', '2026-11-04T10:00:00Z'), H('fee_paid', '2026-11-19T10:00:00Z')] })
      ],
      feeTotals: { earned: 17500, paid: 7500, outstanding: 10000 },
      earnings: { projected: 6480, payable: 10000, paid: 7500, earned: 17500 },
      payout: { method: 'wire', last4: '6789', w9OnFile: true, w9UploadedAt: '2026-11-21T15:20:00Z', taxForm: { onFile: true, type: 'W-9', uploadedAt: '2026-11-21T15:20:00Z' }, set: true },
      agreementAccepted: { name: 'TEST AUDIT 2026-11-21', at: '2026-11-21T15:05:00Z', version: 'IEC-CRA-2026-11-12', via: 'portal' },
      iecEmail: 't.audit@iecincglobal.com',
      pipeline: ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed', 'ready_to_register', 'registered', 'intake_review', 'valuation_packaging', 'presented', 'buyer_diligence', 'offer_received', 'negotiating_terms', 'license_sent', 'license_signed', 'data_delivery', 'acceptance_review', 'awaiting_payment', 'deal_closed'],
      questionnaireSections: [],
      schedule: { status: 'ADOPTED', adoptedOn: '2026-11-19', examples: [
        { ownerGrossFrom: 100000, ownerGrossTo: 250000, feeFrom: 3000, feeTo: 7500, anchorGross: null, anchorFee: null },
        { ownerGrossFrom: 250000, ownerGrossTo: 500000, feeFrom: 7500, feeTo: 10000, anchorGross: null, anchorFee: null },
        { ownerGrossFrom: 500000, ownerGrossTo: 1000000, feeFrom: 10000, feeTo: 15000, anchorGross: null, anchorFee: null },
        { ownerGrossFrom: 1000000, ownerGrossTo: null, feeFrom: 15000, feeTo: null, anchorGross: 2000000, anchorFee: 25000 }
      ] },
      clientCode: 'VUNZ3YHP',
      clientLink: 'https://iecincglobal.com/r/VUNZ3YHP',
      clientLinkEmail: {
        subject: 'Your business data may be worth licensing \u2014 a short questionnaire from IEC, Inc.',
        body: ['Hello,', '', 'I am TEST AUDIT 2026-11-21, TEST AUDIT 2026-11-21 LLC. I work with IEC, Inc., and I am writing to introduce a program that may be worth your time.', '',
          'IEC helps business owners license their operational data. A license is not a sale: you keep full ownership of your data, the license covers defined uses for a defined term, and nothing moves without an agreement you sign.', '',
          'The first step is a short questionnaire \u2014 counts only. IEC reviews totals, years of history and the names of the systems you run. No individual records, no customer or patient information, ever.', '',
          'Approved licensing programs in this market range from $100,000 to $5,000,000 per term. The owner\u2019s share of any license IEC closes on your data is 80%, paid when the buyer pays.', '',
          'You can register your company and complete the questionnaire through my IEC client link:', 'https://iecincglobal.com/r/VUNZ3YHP', '',
          'The link is connected to my IEC partner record, so IEC can follow up with you directly and keep me posted on the process.', '',
          'Thank you for considering it.', '', 'TEST AUDIT 2026-11-21', 'TEST AUDIT 2026-11-21 LLC', 'IEC Partner'].join('\n'),
        link: 'https://iecincglobal.com/r/VUNZ3YHP'
      },
      inviteCode: 'AUDT2026',
      inviteLink: 'https://partners.iecincglobal.com/join/AUDT2026',
      inviteMessage: {
        subject: 'An invitation to the IEC Partner Program',
        body: ['Hello,', '', 'I am TEST AUDIT 2026-11-21, a partner with IEC, Inc. IEC works with business owners who license their operational data, and its partners are the people who make the introductions.', '',
          'I am inviting you to request your own IEC Partner Portal. Partners register the companies they introduce, follow each one through the process, and are paid a referral fee when a license closes \u2014 the terms are in the partner agreement you review and sign before anything opens.', '',
          'You can request access through my invitation link:', 'https://partners.iecincglobal.com/join/AUDT2026', '',
          'The link is connected to my IEC partner record, so IEC knows the invitation came from me.', '',
          'Thank you for considering it.', '', 'TEST AUDIT 2026-11-21', 'IEC Partner'].join('\n'),
        link: 'https://partners.iecincglobal.com/join/AUDT2026'
      },
      invitedPartners: [
        { name: 'Karim Haddad', company: 'Haddad Ventures LLC', status: 'active', createdAt: '2026-11-15T10:00:00Z' },
        { name: 'Lucia Mendes', company: 'Mendes Consulting LLC', status: 'invited', createdAt: '2026-11-20T10:00:00Z' }
      ],
      fastStart: { agreementAccepted: true, payoutsSet: true }
    };
  }

  /* ------------------------- core ------------------------- */
  var root = document.getElementById('pp-root');
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  /* The dedicated sign-in page (/signin, /es/signin) is for
     registered partners only: it renders the sign-in card alone —
     never the application form. The root door keeps both cards. */
  var SIGNIN_PAGE = window.PARTNER_PORTAL_PAGE === 'signin';
  var state = { me: null, route: 'dashboard', clientId: null, qual: null };
  function demoSuffix() { return DEMO ? '?demo=1' : ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMoney(n) {
    if (n == null || n === '') return '—';
    return '$' + Number(n).toLocaleString('en-US');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString(LANG === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    return d.toLocaleString(LANG === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  /* The agreement line the portal shows back to the partner —
     the acceptance of record (version + exact time) when he
     accepted in-portal; the office-recorded line when the
     agreement was signed on paper; empty while pending. */
  function agreementLine(me) {
    var a = me.agreementAccepted;
    if (a && a.version) return tf('agr_accepted_line', { version: a.version, when: fmtDateTime(a.at) });
    var c = me.contractor || {};
    if ((c.agreementStatus || 'pending') === 'signed') return tf('agr_status_office', { when: fmtDate(c.agreementSignedAt) });
    return '';
  }
  /* The signed-instruments row shown wherever an acceptance is
     displayed: read the full document inside the portal, or
     download the signed-copy PDF — for the agreement and for
     the CNDA alike. Each pair appears only while that signature
     stands. In the demo the buttons render (the layout is the
     point of the preview) and answer with the demo notice, the
     same pattern as the tax-form upload. */
  function docButtons(me) {
    var c = me.contractor || {};
    var out = '';
    if ((c.agreementStatus || 'pending') === 'signed') {
      out += DEMO
        ? '<button class="pp-btn" data-doc-demo>' + esc(t('doc_view_agreement')) + '</button> '
        : '<a class="pp-btn" href="#/agreement">' + esc(t('doc_view_agreement')) + '</a> ';
      out += DEMO
        ? '<button class="pp-btn pp-btn-ghost" data-doc-demo>' + esc(t('doc_download_pdf')) + '</button> '
        : '<a class="pp-btn pp-btn-ghost" href="' + downloadHref('my-agreement-pdf') + '">' + esc(t('doc_download_pdf')) + '</a> ';
    }
    if (c.ndaStatus === 'signed') {
      out += DEMO
        ? '<button class="pp-btn" data-doc-demo>' + esc(t('doc_view_cnda')) + '</button> '
        : '<a class="pp-btn" href="#/cnda">' + esc(t('doc_view_cnda')) + '</a> ';
      out += DEMO
        ? '<button class="pp-btn pp-btn-ghost" data-doc-demo>' + esc(t('doc_download_pdf')) + '</button>'
        : '<a class="pp-btn pp-btn-ghost" href="' + downloadHref('my-cnda-pdf') + '">' + esc(t('doc_download_pdf')) + '</a>';
    }
    return out ? '<p class="pp-p pp-doc-actions">' + out + '</p>' : '';
  }
  /* The in-portal document reader: the full signed instrument,
     fetched from the partner's own session (the API builds it
     from his record — there is nothing to name but his own). */
  function viewDocument(me, kind) {
    var isAgr = kind === 'agreement';
    setTimeout(function () { loadDocument(kind); }, 0);
    return '<p class="pp-p"><a class="pp-btn pp-btn-ghost" href="#/dashboard">' + esc(t('doc_back')) + '</a></p>' +
      '<h1 class="pp-h1">' + esc(isAgr ? t('doc_agr_heading') : t('doc_cnda_heading')) + '</h1>' +
      '<p class="pp-sub">' + esc(t('doc_your_copy')) + ' · ' + esc(isAgr ? (agreementLine(me) || t('pending')) : (me.contractor.ndaStatus === 'signed' ? t('doc_ndaline') : t('pending'))) + '</p>' +
      '<p class="pp-p">' + (DEMO
        ? '<button class="pp-btn" data-doc-demo>' + esc(t('doc_download_pdf')) + '</button>'
        : '<a class="pp-btn" href="' + downloadHref(isAgr ? 'my-agreement-pdf' : 'my-cnda-pdf') + '">' + esc(t('doc_download_pdf')) + '</a>') + '</p>' +
      '<div class="pp-card"><div class="pp-agreement pp-doc-full" id="pp-doc-body"><p class="pp-p pp-muted">' + esc(t('loading')) + '</p></div></div>';
  }
  function loadDocument(kind) {
    if (!document.getElementById('pp-doc-body')) return;
    api({ action: kind === 'agreement' ? 'my-agreement' : 'my-cnda' }, 'GET').then(function (res) {
      var box = document.getElementById('pp-doc-body');
      if (!box) return;
      if (res.status === 200 && res.body && res.body.ok && res.body.html) box.innerHTML = res.body.html;
      else box.innerHTML = '<p class="pp-error">' + esc(t('doc_load_fail')) + '</p>';
    }).catch(function () {
      var box = document.getElementById('pp-doc-body');
      if (box) box.innerHTML = '<p class="pp-error">' + esc(t('doc_load_fail')) + '</p>';
    });
  }
  function toast(msg) {
    var el = document.getElementById('pp-toast');
    if (!el) { el = document.createElement('div'); el.id = 'pp-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function api(body, method) {
    if (DEMO) return Promise.reject(new Error('demo'));
    /* The API takes the action from the QUERY STRING (the same
       contract the Desk and the legacy pages use); the rest of
       the payload travels in the POST body. */
    var action = body && body.action ? String(body.action) : '';
    var rest = {};
    if (body) for (var k in body) if (k !== 'action') rest[k] = body[k];
    var url = '/api/contractors?action=' + encodeURIComponent(action);
    if (method === 'GET') {
      /* GET actions (me, agreement) take their parameters in the
         query string — there is no body. */
      for (var q in rest) url += '&' + encodeURIComponent(q) + '=' + encodeURIComponent(rest[q]);
      return fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
    }
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest)
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }
  function apiGet(action) {
    if (DEMO) return Promise.reject(new Error('demo'));
    return fetch('/api/contractors?action=' + encodeURIComponent(action), { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast(t('copy_hint')); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else fallback();
  }
  function downloadHref(action) { return '/api/contractors?action=' + action; }

  /* ------------------------- routing ------------------------- */
  function currentHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    var parts = h.split('/');
    if (parts[0] === 'referrals' && parts[1]) return { route: 'client', id: parts[1] };
    if (['dashboard', 'referrals', 'earnings', 'partners', 'resources', 'settings', 'agreement', 'cnda'].indexOf(parts[0]) >= 0) return { route: parts[0] };
    return { route: 'dashboard' };
  }
  window.addEventListener('hashchange', function () { render(); });
  function go(route, id) {
    location.hash = '#/' + route + (id ? '/' + id : '');
  }

  /* ------------------------- boot ------------------------- */
  function boot() {
    if (location.pathname.indexOf('/join/') >= 0) { renderJoin(); return; }
    var token = params.get('t');
    if (token) { renderAgreement(token); return; }
    if (DEMO) { state.me = demoMe(); render(); return; }
    api({ action: 'me' }, 'GET').then(function (res) {
      if (res.status === 200 && res.body && res.body.ok) { state.me = res.body; render(); }
      else renderDoor();
    }).catch(function () { renderDoor(); });
  }

  /* The client link THIS portal presents: the standalone
     portal's own landing, re-based onto the current origin — on
     the portal host it is /r/<code>; in the site preview it is
     /partners/r/<code>, so a preview click follows the real
     route. The ready email template is re-based the same way
     (its link line swapped for the presented link). */
  function standaloneLink(me) {
    var code = me.clientCode || '';
    if (!code) return me.portalClientLink || me.clientLink || '';
    var onPartnersHost = /^partners\./.test(location.hostname);
    return location.origin + (onPartnersHost ? '/r/' : '/partners/r/') + code;
  }
  function displayEmail(me, link) {
    var src = me.portalClientLinkEmail || me.clientLinkEmail;
    if (!src) return null;
    var from = me.portalClientLinkEmail ? me.portalClientLink : me.clientLink;
    if (!from || from === link) return src;
    return {
      subject: src.subject,
      body: String(src.body || '').split(from).join(link),
      link: link
    };
  }

  /* ------------------------- shell ------------------------- */
  function render() {
    var me = state.me;
    if (!me) return;
    state.displayLink = standaloneLink(me);
    state.displayEmail = displayEmail(me, state.displayLink);
    var r = currentHash();
    state.route = r.route; state.clientId = r.id || null;
    var c = me.contractor;
    var navItems = [
      ['dashboard', t('nav_dashboard')], ['referrals', t('nav_referrals')], ['earnings', t('nav_earnings')],
      ['partners', t('nav_partners')], ['resources', t('nav_resources')], ['settings', t('nav_settings')]
    ];
    var nav = navItems.map(function (n) {
      return '<a href="#/' + n[0] + '" class="' + (r.route === n[0] || (r.route === 'client' && n[0] === 'referrals') ? 'active' : '') + '">' + esc(n[1]) + '</a>';
    }).join('');
    var frozenBanner = '';
    if (c.status === 'paused') frozenBanner = '<div class="pp-banner pp-banner-warn">' + esc(t('frozen_paused')) + '</div>';
    if (c.status === 'revoked') frozenBanner = '<div class="pp-banner pp-banner-danger">' + esc(t('frozen_revoked')) + '</div>';
    var body = '';
    if (r.route === 'dashboard') body = viewDashboard(me);
    else if (r.route === 'referrals') body = viewReferrals(me);
    else if (r.route === 'client') body = viewClient(me, r.id);
    else if (r.route === 'earnings') body = viewEarnings(me);
    else if (r.route === 'partners') body = viewPartners(me);
    else if (r.route === 'resources') body = viewResources(me);
    else if (r.route === 'settings') body = viewSettings(me);
    else if (r.route === 'agreement') body = viewDocument(me, 'agreement');
    else if (r.route === 'cnda') body = viewDocument(me, 'cnda');
    root.innerHTML =
      (DEMO ? '<div class="pp-demo-ribbon">' + esc(t('demo_ribbon')) + '</div>' : '') +
      '<div class="pp-app"><aside class="pp-side">' +
      '<div class="pp-brand"><img class="pp-brand-logo" src="/assets/iec-logo-light.png" alt="IEC, Inc."><div><div class="pp-brand-name">IEC, Inc.</div><div class="pp-brand-sub">' + esc(t('product')) + '</div></div></div>' +
      '<nav class="pp-nav">' + nav + '</nav>' +
      '<div class="pp-side-foot">' + esc(t('questions')) + ' <a href="mailto:info@iecincglobal.com">info@iecincglobal.com</a>' +
      (DEMO ? '' : '<br><button class="pp-linklike" id="pp-signout">' + esc(t('sign_out')) + '</button>') + '</div>' +
      '</aside><main class="pp-main">' +
      '<div class="pp-topbar"><div class="pp-topbar-id"><span class="pp-topbar-name">' + esc(c.name) + '</span>' +
      (c.company ? '<span class="pp-topbar-co">' + esc(c.company) + '</span>' : '') + '</div>' +
      (c.status === 'active' ? '<a class="pp-btn pp-btn-small" href="#/referrals">' + esc(t('add_client')) + '</a>' : '') + '</div>' +
      frozenBanner + body +
      '<footer class="pp-footer"><strong>IEC, Inc.</strong><span>· ' + esc(t('product')) + '</span><span>·</span><a href="https://iecincglobal.com">iecincglobal.com</a></footer>' +
      '</main></div>';
    bindShell();
  }
  function bindShell() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-doc-demo]'), function (b) {
      b.addEventListener('click', function () { toast(t('demo_blocked')); });
    });
    var so = document.getElementById('pp-signout');
    if (so) so.addEventListener('click', function () {
      api({ action: 'logout' }).then(function () { location.hash = ''; location.reload(); });
    });
    var b = document.getElementById('pp-copy-link');
    if (b) b.addEventListener('click', function () { copyText(state.displayLink, t('link_copied')); });
    var ce = document.getElementById('pp-copy-email');
    if (ce) ce.addEventListener('click', function () {
      copyText('Subject: ' + state.displayEmail.subject + '\n\n' + state.displayEmail.body, t('email_copied'));
    });
    var cm = document.getElementById('pp-copy-message');
    if (cm) cm.addEventListener('click', function () {
      copyText('Subject: ' + state.me.inviteMessage.subject + '\n\n' + state.me.inviteMessage.body, t('message_copied'));
    });
    var ci = document.getElementById('pp-copy-invite');
    if (ci) ci.addEventListener('click', function () { copyText(state.me.inviteLink, t('link_copied')); });
    var sent = document.getElementById('pp-i-sent');
    if (sent) sent.addEventListener('click', function () {
      if (DEMO) { toast(t('demo_blocked')); return; }
      api({ action: 'send-questionnaire', clientId: sent.getAttribute('data-id') }).then(function (res) {
        if (res.status === 200) { refresh(); } else toast(t('step_record_fail'));
      });
    });
    bindQualification(); bindAddClient(); bindSettingsForms(); bindTaxForm();
  }
  function refresh() {
    api({ action: 'me' }, 'GET').then(function (res) {
      if (res.status === 200 && res.body.ok) { state.me = res.body; render(); }
    });
  }

  /* ------------------------- views ------------------------- */
  function statCard(label, value, note) {
    return '<div class="pp-stat"><div class="pp-stat-label">' + esc(label) + '</div><div class="pp-stat-value">' + esc(value) + '</div>' +
      (note ? '<div class="pp-stat-note">' + esc(note) + '</div>' : '') + '</div>';
  }
  function viewDashboard(me) {
    var c = me.contractor;
    var fs = me.fastStart || {};
    var steps = [
      { done: !!fs.agreementAccepted, label: t('fs_agreement') },
      { done: false, label: t('fs_link'), linkText: t('copy_link'), action: 'copy' },
      { done: false, label: t('fs_education'), linkText: t('open_resources'), action: 'resources' },
      { done: !!fs.payoutsSet, label: t('fs_payouts'), linkText: t('go_settings'), action: 'settings' }
    ];
    var currentMarked = false;
    var stepsHtml = steps.map(function (s, i) {
      var right = '';
      if (!s.done && s.action === 'copy') right = '<button class="pp-btn pp-btn-small" id="pp-copy-link-2">' + esc(s.linkText) + '</button>';
      if (!s.done && s.action === 'resources') right = '<a class="pp-btn pp-btn-small" href="#/resources">' + esc(s.linkText) + '</a>';
      if (!s.done && s.action === 'settings') right = '<a class="pp-btn pp-btn-small" href="#/settings">' + esc(s.linkText) + '</a>';
      var isCurrent = !s.done && !currentMarked;
      if (isCurrent) { currentMarked = true; right = '<span class="pp-next-pill">' + esc(t('next_step')) + '</span>' + right; }
      return '<li class="' + (s.done ? 'done' : '') + (isCurrent ? ' current' : '') + '"><span class="pp-check">' + (s.done ? '✓' : String(i + 1)) + '</span><span class="pp-step-label">' + esc(s.label) + '</span>' + right + '</li>';
    }).join('');
    var html = '<h1 class="pp-h1">' + esc(t('welcome')) + ', ' + esc(c.name) + '</h1>' +
      '<p class="pp-sub">' + esc(c.company || '') + ' · ' + esc(t('agreement')) + ': ' + esc(c.agreementStatus === 'signed' ? t('signed') : t('pending')) +
      ' · ' + esc(t('nda')) + ': ' + esc(c.ndaStatus === 'signed' ? t('signed') : t('pending')) + '</p>';
    var aLine = agreementLine(me);
    html += '<div class="pp-card"><h2 class="pp-h2">' + esc(t('fast_start')) + '</h2><ol class="pp-steps">' + stepsHtml + '</ol>' +
      (aLine ? '<p class="pp-p pp-muted">' + esc(aLine) + '</p>' : '') + docButtons(me) + '</div>';
    html += '<div class="pp-stats">' +
      statCard(t('stat_referrals'), String((me.clients || []).length)) +
      statCard(t('stat_projected'), fmtMoney(me.earnings.projected)) +
      statCard(t('stat_payable'), fmtMoney(me.earnings.payable)) +
      statCard(t('stat_paid'), fmtMoney(me.earnings.paid)) + '</div>';
    if (state.displayLink) html += '<div class="pp-card pp-linkcard"><h2 class="pp-h2">' + esc(t('your_client_link')) + '</h2>' +
      '<p class="pp-p">' + esc(t('link_expl')) + '</p>' +
      '<div class="pp-linkrow"><label class="pp-label">' + esc(t('your_link')) + '</label>' +
      '<div class="pp-linkbox"><code id="pp-client-link">' + esc(state.displayLink) + '</code>' +
      '<button class="pp-btn" id="pp-copy-link">' + esc(t('copy_link')) + '</button></div></div>' +
      '<div class="pp-qr" id="pp-qr-box"></div>' +
      '<label class="pp-label">' + esc(t('email_template')) + '</label>' +
      '<div class="pp-template">' + esc(state.displayEmail ? (state.displayEmail.subject + '\n\n' + state.displayEmail.body) : '') + '</div>' +
      '<button class="pp-btn pp-btn-ghost" id="pp-copy-email">' + esc(t('copy_email')) + '</button></div>';
    html += '<div class="pp-card"><h2 class="pp-h2">' + esc(t('edu_highlights')) + '</h2><div class="pp-res-grid">' +
      '<div class="pp-res"><h3>' + esc(t('edu_film_t')) + '</h3><p>' + esc(t('edu_film_d')) + '</p>' +
      '<video class="pp-video" controls preload="none" poster="/media/iec-partner-program-video-poster.jpg" src="/media/iec-partner-program-video.mp4"></video></div>' +
      '<div class="pp-res"><h3>' + esc(t('edu_webinar_t')) + '</h3><p>' + esc(t('edu_webinar_d')) + '</p><a class="pp-btn pp-btn-ghost" href="#/resources">' + esc(t('open_resources')) + '</a></div>' +
      '<div class="pp-res"><h3>' + esc(t('edu_guides_t')) + '</h3><p>' + esc(t('edu_guides_d')) + '</p><a class="pp-btn pp-btn-ghost" href="#/resources">' + esc(t('open_resources')) + '</a></div>' +
      '</div></div>';
    setTimeout(function () {
      var b2 = document.getElementById('pp-copy-link-2');
      if (b2) b2.addEventListener('click', function () { copyText(state.displayLink, t('link_copied')); });
      var box = document.getElementById('pp-qr-box');
      if (box) {
        if (DEMO) box.innerHTML = DEMO_QR + '<div class="pp-qr-hint">' + esc(t('qr_hint')) + '</div>';
        else {
          fetch('/api/contractors?action=client-link-qr&form=portal', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (svg) {
            box.innerHTML = svg + '<div class="pp-qr-hint">' + esc(t('qr_hint')) + '</div>';
          }).catch(function () {});
        }
      }
    }, 0);
    return html;
  }
  function clientStage(c) { return c.pipelineStatus || c.status || 'added'; }
  function viewReferrals(me) {
    var rows = (me.clients || []).map(function (c) {
      return '<tr class="pp-rowlink" data-id="' + esc(c.id) + '"><td>' + esc(c.businessName) + '</td><td>' + esc(indLabel(c.industry)) + '</td>' +
        '<td><span class="pp-pill">' + esc(stageLabel(clientStage(c))) + '</span></td>' +
        '<td>' + esc(c.ownerName || '') + '</td><td>' + esc(fmtDate(c.createdAt)) + '</td>' +
        '<td>' + (c.amountApproved ? esc(fmtMoney(c.approvedAmount)) : '—') + '</td>' +
        '<td>' + (c.feeAmount != null ? esc(fmtMoney(c.feeAmount)) : '—') + '</td></tr>';
    }).join('');
    var html = '<h1 class="pp-h1">' + esc(t('referrals_title')) + '</h1><p class="pp-sub">' + esc(t('referrals_sub')) + '</p>';
    if (!me.clients || !me.clients.length) html += '<div class="pp-card pp-empty"><p>' + esc(t('no_clients')) + '</p>' +
      (!me.frozen ? '<button class="pp-btn" id="pp-empty-add">' + esc(t('add_client')) + '</button>' : '') + '</div>';
    else html += '<div class="pp-card pp-card-table"><table class="pp-table"><thead><tr><th>' + esc(t('col_business')) + '</th><th>' + esc(t('col_type')) + '</th><th>' + esc(t('col_stage')) + '</th><th>' + esc(t('col_contact')) + '</th><th>' + esc(t('col_date')) + '</th><th>' + esc(t('col_approved')) + '</th><th>' + esc(t('col_fee')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (!me.frozen) html += qualificationHtml() + addClientHtml(me);
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.pp-rowlink'), function (tr) {
        tr.addEventListener('click', function () { go('referrals', tr.getAttribute('data-id')); });
      });
      var ea = document.getElementById('pp-empty-add');
      if (ea) ea.addEventListener('click', function () {
        var q = document.getElementById('pp-qual-card');
        if (q) q.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }, 0);
    return html;
  }
  function qualificationHtml() {
    var bandOpts = BANDS.map(function (b) { return '<option value="' + b + '">' + esc(bandLabel(b)) + '</option>'; }).join('');
    var indOpts = INDUSTRIES.map(function (i) { return '<option value="' + i + '">' + esc(indLabel(i)) + '</option>'; }).join('');
    return '<div class="pp-card" id="pp-qual-card"><h2 class="pp-h2">' + esc(t('qual_title')) + '</h2>' +
      '<p class="pp-p">' + esc(t('qual_expl')) + '</p>' +
      '<div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('qual_band')) + '</label><select class="pp-input" id="pp-qual-band">' + bandOpts + '</select></div>' +
      '<div><label class="pp-label">' + esc(t('qual_industry')) + '</label><select class="pp-input" id="pp-qual-industry">' + indOpts + '</select></div>' +
      '</div><button class="pp-btn" id="pp-qual-go">' + esc(t('qual_continue')) + '</button>' +
      '<p class="pp-error" id="pp-qual-fail" hidden>' + esc(t('qual_fail')) + '</p></div>';
  }
  function addClientHtml(me) {
    var indOpts = INDUSTRIES.map(function (i) { return '<option value="' + i + '">' + esc(indLabel(i)) + '</option>'; }).join('');
    var sections = (me.questionnaireSections || []).map(function (sec) {
      var fields = sec.fields.map(function (f) {
        var input;
        if (f.type === 'select') {
          input = '<select class="pp-input" data-qkey="' + esc(f.key) + '"><option value=""></option>' +
            f.options.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(LANG === 'es' && o.labelEs ? o.labelEs : o.label) + '</option>'; }).join('') + '</select>';
        } else if (f.type === 'number') {
          input = '<input class="pp-input" type="number" min="0" step="1" data-qkey="' + esc(f.key) + '">';
        } else {
          input = '<input class="pp-input" type="text" data-qkey="' + esc(f.key) + '">';
        }
        return '<div><label class="pp-label">' + esc(LANG === 'es' && f.labelEs ? f.labelEs : f.label) + '</label>' + input + '</div>';
      }).join('');
      return '<h3 class="pp-h3">' + esc(LANG === 'es' && sec.titleEs ? sec.titleEs : sec.title) + '</h3><div class="pp-form-grid">' + fields + '</div>';
    }).join('');
    return '<div class="pp-card" id="pp-add-card" hidden><h2 class="pp-h2">' + esc(t('add_client')) + '</h2>' +
      '<p class="pp-p">' + esc(t('add_expl')) + '</p>' +
      '<div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('f_business')) + '</label><input class="pp-input" id="pp-f-business"></div>' +
      '<div><label class="pp-label">' + esc(t('f_owner')) + '</label><input class="pp-input" id="pp-f-owner"></div>' +
      '<div><label class="pp-label">' + esc(t('f_email')) + '</label><input class="pp-input" id="pp-f-email" type="email"></div>' +
      '<div><label class="pp-label">' + esc(t('business_type')) + '</label><select class="pp-input" id="pp-f-industry">' + indOpts + '</select></div>' +
      '<div><label class="pp-label">' + esc(t('f_locations')) + '</label><input class="pp-input" id="pp-f-locations" type="number" min="0" step="1"></div>' +
      '<div><label class="pp-label">' + esc(t('f_employees')) + '</label><input class="pp-input" id="pp-f-employees" type="number" min="0" step="1"></div>' +
      '<div><label class="pp-label">' + esc(t('f_systems')) + '</label><input class="pp-input" id="pp-f-systems"></div>' +
      '<div><label class="pp-label">' + esc(t('f_years')) + '</label><input class="pp-input" id="pp-f-years" type="number" min="0" step="1"></div>' +
      '</div>' +
      '<h3 class="pp-h3">' + esc(t('q_title')) + '</h3><p class="pp-p">' + esc(t('q_expl')) + '</p>' + sections +
      '<p class="pp-error" id="pp-add-error" hidden></p><p class="pp-ok" id="pp-add-ok" hidden></p>' +
      '<button class="pp-btn" id="pp-add-submit">' + esc(t('add_this')) + '</button></div>';
  }
  function bindQualification() {
    var goBtn = document.getElementById('pp-qual-go');
    if (!goBtn) return;
    goBtn.addEventListener('click', function () {
      var band = document.getElementById('pp-qual-band').value;
      var industry = document.getElementById('pp-qual-industry').value;
      var fail = document.getElementById('pp-qual-fail');
      if (band === 'under-20' && EXEMPT.indexOf(industry) < 0) {
        fail.hidden = false;
        document.getElementById('pp-add-card').hidden = true;
        return;
      }
      fail.hidden = true;
      state.qual = { band: band, industry: industry };
      var ind = document.getElementById('pp-f-industry');
      if (ind) ind.value = industry;
      document.getElementById('pp-add-card').hidden = false;
      document.getElementById('pp-add-card').scrollIntoView({ behavior: 'smooth' });
    });
  }
  function bindAddClient() {
    var btn = document.getElementById('pp-add-submit');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (DEMO) { toast(t('demo_blocked')); return; }
      var err = document.getElementById('pp-add-error');
      var ok = document.getElementById('pp-add-ok');
      err.hidden = true; ok.hidden = true;
      /* The qualification gate answers are required (the API
         refuses an add without them) — never submit without
         them; send the partner back to the gate instead. */
      if (!state.qual) {
        err.textContent = t('err_fields'); err.hidden = false;
        document.getElementById('pp-add-card').hidden = true;
        return;
      }
      var answers = {};
      Array.prototype.forEach.call(document.querySelectorAll('[data-qkey]'), function (el) {
        if (el.value !== '') answers[el.getAttribute('data-qkey')] = el.value;
      });
      var payload = {
        action: 'register-referral',
        businessName: document.getElementById('pp-f-business').value,
        ownerName: document.getElementById('pp-f-owner').value,
        ownerEmail: document.getElementById('pp-f-email').value,
        industry: document.getElementById('pp-f-industry').value,
        locations: document.getElementById('pp-f-locations').value,
        employees: document.getElementById('pp-f-employees').value,
        systems: document.getElementById('pp-f-systems').value,
        yearsRecords: document.getElementById('pp-f-years').value,
        questionnaireAnswers: Object.keys(answers).length ? answers : undefined,
        deskStaffBand: state.qual ? state.qual.band : undefined
      };
      btn.disabled = true; btn.textContent = t('adding');
      api(payload).then(function (res) {
        btn.disabled = false; btn.textContent = t('add_this');
        if (res.status === 200 && res.body.ok) {
          ok.textContent = t('added_ok'); ok.hidden = false;
          refresh();
        } else {
          var e = (res.body && res.body.error) || '';
          err.textContent = e === 'nda_required' || e === 'agreement_required' ? t('err_nda')
            : e === 'already_registered' ? t('err_already')
            : e === 'identifier_in_answers' || e === 'identifier_in_field' ? t('err_identifier')
            : e === 'not_qualified' ? t('qual_fail')
            : res.status === 401 ? t('err_session')
            : e === 'invalid_fields' ? t('err_fields') : t('err_generic');
          err.hidden = false;
        }
      }).catch(function () { btn.disabled = false; btn.textContent = t('add_this'); err.textContent = t('err_generic'); err.hidden = false; });
    });
  }

  function viewClient(me, id) {
    var c = null;
    (me.clients || []).forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return '<p class="pp-sub"><a href="#/referrals">' + esc(t('back_referrals')) + '</a></p>';
    var reached = {};
    (c.history || []).forEach(function (h) { reached[h.status] = h.at; });
    if (!Object.keys(reached).length && c.createdAt) reached.added = c.createdAt;
    var currentIdx = STAGES.indexOf(clientStage(c));
    var checklist = STAGES.map(function (s, i) {
      var done = reached[s] != null || i < currentIdx;
      var current = i === currentIdx && !reached[s];
      return '<li class="' + (done ? 'done' : current ? 'current' : '') + '"><span class="pp-num">' + (i + 1) + '</span><span class="pp-step-label">' + esc(stageLabel(s)) + '</span>' +
        (reached[s] ? '<span class="pp-step-date">' + esc(fmtDate(reached[s])) + '</span>' : '') + '</li>';
    }).join('');
    var timeline = (c.history || []).map(function (h) {
      return '<li><span class="pp-tl-dot"></span><div><div class="pp-tl-status">' + esc(stageLabel(h.status)) + '</div>' +
        '<div class="pp-tl-date">' + esc(fmtDate(h.at)) + (h.note ? ' · ' + esc(h.note) : '') + '</div></div></li>';
    }).join('');
    var amount = c.amountApproved
      ? '<div class="pp-amount">' + esc(fmtMoney(c.approvedAmount)) + '</div>'
      : '<p class="pp-p">' + esc(t('amount_pending')) + '</p>';
    var fee = c.feeAmount != null
      ? '<p class="pp-p">' + esc(tf('fee_line', { gross: fmtMoney(c.ownerGross), fee: fmtMoney(c.feeAmount) })) +
        (c.feePaidAt ? esc(tf('fee_paid_on', { date: fmtDate(c.feePaidAt) })) : esc(t('fee_due'))) + '</p>'
      : '<p class="pp-p">' + esc(t('fee_none')) + '</p>';
    var facts = [
      [t('owner_contact'), (c.ownerName || '') + (c.ownerEmail ? ' · ' + c.ownerEmail : '')],
      [t('business_type'), indLabel(c.industry)],
      [t('registered_through'), c.source === 'link' ? t('through_link') : t('through_you')],
      [t('locations'), c.locations], [t('employees'), c.employees],
      [t('desk_staff'), c.deskStaffBand ? bandLabel(c.deskStaffBand) : null],
      [t('systems'), c.systems], [t('years_records'), c.yearsRecords], [t('added_on'), fmtDate(c.createdAt)]
    ].filter(function (f) { return f[1] != null && f[1] !== ''; })
      .map(function (f) { return '<div class="pp-fact"><div class="pp-fact-k">' + esc(f[0]) + '</div><div class="pp-fact-v">' + esc(f[1]) + '</div></div>'; }).join('');
    var answers = '';
    if (c.questionnaireAnswers) {
      var rows = [];
      (me.questionnaireSections || []).forEach(function (sec) {
        sec.fields.forEach(function (f) {
          var v = c.questionnaireAnswers[f.key];
          if (v == null || v === '') return;
          var disp = v;
          if (f.type === 'select') {
            var opt = (f.options || []).filter(function (o) { return o.value === v; })[0];
            if (opt) disp = LANG === 'es' && opt.labelEs ? opt.labelEs : opt.label;
          }
          rows.push('<div class="pp-fact"><div class="pp-fact-k">' + esc(LANG === 'es' && f.labelEs ? f.labelEs : f.label) + '</div><div class="pp-fact-v">' + esc(disp) + '</div></div>');
        });
      });
      answers = rows.length ? '<h3 class="pp-h3">' + esc(t('answers')) + '</h3><div class="pp-facts">' + rows.join('') + '</div>' : '';
    }
    var qBlock = '';
    if (!me.frozen && clientStage(c) === 'added') {
      qBlock = '<div class="pp-card"><h3 class="pp-h3">' + esc(t('send_q')) + '</h3>' +
        '<p class="pp-p"><a class="pp-btn pp-btn-ghost" href="/questionnaire-form.html?segment=' + esc(c.industry) + '&amp;for=' + esc(c.id) + '" target="_blank" rel="noopener">' + esc(t('open_q')) + '</a> ' +
        '<button class="pp-btn" id="pp-i-sent" data-id="' + esc(c.id) + '">' + esc(t('i_sent_q')) + '</button></p></div>';
    }
    if (c.questionnaireSubmissionId) qBlock += '<p class="pp-ok">' + esc(tf('q_ref', { ref: c.questionnaireSubmissionId })) + '</p>';
    return '<p class="pp-sub"><a href="#/referrals">' + esc(t('back_referrals')) + '</a></p>' +
      '<h1 class="pp-h1">' + esc(c.businessName) + '</h1>' +
      '<p class="pp-sub"><span class="pp-pill">' + esc(stageLabel(clientStage(c))) + '</span></p>' +
      '<div class="pp-grid2"><div class="pp-card"><h2 class="pp-h2">' + esc(t('stage_progress')) + '</h2><ol class="pp-checklist">' + checklist + '</ol></div>' +
      '<div><div class="pp-card"><h2 class="pp-h2">' + esc(t('amount_approved')) + '</h2>' + amount +
      '<h3 class="pp-h3">' + esc(t('your_fee')) + '</h3>' + fee + '</div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('timeline')) + '</h2><ul class="pp-timeline">' + timeline + '</ul></div></div></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('profile')) + '</h2><div class="pp-facts">' + facts + '</div>' + answers + '</div>' + qBlock;
  }
  function viewEarnings(me) {
    var e = me.earnings;
    var bands = (me.schedule.examples || []).map(function (b) {
      var gross = b.ownerGrossTo == null ? fmtMoney(b.ownerGrossFrom) + '+' : fmtMoney(b.ownerGrossFrom) + ' – ' + fmtMoney(b.ownerGrossTo);
      var fee = b.feeTo == null ? fmtMoney(b.feeFrom) + '+' : fmtMoney(b.feeFrom) + ' – ' + fmtMoney(b.feeTo);
      return '<tr><td>' + esc(gross) + '</td><td>' + esc(fee) + '</td></tr>';
    }).join('');
    var payout = me.payout && me.payout.set
      ? esc(tf('payout_set', { method: me.payout.method === 'wire' ? t('method_wire') : t('method_check'), last4: me.payout.last4 }))
      : esc(t('payout_notset'));
    var dl = DEMO ? '' :
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('downloads')) + '</h2>' +
      '<p class="pp-p"><a class="pp-btn" href="' + downloadHref('plan-summary') + '">' + esc(t('dl_plan')) + '</a> ' +
      '<a class="pp-btn pp-btn-ghost" href="' + downloadHref('earnings-csv') + '">' + esc(t('dl_csv')) + '</a></p></div>';
    var aLine = agreementLine(me);
    return '<h1 class="pp-h1">' + esc(t('earnings_title')) + '</h1><p class="pp-sub">' + esc(t('earnings_sub')) + '</p>' +
      '<div class="pp-stats">' +
      statCard(t('stat_projected'), fmtMoney(e.projected), t('e_projected_n')) +
      statCard(t('stat_payable'), fmtMoney(e.payable), t('e_payable_n')) +
      statCard(t('stat_paid'), fmtMoney(e.paid), t('e_paid_n')) +
      statCard(t('e_earned'), fmtMoney(e.earned)) + '</div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('agreement')) + '</h2>' +
      '<p class="pp-p">' + esc(aLine || t('pending')) + '</p>' +
      '<p class="pp-p pp-muted">' + esc(t('agr_email_note')) + '</p>' + docButtons(me) + '</div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('schedule_title')) + '</h2>' +
      '<p class="pp-p pp-muted">' + esc(t('schedule_adopted')) + ' ' + esc(me.schedule.adoptedOn) + '</p>' +
      '<table class="pp-table"><thead><tr><th>' + esc(t('col_gross')) + '</th><th>' + esc(t('col_fee')) + '</th></tr></thead><tbody>' + bands + '</tbody></table>' +
      '<p class="pp-p">' + esc(t('schedule_fine')) + '</p></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('payout_title')) + '</h2><p class="pp-p">' + payout + '</p>' +
      '<p class="pp-p"><a class="pp-btn pp-btn-ghost" href="#/settings">' + esc(t('go_settings')) + '</a></p></div>' +
      taxFormCardHtml(me) + dl;
  }
  /* The tax-form card — the same block on Earnings and Settings:
     status (form type + upload date) once a form stands on file,
     the upload/replace control always. The file itself is kept
     on file by IEC; the portal never shows it back. */
  function taxFormCardHtml(me) {
    var form = (me.payout && me.payout.taxForm) || {};
    var status = form.onFile
      ? esc(tf('tax_on', { type: form.type || 'W-9', date: fmtDate(form.uploadedAt) }))
      : esc(t('tax_off'));
    return '<div class="pp-card"><h2 class="pp-h2">' + esc(t('tax_title')) + '</h2><p class="pp-p">' + status + '</p>' +
      '<p class="pp-p"><label class="pp-label" for="pp-tax-type">' + esc(t('tax_type')) + '</label> ' +
      '<select class="pp-input" id="pp-tax-type" style="width:auto;display:inline-block">' +
      '<option value="W-9"' + (form.type === 'W-8BEN' ? '' : ' selected') + '>W-9</option>' +
      '<option value="W-8BEN"' + (form.type === 'W-8BEN' ? ' selected' : '') + '>W-8BEN</option></select></p>' +
      '<p class="pp-p"><input type="file" id="pp-tax-file" accept="application/pdf,image/png,image/jpeg"> <button class="pp-btn" id="pp-tax-upload">' + esc(t('tax_upload')) + '</button></p>' +
      '<p class="pp-error" id="pp-tax-err" hidden></p><p class="pp-ok" id="pp-tax-ok" hidden></p></div>';
  }
  function bindTaxForm() {
    var btn = document.getElementById('pp-tax-upload');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (DEMO) { toast(t('demo_blocked')); return; }
      var input = document.getElementById('pp-tax-file');
      var typeSel = document.getElementById('pp-tax-type');
      var err = document.getElementById('pp-tax-err');
      var ok = document.getElementById('pp-tax-ok');
      err.hidden = true; ok.hidden = true;
      if (!input.files || !input.files[0]) { err.textContent = t('tax_fail'); err.hidden = false; return; }
      var file = input.files[0];
      if (file.size > 10 * 1024 * 1024) { err.textContent = t('tax_fail'); err.hidden = false; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(',')[1] || '';
        btn.disabled = true; btn.textContent = t('tax_uploading');
        api({ action: 'upload-w9', fileName: file.name, formType: typeSel ? typeSel.value : 'W-9', dataBase64: b64 }).then(function (res) {
          btn.disabled = false; btn.textContent = t('tax_upload');
          if (res.status === 200 && res.body.ok) { ok.textContent = t('tax_ok'); ok.hidden = false; refresh(); }
          else { err.textContent = t('tax_fail'); err.hidden = false; }
        }).catch(function () { btn.disabled = false; btn.textContent = t('tax_upload'); err.textContent = t('tax_fail'); err.hidden = false; });
      };
      reader.readAsDataURL(file);
    });
  }
  function viewPartners(me) {
    var rows = (me.invitedPartners || []).map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.company || '') + '</td><td>' + esc(p.status) + '</td><td>' + esc(fmtDate(p.createdAt)) + '</td></tr>';
    }).join('');
    var table = rows
      ? '<div class="pp-card pp-card-table"><table class="pp-table"><thead><tr><th>' + esc(t('col_partner')) + '</th><th>' + esc(t('col_company')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('col_joined')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="pp-card"><p class="pp-p">' + esc(t('no_invited')) + '</p></div>';
    return '<h1 class="pp-h1">' + esc(t('partners_title')) + '</h1><p class="pp-sub">' + esc(t('partners_sub')) + '</p>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('your_invite_link')) + '</h2>' +
      '<p class="pp-p">' + esc(t('invite_expl')) + '</p>' +
      '<div class="pp-linkbox"><code>' + esc(me.inviteLink || '') + '</code>' +
      '<button class="pp-btn" id="pp-copy-invite">' + esc(t('copy_link')) + '</button></div>' +
      '<label class="pp-label">' + esc(t('invite_message')) + '</label>' +
      '<div class="pp-template">' + esc(me.inviteMessage ? (me.inviteMessage.subject + '\n\n' + me.inviteMessage.body) : '') + '</div>' +
      '<button class="pp-btn pp-btn-ghost" id="pp-copy-message">' + esc(t('copy_message')) + '</button></div>' + table;
  }
  function resSlot(titleKey, descKey) {
    return '<div class="pp-res pp-res-slot"><h3>' + esc(t(titleKey)) + '</h3><p>' + esc(t(descKey)) + '</p><p class="pp-slot-note">' + esc(t('slot_in_production')) + '</p></div>';
  }
  function viewResources(me) {
    return '<h1 class="pp-h1">' + esc(t('resources_title')) + '</h1><p class="pp-sub">' + esc(t('resources_sub')) + '</p>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('res_getting_started')) + '</h2><div class="pp-res-grid">' +
      '<div class="pp-res"><h3>' + esc(t('edu_film_t')) + '</h3><p>' + esc(t('edu_film_d')) + '</p>' +
      '<video class="pp-video" controls preload="none" poster="/media/iec-partner-program-video-poster.jpg" src="/media/iec-partner-program-video.mp4"></video></div>' +
      resSlot('res_how_t', 'res_how_d') +
      '<div class="pp-res"><h3>' + esc(t('res_firstweek_t')) + '</h3><p>' + esc(t('res_firstweek_d')) + '</p></div>' +
      '</div></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('res_webinars')) + '</h2><div class="pp-res-grid">' +
      resSlot('edu_webinar_t', 'edu_webinar_d') + resSlot('res_owner_webinar_t', 'res_owner_webinar_d') +
      '</div></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('res_guides')) + '</h2><div class="pp-res-grid">' +
      resSlot('edu_guides_t', 'edu_guides_d') +
      '</div></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('res_brand')) + '</h2><div class="pp-res-grid">' +
      '<div class="pp-res"><h3>' + esc(t('res_logo_t')) + '</h3><p>' + esc(t('res_logo_d')) + '</p>' +
      '<a class="pp-btn pp-btn-ghost" href="/assets/iec-logo.png" download>' + esc(t('dl_logo')) + '</a></div>' +
      '</div></div>';
  }
  function viewSettings(me) {
    var c = me.contractor;
    return '<h1 class="pp-h1">' + esc(t('settings_title')) + '</h1><p class="pp-sub">' + esc(t('settings_sub')) + '</p>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('s_profile')) + '</h2>' +
      '<div class="pp-facts"><div class="pp-fact"><div class="pp-fact-k">' + esc(t('su_name')) + '</div><div class="pp-fact-v">' + esc(c.name) + '</div></div>' +
      '<div class="pp-fact"><div class="pp-fact-k">Email</div><div class="pp-fact-v">' + esc(c.email) + '</div></div>' +
      '<div class="pp-fact"><div class="pp-fact-k">' + esc(t('agreement')) + '</div><div class="pp-fact-v">' + esc(agreementLine(me) || t('pending')) + '</div></div></div>' +
      '<p class="pp-p pp-muted">' + esc(t('s_identity')) + '</p>' + docButtons(me) +
      '<div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('s_company')) + '</label><input class="pp-input" id="pp-s-company" value="' + esc(c.company || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_phone')) + '</label><input class="pp-input" id="pp-s-phone" value="' + esc(c.phone || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_street')) + '</label><input class="pp-input" id="pp-s-street" value="' + esc(c.addressStreet || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_city')) + '</label><input class="pp-input" id="pp-s-city" value="' + esc(c.addressCity || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_state')) + '</label><input class="pp-input" id="pp-s-state" value="' + esc(c.addressState || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_zip')) + '</label><input class="pp-input" id="pp-s-zip" value="' + esc(c.addressZip || '') + '"></div>' +
      '<div><label class="pp-label">' + esc(t('s_website')) + '</label><input class="pp-input" id="pp-s-website" value="' + esc(c.website || '') + '"></div>' +
      '</div><p class="pp-ok" id="pp-profile-ok" hidden>' + esc(t('s_saved')) + '</p>' +
      '<button class="pp-btn" id="pp-profile-save">' + esc(t('s_save')) + '</button></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('s_iec_email')) + '</h2>' +
      '<div class="pp-linkbox"><code>' + esc(me.iecEmail || '') + '</code><span class="pp-pill">' + esc(t('assigned_by')) + '</span></div>' +
      '<p class="pp-p">' + esc(t('s_iec_email_expl')) + '</p></div>' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('s_payout')) + '</h2>' +
      '<div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('s_method')) + '</label><select class="pp-input" id="pp-s-method">' +
      '<option value="">—</option><option value="wire"' + (c.payoutMethod === 'wire' ? ' selected' : '') + '>' + esc(t('method_wire')) + '</option>' +
      '<option value="check"' + (c.payoutMethod === 'check' ? ' selected' : '') + '>' + esc(t('method_check')) + '</option></select></div>' +
      '<div><label class="pp-label">' + esc(t('s_last4')) + '</label><input class="pp-input" id="pp-s-last4" maxlength="4" inputmode="numeric" value="' + esc(c.payoutLast4 || '') + '"></div>' +
      '</div><p class="pp-p pp-muted">' + esc(t('s_last4_hint')) + '</p>' +
      '<p class="pp-ok" id="pp-payout-ok" hidden>' + esc(t('s_payout_saved')) + '</p>' +
      '<button class="pp-btn" id="pp-payout-save">' + esc(t('s_save_payout')) + '</button></div>' +
      taxFormCardHtml(me);
  }
  function bindSettingsForms() {
    var ps = document.getElementById('pp-profile-save');
    if (ps) ps.addEventListener('click', function () {
      if (DEMO) { toast(t('demo_blocked')); return; }
      api({ action: 'update-profile', company: document.getElementById('pp-s-company').value,
        phone: document.getElementById('pp-s-phone').value, addressStreet: document.getElementById('pp-s-street').value,
        addressCity: document.getElementById('pp-s-city').value, addressState: document.getElementById('pp-s-state').value,
        addressZip: document.getElementById('pp-s-zip').value, website: document.getElementById('pp-s-website').value
      }).then(function (res) {
        if (res.status === 200) { document.getElementById('pp-profile-ok').hidden = false; refresh(); }
        else toast(t('err_generic'));
      });
    });
    var py = document.getElementById('pp-payout-save');
    if (py) py.addEventListener('click', function () {
      if (DEMO) { toast(t('demo_blocked')); return; }
      api({ action: 'update-payout', method: document.getElementById('pp-s-method').value,
        last4: document.getElementById('pp-s-last4').value }).then(function (res) {
        if (res.status === 200) { document.getElementById('pp-payout-ok').hidden = false; refresh(); }
        else toast(t('err_fields'));
      });
    });
  }

  /* ------------------------- front door ------------------------- */
  function renderFront() {
    root.innerHTML = '<div class="pp-front">' +
      '<div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('front_hero_k')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('front_hero_t')) + '</h1><p class="pp-front-p">' + esc(t('front_hero_p')) + '</p></div>' +
      '<div class="pp-front-grid">' +
      '<div class="pp-card"><h2 class="pp-h2">' + esc(t('front_enter_t')) + '</h2>' +
      '<p class="pp-p">' + esc(t('front_enter_p')) + '</p>' + signinFormHtml() + '<p class="pp-p">' + esc(t('front_enter_p2')) + '</p></div>' +
      '<div class="pp-card" id="pp-request-card"><h2 class="pp-h2">' + esc(t('front_req_t')) + '</h2>' +
      '<p class="pp-p">' + esc(t('front_req_p')) + '</p>' + signupFormHtml('') + '</div>' +
      '</div></div>' +
      '<div class="pp-front-foot"><strong>IEC, Inc.</strong> · ' + esc(t('product')) + ' · <a href="https://iecincglobal.com">iecincglobal.com</a></div>';
    bindSignin();
    bindSignup('');
    /* The application anchor: entrance points that send an
       applicant here (…/#request) land on the request form
       itself, not the top of the door. */
    if (String(location.hash || '').indexOf('request') >= 0) {
      var reqCard = document.getElementById('pp-request-card');
      if (reqCard) setTimeout(function () {
        reqCard.scrollIntoView();
        var first = document.getElementById('pp-su-name');
        if (first) first.focus({ preventScroll: true });
      }, 0);
    }
  }
  /* The unauthenticated door for THIS page: the root door shows
     both cards; the dedicated sign-in page shows the sign-in
     card alone (registered partners only — an applicant is
     pointed back to the root door's application, never given
     the form here). */
  function renderDoor() {
    if (SIGNIN_PAGE) renderSigninOnly();
    else renderFront();
  }
  function renderSigninOnly() {
    root.innerHTML = '<div class="pp-front">' +
      '<div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('front_hero_k')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('front_hero_t')) + '</h1><p class="pp-front-p">' + esc(t('front_hero_p')) + '</p></div>' +
      '<div class="pp-card" style="max-width:760px;margin:0 auto"><h2 class="pp-h2">' + esc(t('front_enter_t')) + '</h2>' +
      '<p class="pp-p">' + esc(t('front_enter_p')) + '</p>' + signinFormHtml() + '<p class="pp-p">' + esc(t('front_enter_p2')) + '</p>' +
      '<p class="pp-p">' + esc(t('pointer_new')) + ' <a href="' + (LANG === 'es' ? '/es#request' : '/#request') + '">' + esc(t('pointer_link')) + '</a></p></div>' +
      '</div>' +
      '<div class="pp-front-foot"><strong>IEC, Inc.</strong> · ' + esc(t('product')) + ' · <a href="https://iecincglobal.com">iecincglobal.com</a></div>';
    bindSignin();
  }
  function signinFormHtml() {
    return '<form id="pp-signin-form"><div><label class="pp-label" for="pp-signin-credential">' + esc(t('signin_label')) + '</label>' +
      '<input class="pp-input" id="pp-signin-credential" autocomplete="off" spellcheck="false"></div>' +
      '<p class="pp-error" id="pp-signin-error" hidden></p><p class="pp-ok" id="pp-signin-ok" hidden></p>' +
      '<button class="pp-btn" type="submit" id="pp-signin-submit">' + esc(t('signin_btn')) + '</button></form>' +
      /* Forgot-link recovery (the portal has no passwords by
         design): the partner gives the email on his record and
         the system emails a FRESH activation link. The answer
         on screen is generic whether or not the email matched —
         the card never confirms that an account exists. */
      '<div class="pp-forgot"><p class="pp-p"><button class="pp-textlink" type="button" id="pp-forgot-toggle">' + esc(t('forgot_link')) + '</button></p>' +
      '<form id="pp-forgot-form" hidden><p class="pp-p">' + esc(t('forgot_p')) + '</p>' +
      '<div><label class="pp-label" for="pp-forgot-email">' + esc(t('forgot_label')) + '</label>' +
      '<input class="pp-input" id="pp-forgot-email" type="email" autocomplete="email" spellcheck="false"></div>' +
      '<p class="pp-error" id="pp-forgot-error" hidden></p>' +
      '<button class="pp-btn pp-btn-ghost" type="submit" id="pp-forgot-submit">' + esc(t('forgot_btn')) + '</button></form>' +
      '<p class="pp-ok" id="pp-forgot-ok" hidden></p></div>';
  }
  function bindSignin() {
    var form = document.getElementById('pp-signin-form');
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (DEMO) { toast(t('demo_blocked')); return; }
      var err = document.getElementById('pp-signin-error');
      var ok = document.getElementById('pp-signin-ok');
      var btn = document.getElementById('pp-signin-submit');
      err.hidden = true; ok.hidden = true;
      btn.disabled = true; btn.textContent = t('signin_working');
      api({ action: 'signin', credential: document.getElementById('pp-signin-credential').value }).then(function (res) {
        btn.disabled = false; btn.textContent = t('signin_btn');
        if (res.status === 200 && res.body && res.body.ok && res.body.next === 'dashboard') {
          /* The session cookie is set — boot again and the
             dashboard opens. */
          boot();
        } else if (res.status === 200 && res.body && res.body.ok && res.body.next === 'agreement' && res.body.token) {
          ok.textContent = t('signin_first'); ok.hidden = false;
          renderAgreement(res.body.token);
        } else {
          err.textContent = (res.body && res.body.message) || t('signin_failed');
          err.hidden = false;
        }
      }).catch(function () {
        btn.disabled = false; btn.textContent = t('signin_btn');
        err.textContent = t('signin_failed'); err.hidden = false;
      });
    });
    var fToggle = document.getElementById('pp-forgot-toggle');
    var fForm = document.getElementById('pp-forgot-form');
    if (fToggle && fForm) fToggle.addEventListener('click', function () {
      fForm.hidden = !fForm.hidden;
      if (!fForm.hidden) { var em = document.getElementById('pp-forgot-email'); if (em) em.focus(); }
    });
    if (fForm) fForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (DEMO) { toast(t('demo_blocked')); return; }
      var ok = document.getElementById('pp-forgot-ok');
      var err = document.getElementById('pp-forgot-error');
      var btn = document.getElementById('pp-forgot-submit');
      ok.hidden = true; err.hidden = true;
      btn.disabled = true; btn.textContent = t('forgot_working');
      api({ action: 'recover', email: document.getElementById('pp-forgot-email').value }).then(function (res) {
        btn.disabled = false; btn.textContent = t('forgot_btn');
        if (res.status === 200 && res.body && res.body.ok) {
          ok.textContent = t('forgot_sent'); ok.hidden = false;
          fForm.reset();
        } else {
          err.textContent = t('err_generic'); err.hidden = false;
        }
      }).catch(function () {
        btn.disabled = false; btn.textContent = t('forgot_btn');
        err.textContent = t('err_generic'); err.hidden = false;
      });
    });
  }
  function signupFormHtml(inviteCode) {
    var typeOpts = ['Data network introductions', 'Clinical services', 'Consulting', 'Business services', 'Other']
      .map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    return '<form id="pp-signup-form"><div class="pp-form-grid">' +
      '<div><label class="pp-label">' + esc(t('su_name')) + '</label><input class="pp-input" id="pp-su-name" required></div>' +
      '<div><label class="pp-label">' + esc(t('su_company')) + '</label><input class="pp-input" id="pp-su-company" required></div>' +
      '<div><label class="pp-label">' + esc(t('su_email')) + '</label><input class="pp-input" id="pp-su-email" type="email" required></div>' +
      '<div><label class="pp-label">' + esc(t('su_phone')) + '</label><input class="pp-input" id="pp-su-phone" required></div>' +
      '<div><label class="pp-label">' + esc(t('su_type')) + '</label><select class="pp-input" id="pp-su-type">' + typeOpts + '</select></div>' +
      '<div><label class="pp-label">' + esc(t('su_street')) + '</label><input class="pp-input" id="pp-su-street"></div>' +
      '<div><label class="pp-label">' + esc(t('su_city')) + '</label><input class="pp-input" id="pp-su-city"></div>' +
      '<div><label class="pp-label">' + esc(t('su_state')) + '</label><input class="pp-input" id="pp-su-state"></div>' +
      '<div><label class="pp-label">' + esc(t('su_zip')) + '</label><input class="pp-input" id="pp-su-zip"></div>' +
      '<div><label class="pp-label">' + esc(t('su_website')) + '</label><input class="pp-input" id="pp-su-website"></div>' +
      '<div><label class="pp-label">' + esc(t('su_heard')) + '</label><input class="pp-input" id="pp-su-heard"></div>' +
      '</div><div><label class="pp-label">' + esc(t('su_notes')) + '</label><textarea class="pp-input" id="pp-su-notes" rows="3"></textarea></div>' +
      '<input type="text" id="pp-su-hp" autocomplete="off" style="display:none" tabindex="-1">' +
      '<p class="pp-error" id="pp-su-error" hidden></p><p class="pp-ok" id="pp-su-ok" hidden></p>' +
      '<button class="pp-btn" type="submit" id="pp-su-submit">' + esc(t('su_send')) + '</button></form>';
  }
  function bindSignup(inviteCode) {
    var form = document.getElementById('pp-signup-form');
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (DEMO) { toast(t('demo_blocked')); return; }
      var err = document.getElementById('pp-su-error');
      var ok = document.getElementById('pp-su-ok');
      var btn = document.getElementById('pp-su-submit');
      err.hidden = true; ok.hidden = true;
      btn.disabled = true; btn.textContent = t('su_sending');
      api({ action: 'signup', name: document.getElementById('pp-su-name').value,
        company: document.getElementById('pp-su-company').value, email: document.getElementById('pp-su-email').value,
        phone: document.getElementById('pp-su-phone').value, contractorType: document.getElementById('pp-su-type').value,
        street: document.getElementById('pp-su-street').value, city: document.getElementById('pp-su-city').value,
        state: document.getElementById('pp-su-state').value, zip: document.getElementById('pp-su-zip').value,
        website: document.getElementById('pp-su-website').value, heardAbout: document.getElementById('pp-su-heard').value,
        notes: document.getElementById('pp-su-notes').value, company_site_hp: document.getElementById('pp-su-hp').value,
        inviteCode: inviteCode || undefined }).then(function (res) {
        btn.disabled = false; btn.textContent = t('su_send');
        if (res.status === 200 && res.body.ok) { ok.textContent = t('su_ok'); ok.hidden = false; form.reset(); }
        else {
          err.textContent = res.body && res.body.error === 'already_registered' ? t('su_dup') : t('err_fields');
          err.hidden = false;
        }
      }).catch(function () { btn.disabled = false; btn.textContent = t('su_send'); err.textContent = t('err_generic'); err.hidden = false; });
    });
  }
  function renderJoin() {
    var code = location.pathname.split('/join/')[1] || '';
    root.innerHTML = '<div class="pp-front"><div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('front_hero_k')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('join_title')) + '</h1><p class="pp-front-p" id="pp-join-inviter">' + esc(t('loading')) + '</p></div>' +
      '<div class="pp-card" style="max-width:760px;margin:0 auto"><h2 class="pp-h2">' + esc(t('front_req_t')) + '</h2>' +
      '<p class="pp-p">' + esc(t('front_req_p')) + '</p>' + signupFormHtml(code) + '</div></div>' +
      '<div class="pp-front-foot"><strong>IEC, Inc.</strong> · ' + esc(t('product')) + ' · <a href="https://iecincglobal.com">iecincglobal.com</a></div>';
    bindSignup(code);
    if (!DEMO) {
      api({ action: 'resolve-invite', code: code }, 'GET').then(function (res) {
        var el = document.getElementById('pp-join-inviter');
        if (res.status === 200 && res.body.ok && res.body.partner) {
          el.textContent = tf('invited_by_line', { name: res.body.partner.name, company: res.body.partner.company || '' });
        } else el.textContent = t('front_hero_p');
      }).catch(function () { document.getElementById('pp-join-inviter').textContent = t('front_hero_p'); });
    } else {
      document.getElementById('pp-join-inviter').textContent = t('front_hero_p');
    }
  }

  /* ------------------------- agreement step ------------------------- */
  function renderAgreement(token) {
    root.innerHTML = '<div class="pp-front"><div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('front_hero_k')) + '</div>' +
      '<h1 class="pp-front-h">' + esc(t('agr_title')) + '</h1><p class="pp-front-p">' + esc(t('loading')) + '</p></div></div>';
    api({ action: 'agreement', token: token }, 'GET').then(function (res) {
      if (res.status !== 200 || !res.body.ok) { renderDoor(); return; }
      var d = res.body;
      var bodyHtml = '';
      if (d.agreementStatus === 'signed') {
        bodyHtml = d.acceptance
          ? '<p class="pp-ok">' + esc(tf('agr_status_signed', { version: d.acceptance.version || d.version, when: fmtDateTime(d.acceptance.at) })) + '</p>'
          : '<p class="pp-ok">' + esc(tf('agr_status_office', { when: fmtDate(d.contractor ? d.contractor.agreementSignedAt : null) })) + '</p>';
        if (d.ndaStatus === 'signed') {
          /* Opening the portal runs through the activation step
             itself: it consumes the link, sets this device's
             session, and routes to the standalone app on this
             host (the API's portalUrl names the legacy page and
             is not used here). */
          bodyHtml += '<h2 class="pp-h2">' + esc(t('agr_done_t')) + '</h2><p class="pp-p">' + esc(t('agr_done_p')) + '</p>' +
            '<p><a class="pp-btn" href="/api/contractors?action=activate&amp;token=' + encodeURIComponent(token) + '">' + esc(t('agr_open_btn')) + '</a></p>';
        } else {
          bodyHtml += '<h2 class="pp-h2">' + esc(t('nda_step_t')) + '</h2><p class="pp-p">' + esc(t('nda_step_p')) + '</p>' +
            '<p><a class="pp-btn" href="/cnda.html" target="_blank" rel="noopener">' + esc(t('nda_open')) + '</a></p>';
        }
      } else {
        bodyHtml = '<p class="pp-p">' + esc(tf('agr_for', { name: d.contractor.name, company: d.contractor.company || '' })) + '</p>' +
          '<div class="pp-agreement">' + d.html + '</div>' +
          '<div class="pp-signbox"><label class="pp-label">' + esc(t('agr_typed')) + '</label>' +
          '<input class="pp-input" id="pp-agr-name"><label class="pp-checkline"><input type="checkbox" id="pp-agr-check"> ' + esc(t('agr_accept')) + '</label>' +
          '<p class="pp-error" id="pp-agr-error" hidden></p>' +
          '<button class="pp-btn" id="pp-agr-sign">' + esc(t('agr_sign_btn')) + '</button></div>' +
          '<p class="pp-p pp-muted">' + esc(t('agr_email_note')) + '</p>';
      }
      root.innerHTML = '<div class="pp-front"><div class="pp-front-hero"><img class="pp-front-logo" src="/assets/iec-logo.png" alt="IEC, Inc."><div class="pp-front-k">' + esc(t('front_hero_k')) + '</div>' +
        '<h1 class="pp-front-h">' + esc(t('agr_title')) + '</h1><p class="pp-front-p">' + esc(t('agr_expl')) + '</p></div>' +
        '<div class="pp-card" style="max-width:860px;margin:0 auto">' + bodyHtml + '</div></div>';
      var btn = document.getElementById('pp-agr-sign');
      if (btn) btn.addEventListener('click', function () {
        var err = document.getElementById('pp-agr-error');
        err.hidden = true;
        api({ action: 'accept-agreement', token: token, typedName: document.getElementById('pp-agr-name').value,
          accept: document.getElementById('pp-agr-check').checked === true }).then(function (r2) {
          if (r2.status === 200 && r2.body.ok) renderAgreement(token);
          else {
            err.textContent = r2.body && r2.body.error === 'name_mismatch' ? t('agr_name_mismatch') : t('agr_fail');
            err.hidden = false;
          }
        });
      });
    }).catch(function () { renderDoor(); });
  }

  boot();
})();
