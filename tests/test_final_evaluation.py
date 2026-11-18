from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from final_evaluation import FINAL, PENDING_FILE, PREDICTIONS_FILE, check_output_paths, save_results
from fit_baselines import calibration_table
from shot_history import HISTORICAL, sequence_data


class FinalEvaluationTests(unittest.TestCase):
    def test_calibration_preserves_both_edge_conventions(self):
        predictions = [0.0, 0.4, 1.0]
        target = [0, 1, 1]
        legacy = calibration_table(target, predictions, 10, right_closed=True)
        final = calibration_table(target, predictions, 20, right_closed=False)
        self.assertEqual(legacy.index[legacy.attempts.gt(0)].tolist(), [0, 3, 9])
        self.assertEqual(final.index[final.attempts.gt(0)].tolist(), [0, 8, 19])

    def test_summary_only_preserves_summary_and_skips_sequence(self):
        shots = pd.DataFrame({"player_id": [1] * 3, "GAME_DATE": ["2014-12-01", "2014-12-02", "2015-01-01"],
                              "FGM": [1, 0, 1], **{name: [1.0, 2.0, np.nan] for name in HISTORICAL}})
        training = np.array([True, True, False])
        sequence, lengths, summary = sequence_data(shots, training, 10)
        skipped, summary_lengths, summary_only = sequence_data(shots, training, 10, include_sequence=False)
        self.assertEqual(sequence.shape, (3, 10, 12))
        self.assertIsNone(skipped)
        np.testing.assert_equal(lengths, summary_lengths)
        pd.testing.assert_frame_equal(summary, summary_only)

    def test_retry_owned_partial_model_and_protect_completed_run(self):
        predictions = pd.DataFrame({"PTS_TYPE": [2], "SHOT_FAMILY": ["Dunk"], "CLOSE_DEF_DIST": [3],
                                    "FGM": [1], "GAME_ID": ["001"], FINAL: [.9]})
        with TemporaryDirectory() as workspace:
            output = Path(workspace) / "report"
            model = Path(workspace) / "models" / "fit.joblib"
            real_replace = Path.replace

            def fail_before_completion(path, destination):
                if path.name == PREDICTIONS_FILE:
                    raise OSError("Interrupted before publishing predictions")
                return real_replace(path, destination)

            args = (output, model, {}, {}, {}, pd.DataFrame(), pd.DataFrame(), predictions)
            with patch("final_evaluation.plot_calibration"), patch.object(Path, "replace", fail_before_completion):
                with self.assertRaises(OSError):
                    save_results(*args)
            self.assertFalse((output / PREDICTIONS_FILE).exists())
            self.assertTrue(model.exists())
            self.assertIsNotNone(check_output_paths(output, model))
            unrelated = model.with_name("unrelated.joblib")
            unrelated.write_bytes(model.read_bytes())
            with self.assertRaisesRegex(ValueError, "already occupied"):
                check_output_paths(output, unrelated)
            with patch("final_evaluation.plot_calibration"):
                save_results(*args)
            self.assertFalse((output / PENDING_FILE).exists())
            self.assertTrue((output / PREDICTIONS_FILE).exists())
            with self.assertRaisesRegex(ValueError, "Final report already exists"):
                check_output_paths(output, model)


if __name__ == "__main__":
    unittest.main()
