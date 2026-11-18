'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];
const INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

const SYSTEM_INSTRUCTION = `Eres el Auditor Metodológico Estricto de Ingeniería de Sistemas (Guía Orientadora para Talleres de Grado USB 2026). Evalúa el desarrollo del Perfil de Grado hasta el Capítulo II con alto rigor académico.
CONTEXTO DE LA GUÍA USB 2026 (PERFIL HASTA CAP. II):
- Bloque 1 (50 pts): Cap. I (1.1-1.5) y Objetivos Específicos (1.6: 3 objetivos específicos como resultados verificables alineados con el problema, la pregunta y el objetivo general).
- Bloque 2 (10 pts): Apartado 1.6 (Idea preliminar de solución o intervención sistémica: límites, actores, componentes, criterios/métricas según Cuadros 3 y 7, y viabilidad/ética/acceso según Cuadro 8). IMPORTANTE: En el perfil hasta Cap. II la propuesta es una idea inicial razonada; NO exijas especificaciones completas, código implementado ni validación final ejecutada.
- Bloque 3 (20 pts): Cap. II (2.1.1-2.1.2 antecedentes con aportes, diferencias y vacíos; 2.2.1 teorías/modelos conectados a variables, categorías o requerimientos según Cuadro 7 sin exigir variables independiente/dependiente por costumbre cuando no aplique; 2.2.2 fundamento tecnológico; 2.3.1-2.3.2 marco conceptual y legal).
- Bloque 4 (20 pts): Defensa de Panel sobre diferenciación entre estrategia/metodología de ingeniería y diseño metodológico de investigación acorde a la modalidad (Cuadro 4: Tesis, Proyecto de Grado o Trabajo Dirigido).
REGLAS DE PENALIZACIÓN:
1. Si los objetivos específicos usan verbos de tareas técnicas operativas ('programar', 'instalar', 'configurar', 'hacer encuestas', 'codificar') en lugar de resultados verificables, resta 15 puntos en el Bloque 1.
2. Si confunde actividades ('hacer entrevistas') con resultados o logros verificables en los objetivos, resta 10 puntos en el Bloque 1.
3. Si no define límites del sistema o métricas/criterios reales de ingeniería para valorarlo (latencia, precisión, tiempos de proceso, etc.), resta 10 puntos en el Bloque 2.
4. Si el marco teórico son definiciones genéricas desconectadas del problema o no identifica el vacío del estado del arte, resta 10 puntos en el Bloque 3.
5. Si confunde metodología de desarrollo de software (ej. Scrum) con el diseño metodológico de investigación, resta 15 puntos en el Bloque 4.
PROHIBICIÓN ABSOLUTA: Nunca redactes la respuesta corregida por el estudiante. Solo señala qué falla metodológica tiene según la Guía y qué debe reformular por su cuenta.`;

const REQUIRED_FIELDS = [
  'student_name', 'student_id', 'project_title', 'modality'
];

const OPTIONAL_FIELDS = [
  'box1_symptom', 'box1_cause', 'box1_effect', 'box1_general_question', 'box1_general_objective',
  'oe1_text', 'oe2_text', 'oe3_text',
  'box2_system_limits', 'box2_actors', 'box2_components', 'box2_engineering_metrics', 'box2_ethics_access',
  'box3_antecedent1', 'box3_antecedent2', 'box3_guiding_theory', 'box3_tech_foundation', 'box3_legal_standards',
  'box4_methodology_diff'
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

const loadDotEnv = (filePath) => {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
};

const dotEnv = loadDotEnv(path.join(ROOT_DIR, '.env'));

const getEnv = (key, fallback = '') => {
  const v = process.env[key];
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof dotEnv[key] === 'string' && dotEnv[key].trim() !== '') return dotEnv[key].trim();
  return fallback;
};

const PLACEHOLDER_KEYS = new Set([
  'aizasykey1',
  'aizasykey2',
  'aizasykey3',
  'tu_clave_1',
  'tu_clave_2',
  'your_api_key',
  'changeme'
]);

const sanitizeApiKey = (rawKey) => {
  let cleaned = String(rawKey || '').trim();
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!cleaned) return '';
  if (PLACEHOLDER_KEYS.has(cleaned.toLowerCase())) return '';
  return cleaned;
};

const getModelChain = () => {
  const customRaw = getEnv('GEMINI_MODELS') || getEnv('GEMINI_MODEL');
  const customModels = customRaw
    .split(/[,;\r\n]+/)
    .map((m) => m.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter(Boolean);
  return Array.from(new Set([...customModels, ...MODEL_FALLBACK_CHAIN]));
};

const getApiKeysPool = () => {
  const raw = getEnv('GEMINI_API_KEYS') || getEnv('GEMINI_API_KEY') || getEnv('GOOGLE_API_KEY');
  const keys = raw
    .split(/[,;\r\n]+/)
    .map(sanitizeApiKey)
    .filter(Boolean);

  // Deduplicate while preserving items before shuffling
  const uniqueKeys = Array.from(new Set(keys));

  // Fisher-Yates shuffle for random key rotation
  for (let i = uniqueKeys.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [uniqueKeys[i], uniqueKeys[j]] = [uniqueKeys[j], uniqueKeys[i]];
  }
  return uniqueKeys;
};

const parseGeminiJson = (data) => {
  let rawText = '';

  // 1. Interactions API format (output_text or steps[].content[].text)
  if (typeof data?.output_text === 'string' && data.output_text.trim() !== '') {
    rawText = data.output_text.trim();
  } else if (Array.isArray(data?.steps)) {
    const stepTexts = [];
    for (const step of data.steps) {
      if (!step || step.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const block of step.content) {
        if (block && typeof block.text === 'string' && (!block.type || block.type === 'text')) {
          stepTexts.push(block.text);
        }
      }
    }
    rawText = stepTexts.join('\n').trim();
  } else {
    // 2. Classic generateContent format (candidates[0].content.parts[])
    const candidate = data?.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    rawText = parts
      .filter((p) => p && !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
  }

  if (!rawText) {
    const reason =
      data?.error?.message ||
      data?.status ||
      data?.candidates?.[0]?.finishReason ||
      data?.promptFeedback?.blockReason ||
      'sin contenido';
    return { parsed: null, error: `La respuesta de Gemini llegó vacía (${reason}).` };
  }

  const unfenced = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(unfenced);
    if (parsed && typeof parsed === 'object') return { parsed, error: '' };
  } catch {
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
        if (parsed && typeof parsed === 'object') return { parsed, error: '' };
      } catch {
        // Fall through to error message
      }
    }
  }

  return { parsed: null, error: 'La respuesta de Gemini no devolvió un JSON válido.' };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendJson = (res, statusCode, data) => {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
};

const readRequestBody = (req, maxBytes = 1024 * 512) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const buildUserPrompt = (d) => `Audita el siguiente examen del Segundo Parcial de Metodología de la Investigación II (Guía Talleres de Grado USB 2026).
Asigna los puntajes estrictos dentro de estos rangos máximos exactos:
- block1_score: entero entre 0 y 50 (Cap. I: Problema y Objetivos)
- block2_score: entero entre 0 y 10 (Apartado 1.6, Cuadros 3, 7 y 8)
- block3_score: entero entre 0 y 20 (Cap. II: 2.1.2, 2.2.1, 2.2.2, 2.3.2)
- block4_score: entero entre 0 y 20 (Defensa de Panel: diferenciación metodológica)
- total_score: suma exacta de los 4 bloques (0 a 100)
- Escala de habilitación: 100 Distinguido con Honores | 90-99 Excelente | 80-89 Muy Bueno | 70-79 Bueno | 51-69 Aprobado | <=50 Reprobado
- approved: true si total_score >= 51
- IMPORTANTE: Solo los datos de identificación son obligatorios. Las Cajas 1 a 4 son opcionales según el avance del estudiante; evalúa estrictamente lo respondido y asigna 0 puntos a cualquier apartado o bloque marcado como '[No respondido / Sin avance registrado]'.

DATOS DEL ESTUDIANTE Y DE LA INVESTIGACIÓN:
- Estudiante: ${d.student_name} (RU / Registro Universitario: ${d.student_id})
- Título de la Investigación (Tentativo o Preliminar): ${d.project_title}
- Modalidad: ${d.modality}

=== CAJA 1: CAP. I — PROBLEMA Y OBJETIVOS (Máximo 50 pts) ===
- Síntoma con evidencia empírica (Problema): ${d.box1_symptom}
- Causa: ${d.box1_cause}
- Efecto: ${d.box1_effect}
- Pregunta General: ${d.box1_general_question}
- Objetivo General: ${d.box1_general_objective}
- Objetivos Específicos:
  * OE1: ${d.oe1_text}
  * OE2: ${d.oe2_text}
  * OE3: ${d.oe3_text}

=== CAJA 2: APARTADO 1.6 — IDEA PRELIMINAR DE SOLUCIÓN Y VIABILIDAD (Máximo 10 pts) ===
- Límites del sistema (alcance y exclusiones): ${d.box2_system_limits}
- Actores: ${d.box2_actors}
- Componentes: ${d.box2_components}
- Métricas técnicas de ingeniería (Cuadro 3): ${d.box2_engineering_metrics}
- Supuestos, permisos éticos y acceso (Cuadro 8): ${d.box2_ethics_access}

=== CAJA 3: CAP. II — FUNDAMENTACIÓN TEÓRICA, ESTADO DEL ARTE Y LEGAL (Máximo 20 pts) ===
- Antecedente 1 y vacío explícito (2.1.2): ${d.box3_antecedent1}
- Antecedente 2 y vacío explícito (2.1.2): ${d.box3_antecedent2}
- Teoría o modelo rector conectado a variables, categorías o requerimientos (2.2.1): ${d.box3_guiding_theory}
- Fundamento tecnológico (2.2.2): ${d.box3_tech_foundation}
- Normativa o estándar aplicable (2.3.2): ${d.box3_legal_standards}

=== CAJA 4: DEFENSA DE PANEL — DIFERENCIACIÓN METODOLÓGICA (Máximo 20 pts) ===
- Respuesta técnica: ${d.box4_methodology_diff}`;

const getScaleLabel = (score) => {
  if (score >= 100) return 'Distinguido con Honores';
  if (score >= 90) return 'Excelente';
  if (score >= 80) return 'Muy Bueno';
  if (score >= 70) return 'Bueno';
  if (score >= 51) return 'Aprobado';
  return 'Reprobado';
};

const clampScore = (val, min, max) => {
  const n = Math.round(Number(val) || 0);
  return Math.max(min, Math.min(max, n));
};

const handleEvaluate = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Método no permitido. Utiliza POST.' });
    return;
  }

  const apiKeys = getApiKeysPool();
  if (apiKeys.length === 0) {
    sendJson(res, 500, {
      error: 'Configuración incompleta en el servidor.',
      detail: 'Define GEMINI_API_KEYS o GEMINI_API_KEY en Dokploy con una API Key real de Google AI Studio (sin comillas ni valores de ejemplo).'
    });
    return;
  }

  let input = {};
  try {
    const raw = await readRequestBody(req);
    input = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: 'El cuerpo de la petición debe ser JSON válido.' });
    return;
  }

  const cleanData = {};
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const val = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!val) missing.push(field);
    cleanData[field] = val;
  }

  for (const field of OPTIONAL_FIELDS) {
    const val = typeof input[field] === 'string' ? input[field].trim() : '';
    cleanData[field] = val || '[No respondido / Sin avance registrado]';
  }

  if (missing.length > 0) {
    sendJson(res, 400, {
      error: 'Faltan campos obligatorios en la sección "0. Identificación del Estudiante y del Proyecto".',
      missing_fields: missing
    });
    return;
  }

  const modelChain = getModelChain();
  const userPromptText = buildUserPrompt(cleanData);

  const requiredSchemaFields = [
    'total_score',
    'block1_score', 'block1_feedback',
    'block2_score', 'block2_feedback',
    'block3_score', 'block3_feedback',
    'block4_score', 'block4_feedback',
    'critical_fixes_needed',
    'approved'
  ];

  const buildInteractionsPayload = (modelName) => {
    const body = {
      model: modelName,
      system_instruction: SYSTEM_INSTRUCTION,
      input: userPromptText,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            total_score: { type: 'integer' },
            block1_score: { type: 'integer' },
            block1_feedback: { type: 'string' },
            block2_score: { type: 'integer' },
            block2_feedback: { type: 'string' },
            block3_score: { type: 'integer' },
            block3_feedback: { type: 'string' },
            block4_score: { type: 'integer' },
            block4_feedback: { type: 'string' },
            critical_fixes_needed: {
              type: 'array',
              items: { type: 'string' }
            },
            approved: { type: 'boolean' }
          },
          required: requiredSchemaFields
        }
      }
    };
    if (modelName !== 'gemini-3.1-flash-lite') {
      body.generation_config = { thinking_level: 'low' };
    }
    return body;
  };

  const generateContentPayload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPromptText }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          total_score: { type: 'INTEGER' },
          block1_score: { type: 'INTEGER' },
          block1_feedback: { type: 'STRING' },
          block2_score: { type: 'INTEGER' },
          block2_feedback: { type: 'STRING' },
          block3_score: { type: 'INTEGER' },
          block3_feedback: { type: 'STRING' },
          block4_score: { type: 'INTEGER' },
          block4_feedback: { type: 'STRING' },
          critical_fixes_needed: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          approved: { type: 'BOOLEAN' }
        },
        required: requiredSchemaFields
      }
    }
  };

  const extractApiError = async (response) => {
    const errRaw = await response.text().catch(() => '');
    let apiMsg = '';
    try {
      const errJson = JSON.parse(errRaw);
      apiMsg = errJson?.error?.message || '';
    } catch {
      apiMsg = errRaw.slice(0, 240).trim();
    }
    return `HTTP ${response.status} al consultar Gemini API${apiMsg ? `: ${apiMsg}` : '.'}`;
  };

  const maxAttempts = 4;
  const baseWaitMs = 3000;
  let lastStatus = 0;
  let lastError = '';
  let geminiResult = null;
  let modelUsed = modelChain[0];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = apiKeys[attempt % apiKeys.length];
    const currentModel = modelChain[attempt % modelChain.length];
    const generateContentEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent`;

    try {
      let response = await fetch(INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'Api-Revision': API_REVISION
        },
        body: JSON.stringify(buildInteractionsPayload(currentModel)),
        signal: AbortSignal.timeout(45000)
      });

      // Fallback a generateContent si Interactions API devuelve 400 o 404 de ruta/esquema
      if (response.status === 400 || response.status === 404) {
        const interactionsErr = await extractApiError(response);
        console.warn('[Auditor USB][Interactions Fallback]', { model: currentModel, detail: interactionsErr });
        response = await fetch(`${generateContentEndpoint}?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(generateContentPayload),
          signal: AbortSignal.timeout(45000)
        });
      }

      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        const { parsed, error } = parseGeminiJson(data);
        if (parsed) {
          geminiResult = parsed;
          modelUsed = currentModel;
          break;
        }
        lastError = error;
      } else {
        lastError = await extractApiError(response);
      }
    } catch (err) {
      lastStatus = 0;
      lastError = err instanceof Error ? err.message : 'Error de red al consultar Gemini API.';
    }

    console.error('[Auditor USB][Gemini API]', {
      attempt: attempt + 1,
      model: currentModel,
      status: lastStatus,
      detail: lastError
    });

    const isTransient = lastStatus === 429 || lastStatus === 503 || lastStatus === 500 || lastStatus === 0;
    const isModelUnavailable = lastStatus === 404 && attempt + 1 < modelChain.length;
    const isKeyErrorWithMoreKeys = (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) && attempt + 1 < apiKeys.length;

    if (attempt < maxAttempts - 1) {
      if (isModelUnavailable || isKeyErrorWithMoreKeys) {
        continue;
      }
      if (isTransient) {
        const waitMs = Math.min(6000, baseWaitMs * (2 ** attempt)); // 3000ms, luego 6000ms
        await sleep(waitMs);
        continue;
      }
    }
    break;
  }

  if (!geminiResult) {
    sendJson(res, lastStatus === 429 ? 429 : 502, {
      error: 'No se pudo completar la evaluación con Gemini API tras los reintentos configurados.',
      detail: lastError
    });
    return;
  }

  const b1 = clampScore(geminiResult.block1_score, 0, 50);
  const b2 = clampScore(geminiResult.block2_score, 0, 10);
  const b3 = clampScore(geminiResult.block3_score, 0, 20);
  const b4 = clampScore(geminiResult.block4_score, 0, 20);
  const totalScore = b1 + b2 + b3 + b4;
  const approved = totalScore >= 51;
  const scaleLabel = getScaleLabel(totalScore);

  const criticalFixes = Array.isArray(geminiResult.critical_fixes_needed)
    ? geminiResult.critical_fixes_needed.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const evaluatedAt = new Date().toISOString();
  const payloadOut = {
    total_score: totalScore,
    scale_label: scaleLabel,
    block1_score: b1,
    block1_feedback: String(geminiResult.block1_feedback || ''),
    block2_score: b2,
    block2_feedback: String(geminiResult.block2_feedback || ''),
    block3_score: b3,
    block3_feedback: String(geminiResult.block3_feedback || ''),
    block4_score: b4,
    block4_feedback: String(geminiResult.block4_feedback || ''),
    critical_fixes_needed: criticalFixes,
    approved,
    model_used: modelUsed,
    evaluated_at: evaluatedAt
  };

  const secretSalt = getEnv('SECRET_SALT', 'USB_METODOLOGIA_II_2026_CAMBIAR_EN_PROD');
  const dateKey = evaluatedAt.slice(0, 10);
  const hashSource = `${cleanData.student_name}|${totalScore}|${dateKey}|${secretSalt}`;
  payloadOut.verification_hash = crypto
    .createHash('sha256')
    .update(hashSource)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  sendJson(res, 200, payloadOut);
};

const PUBLIC_FILES = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/logousb_blue.png',
  '/guia-orientadora-talleres-grado-paneles.pdf'
]);

const serveStatic = (req, res, urlPath) => {
  if (!PUBLIC_FILES.has(urlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }

  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const fullPath = path.join(ROOT_DIR, relativePath);
  const ext = path.extname(fullPath);

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error leyendo el archivo solicitado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  });
};

const handleRequest = async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (reqUrl.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (reqUrl.pathname === '/evaluate.php' || reqUrl.pathname === '/api/evaluate') {
    await handleEvaluate(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Método no permitido');
    return;
  }

  serveStatic(req, res, reqUrl.pathname);
};

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Auditor Metodológico USB activo en http://0.0.0.0:${PORT}`);
  });
}

module.exports = { handleRequest, server };
