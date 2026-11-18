"""Extract shot geometry and pre-shot game state from a PlayByPlayV3 game."""

from collections import defaultdict
import json

import pandas as pd
from math import hypot, isfinite
import re
import unicodedata

from build_modeling_dataset import SHOT_KEY, TARGET
from reconstruct_shot_clock import MATCH_TOLERANCE_SECONDS, period_seconds


SHOT_VALUE = "PTS_TYPE"
FAMILY = "SHOT_FAMILY"
BROAD = "BROAD_SHOT_FAMILY"
COURT = ["COURT_X", "COURT_Y"]
PROXY = "RELEASE_PROXY"
OUTPUT_COLUMNS = [*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]

POSSESSION_COLUMNS = ["POSSESSION_ORIGIN", "SECONDS_SINCE_POSSESSION_EVENT", "SHOOTER_REBOUNDED"]
FINISHES = {
    "DRIVING": "driving", "REVERSE": "reverse", "ALLEY_OOP": "alley oop", "PUTBACK": "putback",
    "RUNNING": "running", "BANK": "bank", "FADEAWAY": "fadeaway", "TURNAROUND": "turnaround",
}
GEOMETRY_COLUMNS = ["COURT_ZONE", *[f"SHOT_{name}" for name in FINISHES]]
SCORE_COLUMNS = ["PRE_SHOT_MARGIN", "LATE_CLOSE_GAME"]
OPPONENT_PRIOR_COLUMNS = ["OPPONENT_ZONE_PRIOR_ATTEMPTS", "OPPONENT_ZONE_PRIOR_FG_RATE"]
STINT_COLUMNS = ["OPPONENT_TEAM_ID", "STINT_SOURCE", "SECONDS_ON_COURT_THIS_PERIOD"]
CONTEXT_GROUPS = {
    "Second chance and transition": POSSESSION_COLUMNS,
    "Court zones and finer shot details": GEOMETRY_COLUMNS,
    "Score before release": SCORE_COLUMNS,
    "Opponent and time on court": [*STINT_COLUMNS, *OPPONENT_PRIOR_COLUMNS],
}
EVENT_CONTEXT_COLUMNS = [*POSSESSION_COLUMNS, *GEOMETRY_COLUMNS, *SCORE_COLUMNS, *STINT_COLUMNS]
CONTEXT_CATEGORICAL = ("POSSESSION_ORIGIN", "COURT_ZONE", "OPPONENT_TEAM_ID", "STINT_SOURCE")
POSSESSION_STOPS = {
    "Turnover", "Foul", "Free Throw", "Violation", "Jump Ball", "Timeout",
    "Substitution", "Instant Replay", "Ejection", "period",
}
SUBSTITUTION = re.compile(r"^SUB:\s*(.*?)\s+FOR\s+(.*)$", re.IGNORECASE)


def court_zone(x, y, shot_value):
    """Classify basket-centered coordinates in tenths of a foot."""
    if x is None or y is None or not (isfinite(x) and isfinite(y)):
        return "Unknown"
    x, y = x / 10, y / 10
    if shot_value == 3:
        if -5.25 <= y <= 9 and abs(x) >= 22:
            return "Left corner three" if x < 0 else "Right corner three"
        return "Above-the-break three"
    if hypot(x, y) <= 4:
        return "At rim"
    if abs(x) <= 8 and -5.25 <= y <= 14:
        return "Paint"
    return "Outside paint"


def name_key(name):
    normalized = unicodedata.normalize("NFKD", name.casefold())
    return "".join(char for char in normalized if char.isalnum())


def game_players(actions):
    # Use roster identities only. Appearances later in the game never update a prior stint.
    aliases = defaultdict(set)
    sides = defaultdict(set)
    for action in actions:
        team = action["teamId"]
        player = action["personId"]
        if team and player:
            for field in ("playerName", "playerNameI"):
                if action[field]:
                    aliases[(team, name_key(action[field]))].add(player)
        if action["isFieldGoal"] and team and action["location"] in ("h", "v"):
            sides[action["location"]].add(team)
    opponents = {}
    if len(sides["h"]) == len(sides["v"]) == 1 and sides["h"] != sides["v"]:
        home, away = next(iter(sides["h"])), next(iter(sides["v"]))
        opponents = {home: str(away), away: str(home)}
    return aliases, opponents


def stint_at_shot(player, team, elapsed, entries, uncertain_teams, observed_start):
    key = (team, player)
    if elapsed is not None:
        if key in entries:
            entered = entries[key]
            if entered is not None and entered <= elapsed:
                return "Logged substitution", elapsed - entered
        elif observed_start and team not in uncertain_teams:
            return "Inferred period start", elapsed
    return "Unknown", None


def update_substitution(action, elapsed, aliases, entries, uncertain_teams):
    team = action["teamId"]
    outgoing = action["personId"]
    match = SUBSTITUTION.fullmatch(action["description"])
    if outgoing:
        entries[(team, outgoing)] = None
    if match:
        incoming = aliases.get((team, name_key(match[1])), set())
        if len(incoming) == 1 and outgoing and outgoing not in incoming:
            entries[(team, next(iter(incoming)))] = elapsed
            return
    uncertain_teams.add(team)


def possession_start(action, clock, previous, previous_clock):
    if (
        previous is None or previous["period"] != action["period"]
        or clock is None or previous_clock is None or not action["teamId"]
        or not previous["teamId"]
    ):
        return None
    same_team = previous["teamId"] == action["teamId"]
    if (
        action["actionType"] == "Rebound" and previous["isFieldGoal"]
        and previous["shotResult"].casefold() == "missed" and 0 <= previous_clock - clock <= 5
    ):
        kind = "Offensive rebound" if same_team else "Defensive rebound"
        return kind, action["teamId"], clock, action["personId"]
    if (
        "STEAL" in action["description"].upper() and previous["actionType"] == "Turnover"
        and not same_team and clock == previous_clock and previous["actionNumber"] == action["actionNumber"]
        and previous["subType"] in ("Bad Pass", "Lost Ball")
    ):
        return "Live-ball steal", action["teamId"], clock, None
    return None


def update_score(action, score):
    kind = action["actionType"]
    made_field_goal = action["isFieldGoal"] and action["shotResult"].casefold() == "made"
    made_free_throw = kind == "Free Throw" and not action["description"].upper().startswith("MISS")
    if made_field_goal or made_free_throw or kind in ("Instant Replay", "period"):
        home, away = str(action["scoreHome"]), str(action["scoreAway"])
        if home.isdecimal() and away.isdecimal() and (int(home) or int(away)):
            return int(home), int(away)
    if (made_field_goal or made_free_throw) and action["location"] in ("h", "v"):
        points = action["shotValue"] if made_field_goal else 1
        home, away = score
        return (home + points, away) if action["location"] == "h" else (home, away + points)
    return score


def game_shot_context(actions):
    """Capture each shot before updating the game state with its result."""
    aliases, opponents = game_players(actions)
    contexts = {}
    score = (0, 0)
    current_period = None
    previous, previous_clock = None, None
    possession = None
    entries, uncertain_teams = {}, set()
    observed_start = False
    for index, action in enumerate(actions):
        kind, period = action["actionType"], action["period"]
        player, team = action["personId"], action["teamId"]
        clock = period_seconds(action["clock"])
        length = 720 if period <= 4 else 300
        elapsed = length - clock if clock is not None and 0 <= clock <= length else None
        if period != current_period:
            current_period = period
            possession = None
            entries.clear()
            uncertain_teams.clear()
            observed_start = False
        if kind == "period" and action["subType"] == "start" and elapsed == 0:
            observed_start = True

        if action["isFieldGoal"]:
            origin, since, own_rebound = "Unknown", None, None
            if possession is not None and clock is not None:
                event, controlling_team, event_clock, rebounder = possession
                if controlling_team == team and 0 <= event_clock - clock <= 24:
                    origin, since = event, event_clock - clock
                    if rebounder:
                        own_rebound = int(rebounder == player)
            margin = None
            if action["location"] in ("h", "v"):
                margin = score[0] - score[1]
                if action["location"] == "v":
                    margin = -margin
            late_close = None if margin is None or clock is None else int(
                period >= 4 and clock <= 300 and abs(margin) <= 5
            )
            stint_source, stint = stint_at_shot(player, team, elapsed, entries, uncertain_teams, observed_start)
            subtype = action["subType"].casefold()
            contexts[index] = {
                "POSSESSION_ORIGIN": origin, "SECONDS_SINCE_POSSESSION_EVENT": since,
                "SHOOTER_REBOUNDED": own_rebound,
                "COURT_ZONE": court_zone(action["xLegacy"], action["yLegacy"], action["shotValue"]),
                **{f"SHOT_{name}": int(text in subtype) for name, text in FINISHES.items()},
                "PRE_SHOT_MARGIN": margin, "LATE_CLOSE_GAME": late_close,
                "OPPONENT_TEAM_ID": opponents.get(team, "Unknown"),
                "STINT_SOURCE": stint_source, "SECONDS_ON_COURT_THIS_PERIOD": stint,
            }
            possession = None
        elif kind == "Rebound" or "STEAL" in action["description"].upper():
            possession = possession_start(action, clock, previous, previous_clock)
        elif kind in POSSESSION_STOPS:
            possession = None

        if kind == "Substitution":
            update_substitution(action, elapsed, aliases, entries, uncertain_teams)
        score = update_score(action, score)
        previous, previous_clock = action, clock
    return contexts


def shot_family(subtype):
    """Keep explicit pull-ups distinct from events tagged simply as jump shots."""
    for part, family in (
        ("dunk", "Dunk"), ("layup", "Layup"), ("tip", "Tip"),
        ("hook", "Hook"), ("floating", "Floater"), ("pullup", "Pull-up"),
        ("step back", "Step-back"), ("turnaround", "Turnaround / fadeaway"),
        ("fadeaway", "Turnaround / fadeaway"),
    ):
        if part in subtype:
            return family
    if subtype == "jump shot":
        return "Generic jump shot"
    if "jump" in subtype or "bank" in subtype:
        return "Other jumper"
    return "Other"


def component_matches(rows, events):
    """Link unique pairs or equal-size connected groups with an ordered pairing."""
    by_index = {row.Index: row for row in rows}
    row_candidates = {}
    event_claims = defaultdict(list)
    for row in by_index.values():
        candidates = [
            index for index, (seconds, _) in events.items()
            if abs(row.PERIOD_SECONDS - seconds) <= MATCH_TOLERANCE_SECONDS
        ]
        row_candidates[row.Index] = candidates
        for index in candidates:
            event_claims[index].append(row.Index)

    visited = set()
    for start in by_index:
        if start in visited or not row_candidates[start]:
            continue
        component_rows, component_events = [], set()
        stack = [start]
        visited.add(start)
        while stack:
            current = stack.pop()
            component_rows.append(current)
            for event in row_candidates[current]:
                if event not in component_events:
                    component_events.add(event)
                    for claimant in event_claims[event]:
                        if claimant not in visited:
                            visited.add(claimant)
                            stack.append(claimant)
        if len(component_rows) != len(component_events):
            continue
        component_rows.sort(key=lambda index: by_index[index].SHOT_NUMBER)
        order = sorted(component_events)
        raw_clocks = [by_index[index].PERIOD_SECONDS for index in component_rows]
        event_clocks = [events[index][0] for index in order]
        if any(a < b for a, b in zip(raw_clocks, raw_clocks[1:])):
            continue
        if any(a < b for a, b in zip(event_clocks, event_clocks[1:])):
            continue
        pairs = list(zip(component_rows, order))
        if all(event in row_candidates[index] for index, event in pairs):
            method = "unique" if len(pairs) == 1 else "ordered"
            for index, event in pairs:
                yield index, method, events[event][1]


def link_shot_types(shots, cache, *, include_context=False):
    records = []
    signature_columns = ["player_id", "PERIOD", SHOT_VALUE]
    linkage_columns = ["GAME_ID", *signature_columns, "SHOT_NUMBER", "PERIOD_SECONDS"]
    for game_id, game_shots in shots[linkage_columns].groupby("GAME_ID", sort=False):
        source = cache / f"{game_id}.json"
        if not source.is_file():
            continue
        game = json.loads(source.read_text(encoding="utf-8"))
        if game["gameId"] != game_id:
            raise ValueError(f"Unexpected game identifier in {source}")
        actions = game["actions"]
        contexts = game_shot_context(actions) if include_context else {}
        by_signature = defaultdict(dict)
        for index, action in enumerate(actions):
            if action["isFieldGoal"]:
                clock = period_seconds(action["clock"])
                if clock is not None:
                    signature = (action["personId"], action["period"], action["shotValue"])
                    by_signature[signature][index] = (clock, index)
        for signature, rows in game_shots.groupby(signature_columns, sort=False):
            for row, method, index in component_matches(rows.itertuples(), by_signature[signature]):
                event = actions[index]
                subtype = event["subType"].casefold().strip()
                family = shot_family(subtype)
                broad = "Jumper" if family in (
                    "Generic jump shot", "Pull-up", "Step-back", "Turnaround / fadeaway", "Other jumper",
                ) else family
                records.append({
                    "row": row, "match_method": method, "SHOT_SUBTYPE": subtype,
                    FAMILY: family, BROAD: broad, "COURT_X": event["xLegacy"], "COURT_Y": event["yLegacy"],
                    "match_outcome_agrees": event["shotResult"].casefold() == ("made" if shots.at[row, TARGET] else "missed"),
                    **contexts.get(index, {}),
                })
    if not records:
        raise ValueError(f"No development shots linked to {cache}")
    labels = pd.DataFrame(records).set_index("row", verify_integrity=True)
    return shots.join(labels, validate="one_to_one")
