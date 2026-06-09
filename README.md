<div align="center">
  <h1>Idle Clans Sentinel</h1>
  <p><strong>Local profiles &nbsp;·&nbsp; Logs &nbsp;·&nbsp; Evidence</strong></p>
  <p>A standalone desktop tool for tracking players/clans and monitoring your own progress in <a href="https://www.idleclans.com">Idle Clans</a>.<br/>
  Runs entirely on your machine</p>
</div>

---

## What it does

Sentinel pulls player and clan data from the Idle Clans API and stores it locally in a SQLite database. Everything is searchable, filterable, and exportable. The more you scan, the richer your local dataset becomes.

---
## Setup

Place the Sentinel EXE into a folder, upon first launch it will ask where to save the database (I advise the folder the EXE is in). It may take a few moments to load then you are free to have at it.

## Updating

Updating is easy and optional (might occasionally be needed to fix missed issues). Sentinel will notify you with a small banner and a download button when one is available, you will only need to download and replace the existing exe file and good to go.

---

## Features

### Home
A basic look at your local database — total players, clans, storage, open cases and online player count. With quick-access scan controls

### My Accounts
Track your own accounts in one place. View skill levels, XP and progression over time. All you need is the verification token from account and good to go. (This is only to make sure it is yours. You are safe) :D

### Search
Live search against the Idle Clans API without storing results. Useful for a quick lookup before committing a full scan.

### Chat
Browse and search global chat history captured during chat scans. Filterable by category, date range, and keyword. Configurable auto-scan interval — the scanner runs in the background regardless of which page you're on, and new messages appear without needing to refresh.

### Players
Browse your local player database. Sort and filter by name, game mode, clan, last seen, ban status and more. Bulk-select players for deletion or batch operations.

**Player detail** includes five tabs:
- **Overview** — username, game mode, clan, house, last seen, log summary
- **Skills** — all skill levels and XP with visual progress bars
- **Equipment** — full equipped gear per slot with item names from cached game data.
- **PvM** — boss and raid kill counts
- **Logs** — timestamped join/leave/ban events

### Clans
Browse clans in your local database. View member count, game mode, category (Casual / Competitive / Hardcore), vault contents (only an estimate) and last scan time.

**Clan detail** includes member list, vault contents (still an estimate), skill totals and individual member stats. Vault items display with images where available.

### Vault Rankings
Leaderboard of clans ranked by total vault value. Displays quantities and estimated values.

###  Leaderboards
Snapshot and track Idle Clans' official leaderboards locally. Supports Players, Clans and Pets boards across Normal, Ironman and Group Ironman modes. Schedule automatic snapshot jobs so rankings are captured over time.

###  Equipped Items
See which items are most commonly equipped across all scanned players. Browse by equipment slot, click any item to see every player wearing it.

### Player Inspector
Side-by-side comparison of two players' stats. Visualises skill levels, PvM kills and progression.

### Market
Tracks Idle Clans market prices over time. Highlights items currently priced below their daily average — sorted by biggest discount first, the best flip opportunities at the top. Configurable polling interval and optional price alert notifications.

---

## Investigation Tools

### Cases
Build cases on players or clans of interest. Attach notes, snapshots and evidence. Cases persist in your local database and can be exported to PDF.

### Reports
Database-wide overview with eight tabs:

| Tab | What it shows |
|-----|---------------|
| **Overview** | Total counts, game mode breakdown, scan coverage |
| **Alerts** | Unread system alerts and scan warnings |
| **Banned** | All players marked banned, with timestamps |
| **Flagged** | Flagged players and clans |
| **Not Found** | Players/clans that returned 404 (deleted) |
| **Dormant** | Players inactive past the dormancy threshold |
| **Analytics** | Aggregate stats, PvM totals, active-player estimates |
| **Integrity** | Database health check, storage breakdown |
| **Export** | Full JSON export of players, clans or both |
| **Backup & Restore** | One-click backup to a chosen folder, restore from file |

### Cross-Clan Matches
Finds similar player names that appear in multiple clans across your stored players/clans. Useful for spotting patterns and multi-clan accounts.

### Name Matches
Detects clans with suspiciously similar names using fuzzy matching. Configurable similarity threshold.

### Clan Skill Signals
Scans a list of clans and looks for unusual skill-level patterns — extremely high or unbalanced skills that may indicate dodgy goings on.

### Clan Log Leads
Surfaces clans with high log activity relative to their size. A high join/leave ratio can indicate recruiting activity or account hiding.

### PvM Correlation
For a selected boss or raid, shows which other bosses and skills tend to appear alongside it in your dataset. Useful for building a fuller picture of a player's activity profile.

###  Compare
Side-by-side comparison of many players. If in the same clan it can flag if vault activity is sus. (This requires some degreee of logs stored).

---

## Settings

- **Database location** — displayed and re-selectable
- **Scan behaviour** — bulk scan intervals, dormancy threshold, auto-exclude dormant/not-found
- **Game data** — manual update trigger for item names.
- **Chat scan** — Set the interval of chat scans (still needs to be active from the chat page)
- **Market** — poll interval, price-alert threshold (set to 0 to disable alerts)
- **Backup** — configure backup folder and retention
- **Data management** — delete all data, wipe individual tables
- **Game Data updates** — On first load grabs recent gamedata. It may require you to go to settings and update again but after that should be fine.

---

## Built With

Idle Clans Sentinel is built using:

-  React 18
-  Vite
-  Electron
-  SQLite (via better-sqlite3)

---

## Technical Notes

- All player, clan, market and investigation data is stored locally in a SQLite database.
- No account login is required.
- Verification tokens used for account ownership checks are never sent anywhere other than the Idle Clans API. (And the only thing stored is name and date saved)
- The application can works fine as an offline viewer. However, unless profiles are updated you will have stale information.
- Automatic update checks only retrieve version information and do not upload any user data.
- Database backups can be created and restored directly through the application.
- Sentinel is designed as a data collection and investigation tool and does not interact with the game client itself.
- Compatible with Windows portable builds and can be run without a traditional installer.
- There are occasional calls to Github when checking for updates, this shouldn't affect usage in any way.

---

## Disclaimer

Idle Clans Sentinel is not affiliated with, endorsed by, or maintained by the Idle Clans development team. All Idle Clans data remains the property of the Idle Clans Team.
