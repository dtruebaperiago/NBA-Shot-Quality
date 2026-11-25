"""Prepare local 2014–15 player positions and box scores through March 3."""

import argparse
from collections import defaultdict
from csv import DictReader
from io import TextIOWrapper
from html.parser import HTMLParser
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
import unicodedata
from urllib.request import urlopen

LOCAL = Path(__file__).resolve().parents[1] / ".local"
POSITION_SOURCE = "https://www.basketball-reference.com/leagues/NBA_2015_totals.html"
NBA_RELEASES = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
BOX_SCORES = f"{NBA_RELEASES}/nba_stats_player_boxscores/player_boxscores_2015.csv"
GAME_LOGS = f"{NBA_RELEASES}/nba_stats_player_game_logs/player_game_logs_2015.csv"
PROFILE_CUTOFF = "2015-03-03"

# The tracking archive contains these spellings for the same NBA player IDs.
ALIASES = {
    "Time Hardaway Jr": "Tim Hardaway Jr.",
    "Jon Ingles": "Joe Ingles",
    "Beno Urdih": "Beno Udrih",
    "Danilo Gallinai": "Danilo Gallinari",
    "Enes Kanter": "Enes Freedom",
    "Nerles Noel": "Nerlens Noel",
    "Dwayne Wade": "Dwyane Wade",
    "Nene Hilario": "Nenê",
    "Otto Porter": "Otto Porter Jr.",
    "Dirk Nowtizski": "Dirk Nowitzki",
    "Mnta Ellis": "Monta Ellis",
    "Jose Juan Barea": "J.J. Barea",
    "Jimmer Dredette": "Jimmer Fredette",
    "James Ennis": "James Ennis III",
    "Alan Crabbe": "Allen Crabbe",
    "Steve Adams": "Steven Adams",
}
TEAM_CODES = {"BRK": "BKN", "CHO": "CHA", "PHO": "PHX"}
BOX_FIELDS = {
    "fg": "field_goals_made", "fga": "field_goals_attempted",
    "fg3": "three_pointers_made", "fg3a": "three_pointers_attempted",
    "ft": "free_throws_made", "fta": "free_throws_attempted",
    "orb": "rebounds_offensive", "drb": "rebounds_defensive", "trb": "rebounds_total",
    "ast": "assists", "stl": "steals", "blk": "blocks", "tov": "turnovers",
    "pf": "fouls_personal", "pts": "points",
}


class SeasonTotals(HTMLParser):
    def __init__(self, document):
        super().__init__(convert_charrefs=True)
        self.in_table = False
        self.row = None
        self.field = None
        self.rows = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self.in_table = attrs.get("id") == "totals_stats"
        elif self.in_table and tag == "tr":
            self.row = {}
        elif self.row is not None and tag == "td":
            self.field = attrs.get("data-stat")
            if self.field:
                self.row[self.field] = ""
            if self.field == "name_display":
                self.row["reference_id"] = attrs.get("data-append-csv", "")

    def handle_data(self, data):
        if self.field and self.row is not None:
            self.row[self.field] += data

    def handle_endtag(self, tag):
        if tag == "td":
            self.field = None
        elif tag == "tr" and self.row is not None:
            if self.row.get("reference_id") and self.row.get("pos"):
                self.rows.append({key: value.strip() for key, value in self.row.items()})
            self.row = None
        elif tag == "table":
            self.in_table = False


def name_key(name):
    return "".join(char for char in unicodedata.normalize("NFKD", name.casefold().replace("ı", "i")) if char.isalnum())


def match_players(shots, rows):
    tracked = {}
    for shot in shots:
        _, player_id, _ = shot["id"].split("-")
        name, teams = tracked.setdefault(player_id, (shot["player"], set()))
        if shot["player"] != name:
            raise ValueError(f"Conflicting archive identities for NBA player {player_id}")
        teams.add(shot["team"])

    names = defaultdict(lambda: defaultdict(list))
    for row in rows:
        names[name_key(row["name_display"])][row["reference_id"]].append(row)

    result, missing = {}, []
    for player_id, (name, teams) in tracked.items():
        primary = names.get(name_key(name)) or names.get(name_key(ALIASES.get(name, name)), {})
        candidates = [
            stints for stints in primary.values()
            if teams.intersection(TEAM_CODES.get(row["team_name_abbr"], row["team_name_abbr"]) for row in stints)
        ]
        if len(candidates) != 1:
            missing.append(name)
            continue
        stints = candidates[0]
        season = stints[0] if len(stints) == 1 else next(
            (row for row in stints if row["team_name_abbr"].endswith("TM") or row["team_name_abbr"] == "TOT"),
            None,
        )
        if season is None:
            raise ValueError(f"No combined season totals for {name}")
        result[player_id] = {
            "name": name if name == "Enes Kanter" else season["name_display"],
            "position": season["pos"],
        }
    if missing:
        raise ValueError("Unmatched or ambiguous players: " + ", ".join(sorted(missing)))
    return result


def csv_rows(path, url):
    if path:
        with path.open(encoding="utf-8-sig", newline="") as file:
            yield from DictReader(file)
    else:
        with urlopen(url, timeout=30) as response:
            yield from DictReader(TextIOWrapper(response, encoding="utf-8-sig", newline=""))


def totals_through(shots, player_ids, through, logs, box_scores):
    dates = {}
    played = set()
    for row in logs:
        if row["season_id"] != "22014" or row["game_date"] > through or row["player_id"] not in player_ids:
            continue
        game_id = row["game_id"]
        if dates.setdefault(game_id, row["game_date"]) != row["game_date"]:
            raise ValueError(f"Conflicting dates for NBA game {game_id}")
        key = (game_id, row["player_id"])
        if key in played:
            raise ValueError(f"Duplicate NBA game log for {key}")
        played.add(key)

    for shot in shots:
        if shot["date"] > through:
            continue
        _, player_id, _ = shot["id"].split("-")
        if (shot["game"], player_id) not in played or dates[shot["game"]] != shot["date"]:
            raise ValueError(f"NBA game logs do not cover tracked shot {shot['id']}")

    totals = defaultdict(lambda: dict.fromkeys(("games", "games_started", "mp", *BOX_FIELDS), 0))
    remaining = played.copy()
    for row in box_scores:
        key = (row["game_id"], row["person_id"])
        if key not in played:
            continue
        if key not in remaining or row["comment"] or row["season_type_id"] != "2":
            raise ValueError(f"Unexpected NBA box score for {key}")
        remaining.remove(key)
        team_box = totals[row["person_id"]]
        team_box["games"] += 1
        team_box["games_started"] += bool(row["position"].strip())
        minutes, seconds = map(int, row["minutes"].split(":"))
        team_box["mp"] += 60 * minutes + seconds
        for key, column in BOX_FIELDS.items():
            team_box[key] += int(row[column])

    if remaining:
        raise ValueError(f"NBA box scores are missing {len(remaining)} player games")
    for player_box in totals.values():
        player_box["mp"] /= 60
        player_box["fg2"] = player_box["fg"] - player_box["fg3"]
        player_box["fg2a"] = player_box["fga"] - player_box["fg3a"]
    return totals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Read a saved copy of the season totals table.")
    parser.add_argument("--game-logs", type=Path, help="Read a saved copy of the NBA game log CSV.")
    parser.add_argument("--box-scores", type=Path, help="Read a saved copy of the NBA box score CSV.")
    args = parser.parse_args()

    archive = json.loads((LOCAL / "archive.json").read_text(encoding="utf-8"))
    shots = archive["shots"]
    through = min(archive["end"], PROFILE_CUTOFF)
    if args.html:
        document = args.html.read_text(encoding="utf-8")
    else:
        with urlopen(POSITION_SOURCE, timeout=30) as response:
            document = response.read().decode("utf-8")

    rows = SeasonTotals(document).rows
    if not rows:
        raise ValueError("The 2014–15 season totals table could not be read.")
    players = match_players(shots, rows)
    totals = totals_through(shots, players, through, csv_rows(args.game_logs, GAME_LOGS), csv_rows(args.box_scores, BOX_SCORES))
    for player_id, box_score in totals.items():
        players[player_id].update(through=through, totals=box_score)
    with NamedTemporaryFile(dir=LOCAL, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        temporary_path.write_text(json.dumps(players, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        temporary_path.replace(LOCAL / "player-seasons.json")
    finally:
        temporary_path.unlink(missing_ok=True)
    print(f"Prepared {len(players)} positions and {len(totals)} player box scores through {through}.")


if __name__ == "__main__":
    main()
