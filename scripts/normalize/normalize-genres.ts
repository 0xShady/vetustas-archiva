// Collapse the free-text `genre` column down to a small set of canonical
// "big" genres.
//
//   npm run normalize:genres            # DRY RUN — prints distribution + diffs
//   npm run normalize:genres -- --write # rewrite the CSVs in place

import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

type Row = Record<string, string>;

const DATASETS_DIR = path.resolve(__dirname, "..", "datasets");

type Vocab = {
  files: string[];
  order: string[];
  rules: [string, string[]][];
};

// ── Movies + TV ──────────────────────────────────────────────────────────
const SCREEN: Vocab = {
  files: ["movies.csv", "tv.csv"],
  order: [
    "Drama",
    "Comedy",
    "Action",
    "Adventure",
    "Crime",
    "Thriller",
    "Sci-Fi",
    "Fantasy",
    "Horror",
    "Mystery",
    "Romance",
    "War",
    "Western",
    "History",
    "Biography",
    "Documentary",
    "Animation",
    "Music",
    "Family",
    "Sport",
  ],
  rules: [
    ["Drama", ["drama", "melodrama", "soap", "telenovela", "docudrama"]],
    [
      "Comedy",
      [
        "comedy",
        "comedic",
        "sitcom",
        "satir",
        "parody",
        "slapstick",
        "mockumentary",
        "sketch",
        "tragicomedy",
        "surreal humour",
        "raunchy",
        "farce",
      ],
    ],
    [
      "Action",
      [
        "action",
        "superhero",
        "martial arts",
        "kung fu",
        "ninja",
        "hack and slash",
        "girls with guns",
        "sword-and-sandal",
        "blaxploitation",
      ],
    ],
    [
      "Adventure",
      [
        "adventure",
        "treasure hunt",
        "pirate",
        "swashbuck",
        "survival",
        "knight",
        "road movie",
      ],
    ],
    [
      "Crime",
      [
        "crime",
        "noir",
        "gangster",
        "heist",
        "mafia",
        "hood film",
        "police",
        "detective",
        "vigilante",
        "prison",
        "cop film",
        "trial",
        "legal",
      ],
    ],
    ["Thriller", ["thriller", "suspense", "spy", "espionage"]],
    [
      "Sci-Fi",
      [
        "science fiction",
        "sci-fi",
        "speculative fiction",
        "space opera",
        "space adventure",
        "cyberpunk",
        "dystopia",
        "post-apocalyptic",
        "time-travel",
        "time travel",
        "isekai",
        "alternate history",
        "biopunk",
        "tech noir",
        "technofantasy",
        "techno-thriller",
      ],
    ],
    [
      "Fantasy",
      [
        "fantasy",
        "fairy tale",
        "sword and sorcery",
        "magic realist",
        "supernatural",
        "dark fantasy",
      ],
    ],
    [
      "Horror",
      [
        "horror",
        "slasher",
        "monster",
        "vampire",
        "werewolf",
        "ghost",
        "zombie",
        "satanic",
        "paranormal",
        "body horror",
      ],
    ],
    ["Mystery", ["mystery"]],
    ["Romance", ["romance", "romantic", "erotic"]],
    ["War", ["war", "anti-war", "partisan", "military", "submarine"]],
    ["Western", ["western"]],
    ["History", ["histor", "period drama", "period", "epic", "medieval"]],
    ["Biography", ["biograph", "biopic"]],
    [
      "Documentary",
      ["documentary", "factual", "popular science", "talk", "news", "nature"],
    ],
    ["Animation", ["animation", "animated", "anime", "cartoon"]],
    ["Music", ["musical", "music television", "dance", "music"]],
    [
      "Family",
      [
        "family",
        "children",
        "kids",
        "teen",
        "youth",
        "coming-of-age",
        "college life",
        "school",
      ],
    ],
    ["Sport", ["sport", "boxing", "football"]],
  ],
};

// ── Games ────────────────────────────────────────────────────────────────
const GAMES: Vocab = {
  files: ["games.csv"],
  order: [
    "Action",
    "Adventure",
    "RPG",
    "Shooter",
    "Platformer",
    "Strategy",
    "Simulation",
    "Puzzle",
    "Fighting",
    "Racing",
    "Horror",
    "Sports",
    "Survival",
    "Roguelike",
    "Stealth",
    "Sandbox",
    "MMO",
    "Card",
    "Rhythm",
    "Fantasy",
    "Sci-Fi",
  ],
  rules: [
    ["Action", ["action", "hack and slash", "run and gun", "arcade"]],
    [
      "Adventure",
      [
        "adventure",
        "point-and-click",
        "graphic adventure",
        "interactive fiction",
        "text-based",
        "metroidvania",
        "immersive sim",
      ],
    ],
    [
      "RPG",
      [
        "role-playing",
        "rpg",
        "dungeon crawl",
        "soulslike",
        "soulsvania",
        "gacha",
        "monster-taming",
      ],
    ],
    ["Shooter", ["shooter", "shoot 'em up", "battle royale"]],
    ["Platformer", ["platform"]],
    [
      "Strategy",
      [
        "strategy",
        "tower defense",
        "multiplayer online battle arena",
        "moba",
        "city-building",
        "construction and management",
      ],
    ],
    [
      "Simulation",
      [
        "simulation",
        "life sim",
        "business sim",
        "flight sim",
        "sim racing",
        "virtual pet",
        "biological sim",
        "space flight",
      ],
    ],
    [
      "Puzzle",
      [
        "puzzle",
        "falling block",
        "tile-matching",
        "sokoban",
        "maze",
        "sudoku",
        "word video",
        "letter game",
        "breakout clone",
        "physics game",
        "tilesweeper",
      ],
    ],
    ["Fighting", ["fighting", "vehicular combat"]],
    ["Racing", ["racing", "kart"]],
    ["Horror", ["horror"]],
    ["Sports", ["sports", "fitness"]],
    ["Survival", ["survival"]],
    [
      "Roguelike",
      [
        "roguelike",
        "roguelite",
        "bullet heaven",
        "metroidbrainia",
        "deck-building",
      ],
    ],
    ["Stealth", ["stealth"]],
    ["Sandbox", ["sandbox", "open world"]],
    ["MMO", ["massively multiplayer", "mmo"]],
    ["Card", ["card", "collectible card"]],
    ["Rhythm", ["rhythm", "music", "dance"]],
    ["Fantasy", ["fantasy"]],
    [
      "Sci-Fi",
      [
        "science fiction",
        "sci-fi",
        "cyberpunk",
        "space opera",
        "post-apocalyptic",
        "dystopia",
        "military science",
        "time travel",
      ],
    ],
  ],
};

// ── Music ────────────────────────────────────────────────────────────────
const MUSIC: Vocab = {
  files: ["music.csv"],
  order: [
    "Rock",
    "Pop",
    "Hip-Hop",
    "Soul",
    "Funk",
    "Jazz",
    "Blues",
    "Country",
    "Folk",
    "Electronic",
    "Reggae",
    "Metal",
    "Punk",
    "Disco",
    "Latin",
    "New Wave",
  ],
  rules: [
    ["Rock", ["rock", "grunge"]],
    [
      "Pop",
      [
        "pop",
        "britpop",
        "easy listening",
        "music hall",
        "traditional pop",
        "stage and screen",
        "beat music",
      ],
    ],
    ["Hip-Hop", ["hip-hop", "hip hop", "rap", "trip hop", "horrorcore"]],
    ["Soul", ["soul", "r&b", "rhythm and blues", "minneapolis sound"]],
    ["Funk", ["funk"]],
    ["Jazz", ["jazz"]],
    ["Blues", ["blues"]],
    ["Country", ["country"]],
    ["Folk", ["folk", "singer-songwriter", "worldbeat"]],
    ["Electronic", ["electronic", "electronica", "techno", "house", "lo-fi"]],
    ["Reggae", ["reggae", "rocksteady", "ska"]],
    ["Metal", ["metal"]],
    ["Punk", ["punk", "hardcore"]],
    ["Disco", ["disco"]],
    ["Latin", ["latin", "chicano"]],
    ["New Wave", ["new wave"]],
  ],
};

const VOCABS: Vocab[] = [SCREEN, GAMES, MUSIC];

function canonicalize(cell: string, v: Vocab): string[] {
  const s = cell.toLowerCase();
  const found = new Set<string>();
  for (const [canon, stems] of v.rules) {
    if (stems.some((st) => s.includes(st))) found.add(canon);
  }
  return v.order.filter((c) => found.has(c));
}

function sanitizeCell(x: string | undefined): string {
  return (x ?? "").replace(/[\r\n]+/g, " ").trim();
}

function run(write: boolean): void {
  for (const v of VOCABS) {
    for (const file of v.files) {
      const full = path.join(DATASETS_DIR, file);
      const res = Papa.parse<Row>(fs.readFileSync(full, "utf8"), {
        header: true,
        skipEmptyLines: true,
      });
      const fields = res.meta.fields ?? [];
      const rows = res.data;

      const dist: Record<string, number> = {};
      const diffs: string[] = [];
      let emptied = 0;

      for (const r of rows) {
        const before = (r.genre ?? "").trim();
        const canon = canonicalize(before, v);
        if (canon.length === 0) {
          emptied++;
          diffs.push(`   UNMATCHED [${before}] — ${r.title ?? ""}`);
        }
        for (const c of canon) dist[c] = (dist[c] ?? 0) + 1;
        const after = canon.join("; ");
        if (after !== before && diffs.length < 12)
          diffs.push(`   "${before.slice(0, 48)}" → "${after}"`);
        r.genre = after;
      }

      console.log(`\n===== ${file}: ${rows.length} rows =====`);
      for (const c of v.order)
        if (dist[c]) console.log(`  ${String(dist[c]).padStart(4)} ${c}`);
      if (emptied) console.log(`  (!) ${emptied} rows produced no genre`);
      for (const d of diffs.slice(0, 8)) console.log(d);

      if (write) {
        const out = Papa.unparse(
          {
            fields,
            data: rows.map((r) => fields.map((c) => sanitizeCell(r[c]))),
          },
          { newline: "\r\n" },
        );
        fs.writeFileSync(full, out + "\r\n", "utf8");
        console.log(`  ✓ wrote ${file}`);
      }
    }
  }
  if (!write) console.log("\nDRY RUN — pass --write to apply.");
}

run(process.argv.includes("--write"));
