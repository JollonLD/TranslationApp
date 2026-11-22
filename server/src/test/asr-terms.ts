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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll ASR term checks passed.");
