# ORIS Ranking Tracker (`rank-graph`)

Webová aplikace pro vizualizaci historického vývoje pořadí závodníků v orientačním běhu v rankingu ČSOS (ORIS) s lokálním kešováním do databáze.

Živá instance běží na: `https://rankst.rouman.eu/`

## Hlavní funkce

* **Výběr typu rankingu:** lesní ranking (`ranktype=2`) a sprintový ranking (`ranktype=8`), načítané přes ORIS API (`getRankingTypes&sport=1`).
* **Volba období:** předvolba *Poslední rok* nebo vlastní rozsah *Od – Do* po jednotlivých měsících.
* **Vyhledávání závodníků a oddílů:** našeptávač podle jména nebo registračního čísla (např. `TZL8808`) a rychlé načtení členů oddílu podle zkratky (např. `TZL`).
* **Interaktivní graf (Chart.js):** obrácená osa Y (1. místo nahoře), rovné spojnice mezi měsíčními uzávěrkami, rozlišení překrývajících se umístění ve stejném měsíci při zachování přesného pořadí v tooltipu.
* **Sdílení situace přes URL:** stav zvoleného rankingu, období i vybraných závodníků se ukládá do parametrů URL pro snadné sdílení odkazu.

## Jak fungují data z ORISu

* Typy rankingů se načítají z ORIS API (`https://oris.ceskyorientak.cz/API/?format=json&method=getRankingTypes&sport=1`).
* Měsíční žebříčky se stahují jako CSV export ze středníkem (`;`):
  `https://oris.ceskyorientak.cz/ranking_export?date=YYYY-MM-DD&sport=1&gender=M|F&ranktype=2|8&csv=1`
* Stažené měsíční snímky se ukládají do tabulek `ranking_snapshots` a `rankings`, takže se každý měsíc stáhne jen jednou.

## Struktura repozitáře

* `.github/workflows/deploy.yml` – automatické nasazení na hosting přes FTP po pushnutí do `main` (s vyloučením `config.php` na serveru).
* `index.html`, `style.css`, `app.js` – frontend a vykreslování grafu.
* `api.php` – backend v PHP (akce `types`, `search`, `series`, stahování a parsování CSV, práce s MySQL přes PDO).
* `database.sql` – SQL schéma databázových tabulek.
* `config.example.php` – vzor konfigurace připojení k databázi (`config.php` není verzován a udržuje se přímo na serveru).

## Nasazení a provoz

1. Vytvořit tabulky v MySQL podle `database.sql`.
2. Na hostingu (Wedos, PHP 8.3) připravit soubor `config.php` podle `config.example.php` s přihlašovacími údaji k databázi.
3. Nastavit FTP secrets v GitHub Actions a pushnout změny do větve `main`.
