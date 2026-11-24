import type { Dataset, Shot } from "./shots";

const teams = {
  BAY: { name: "Bay City Breakers", color: "#315b92", city: "Bay City", mark: "BC" },
  HBR: { name: "Harbor Comets", color: "#974630", city: "Harbor", mark: "HC" },
  RID: { name: "Ridge Foxes", color: "#465d4c", city: "Ridge", mark: "RF" },
  MET: { name: "Metro Pilots", color: "#733c5d", city: "Metro", mark: "MP" },
};

const rosters = {
  BAY: ["Miles Carter", "Jordan Vale", "Andre Miller", "Sam Park"],
  HBR: ["Elias Brooks", "Darius Wells", "Nico Hall", "Kai James"],
  RID: ["Jalen Rivers", "Kellan Foster", "Drew Price", "Leon Gray"],
  MET: ["Marcus Ellis", "Jude Martin", "Theo Young", "Ren Hayes"],
};

const dates = ["2015-01-27", "2015-01-30", "2015-02-02", "2015-02-06", "2015-02-09", "2015-02-12", "2015-02-20", "2015-02-24", "2015-02-27", "2015-03-02", "2015-03-04"];
const matchups = [["BAY", "HBR"], ["RID", "MET"], ["BAY", "RID"], ["HBR", "MET"], ["BAY", "MET"], ["HBR", "RID"]] as const;

function makeShots() {
  let seed = 84051;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const shots: Shot[] = [];

  dates.forEach((date, gameIndex) => {
    const game = `sample-${gameIndex + 1}`;
    const matchup = matchups[gameIndex % matchups.length];
    matchup.forEach((team, side) => {
      rosters[team].forEach((player, playerIndex) => {
        const attempts = [29, 21, 13, 9][playerIndex];
        for (let shotIndex = 0; shotIndex < attempts; shotIndex++) {
          const distanceChoice = random();
          const isThree = distanceChoice > 0.47 + playerIndex * 0.09;
          const isCorner = isThree && random() < 0.24;
          const atRim = !isThree && distanceChoice < 0.22;
          const angle = 0.12 + random() * 2.9;
          const distance = isThree ? 237 + random() * 56 : atRim ? 13 + random() * 34 : 68 + random() * 155;
          const x = isCorner ? (random() > 0.5 ? 1 : -1) * (222 + random() * 21) : Math.max(-244, Math.min(244, Math.cos(angle) * distance));
          const y = isCorner ? -27 + random() * 110 : Math.sin(angle) * distance;
          const defender = 0.8 + random() * (isThree ? 8 : 6);
          const probability = Math.min(0.87, (isThree ? 0.29 : atRim ? 0.52 : 0.35) + defender * 0.024 + (playerIndex ? 0 : 0.03));
          const made = random() < probability;
          shots.push({
            id: `${game}-${team}-${playerIndex}-${shotIndex}`, game, date, player, team, opponent: matchup[1 - side],
            period: 1 + Math.floor(random() * 4), gameClock: Math.floor(random() * 720),
            shotClock: shotIndex % 17 === 0 ? null : Math.round((3 + random() * 20) * 10) / 10,
            defender: Math.round(defender * 10) / 10, basketDistance: Math.hypot(x, y) / 10, value: isThree ? 3 : 2, made,
            probability: date >= "2015-02-01" ? probability : null,
            x: shotIndex % 29 === 28 ? null : Math.round(x), y: shotIndex % 29 === 28 ? null : Math.round(y),
            zone: isCorner ? "Corner three" : isThree ? "Above the break" : atRim ? "Rim" : Math.abs(x) < 76 && y < 141 ? "Paint" : "Midrange",
            family: atRim ? "Layup" : random() > 0.65 ? "Pull-up" : "Jump shot",
          });
        }
      });
    });
  });
  return shots.sort((a, b) => b.date.localeCompare(a.date));
}

export function sampleDataset(): Dataset {
  return {
    source: "sample", label: "Synthetic sample", start: dates[0], end: dates.at(-1)!,
    scoredStart: "2015-02-01", defaultPlayer: "Miles Carter", teams, shots: makeShots(),
  };
}
