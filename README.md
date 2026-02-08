# Familienplan (MVP)

Minimalistisches Familien-System für Aufgaben, Listen und Agenda. Optimiert für iPhone (als PWA) und Mac.

## Features
- Aufgaben mit Wiederholung: täglich, wöchentlich, saisonal, halbjährlich, jährlich
- Deadline (Fälligkeitsdatum) + Abhaken
- Zwei Personen pro Aufgabe (Haupt- und Zweitperson)
- Listen (Einkauf, Reparaturen, usw.)
- Tages- und Wochenansicht
- Push-Benachrichtigungen (Web Push)

## Lokale Entwicklung

### 1) Server starten

```bash
cd /Users/nathalie/Documents/New\ project/server
npm install
npm run dev
```

Der Server läuft auf `http://localhost:5174`.

### 2) Client starten

```bash
cd /Users/nathalie/Documents/New\ project/client
npm install
npm run dev
```

Der Client läuft auf `http://localhost:5173`.

## Produktion
1. Client builden:
   ```bash
   cd /Users/nathalie/Documents/New\ project/client
   npm run build
   ```
2. Server starten (liefert das Frontend aus `/client/dist`):
   ```bash
   cd /Users/nathalie/Documents/New\ project/server
   npm start
   ```

## Push-Benachrichtigungen
- Benötigt VAPID Keys.
- Beispiel (einmalig):
  ```bash
  npx web-push generate-vapid-keys
  ```
- Danach die Env-Variablen setzen:
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT` (z.B. `mailto:you@example.com`)

Die App zeigt im Bereich **Einstellungen** einen Button „Push aktivieren“. Ein Test-Push wird direkt gesendet.

## Datenbank
SQLite Datei unter:
- `/Users/nathalie/Documents/New project/server/data/family-home.db`

## Hinweise
- PWA Install: In Safari auf iPhone „Zum Home-Bildschirm“ hinzufügen.
- Zeit/Locale: fix auf `Europe/Zurich` und `de-CH`.

