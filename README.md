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
| 2 Spieler | linke / rechte Bildhälfte | P1: A/D + W (E hoch), P2: ←/→ + ↑ (↓ hoch) |
| Debug-Overlay | – | **B** oder F2 |
| Ton an/aus | – | M |

Der erste Klick/Tastendruck startet das Spiel (Audio-Freigabe) und fragt die Kamera an. Ohne Kamera
läuft alles per Tastatur.

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
| `?players=2` | direkt im 2-Spieler-Modus starten |
| `?time=60` | Rundenlänge in Sekunden (Standard 120) |

## Mine Time

* 6 Spalten, 8 sichtbare Reihen; das Feld scrollt mit, wenn man tiefer gräbt.
* Erde (1 Schlag), Stein (2), Hartgestein (3) – mit sichtbaren Rissen.
* Edelsteine werden mit der Tiefe wertvoller.
* Bomben räumen den Radius 1 frei und lösen Kettenreaktionen aus.
* Power-ups: **Bohrer** (ganze Spalte), **Hammer** (8 s lang jeder Schlag zählt doppelt), **Magnet** (sammelt alle sichtbaren Edelsteine).
* Ausgangsfeld ⬇ → nächstes, tieferes Zufallslevel (+ Level-Bonus).
* 2 Minuten Zeit. Punkte = Edelsteine + Tiefenbonus × Combo-Multiplikator (×1,5 ab 5, ×2 ab 10, ×3 ab 20 Treffern in Folge).
  Es gibt **keine Abzüge und kein Verlieren**.
* Am Ende: Vorname/Initialen (max. 10 Zeichen) eintragen → lokale Highscore-Liste.
* 2-Spieler-Modus: Bildschirm wird geteilt, jeder hat 3 Spalten, gemeinsamer Punktestand.

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
  input/players.ts       Hüftmitte + Körpergröße aus Landmarks, Zuordnung der Personen zu Spielern
  input/jumpDetector.ts  Zustandsautomat GROUNDED → TAKEOFF → AIRBORNE/APEX → LANDING
  input/oneEuro.ts       One-Euro-Filter
  input/inputManager.ts  vereinheitlicht Kamera + Tastatur/Maus → {x, landings[]} pro Spieler
  core/                  Partikel (Rapier2D), Sound (WebAudio-Synth), Tweens/Effekte, Highscores (localStorage)
  debug.ts               Debug-Overlay
```

Ein neues Spiel = ein Objekt `{ id, title, subtitle, color, create(): GameModule }` in `games/index.ts` registrieren.
Das Spiel bekommt pro Frame `ctx.input.poll()` mit X-Position (0…1) und Landungen (Flugzeit, Höhe, Hochsprung ja/nein).

**Stack:** Vite + TypeScript, PixiJS v8 (WebGL), `@dimforge/rapier2d-compat` ausschließlich für Splitter-/Edelstein-Partikel,
`@mediapipe/tasks-vision` Pose Landmarker, WebAudio-Synthese (keine Audiodateien).

### Sprungerkennung

1. **Kalibrierung (3 s still stehen):** Baseline der Hüftmitte (Mittel aus Landmarks 23/24) und Körpermaß
   (Schulter–Hüfte-Abstand, seitenverhältnis-korrigiert). Alles Weitere wird in „Torso-Längen“ gerechnet →
   unabhängig von Abstand (2–3 m) und Kindergröße.
2. **One-Euro-Filter** auf die Hüfthöhe (glättet Zittern, bleibt bei schnellen Bewegungen reaktionsschnell),
   Geschwindigkeit aus der gefilterten Ableitung.
3. **Zustandsautomat:** GROUNDED → TAKEOFF (Anstieg > 0,1 Torso und Aufwärtsgeschwindigkeit) → AIRBORNE (> 0,22 Torso)
   → APEX → LANDING. Kleine Wipp-Bewegungen auf dem Trampolin bleiben in TAKEOFF hängen und werden verworfen;
   Flugzeiten < 0,15 s oder > 2 s werden ignoriert, danach kurze Refraktärzeit.
4. **Flugzeit → Höhe:** Zeitpunkte der Schwellen-Überschreitung werden zwischen Frames linear interpoliert, die
   Zeit oberhalb der Schwelle wird über die Wurfparabel auf die volle Flugzeit hochgerechnet
   (T = t_mess / √(1 − Schwelle/Gipfel)); Höhe **h = g·T²/8**.
5. Langsame Baseline-Nachführung im Stand (Drift, Trampolin-Durchhang), Körpermaß wird langsam angepasst.

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
* Mit **B** das Debug-Overlay öffnen: gelbe Linie = Absprungschwelle, grün = Baseline, Kurve = Hüfthöhe.

## Tests & Screenshots

* `npm test` – 28 vitest-Tests (One-Euro-Filter, Sprungautomat inkl. kleiner Wipper/Hochsprünge/Personenverlust, Mine-Time-Logik, Spielerzuordnung).
* `node scripts/shots.mjs` – Playwright-Durchlauf per Tastatur gegen `npm run preview`, Screenshots in `shots/`.
* `node scripts/camtest.mjs` – Durchlauf mit künstlicher Kamera (`Y4M=/pfad/video.y4m`, `QS='&model=lite&delegate=cpu'`).

## Bekannte Grenzen

* Noch nicht mit einer echten Kamera und einem echten Kind auf dem Trampolin getestet – Schwellenwerte sind
  aus Physik + synthetischen Tests abgeleitet und müssen ggf. nachjustiert werden.
* Bei niedriger Pose-Bildrate (< 10 fps) werden kurze Sprünge verpasst und Flugzeiten überschätzt.
* Die Pose-Maske ist grob (Kanten, Haare); für schöne Freisteller siehe Profi-Stack.
* Das JS-Bundle ist groß (~3,7 MB, v. a. Rapier-WASM inline + Pixi); erster Start lädt zusätzlich ~25 MB Modell+WASM (danach Browser-Cache).
