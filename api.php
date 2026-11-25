<?php
header('Content-Type: application/json; charset=utf-8');

if (!file_exists(__DIR__ . '/config.php')) {
    http_response_code(500);
    echo json_encode(['error' => 'Chybí soubor config.php']);
    exit;
}

require_once __DIR__ . '/config.php';

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

/**
 * Volání ORIS API přes cURL / file_get_contents
 */
function callOrisApi(array $params): array {
    $params['format'] = 'json';
    $url = ORIS_API_URL . '?' . http_build_query($params);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => 'ORIS-Ranking-Tracker/1.0',
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $httpCode !== 200) {
        return [];
    }

    $decoded = json_decode($response, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Zajistí, že máme v DB typy rankingů z ORISu (lesní i sprintový OB)
 */
/**
 * Zajistí, že máme v DB typy rankingů z ORISu (lesní i sprintový OB)
 */
function ensureRankingTypes(PDO $pdo): array {
    $stmt = $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC");
    $types = $stmt->fetchAll();

    if (!empty($types)) {
        return $types;
    }

    // ORIS vyžaduje parametr sport=1 (OB)
    $orisData = callOrisApi([
        'method' => 'getRankingTypes',
        'sport' => 1,
    ]);
    $list = $orisData['Data'] ?? [];

    // Povolená ID: 2 = Lesní ranking, 8 = Sprintový ranking (případně 1 = Standardní do 31.12.2025)
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
 * Vrátí seznam prvních dnů v měsíci v daném intervalu (ORIS vydává ranking k 1. dni v měsíci)
 */
function getMonthlyDates(string $from, string $to): array {
    $start = new DateTime(date('Y-m-01', strtotime($from)));
    $end = new DateTime(date('Y-m-01', strtotime($to)));
    $today = new DateTime(date('Y-m-01'));

    if ($end > $today) {
        $end = $today;
    }

    $dates = [];
    while ($start <= $end) {
        $dates[] = $start->format('Y-m-d');
        $start->modify('+1 month');
    }
    return $dates;
}

/**
 * Zkontroluje chybějící data v DB a stáhne je z ORISu
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
        INSERT IGNORE INTO rankings (type_id, ranking_date, reg_no, name, club, gender, rank_pos)
        VALUES (:type_id, :ranking_date, :reg_no, :name, :club, :gender, :rank_pos)
    ");
    $insertSnap = $pdo->prepare("
        INSERT IGNORE INTO ranking_snapshots (type_id, ranking_date, rows_count)
        VALUES (:type_id, :ranking_date, :rows_count)
    ");

    foreach ($missing as $date) {
        // Bezpečnostní pojistka: max 15 stažení v jednom HTTP požadavku, aby nevypršel timeout
        if ($fetchedCount >= 15) {
            break;
        }

        // ORIS API: getRanking (parametry Type / RankingTypeID dle ORIS specifikace)
        $orisData = callOrisApi([
            'method' => 'getRanking',
            'Type' => $typeId,
            'Date' => $date,
        ]);

        // Záložní pokus, pokud ORIS očekává parametr RankingTypeID
        if (empty($orisData['Data'])) {
            $orisData = callOrisApi([
                'method' => 'getRanking',
                'RankingTypeID' => $typeId,
                'Date' => $date,
            ]);
        }

        $rows = $orisData['Data'] ?? [];
        $count = 0;

        if (is_array($rows) && !empty($rows)) {
            $pdo->beginTransaction();
            foreach ($rows as $row) {
                $regNo = strtoupper(trim($row['RegNo'] ?? ''));
                $rank = (int)($row['Rank'] ?? $row['Place'] ?? 0);
                if ($regNo === '' || $rank <= 0) {
                    continue;
                }

                $firstName = trim($row['FirstName'] ?? '');
                $lastName = trim($row['LastName'] ?? '');
                $fullName = trim($row['Name'] ?? "$lastName $firstName");
                $club = strtoupper(substr($regNo, 0, 3));
                $gender = strtoupper(trim($row['Gender'] ?? ''));

                $insertRow->execute([
                    ':type_id' => $typeId,
                    ':ranking_date' => $date,
                    ':reg_no' => $regNo,
                    ':name' => $fullName,
                    ':club' => $club,
                    ':gender' => $gender ?: null,
                    ':rank_pos' => $rank,
                ]);
                $count++;
            }
            $insertSnap->execute([
                ':type_id' => $typeId,
                ':ranking_date' => $date,
                ':rows_count' => $count,
            ]);
            $pdo->commit();
        } else {
            // Zapíšeme prázdný snapshot (např. pokud v daném měsíci ranking nevyšel), ať se neptáme znovu
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

// --- ROUTOVÁNÍ AKCÍ ---

if ($action === 'types') {
    $types = ensureRankingTypes($pdo);
    echo json_encode(['types' => $types]);
    exit;
}

if ($action === 'search') {
    $typeId = (int)($_GET['type_id'] ?? 1);
    $q = trim($_GET['q'] ?? '');
    $club = strtoupper(trim($_GET['club'] ?? ''));

    // Pokud je DB úplně prázdná, stáhneme nejprve aktuální měsíc, aby bylo v čem vyhledávat
    $currentMonth = date('Y-m-01');
    syncMissingSnapshots($pdo, $typeId, [$currentMonth]);

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
    $typeId = (int)($_GET['type_id'] ?? 1);
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

    // Seskupení podle závodníka
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
