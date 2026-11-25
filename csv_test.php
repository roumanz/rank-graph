<?php
header('Content-Type: application/json; charset=utf-8');

$date = $_GET['date'] ?? '2026-10-31';
$rankType = (int)($_GET['ranktype'] ?? 2);
$gender = strtoupper($_GET['gender'] ?? 'M');
$regFilter = strtoupper(trim($_GET['reg'] ?? 'TZL8808'));

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
    CURLOPT_TIMEOUT => 20,
    CURLOPT_USERAGENT => 'ORIS-CSV-Test/1.0',
]);
$raw = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($raw === false || $httpCode !== 200) {
    echo json_encode([
        'ok' => false,
        'url' => $url,
        'http_code' => $httpCode,
        'curl_error' => $curlErr,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// Pokud není platné UTF-8, zkusíme převod z Windows-1250
if (function_exists('mb_check_encoding') && !mb_check_encoding($raw, 'UTF-8')) {
    $converted = @iconv('CP1250', 'UTF-8//IGNORE', $raw);
    if ($converted !== false && $converted !== '') {
        $raw = $converted;
    }
}
$raw = str_replace("\xEF\xBB\xBF", '', $raw);

$lines = preg_split('/\r\n|\r|\n/', trim($raw));
$delimiter = (substr_count($lines[0] ?? '', ';') >= substr_count($lines[0] ?? '', ',')) ? ';' : ',';

$header = !empty($lines[0]) ? str_getcsv($lines[0], $delimiter) : [];
$matchedRows = [];
$sampleRows = [];

for ($i = 1; $i < count($lines); $i++) {
    if (trim($lines[$i]) === '') {
        continue;
    }
    $cells = str_getcsv($lines[$i], $delimiter);
    if ($i <= 3) {
        $sampleRows[] = $cells;
    }
    foreach ($cells as $cell) {
        if (strtoupper(trim((string)$cell)) === $regFilter) {
            $matchedRows[] = $cells;
            break;
        }
    }
}

echo json_encode([
    'ok' => true,
    'url' => $url,
    'delimiter' => $delimiter,
    'total_lines' => count($lines),
    'header' => $header,
    'sample_rows' => $sampleRows,
    'reg_filter' => $regFilter,
    'matched_rows' => $matchedRows,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
