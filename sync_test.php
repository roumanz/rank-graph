<?php
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';

if (!defined('ORIS_API_URL')) {
    define('ORIS_API_URL', 'https://oris.ceskyorientak.cz/API/');
}

$pdo = new PDO(
    'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
    DB_USER,
    DB_PASS,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
);

$date = $_GET['date'] ?? '2026-10-31';
$rankType = (int)($_GET['ranktype'] ?? 2);

function loadGenderCsv(string $date, int $rankType, string $gender): array {
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
        CURLOPT_USERAGENT => 'ORIS-Ranking-Sync/1.0',
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
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

        $club = substr($regNo, 0, 3);

        $rows[] = [
            'reg_no' => $regNo,
            'name' => $fullName,
            'club' => $club,
            'gender' => $gender,
            'rank_pos' => $rankPos,
        ];
    }

    return $rows;
}

$rowsM = loadGenderCsv($date, $rankType, 'M');
$rowsF = loadGenderCsv($date, $rankType, 'F');
$all = array_merge($rowsM, $rowsF);

$pdo->beginTransaction();

$insRow = $pdo->prepare("
    INSERT INTO rankings (type_id, ranking_date, reg_no, name, club, gender, rank_pos)
    VALUES (:type_id, :ranking_date, :reg_no, :name, :club, :gender, :rank_pos)
    ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        club = VALUES(club),
        gender = VALUES(gender),
        rank_pos = VALUES(rank_pos)
");

foreach ($all as $r) {
    $insRow->execute([
        ':type_id' => $rankType,
        ':ranking_date' => $date,
        ':reg_no' => $r['reg_no'],
        ':name' => $r['name'],
        ':club' => $r['club'],
        ':gender' => $r['gender'],
        ':rank_pos' => $r['rank_pos'],
    ]);
}

$insSnap = $pdo->prepare("
    INSERT INTO ranking_snapshots (type_id, ranking_date, rows_count)
    VALUES (:type_id, :ranking_date, :rows_count)
    ON DUPLICATE KEY UPDATE rows_count = VALUES(rows_count)
");
$insSnap->execute([
    ':type_id' => $rankType,
    ':ranking_date' => $date,
    ':rows_count' => count($all),
]);

$pdo->commit();

$check = $pdo->prepare("SELECT * FROM rankings WHERE type_id = :t AND ranking_date = :d AND reg_no = 'TZL8808'");
$check->execute([':t' => $rankType, ':d' => $date]);

echo json_encode([
    'ok' => true,
    'date' => $date,
    'ranktype' => $rankType,
    'saved_m' => count($rowsM),
    'saved_f' => count($rowsF),
    'saved_total' => count($all),
    'tzl8808_in_db' => $check->fetchAll(),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
