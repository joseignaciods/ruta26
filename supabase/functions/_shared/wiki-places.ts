// Proveedor de lugares gratuito y sin API key basado en Wikipedia/Wikimedia.
// Una sola llamada devuelve, por lugar: título, foto (Wikimedia), coordenadas y
// un extracto. Para atracciones (no comida): geosearch cerca de un punto cuando
// no hay texto, o búsqueda por texto cuando el usuario escribe.
//
// IMPORTANTE: la geosearch de Wikipedia devuelve TODO artículo geolocalizado, no
// solo lugares: también EVENTOS históricos (batallas, incidentes, festivales,
// "Restauración Kenmu", "Incidente de Honnō-ji"…). Esos NO son panoramas y
// arruinaban "Imperdibles". Se descartan con dos señales que ya vienen en la
// misma llamada (sin pedir nada extra ni depender de Wikidata, cuya jerarquía de
// clases es demasiado enredada para clasificar fiable):
//   1. type:event de las coordenadas (GeoData) — preciso pero solo lo trae ~1 de
//      cada 4 eventos.
//   2. el sustantivo definitorio del extracto: "… fue un golpe de Estado",
//      "… es un festival", "… fue una guerra civil", "… fue un período…". Se
//      ancla en el núcleo de la definición (no en cláusulas subordinadas) para no
//      descartar lugares que solo MENCIONAN una guerra (p.ej. un monumento).

type WikiOptions = {
  query?: string
  city?: string
  latitude?: number
  longitude?: number
  radiusKm?: number
  language?: string
  limit?: number
}

const USER_AGENT = 'Ruta26/1.0 (https://ruta26-rosy.vercel.app; contacto@ruta26.app)'

const trim = (text: string, max = 180) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

// Nombre normalizado (sin tildes/puntuación, minúsculas) para emparejar un
// lugar de Wikipedia con su ficha de Tripadvisor.
export const normName = (value: unknown) =>
  String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// Núcleos de sustantivo que delatan un EVENTO (no un lugar) en la frase
// definitoria del artículo. Patrón: <verbo ser/referirse> + <artículo> +
// (a lo sumo una palabra modificadora) + <sustantivo-evento>. Solo idiomas con
// la app (es/en); en otros idiomas queda type:event como única red.
const EVENT_NOUN_ES =
  'batallas?|guerra(?:s|\\s+civil)?|conflicto\\s+(?:b[ée]lico|armado|militar)|golpes?\\s+de\\s+estado|golpes?\\s+militares?|incidentes?|sucesos?|asaltos?|ofensivas?|asedios?|cercos?|bloqueos?|bombardeos?|rebeli[óo]n(?:es)?|sublevaci[óo]n(?:es)?|revueltas?|mot[íi]n(?:es)?|levantamientos?|alzamientos?|insurrecci[óo]n(?:es)?|revoluci[óo]n(?:es)?|masacres?|matanzas?|asesinatos?|atentados?|magnicidios?|conjuras?|festival(?:es)?|festividades?|ceremonias?|conmemoraci[óo]n(?:es)?|per[íi]odo(?:s)?|dinast[íi]as?|tratados?|pactos?|epidemias?|pandemias?|terremotos?|sismos?|incendios?|inundaci[óo]n(?:es)?|erupci[óo]n(?:es)?|naufragios?|desastres?|cat[áa]strofes?'
const EVENT_NOUN_EN =
  'battles?|wars?|civil war|armed conflict|coups?(?:\\sd[\'’]état)?|incidents?|uprisings?|rebellions?|revolts?|riots?|mutinies|insurrections?|revolutions?|sieges?|blockades?|bombardments?|bombings?|massacres?|assassinations?|raids?|assaults?|festivals?|ceremonies|commemorations?|treaties|treaty|pacts?|periods?|dynasties|dynasty|epidemics?|pandemics?|earthquakes?|fires?|floods?|eruptions?|shipwrecks?|disasters?|catastrophes?'

// El artículo describe una ENTIDAD HISTÓRICA (un Estado/imperio), no un lugar
// visitable: "fue el Estado nación japonés…", "fue un imperio…".
const ABSTRACT_DEF: Record<string, RegExp> = {
  // Solo "estado/imperio" (entidades históricas, no lugares). NADA de
  // "nombre/denominación/término": describen LUGARES reales ("Capilla Cornaro es
  // la denominación de una obra de Bernini", "Kinkaku-ji es el nombre del templo…").
  es: /\b(?:es|son|fue|fueron|era|eran)\s+(?:el|la|los|las|un|una)\s+(?:antigua?\s+)?(?:estados?(?:\s+naci[óo]n)?|imperios?)\b/i,
  en: /\b(?:is|was|are|were)\s+(?:the|a|an)\s+(?:former\s+)?(?:states?|empires?)\b/i
}

const EVENT_DEF: Record<string, RegExp> = {
  // verbo (con artículo opcional, para plurales sin artículo: "son guerras") o
  // "se refiere al" + (≤1 palabra modificadora) + sustantivo-evento.
  es: new RegExp(`\\b(?:(?:es|son|fue|fueron|era|eran)\\s+(?:(?:el|la|los|las|un|una|unos|unas)\\s+)?|(?:se\\s+refiere\\s+al?|hace\\s+referencia\\s+al?)\\s+)(?:[a-záéíóúñ]{3,14}\\s+){0,1}(?:${EVENT_NOUN_ES})\\b`, 'i'),
  en: new RegExp(`\\b(?:(?:is|was|are|were)\\s+(?:(?:a|an|the)\\s+)?|refers?\\s+to\\s+(?:the\\s+)?)(?:[a-z]{3,14}\\s+){0,1}(?:${EVENT_NOUN_EN})\\b`, 'i')
}

// Los eventos históricos siguen una convención de título muy fuerte:
// "Batalla de…", "Matanza de…", "Revuelta de…", "Primer bombardeo de…". NO se
// usa "Sitio de…" / "Toma de…" porque "sitio" (sitio arqueológico/patrimonio) y
// "toma" (toma de agua) también nombran LUGARES; esos eventos caen por type:event.
const EVENT_TITLE: Record<string, RegExp> = {
  es: /^(?:(?:la|el)\s+)?(?:(?:primer[ao]?|primera|segund[ao]|tercer[ao]?|cuart[ao]|quint[ao]|gran|antigua?|nuev[ao])\s+)?(?:batallas?|asedio|cerco|bloqueo|bombardeo|guerras?|revueltas?|rebeli[óo]n|sublevaci[óo]n|levantamiento|alzamiento|insurrecci[óo]n|revoluci[óo]n|matanzas?|masacres?|incidente|sucesos?|golpe|atentado|conjuras?|mot[íi]n|asaltos?|ofensivas?|saqueo|ca[íi]da|conquista|liberaci[óo]n|tratado|pacto|concilio|festival|festividad|ceremonia|epidemia|pandemia|terremoto|incendio|naufragio|erupci[óo]n|expedici[óo]n)\s+de(?:l)?\s/i,
  en: /^(?:the\s+)?(?:(?:first|second|third|fourth|fifth|great|old|new)\s+)?(?:battle|siege|blockade|bombardment|bombing|sack|capture|fall|conquest|revolt|rebellion|uprising|insurrection|revolution|massacres?|incident|coup|assault|raid|offensive|treaty|council|festival|ceremony|epidemic|pandemic|earthquake|fire|shipwreck|eruption|expedition)\s+of\s/i
}

// La heurística de texto solo corre en los idiomas con la app (es/en); en otros
// queda type:event como red. Normaliza a NFC para no fallar con texto descompuesto.
const SUPPORTED_LANGS = new Set(['es', 'en'])
const looksLikeEvent = (title: string, extract: string, lang: string): boolean => {
  if (!SUPPORTED_LANGS.has(lang)) return false
  if (EVENT_TITLE[lang].test(String(title || '').normalize('NFC').trim())) return true
  const text = String(extract || '').normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return EVENT_DEF[lang].test(text) || ABSTRACT_DEF[lang].test(text)
}

const normalize = (page: Record<string, any>, lang: string) => {
  const coord = (page.coordinates && page.coordinates[0]) || null
  return {
    locationId: `wiki-${page.pageid}`,
    name: String(page.title || ''),
    description: trim(page.extract || ''),
    address: '',
    latitude: coord ? Number(coord.lat) : null,
    longitude: coord ? Number(coord.lon) : null,
    rating: null,
    reviewCount: null,
    ranking: '',
    priceLevel: '',
    imageUrl: page.thumbnail?.source ? String(page.thumbnail.source) : '',
    url: `https://${lang}.wikipedia.org/?curid=${page.pageid}`,
    provider: 'wikipedia',
    category: '',
    subcategories: [] as string[]
  }
}

export async function searchWikiPlaces(options: WikiOptions) {
  const lang = options.language || 'es'
  const limit = Math.min(Math.max(Number(options.limit || 6), 1), 12)
  const text = (options.query || '').trim()
  const hasGeo = options.latitude != null && options.longitude != null
  // Pedimos de más para compensar los eventos que se descartan. Tope 20: es el
  // máximo de extracts que la API entrega por generator (más allá no traerían
  // descripción y la heurística de texto se quedaría sin extracto).
  const fetchN = String(Math.min(20, limit * 3))

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '1',
    prop: 'pageimages|coordinates|extracts',
    piprop: 'thumbnail',
    pithumbsize: '600',
    // type → para descartar coordenadas marcadas como type:event (GeoData).
    coprop: 'type',
    exintro: '1',
    explaintext: '1',
    // Sin exlimit, los extracts via generator solo vuelven para 1 página (el
    // resto queda sin descripción). fetchN ≤ 20, el máximo que permite la API.
    exlimit: fetchN
  })

  if (text) {
    params.set('generator', 'search')
    params.set('gsrsearch', [text, options.city].filter(Boolean).join(' '))
    params.set('gsrlimit', fetchN)
  } else if (hasGeo) {
    params.set('generator', 'geosearch')
    params.set('ggscoord', `${options.latitude}|${options.longitude}`)
    params.set('ggsradius', String(Math.min(10000, Math.max(1000, Math.round((options.radiusKm || 8) * 1000)))))
    params.set('ggslimit', fetchN)
  } else {
    return []
  }

  const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`Wikipedia respondió ${response.status}`)
  const data = await response.json()
  const pages = (Object.values(data?.query?.pages || {}) as Record<string, any>[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  const cityLower = (options.city || '').trim().toLowerCase()
  const seen = new Set<string>()
  return pages
    // Foto + coordenadas = lugar real (descarta artículos genéricos, empresas, etc.)
    .filter(page => page.thumbnail?.source && page.coordinates?.[0])
    // Capa 1: coordenadas marcadas como evento (GeoData type:event).
    .filter(page => String((page.coordinates[0].type || '')).toLowerCase() !== 'event')
    // No mostrar el artículo de la propia ciudad del día.
    .filter(page => String(page.title || '').toLowerCase() !== cityLower)
    // Capa 2: el título o el extracto delatan un evento (batalla, festival…).
    .filter(page => !looksLikeEvent(page.title, page.extract, lang))
    .map(page => normalize(page, lang))
    .filter(place => { if (seen.has(place.locationId)) return false; seen.add(place.locationId); return true })
    .slice(0, limit)
}
