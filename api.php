<?php
header('Content-Type: application/json; charset=utf-8');

if (!file_exists(__DIR__ . '/config.php')) {
    http_response_code(500);
    echo json_encode(['error' => 'Chybi soubor config.php']);
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
    echo json_encode(['error' => 'Chyba DB: ' . $e->getMessage()]);
    exit;
}

$action = $_GET['action'] ?? '';

function fetchCsvForGender(string $date, int $rankType, string $gender): array {
    $url = 'https://oris.ceskyorientak.cz/ranking_export?' . http_build_query([
        'date' => $date,
        'sport' => 1,
        'gender' => $gender,
        'ranktype' => $rankType,
        'csv' => 1,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => 'ORIS-Ranking-App/1.0',
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code !== 200 || trim($raw) === '') {
        return [];
    }

    if (function_exists('mb_check_encoding') && !mb_check_encoding($raw, 'UTF-8')) {
        $conv = @iconv('CP1250', 'UTF-8//IGNORE', $raw);
        if ($conv !== false && $conv !== '') {
            $raw = $conv;
        }
    }
    $raw = str_replace("\xEF\xBB\xBF", '', $raw);

    $lines = preg_split('/\r\n|\r|\n/', trim($raw));
    if (!is_array($lines) || count($lines) < 2) {
        return [];
    }

    $rows = [];
    for ($i = 1; $i < count($lines); $i++) {
        if (trim($lines[$i]) === '') {
            continue;
        }
        $c = str_getcsv($lines[$i], ';');
        if (count($c) < 4) {
            continue;
        }

        $rankPos = (int)trim((string)$c[0]);
        $surname = trim((string)$c[1]);
        $firstName = trim((string)$c[2]);
        $regNo = strtoupper(trim((string)$c[3]));

        if ($regNo === '' || $rankPos <= 0) {
            continue;
        }

        $fullName = trim($firstName . ' ' . $surname);
        if ($fullName === '') {
            $fullName = $regNo;
        }

        $rows[] = [
            'reg_no' => $regNo,
            'name' => $fullName,
            'club' => substr($regNo, 0, 3),
            'gender' => $gender,
            'rank_pos' => $rankPos,
        ];
    }

    return $rows;
}

function getMonthEndDates(string $from, string $to): array {
    $start = new DateTime(date('Y-m-01', strtotime($from)));
    $end = new DateTime(date('Y-m-01', strtotime($to)));
    $todayEnd = new DateTime(date('Y-m-t'));

    $endLastDay = new DateTime($end->format('Y-m-t'));
    if ($endLastDay > $todayEnd) {
        $endLastDay = $todayEnd;
    }

    $dates = [];
    while ($start <= $endLastDay) {
        $dates[] = $start->format('Y-m-t');
        $start->modify('+1 month');
    }
    return $dates;
}

function syncDates(PDO $pdo, int $typeId, array $dates, int $limit = 12): int {
    if (empty($dates)) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($dates), '?'));
    $stmt = $pdo->prepare("SELECT ranking_date FROM ranking_snapshots WHERE type_id = ? AND ranking_date IN ($placeholders)");
    $stmt->execute(array_merge([$typeId], $dates));
    $existing = array_column($stmt->fetchAll(), 'ranking_date');

    $missing = array_values(array_diff($dates, $existing));
    $synced = 0;

    $insRow = $pdo->prepare("
        INSERT INTO rankings (type_id, ranking_date, reg_no, name, club, gender, rank_pos)
        VALUES (:type_id, :ranking_date, :reg_no, :name, :club, :gender, :rank_pos)
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            club = VALUES(club),
            gender = VALUES(gender),
            rank_pos = VALUES(rank_pos)
    ");

    $insSnap = $pdo->prepare("
        INSERT INTO ranking_snapshots (type_id, ranking_date, rows_count)
        VALUES (:type_id, :ranking_date, :rows_count)
        ON DUPLICATE KEY UPDATE rows_count = VALUES(rows_count)
    ");

    foreach ($missing as $date) {
        if ($synced >= $limit) {
            break;
        }

        $rowsM = fetchCsvForGender($date, $typeId, 'M');
        $rowsF = fetchCsvForGender($date, $typeId, 'F');
        $all = array_merge($rowsM, $rowsF);

        if (!empty($all)) {
            $pdo->beginTransaction();
            foreach ($all as $r) {
                $insRow->execute([
                    ':type_id' => $typeId,
                    ':ranking_date' => $date,
                    ':reg_no' => $r['reg_no'],
                    ':name' => $r['name'],
                    ':club' => $r['club'],
                    ':gender' => $r['gender'],
                    ':rank_pos' => $r['rank_pos'],
                ]);
            }
            $insSnap->execute([
                ':type_id' => $typeId,
                ':ranking_date' => $date,
                ':rows_count' => count($all),
            ]);
            $pdo->commit();
        } else {
            $insSnap->execute([
                ':type_id' => $typeId,
                ':ranking_date' => $date,
                ':rows_count' => 0,
            ]);
        }

        $synced++;
    }

    return $synced;
}

if ($action === 'types') {
    $types = $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC")->fetchAll();
    if (empty($types)) {
        $url = rtrim(ORIS_API_URL, '/') . '/?format=json&method=getRankingTypes&sport=1';
        $raw = @file_get_contents($url);
        $data = $raw ? json_decode($raw, true) : null;
        if (is_array($data) && !empty($data['Data'])) {
            $ins = $pdo->prepare("INSERT IGNORE INTO ranking_types (id, code, name) VALUES (:id, :code, :name)");
            foreach ($data['Data'] as $item) {
                $id = (int)($item['ID'] ?? 0);
                $name = trim((string)($item['NameCZ'] ?? $item['Name'] ?? ''));
                if (($id === 2 || $id === 8) && $name !== '') {
                    $code = ($id === 8) ? 'sprint' : 'forest';
                    $ins->execute([':id' => $id, ':code' => $code, ':name' => $name]);
                }
            }
            $types = $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC")->fetchAll();
        }
    }
    echo json_encode(['types' => $types]);
    exit;
}

if ($action === 'search') {
    $typeId = (int)($_GET['type_id'] ?? 2);
    $q = trim($_GET['q'] ?? '');
    $club = strtoupper(trim($_GET['club'] ?? ''));

    syncDates($pdo, $typeId, [date('Y-m-t')], 1);

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

    if (strlen($q) < 2) {
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

    $dates = getMonthEndDates($from, $to);
    $newlySynced = syncDates($pdo, $typeId, $dates, 12);

    if (empty($regNos) || empty($dates)) {
        echo json_encode([
            'dates' => $dates,
            'series' => [],
            'newly_fetched' => $newlySynced,
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

    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_merge([$typeId], $regNos, $dates));
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
        'newly_fetched' => $newlySynced,
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Neznama akce API']);
