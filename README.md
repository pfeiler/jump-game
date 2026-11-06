# Jump Game 🦘⛏

Ein Mixed-Reality-Hüpfspiel für den Browser – Kamera an, aufs Trampolin (oder einfach auf den Teppich),
und mit echten Sprüngen spielen. Gedacht für Kinder von 4–12 Jahren, Oberfläche auf Deutsch.

Inspiriert von **ValoJump** (Valo Motion) – dies ist ein unabhängiges Hobby-Projekt ohne Verbindung zu Valo Motion
und verwendet keinerlei Assets oder Code von dort.

**Live:** https://pfeiler.github.io/jump-game/ (HTTPS, damit der Browser die Kamera freigibt)

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173/jump-game/  (localhost gilt als „sicher“ → Kamera erlaubt)
npm test           # vitest: One-Euro-Filter, Sprung-Zustandsautomat, Mine-Time-Logik
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # http://localhost:4173/jump-game/
```

`predev`/`prebuild` kopieren die MediaPipe-WASM-Dateien aus `node_modules` nach `public/mediapipe/wasm/`
(nicht eingecheckt). Die Pose-Modelle liegen selbst gehostet in `public/models/`.

## Bedienung

| | Kamera | Tastatur / Maus (Fallback) |
|---|---|---|
| Spalte wählen | nach links/rechts gehen | ← / → (oder A / D), Maus-X |
| Sprung (= 1 Schlag) | springen, Landung zählt | Leertaste / W / ↑ |
| Hochsprung (= doppelter Schlag) | lange Flugzeit (≥ 0,5 s) | Shift + Leertaste / E / ↓ |
| Menüfeld aktivieren | übers Feld stellen und springen | Enter / Klick |
| Weiter nach der Level-Pause | beide Arme über den Kopf heben und ~0,65 s halten (nicht springen) | Enter / Leertaste |
| Debug-Overlay | – | **B** oder F2 |
| Ton an/aus | – | M |

Die Kamera wird schon beim Laden der Seite angefragt (dafür ist keine Nutzer-Geste nötig): Der Startbildschirm
zeigt das gespiegelte Live-Bild mit Freisteller und Skelett, den Hinweis „Stell dich so hin, dass du ganz im Bild bist“
und einen grünen Haken „Du bist im Bild ✓“, sobald Kopf bis Füße zu sehen sind. Kamera und Pose-Tracking laufen
danach ohne Neustart durch Menü, Kalibrierung und Spiel. Der erste Klick/Tastendruck startet das Spiel (Audio-Freigabe).
Ist die Kamera verweigert oder nicht vorhanden, erscheint ein freundlicher Hinweis und alles läuft per Tastatur.

**Sprungkalibrierung:** Beim ersten Start mit Kamera (ohne `?sens=`) hüpft man etwa 10 Mal normal. Daraus wird die Empfindlichkeit gespeichert (`localStorage`, Schlüssel `jumpgame.jumpcalib`) und beim nächsten Mal geladen. `C` auf dem Startbildschirm oder in der Still-Kalibrierung misst neu, Enter überspringt. Liegen die normalen Hüpfer schon nahe an der Hochsprung-Schwelle, wird nur diese Schwelle etwas angehoben – normale Landung bleibt 1 Treffer, Hochsprung 2. `?sens=` und `?high=` haben beim Laden Vorrang vor dem gespeicherten Wert.

### URL-Parameter

| Parameter | Wirkung |
|---|---|
| `?debug=1` | Debug-Overlay sofort an (Landmarks, Baseline, Schwellen, Hüft-Kurve, FPS, Latenz) |
| `?nocam=1` | Kamera gar nicht anfragen |
| `?model=lite` | schnelleres Lite-Modell statt Full (für schwache Laptops) |
| `?delegate=cpu` | GPU-Delegate überspringen (WASM/XNNPACK) |
| `?seg=0` | keine Personen-Freistellung (spart Rechenzeit; Kamerabild wird dann abgedunkelt gezeigt) |
| `?worker=0` | Pose-Erkennung im Hauptthread statt im Web Worker |
| `?high=0.6` | Flugzeit-Schwelle (s) für Hochsprung |
| `?sens=1.5` | Empfindlichkeit der Sprungerkennung (Standard 1; > 1 = kleinere Hüpfer zählen, < 1 = unempfindlicher, 0,3–3). Überschreibt den gespeicherten Wert aus der Sprungkalibrierung |
| `?time=60` | Rundenlänge in Sekunden (Standard 120) |

## Mine Time

* 6 Spalten, 8 sichtbare Reihen; die oberste Reihe ist frei (Luft), und beim Graben bleibt eine Reihe Luft über den Blöcken. Das Feld scrollt mit, wenn man tiefer gräbt.
* Braune Erde: ein halber Sprung (normaler Hüpfer) bricht sie und die braune Erde direkt darunter. Grauer Stein: 1 normaler Sprung (kein Hochsprung nötig). Hartgestein: 3 – mit sichtbaren Rissen.
* Edelsteine werden mit der Tiefe wertvoller; Diamanten gibt es schon ab Level 1. Beim Einsammeln poppt der Punktewert kurz in der Farbe des Steins auf. Jede Sorte hat eine eigene Schliff-Form (auch ohne Farben unterscheidbar): Smaragd = Achteck-Treppenschliff, Saphir = runder Brillant, Rubin = Dreieck, Diamant = weiß-blauer Brillant mit Regenbogen-Funkeln und Schein; zufällige Glitzer-Sterne lassen sichtbare Steine funkeln
  (0,7 s, schwebt hoch und blendet aus; bei bis zu 3 Steinen gleichzeitig einzeln und leicht versetzt, bei mehr – TNT, Bohrer, Magnet – ein gemeinsames „+210 (6×)“).
* Mischung pro Feld (Level 1 → 5): Edelsteine ≈ 19 → 28 %, Stein ≈ 14 %, Hartgestein ≈ 7 → 22 %, Rest Erde, Bomben, Power-ups, Zeit-Blöcke.
* Bomben räumen den Radius 1 frei und lösen Kettenreaktionen aus.
* **Zeit-Blöcke** ⏱ (türkis mit Stoppuhr): **+5 s** auf den Countdown – 2 pro Level (ab Level 3: 3), über die Tiefe verteilt.
  Zählen auch, wenn TNT, Bohrer oder ein Einsturz sie erwischt. Animation (< 1 s): Funken, Stoppuhr fliegt zum Timer,
  Timer blinkt grün und pulsiert, Ring + „+5 s“, Glockenspiel-Sound.
* **Wucht-Amboss** (≈ 3 % in Level 1, bis ≈ 4–5 % in der Tiefe/späteren Leveln): normale Landungen prallen ab („KLONG!“, kein Schaden, keine Strafe), nur ein **Hochsprung** zerschmettert ihn – dann kracht er 2–3 Blöcke tief durch seine Spalte (Bildschirmwackeln). Nie in der Ausgangs-Spalte, höchstens einer pro Reihe, nie zwei übereinander → es gibt immer einen normalen Weg.
* **Feder-Block** (≈ 4 %): bricht mit 1 Treffer und gibt **Boing-Turbo** für 4 s: normale Landung = 2 Treffer, Hochsprung = 3. Rosa Aura + Countdown-Ring um den Helm, Glitzerspur, „BOING! TURBO“. Mehrere Federn verlängern (max. 8 s); in der Level-Pause eingefroren.
* Power-ups: **Bohrer** (ganze Spalte), **Quer-Bohrer** (ganze Reihe, links und rechts; Blitze laufen waagerecht die Reihe entlang), **Hammer** (8 s lang jeder Schlag zählt doppelt), **Magnet** (sammelt nur Edelsteine im Radius 1 um den Block – die acht Nachbarfelder, nicht das ganze Feld und keine anderen Blöcke).
* Effekte: **TNT** = große Explosion (Blitzlicht, Feuerball, Druckwellen-Ringe, kurze, halbtransparente Rauch-/Staubwolke – nach ≤ 1 s weg, damit die Sicht frei bleibt,
  Bildschirmwackeln, „BUMM!“); **Bohrer** = Blitze schlagen links und rechts ein (gezackt, weiß/blau, Bildschirm-Flackern,
  Funken am Einschlag). Rauch/Feuer sind wenige weiche Sprites (max. 140 gleichzeitig), keine Physik – die Pose-Erkennung behält ihr Budget.
* Ausgangsfeld ⬇ → **Pause** mit Level-Ergebnis und Vorschau aufs nächste, tiefere Zufallslevel (+ Level-Bonus).
  Weiter geht's, wenn ein Spieler beide Arme hochhebt (Handgelenke klar über Schultern oder Kopf) und das ~0,65 s hält –
  ein Ring füllt sich dabei. Gegen Fehlauslösung: erst 1 s nach Erscheinen aktiv, Fortschritt fällt beim Senken zurück,
  und er wird zurückgesetzt, solange der Sprungautomat „in der Luft“ meldet oder sich die Schulterlinie in der letzten
  Sekunde um mehr als 0,12 Rumpflängen bewegt hat. Ohne Kamera (`?nocam`):
  Enter / Leertaste (Tastendrücke in den ersten 0,6 s werden ignoriert). Zeit und Hammer laufen in der Pause nicht weiter.
* 2 Minuten Zeit. Punkte = Edelsteine + Tiefenbonus × Combo-Multiplikator (×1,5 ab 5, ×2 ab 10, ×3 ab 20 Treffern in Folge).
  Es gibt **keine Abzüge und kein Verlieren**.
* Am Ende: Vorname/Initialen (max. 10 Zeichen) eintragen → lokale Highscore-Liste.

## Architektur

```
src/
  main.ts                App: Pixi-Stage, Szenenwechsel, Kamera-Sprite (Freisteller hinter dem Spielfeld)
  scenes/                Start → Menü → Kalibrierung → Spiel → Ende (Name + Highscores)
  games/types.ts         GameModule-Interface (init / update / destroy) + GameContext
  games/registry.ts      Registry – neue Spiele mit registerGame() eintragen, Menü baut sich automatisch
  games/minetime/        grid.ts (reine Spiellogik, getestet), draw.ts (Vektor-Grafik), MineTime.ts (Darstellung)
  input/camera.ts        getUserMedia, Frame-Schleife, Worker-Kommunikation, Freisteller-Compositing
  input/pose/            MediaPipe-Wrapper (engine.ts) + Modul-Worker (pose.worker.ts)
  input/players.ts       Hüftmitte + Körpergröße aus Landmarks, die größte Person im Bild
  input/jumpDetector.ts  Zustandsautomat GROUNDED → TAKEOFF → AIRBORNE/APEX → LANDING
  input/oneEuro.ts       One-Euro-Filter
  input/armsUp.ts        Arme-hoch-Geste + Halte-Timer + Stillstands-Prüfung (Level-Pause)
  input/inputManager.ts  vereinheitlicht Kamera + Tastatur/Maus → {x, landings[]}
  core/                  Partikel (Rapier2D), vfx.ts (Explosion, Rauch, Blitze, Bildschirmblitz), Sound (WebAudio-Synth), Tweens/Effekte, Highscores (localStorage)
  debug.ts               Debug-Overlay
```

Ein neues Spiel = ein Objekt `{ id, title, subtitle, color, create(): GameModule }` in `games/index.ts` registrieren.
Das Spiel bekommt pro Frame `ctx.input.poll()` mit X-Position (0…1) und Landungen (Flugzeit, Höhe, Hochsprung ja/nein).

**Stack:** Vite + TypeScript, PixiJS v8 (WebGL), `@dimforge/rapier2d-compat` ausschließlich für Splitter-/Edelstein-Partikel,
`@mediapipe/tasks-vision` Pose Landmarker, WebAudio-Synthese (keine Audiodateien).

### Sprungerkennung

Ausgelegt auf **kleine Hüpfer** (Kind auf dem Mini-Trampolin bzw. Hüpfen auf der Stelle vor der Laptop-Webcam,
2–3 m Abstand): schon ~5 cm Hüpfhöhe zählen, auch bei nur 10–15 Pose-Bildern pro Sekunde.

1. **Körpersignal:** 65 % Hüftmitte (Landmarks 23/24) + 35 % Schultermitte (11/12). Schultern bewegen sich beim Hüpfen
   starr mit, haben aber eigenes Erkennungsrauschen → das Mittel zittert weniger als die Hüfte allein. Arme heben
   verschiebt die Schultern kaum (≈ 4 % Torso im Signal). Knöchel (27/28) werden nicht benutzt: bei 2–3 m oft
   abgeschnitten/verdeckt und beim Trampolin-Kontakt wenig aussagekräftig.
2. **Kalibrierung (3 s still stehen):** Baseline, Körpermaß (Schulter–Hüfte-Abstand, seitenverhältnis-korrigiert) und
   **Rauschpegel** σ. Alles wird in „Torso-Längen“ gerechnet → unabhängig von Abstand und Kindergröße.
   Wird die Kalibrierung übersprungen, nimmt der Automat das erste Bild als Baseline, lernt σ im Stand und
   übernimmt einen dauerhaften Versatz nach ~1,2 s.
3. **Leichter One-Euro-Filter** (minCutoff 8 Hz, β 2): kaum Verzögerung, auch bei 10 fps. Zeitstempel = Aufnahmezeitpunkt
   des Kamerabilds (nicht Ankunft des Ergebnisses), damit schwankende Inferenzzeiten Geschwindigkeit/Flugzeit nicht verfälschen.
4. **Zustandsautomat:** Absprung, wenn das Signal die Schwelle *edge* (0,045 Torso) von unten kreuzt, mit ≥ 0,5 Torso/s
   steigt (gemessen über ≥ 0,06–0,3 s, Anstieg deutlich über dem Rauschen) und innerhalb von 0,4 s den Gipfel
   *airborne* (0,07 Torso) erreicht – Absprung und „in der Luft“ dürfen im selben Bild passieren.
   Landung = wieder unter *edge*; auch wenn bei niedriger fps direkt aus der Luft ein Bild unter der Baseline kommt.
   Schnelle Hüpf-Serien, deren Bodenkontakt zwischen zwei Bildern verschwindet, werden über das „Tal“ getrennt.
   Keine Refraktärzeit, Flugzeit 0,1–1,5 s, physikalische Plausibilität (lange „Flüge“ mit kleinem Gipfel = Zehenspitzen
   → verworfen).
5. **Rauschanpassung:** edge ≥ 2,5·σ und airborne ≥ 4·σ – bei sehr unruhigem Tracking (schlechtes Licht, weit weg)
   werden die Schwellen automatisch angehoben, damit Zittern keine Sprünge erzeugt.
6. **Baseline** wird nur nach 0,8 s ohne Hüpfen nachgeführt – eine Hüpf-Serie kann sich nicht mehr „selbst wegkalibrieren“.
7. **Flugzeit → Höhe:** Schwellen-Zeitpunkte werden interpoliert, die Zeit über der Schwelle per Wurfparabel auf die volle
   Flugzeit hochgerechnet (T = t_mess / √(1 − Schwelle/Gipfel), max. ×1,58); **h = g·T²/8**. Hochsprung ab 0,5 s Flugzeit
   (≈ 30 cm) – kleine Hüpfer (0,2–0,3 s) sind nie Hochsprünge.

Simulierte Erkennungsrate (Rauschen σ = 1,2 % Torso, je 600 Hüpfer, Flugzeit 0,2–0,3 s), `JUMP_RATES=1 npx vitest run tests/jumpRates.test.ts`:

| Hüpfhöhe (Torso) | 8 fps | 10 fps | 15 fps | 30 fps |
|---|---|---|---|---|
| 0,10 (≈ 4 cm) | 70 % | 92 % | 99 % | 100 % |
| 0,12 (≈ 5 cm) | 94 % | 99 % | 100 % | 100 % |
| 0,16–0,3 | 99–100 % | 100 % | 100 % | 100 % |

Vorher (bis v304348d): 0 % bei 0,12–0,2 Torso, 11 / 28 / 78 % bei 0,3 Torso (10 / 15 / 30 fps).

Zielwert Latenz (Kamerabild → Landung erkannt): < 50–80 ms auf einem aktuellen Laptop mit GPU-Delegate
(erwartet: Inferenz Lite ≈ 10–25 ms, Full ≈ 20–40 ms, plus ~1 Kamera-Frame – auf echter Hardware **noch nicht gemessen**;
im Headless-Test mit Software-Rendering waren es 80–250 ms). Das Debug-Overlay zeigt Inferenz- und Frame→Ergebnis-Latenz live.

### Web Worker & Freistellung

Die Pose-Erkennung läuft in einem **Modul-Web-Worker** (`vision_wasm_module_internal.js`, GPU-Delegate über
`OffscreenCanvas`, automatischer Rückfall auf CPU/XNNPACK). Jeder Frame wird als `ImageBitmap` übertragen, zurück kommen nur
Landmarks und – falls aktiv – die Personenmaske als `Uint8Array`. Schlägt der Worker fehl, läuft dieselbe Engine
automatisch im Hauptthread (`?worker=0` erzwingt das).

Die Segmentierungsmaske des Pose Landmarkers wird benutzt, um das Kind aus dem Kamerabild freizustellen
(`destination-in`-Compositing, gespiegelt) – das Bild liegt **hinter** dem Spielfeld bzw. im Menü/bei der Kalibrierung gut sichtbar.

Getestet in Headless-Chrome mit einer künstlichen Kamera (Foto einer Person, das auf Sprung-Parabeln auf und ab bewegt wird):
Worker ✅, GPU-Delegate ✅ (dort per Software-Rendering sehr langsam), CPU-Delegate ✅, Freistellung ✅,
Menüauswahl per Sprung ✅, Kalibrierung ✅, Spielzüge per Sprung inkl. Hochsprung ✅, kleine Wipp-Bewegungen ignoriert ✅.

## Warum MediaPipe – und was wäre der „Profi-Stack“?

**MediaPipe Pose Landmarker** ist für dieses Projekt die pragmatische Wahl: läuft ohne Installation in jedem
modernen Browser (WASM + WebGL/GPU-Delegate), ist auch auf Mittelklasse-Laptops echtzeitfähig, liefert 33
Körperpunkte für mehrere Personen *und* eine Segmentierungsmaske aus **einem** Modell, ist Apache-2.0 und
lässt sich komplett selbst hosten. Für „Hüfte geht hoch und runter“ reicht die Genauigkeit locker.

Für eine kommerzielle Installation (wie bei Valo Motion) würde man eher so bauen:

* **ONNX Runtime Web mit WebGPU** (oder nativ ONNX Runtime/TensorRT) als Inferenz-Backend – deutlich schneller und flexibler bei der Modellwahl.
* **RTMPose** (MMPose, Top-down mit RTMDet-Detektor) – genauer und stabiler bei schnellen Bewegungen, Bewegungsunschärfe und mehreren Kindern.
* **Robust Video Matting (RVM)** für eine saubere, zeitlich stabile Freistellung (Haare, Kanten, kein Flackern) statt der groben Pose-Maske.
* **Electron-Kiosk** (oder native App) mit fester Kamera (Global-Shutter/hohe Bildrate, 60–120 fps), Beamer/Wand-Display,
  Autostart, kein Browser-UI, Kamerarechte fest vergeben, Hardware-Watchdog.
* Optional Tiefenkamera oder Drucksensoren im Trampolin für exakte Landezeitpunkte.

## Datenschutz

* Das Kamerabild **verlässt nie den Browser**: keine Uploads, keine Aufnahme, kein Speichern von Bildern.
* Modelle und WASM werden vom selben Server (GitHub Pages) geladen – keine Drittanbieter-CDNs, kein Tracking.
* Highscores (Vorname/Initialen, max. 10 Zeichen, Punktzahl, Datum) liegen nur im `localStorage` dieses Browsers.

## Selbst gehostete Dateien

* `public/models/pose_landmarker_{lite,full}.task` (Google MediaPipe, Apache 2.0) – Standard ist *full*, `?model=lite` für schwächere Geräte.
* `public/mediapipe/wasm/*` wird beim Build aus `@mediapipe/tasks-vision` kopiert.

## Tuning-Tipps (Laptop-Webcam, 2–3 m Abstand)

* Ganzer Körper sollte im Bild sein, gute Beleuchtung von vorne, ruhiger Hintergrund.
* Ruckelt es: `?model=lite`, notfalls zusätzlich `?seg=0`.
* Hochsprung wird zu selten / zu oft erkannt: `?high=0.45` bzw. `?high=0.6`.
* Kleine Hüpfer werden verpasst: `?sens=1.5` (oder 2). Zählt es Sprünge, obwohl niemand hüpft: `?sens=0.7`.
* Im Debug-Overlay (**B**) auf „Pose Hz“ achten: unter ~10 Bildern/s werden sehr kurze Hüpfer unzuverlässig → `?model=lite`.
* Mit **B** das Debug-Overlay öffnen: gelbe Linie = Absprungschwelle, grün = Baseline, Kurve = Hüfthöhe.

## Tests & Screenshots

* `npm test` – vitest (Amboss & Boing-Turbo, Quer-Bohrer, Level-Mischung, Punkte-Pop-ups, Zeit-Blöcke & Rauchdauer, One-Euro-Filter, Sprungautomat inkl. kleiner Hüpfer bei 10/15/30 fps mit Rauschen, Schwanken/Arme heben/Zehenspitzen/Hocke = 0 Sprünge, Hochsprünge, Personenverlust, Mine-Time-Logik, Personenwahl,
  Arme-hoch-Erkennung inkl. Halten, Armschwingen, Springen mit erhobenen Armen bei 30 und 3–4 fps).
* `node scripts/shots.mjs` – Playwright-Durchlauf per Tastatur gegen `npm run preview`, Screenshots in `shots/`.
* `node scripts/startcam.mjs` – Startbildschirm mit künstlicher Kamera (Kamera startet ohne Klick, läuft ins Menü weiter).
* `node scripts/fxshots.mjs` – TNT-Explosion, Bohrer-Blitze und Level-Pause per Tastatur (Screenshots 18–20).
* `node scripts/timeshots.mjs` – kurzer TNT-Rauch + Zeit-Block-Animation, Timer in der Pause eingefroren (Screenshots 21–22).
* `node scripts/drillshots.mjs` – Quer-Bohrer und Punkte-Pop-ups per Tastatur (Screenshots 23–24).
* `node scripts/anvilshots.mjs` – Amboss (Klong/Hochsprung), Boing-Turbo inkl. Pause-Einfrieren, Edelstein-Nahaufnahme (Screenshots 25–27).
* `node scripts/armscam.mjs` – Level-Pause mit künstlicher Kamera (`Y4M=…`): prüft, ob Arme-hoch weiterschaltet.
* `node scripts/hopcam.mjs` – kleine Hüpfer mit künstlicher Kamera (`Y4M=…`), zählt erkannte Landungen. Video z. B. per ffmpeg:
  Foto auf Wurfparabeln bewegen (9,6 cm Hüpfhöhe = 0,28 s Flug, alle 0,5 s).
* `node scripts/camtest.mjs` – Durchlauf mit künstlicher Kamera (`Y4M=/pfad/video.y4m`, `QS='&model=lite&delegate=cpu'`).

## Bekannte Grenzen

* Noch nicht mit einer echten Kamera und einem echten Kind auf dem Trampolin getestet – Schwellenwerte sind
  aus Physik + synthetischen Tests abgeleitet und müssen ggf. nachjustiert werden.
* Die Arme-hoch-Geste wurde mit dem echten Pose-Modell nur auf Standbildern/Videos in Headless-Chrome (~3 fps) geprüft,
  nicht mit einer Person vor einer echten Kamera.
* Bei niedriger Pose-Bildrate (< 10 fps) werden sehr kurze Hüpfer teilweise verpasst und Flugzeiten eher überschätzt.
* Die Sprung-Schwellen sind mit synthetischen Signalen abgestimmt; das echte MediaPipe-Rauschen beim Hüpfen ist nicht vermessen.
* Die Pose-Maske ist grob (Kanten, Haare); für schöne Freisteller siehe Profi-Stack.
* Das JS-Bundle ist groß (~3,7 MB, v. a. Rapier-WASM inline + Pixi); erster Start lädt zusätzlich ~25 MB Modell+WASM (danach Browser-Cache).
