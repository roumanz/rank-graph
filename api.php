<?php
header('Content-Type: application/json; charset=utf-8');

if (!file_exists(__DIR__ . '/config.php')) {
    http_response_code(500);
    echo json_encode(['error' => 'Chybí soubor config.php']);
    exit;
}

require_once __DIR__ . '/config.php';

if (!defined('ORIS_API_URL')) {
    define('ORIS_API_URL', 'https://oris.ceskyorientak.cz/API/');
}

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Chyba připojení k databázi: ' . $e->getMessage()]);
    exit;
}

$action =$_GET['action'] ?? '';

function httpGet(string $url): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => 'ORIS-Ranking-Tracker/1.2',
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false \vert{}\vert{}$httpCode !== 200) {
        return null;
    }
    return $response;
}

function callOrisApi(array $params): array {$params['format'] = 'json';
    $url = rtrim(ORIS_API_URL, '/') . '/?' . http_build_query($params);
    $raw = httpGet($url);
    if ($raw === null) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ?$decoded : [];
}

function getOrisBaseOrigin(): string {
    $parts = parse_url(ORIS_API_URL);
    $scheme =$parts['scheme'] ?? 'https';
    $host =$parts['host'] ?? 'oris.ceskyorientak.cz';
    return $scheme . '://' .$host;
}

function toUtf8Safe(string $str): string {
    $str = trim($str);
    if ($str === '') {
        return '';
    }
    if (strncmp($str, "\xEF\xBB\xBF", 3) === 0) {
        $str = substr($str, 3);
    }
    if (function_exists('mb_check_encoding') && !mb_check_encoding($str, 'UTF-8')) {
        $converted = @iconv('CP1250', 'UTF-8//IGNORE',$str);
        if ($converted !== false &&$converted !== '') {
            $str =$converted;
        }
    }
    if (function_exists('mb_convert_encoding')) {
        $str = mb_convert_encoding($str, 'UTF-8', 'UTF-8');
    }
    return trim($str);
}

function normalizeHeader(string $h): string {
    $h = toUtf8Safe($h);
    $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE',$h);
    if ($ascii !== false &&$ascii !== '') {
        $h =$ascii;
    }
    $clean = preg_replace('/[^a-zA-Z0-9]/', '', strtolower($h));
    return is_string($clean) ?$clean : '';
}

/**
 * Zajistí, že máme v DB typy rankingů z ORISu (lesní = 2, sprintový = 8)
 */
function ensureRankingTypes(PDO $pdo): array {
    $stmt =$pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC");
    $types =$stmt->fetchAll();

    if (!empty($types)) {
        return $types;
    }

    $orisData = callOrisApi([
        'method' => 'getRankingTypes',
        'sport' => 1,
    ]);
    $list =$orisData['Data'] ?? [];

    $allowedIds = [2, 8];
    $insert =$pdo->prepare("INSERT IGNORE INTO ranking_types (id, code, name) VALUES (:id, :code, :name)");

    foreach ($list as $item) {$id = (int)($item['ID'] ?? 0);$name = toUtf8Safe((string)($item['NameCZ'] ?? $item['Name'] ?? ''));

        if (in_array($id, $allowedIds, true) &&$name !== '') {
            $code = ($id === 8 || stripos($name, 'sprint') !== false) ? 'sprint' : 'forest';$insert->execute([
                ':id' => $id,
                ':code' => $code,
                ':name' => $name,
            ]);
        }
    }

    return $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC")->fetchAll();
}

/**
 * Vrátí seznam konců měsíců v daném intervalu (např. 2026-11-30)
 */
function getMonthlyDates(string $from, string $to): array {$start = new DateTime(date('Y-m-01', strtotime($from)));$end = new DateTime(date('Y-m-01', strtotime($to)));$todayEnd = new DateTime(date('Y-m-t'));

    $endMonthLastDay = new DateTime($end->format('Y-m-t'));
    if ($endMonthLastDay >$todayEnd) {
        $endMonthLastDay =$todayEnd;
    }

    $dates = [];
    while ($start <= $endMonthLastDay) {$dates[] = $start->format('Y-m-t');$start->modify('+1 month');
    }
    return $dates;
}

/**
 * Stáhne a naparsuje CSV export rankingu pro dané datum, typ a pohlaví
 */
function fetchRankingCsvRows(string $date, int$rankType, string $gender): array {$origin = getOrisBaseOrigin();
    $url =$origin . '/ranking_export?' . http_build_query([
        'date' => $date,
        'sport' => 1,
        'gender' => $gender,
        'ranktype' => $rankType,
        'csv' => 1,
    ]);

    $raw = httpGet($url);
    if ($raw === null \vert{}\vert{} trim($raw) === '') {
        return [];
    }

    $raw = toUtf8Safe($raw);
    $lines = preg_split('/\r\n\vert{}\r\vert{}\n/',$raw);
    if (!is_array($lines)) { return []; }$lines = array_values(array_filter($lines, function ($l) {
        return trim((string)$l) !== '';
    }));

    if (count($lines) < 2) {
        return [];
    }

    $delimiter = (substr_count($lines[0], ';') >= substr_count($lines[0], ',')) ? ';' : ',';

    $headerCells = str_getcsv($lines[0], $delimiter);$rankIdx = null;
    $nameIdx = null;
    $regIdx = null;

    foreach ($headerCells as $idx =>$col) {
        $norm = normalizeHeader((string)$col);
        if ($rankIdx === null && in_array($norm, ['misto', 'poradi', 'rank', 'place'], true)) {
            $rankIdx =$idx;
        } elseif ($nameIdx === null && in_array($norm, ['jmeno', 'name', 'zavodnik'], true)) {
            $nameIdx =$idx;
        } elseif ($regIdx === null && (strpos($norm, 'reg') !== false \vert{}\vert{} in_array($norm, ['registracnicislo', 'regno'], true))) {
            $regIdx =$idx;
        }
    }

    $parsed = [];
    for ($i = 1; $i < count($lines);$i++) {
        $cells = str_getcsv($lines[$i],$delimiter);
        if (!is_array($cells) \vert{}\vert{} empty($cells)) {
            continue;
        }

        // Registrační číslo (např. TZL8808)
        $regNo = '';
        if ($regIdx !== null && isset($cells[$regIdx])) {$candidate = strtoupper(toUtf8Safe((string)$cells[$regIdx]));
            if (preg_match('/^[A-Z]{3}\d+/', $candidate, $m)) {$regNo = $m[0]; } elseif ($candidate !== '' && preg_match('/^[A-Z0-9]{4,12}$/',$candidate)) {
                $regNo =$candidate;
            }
        }
        if ($regNo === '') {
            foreach ($cells as$cell) {
                $candidate = strtoupper(toUtf8Safe((string)$cell));
                if (preg_match('/^[A-Z]{3}\d{2,5}$/',$candidate)) {
                    $regNo =$candidate;
                    break;
                }
            }
        }

        // Pořadí (místo)
        $rank = 0;
        if ($rankIdx !== null && isset($cells[$rankIdx])) {$rank = (int)preg_replace('/[^0-9]/', '', (string)$cells[$rankIdx]);
        } elseif (isset($cells[0])) {
            $rank = (int)preg_replace('/[^0-9]/', '', (string)$cells[0]);
        }

        // Jméno závodníka
        $name = '';
        if ($nameIdx !== null && isset($cells[$nameIdx])) {$name = toUtf8Safe((string)$cells[$nameIdx]);
        }
        if ($name === '') {
            foreach ($cells as$cell) {
                $candidateName = toUtf8Safe((string)$cell);
                if ($candidateName !== '' && !preg_match('/^[A-Z]{3}\d+$/i', $candidateName) && !is_numeric($candidateName)) {
                    $name =$candidateName;
                    break;
                }
            }
        }

        if ($regNo === '' \vert{}\vert{}$rank <= 0) {
            continue;
        }

        $club = substr($regNo, 0, 3);$parsed[] = [
            'reg_no' => $regNo,
            'name' => $name !== '' ? $name :$regNo,
            'club' => $club,
            'gender' => $gender,
            'rank_pos' => $rank,
        ];
    }

    return $parsed;
}

/**
 * Zkontroluje chybějící měsíce v DB a stáhne je z CSV exportu ORISu
 */
function syncMissingSnapshots(PDO $pdo, int $typeId, array$dates): int {
    if (empty($dates)) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($dates), '?'));
    $stmt =$pdo->prepare("SELECT ranking_date FROM ranking_snapshots WHERE type_id = ? AND ranking_date IN ($placeholders)");
    $stmt->execute(array_merge([$typeId],$dates));
    $existing = array_column($stmt->fetchAll(), 'ranking_date');

    $missing = array_diff
