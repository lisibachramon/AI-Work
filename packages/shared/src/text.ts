// German + Swiss-German text utilities for matching and search.

const UMLAUT_MAP: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

// Canonicalize for matching: lowercase, expand umlauts, strip diacritics, collapse whitespace.
export function normalizeGerman(input: string): string {
  return input
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Cheap Levenshtein-based similarity in [0, 1] for short strings. For the DB we use pg_trgm;
// this exists for client-side tiebreakers in autocomplete.
export function similarity(a: string, b: string): number {
  const an = normalizeGerman(a);
  const bn = normalizeGerman(b);
  if (an === bn) return 1;
  if (an.length === 0 || bn.length === 0) return 0;
  const dp: number[][] = Array.from({ length: an.length + 1 }, () => new Array(bn.length + 1).fill(0));
  for (let i = 0; i <= an.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= bn.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= an.length; i++) {
    for (let j = 1; j <= bn.length; j++) {
      const cost = an[i - 1] === bn[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  const dist = dp[an.length]![bn.length]!;
  return 1 - dist / Math.max(an.length, bn.length);
}

// Swiss-German diminutive aliases worth seeding alongside Standard German names.
// Keys are the *normalized canonical name* (lowercased, umlauts expanded as
// ae/oe/ue/ss, no whitespace) — they must match the output of the same
// normalization applied to the seeded canonical name, otherwise the alias
// never lands. Values are the surface forms users actually type.
export const SWISS_ALIASES: Record<string, string[]> = {
  // Produce
  petersilie: ["peterli", "petersili"],
  karotte: ["rueebli", "rüebli", "karotten"],
  zwiebel: ["boelle", "böle", "zwiebeln"],
  kartoffel: ["herdoepfel", "härdöpfel", "gschwellti", "kartoffeln", "erdäpfel"],
  tomate: ["tomaten", "paradeiser"],
  apfel: ["aepfel", "äpfel"],
  spinat: ["spinaat"],
  salat: ["kopfsalat", "gruensalat", "grünsalat", "nuesslisalat", "nüsslisalat"],
  gurke: ["gurken", "salatgurke"],
  paprika: ["peperoni", "paprikaschote"],
  zucchini: ["zucchetti", "zucchinis"],
  aubergine: ["auberginen", "melanzani"],
  brokkoli: ["broccoli"],
  blumenkohl: ["karfiol", "blumenkohlroeschen"],
  pilze: ["champignons", "champignon", "pilz"],
  knoblauch: ["knobli", "knoblauchzehe", "knoblauchzehen"],
  ingwer: ["ingwerwurzel"],
  lauch: ["porree", "lauchstange"],
  sellerie: ["knollensellerie", "stangensellerie"],
  fenchel: ["fenchelknolle"],
  birne: ["birnen"],
  banane: ["bananen"],
  orange: ["orangen", "apfelsine", "apfelsinen"],
  zitrone: ["zitronen", "limone"],
  erdbeere: ["erdbeeren"],
  blaubeere: ["blaubeeren", "heidelbeere", "heidelbeeren"],
  himbeere: ["himbeeren"],
  avocado: ["avocados"],
  schnittlauch: ["schnittlauchroellchen"],

  // Dairy
  vollmilch: ["milch"],
  magermilch: ["entrahmte milch"],
  joghurt: ["jogurt", "yoghurt"],
  quark: ["topfen", "magerquark"],
  sahne: ["rahm", "schlagsahne", "schlagrahm"],
  "cremefraiche": ["creme fraiche", "crème fraîche"],
  frischkaese: ["frischkäse", "philadelphia"],
  gruyere: ["greyerzer", "gruyère"],

  // Meat
  haehnchenbrust: ["pouletbrust", "poulet", "hühnerbrust", "huhn", "hähnchen"],
  rindfleisch: ["rind", "rindsfleisch"],
  hackfleisch: ["gehacktes", "haggis", "faschiertes", "hackepeter"],
  schweinefleisch: ["schwein", "schweinsfleisch"],
  schinken: ["kochschinken", "rohschinken"],
  speck: ["bauchspeck", "fruehstuecksspeck"],
  bratwurst: ["bratwuerste", "wurst"],
  cervelat: ["cervelats", "servela"],
  lammfleisch: ["lamm"],

  // Fish
  lachs: ["raeucherlachs", "räucherlachs"],
  thunfisch: ["tuna", "thon"],
  garnelen: ["shrimps", "crevetten"],

  // Bakery
  brot: ["broetli", "brötli", "brötchen"],
  toastbrot: ["toast", "sandwichbrot"],
  broetchen: ["brötchen", "semmel", "weggli"],
  knaeckebrot: ["knäckebrot", "knaecke"],
  croissant: ["gipfeli", "hörnchen", "hoernchen"],
  baguette: ["stangenbrot"],

  // Dry goods
  mehl: ["weissmehl", "weizenmehl"],
  pasta: ["nudeln", "teigwaren"],
  spaghetti: ["spaghettini"],
  haferflocken: ["hafer", "porridge"],
  linsen: ["rote linsen", "berglinsen"],
  bohnen: ["kidneybohnen", "weisse bohnen"],
  kichererbsen: ["chickpeas"],
  spaetzli: ["spätzli", "spätzle", "knöpfli", "knoepfli"],
  zucker: ["kristallzucker", "haushaltszucker"],
  hefe: ["germ", "trockenhefe", "frischhefe"],

  // Spices
  paprikapulver: ["edelsuess", "edelsüss", "rosenpaprika"],
  currypulver: ["curry"],
  basilikum: ["basilikumblaetter"],
  chili: ["chilipulver", "chilischote", "peperoncini"],
  kreuzkuemmel: ["kreuzkümmel", "cumin"],

  // Beverages
  wasser: ["leitungswasser"],
  mineralwasser: ["sprudel", "sprudelwasser"],
  apfelsaft: ["suessmost", "süssmost"],
  wein: ["rotwein", "weisswein", "weißwein"],

  // Frozen
  tiefkuehlerbsen: ["tk erbsen", "tk-erbsen", "gefrorene erbsen"],
  tiefkuehlspinat: ["tk spinat", "tk-spinat", "gefrorener spinat"],
  tiefkuehlpommes: ["tk pommes", "pommes frites", "pommes"],
  tiefkuehlpizza: ["tk pizza", "tk-pizza"],
  eis: ["speiseeis", "glace"],

  // Condiments
  olivenoel: ["olivenöl", "natives olivenöl"],
  senf: ["dijon senf", "scharfer senf"],
  mayonnaise: ["mayo"],
  essig: ["weissweinessig", "apfelessig"],
  balsamico: ["aceto balsamico", "balsamicoessig"],
  marmelade: ["konfituere", "konfitüre", "jam"],
  sojasauce: ["soja sosse", "soja", "soya sauce"],
  tomatenmark: ["tomatenpueree", "tomatenpüree", "tomatenpaste"],
};
