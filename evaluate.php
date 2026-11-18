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

$placeholderKeys = [
    'aizasykey1',
    'aizasykey2',
    'aizasykey3',
    'tu_clave_1',
    'tu_clave_2',
    'your_api_key',
    'changeme'
];

$sanitizeApiKey = static function ($candidate) use ($placeholderKeys): string {
    $clean = trim((string)$candidate);
    $clean = trim($clean, " \t\n\r\0\x0B\"'`");
    if ($clean === '' || in_array(strtolower($clean), $placeholderKeys, true)) {
        return '';
    }
    return $clean;
};

$keysRaw = getConfigValue('GEMINI_API_KEYS', $dotEnv);
if ($keysRaw === '') {
    $keysRaw = getConfigValue('GEMINI_API_KEY', $dotEnv);
}
if ($keysRaw === '') {
    $keysRaw = getConfigValue('GOOGLE_API_KEY', $dotEnv);
}

$apiKeys = [];
if ($keysRaw !== '') {
    $parts = preg_split('/[,;\r\n]+/', $keysRaw) ?: [];
    foreach ($parts as $candidate) {
        $clean = $sanitizeApiKey($candidate);
        if ($clean !== '' && !in_array($clean, $apiKeys, true)) {
            $apiKeys[] = $clean;
        }
    }
}
foreach ($fallbackApiKeys as $candidate) {
    $clean = $sanitizeApiKey($candidate);
    if ($clean !== '' && !in_array($clean, $apiKeys, true)) {
        $apiKeys[] = $clean;
    }
}

if (count($apiKeys) === 0) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Configuración incompleta en el servidor.',
        'detail' => 'Define GEMINI_API_KEYS o GEMINI_API_KEY con una API Key real de Google AI Studio (sin comillas ni valores de ejemplo).'
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
    'oe1_text', 'oe2_text', 'oe3_text',
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
Eres el Auditor Metodológico Estricto de Ingeniería de Sistemas (Guía Orientadora para Talleres de Grado USB 2026). Evalúa el desarrollo del Perfil de Grado hasta el Capítulo II con alto rigor académico.
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
PROHIBICIÓN ABSOLUTA: Nunca redactes la respuesta corregida por el estudiante. Solo señala qué falla metodológica tiene según la Guía y qué debe reformular por su cuenta.
PROMPT;

$userPrompt = <<<TEXT
Audita el siguiente examen del Segundo Parcial de Metodología de la Investigación II (Guía Talleres de Grado USB 2026).
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
- Estudiante: {$cleanData['student_name']} (RU / Registro Universitario: {$cleanData['student_id']})
- Título de la Investigación (Tentativo o Preliminar): {$cleanData['project_title']}
- Modalidad: {$cleanData['modality']}

=== CAJA 1: CAP. I — PROBLEMA Y OBJETIVOS (Máximo 50 pts) ===
- Síntoma con evidencia empírica (Problema): {$cleanData['box1_symptom']}
- Causa: {$cleanData['box1_cause']}
- Efecto: {$cleanData['box1_effect']}
- Pregunta General: {$cleanData['box1_general_question']}
- Objetivo General: {$cleanData['box1_general_objective']}
- Objetivos Específicos:
  * OE1: {$cleanData['oe1_text']}
  * OE2: {$cleanData['oe2_text']}
  * OE3: {$cleanData['oe3_text']}

=== CAJA 2: APARTADO 1.6 — IDEA PRELIMINAR DE SOLUCIÓN Y VIABILIDAD (Máximo 10 pts) ===
- Límites del sistema (alcance y exclusiones): {$cleanData['box2_system_limits']}
- Actores: {$cleanData['box2_actors']}
- Componentes: {$cleanData['box2_components']}
- Métricas técnicas de ingeniería (Cuadro 3): {$cleanData['box2_engineering_metrics']}
- Supuestos, permisos éticos y acceso (Cuadro 8): {$cleanData['box2_ethics_access']}

=== CAJA 3: CAP. II — FUNDAMENTACIÓN TEÓRICA, ESTADO DEL ARTE Y LEGAL (Máximo 20 pts) ===
- Antecedente 1 y vacío explícito (2.1.2): {$cleanData['box3_antecedent1']}
- Antecedente 2 y vacío explícito (2.1.2): {$cleanData['box3_antecedent2']}
- Teoría o modelo rector conectado a variables, categorías o requerimientos (2.2.1): {$cleanData['box3_guiding_theory']}
- Fundamento tecnológico (2.2.2): {$cleanData['box3_tech_foundation']}
- Normativa o estándar aplicable (2.3.2): {$cleanData['box3_legal_standards']}

=== CAJA 4: DEFENSA DE PANEL — DIFERENCIACIÓN METODOLÓGICA (Máximo 20 pts) ===
- Respuesta técnica: {$cleanData['box4_methodology_diff']}
TEXT;

$defaultModelChain = [
    'gemini-3.8-flash',
    'gemini-4-hydrogen',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
];
$customModelsRaw = getConfigValue('GEMINI_MODELS', $dotEnv);
if ($customModelsRaw === '') {
    $customModelsRaw = getConfigValue('GEMINI_MODEL', $dotEnv);
}
$modelChain = [];
if ($customModelsRaw !== '') {
    $customParts = preg_split('/[,;\r\n]+/', $customModelsRaw) ?: [];
    foreach ($customParts as $candidate) {
        $cleanModel = trim(trim((string)$candidate), " \t\n\r\0\x0B\"'`");
        if ($cleanModel !== '' && !in_array($cleanModel, $modelChain, true)) {
            $modelChain[] = $cleanModel;
        }
    }
}
foreach ($defaultModelChain as $fallbackModel) {
    if (!in_array($fallbackModel, $modelChain, true)) {
        $modelChain[] = $fallbackModel;
    }
}

$interactionsEndpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';
$apiRevision = '2026-05-20';

$requiredSchemaFields = [
    'total_score',
    'block1_score', 'block1_feedback',
    'block2_score', 'block2_feedback',
    'block3_score', 'block3_feedback',
    'block4_score', 'block4_feedback',
    'critical_fixes_needed',
    'approved'
];

$buildInteractionsPayload = static function (string $targetModel) use ($systemInstruction, $userPrompt, $requiredSchemaFields): string {
    $payload = [
        'model' => $targetModel,
        'system_instruction' => $systemInstruction,
        'input' => $userPrompt,
        'response_format' => [
            'type' => 'text',
            'mime_type' => 'application/json',
            'schema' => [
                'type' => 'object',
                'properties' => [
                    'total_score' => ['type' => 'integer'],
                    'block1_score' => ['type' => 'integer'],
                    'block1_feedback' => ['type' => 'string'],
                    'block2_score' => ['type' => 'integer'],
                    'block2_feedback' => ['type' => 'string'],
                    'block3_score' => ['type' => 'integer'],
                    'block3_feedback' => ['type' => 'string'],
                    'block4_score' => ['type' => 'integer'],
                    'block4_feedback' => ['type' => 'string'],
                    'critical_fixes_needed' => [
                        'type' => 'array',
                        'items' => ['type' => 'string']
                    ],
                    'approved' => ['type' => 'boolean']
                ],
                'required' => $requiredSchemaFields
            ]
        ]
    ];
    if ($targetModel !== 'gemini-3.1-flash-lite') {
        $payload['generation_config'] = ['thinking_level' => 'low'];
    }
    return (string)json_encode($payload, JSON_UNESCAPED_UNICODE);
};

$generateContentPayload = [
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
            'required' => $requiredSchemaFields
        ]
    ]
];

$encodedGenerateContent = (string)json_encode($generateContentPayload, JSON_UNESCAPED_UNICODE);

$maxAttempts = 4;
$baseWaitSeconds = 3;
$lastHttpStatus = 0;
$lastErrorDetail = '';
$geminiResult = null;
$modelUsed = $modelChain[0];

$parseGeminiJson = static function (array $decoded): array {
    $rawText = '';

    // 1. Interactions API format (output_text o steps[].content[].text)
    if (isset($decoded['output_text']) && is_string($decoded['output_text']) && trim($decoded['output_text']) !== '') {
        $rawText = trim($decoded['output_text']);
    } elseif (isset($decoded['steps']) && is_array($decoded['steps'])) {
        $stepChunks = [];
        foreach ($decoded['steps'] as $step) {
            if (!is_array($step) || ($step['type'] ?? '') !== 'model_output' || !is_array($step['content'] ?? null)) {
                continue;
            }
            foreach ($step['content'] as $block) {
                if (!is_array($block)) {
                    continue;
                }
                if (isset($block['text']) && is_string($block['text']) && (!isset($block['type']) || $block['type'] === 'text')) {
                    $stepChunks[] = $block['text'];
                }
            }
        }
        $rawText = trim(implode("\n", $stepChunks));
    } else {
        // 2. Classic generateContent format
        $candidate = $decoded['candidates'][0] ?? [];
        $parts = is_array($candidate['content']['parts'] ?? null) ? $candidate['content']['parts'] : [];
        $textChunks = [];
        foreach ($parts as $part) {
            if (!is_array($part) || !empty($part['thought'])) {
                continue;
            }
            if (isset($part['text']) && is_string($part['text'])) {
                $textChunks[] = $part['text'];
            }
        }
        $rawText = trim(implode("\n", $textChunks));
    }

    if ($rawText === '') {
        $reason = $decoded['error']['message']
            ?? ($decoded['status'] ?? ($decoded['candidates'][0]['finishReason'] ?? ($decoded['promptFeedback']['blockReason'] ?? 'sin contenido')));
        return [null, 'La respuesta de Gemini llegó vacía (' . $reason . ').'];
    }

    $unfenced = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $rawText) ?? $rawText;
    $unfenced = trim($unfenced);

    $parsed = json_decode($unfenced, true);
    if (is_array($parsed)) {
        return [$parsed, ''];
    }

    $firstBrace = strpos($unfenced, '{');
    $lastBrace = strrpos($unfenced, '}');
    if ($firstBrace !== false && $lastBrace !== false && $lastBrace > $firstBrace) {
        $slice = substr($unfenced, $firstBrace, $lastBrace - $firstBrace + 1);
        $parsed = json_decode($slice, true);
        if (is_array($parsed)) {
            return [$parsed, ''];
        }
    }

    return [null, 'La respuesta de Gemini no devolvió un JSON válido.'];
};

$executePost = static function (string $url, array $headers, string $body): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body
    ]);
    $responseBody = curl_exec($ch);
    $curlError = curl_error($ch);
    $httpStatus = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$responseBody, $curlError, $httpStatus];
};

for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
    $currentKey = $apiKeys[$attempt % count($apiKeys)];
    $currentModel = $modelChain[$attempt % count($modelChain)];
    $generateContentEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($currentModel) . ':generateContent';

    [$responseBody, $curlError, $httpStatus] = $executePost(
        $interactionsEndpoint,
        [
            'Content-Type: application/json',
            'x-goog-api-key: ' . $currentKey,
            'Api-Revision: ' . $apiRevision
        ],
        $buildInteractionsPayload($currentModel)
    );

    // Fallback a generateContent si Interactions API devuelve 400 o 404 de ruta/esquema
    if ($responseBody !== false && ($httpStatus === 400 || $httpStatus === 404)) {
        [$responseBody, $curlError, $httpStatus] = $executePost(
            $generateContentEndpoint . '?key=' . urlencode($currentKey),
            [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $currentKey
            ],
            $encodedGenerateContent
        );
    }

    $lastHttpStatus = $httpStatus;

    if ($responseBody !== false && $httpStatus >= 200 && $httpStatus < 300) {
        $decoded = json_decode($responseBody, true);
        [$parsedJson, $parseErr] = is_array($decoded) ? $parseGeminiJson($decoded) : [null, 'Respuesta HTTP 200 inválida de Gemini.'];

        if (is_array($parsedJson)) {
            $geminiResult = $parsedJson;
            $modelUsed = $currentModel;
            break;
        }
        $lastErrorDetail = $parseErr;
    } else {
        $apiMsg = '';
        if (is_string($responseBody) && $responseBody !== '') {
            $errJson = json_decode($responseBody, true);
            $apiMsg = is_array($errJson) ? (string)($errJson['error']['message'] ?? '') : trim(substr($responseBody, 0, 240));
        }
        if ($curlError !== '') {
            $lastErrorDetail = $curlError;
        } else {
            $lastErrorDetail = 'HTTP ' . $httpStatus . ' al consultar Gemini API' . ($apiMsg !== '' ? ': ' . $apiMsg : '.');
        }
    }

    error_log('[Auditor USB][Gemini API] attempt=' . ($attempt + 1) . ' model=' . $currentModel . ' status=' . $httpStatus . ' detail=' . $lastErrorDetail);

    $isTransient = ($httpStatus === 429 || $httpStatus === 503 || $httpStatus === 500 || $httpStatus === 0);
    $isModelUnavailable = ($httpStatus === 404) && (($attempt + 1) < count($modelChain));
    $isKeyErrorWithMoreKeys = ($httpStatus === 400 || $httpStatus === 401 || $httpStatus === 403) && (($attempt + 1) < count($apiKeys));

    if ($attempt < ($maxAttempts - 1)) {
        if ($isModelUnavailable || $isKeyErrorWithMoreKeys) {
            continue;
        }
        if ($isTransient) {
            // Exponential backoff: 3s en intento 1, 6s en intento 2
            $waitSeconds = min(6, $baseWaitSeconds * (2 ** $attempt));
            sleep($waitSeconds);
            continue;
        }
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

$b1 = $clamp($geminiResult['block1_score'] ?? 0, 0, 50);
$b2 = $clamp($geminiResult['block2_score'] ?? 0, 0, 10);
$b3 = $clamp($geminiResult['block3_score'] ?? 0, 0, 20);
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
    'model_used' => $modelUsed,
    'evaluated_at' => $evaluatedAt
];

$dateKey = gmdate('Y-m-d');
$hashSource = $cleanData['student_name'] . '|' . $totalScore . '|' . $dateKey . '|' . $secretSalt;
$responsePayload['verification_hash'] = strtoupper(substr(hash('sha256', $hashSource), 0, 12));

echo json_encode($responsePayload, JSON_UNESCAPED_UNICODE);
