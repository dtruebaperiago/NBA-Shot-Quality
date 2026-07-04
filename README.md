# NBA-Shot-Quality
A machine learning pipeline that estimates the true quality of every NBA shot attempt as an expected field goal probability (xFG%), moving beyond raw shooting percentages to account for shot distance, defensive pressure, shot creation difficulty, and clock context.

Built with XGBoost and interpreted via SHAP values, the model outputs player-level efficiency metrics that isolate shooting skill from shot selection. Results are surfaced through an interactive Streamlit dashboard designed for coaching and scouting use cases.

Data sourced from the NBA Stats API (nba_api). Covers the 2022-23 and 2023-24 regular seasons.
