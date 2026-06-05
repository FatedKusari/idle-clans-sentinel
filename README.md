<div align="center">
  <h1>Idle Clans Sentinel</h1>
  <p><strong>Local profiles &nbsp;·&nbsp; Logs &nbsp;·&nbsp; Evidence</strong></p>
  <p>A standalone desktop tool for tracking players and clans in <a href="https://www.idleclans.com">Idle Clans</a>.<br/>
  Runs entirely on your machine</p>
</div>

---

## What it does

Sentinel pulls player and clan data from the Idle Clans API and stores it locally in a SQLite database. Everything is searchable, filterable, and exportable. The more you scan, the richer your local dataset becomes.

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

**Clan detail** includes member roster, vault contents (still an estimate), skill totals and individual member stats. Vault items display with images where available.

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
Scans a list of clans and looks for unusual skill-level patterns — extremely high or unbalanced skills that may indicate botting.

### Clan Log Leads
Surfaces clans with high log activity relative to their size. A high join/leave ratio can indicate recruiting activity or account cycling.

### PvM Correlation
For a selected boss or raid, shows which other bosses and skills tend to appear alongside it in your dataset. Useful for building a fuller picture of a player's activity profile.

###  Compare
Side-by-side comparison of many players. If in the same clan it can flag if vault activity is sus. (This requires some degreee of logs stored.

---

## Settings

- **Database location** — displayed and re-selectable
- **Scan behaviour** — bulk scan intervals, dormancy threshold, auto-exclude dormant/not-found
- **Game data** — manual update trigger for item names.
- **Chat scan** — Set the interval of chat scans (still needs to be active from the chat page)
- **Market** — poll interval, price-alert threshold (set to 0 to disable alerts)
- **Backup** — configure backup folder and retention
- **Data management** — delete all data, wipe individual tables


## Data & Privacy

- All data is stored **locally on your machine** in a SQLite database in the folder you chose on initial startup.
- Sentinel only contacts the Idle Clans public API and (for update checks) a version file on GitHub.
- No information ever leaves your machine. 


---

## License

[MIT](LICENSE)
