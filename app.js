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

    // State styling (<= 50 Reprobado vs >= 51 Habilitado)
    resultBanner.className = 'rounded-xl border-2 p-5 sm:p-6 shadow-sm';
    if (approved) {
      resultBanner.classList.add('border-usb-green', 'bg-emerald-50', 'text-emerald-950');
      resultBadge.className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-usb-green text-white';
      resultBadge.textContent = `${scaleLabel} — Habilitado (>= 51 pts)`;
      resultHeadline.textContent = `¡Dictamen Favorable (${scaleLabel})! Certificado desbloqueado para Microsoft Teams`;
      resultSubtext.textContent = 'Tu examen cumple con el umbral de habilitación establecido. Descarga el PDF oficial con el código Hash y súbelo a la Tarea de Teams (revisa también las sugerencias si deseas elevar aún más tu calificación).';
      resultTotalScore.className = 'text-4xl font-black tracking-tight text-usb-green';

      resultHash.textContent = result.verification_hash || 'N/A';
      approvalActions.classList.remove('hidden');
      retryActions.classList.add('hidden');

      populateCertificate(result, payload);
      certificateWrapper.classList.remove('hidden');
    } else {
      resultBanner.classList.add('border-usb-red', 'bg-red-50', 'text-red-950');
      resultBadge.className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-usb-red text-white';
      resultBadge.textContent = `${scaleLabel} (${total}/100 — Requiere >= 51)`;
      resultHeadline.textContent = `Auditoría: ${scaleLabel} — Se requiere reformulación metodológica`;
      resultSubtext.textContent = `Te faltan ${Math.max(1, 51 - total)} puntos para alcanzar el umbral mínimo de habilitación (51/100 - Aprobado). Revisa las penalizaciones de cada bloque, corrige directamente en el formulario y vuelve a auditar.`;
      resultTotalScore.className = 'text-4xl font-black tracking-tight text-usb-red';

      approvalActions.classList.add('hidden');
      retryActions.classList.remove('hidden');
      certificateWrapper.classList.add('hidden');
    }

    auditResults.classList.remove('hidden');
    auditResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    auditResults.focus({ preventScroll: true });
  };

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

    answersBody.appendChild(createExamSectionNode('Caja 1: Capítulo I — Problema y Trazabilidad de Objetivos (30 pts)', [
      ['1.1 Síntoma con evidencia empírica (Problema)', p.box1_symptom],
      ['1.2 Causa raíz', p.box1_cause],
      ['1.3 Efecto / Pronóstico', p.box1_effect],
      ['1.4 Pregunta General', p.box1_general_question],
      ['1.5 Objetivo General', p.box1_general_objective]
    ]));

    answersBody.appendChild(createExamSectionNode('Cuadro 6 — Objetivo Específico 1 (OE1)', [
      ['Objetivo Específico 1', p.oe1_text],
      ['Evidencia requerida', p.oe1_evidence],
      ['Fuente / Procedimiento', p.oe1_source],
      ['Criterio de análisis', p.oe1_criteria]
    ]));

    answersBody.appendChild(createExamSectionNode('Cuadro 6 — Objetivo Específico 2 (OE2)', [
      ['Objetivo Específico 2', p.oe2_text],
      ['Evidencia requerida', p.oe2_evidence],
      ['Fuente / Procedimiento', p.oe2_source],
      ['Criterio de análisis', p.oe2_criteria]
    ]));

    answersBody.appendChild(createExamSectionNode('Cuadro 6 — Objetivo Específico 3 (OE3)', [
      ['Objetivo Específico 3', p.oe3_text],
      ['Evidencia requerida', p.oe3_evidence],
      ['Fuente / Procedimiento', p.oe3_source],
      ['Criterio de análisis', p.oe3_criteria]
    ]));

    answersBody.appendChild(createExamSectionNode('Caja 2: Apartado 1.6 — Idea Preliminar de Solución y Viabilidad (25 pts)', [
      ['2.1 Límites del sistema (alcance y exclusiones)', p.box2_system_limits],
      ['2.2 Actores', p.box2_actors],
      ['2.3 Componentes', p.box2_components],
      ['2.4 Métricas técnicas de ingeniería (Cuadro 3)', p.box2_engineering_metrics],
      ['2.5 Supuestos, permisos éticos y acceso (Cuadro 8)', p.box2_ethics_access]
    ]));

    answersBody.appendChild(createExamSectionNode('Caja 3: Capítulo II — Fundamentación Teórica, Estado del Arte y Legal (25 pts)', [
      ['3.1 Antecedente 1 y vacío explícito (2.1.2)', p.box3_antecedent1],
      ['3.2 Antecedente 2 y vacío explícito (2.1.2)', p.box3_antecedent2],
      ['3.3 Teoría / Modelo rector conectado a variables (2.2.1)', p.box3_guiding_theory],
      ['3.4 Fundamento tecnológico (2.2.2)', p.box3_tech_foundation],
      ['3.5 Normativa y estándar aplicable (2.3.2)', p.box3_legal_standards]
    ]));

    answersBody.appendChild(createExamSectionNode('Caja 4: Defensa de Panel — Diferenciación Metodológica (20 pts)', [
      ['4.1 Diferenciación entre metodología de ingeniería y diseño metodológico de investigación', p.box4_methodology_diff]
    ]));
  };

  /**
   * Exports certificate + full exam as a clean PDF using html2pdf.js (with print fallback).
   */
  const exportCertificatePdf = async () => {
    if (!lastResult || Number(lastResult.total_score) < 51 || !lastPayload) return;

    if (typeof window.html2pdf !== 'function') {
      window.print();
      return;
    }

    const safeStudentId = (lastPayload.student_id || 'USB').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const hash = lastResult.verification_hash || 'VERIFICADO';
    const filename = `Certificado_Parcial2_USB_${safeStudentId}_${hash}.pdf`;

    downloadPdfBtn.disabled = true;
    const originalText = downloadPdfBtn.textContent;
    downloadPdfBtn.textContent = 'Generando PDF...';

    certificateDocument.classList.add('pdf-export-mode');

    try {
      await window.html2pdf()
        .set({
          margin: [10, 10, 12, 10],
          filename,
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        })
        .from(certificateDocument)
        .save();
    } catch {
      window.print();
    } finally {
      certificateDocument.classList.remove('pdf-export-mode');
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
        throw new Error(message);
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
