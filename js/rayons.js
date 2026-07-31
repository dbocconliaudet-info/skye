// Classement des articles par rayon (§7) et découpage du texte dicté.
//
// Le dictionnaire de base vit ici, dans le code, et non en base de données :
// il est ainsi disponible hors ligne, identique pour tout le monde, et il
// n'encombre pas la base de 200 lignes recopiées pour chaque espace.
// Seules les corrections faites par Damien et Dom sont stockées côté Supabase
// (table `dictionnaire_rayons`) et prennent le pas sur cette liste.

export const RAYONS = [
  'Fruits & légumes',
  'Boulangerie',
  'Boucherie & poissonnerie',
  'Crèmerie & frais',
  'Épicerie salée',
  'Épicerie sucrée',
  'Surgelés',
  'Boissons',
  'Hygiène & beauté',
  'Entretien & maison',
  'Bébé',
  'Animaux',
  'Divers',
];

export const RAYON_DEFAUT = 'Divers';

const BASE = {
  'Fruits & légumes': `pomme poire banane orange clementine mandarine citron pamplemousse raisin fraise framboise
    myrtille cassis mure cerise abricot peche nectarine prune figue kiwi ananas mangue avocat melon pasteque
    grenade litchi datte tomate carotte courgette aubergine poivron concombre salade laitue roquette mache
    epinard chou brocoli chouxfleur haricot petitpois poireau celeri fenouil navet radis betterave potiron
    courge patate pommedeterre oignon echalote ail gingembre champignon persil coriandre basilic menthe thym
    romarin ciboulette endive artichaut asperge mais citrouille rhubarbe`,

  Boulangerie: `pain baguette ficelle boule cereales complet campagne brioche croissant painauchocolat
    chocolatine painaulait viennoiserie tarte tartelette gateau baguettine painburger buns painpita
    wrap tortilla painmie biscotte`,

  'Boucherie & poissonnerie': `poulet dinde canard boeuf steak entrecote bavette rumsteck veau porc agneau
    cote cotelette roti escalope filet cuisse aiguillette merguez chipolata saucisse saucisson jambon lardon
    bacon viandehachee hache poisson saumon cabillaud colin lieu merlu truite thon sardine maquereau dorade
    bar sole limande crevette gambas moule huitre coquille noixdesaintjacques crabe homard calamar poulpe
    surimi tarama`,

  'Crèmerie & frais': `lait beurre creme cremefraiche yaourt yaourts fromage comte gruyere emmental
    parmesan mozzarella feta chevre camembert brie roquefort bleu reblochon raclette gouda cheddar ricotta
    mascarpone faisselle fromageblanc petitsuisse skyr oeuf oeufs margarine pateabrisee patefeuilletee
    patepizza compote flan creme dessert boursin tzatziki houmous tofu`,

  'Épicerie salée': `pate pates spaghetti tagliatelle penne coquillette macaroni riz quinoa boulgour semoule
    couscous lentille pois poischiche haricotsec farine huile huileolive vinaigre sel poivre epice curry
    paprika cumin curcuma herbe moutarde ketchup mayonnaise sauce sauce tomate concentre coulis conserve
    thonboite maiscoserve cornichon olive capre bouillon cube soupe veloute chips biscuitapero apero
    tapenade noix noisette amande cacahuete pistache grainedecourge sesame levure bicarbonate
    fondderiz nouille soja nuocmam`,

  'Épicerie sucrée': `sucre confiture miel chocolat chocolatnoir chocolatlait nutella patea tartiner biscuit
    gateau cookie madeleine gaufre cereale muesli granola flocondavoine barre bonbon chewinggum compote
    creme dessert sirop cacao chantilly vanille sucrevanille levurechimique pepitedechocolat praline
    speculoos galette sable palmier boudoir`,

  Surgelés: `surgele glace sorbet batonnet epinardsurgele legumesurgele fritesurgele frite pizzasurgele
    poissonpane nuggets crevettesurgelee fruitsrouges glacon`,

  Boissons: `eau eaugazeuse perrier badoit vittel evian jus jusdorange jusdepomme limonade soda cola
    icetea sirop biere vin vinrouge vinblanc rose champagne cremant cidre kombucha kefir the cafe capsule
    dosette infusion tisane chocolatchaud laitvegetal laitdamande laitdesoja laitdavoine smoothie
    pastis whisky rhum vodka gin`,

  'Hygiène & beauté': `dentifrice brosseadent fildentaire baindebouche savon gel geldouche shampoing
    apresshampoing deodorant mousse rasoir gelarasage cremehydratante laitcorps huilecorps
    coton cotontige mouchoir papiertoilette serviettehygienique tampon protegeslip preservatif
    maquillage demaquillant vernis parfum pansement paracetamol doliprane ibuprofene vitamine
    lingette gantdetoilette peigne brosse laque cireepiler`,

  'Entretien & maison': `lessive adoucissant assouplissant liquidevaisselle tablettelavevaisselle selregenerant
    liquiderincage nettoyant javel desinfectant vinaigreblanc bicarbonatemenager eponge grattoir chiffon
    balai serpilliere sac sacpoubelle poubelle essuietout sopalin filmalimentaire papieralu papiercuisson
    boitehermetique allumette bougie ampoule pile chargeur ruban colle scotch stylo cahier enveloppe timbre`,

  Bébé: `couche couches lingettebebe laitinfantile petitpot compotebebe biberon tetine cremechangecoton
    liniment bavoir`,

  Animaux: `croquette pateechat pateechien litiere sablechat friandisechien friandisechat jouetchat
    osachien graineoiseau foin`,
};

/** Retire accents, ponctuation et espaces pour comparer « Œufs » et « oeuf ». */
export function normaliser(texte) {
  return (texte || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é → e
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]/g, '');
}

/** Singulier approximatif : « tomates » et « tomate » doivent tomber au même endroit. */
function racine(mot) {
  const n = normaliser(mot);
  if (n.length > 3 && (n.endsWith('s') || n.endsWith('x'))) return n.slice(0, -1);
  return n;
}

// Index mot → rayon, construit une seule fois au chargement du module.
//
// Le premier rayon déclaré l'emporte : certains mots apparaissent légitimement
// dans plusieurs listes (« crème » en crèmerie et en cosmétique, « sirop » en
// épicerie et en boissons). L'ordre de BASE fait donc office de priorité, et
// l'alimentaire — de loin le cas le plus fréquent en courses — passe devant.
const INDEX = new Map();
for (const [rayon, mots] of Object.entries(BASE)) {
  for (const mot of mots.split(/\s+/).filter(Boolean)) {
    const cle = racine(mot);
    if (!INDEX.has(cle)) INDEX.set(cle, rayon);
  }
}

/**
 * Devine le rayon d'un article.
 * @param {string} nom      nom saisi par l'utilisateur
 * @param {Map}    appris   corrections du couple (mot normalisé → rayon)
 */
export function classer(nom, appris = new Map()) {
  const complet = racine(nom);
  if (appris.has(complet)) return appris.get(complet);
  if (INDEX.has(complet)) return INDEX.get(complet);

  // Sinon on regarde mot à mot : « yaourt nature » → « yaourt » → Crèmerie.
  // Les mots longs d'abord : dans « pain de mie », « pain » est plus parlant que « de ».
  const mots = (nom || '').split(/\s+/).filter((m) => racine(m).length > 2)
    .sort((a, b) => b.length - a.length);
  for (const mot of mots) {
    const r = racine(mot);
    if (appris.has(r)) return appris.get(r);
    if (INDEX.has(r)) return INDEX.get(r);
  }
  return RAYON_DEFAUT;
}

const UNITES = 'kgs?|kilos?|grammes?|gr?|litres?|l|cl|ml|boites?|bo[iî]tes?|paquets?|bouteilles?|packs?|'
             + 'tranches?|pots?|barquettes?|sachets?|bocaux|bocals?|bottes?|briques?|rouleaux?';

export const capitaliser = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Sépare le nom d'un article de sa quantité : « 3 pommes » → { nom:'Pommes', quantite:'x3' }.
 *  La capitalisation se fait ici, après le retrait de la quantité : sinon
 *  « 3 pommes » verrait sa majuscule tomber sur le chiffre. */
export function extraireQuantite(texte) {
  let t = texte.trim().replace(/\s+/g, ' ');

  // Quantité en fin : « pommes x3 », « lait *2 »
  let m = t.match(/^(.+?)\s*[x*]\s*(\d+)$/i);
  if (m) return { nom: capitaliser(m[1].trim()), quantite: `x${m[2]}` };

  // Quantité en tête avec unité : « 500 g de farine », « 2 boîtes de thon »
  m = t.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITES})\\b\\s*(?:d'|de\\s+|des\\s+|du\\s+)?(.+)$`, 'i'));
  if (m) return { nom: capitaliser(m[3].trim()), quantite: `${m[1].replace(',', '.')} ${m[2]}` };

  // Quantité en tête sans unité : « 3 pommes »
  m = t.match(/^(\d+)\s+(?:d'|de\s+|des\s+|du\s+)?(.+)$/);
  if (m && m[2].length > 1) return { nom: capitaliser(m[2].trim()), quantite: `x${m[1]}` };

  return { nom: capitaliser(t), quantite: null };
}

/**
 * Découpe un texte libre en articles distincts (§7).
 * Pensé pour la dictée du clavier iPhone : « du lait, des œufs et du pain »
 * donne trois articles. Les « et » à l'intérieur d'un nom composé sont
 * préservés (« sel et poivre » resterait coupé, mais « huile d'olive » non).
 */
export function decouper(texte) {
  return (texte || '')
    .split(/\s*[,;\n]\s*|\s+et\s+|\s+puis\s+/i)
    .map((bout) => bout.replace(/^\s*(?:et|puis|aussi|alors)\s+/i, '').trim())
    // On enlève les articles partitifs en tête : « du lait » → « lait »
    .map((bout) => bout.replace(/^(?:du|de la|de l'|des|le|la|les|un|une)\s+/i, '').trim())
    .filter((bout) => bout.length > 0)
    .map(capitaliser);
}

/** Regroupe des articles par rayon, dans l'ordre de parcours du magasin. */
export function grouperParRayon(articles) {
  const groupes = new Map();
  for (const a of articles) {
    if (!groupes.has(a.rayon)) groupes.set(a.rayon, []);
    groupes.get(a.rayon).push(a);
  }
  const ordre = (r) => {
    const i = RAYONS.indexOf(r);
    return i === -1 ? RAYONS.length : i;   // rayon inconnu → à la fin
  };
  return [...groupes.entries()].sort((a, b) => ordre(a[0]) - ordre(b[0]));
}
