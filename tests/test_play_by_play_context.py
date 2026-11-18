import unittest

from play_by_play_context import game_shot_context


def event(kind, seconds, *, team=1, player=10, name="Smith", **fields):
    return {
        "actionType": kind, "clock": f"PT{seconds // 60}M{seconds % 60:02d}.00S",
        "period": 1, "teamId": team, "personId": player, "playerName": name,
        "playerNameI": name, "actionNumber": 1, "isFieldGoal": 0, "shotResult": "",
        "location": "h" if team == 1 else "v", "shotValue": 0,
        "scoreHome": "0", "scoreAway": "0", "subType": "", "description": "",
        "xLegacy": 0, "yLegacy": 0, **fields,
    }


class PlayByPlayContextTests(unittest.TestCase):
    def test_margin_uses_pre_shot_score_and_ignores_placeholders(self):
        previous = event("Made Shot", 710, isFieldGoal=1, shotResult="Made", shotValue=2, scoreHome="2")
        rebound = event("Rebound", 700)
        made = event("Made Shot", 695, team=2, isFieldGoal=1, shotResult="Made", shotValue=3,
                     scoreHome="2", scoreAway="3")
        missed = {**made, "actionType": "Missed Shot", "shotResult": "Missed", "scoreAway": "0"}
        self.assertEqual(game_shot_context([previous, rebound, made])[2]["PRE_SHOT_MARGIN"], -2)
        self.assertEqual(
            game_shot_context([previous, rebound, made])[2],
            game_shot_context([previous, rebound, missed])[2],
        )

    def test_same_clock_second_chance_uses_earlier_events(self):
        missed = event("Missed Shot", 625, isFieldGoal=1, shotResult="Missed", shotValue=2)
        second = {**missed, "subType": "Putback Layup Shot"}
        rebound = event("Rebound", 625)
        context = game_shot_context([missed, rebound, second])
        self.assertEqual(context[0]["POSSESSION_ORIGIN"], "Unknown")
        self.assertEqual(context[2]["POSSESSION_ORIGIN"], "Offensive rebound")
        self.assertEqual(context[2]["SECONDS_SINCE_POSSESSION_EVENT"], 0)
        self.assertEqual(context[2]["SHOOTER_REBOUNDED"], 1)
        self.assertEqual(context[2]["SHOT_PUTBACK"], 1)
        timeout = event("Timeout", 625)
        self.assertEqual(game_shot_context([missed, rebound, timeout, second])[3]["POSSESSION_ORIGIN"], "Unknown")

    def test_stints_use_prior_substitutions_and_explicitly_mark_unknown_entries(self):
        start = event("period", 720, team=0, subType="start")
        first = event("Missed Shot", 700, isFieldGoal=1, shotResult="Missed", shotValue=2)
        sub = event("Substitution", 650, description="SUB: Jones FOR Smith")
        new = event("Missed Shot", 620, player=11, name="Jones", isFieldGoal=1, shotResult="Missed", shotValue=2)
        context = game_shot_context([start, first, sub, new])
        self.assertEqual(context[1]["STINT_SOURCE"], "Inferred period start")
        self.assertEqual(context[1]["SECONDS_ON_COURT_THIS_PERIOD"], 20)
        self.assertEqual(context[3]["STINT_SOURCE"], "Logged substitution")
        self.assertEqual(context[3]["SECONDS_ON_COURT_THIS_PERIOD"], 30)
        unknown = {**sub, "description": "SUB: Unknown FOR Smith"}
        self.assertIsNone(game_shot_context([start, first, unknown, new])[3]["SECONDS_ON_COURT_THIS_PERIOD"])

    def test_paired_steal_marks_transition_into_corner_three(self):
        turnover = event("Turnover", 600, team=2, subType="Bad Pass")
        steal = event("", 600, description="Smith STEAL")
        shot = event("Missed Shot", 596, isFieldGoal=1, shotResult="Missed", shotValue=3,
                     xLegacy=-225, yLegacy=30)
        context = game_shot_context([turnover, steal, shot])[2]
        self.assertEqual(context["POSSESSION_ORIGIN"], "Live-ball steal")
        self.assertEqual(context["SECONDS_SINCE_POSSESSION_EVENT"], 4)
        self.assertEqual(context["COURT_ZONE"], "Left corner three")


if __name__ == "__main__":
    unittest.main()
