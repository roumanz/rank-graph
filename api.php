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

if ($action === 'types') {
    $stmt = $pdo->query("SELECT id, code, name FROM ranking_types ORDER BY id ASC");
    $types = $stmt->fetchAll();

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

echo json_encode(['status' => 'ok', 'action' => $action]);
