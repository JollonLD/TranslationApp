import type { LanguageCode } from "./types.js";

type LangMap = Partial<Record<LanguageCode, string>>;

export type GlossaryEntry = {
  match: RegExp;
  to: LangMap;
};

/**
 * Evangelical / biblical glossary for live sermon translation.
 * Sources adapted from common PT evangelical usage and Gospel Translations
 * (gospeltranslations.org) / Fé Viva Christian glossary themes.
 * Longer phrases first so they win over single-word matches.
 */
export const PHRASE_GLOSSARY: GlossaryEntry[] = [
  // —— Scripture & books ——
  {
    match: /\bsagrada escritura\b/gi,
    to: {
      en: "Holy Scripture",
      es: "Sagrada Escritura",
      it: "Sacra Scrittura",
      fa: "کتاب مقدس",
      ur: "مقدس کلام",
    },
  },
  {
    match: /\bpalavra de deus\b/gi,
    to: {
      en: "the Word of God",
      es: "la Palabra de Dios",
      it: "la Parola di Dio",
      fa: "کلام خدا",
      ur: "خدا کا کلام",
    },
  },
  {
    match: /\bestudo b[ií]blico\b/gi,
    to: {
      en: "Bible study",
      es: "estudio bíblico",
      it: "studio biblico",
      fa: "مطالعه کتاب مقدس",
      ur: "بائبل کا مطالعہ",
    },
  },
  {
    match: /\bleitura b[ií]blica\b/gi,
    to: {
      en: "Bible reading",
      es: "lectura bíblica",
      it: "lettura biblica",
      fa: "خواندن کتاب مقدس",
      ur: "بائبل کی تلاوت",
    },
  },
  {
    match: /\bvers[ií]culo\b/gi,
    to: {
      en: "verse",
      es: "versículo",
      it: "versetto",
      fa: "آیه",
      ur: "آیت",
    },
  },
  {
    match: /\bb[ií]blia sagrada\b/gi,
    to: {
      en: "Holy Bible",
      es: "Santa Biblia",
      it: "Sacra Bibbia",
      fa: "کتاب مقدس",
      ur: "مقدس بائبل",
    },
  },
  {
    match: /\bb[ií]blia\b/gi,
    to: {
      en: "Bible",
      es: "Biblia",
      it: "Bibbia",
      fa: "کتاب مقدس",
      ur: "بائبل",
    },
  },
  {
    match: /\bescrituras?\b/gi,
    to: {
      en: "Scriptures",
      es: "Escrituras",
      it: "Scritture",
      fa: "کتاب‌های مقدس",
      ur: "مقدس تحریریں",
    },
  },
  {
    match: /\bantigo testamento\b/gi,
    to: {
      en: "Old Testament",
      es: "Antiguo Testamento",
      it: "Antico Testamento",
      fa: "عهد عتیق",
      ur: "پرانا عہدنامہ",
    },
  },
  {
    match: /\bnovo testamento\b/gi,
    to: {
      en: "New Testament",
      es: "Nuevo Testamento",
      it: "Nuovo Testamento",
      fa: "عهد جدید",
      ur: "نیا عہدنامہ",
    },
  },

  // —— Core gospel phrases ——
  {
    match: /\ba paz do senhor\b/gi,
    to: {
      en: "the peace of the Lord",
      es: "la paz del Señor",
      it: "la pace del Signore",
      fa: "صلح خداوند",
      ur: "خداوند کی سلامتی",
    },
  },
  {
    match: /\bgl[oó]ria a deus\b/gi,
    to: {
      en: "glory to God",
      es: "gloria a Dios",
      it: "gloria a Dio",
      fa: "جلال بر خدا",
      ur: "خدا کی تمجید",
    },
  },
  {
    match: /\bvamos orar\b/gi,
    to: {
      en: "let us pray",
      es: "oremos",
      it: "preghiamo",
      fa: "بیایید دعا کنیم",
      ur: "آئیے دعا کریں",
    },
  },
  {
    match: /\babrir o cora[cç][aã]o\b/gi,
    to: {
      en: "open your heart",
      es: "abrir el corazón",
      it: "aprire il cuore",
      fa: "دل خود را بگشایید",
      ur: "دل کھولیں",
    },
  },
  {
    match: /\besp[ií]rito santo\b/gi,
    to: {
      en: "Holy Spirit",
      es: "Espíritu Santo",
      it: "Spirito Santo",
      fa: "روح‌القدس",
      ur: "روح القدس",
    },
  },
  {
    match: /\bsanto esp[ií]rito\b/gi,
    to: {
      en: "Holy Spirit",
      es: "Espíritu Santo",
      it: "Spirito Santo",
      fa: "روح‌القدس",
      ur: "روح القدس",
    },
  },
  {
    match: /\birmãos e irmãs\b/gi,
    to: {
      en: "brothers and sisters",
      es: "hermanos y hermanas",
      it: "fratelli e sorelle",
      fa: "برادران و خواهران",
      ur: "بھائیو اور بہنو",
    },
  },
  {
    match: /\bceia do senhor\b/gi,
    to: {
      en: "the Lord's Supper",
      es: "la Cena del Señor",
      it: "la Cena del Signore",
      fa: "شام خداوند",
      ur: "خداوند کی عشائے ربانی",
    },
  },
  {
    match: /\bsanta ceia\b/gi,
    to: {
      en: "Holy Communion",
      es: "Santa Cena",
      it: "Santa Cena",
      fa: "عشای ربانی",
      ur: "مقدس عشائے ربانی",
    },
  },
  {
    match: /\breino de deus\b/gi,
    to: {
      en: "kingdom of God",
      es: "reino de Dios",
      it: "regno di Dio",
      fa: "پادشاهی خدا",
      ur: "خدا کی بادشاہی",
    },
  },
  {
    match: /\breino dos c[eé]us\b/gi,
    to: {
      en: "kingdom of heaven",
      es: "reino de los cielos",
      it: "regno dei cieli",
      fa: "پادشاهی آسمان",
      ur: "آسمان کی بادشاہی",
    },
  },
  {
    match: /\bfilho de deus\b/gi,
    to: {
      en: "Son of God",
      es: "Hijo de Dios",
      it: "Figlio di Dio",
      fa: "پسر خدا",
      ur: "خدا کا بیٹا",
    },
  },
  {
    match: /\bsegunda vinda\b/gi,
    to: {
      en: "second coming",
      es: "segunda venida",
      it: "seconda venuta",
      fa: "آمد دوباره",
      ur: "دوسری آمد",
    },
  },
  {
    match: /\bvida eterna\b/gi,
    to: {
      en: "eternal life",
      es: "vida eterna",
      it: "vita eterna",
      fa: "زندگی ابدی",
      ur: "ابدی زندگی",
    },
  },
  {
    match: /\bnova alian[cç]a\b/gi,
    to: {
      en: "new covenant",
      es: "nuevo pacto",
      it: "nuova alleanza",
      fa: "عهد جدید",
      ur: "نیا عہد",
    },
  },

  // —— Theology & faith life (single / short) ——
  {
    match: /\barrependimento\b/gi,
    to: {
      en: "repentance",
      es: "arrepentimiento",
      it: "ravvedimento",
      fa: "توبه",
      ur: "توبہ",
    },
  },
  {
    match: /\bjustifica[cç][aã]o\b/gi,
    to: {
      en: "justification",
      es: "justificación",
      it: "giustificazione",
      fa: "توجیه",
      ur: "برأت",
    },
  },
  {
    match: /\bsantifica[cç][aã]o\b/gi,
    to: {
      en: "sanctification",
      es: "santificación",
      it: "santificazione",
      fa: "تقدیس",
      ur: "تقدیس",
    },
  },
  {
    match: /\bsalva[cç][aã]o\b/gi,
    to: {
      en: "salvation",
      es: "salvación",
      it: "salvezza",
      fa: "نجات",
      ur: "نجات",
    },
  },
  {
    match: /\breden[cç][aã]o\b/gi,
    to: {
      en: "redemption",
      es: "redención",
      it: "redenzione",
      fa: "فدیه",
      ur: "فدیہ",
    },
  },
  {
    match: /\bexpia[cç][aã]o\b/gi,
    to: {
      en: "atonement",
      es: "expiación",
      it: "espiazione",
      fa: "کفارہ",
      ur: "کفارہ",
    },
  },
  {
    match: /\bpredestina[cç][aã]o\b/gi,
    to: {
      en: "predestination",
      es: "predestinación",
      it: "predestinazione",
      fa: "تقدیر ازلی",
      ur: "پیش مقدر ہونا",
    },
  },
  {
    match: /\bevangelismo\b/gi,
    to: {
      en: "evangelism",
      es: "evangelismo",
      it: "evangelizzazione",
      fa: "بشارت",
      ur: "انجیلی رسالت",
    },
  },
  {
    match: /\bdiscipulado\b/gi,
    to: {
      en: "discipleship",
      es: "discipulado",
      it: "discepolato",
      fa: "شاگردسازی",
      ur: "شاگردی",
    },
  },
  {
    match: /\bintercess[aã]o\b/gi,
    to: {
      en: "intercession",
      es: "intercesión",
      it: "intercessione",
      fa: "شفاعت دعا",
      ur: "شفاعت",
    },
  },
  {
    match: /\btestemunho\b/gi,
    to: {
      en: "testimony",
      es: "testimonio",
      it: "testimonianza",
      fa: "شهادت",
      ur: "گواہی",
    },
  },
  {
    match: /\btrindade\b/gi,
    to: {
      en: "Trinity",
      es: "Trinidad",
      it: "Trinità",
      fa: "تثلیث",
      ur: "تثلیث",
    },
  },
  {
    match: /\bali[aа]n[cç]a\b/gi,
    to: {
      en: "covenant",
      es: "pacto",
      it: "alleanza",
      fa: "عهد",
      ur: "عہد",
    },
  },
  {
    match: /\bun[cç][aã]o\b/gi,
    to: {
      en: "anointing",
      es: "unción",
      it: "unzione",
      fa: "مسح",
      ur: "مسح",
    },
  },
  {
    match: /\bbatismo\b/gi,
    to: {
      en: "baptism",
      es: "bautismo",
      it: "battesimo",
      fa: "تعمید",
      ur: "بپتسمہ",
    },
  },
  {
    match: /\bressurrei[cç][aã]o\b/gi,
    to: {
      en: "resurrection",
      es: "resurrección",
      it: "risurrezione",
      fa: "رستاخیز",
      ur: "قیامت",
    },
  },
  {
    match: /\bcrucifica[cç][aã]o\b/gi,
    to: {
      en: "crucifixion",
      es: "crucifixión",
      it: "crocifissione",
      fa: "صلیب",
      ur: "صلیبی موت",
    },
  },
  {
    match: /\bperd[aã]o\b/gi,
    to: {
      en: "forgiveness",
      es: "perdón",
      it: "perdono",
      fa: "آمرزش",
      ur: "معافی",
    },
  },
  {
    match: /\bgra[cç]a\b/gi,
    to: {
      en: "grace",
      es: "gracia",
      it: "grazia",
      fa: "فیض",
      ur: "فضل",
    },
  },
  {
    match: /\bf[eé]\b/gi,
    to: {
      en: "faith",
      es: "fe",
      it: "fede",
      fa: "ایمان",
      ur: "ایمان",
    },
  },
  {
    match: /\bpecado\b/gi,
    to: {
      en: "sin",
      es: "pecado",
      it: "peccato",
      fa: "گناه",
      ur: "گناہ",
    },
  },
  {
    match: /\bavivamento\b/gi,
    to: {
      en: "revival",
      es: "avivamiento",
      it: "risveglio",
      fa: "بیداری روحانی",
      ur: "روحانی بیداری",
    },
  },
  {
    match: /\badora[cç][aã]o\b/gi,
    to: {
      en: "worship",
      es: "adoración",
      it: "adorazione",
      fa: "پرستش",
      ur: "عبادت",
    },
  },
  {
    match: /\blouvor\b/gi,
    to: { en: "worship", es: "alabanza", it: "lode", fa: "پرستش", ur: "عبادت" },
  },
  {
    match: /\bora[cç][aã]o\b/gi,
    to: { en: "prayer", es: "oración", it: "preghiera", fa: "دعا", ur: "دعا" },
  },
  {
    match: /\bevangelho\b/gi,
    to: { en: "gospel", es: "evangelio", it: "vangelo", fa: "انجیل", ur: "انجیل" },
  },
  {
    match: /\bigreja\b/gi,
    to: { en: "church", es: "iglesia", it: "chiesa", fa: "کلیسا", ur: "کلیسا" },
  },
  {
    match: /\bculto\b/gi,
    to: { en: "service", es: "culto", it: "culto", fa: "عبادت", ur: "عبادت" },
  },
  {
    match: /\bpastor\b/gi,
    to: { en: "pastor", es: "pastor", it: "pastore", fa: "شبان", ur: "پادری" },
  },
  {
    match: /\bpregador\b/gi,
    to: {
      en: "preacher",
      es: "predicador",
      it: "predicatore",
      fa: "واعظ",
      ur: "واعظ",
    },
  },
  {
    match: /\bserm[aã]o\b/gi,
    to: {
      en: "sermon",
      es: "sermón",
      it: "sermone",
      fa: "موعظه",
      ur: "خطبہ",
    },
  },
  {
    match: /\bmensagem\b/gi,
    to: {
      en: "message",
      es: "mensaje",
      it: "messaggio",
      fa: "پیام",
      ur: "پیغام",
    },
  },
  {
    match: /\bcrente\b/gi,
    to: {
      en: "believer",
      es: "creyente",
      it: "credente",
      fa: "مؤمن",
      ur: "مومن",
    },
  },
  {
    match: /\bdisc[ií]pulo\b/gi,
    to: {
      en: "disciple",
      es: "discípulo",
      it: "discepolo",
      fa: "شاگرد",
      ur: "شاگرد",
    },
  },
  {
    match: /\bprofeta\b/gi,
    to: {
      en: "prophet",
      es: "profeta",
      it: "profeta",
      fa: "پیامبر",
      ur: "نبی",
    },
  },
  {
    match: /\bap[oó]stolo\b/gi,
    to: {
      en: "apostle",
      es: "apóstol",
      it: "apostolo",
      fa: "رسول",
      ur: "رسول",
    },
  },
  {
    match: /\banjo\b/gi,
    to: {
      en: "angel",
      es: "ángel",
      it: "angelo",
      fa: "فرشته",
      ur: "فرشتہ",
    },
  },
  {
    match: /\bdiabo\b/gi,
    to: {
      en: "devil",
      es: "diablo",
      it: "diavolo",
      fa: "شیطان",
      ur: "شیطان",
    },
  },
  {
    match: /\bsat[aá]n[aá]s\b/gi,
    to: {
      en: "Satan",
      es: "Satanás",
      it: "Satana",
      fa: "شیطان",
      ur: "شیطان",
    },
  },
  {
    match: /\binferno\b/gi,
    to: {
      en: "hell",
      es: "infierno",
      it: "inferno",
      fa: "جهنم",
      ur: "جہنم",
    },
  },
  {
    match: /\bc[eé]u\b/gi,
    to: {
      en: "heaven",
      es: "cielo",
      it: "cielo",
      fa: "آسمان",
      ur: "آسمان",
    },
  },
  {
    match: /\bcruz\b/gi,
    to: {
      en: "cross",
      es: "cruz",
      it: "croce",
      fa: "صلیب",
      ur: "صلیب",
    },
  },
  {
    match: /\bmilagre\b/gi,
    to: {
      en: "miracle",
      es: "milagro",
      it: "miracolo",
      fa: "معجزه",
      ur: "معجزہ",
    },
  },
  {
    match: /\bpar[aá]bola\b/gi,
    to: {
      en: "parable",
      es: "parábola",
      it: "parabola",
      fa: "مثل",
      ur: "تمثیل",
    },
  },
  {
    match: /\bd[ií]zimo\b/gi,
    to: {
      en: "tithe",
      es: "diezmo",
      it: "decima",
      fa: "ده یک",
      ur: "دسواں حصہ",
    },
  },
  {
    match: /\boferta\b/gi,
    to: {
      en: "offering",
      es: "ofrenda",
      it: "offerta",
      fa: "هدیه",
      ur: "نذرانہ",
    },
  },
  {
    match: /\bminist[eé]rio\b/gi,
    to: {
      en: "ministry",
      es: "ministerio",
      it: "ministero",
      fa: "خدمت",
      ur: "خدمت",
    },
  },
  {
    match: /\bmissa?o\b/gi,
    to: {
      en: "mission",
      es: "misión",
      it: "missione",
      fa: "رسالت",
      ur: "مہم",
    },
  },
  {
    match: /\birm[aã]os\b/gi,
    to: {
      en: "brothers and sisters",
      es: "hermanos",
      it: "fratelli",
      fa: "برادران",
      ur: "بھائیو",
    },
  },
  {
    match: /\bam[eé]m\b/gi,
    to: { en: "amen", es: "amén", it: "amen", fa: "آمین", ur: "آمین" },
  },
  {
    match: /\baleluia\b/gi,
    to: { en: "hallelujah", es: "aleluya", it: "alleluia", fa: "هللویاه", ur: "ہللویاہ" },
  },
];

export const SINGLE_GLOSSARY: Record<string, LangMap> = {
  irmãos: { en: "brothers and sisters", es: "hermanos", it: "fratelli", fa: "برادران", ur: "بھائیو" },
  irmãs: { en: "sisters", es: "hermanas", it: "sorelle", fa: "خواهران", ur: "بہنیں" },
  pastor: { en: "pastor", es: "pastor", it: "pastore", fa: "شبان", ur: "پادری" },
  louvor: { en: "worship", es: "alabanza", it: "lode", fa: "پرستش", ur: "عبادت" },
  culto: { en: "service", es: "culto", it: "culto", fa: "عبادت", ur: "عبادت" },
  oração: { en: "prayer", es: "oración", it: "preghiera", fa: "دعا", ur: "دعا" },
  evangelho: { en: "gospel", es: "evangelio", it: "vangelo", fa: "انجیل", ur: "انجیل" },
  igreja: { en: "church", es: "iglesia", it: "chiesa", fa: "کلیسا", ur: "کلیسا" },
  amém: { en: "amen", es: "amén", it: "amen", fa: "آمین", ur: "آمین" },
  aleluia: { en: "hallelujah", es: "aleluya", it: "alleluia", fa: "هللویاه", ur: "ہللویاہ" },
  bíblia: { en: "Bible", es: "Biblia", it: "Bibbia", fa: "کتاب مقدس", ur: "بائبل" },
  biblia: { en: "Bible", es: "Biblia", it: "Bibbia", fa: "کتاب مقدس", ur: "بائبل" },
  versículo: { en: "verse", es: "versículo", it: "versetto", fa: "آیه", ur: "آیت" },
  versiculo: { en: "verse", es: "versículo", it: "versetto", fa: "آیه", ur: "آیت" },
  graça: { en: "grace", es: "gracia", it: "grazia", fa: "فیض", ur: "فضل" },
  graca: { en: "grace", es: "gracia", it: "grazia", fa: "فیض", ur: "فضل" },
  fé: { en: "faith", es: "fe", it: "fede", fa: "ایمان", ur: "ایمان" },
  fe: { en: "faith", es: "fe", it: "fede", fa: "ایمان", ur: "ایمان" },
  pecado: { en: "sin", es: "pecado", it: "peccato", fa: "گناه", ur: "گناہ" },
  salvação: { en: "salvation", es: "salvación", it: "salvezza", fa: "نجات", ur: "نجات" },
  salvacao: { en: "salvation", es: "salvación", it: "salvezza", fa: "نجات", ur: "نجات" },
  crente: { en: "believer", es: "creyente", it: "credente", fa: "مؤمن", ur: "مومن" },
  discípulo: { en: "disciple", es: "discípulo", it: "discepolo", fa: "شاگرد", ur: "شاگرد" },
  discipulo: { en: "disciple", es: "discípulo", it: "discepolo", fa: "شاگرد", ur: "شاگرد" },
  sermão: { en: "sermon", es: "sermón", it: "sermone", fa: "موعظه", ur: "خطبہ" },
  sermao: { en: "sermon", es: "sermón", it: "sermone", fa: "موعظه", ur: "خطبہ" },
};

/** Portuguese Bible book names → target language (common spoken forms + abbreviations). */
const BIBLE_BOOKS: Array<{ match: RegExp; to: LangMap }> = [
  { match: /\bg[eê]nesis\b/gi, to: { en: "Genesis", es: "Génesis", it: "Genesi", fa: "پیدایش", ur: "پیدائش" } },
  { match: /\b[eê]xodo\b/gi, to: { en: "Exodus", es: "Éxodo", it: "Esodo", fa: "خروج", ur: "خروج" } },
  { match: /\blev[ií]tico\b/gi, to: { en: "Leviticus", es: "Levítico", it: "Levitico", fa: "لاویان", ur: "احبار" } },
  { match: /\bn[uú]meros\b/gi, to: { en: "Numbers", es: "Números", it: "Numeri", fa: "اعداد", ur: "گنتی" } },
  { match: /\bdeuteron[oô]mio\b/gi, to: { en: "Deuteronomy", es: "Deuteronomio", it: "Deuteronomio", fa: "تثنیه", ur: "استثنا" } },
  { match: /\bjosu[eé]\b/gi, to: { en: "Joshua", es: "Josué", it: "Giosuè", fa: "یوشع", ur: "یشوع" } },
  { match: /\bju[ií]zes\b/gi, to: { en: "Judges", es: "Jueces", it: "Giudici", fa: "داوران", ur: "قضاۃ" } },
  { match: /\brute\b/gi, to: { en: "Ruth", es: "Rut", it: "Rut", fa: "روت", ur: "روت" } },
  { match: /\b1\s*samuel\b/gi, to: { en: "1 Samuel", es: "1 Samuel", it: "1 Samuele", fa: "اول سموئیل", ur: "۱ سموئیل" } },
  { match: /\b2\s*samuel\b/gi, to: { en: "2 Samuel", es: "2 Samuel", it: "2 Samuele", fa: "دوم سموئیل", ur: "۲ سموئیل" } },
  { match: /\b1\s*reis\b/gi, to: { en: "1 Kings", es: "1 Reyes", it: "1 Re", fa: "اول پادشاهان", ur: "۱ سلاطین" } },
  { match: /\b2\s*reis\b/gi, to: { en: "2 Kings", es: "2 Reyes", it: "2 Re", fa: "دوم پادشاهان", ur: "۲ سلاطین" } },
  { match: /\b1\s*cr[oô]nicas\b/gi, to: { en: "1 Chronicles", es: "1 Crónicas", it: "1 Cronache", fa: "اول تواریخ", ur: "۱ تواریخ" } },
  { match: /\b2\s*cr[oô]nicas\b/gi, to: { en: "2 Chronicles", es: "2 Crónicas", it: "2 Cronache", fa: "دوم تواریخ", ur: "۲ تواریخ" } },
  { match: /\besdras\b/gi, to: { en: "Ezra", es: "Esdras", it: "Esdra", fa: "عزرا", ur: "عزرا" } },
  { match: /\bneemias\b/gi, to: { en: "Nehemiah", es: "Nehemías", it: "Neemia", fa: "نحمیا", ur: "نحمیاہ" } },
  { match: /\bester\b/gi, to: { en: "Esther", es: "Ester", it: "Ester", fa: "استر", ur: "استر" } },
  { match: /\bjó\b/gi, to: { en: "Job", es: "Job", it: "Giobbe", fa: "ایوب", ur: "ایوب" } },
  { match: /\bsalmos?\b/gi, to: { en: "Psalms", es: "Salmos", it: "Salmi", fa: "مزامیر", ur: "زبور" } },
  { match: /\bprov[eé]rbios\b/gi, to: { en: "Proverbs", es: "Proverbios", it: "Proverbi", fa: "امثال", ur: "امثال" } },
  { match: /\beclesiastes\b/gi, to: { en: "Ecclesiastes", es: "Eclesiastés", it: "Ecclesiaste", fa: "جامعه", ur: "واعظ" } },
  { match: /\bc[aâ]nticos?\b/gi, to: { en: "Song of Songs", es: "Cantares", it: "Cantico", fa: "غزل غزل‌ها", ur: "غزل الغزلات" } },
  { match: /\bisa[ií]as\b/gi, to: { en: "Isaiah", es: "Isaías", it: "Isaia", fa: "اشعیا", ur: "اشعیاء" } },
  { match: /\bjeremias\b/gi, to: { en: "Jeremiah", es: "Jeremías", it: "Geremia", fa: "ارمیا", ur: "یرمیاہ" } },
  { match: /\blamenta[cç][oõ]es\b/gi, to: { en: "Lamentations", es: "Lamentaciones", it: "Lamentazioni", fa: "مراثی", ur: "نوحہ" } },
  { match: /\bezed?quiel\b/gi, to: { en: "Ezekiel", es: "Ezequiel", it: "Ezechiele", fa: "حزقیال", ur: "حزقی ایل" } },
  { match: /\bdaniel\b/gi, to: { en: "Daniel", es: "Daniel", it: "Daniele", fa: "دانیال", ur: "دانیال" } },
  { match: /\bos[eé]ias\b/gi, to: { en: "Hosea", es: "Oseas", it: "Osea", fa: "هوشع", ur: "ہوسیع" } },
  { match: /\bjoel\b/gi, to: { en: "Joel", es: "Joel", it: "Gioele", fa: "یوئیل", ur: "یوایل" } },
  { match: /\bam[oó]s\b/gi, to: { en: "Amos", es: "Amós", it: "Amos", fa: "عاموس", ur: "عاموس" } },
  { match: /\bobadias\b/gi, to: { en: "Obadiah", es: "Abdías", it: "Abdia", fa: "عوبدیا", ur: "عبدیاہ" } },
  { match: /\bjonas\b/gi, to: { en: "Jonah", es: "Jonás", it: "Giona", fa: "یونس", ur: "یونس" } },
  { match: /\bmiqu[eé]ias\b/gi, to: { en: "Micah", es: "Miqueas", it: "Michea", fa: "میکاه", ur: "میکاہ" } },
  { match: /\bnaum\b/gi, to: { en: "Nahum", es: "Nahúm", it: "Naum", fa: "ناحوم", ur: "نحوم" } },
  { match: /\bhabacuque\b/gi, to: { en: "Habakkuk", es: "Habacuc", it: "Abacuc", fa: "حبقوق", ur: "حبقوق" } },
  { match: /\bsofonias\b/gi, to: { en: "Zephaniah", es: "Sofonías", it: "Sofonia", fa: "صفنیا", ur: "صفنیاہ" } },
  { match: /\bageu\b/gi, to: { en: "Haggai", es: "Hageo", it: "Aggeo", fa: "حجی", ur: "حجی" } },
  { match: /\bzaca?rias\b/gi, to: { en: "Zechariah", es: "Zacarías", it: "Zaccaria", fa: "زکریا", ur: "زکریاہ" } },
  { match: /\bmalad?quias\b/gi, to: { en: "Malachi", es: "Malaquías", it: "Malachia", fa: "ملاکی", ur: "ملاکی" } },
  { match: /\bmateus\b/gi, to: { en: "Matthew", es: "Mateo", it: "Matteo", fa: "متی", ur: "متی" } },
  { match: /\bmarcos\b/gi, to: { en: "Mark", es: "Marcos", it: "Marco", fa: "مرقس", ur: "مرقس" } },
  { match: /\blucas\b/gi, to: { en: "Luke", es: "Lucas", it: "Luca", fa: "لوقا", ur: "لوقا" } },
  { match: /\bjo[aã]o\b/gi, to: { en: "John", es: "Juan", it: "Giovanni", fa: "یوحنا", ur: "یوحنا" } },
  { match: /\batos(?:\s+dos\s+ap[oó]stolos)?\b/gi, to: { en: "Acts", es: "Hechos", it: "Atti", fa: "اعمال", ur: "اعمال" } },
  { match: /\bromanos\b/gi, to: { en: "Romans", es: "Romanos", it: "Romani", fa: "رومیان", ur: "رومیوں" } },
  { match: /\b1\s*cor[ií]ntios\b/gi, to: { en: "1 Corinthians", es: "1 Corintios", it: "1 Corinzi", fa: "اول قرنتیان", ur: "۱ کرنتھیوں" } },
  { match: /\b2\s*cor[ií]ntios\b/gi, to: { en: "2 Corinthians", es: "2 Corintios", it: "2 Corinzi", fa: "دوم قرنتیان", ur: "۲ کرنتھیوں" } },
  { match: /\bg[aá]latas\b/gi, to: { en: "Galatians", es: "Gálatas", it: "Galati", fa: "غلاطیان", ur: "گلتیوں" } },
  { match: /\bef[eé]sios\b/gi, to: { en: "Ephesians", es: "Efesios", it: "Efesini", fa: "افسسیان", ur: "افسیوں" } },
  { match: /\bfilipenses\b/gi, to: { en: "Philippians", es: "Filipenses", it: "Filippesi", fa: "فیلیپیان", ur: "فلپیوں" } },
  { match: /\bcolossenses\b/gi, to: { en: "Colossians", es: "Colosenses", it: "Colossesi", fa: "کولسیان", ur: "کولسیوں" } },
  { match: /\b1\s*tessalonicenses\b/gi, to: { en: "1 Thessalonians", es: "1 Tesalonicenses", it: "1 Tessalonicesi", fa: "اول تسالونیکیان", ur: "۱ تھسلنیکیوں" } },
  { match: /\b2\s*tessalonicenses\b/gi, to: { en: "2 Thessalonians", es: "2 Tesalonicenses", it: "2 Tessalonicesi", fa: "دوم تسالونیکیان", ur: "۲ تھسلنیکیوں" } },
  { match: /\b1\s*tim[oó]teo\b/gi, to: { en: "1 Timothy", es: "1 Timoteo", it: "1 Timoteo", fa: "اول تیموتائوس", ur: "۱ تیمتھیس" } },
  { match: /\b2\s*tim[oó]teo\b/gi, to: { en: "2 Timothy", es: "2 Timoteo", it: "2 Timoteo", fa: "دوم تیموتائوس", ur: "۲ تیمتھیس" } },
  { match: /\btito\b/gi, to: { en: "Titus", es: "Tito", it: "Tito", fa: "تیطس", ur: "طیطس" } },
  { match: /\bfil[eê]mon\b/gi, to: { en: "Philemon", es: "Filemón", it: "Filemone", fa: "فلیمون", ur: "فلیمون" } },
  { match: /\bhebreus\b/gi, to: { en: "Hebrews", es: "Hebreos", it: "Ebrei", fa: "عبرانیان", ur: "عبرانیوں" } },
  { match: /\btiago\b/gi, to: { en: "James", es: "Santiago", it: "Giacomo", fa: "یعقوب", ur: "یعقوب" } },
  { match: /\b1\s*pedro\b/gi, to: { en: "1 Peter", es: "1 Pedro", it: "1 Pietro", fa: "اول پطرس", ur: "۱ پطرس" } },
  { match: /\b2\s*pedro\b/gi, to: { en: "2 Peter", es: "2 Pedro", it: "2 Pietro", fa: "دوم پطرس", ur: "۲ پطرس" } },
  { match: /\b1\s*jo[aã]o\b/gi, to: { en: "1 John", es: "1 Juan", it: "1 Giovanni", fa: "اول یوحنا", ur: "۱ یوحنا" } },
  { match: /\b2\s*jo[aã]o\b/gi, to: { en: "2 John", es: "2 Juan", it: "2 Giovanni", fa: "دوم یوحنا", ur: "۲ یوحنا" } },
  { match: /\b3\s*jo[aã]o\b/gi, to: { en: "3 John", es: "3 Juan", it: "3 Giovanni", fa: "سوم یوحنا", ur: "۳ یوحنا" } },
  // Book of Jude when a chapter follows (“Judas 1”); keep “Judas” alone as the person
  { match: /\bjudas\b(?=\s+\d)/gi, to: { en: "Jude", es: "Judas", it: "Giuda", fa: "یهودا", ur: "یہوداہ" } },
  { match: /\bapocalipse\b/gi, to: { en: "Revelation", es: "Apocalipsis", it: "Apocalisse", fa: "مکاشفه", ur: "مکاشفہ" } },
];

/** Detect “João 3:16”, “Salmo 23”, “1 Coríntios 13.4” style references. */
const VERSE_REF =
  /\b((?:1|2|3)\s*)?([A-Za-zÀ-ú]{2,}(?:\s+[A-Za-zÀ-ú]+){0,3})\s+(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/g;

export function glossaryExact(text: string, target: LanguageCode): string | null {
  const key = text.trim().toLowerCase().replace(/[.,!?…]+$/g, "");
  return SINGLE_GLOSSARY[key]?.[target] ?? null;
}

export function polishChurchTerms(translated: string, target: LanguageCode) {
  let result = translated;
  for (const entry of BIBLE_BOOKS) {
    const replacement = entry.to[target];
    if (!replacement) continue;
    result = result.replace(entry.match, replacement);
  }
  for (const entry of PHRASE_GLOSSARY) {
    const replacement = entry.to[target];
    if (!replacement) continue;
    result = result.replace(entry.match, replacement);
  }
  return result;
}

/** Normalize spoken Portuguese Bible cues before machine translation. */
export function prepareChurchSource(text: string, source: LanguageCode) {
  let out = text.trim().replace(/\s+/g, " ");
  if (source !== "pt") return out;

  out = out
    .replace(/\bvc\b/gi, "você")
    .replace(/\bpq\b/gi, "porque")
    .replace(/\btb\b/gi, "também")
    .replace(/\bdeus\b/gi, "Deus")
    .replace(/\bsenhor\b/gi, "Senhor")
    .replace(/\bjesus\b/gi, "Jesus")
    .replace(/\bcristo\b/gi, "Cristo")
    .replace(/\bb[ií]blia\b/gi, "Bíblia")
    .replace(/\bvers[ií]culo\b/gi, "versículo")
    .replace(/\bes[cç]ritura(?:s)?\b/gi, "Escritura")
    .replace(/\bpalavra\s+de\s+deus\b/gi, "Palavra de Deus")
    .replace(/\besp[ií]rito\s+santo\b/gi, "Espírito Santo");

  // Normalize verse punctuation: “João 3 16” / “João 3.16” → “João 3:16”
  out = out.replace(
    /\b((?:1|2|3)\s*)?([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,2})\s+(\d{1,3})\s+(?=\d{1,3}\b)/gi,
    "$1$2 $3:",
  );
  out = out.replace(
    /\b((?:1|2|3)\s*)?([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,2})\s+(\d{1,3})\s*[.]\s*(\d{1,3})\b/gi,
    "$1$2 $3:$4",
  );

  return out;
}

export function looksLikeScriptureTalk(text: string) {
  if (VERSE_REF.test(text)) return true;
  VERSE_REF.lastIndex = 0;
  return /\b(b[ií]blia|vers[ií]culo|escritura|palavra\s+de\s+deus|evangelho|salmo|g[eê]nesis|mateus|jo[aã]o|apocalipse|cap[ií]tulo)\b/i.test(
    text,
  );
}

export function translateBibleBooks(text: string, target: LanguageCode) {
  let result = text;
  for (const entry of BIBLE_BOOKS) {
    const replacement = entry.to[target];
    if (!replacement) continue;
    result = result.replace(entry.match, replacement);
  }
  return result;
}

// —— Post-ASR correction (source side, before the tape is translated) ——

/** Bible books Whisper often writes without accents or with a split word. */
const ASR_BOOKS: Array<[RegExp, string]> = [
  [/\bg[eê]nesis\b/gi, "Gênesis"],
  [/\b[eê]xodo\b/gi, "Êxodo"],
  [/\blev[ií]tico\b/gi, "Levítico"],
  [/\bdeuteron[oô]mio\b/gi, "Deuteronômio"],
  [/\bjosu[eé]\b/gi, "Josué"],
  [/\bju[ií]zes\b(?=\s+\d)/gi, "Juízes"],
  [/\bcr[oô]nicas\b/gi, "Crônicas"],
  [/\bneemias\b/gi, "Neemias"],
  [/\bprov[eé]rbios\b/gi, "Provérbios"],
  [/\beclesiastes\b/gi, "Eclesiastes"],
  [/\bisa[ií]as\b/gi, "Isaías"],
  [/\blamenta[cç][oõ]es\b(?=\s+\d)/gi, "Lamentações"],
  [/\bos[eé]ias\b/gi, "Oseias"],
  [/\bobadias\b/gi, "Obadias"],
  [/\bmiqu[eé]ias\b/gi, "Miqueias"],
  [/\bhabacuque\b/gi, "Habacuque"],
  [/\bsofonias\b/gi, "Sofonias"],
  [/\bageu\b/gi, "Ageu"],
  [/\bzacarias\b/gi, "Zacarias"],
  [/\bmalaquias\b/gi, "Malaquias"],
  [/\bmateus\b/gi, "Mateus"],
  [/\bjo[aã]o\b/gi, "João"],
  [/\batos\b(?=\s+\d)/gi, "Atos"],
  [/\bromanos\b(?=\s+\d)/gi, "Romanos"],
  [/\bcor[ií]ntios\b/gi, "Coríntios"],
  [/\bg[aá]latas\b/gi, "Gálatas"],
  [/\bef[eé]s+ios\b/gi, "Efésios"],
  [/\bfilipen+s+es\b/gi, "Filipenses"],
  [/\bcolossen+s+es\b/gi, "Colossenses"],
  [/\btessalonicen+s+es\b/gi, "Tessalonicenses"],
  [/\btim[oó]teo\b/gi, "Timóteo"],
  [/\bfilemom\b/gi, "Filemom"],
  [/\bhebreus\b(?=\s+\d)/gi, "Hebreus"],
  [/\btiago\b(?=\s+\d)/gi, "Tiago"],
  [/\bapocalipse\b/gi, "Apocalipse"],
  [/\bsalmos?\b(?=\s+\d)/gi, "Salmo"],
];

/** Split or garbled church words that keep coming back in ASR logs. */
const ASR_PHRASES: Array<[RegExp, string]> = [
  [/\ba\s+leluia\b/gi, "aleluia"],
  [/\bal[ée]luia\b/gi, "aleluia"],
  [/\ba\s+m[ée]m\b/gi, "amém"],
  [/\bamem\b/gi, "amém"],
  [/\bo\s+sana\b/gi, "hosana"],
  [/\bosana\b/gi, "hosana"],
  [/\besp[ií]rito\s+santo\b/gi, "Espírito Santo"],
  [/\bjesus\s+cristo\b/gi, "Jesus Cristo"],
  [/\bsanta\s+ceia\b/gi, "Santa Ceia"],
  [/\bcap[ií]tulo\b/gi, "capítulo"],
  [/\bvers[ií]culos\b/gi, "versículos"],
  [/\bvers[ií]culo\b/gi, "versículo"],
];

const UNITS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
  oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};
const NUMBER_WORD = `(?:cento|cem|${Object.keys(TENS).join("|")}|${Object.keys(UNITS).join("|")})`;
const NUMBER_PHRASE = new RegExp(`${NUMBER_WORD}(?:\\s+e\\s+${NUMBER_WORD})*`, "i");

/** "cento e dezenove" → 119; null when the words are not one number. */
export function parsePtNumber(words: string): number | null {
  const parts = words.toLowerCase().split(/\s+e\s+/);
  let total = 0;
  let lastScale = Infinity;
  for (const part of parts) {
    let value: number;
    if (part === "cem" || part === "cento") value = 100;
    else if (part in TENS) value = TENS[part];
    else if (part in UNITS) value = UNITS[part];
    else return null;
    const scale = value >= 100 ? 100 : value >= 20 ? 10 : 1;
    if (scale >= lastScale) return null; // "vinte e trinta" is not one number
    lastScale = scale;
    total += value;
  }
  return total;
}

/** Spoken numbers become digits only after a scripture cue, so "um amor" stays a word. */
const BOOK_CUES = [
  ...new Set(ASR_BOOKS.map(([, to]) => to)),
  "Lucas", "Marcos", "Rute", "Ester", "Jó", "Daniel", "Jonas", "Naum", "Joel", "Amós",
  "Samuel", "Reis", "Pedro", "Judas", "Ezequiel", "Jeremias", "Números", "Cantares", "Esdras", "Tito",
].join("|");
const CUE = String.raw`(?:cap[ií]tulo|vers[ií]culos?|verso|[Ss]almos?|(?:${BOOK_CUES})(?:\s+\d{1,3})?)`;
const CUE_NUMBER = new RegExp(String.raw`\b(${CUE})\s+(${NUMBER_PHRASE.source})\b`, "g");

/**
 * Fix what the ASR got wrong on church vocabulary before the line is shown or
 * translated. Conservative: only accents, split words and verse numbers.
 */
export function correctAsrTerms(text: string, source: LanguageCode) {
  if (source !== "pt" || !text.trim()) return text;
  let out = text;
  for (const [match, to] of ASR_PHRASES) out = out.replace(match, to as string);
  for (const [match, to] of ASR_BOOKS) out = out.replace(match, to);
  // "capítulo três versículo dezesseis" → "capítulo 3 versículo 16"
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(CUE_NUMBER, (whole, cue: string, spoken: string) => {
      const n = parsePtNumber(spoken);
      if (n === null) return whole;
      return `${/^salmos?$/i.test(cue) ? "Salmo" : cue} ${n}`;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}
