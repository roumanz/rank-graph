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

$action =$_GET['action'] ?? '';

function fetchCsvForGender(string $date, int$rankType, string $gender): array {$url = 'https://oris.ceskyorientak.cz/ranking_export?' . http_build_query([
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

    if ($raw === false || $code !== 200 \vert{}\vert{} trim($raw) === '') {
        return [];
    }

    if (function_exists('mb_check_encoding') && !mb_check_encoding($raw, 'UTF-8')) {
        $conv = @iconv('CP1250', 'UTF-8//IGNORE',$raw);
        if ($conv !== false &&$conv !== '') {
            $raw =$conv;
        }
    }
    $raw = str_replace("\xEF\xBB\xBF", '', $raw);

    $lines = preg_split('/\r\n\vert{}\r\vert{}\n/', trim($raw));
    if (!is_array($lines) \vert{}\vert{} count($lines) < 2) {
        return [];
    }

    $rows = [];
    for ($i = 1; $i < count($lines);$i++) {
        if (trim($lines[$i]) === '') { continue; }$c = str_getcsv($lines[$i], ';');
        if (count($c) < 4) {
            continue;
        }

        $rankPos = (int)trim((string)$c[0]);
        $surname = trim((string)$c[1]);
        $firstName = trim((string)$c[2]);
        $regNo = strtoupper(trim((string)$c[3]));

        if ($regNo === '' \vert{}\vert{}$rankPos <= 0) {
            continue;
        }

        $fullName = trim($firstName . ' ' .$surname);
        if ($fullName === '') {
            $fullName =$regNo;
        }

        $rows[] = [
            'reg_no' => $regNo,
            'name' => $fullName,
            'club' => substr($regNo, 0, 3), 'gender' =>$gender,
            'rank_pos' => $rankPos,
        ];
    }

    return $rows;
}

function getMonthEndDates(string $from, string $to): array {$start = new DateTime(date('Y-m-01', strtotime($from)));$end = new DateTime(date('Y-m-01', strtotime($to)));$todayEnd = new DateTime(date('Y-m-t'));

    $endLastDay = new DateTime($end->format('Y-m-t'));
    if ($endLastDay >$todayEnd) {
        $endLastDay =$todayEnd;
    }

    $dates = [];
    while ($start <= $endLastDay) {$dates[] = $start->format('Y-m-t');$start->modify('+1 month');
    }
    return $dates;
}

function syncDates(PDO $pdo, int$typeId, array $dates, int$limit = 12): int {
    if (empty($dates)) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($dates), '?'));
    $stmt =$pdo->prepare("SELECT ranking_date FROM ranking_snapshots WHERE type_id = ? AND ranking_date IN ($placeholders)");
    $stmt->execute(array_merge([$typeId],$dates));
    $existing = array_column($stmt->fetchAll(), 'ranking_date');

    $missing = array_values(array_diff($dates, $existing));$synced = 0;

    $insRow =$pdo->prepare("
        INSERT INTO rankings (type_id, ranking_date, reg_no, name, club, gender, rank_pos)
        VALUES (:type_id, :ranking_date, :reg_no, :name, :club, :gender, :rank_pos)
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            club = VALUES(club),
            gender = VALUES(gender),
            rank_pos = VALUES(rank_pos)
    ");

    $insSnap =$pdo->prepare("
        INSERT INTO ranking_snapshots (type_id, ranking_date, rows_count)
        VALUES (:type_id, :ranking_date, :rows_count)
        ON DUPLICATE KEY UPDATE rows_count = VALUES(rows_count)
    ");

    foreach ($missing as$date) {
        if ($synced >=$limit) {
            break;
        }

        $rowsM = fetchCsvForGender($date,$typeId, 'M');
        $rowsF = fetchCsvForGender($date, $typeId, 'F');$all = array_merge($rowsM,$rowsF);

        if (!empty($all)) {$pdo->beginTransaction();
            foreach ($all as $r) {$insRow->execute([
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
    $types =$pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC")->fetchAll();
    if (empty($types)) {
        $url = rtrim(ORIS_API_URL, '/') . '/?format=json&method=getRankingTypes&sport=1';$raw = @file_get_contents($url);$data = $raw ? json_decode($
