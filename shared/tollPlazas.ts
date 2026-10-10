// South African toll plazas (light vehicle / Class 1).
//
// Positions: OpenStreetMap contributors (ODbL), barrier=toll_booth nodes, fetched October 2026.
// Fees: approximate Class 1 tariffs in Rand. SANRAL, N3TC, Bakwena and TRAC adjust tariffs every
// March, so treat these as estimates — the app lets users override any fee.
// Gauteng e-toll gantries are not listed: the e-toll system was switched off in April 2024.

export interface TollPlaza {
  id: string;
  name: string;
  road: string;
  /** Class 1 (light vehicle) fee in Rand */
  fee: number;
  /** ramp plazas sit on off/on-ramps and only charge traffic using that interchange */
  ramp: boolean;
  /** booth positions [lat, lng] */
  points: Array<[number, number]>;
}

export const TOLL_PLAZAS: TollPlaza[] = [
  { id: "chapmans-peak", name: "Chapman's Peak Drive", road: "M6", fee: 67, ramp: false, points: [[-34.06309, 18.37168], [-34.06311, 18.37162]] },
  { id: "baobab", name: "Baobab", road: "N1", fee: 60, ramp: false, points: [[-22.64713, 29.9181]] },
  { id: "brandfort", name: "Brandfort", road: "N1", fee: 42, ramp: true, points: [[-28.90221, 26.33795]] },
  { id: "capricorn", name: "Capricorn", road: "N1", fee: 58, ramp: false, points: [[-23.3669, 29.77502]] },
  { id: "carousel", name: "Carousel", road: "N1", fee: 82, ramp: false, points: [[-25.32497, 28.29771], [-25.32308, 28.298], [-25.32502, 28.29728]] },
  { id: "grasmere", name: "Grasmere", road: "N1", fee: 25, ramp: false, points: [[-26.41711, 27.88075], [-26.41561, 27.87982], [-26.41151, 27.88395], [-26.41162, 27.88414], [-26.41137, 27.88374], [-26.41176, 27.88437]] },
  { id: "hammanskraal", name: "Hammanskraal (ramp)", road: "N1", fee: 22, ramp: true, points: [[-25.40414, 28.29715], [-25.40404, 28.29875]] },
  { id: "huguenot", name: "Huguenot Tunnel", road: "N1", fee: 59, ramp: false, points: [[-33.74268, 19.01986], [-33.74285, 19.0198], [-33.7425, 19.0199]] },
  { id: "kranskop", name: "Kranskop", road: "N1", fee: 58, ramp: false, points: [[-24.78157, 28.47146], [-24.78166, 28.47164], [-24.78149, 28.47131], [-24.7817, 28.47175]] },
  { id: "maubane", name: "Maubane (ramp)", road: "N1", fee: 22, ramp: true, points: [[-25.28183, 28.29725], [-25.28231, 28.29919]] },
  { id: "murrayhill", name: "Murrayhill (ramp)", road: "N1", fee: 14, ramp: true, points: [[-25.50343, 28.28701], [-25.50421, 28.28861]] },
  { id: "nyl", name: "Nyl", road: "N1", fee: 50, ramp: false, points: [[-24.28971, 28.97928], [-24.28992, 28.97959], [-24.29001, 28.97969], [-24.28984, 28.97945]] },
  { id: "pumulani", name: "Pumulani", road: "N1", fee: 18, ramp: false, points: [[-25.6394, 28.27528], [-25.63944, 28.27568]] },
  { id: "sebetiela", name: "Sebetiela (ramp)", road: "N1", fee: 26, ramp: true, points: [[-24.16778, 29.08545], [-24.1677, 29.0855]] },
  { id: "stormvoel", name: "Stormvoël (ramp)", road: "N1", fee: 11, ramp: true, points: [[-25.7128, 28.26635], [-25.71244, 28.26502]] },
  { id: "vaal", name: "Vaal", road: "N1", fee: 90, ramp: false, points: [[-26.85645, 27.6353], [-26.85639, 27.63509]] },
  { id: "verkeerdevlei", name: "Verkeerdevlei", road: "N1", fee: 88, ramp: false, points: [[-28.79878, 26.69057]] },
  { id: "wallmansthal", name: "Wallmansthal (ramp)", road: "N1", fee: 14, ramp: true, points: [[-25.57995, 28.2807], [-25.58013, 28.28249]] },
  { id: "zambesi", name: "Zambesi (ramp)", road: "N1", fee: 11, ramp: true, points: [[-25.68608, 28.2806], [-25.68637, 28.28243]] },
  { id: "dalpark", name: "Dalpark", road: "N17", fee: 13, ramp: false, points: [[-26.25618, 28.32767], [-26.25642, 28.32761]] },
  { id: "denne", name: "Denne (ramp)", road: "N17", fee: 10, ramp: true, points: [[-26.26744, 28.36194], [-26.26751, 28.36071], [-26.26748, 28.36191]] },
  { id: "ermelo", name: "Ermelo", road: "N17", fee: 72, ramp: false, points: [[-26.50556, 29.86597]] },
  { id: "gosforth", name: "Gosforth", road: "N17", fee: 19, ramp: false, points: [[-26.25126, 28.14293], [-26.24847, 28.15834], [-26.24814, 28.15827], [-26.25142, 28.14009], [-26.24872, 28.15839], [-26.24799, 28.15824]] },
  { id: "leandra", name: "Leandra", road: "N17", fee: 55, ramp: false, points: [[-26.39853, 28.94925], [-26.39523, 28.93644], [-26.39731, 28.93718]] },
  { id: "trichardt", name: "Trichardt", road: "N17", fee: 66, ramp: false, points: [[-26.48368, 29.32608]] },
  { id: "dokodweni", name: "Dokodweni", road: "N2", fee: 26, ramp: false, points: [[-29.07939, 31.6142]] },
  { id: "dokodweni-ramp", name: "Dokodweni (ramp)", road: "N2", fee: 26, ramp: true, points: [[-29.07804, 31.61311]] },
  { id: "izotsha", name: "Izotsha (ramp)", road: "N2", fee: 10, ramp: true, points: [[-30.80108, 30.40159], [-30.7987, 30.40102]] },
  { id: "king-shaka", name: "King Shaka Airport (ramp)", road: "N2", fee: 11, ramp: true, points: [[-29.63365, 31.1207]] },
  { id: "mandini", name: "Mandini", road: "N2", fee: 16, ramp: false, points: [[-29.1854, 31.48153]] },
  { id: "mandini-ramp", name: "Mandini (ramp)", road: "N2", fee: 16, ramp: true, points: [[-29.1841, 31.48085]] },
  { id: "mtunzini", name: "Mtunzini", road: "N2", fee: 66, ramp: false, points: [[-28.95721, 31.73757], [-28.95732, 31.73776], [-28.95743, 31.73797]] },
  { id: "mtunzini-ramp", name: "Mtunzini (ramp)", road: "N2", fee: 11, ramp: true, points: [[-28.95202, 31.74045], [-28.95233, 31.74186]] },
  { id: "mvoti", name: "Mvoti", road: "N2", fee: 26, ramp: false, points: [[-29.40346, 31.28555], [-29.40335, 31.28532]] },
  { id: "oribi", name: "Oribi", road: "N2", fee: 19, ramp: false, points: [[-30.75434, 30.43201], [-30.75445, 30.43288], [-30.74832, 30.43341], [-30.74833, 30.43359], [-30.74831, 30.4333], [-30.74834, 30.43375]] },
  { id: "othongathi", name: "oThongathi", road: "N2", fee: 17, ramp: false, points: [[-29.58821, 31.14116], [-29.58814, 31.14091], [-29.5881, 31.14068], [-29.58828, 31.14138]] },
  { id: "othongathi-ramp", name: "oThongathi (ramp)", road: "N2", fee: 9, ramp: true, points: [[-29.58125, 31.14373], [-29.58227, 31.145]] },
  { id: "tsitsikamma", name: "Tsitsikamma", road: "N2", fee: 70, ramp: false, points: [[-33.95038, 23.62324], [-33.94573, 23.61913], [-33.94526, 23.62004]] },
  { id: "umtentweni", name: "Umtentweni (ramp)", road: "N2", fee: 10, ramp: true, points: [[-30.70049, 30.44624], [-30.70045, 30.4447]] },
  { id: "bergville", name: "Bergville (ramp)", road: "N3", fee: 34, ramp: true, points: [[-28.5887, 29.60832], [-28.58857, 29.60976]] },
  { id: "de-hoek", name: "De Hoek", road: "N3", fee: 86, ramp: false, points: [[-26.66393, 28.38992], [-26.66396, 28.38973], [-26.66392, 28.39005], [-26.66399, 28.38956]] },
  { id: "mariannhill", name: "Mariannhill", road: "N3", fee: 17, ramp: false, points: [[-29.82302, 30.80276], [-29.82329, 30.80287], [-29.82276, 30.80265], [-29.82312, 30.8028]] },
  { id: "mooi", name: "Mooi", road: "N3", fee: 80, ramp: false, points: [[-29.21802, 30.00396], [-29.21809, 30.00348], [-29.21805, 30.00375], [-29.21813, 30.00321], [-29.22169, 30.00367]] },
  { id: "mooi-ramp", name: "Mooi (ramp)", road: "N3", fee: 28, ramp: true, points: [[-29.22167, 30.00497]] },
  { id: "treverton", name: "Treverton (ramp)", road: "N3", fee: 28, ramp: true, points: [[-29.19269, 29.99412], [-29.1933, 29.99304]] },
  { id: "tugela", name: "Tugela", road: "N3", fee: 100, ramp: false, points: [[-28.46233, 29.56156], [-28.46222, 29.56175]] },
  { id: "tugela-east", name: "Tugela East (ramp)", road: "N3", fee: 34, ramp: true, points: [[-28.4581, 29.56997]] },
  { id: "wilge", name: "Wilge", road: "N3", fee: 93, ramp: false, points: [[-27.04049, 28.62624], [-27.04061, 28.62599], [-27.04071, 28.62578], [-27.0404, 28.6264]] },
  { id: "brits", name: "Brits", road: "N4", fee: 22, ramp: false, points: [[-25.64995, 27.92155], [-25.65013, 27.92155]] },
  { id: "buffelspoort", name: "Buffelspoort (ramp)", road: "N4", fee: 20, ramp: true, points: [[-25.75124, 27.49258], [-25.75243, 27.49219]] },
  { id: "diamond-hill", name: "Diamond Hill", road: "N4", fee: 27, ramp: false, points: [[-25.79793, 28.55042], [-25.79817, 28.55038]] },
  { id: "donkerhoek", name: "Donkerhoek", road: "N4", fee: 21, ramp: false, points: [[-25.77368, 28.43301], [-25.77195, 28.43253]] },
  { id: "doornpoort", name: "Doornpoort", road: "N4", fee: 16, ramp: false, points: [[-25.64343, 28.25373], [-25.64318, 28.25372], [-25.64365, 28.25373]] },
  { id: "doornpoort-ramp", name: "Doornpoort (ramp)", road: "N4", fee: 10, ramp: true, points: [[-25.64202, 28.24276]] },
  { id: "kroondal", name: "Kroondal", road: "N4", fee: 20, ramp: false, points: [[-25.72842, 27.30877], [-25.73034, 27.30918]] },
  { id: "machado", name: "Machado", road: "N4", fee: 135, ramp: false, points: [[-25.62777, 30.25822], [-25.62788, 30.25839]] },
  { id: "marikana", name: "Marikana", road: "N4", fee: 50, ramp: false, points: [[-25.74746, 27.39729]] },
  { id: "middelburg", name: "Middelburg", road: "N4", fee: 82, ramp: false, points: [[-25.86592, 29.36382], [-25.86609, 29.36396]] },
  { id: "nkomazi", name: "Nkomazi", road: "N4", fee: 180, ramp: false, points: [[-25.53626, 31.34442]] },
  { id: "pelindaba", name: "Pelindaba", road: "N4", fee: 11, ramp: false, points: [[-25.77782, 27.95977], [-25.77804, 27.95981], [-25.77786, 27.95978]] },
  { id: "quagga", name: "Quagga", road: "N4", fee: 11, ramp: false, points: [[-25.74932, 28.11489], [-25.74923, 28.11488]] },
  { id: "swanepoel-ramp", name: "Dr Swanepoel (ramp)", road: "N4", fee: 10, ramp: true, points: [[-25.64492, 28.24663]] },
  { id: "swartruggens", name: "Swartruggens", road: "N4", fee: 150, ramp: false, points: [[-25.66083, 26.60505]] },
];
