/** Post-ASR church term correction. Run: npx tsx src/test/asr-terms.ts */
import { correctAsrTerms, parsePtNumber } from "../churchGlossary.js";

let failed = 0;
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) console.log(`  ✓ ${msg}`);
  else {
    failed += 1;
    console.error(`  ✗ ${msg}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
  }
}

console.log("[ASR terms] numbers");
eq(parsePtNumber("dezesseis"), 16, "dezesseis → 16");
eq(parsePtNumber("cento e dezenove"), 119, "cento e dezenove → 119");
eq(parsePtNumber("vinte e três"), 23, "vinte e três → 23");
eq(parsePtNumber("vinte e trinta"), null, "two tens are not one number");

console.log("[ASR terms] corrections");
eq(correctAsrTerms("leia em joão capítulo três versículo dezesseis", "pt"), "leia em João capítulo 3 versículo 16", "spoken reference becomes digits");
eq(correctAsrTerms("abra em joão 3 versículo dezesseis", "pt"), "abra em João 3 versículo 16", "book with digit chapter + spoken verse");
eq(correctAsrTerms("leia segunda Pedro, 2 Pedro capítulo um", "pt"), "leia segunda Pedro, 2 Pedro capítulo 1", "numbered book");
eq(correctAsrTerms("salmo cento e dezenove", "pt"), "Salmo 119", "psalm number");
eq(correctAsrTerms("a leluia, glória a Deus, a mém", "pt"), "aleluia, glória a Deus, amém", "split words joined");
eq(correctAsrTerms("o espirito santo nos guia", "pt"), "o Espírito Santo nos guia", "accent and capitals");
eq(correctAsrTerms("a carta aos efessios e aos filipensses", "pt"), "a carta aos Efésios e aos Filipenses", "misspelled books");
eq(correctAsrTerms("isaias e genesis", "pt"), "Isaías e Gênesis", "accents restored");

console.log("[ASR terms] leaves normal speech alone");
eq(correctAsrTerms("Amem uns aos outros", "pt"), "Amem uns aos outros", "verb 'amem' is not 'amém'");
eq(correctAsrTerms("que todos amem o Senhor", "pt"), "que todos amem o Senhor", "verb 'amem' mid-sentence");
eq(correctAsrTerms("amem.", "pt"), "amém.", "'amem' said alone is amém");
eq(correctAsrTerms("Judas trinta moedas", "pt"), "Judas trinta moedas", "name + number is not a verse");
eq(correctAsrTerms("Jonas três dias no peixe", "pt"), "Jonas três dias no peixe", "Jonas três dias");
eq(correctAsrTerms("os Salmos 119 e o salmo vinte e três", "pt"), "os Salmos 119 e o Salmo 23", "plural kept, psalm number");
eq(correctAsrTerms("Capítulo três diz", "pt"), "Capítulo 3 diz", "capital at sentence start kept");
eq(correctAsrTerms("A leluia!", "pt"), "Aleluia!", "joined word keeps its capital");
eq(correctAsrTerms("Jesus esteve três dias no túmulo", "pt"), "Jesus esteve três dias no túmulo", "number words without scripture cue stay");
eq(correctAsrTerms("os atos de amor contam", "pt"), "os atos de amor contam", "'atos' without chapter stays lowercase");
eq(correctAsrTerms("um amor que não acaba", "pt"), "um amor que não acaba", "'um' stays a word");
eq(correctAsrTerms("he said amen", "en"), "he said amen", "only Portuguese source is corrected");

console.log("[ASR terms] italian");
const it = (x: string) => correctAsrTerms(x, "it");
eq(it("il libro di anemia"), "il libro di Neemia", "libro di anemia");
eq(it("quando arriva anemia gli dà la forza"), "quando arriva Neemia gli dà la forza", "arriva anemia");
eq(it("anemia dice che"), "Neemia dice che", "anemia dice");
eq(it("anemia era un uomo di fede"), "Neemia era un uomo di fede", "anemia era");
eq(it("ho l'anemia"), "ho l'anemia", "medical anemia stays");
eq(it("l'anemia era grave"), "l'anemia era grave", "l'anemia era stays");
eq(it("la anemia dice poco"), "la anemia dice poco", "article blocks Neemia");
eq(it("soffre di anemia"), "soffre di anemia", "di anemia without libro");
eq(it("suo figlio un incendio nel mondo"), "suo figlio unigenito nel mondo", "unigenito");
eq(it("un incendio nel bosco"), "un incendio nel bosco", "incendio stays");
eq(it("Allogia del Signore"), "La gioia del Signore", "gioia del Signore");
eq(it("sentiamo Allogia del Signore"), "sentiamo la gioia del Signore", "gioia mid-sentence");
eq(it("EE mandatene"), "E mandatene", "EE glitch at start");
eq(it("grazie EA ringraziarti"), "grazie e a ringraziarti", "EA glitch");
eq(it("EI nostri"), "E i nostri", "EI glitch");
eq(it("sia EO chiunque"), "sia e o chiunque", "EO glitch");
eq(it("AA celebrare e AAA chiedermi"), "A celebrare e a chiedermi", "AA / AAA glitch");
eq(it("LODE AL SIGNORE EE AA"), "LODE AL SIGNORE EE AA", "all-caps line untouched");
eq(it("EEE e AB"), "EEE e AB", "other caps tokens untouched");
eq(it("leggiamo filippesi capitolo quattro, versetto quattro"), "leggiamo Filippesi capitolo 4, versetto 4", "book + spoken numbers");
eq(it("capitolo uno. versetti due"), "capitolo 1. versetti 2", "uno / due");
eq(it("capitolo ventuno versetto ventotto"), "capitolo 21 versetto 28", "elided tens");
eq(it("capitolo trentuno"), "capitolo 31", "trentuno");
eq(it("salmo centodiciannove"), "Salmo 119", "centodiciannove");
eq(it("salmi cento"), "Salmi 100", "cento");
eq(it("tre giorni dopo un uomo"), "tre giorni dopo un uomo", "no cue no number");
eq(it("giacomo capitolo due"), "Giacomo capitolo 2", "giacomo with capitolo");
eq(it("giacomo è arrivato"), "giacomo è arrivato", "giacomo name stays");
eq(it("giovanni 3 versetto sedici"), "Giovanni 3 versetto 16", "giovanni + digit");
eq(it("ha visto giovanni ieri"), "ha visto giovanni ieri", "giovanni name stays");
eq(it("genesi, esodo, levitico e deuteronomio"), "Genesi, Esodo, Levitico e Deuteronomio", "pentateuch");
eq(it("neemia, isaia, geremia, ezechiele, matteo, timoteo, apocalisse"), "Neemia, Isaia, Geremia, Ezechiele, Matteo, Timoteo, Apocalisse", "books");
eq(it("salmo 23 e proverbi 3"), "Salmo 23 e Proverbi 3", "salmo/proverbi + digit");
eq(it("i proverbi dei nonni"), "i proverbi dei nonni", "common noun proverbi");
eq(it("la lettera ai romani e romani 8"), "la lettera ai Romani e Romani 8", "romani");
eq(it("i romani antichi e gli ebrei"), "i romani antichi e gli ebrei", "peoples stay");
eq(it("corinzi 13 e lettera ai galati"), "Corinzi 13 e lettera ai Galati", "corinzi/galati");
eq(it("Amen"), "Amen", "amen not amém");
eq(it("a leluia"), "a leluia", "no pt fixes in italian");
if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll ASR term checks passed.");
