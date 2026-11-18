(() => {
  'use strict';

  const DRAFT_STORAGE_KEY = 'usb_auditor_parcial2_draft_v1';

  const form = document.getElementById('audit-form');
  const submitBtn = document.getElementById('submit-btn');
  const submitSpinner = document.getElementById('submit-spinner');
  const submitLabel = document.getElementById('submit-label');
  const validationBanner = document.getElementById('validation-banner');
  const validationBannerMsg = document.getElementById('validation-banner-msg');
  const serverErrorBanner = document.getElementById('server-error-banner');
  const serverErrorMsg = document.getElementById('server-error-msg');
  const clearDraftBtn = document.getElementById('clear-draft-btn');
  const draftStatus = document.getElementById('draft-status');
  const completionCountEl = document.getElementById('completion-count');
  const completionTotalEl = document.getElementById('completion-total');

  const auditResults = document.getElementById('audit-results');
  const resultBanner = document.getElementById('result-banner');
  const resultBadge = document.getElementById('result-badge');
  const resultHeadline = document.getElementById('result-headline');
  const resultSubtext = document.getElementById('result-subtext');
  const resultTotalScore = document.getElementById('result-total-score');
  const resultHash = document.getElementById('result-hash');
  const approvalActions = document.getElementById('approval-actions');
  const retryActions = document.getElementById('retry-actions');
  const criticalFixesCard = document.getElementById('critical-fixes-card');
  const criticalFixesList = document.getElementById('critical-fixes-list');

  const certificateWrapper = document.getElementById('certificate-wrapper');
  const certificateDocument = document.getElementById('certificate-document');
  const downloadPdfBtn = document.getElementById('download-pdf-btn');
  const printPdfBtn = document.getElementById('print-pdf-btn');

  const modalityGroup = document.getElementById('modality_group');

  let lastPayload = null;
  let lastResult = null;

  /**
   * Ordered list of logical fields (used for completion counter, payload extraction, and PDF rendering).
   */
  const TEXT_FIELD_NAMES = [
    'student_name', 'student_id', 'project_title',
    'box1_symptom', 'box1_cause', 'box1_effect', 'box1_general_question', 'box1_general_objective',
    'oe1_text', 'oe1_evidence', 'oe1_source', 'oe1_criteria',
    'oe2_text', 'oe2_evidence', 'oe2_source', 'oe2_criteria',
    'oe3_text', 'oe3_evidence', 'oe3_source', 'oe3_criteria',
    'box2_system_limits', 'box2_actors', 'box2_components', 'box2_engineering_metrics', 'box2_ethics_access',
    'box3_antecedent1', 'box3_antecedent2', 'box3_guiding_theory', 'box3_tech_foundation', 'box3_legal_standards',
    'box4_methodology_diff'
  ];

  const TOTAL_LOGICAL_FIELDS = TEXT_FIELD_NAMES.length + 1; // +1 for modality radio group

  /**
   * Returns the official academic scale label for a numeric score (0-100).
   */
  const getScaleLabel = (score) => {
    if (score >= 100) return 'Distinguido con Honores';
    if (score >= 90) return 'Excelente';
    if (score >= 80) return 'Muy Bueno';
    if (score >= 70) return 'Bueno';
    if (score >= 51) return 'Aprobado';
    return 'Reprobado';
  };

  /**
   * Fallback for browsers that lack CSS :user-invalid / :user-valid support.
   */
  const UserInvalidFallback = (() => {
    const dirtyState = new WeakMap();

    const updateState = (input) => {
      if (!input.checkValidity) return;
      const isValid = input.checkValidity();
      input.classList.toggle('user-invalid-fallback', !isValid);
      input.classList.toggle('user-valid-fallback', isValid);
      if (!isValid) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    };

    const handleEvent = (event) => {
      const input = event.target;
      if (event.type === 'reset') {
        for (const control of (input.elements || [])) {
          dirtyState.delete(control);
          control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
          control.removeAttribute('aria-invalid');
        }
        return;
      }
      if (!input.checkValidity || input.type === 'radio') return;

      if (event.type === 'input' || event.type === 'change') {
        const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
        state.hasInteracted = true;
        dirtyState.set(input, state);
        if (state.hasBlurred) {
          updateState(input);
        }
      } else if (event.type === 'blur') {
        const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
        state.hasBlurred = true;
        dirtyState.set(input, state);
        if (state.hasInteracted) {
          updateState(input);
        }
      }
    };

    const init = (root = document) => {
      if (CSS.supports('selector(:user-invalid)')) return;
      root.addEventListener('blur', handleEvent, true);
      root.addEventListener('input', handleEvent);
      root.addEventListener('change', handleEvent);
      root.addEventListener('reset', handleEvent, true);
    };

    return { init };
  })();

  /**
   * Keeps aria-invalid synchronized with native :user-invalid / validity state.
   */
  const syncAriaInvalid = (el) => {
    if (!el || !el.matches || !el.checkValidity || el.type === 'radio') return;
    const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
    const isInvalid = supportsUserInvalid
      ? (el.matches(':user-invalid') || (form.classList.contains('form-submitted') && !el.checkValidity()))
      : !el.checkValidity();
    el.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
  };

  const syncModalityGroupState = (showIfEmpty = false) => {
    const selected = form.querySelector('input[name="modality"]:checked');
    const isInvalid = !selected && (showIfEmpty || form.classList.contains('form-submitted'));
    modalityGroup.classList.toggle('group-invalid', isInvalid);
    return Boolean(selected);
  };

  /**
   * Collects form payload as structured JSON.
   */
  const collectFormData = () => {
    const data = {};
    for (const name of TEXT_FIELD_NAMES) {
      const el = form.elements[name];
      data[name] = el ? el.value.trim() : '';
    }
    const modalityChecked = form.querySelector('input[name="modality"]:checked');
    data.modality = modalityChecked ? modalityChecked.value : '';
    return data;
  };

  /**
   * Updates completion counter in the top bar.
   */
  const updateCompletionCounter = () => {
    const data = collectFormData();
    let completed = 0;
    for (const name of TEXT_FIELD_NAMES) {
      const el = form.elements[name];
      if (el && el.checkValidity() && data[name].length > 0) {
        completed += 1;
      }
    }
    if (data.modality) completed += 1;

    completionTotalEl.textContent = String(TOTAL_LOGICAL_FIELDS);
    completionCountEl.textContent = String(completed);
  };

  /**
   * Saves and restores drafts using localStorage.
   */
  const saveDraft = () => {
    try {
      const data = collectFormData();
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data));
      const now = new Date();
      const timeStr = now.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
      draftStatus.textContent = `Borrador guardado (${timeStr})`;
    } catch {
      draftStatus.textContent = 'Sin almacenamiento local';
    }
  };

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;

      for (const name of TEXT_FIELD_NAMES) {
        const el = form.elements[name];
        if (el && typeof saved[name] === 'string') {
          el.value = saved[name];
        }
      }
      if (typeof saved.modality === 'string' && saved.modality) {
        const radio = form.querySelector(`input[name="modality"][value="${CSS.escape(saved.modality)}"]`);
        if (radio) radio.checked = true;
      }
      draftStatus.textContent = 'Borrador restaurado';
    } catch {
      // Ignore corrupt draft
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    form.reset();
    form.classList.remove('form-submitted');
    modalityGroup.classList.remove('group-invalid');
    validationBanner.classList.add('hidden');
    for (const el of form.querySelectorAll('.form-control')) {
      el.removeAttribute('aria-invalid');
      el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
    }
    updateCompletionCounter();
    draftStatus.textContent = 'Borrador limpiado';
  };

  /**
   * Renders the full audit result safely into DOM nodes.
   */
  const renderAuditResult = (result, payload) => {
    lastResult = result;
    lastPayload = payload;

    const total = Number(result.total_score) || 0;
    const b1 = Number(result.block1_score) || 0;
    const b2 = Number(result.block2_score) || 0;
    const b3 = Number(result.block3_score) || 0;
    const b4 = Number(result.block4_score) || 0;
    const scaleLabel = result.scale_label || getScaleLabel(total);
    const approved = total >= 51;

    // Score cards
    document.getElementById('score-b1').textContent = `${b1} / 30`;
    document.getElementById('bar-b1').style.width = `${Math.min(100, Math.round((b1 / 30) * 100))}%`;

    document.getElementById('score-b2').textContent = `${b2} / 25`;
    document.getElementById('bar-b2').style.width = `${Math.min(100, Math.round((b2 / 25) * 100))}%`;

    document.getElementById('score-b3').textContent = `${b3} / 25`;
    document.getElementById('bar-b3').style.width = `${Math.min(100, Math.round((b3 / 25) * 100))}%`;

    document.getElementById('score-b4').textContent = `${b4} / 20`;
    document.getElementById('bar-b4').style.width = `${Math.min(100, Math.round((b4 / 20) * 100))}%`;

    resultTotalScore.textContent = String(total);

    // Feedback blocks
    document.getElementById('feedback-b1').textContent = result.block1_feedback || 'Sin observaciones adicionales.';
    document.getElementById('feedback-b2').textContent = result.block2_feedback || 'Sin observaciones adicionales.';
    document.getElementById('feedback-b3').textContent = result.block3_feedback || 'Sin observaciones adicionales.';
    document.getElementById('feedback-b4').textContent = result.block4_feedback || 'Sin observaciones adicionales.';

    // Critical fixes list
    criticalFixesList.replaceChildren();
    const fixes = Array.isArray(result.critical_fixes_needed) ? result.critical_fixes_needed.filter(Boolean) : [];
    if (fixes.length > 0) {
      for (const fix of fixes) {
        const li = document.createElement('li');
        li.textContent = String(fix);
        criticalFixesList.appendChild(li);
      }
      criticalFixesCard.classList.remove('hidden');
    } else {
      criticalFixesCard.classList.add('hidden');
    }

    // State styling (<= 50 Reprobado vs >= 51 Habilitado) — PDF siempre disponible
    resultBanner.className = 'rounded-xl border-2 p-5 sm:p-6 shadow-sm';
    resultHash.textContent = result.verification_hash || 'N/A';
    approvalActions.classList.remove('hidden');

    if (approved) {
      resultBanner.classList.add('border-usb-green', 'bg-emerald-50', 'text-emerald-950');
      resultBadge.className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-usb-green text-white';
      resultBadge.textContent = `${scaleLabel} — Habilitado (>= 51 pts)`;
      resultHeadline.textContent = `¡Dictamen Favorable (${scaleLabel})! Informe y Perfil listos para descargar`;
      resultSubtext.textContent = 'Tu evaluación fue completada. Descarga el PDF oficial con el desglose, código Hash y tu Perfil hasta el Capítulo II para subirlo a Microsoft Teams.';
      resultTotalScore.className = 'text-4xl font-black tracking-tight text-usb-green';
      retryActions.classList.add('hidden');
    } else {
      resultBanner.classList.add('border-usb-red', 'bg-red-50', 'text-red-950');
      resultBadge.className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-usb-red text-white';
      resultBadge.textContent = `${scaleLabel} (${total}/100 — Umbral >= 51)`;
      resultHeadline.textContent = `Auditoría: ${scaleLabel} — Puedes corregir o descargar tu informe en PDF`;
      resultSubtext.textContent = `Obtuviste ${total}/100 puntos. Puedes corregir tus respuestas arriba y volver a auditar para mejorar tu nota, o descargar ahora el PDF con el dictamen actual y su código Hash.`;
      resultTotalScore.className = 'text-4xl font-black tracking-tight text-usb-red';
      retryActions.classList.remove('hidden');
    }

    populateCertificate(result, payload);
    certificateWrapper.classList.remove('hidden');

    auditResults.classList.remove('hidden');
    auditResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    auditResults.focus({ preventScroll: true });
  };

  /**
   * Returns structured profile sections (shared between HTML preview and vector PDF generator).
   */
  const getProfileSections = (p) => [
    [
      'Caja 1: Capítulo I — Problema y Trazabilidad de Objetivos (30 pts)',
      [
        ['1.1 Síntoma con evidencia empírica (Problema)', p.box1_symptom],
        ['1.2 Causa raíz', p.box1_cause],
        ['1.3 Efecto / Pronóstico', p.box1_effect],
        ['1.4 Pregunta General', p.box1_general_question],
        ['1.5 Objetivo General', p.box1_general_objective]
      ]
    ],
    [
      'Cuadro 6 — Objetivo Específico 1 (OE1)',
      [
        ['Objetivo Específico 1', p.oe1_text],
        ['Evidencia requerida', p.oe1_evidence],
        ['Fuente / Procedimiento', p.oe1_source],
        ['Criterio de análisis', p.oe1_criteria]
      ]
    ],
    [
      'Cuadro 6 — Objetivo Específico 2 (OE2)',
      [
        ['Objetivo Específico 2', p.oe2_text],
        ['Evidencia requerida', p.oe2_evidence],
        ['Fuente / Procedimiento', p.oe2_source],
        ['Criterio de análisis', p.oe2_criteria]
      ]
    ],
    [
      'Cuadro 6 — Objetivo Específico 3 (OE3)',
      [
        ['Objetivo Específico 3', p.oe3_text],
        ['Evidencia requerida', p.oe3_evidence],
        ['Fuente / Procedimiento', p.oe3_source],
        ['Criterio de análisis', p.oe3_criteria]
      ]
    ],
    [
      'Caja 2: Apartado 1.6 — Idea Preliminar de Solución y Viabilidad (25 pts)',
      [
        ['2.1 Límites del sistema (alcance y exclusiones)', p.box2_system_limits],
        ['2.2 Actores', p.box2_actors],
        ['2.3 Componentes', p.box2_components],
        ['2.4 Métricas técnicas de ingeniería (Cuadros 3 y 7)', p.box2_engineering_metrics],
        ['2.5 Supuestos, permisos éticos y acceso (Cuadro 8)', p.box2_ethics_access]
      ]
    ],
    [
      'Caja 3: Capítulo II — Fundamentación Teórica, Estado del Arte y Legal (25 pts)',
      [
        ['3.1 Antecedente 1 y vacío explícito (2.1.2)', p.box3_antecedent1],
        ['3.2 Antecedente 2 y vacío explícito (2.1.2)', p.box3_antecedent2],
        ['3.3 Teoría / Modelo rector conectado a variables, categorías o requerimientos (2.2.1)', p.box3_guiding_theory],
        ['3.4 Fundamento tecnológico (2.2.2)', p.box3_tech_foundation],
        ['3.5 Normativa y estándar aplicable (2.3.2)', p.box3_legal_standards]
      ]
    ],
    [
      'Caja 4: Defensa de Panel — Diferenciación Metodológica (20 pts)',
      [
        ['4.1 Diferenciación entre metodología de ingeniería y diseño metodológico de investigación', p.box4_methodology_diff]
      ]
    ]
  ];

  /**
   * Builds a titled section block inside the certificate PDF view using safe DOM nodes.
   */
  const createExamSectionNode = (title, items) => {
    const section = document.createElement('div');
    section.className = 'border border-slate-200 rounded-lg p-4 space-y-2 avoid-break';

    const h4 = document.createElement('h4');
    h4.className = 'text-xs font-bold uppercase tracking-wide text-slate-900 border-b border-slate-200 pb-1.5';
    h4.textContent = title;
    section.appendChild(h4);

    for (const [label, value] of items) {
      const row = document.createElement('div');
      row.className = 'text-xs leading-relaxed';
      const strong = document.createElement('span');
      strong.className = 'font-bold text-slate-800';
      strong.textContent = `${label}: `;
      const span = document.createElement('span');
      span.className = 'text-slate-700 whitespace-pre-line';
      span.textContent = value || '—';
      row.append(strong, span);
      section.appendChild(row);
    }

    return section;
  };

  /**
   * Populates the official printable/PDF certificate + full exam response.
   */
  const populateCertificate = (result, p) => {
    const hash = result.verification_hash || 'PENDIENTE';
    const evaluatedAt = result.evaluated_at
      ? new Date(result.evaluated_at).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' });

    const total = Number(result.total_score) || 0;
    const scaleLabel = (result.scale_label || getScaleLabel(total)).toUpperCase();
    const approved = total >= 51;

    const statusBox = document.getElementById('cert-status-box');
    const statusText = document.getElementById('cert-status-text');
    const previewPill = document.getElementById('cert-preview-pill');

    statusBox.className = approved
      ? 'text-left sm:text-right border-2 border-usb-green bg-emerald-50 px-4 py-2.5 rounded-lg shrink-0'
      : 'text-left sm:text-right border-2 border-usb-red bg-red-50 px-4 py-2.5 rounded-lg shrink-0';
    statusText.className = approved
      ? 'text-lg font-black text-usb-green'
      : 'text-lg font-black text-usb-red';
    previewPill.className = approved
      ? 'text-xs font-semibold text-usb-green bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full'
      : 'text-xs font-semibold text-usb-red bg-red-50 border border-red-200 px-3 py-1 rounded-full';
    previewPill.textContent = approved ? 'Habilitado — Listo para PDF' : 'Informe preliminar — Listo para PDF';

    document.getElementById('cert-scale-label').textContent = scaleLabel;
    document.getElementById('cert-total-score').textContent = String(total);
    document.getElementById('cert-hash').textContent = hash;
    document.getElementById('cert-hash-inline').textContent = hash;
    document.getElementById('cert-student-name').textContent = p.student_name;
    document.getElementById('cert-student-id').textContent = p.student_id;
    document.getElementById('cert-project-title').textContent = p.project_title;
    document.getElementById('cert-modality').textContent = p.modality;
    document.getElementById('cert-date').textContent = evaluatedAt;

    document.getElementById('cert-b1-score').textContent = `${result.block1_score} / 30`;
    document.getElementById('cert-b1-feedback').textContent = result.block1_feedback;
    document.getElementById('cert-b2-score').textContent = `${result.block2_score} / 25`;
    document.getElementById('cert-b2-feedback').textContent = result.block2_feedback;
    document.getElementById('cert-b3-score').textContent = `${result.block3_score} / 25`;
    document.getElementById('cert-b3-feedback').textContent = result.block3_feedback;
    document.getElementById('cert-b4-score').textContent = `${result.block4_score} / 20`;
    document.getElementById('cert-b4-feedback').textContent = result.block4_feedback;

    const answersBody = document.getElementById('cert-answers-body');
    answersBody.replaceChildren();
    for (const [sectionTitle, sectionItems] of getProfileSections(p)) {
      answersBody.appendChild(createExamSectionNode(sectionTitle, sectionItems));
    }
  };

  /**
   * Normalizes text so jsPDF built-in Helvetica (WinAnsi) renders clean Spanish characters.
   */
  const pdfText = (input) =>
    String(input || '')
      .replace(/[\u2014\u2013]/g, '-')
      .replace(/\u2265/g, '>=')
      .replace(/\u2264/g, '<=')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u2022/g, '*')
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

  /**
   * Loads logousb_blue.png into a PNG Data URL preserving aspect ratio.
   */
  const loadLogoDataUrl = () =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve({
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = 'logousb_blue.png';
    });

  /**
   * Exports report + full profile up to Cap. II as a clean vector PDF using jsPDF.
   */
  const exportCertificatePdf = async () => {
    if (!lastResult || !lastPayload) return;

    const JsPdfCtor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
    if (typeof JsPdfCtor !== 'function') {
      window.print();
      return;
    }

    const safeStudentId = (lastPayload.student_id || 'USB').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const hash = lastResult.verification_hash || 'VERIFICADO';
    const filename = `Perfil_Parcial2_USB_${safeStudentId}_${hash}.pdf`;

    downloadPdfBtn.disabled = true;
    const originalText = downloadPdfBtn.textContent;
    downloadPdfBtn.textContent = 'Generando PDF...';

    try {
      const logo = await loadLogoDataUrl();
      const doc = new JsPdfCtor({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      const bottomLimit = pageHeight - 18;
      let y = 14;

      const ensureSpace = (neededMm) => {
        if (y + neededMm > bottomLimit) {
          doc.addPage();
          y = 16;
        }
      };

      const writeWrapped = (text, x, maxW, fontSize, style = 'normal', color = [15, 23, 42], lineHeight = 4.6) => {
        doc.setFont('helvetica', style);
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(pdfText(text), maxW);
        for (const line of lines) {
          ensureSpace(lineHeight + 1);
          doc.text(line, x, y);
          y += lineHeight;
        }
      };

      // Encabezado con Logo USB
      if (logo && logo.dataUrl && logo.width && logo.height) {
        const logoHeightMm = 14;
        const logoWidthMm = Math.min(55, logoHeightMm * (logo.width / logo.height));
        doc.addImage(logo.dataUrl, 'PNG', margin, y, logoWidthMm, logoHeightMm);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(95, 37, 159);
        doc.text(pdfText('UNIVERSIDAD SALESIANA DE BOLIVIA'), margin + logoWidthMm + 5, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(pdfText('Ingenieria de Sistemas - Metodologia de la Investigacion II'), margin + logoWidthMm + 5, y + 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(pdfText('Informe de Auditoria Metodologica y Perfil de Grado (hasta Cap. II - Guia 2026)'), margin + logoWidthMm + 5, y + 14.5);
        y += 18;
      } else {
        writeWrapped('UNIVERSIDAD SALESIANA DE BOLIVIA - INGENIERIA DE SISTEMAS', margin, contentWidth, 12, 'bold', [95, 37, 159], 5.5);
        writeWrapped('Informe de Auditoria Metodologica y Perfil de Grado (hasta Cap. II - Guia 2026)', margin, contentWidth, 9.5, 'bold', [15, 23, 42], 5);
        y += 2;
      }

      doc.setDrawColor(185, 28, 28);
      doc.setLineWidth(0.9);
      doc.line(margin, y, pageWidth - margin, y);
      y += 5;

      // Recuadro de Calificación y Hash
      const total = Number(lastResult.total_score) || 0;
      const scaleLabel = lastResult.scale_label || getScaleLabel(total);
      const isApproved = total >= 51;
      const evaluatedAt = lastResult.evaluated_at
        ? new Date(lastResult.evaluated_at).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })
        : new Date().toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' });

      doc.setFillColor(isApproved ? 236 : 254, isApproved ? 253 : 242, isApproved ? 245 : 242);
      doc.setDrawColor(isApproved ? 40 : 185, isApproved ? 167 : 28, isApproved ? 69 : 28);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y, contentWidth, 21, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(isApproved ? 22 : 185, isApproved ? 101 : 28, isApproved ? 52 : 28);
      doc.text(pdfText(`CALIFICACION: ${total} / 100 pts  -  ${scaleLabel.toUpperCase()}`), margin + 4, y + 7);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(pdfText(`Codigo Hash SHA-256 (Teams): ${hash}`), margin + 4, y + 13);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const modelInfo = lastResult.model_used ? ` | Auditor: ${lastResult.model_used}` : '';
      doc.text(pdfText(`Fecha de auditoria: ${evaluatedAt}${modelInfo}`), margin + 4, y + 18);
      y += 26;

      // Datos del Estudiante
      writeWrapped('0. IDENTIFICACION DEL ESTUDIANTE Y DE LA INVESTIGACION', margin, contentWidth, 10, 'bold', [15, 23, 42], 5);
      writeWrapped(`Estudiante: ${lastPayload.student_name}`, margin + 2, contentWidth - 4, 9, 'normal', [30, 41, 59], 4.5);
      writeWrapped(`RU (Registro Universitario): ${lastPayload.student_id}`, margin + 2, contentWidth - 4, 9, 'normal', [30, 41, 59], 4.5);
      writeWrapped(`Modalidad: ${lastPayload.modality}`, margin + 2, contentWidth - 4, 9, 'normal', [30, 41, 59], 4.5);
      writeWrapped(`Titulo de la Investigacion (Tentativo o Preliminar): ${lastPayload.project_title}`, margin + 2, contentWidth - 4, 9, 'normal', [30, 41, 59], 4.5);
      y += 3;

      // Desglose de Puntajes y Dictamen
      writeWrapped('DESGLOSE DE EVALUACION Y RETROALIMENTACION DEL AUDITOR', margin, contentWidth, 10, 'bold', [95, 37, 159], 5);
      const blocks = [
        ['Bloque 1 (Cap. I y Cuadro 6)', `${lastResult.block1_score} / 30 pts`, lastResult.block1_feedback, [185, 28, 28]],
        ['Bloque 2 (Apartado 1.6, Cuadros 3, 7 y 8)', `${lastResult.block2_score} / 25 pts`, lastResult.block2_feedback, [180, 83, 9]],
        ['Bloque 3 (Cap. II - Fundamentacion)', `${lastResult.block3_score} / 25 pts`, lastResult.block3_feedback, [95, 37, 159]],
        ['Bloque 4 (Defensa de Panel)', `${lastResult.block4_score} / 20 pts`, lastResult.block4_feedback, [21, 128, 61]]
      ];

      for (const [bTitle, bScore, bFeed, bColor] of blocks) {
        ensureSpace(14);
        writeWrapped(`${bTitle}: ${bScore}`, margin + 2, contentWidth - 4, 9.2, 'bold', bColor, 4.6);
        writeWrapped(bFeed || 'Sin observaciones.', margin + 4, contentWidth - 6, 8.7, 'normal', [51, 65, 85], 4.3);
        y += 1.5;
      }

      const fixes = Array.isArray(lastResult.critical_fixes_needed) ? lastResult.critical_fixes_needed.filter(Boolean) : [];
      if (fixes.length > 0) {
        ensureSpace(12);
        writeWrapped('Observaciones Criticas Prioritarias:', margin + 2, contentWidth - 4, 9.2, 'bold', [185, 28, 28], 4.6);
        for (const fix of fixes) {
          writeWrapped(`* ${fix}`, margin + 4, contentWidth - 6, 8.7, 'normal', [51, 65, 85], 4.3);
        }
        y += 2;
      }

      // Desarrollo completo del Perfil
      ensureSpace(14);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 5;
      writeWrapped('REGISTRO COMPLETO DEL PERFIL RESPONDIDO (HASTA CAPITULO II)', margin, contentWidth, 10.5, 'bold', [95, 37, 159], 5.5);

      for (const [sectionTitle, sectionItems] of getProfileSections(lastPayload)) {
        ensureSpace(14);
        y += 1.5;
        writeWrapped(sectionTitle, margin, contentWidth, 9.5, 'bold', [15, 23, 42], 5);
        for (const [label, value] of sectionItems) {
          ensureSpace(10);
          writeWrapped(`${label}:`, margin + 2, contentWidth - 4, 8.7, 'bold', [51, 65, 85], 4.2);
          writeWrapped(value || '[No respondido / Sin avance registrado]', margin + 4, contentWidth - 6, 8.7, 'normal', [30, 41, 59], 4.2);
        }
      }

      // Pie de página con numeración en todas las páginas
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(
          pdfText(`Auditor Metodologico USB 2026 - Hash: ${hash} - Pagina ${i} de ${totalPages}`),
          margin,
          pageHeight - 9
        );
      }

      doc.save(filename);
    } catch {
      window.print();
    } finally {
      downloadPdfBtn.disabled = false;
      downloadPdfBtn.textContent = originalText;
    }
  };

  /**
   * Handles form submission to backend evaluator.
   */
  const handleFormSubmit = async (event) => {
    event.preventDefault();
    serverErrorBanner.classList.add('hidden');

    form.classList.add('form-submitted');
    const modalityOk = syncModalityGroupState(true);

    // Sync aria-invalid for every control
    const controls = Array.from(form.querySelectorAll('.form-control'));
    let firstInvalid = null;
    let invalidCount = 0;

    for (const control of controls) {
      syncAriaInvalid(control);
      if (!control.checkValidity()) {
        invalidCount += 1;
        if (!firstInvalid) firstInvalid = control;
      }
    }

    if (!modalityOk) {
      invalidCount += 1;
      if (!firstInvalid) {
        firstInvalid = form.querySelector('input[name="modality"]');
      }
    }

    if (invalidCount > 0 || !form.checkValidity()) {
      validationBannerMsg.textContent = `Hay ${invalidCount} campo(s) obligatorio(s) pendiente(s) en la sección "0. Identificación del Estudiante y del Proyecto". Las Cajas 1 a 4 son opcionales.`;
      validationBanner.classList.remove('hidden');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstInvalid.focus({ preventScroll: true });
      }
      return;
    }

    validationBanner.classList.add('hidden');
    const payload = collectFormData();

    // Disable submit only while request is in flight to prevent double-posts
    submitBtn.disabled = true;
    submitSpinner.classList.remove('hidden');
    submitLabel.textContent = 'Auditando rigor metodológico...';

    try {
      const response = await fetch('evaluate.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        const message = (body && body.error) ? body.error : `El servidor respondió con estado HTTP ${response.status}.`;
        const detail = (body && body.detail) ? ` Detalle: ${body.detail}` : '';
        throw new Error(`${message}${detail}`);
      }

      renderAuditResult(body, payload);
    } catch (err) {
      serverErrorMsg.textContent = err instanceof Error
        ? err.message
        : 'Ocurrió un error inesperado al conectar con el servicio de auditoría.';
      serverErrorBanner.classList.remove('hidden');
      serverErrorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      submitBtn.disabled = false;
      submitSpinner.classList.add('hidden');
      submitLabel.textContent = 'Auditar Examen con Gemini AI';
    }
  };

  /**
   * Initialization
   */
  const init = () => {
    UserInvalidFallback.init(form);
    restoreDraft();
    updateCompletionCounter();

    form.addEventListener('blur', (event) => {
      syncAriaInvalid(event.target);
    }, true);

    form.addEventListener('input', (event) => {
      if (event.target.hasAttribute('aria-invalid')) {
        syncAriaInvalid(event.target);
      }
      updateCompletionCounter();
      saveDraft();
    });

    form.addEventListener('change', (event) => {
      if (event.target.name === 'modality') {
        syncModalityGroupState(false);
      }
      updateCompletionCounter();
      saveDraft();
    });

    form.addEventListener('submit', handleFormSubmit);
    clearDraftBtn.addEventListener('click', clearDraft);
    downloadPdfBtn.addEventListener('click', exportCertificatePdf);
    printPdfBtn.addEventListener('click', () => window.print());
  };

  document.addEventListener('DOMContentLoaded', init);
})();
