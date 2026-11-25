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

$action = $_GET['action'] ?? '';

function httpGet(string $url): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => 'ORIS-Ranking-Tracker/1.1',
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $httpCode !== 200) {
        return null;
    }
    return $response;
}

function callOrisApi(array $params): array {
    $params['format'] = 'json';
    $url = rtrim(ORIS_API_URL, '/') . '/?' . http_build_query($params);
    $raw = httpGet($url);
    if ($raw === null) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function getOrisBaseOrigin(): string {
    $parts = parse_url(ORIS_API_URL);
    $scheme = $parts['scheme'] ?? 'https';
    $host = $parts['host'] ?? 'oris.ceskyorientak.cz';
    return $scheme . '://' . $host;
}

/**
 * Zajistí, že máme v DB typy rankingů z ORISu (lesní = 2, sprintový = 8)
 */
function ensureRankingTypes(PDO $pdo): array {
    $stmt = $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC");
    $types = $stmt->fetchAll();

    if (!empty($types)) {
        return $types;
    }

    $orisData = callOrisApi([
        'method' => 'getRankingTypes',
        'sport' => 1,
    ]);
    $list = $orisData['Data'] ?? [];

    $allowedIds = [2, 8];
    $insert = $pdo->prepare("INSERT IGNORE INTO ranking_types (id, code, name) VALUES (:id, :code, :name)");

    foreach ($list as $item) {
        $id = (int)($item['ID'] ?? 0);
        $name = trim($item['NameCZ'] ?? $item['Name'] ?? '');

        if (in_array($id, $allowedIds, true) && $name !== '') {
            $code = ($id === 8 || stripos($name, 'sprint') !== false) ? 'sprint' : 'forest';
            $insert->execute([
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
function getMonthlyDates(string $from, string $to): array {
    $start = new DateTime(date('Y-m-01', strtotime($from)));
    $end = new DateTime(date('Y-m-01', strtotime($to)));
    $todayEnd = new DateTime(date('Y-m-t'));

    $endMonthLastDay = new DateTime($end->format('Y-m-t'));
    if ($endMonthLastDay > $todayEnd) {
        $endMonthLastDay = $todayEnd;
    }

    $dates = [];
    while ($start <= $endMonthLastDay) {
        $dates[] = $start->format('Y-m-t');
        $start->modify('+1 month');
    }
    return $dates;
}

function normalizeText(string $str): string {
    $str = trim($str);
    if ($str === '') {
        return '';
    }
    if (!mb_check_encoding($str, 'UTF-8')) {
        $converted = @iconv('CP1250', 'UTF-8//IGNORE', $str);
        if ($converted !== false) {
            $str = $converted;
        }
    }
    $str = preg_replace('/^\xEF\xBB\xBF/', '', $str);
    return trim($str);
}

function normalizeHeader(string $h): string {
    $h = mb_strtolower(normalizeText($h), 'UTF-8');
    return preg_replace('/[^a-z0-9]/u', '', $h);
}

/**
 * Stáhne a naparsuje CSV export rankingu pro dané datum, typ a pohlaví
 */
function fetchRankingCsvRows(string $date, int $rankType, string $gender): array {
    $origin = getOrisBaseOrigin();
    $url = $origin . '/ranking_export?' . http_build_query([
        'date' => $date,
        'sport' => 1,
        'gender' => $gender,
        'ranktype' => $rankType,
        'csv' => 1,
    ]);

    $raw = httpGet($url);
    if ($raw === null || trim($raw) === '') {
        return [];
    }

    $raw = normalizeText($raw);
    $lines = preg_split('/\r\n|\r|\n/', $raw);
    $lines = array_values(array_filter($lines, fn($l) => trim($l) !== ''));

    if (count($lines) < 2) {
        return [];
    }

    // Automatická detekce oddělovače (; nebo ,)
    $delimiter = (substr_count($lines[0], ';') >= substr_count($lines[0], ',')) ? ';' : ',';

    $headerCells = str_getcsv($lines[0], $delimiter);
    $colMap = [];
    foreach ($headerCells as $idx => $col) {
        $norm = normalizeHeader($col);
        if (in_array($norm, ['misto', 'poradi', 'rank', 'place'], true)) {
            $colMap['rank'] = $idx;
        } elseif (in_array($norm, ['jmeno', 'name', 'zavodnik'], true)) {
            $colMap['name'] = $idx;
        } elseif (in_array($norm, ['regcislo', 'regno', 'registrace', 'reg'], true)) {
            $colMap['reg'] = $idx;
        }
    }

    // Záložní pozice sloupců dle tabulky na obrázku (0: Místo, 1: Jméno, 2: Reg. číslo)
    $rankIdx = $colMap['rank'] ?? 0;
    $nameIdx = $colMap['name'] ?? 1;
    $regIdx = $colMap['reg'] ?? 2;

    $parsed = [];
    for ($i = 1; $i < count($lines); $i++) {
        $cells = str_getcsv($lines[$i], $delimiter);
        if (count($cells) <= max($rankIdx, $nameIdx, $regIdx)) {
            continue;
        }

        $rank = (int)preg_replace('/[^0-9]/', '', (string)$cells[$rankIdx]);
        $name = normalizeText((string)$cells[$nameIdx]);
        $regNo = strtoupper(normalizeText((string)$cells[$regIdx]));

        if ($regNo === '' || $rank <= 0) {
            continue;
        }

        $club = strtoupper(substr($regNo, 0, 3));
        $parsed[] = [
            'reg_no' => $regNo,
            'name' => $name ?: $regNo,
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
function syncMissingSnapshots(PDO $pdo, int $typeId, array $dates): int {
    if (empty($dates)) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($dates), '?'));
    $stmt = $pdo->prepare("SELECT ranking_date FROM ranking_snapshots WHERE type_id = ? AND ranking_date IN ($placeholders)");
    $stmt->execute(array_merge([$typeId], $dates));
    $existing = array_column($stmt->fetchAll(), 'ranking_date');

    $missing = array_diff($dates, $existing);
    $fetchedCount = 0;

    $insertRow = $pdo->prepare("
        INSERT INTO rankings (type_id, ranking_date, reg_no, name, club, gender, rank_pos)
        VALUES (:type_id, :ranking_date, :reg_no, :name, :club, :gender, :rank_pos)
        ON DUPLICATE KEY UPDATE name = VALUES(name), club = VALUES(club), rank_pos = VALUES(rank_pos)
    ");
    $insertSnap = $pdo->prepare("
        INSERT IGNORE INTO ranking_snapshots (type_id, ranking_date, rows_count)
        VALUES (:type_id, :ranking_date, :rows_count)
    ");

    foreach ($missing as $date) {
        if ($fetchedCount >= 12) {
            break;
        }

        $rowsM = fetchRankingCsvRows($date, $typeId, 'M');
        $rowsF = fetchRankingCsvRows($date, $typeId, 'F');
        $allRows = array_merge($rowsM, $rowsF);
        $count = count($allRows);

        if ($count > 0) {
            $pdo->beginTransaction();
            foreach ($allRows as $row) {
                $insertRow->execute([
                    ':type_id' => $typeId,
                    ':ranking_date' => $date,
                    ':reg_no' => $row['reg_no'],
                    ':name' => $row['name'],
                    ':club' => $row['club'],
                    ':gender' => $row['gender'],
                    ':rank_pos' => $row['rank_pos'],
                ]);
            }
            $insertSnap->execute([
                ':type_id' => $typeId,
                ':ranking_date' => $date,
                ':rows_count' => $count,
            ]);
            $pdo->commit();
        } else {
            $insertSnap->execute([
                ':type_id' => $typeId,
                ':ranking_date' => $date,
                ':rows_count' => 0,
            ]);
        }

        $fetchedCount++;
    }

    return $fetchedCount;
}

if ($action === 'types') {
    $types = ensureRankingTypes($pdo);
    echo json_encode(['types' => $types]);
    exit;
}

if ($action === 'search') {
    $typeId = (int)($_GET['type_id'] ?? 2);
    $q = trim($_GET['q'] ?? '');
    $club = strtoupper(trim($_GET['club'] ?? ''));

    $currentMonthEnd = date('Y-m-t');
    syncMissingSnapshots($pdo, $typeId, [$currentMonthEnd]);

    if ($club !== '') {
        $stmt = $pdo->prepare("
            SELECT reg_no, MAX(name) AS name, club, MAX(gender) AS gender, MIN(rank_pos) AS best_rank
            FROM rankings
            WHERE type_id = :type_id AND club = :club
            GROUP BY reg_no, club
            ORDER BY best_rank ASC, name ASC
        ");
        $stmt->execute([':type_id' => $typeId, ':club' => $club]);
        echo json_encode(['athletes' => $stmt->fetchAll()]);
        exit;
    }

    if (mb_strlen($q) < 2) {
        echo json_encode(['athletes' => []]);
        exit;
    }

    $like = '%' . $q . '%';
    $stmt = $pdo->prepare("
        SELECT reg_no, MAX(name) AS name, club, MAX(gender) AS gender, MIN(rank_pos) AS best_rank
        FROM rankings
        WHERE type_id = :type_id AND (reg_no LIKE :q1 OR name LIKE :q2)
        GROUP BY reg_no, club
        ORDER BY best_rank ASC, name ASC
        LIMIT 30
    ");
    $stmt->execute([':type_id' => $typeId, ':q1' => $like, ':q2' => $like]);
    echo json_encode(['athletes' => $stmt->fetchAll()]);
    exit;
}

if ($action === 'series') {
    $typeId = (int)($_GET['type_id'] ?? 2);
    $from = $_GET['from'] ?? date('Y-m-d', strtotime('-1 year'));
    $to = $_GET['to'] ?? date('Y-m-d');
    $regNosRaw = $_GET['reg_nos'] ?? '';

    $regNos = array_values(array_filter(array_map(
        fn($r) => strtoupper(trim($r)),
        explode(',', $regNosRaw)
    )));

    $dates = getMonthlyDates($from, $to);
    $newlyFetched = syncMissingSnapshots($pdo, $typeId, $dates);

    if (empty($regNos) || empty($dates)) {
        echo json_encode([
            'dates' => $dates,
            'series' => [],
            'newly_fetched' => $newlyFetched,
        ]);
        exit;
    }

    $regPlaceholders = implode(',', array_fill(0, count($regNos), '?'));
    $datePlaceholders = implode(',', array_fill(0, count($dates), '?'));

    $sql = "
        SELECT reg_no, name, ranking_date, rank_pos
        FROM rankings
        WHERE type_id = ?
          AND reg_no IN ($regPlaceholders)
          AND ranking_date IN ($datePlaceholders)
        ORDER BY ranking_date ASC
    ";

    $params = array_merge([$typeId], $regNos, $dates);
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $byAthlete = [];
    foreach ($regNos as $reg) {
        $byAthlete[$reg] = [
            'reg_no' => $reg,
            'name' => $reg,
            'points' => array_fill_keys($dates, null),
        ];
    }

    foreach ($rows as $row) {
        $reg = $row['reg_no'];
        $byAthlete[$reg]['name'] = $row['name'];
        $byAthlete[$reg]['points'][$row['ranking_date']] = (int)$row['rank_pos'];
    }

    $series = [];
    foreach ($byAthlete as $item) {
        $series[] = [
            'reg_no' => $item['reg_no'],
            'name' => $item['name'],
            'data' => array_values($item['points']),
        ];
    }

    echo json_encode([
        'dates' => $dates,
        'series' => $series,
        'newly_fetched' => $newlyFetched,
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Neznámá akce API']);
