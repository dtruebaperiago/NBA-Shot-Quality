import { benchmarkEvidence, benchmarkReport, readShotFilters, selectLabShots } from "../../../lib/archive-query";
import { getDataset, getDatasetVersion } from "../../../lib/dataset";
import { studyShots } from "../../../lib/model-study";
import { playerFinder, playerFinderShots, type FinderScope } from "../../../lib/player-finder";
import { scoutDimension, teamScout, teamScoutEvidence } from "../../../lib/team-scout";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const read = (name: string) => params.get(name) ?? "";
  const { source, shots, scoredStart } = getDataset();
  const team = read("team");
  const game = read("game");
  const headers = { "Cache-Control": "private, no-store" };
  // shortcut: only the active archive is retained, keep snapshots if older evidence must stay available.
  if (read("version") && read("version") !== getDatasetVersion()) {
    return Response.json({ error: "Archive version unavailable" }, { status: 409, headers });
  }

  switch (read("scope")) {
    case "lab":
      return Response.json(selectLabShots(shots, { team, game, player: read("player"), start: read("start"), end: read("end"), comparison: read("comparison"), benchmark: "" }), { headers });
    case "benchmark":
    case "benchmark-shots": {
      const scope = { team, game, player: read("player"), start: read("start"), end: read("end"), comparison: "", benchmark: read("benchmark") };
      const options = { first: readShotFilters(read, "a."), second: readShotFilters(read, "b."), band: read("band"), scoredOnly: read("scored") === "1" };
      const page = { index: Math.trunc(Number(read("page"))) || 0, a: read("a") === "1", b: read("b") === "1" };
      return Response.json(read("scope") === "benchmark" ? benchmarkReport(shots, scope, options) : benchmarkEvidence(shots, scope, options, page), { headers });
    }
    case "team":
      return Response.json(shots.filter(shot => shot.team === team), { headers });
    case "model":
      return Response.json(studyShots(shots, { team, game, value: read("value"), window: read("window") === "holdout" ? "holdout" : "full" }, scoredStart), { headers });
    case "team-scout":
      return Response.json(teamScout(shots, { from: read("from"), through: read("through"), before: read("before") }, read("own"), read("opponent"), scoutDimension(read("dimension"))), { headers });
    case "team-scout-shots":
      return Response.json(teamScoutEvidence(shots, { from: read("from"), through: read("through"), before: read("before"), team, side: read("side") === "allowed" ? "allowed" : "shooting", dimension: scoutDimension(read("dimension")), bucket: read("bucket") }), { headers });
    case "player-finder":
    case "player-finder-shots": {
      if (source !== "archive") return Response.json({ error: "Historical archive unavailable" }, { status: 404, headers });
      const scope: FinderScope = { team, window: read("window") === "holdout" ? "holdout" : "full", pool: read("pool") === "all" ? "all" : "outside" };
      const filters = readShotFilters(read);
      const result = read("scope") === "player-finder" ? playerFinder(shots, scope, filters, read("need"), scoredStart) : playerFinderShots(shots, scope, filters, read("player"), scoredStart);
      return Response.json(result, { headers });
    }
    default:
      return Response.json({ error: "Unknown archive scope" }, { status: 400, headers });
  }
}
