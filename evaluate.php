<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido. Utiliza POST.'], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Carga variables simples desde un archivo .env local si existe.
 */
function loadDotEnv(string $envPath): array
{
    $vars = [];
    if (!is_file($envPath) || !is_readable($envPath)) {
        return $vars;
    }
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return $vars;
    }
    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }
        $pos = strpos($trimmed, '=');
        if ($pos === false) {
            continue;
        }
        $key = trim(substr($trimmed, 0, $pos));
        $val = trim(substr($trimmed, $pos + 1));
        $val = trim($val, "\"'");
        $vars[$key] = $val;
    }
    return $vars;
}

function getConfigValue(string $key, array $dotEnv, string $default = ''): string
{
    $envVal = getenv($key);
    if ($envVal !== false && trim($envVal) !== '') {
        return trim($envVal);
    }
    if (isset($dotEnv[$key]) && trim($dotEnv[$key]) !== '') {
        return trim($dotEnv[$key]);
    }
    return $default;
}

$dotEnv = loadDotEnv(__DIR__ . '/.env');

// Array de respaldo para hosting compartido PHP sin variables de entorno (reemplazar en producción o usar .env)
$fallbackApiKeys = [
    // 'AIzaSy...'
];

$keysRaw = getConfigValue('GEMINI_API_KEYS', $dotEnv);
if ($keysRaw === '') {
    $keysRaw = getConfigValue('GEMINI_API_KEY', $dotEnv);
}

$apiKeys = [];
if ($keysRaw !== '') {
    foreach (explode(',', $keysRaw) as $candidate) {
        $clean = trim($candidate);
        if ($clean !== '') {
            $apiKeys[] = $clean;
        }
    }
}
foreach ($fallbackApiKeys as $candidate) {
    $clean = trim((string)$candidate);
    if ($clean !== '' && !in_array($clean, $apiKeys, true)) {
        $apiKeys[] = $clean;
    }
}

if (count($apiKeys) === 0) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Configuración incompleta en el servidor: define GEMINI_API_KEYS o GEMINI_API_KEY.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Rotación aleatoria de API Keys
shuffle($apiKeys);

$secretSalt = getConfigValue('SECRET_SALT', $dotEnv, 'USB_METODOLOGIA_II_2026_CAMBIAR_EN_PROD');

$rawBody = file_get_contents('php://input');
$input = json_decode($rawBody ?: '', true);
if (!is_array($input)) {
    // Fallback por si el formulario llega como application/x-www-form-urlencoded
    $input = $_POST;
}

$requiredFields = [
    'student_name', 'student_id', 'project_title', 'modality'
];

$optionalFields = [
    'box1_symptom', 'box1_cause', 'box1_effect', 'box1_general_question', 'box1_general_objective',
    'oe1_text', 'oe1_evidence', 'oe1_source', 'oe1_criteria',
    'oe2_text', 'oe2_evidence', 'oe2_source', 'oe2_criteria',
    'oe3_text', 'oe3_evidence', 'oe3_source', 'oe3_criteria',
    'box2_system_limits', 'box2_actors', 'box2_components', 'box2_engineering_metrics', 'box2_ethics_access',
    'box3_antecedent1', 'box3_antecedent2', 'box3_guiding_theory', 'box3_tech_foundation', 'box3_legal_standards',
    'box4_methodology_diff'
];

$missing = [];
$cleanData = [];
foreach ($requiredFields as $field) {
    $value = isset($input[$field]) ? trim((string)$input[$field]) : '';
    if ($value === '') {
        $missing[] = $field;
    }
    $cleanData[$field] = $value;
}

foreach ($optionalFields as $field) {
    $value = isset($input[$field]) ? trim((string)$input[$field]) : '';
    $cleanData[$field] = $value !== '' ? $value : '[No respondido / Sin avance registrado]';
}

if (count($missing) > 0) {
    http_response_code(400);
    echo json_encode([
        'error' => 'Faltan campos obligatorios en la sección "0. Identificación del Estudiante y del Proyecto".',
        'missing_fields' => $missing
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$systemInstruction = <<<'PROMPT'
Eres el Auditor Metodológico Estricto de Ingeniería de Sistemas (Guía Talleres de Grado USB 2026). Evalúa con alto rigor académico.
REGLAS DE PENALIZACIÓN:
1. Si los objetivos específicos usan verbos de tareas técnicas operativas ('programar', 'instalar', 'configurar', 'hacer encuestas', 'codificar') en lugar de resultados verificables, resta 15 puntos en el Bloque 1.
2. Si confunde actividades ('hacer entrevistas') con Evidencia tangible en la trazabilidad de objetivos, resta 10 puntos.
3. Si no define límites del sistema o métricas reales de ingeniería (latencia, precisión, tiempos de proceso, etc.), resta 10 puntos en el Bloque 2.
4. Si el marco teórico son definiciones genéricas desconectadas del problema o no identifica el vacío del estado del arte, resta 10 puntos en el Bloque 3.
5. Si confunde metodología de desarrollo de software (ej. Scrum) con el diseño metodológico de investigación, resta 15 puntos en el Bloque 4.
PROHIBICIÓN ABSOLUTA: Nunca redactes la respuesta corregida por el estudiante. Solo señala qué falla metodológica tiene según la Guía y qué debe reformular por su cuenta.
PROMPT;

$userPrompt = <<<TEXT
Audita el siguiente examen del Segundo Parcial de Metodología de la Investigación II (Guía Talleres de Grado USB 2026).
Asigna los puntajes estrictos dentro de estos rangos máximos exactos:
- block1_score: entero entre 0 y 30 (Cap. I y Cuadro 6)
- block2_score: entero entre 0 y 25 (Apartado 1.6, Cuadro 3 y Cuadro 8)
- block3_score: entero entre 0 y 25 (Cap. II: 2.1.2, 2.2.1, 2.2.2, 2.3.2)
- block4_score: entero entre 0 y 20 (Defensa de Panel: diferenciación metodológica)
- total_score: suma exacta de los 4 bloques (0 a 100)
- Escala de habilitación: 100 Distinguido con Honores | 90-99 Excelente | 80-89 Muy Bueno | 70-79 Bueno | 51-69 Aprobado | <=50 Reprobado
- approved: true si total_score >= 51
- IMPORTANTE: Solo los datos de identificación son obligatorios. Las Cajas 1 a 4 son opcionales según el avance del estudiante; evalúa estrictamente lo respondido y asigna 0 puntos a cualquier apartado o bloque marcado como '[No respondido / Sin avance registrado]'.

DATOS DEL ESTUDIANTE Y DE LA INVESTIGACIÓN:
- Estudiante: {$cleanData['student_name']} (RU / Registro Universitario: {$cleanData['student_id']})
- Título de la Investigación (Tentativo o Preliminar): {$cleanData['project_title']}
- Modalidad: {$cleanData['modality']}

=== CAJA 1: CAP. I — PROBLEMA Y TRAZABILIDAD DE OBJETIVOS (Máximo 30 pts) ===
- Síntoma con evidencia empírica (Problema): {$cleanData['box1_symptom']}
- Causa: {$cleanData['box1_cause']}
- Efecto: {$cleanData['box1_effect']}
- Pregunta General: {$cleanData['box1_general_question']}
- Objetivo General: {$cleanData['box1_general_objective']}
- Matriz Cuadro 6:
  * OE1: {$cleanData['oe1_text']}
    - Evidencia requerida: {$cleanData['oe1_evidence']}
    - Fuente/Procedimiento: {$cleanData['oe1_source']}
    - Criterio de análisis: {$cleanData['oe1_criteria']}
  * OE2: {$cleanData['oe2_text']}
    - Evidencia requerida: {$cleanData['oe2_evidence']}
    - Fuente/Procedimiento: {$cleanData['oe2_source']}
    - Criterio de análisis: {$cleanData['oe2_criteria']}
  * OE3: {$cleanData['oe3_text']}
    - Evidencia requerida: {$cleanData['oe3_evidence']}
    - Fuente/Procedimiento: {$cleanData['oe3_source']}
    - Criterio de análisis: {$cleanData['oe3_criteria']}

=== CAJA 2: APARTADO 1.6 — IDEA PRELIMINAR DE SOLUCIÓN Y VIABILIDAD (Máximo 25 pts) ===
- Límites del sistema (alcance y exclusiones): {$cleanData['box2_system_limits']}
- Actores: {$cleanData['box2_actors']}
- Componentes: {$cleanData['box2_components']}
- Métricas técnicas de ingeniería (Cuadro 3): {$cleanData['box2_engineering_metrics']}
- Supuestos, permisos éticos y acceso (Cuadro 8): {$cleanData['box2_ethics_access']}

=== CAJA 3: CAP. II — FUNDAMENTACIÓN TEÓRICA, ESTADO DEL ARTE Y LEGAL (Máximo 25 pts) ===
- Antecedente 1 y vacío explícito (2.1.2): {$cleanData['box3_antecedent1']}
- Antecedente 2 y vacío explícito (2.1.2): {$cleanData['box3_antecedent2']}
- Teoría o modelo rector conectado a variables/requerimientos (2.2.1): {$cleanData['box3_guiding_theory']}
- Fundamento tecnológico (2.2.2): {$cleanData['box3_tech_foundation']}
- Normativa o estándar aplicable (2.3.2): {$cleanData['box3_legal_standards']}

=== CAJA 4: DEFENSA DE PANEL — DIFERENCIACIÓN METODOLÓGICA (Máximo 20 pts) ===
- Respuesta técnica: {$cleanData['box4_methodology_diff']}
TEXT;

$geminiPayload = [
    'systemInstruction' => [
        'parts' => [
            ['text' => $systemInstruction]
        ]
    ],
    'contents' => [
        [
            'role' => 'user',
            'parts' => [
                ['text' => $userPrompt]
            ]
        ]
    ],
    'generationConfig' => [
        'temperature' => 0.15,
        'responseMimeType' => 'application/json',
        'responseSchema' => [
            'type' => 'OBJECT',
            'properties' => [
                'total_score' => ['type' => 'INTEGER'],
                'block1_score' => ['type' => 'INTEGER'],
                'block1_feedback' => ['type' => 'STRING'],
                'block2_score' => ['type' => 'INTEGER'],
                'block2_feedback' => ['type' => 'STRING'],
                'block3_score' => ['type' => 'INTEGER'],
                'block3_feedback' => ['type' => 'STRING'],
                'block4_score' => ['type' => 'INTEGER'],
                'block4_feedback' => ['type' => 'STRING'],
                'critical_fixes_needed' => [
                    'type' => 'ARRAY',
                    'items' => ['type' => 'STRING']
                ],
                'approved' => ['type' => 'BOOLEAN']
            ],
            'required' => [
                'total_score',
                'block1_score', 'block1_feedback',
                'block2_score', 'block2_feedback',
                'block3_score', 'block3_feedback',
                'block4_score', 'block4_feedback',
                'critical_fixes_needed',
                'approved'
            ]
        ]
    ]
];

$endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
$encodedBody = json_encode($geminiPayload, JSON_UNESCAPED_UNICODE);

$maxAttempts = 3;
$baseWaitSeconds = 3;
$lastHttpStatus = 0;
$lastErrorDetail = '';
$geminiResult = null;

for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
    $currentKey = $apiKeys[$attempt % count($apiKeys)];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-goog-api-key: ' . $currentKey
        ],
        CURLOPT_POSTFIELDS => $encodedBody
    ]);

    $responseBody = curl_exec($ch);
    $curlError = curl_error($ch);
    $httpStatus = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $lastHttpStatus = $httpStatus;

    if ($responseBody !== false && $httpStatus >= 200 && $httpStatus < 300) {
        $decoded = json_decode($responseBody, true);
        $rawText = $decoded['candidates'][0]['content']['parts'][0]['text'] ?? '';
        $parsedJson = json_decode($rawText, true);

        if (is_array($parsedJson)) {
            $geminiResult = $parsedJson;
            break;
        }
        $lastErrorDetail = 'La respuesta de Gemini no devolvió un JSON válido.';
    } else {
        $lastErrorDetail = $curlError !== '' ? $curlError : ('HTTP ' . $httpStatus . ' al consultar Gemini API.');
    }

    $isRateLimitOrTransient = ($httpStatus === 429 || $httpStatus === 503 || $httpStatus === 500 || $httpStatus === 0);
    if ($isRateLimitOrTransient && $attempt < ($maxAttempts - 1)) {
        // Exponential backoff: 3s en intento 1, 6s en intento 2
        $waitSeconds = $baseWaitSeconds * (2 ** $attempt);
        sleep($waitSeconds);
        continue;
    }

    break;
}

if (!is_array($geminiResult)) {
    http_response_code($lastHttpStatus === 429 ? 429 : 502);
    echo json_encode([
        'error' => 'No se pudo completar la evaluación con Gemini API tras los reintentos configurados.',
        'detail' => $lastErrorDetail
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$clamp = static function ($val, int $min, int $max): int {
    $n = (int)round((float)$val);
    return max($min, min($max, $n));
};

$b1 = $clamp($geminiResult['block1_score'] ?? 0, 0, 30);
$b2 = $clamp($geminiResult['block2_score'] ?? 0, 0, 25);
$b3 = $clamp($geminiResult['block3_score'] ?? 0, 0, 25);
$b4 = $clamp($geminiResult['block4_score'] ?? 0, 0, 20);
$totalScore = $b1 + $b2 + $b3 + $b4;
$approved = $totalScore >= 51;

$getScaleLabel = static function (int $score): string {
    if ($score >= 100) {
        return 'Distinguido con Honores';
    }
    if ($score >= 90) {
        return 'Excelente';
    }
    if ($score >= 80) {
        return 'Muy Bueno';
    }
    if ($score >= 70) {
        return 'Bueno';
    }
    if ($score >= 51) {
        return 'Aprobado';
    }
    return 'Reprobado';
};

$scaleLabel = $getScaleLabel($totalScore);

$criticalFixes = [];
if (isset($geminiResult['critical_fixes_needed']) && is_array($geminiResult['critical_fixes_needed'])) {
    foreach ($geminiResult['critical_fixes_needed'] as $item) {
        $str = trim((string)$item);
        if ($str !== '') {
            $criticalFixes[] = $str;
        }
    }
}

$evaluatedAt = gmdate('c');
$responsePayload = [
    'total_score' => $totalScore,
    'scale_label' => $scaleLabel,
    'block1_score' => $b1,
    'block1_feedback' => (string)($geminiResult['block1_feedback'] ?? ''),
    'block2_score' => $b2,
    'block2_feedback' => (string)($geminiResult['block2_feedback'] ?? ''),
    'block3_score' => $b3,
    'block3_feedback' => (string)($geminiResult['block3_feedback'] ?? ''),
    'block4_score' => $b4,
    'block4_feedback' => (string)($geminiResult['block4_feedback'] ?? ''),
    'critical_fixes_needed' => $criticalFixes,
    'approved' => $approved,
    'evaluated_at' => $evaluatedAt
];

if ($approved) {
    $dateKey = gmdate('Y-m-d');
    $hashSource = $cleanData['student_name'] . '|' . $totalScore . '|' . $dateKey . '|' . $secretSalt;
    $responsePayload['verification_hash'] = strtoupper(substr(hash('sha256', $hashSource), 0, 12));
}

echo json_encode($responsePayload, JSON_UNESCAPED_UNICODE);
