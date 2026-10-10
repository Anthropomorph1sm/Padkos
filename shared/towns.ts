// Major South African towns, roughly in order of size/prominence. Used to tell alternative
// routes apart ("via Kimberley" vs "via Bloemfontein") when their road numbers are the same.
import { cumulativeDistances, decodePolyline, haversine, nearestOnLine, simplify, type LatLng } from "./geo";

export const TOWNS: Array<[string, number, number]> = [
  ["Johannesburg", -26.204, 28.047],
  ["Cape Town", -33.925, 18.424],
  ["Durban", -29.859, 31.022],
  ["Pretoria", -25.746, 28.188],
  ["Gqeberha", -33.96, 25.602],
  ["Bloemfontein", -29.116, 26.214],
  ["East London", -33.015, 27.912],
  ["Pietermaritzburg", -29.601, 30.379],
  ["Kimberley", -28.738, 24.763],
  ["Polokwane", -23.904, 29.469],
  ["Mbombela", -25.475, 30.97],
  ["Rustenburg", -25.667, 27.242],
  ["George", -33.963, 22.462],
  ["Vereeniging", -26.673, 27.926],
  ["Emalahleni", -25.871, 29.233],
  ["Klerksdorp", -26.852, 26.667],
  ["Potchefstroom", -26.716, 27.103],
  ["Welkom", -27.977, 26.735],
  ["Newcastle", -27.758, 29.932],
  ["Richards Bay", -28.783, 32.038],
  ["Mthatha", -31.589, 28.784],
  ["Upington", -28.448, 21.256],
  ["Mahikeng", -25.865, 25.644],
  ["Middelburg (Mpumalanga)", -25.775, 29.464],
  ["Kroonstad", -27.65, 27.234],
  ["Bethlehem", -28.23, 28.307],
  ["Ladysmith", -28.56, 29.781],
  ["Komani", -31.897, 26.875],
  ["Makhanda", -33.311, 26.526],
  ["Worcester", -33.646, 19.448],
  ["Paarl", -33.734, 18.962],
  ["Stellenbosch", -33.932, 18.86],
  ["Mossel Bay", -34.183, 22.146],
  ["Knysna", -34.036, 23.047],
  ["Oudtshoorn", -33.59, 22.201],
  ["Beaufort West", -32.357, 22.583],
  ["Graaff-Reinet", -32.252, 24.531],
  ["Colesberg", -30.72, 25.097],
  ["De Aar", -30.65, 24.012],
  ["Harrismith", -28.273, 29.129],
  ["Ermelo", -26.533, 29.983],
  ["Standerton", -26.933, 29.241],
  ["Vryheid", -27.769, 30.791],
  ["Estcourt", -29.008, 29.871],
  ["Kokstad", -30.547, 29.424],
  ["Port Shepstone", -30.741, 30.455],
  ["Musina", -22.352, 30.042],
  ["Makhado", -23.044, 29.904],
  ["Mokopane", -24.194, 29.01],
  ["Bela-Bela", -24.885, 28.293],
  ["Lydenburg", -25.095, 30.448],
  ["Komatipoort", -25.433, 31.948],
  ["Springbok", -29.664, 17.886],
  ["Vanrhynsdorp", -31.609, 18.739],
  ["Clanwilliam", -32.179, 18.891],
  ["Laingsburg", -33.196, 20.858],
  ["Swellendam", -34.022, 20.442],
  ["Hermanus", -34.418, 19.235],
  ["Ceres", -33.369, 19.311],
  ["Riversdale", -34.093, 21.262],
  ["Plettenberg Bay", -34.053, 23.372],
  ["Jeffreys Bay", -34.05, 24.922],
  ["Cradock", -32.164, 25.619],
  ["Middelburg (Eastern Cape)", -31.493, 25.01],
  ["Aliwal North", -30.693, 26.711],
  ["Bethulie", -30.503, 25.976],
  ["Winburg", -28.517, 27.01],
  ["Parys", -26.9, 27.457],
  ["Vryburg", -26.957, 24.729],
  ["Kuruman", -27.452, 23.433],
  ["Prieska", -29.664, 22.747],
  ["Britstown", -30.587, 23.507],
  ["Victoria West", -31.403, 23.121],
  ["Calvinia", -31.471, 19.776],
  ["Lichtenburg", -26.152, 26.16],
  ["Zeerust", -25.538, 26.075],
  ["Thabazimbi", -24.591, 27.411],
  ["Volksrust", -27.365, 29.882],
  ["Ulundi", -28.335, 31.416],
  ["Underberg", -29.789, 29.497],
  ["Matatiele", -30.342, 28.806],
  ["Butterworth", -32.33, 28.15],
];

const NEAR_M = 8000;

function townsAlong(line: LatLng[]): Set<string> {
  const fine = simplify(line, 200);
  const cum = cumulativeDistances(fine);
  const ends = [line[0], line[line.length - 1]];
  const out = new Set<string>();
  for (const [name, lat, lng] of TOWNS) {
    // the towns the leg starts or ends in say nothing about the way it goes
    if (ends.some((e) => haversine(e, [lat, lng]) <= NEAR_M * 2)) continue;
    if (nearestOnLine([lat, lng], fine, cum).dist <= NEAR_M) out.add(name);
  }
  return out;
}

/**
 * For each route (encoded polyline), the most prominent town it passes that none of the
 * other routes pass — or undefined when nothing distinguishes it.
 */
export function distinguishingTowns(geometries: string[]): Array<string | undefined> {
  if (geometries.length < 2) return geometries.map(() => undefined);
  const sets = geometries.map((g) => townsAlong(decodePolyline(g)));
  return sets.map((set, i) => {
    for (const [name] of TOWNS) {
      if (set.has(name) && sets.every((other, j) => j === i || !other.has(name))) return name;
    }
    return undefined;
  });
}
