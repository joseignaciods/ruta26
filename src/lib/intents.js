import { categories } from '../components/CategoryIcon.jsx'

// Intenciones del selector de lugares: cada una define qué se sugiere antes de
// tipear (seedQuery contra Tripadvisor) y los valores por defecto del panorama.
export const intents = [
  {
    key:'top',
    label:'Imperdibles',
    icon:'entertainment',
    category:'entertainment',
    title:'¿Qué quieres hacer?',
    suggestTitle:'Imperdibles',
    seedQuery:'mejores atracciones y panoramas imperdibles',
    placeholder:'Busca lugares, tours, barrios…',
    defaultTime:null
  },
  {
    key:'breakfast',
    label:'Desayuno',
    icon:'food',
    category:'food',
    title:'¿Dónde desayunar?',
    suggestTitle:'Para desayunar',
    seedQuery:'desayuno brunch café',
    placeholder:'Busca cafés, brunch, pastelerías…',
    defaultTime:'09:00'
  },
  {
    key:'lunch',
    label:'Almuerzo',
    icon:'food',
    category:'food',
    title:'¿Dónde almorzar?',
    suggestTitle:'Para almorzar',
    seedQuery:'restaurantes recomendados para almorzar',
    placeholder:'Busca restaurantes, comida local…',
    defaultTime:'13:30'
  },
  {
    key:'dinner',
    label:'Cena',
    icon:'food',
    category:'food',
    title:'¿Dónde cenar?',
    suggestTitle:'Para cenar',
    seedQuery:'restaurantes recomendados para cenar',
    placeholder:'Busca restaurantes, bares…',
    defaultTime:'20:30'
  },
  {
    key:'culture',
    label:'Cultura',
    icon:'culture',
    category:'culture',
    title:'¿Qué visitar?',
    suggestTitle:'Cultura e historia',
    seedQuery:'museos, historia y lugares culturales',
    placeholder:'Busca museos, templos, monumentos…',
    defaultTime:null
  },
  {
    key:'nature',
    label:'Naturaleza',
    icon:'nature',
    category:'nature',
    title:'¿Qué aire libre?',
    suggestTitle:'Naturaleza y aire libre',
    seedQuery:'parques, jardines y naturaleza',
    placeholder:'Busca parques, jardines, miradores…',
    defaultTime:null
  },
  {
    key:'experience',
    label:'Experiencias',
    icon:'entertainment',
    category:'entertainment',
    title:'¿Qué experiencia vivir?',
    suggestTitle:'Experiencias y tours',
    seedQuery:'tours, espectáculos y experiencias',
    placeholder:'Busca tours, shows, actividades…',
    defaultTime:null
  }
]

export const intentFor = key => intents.find(item => item.key === key) || intents[0]

export const intentForCategory = categoryId =>
  ({ food:'lunch', culture:'culture', nature:'nature', entertainment:'experience' })[categoryId] || 'top'

export const inferCategory = (place, fallback) => {
  if (categories.some(category => category.id === place.category)) return place.category
  const labels = [place.category, ...(place.subcategories || [])].join(' ').toLowerCase()
  if (/restaurant|comida|café|cafe|bar|food/.test(labels)) return 'food'
  if (/parque|jardín|jardin|naturaleza|playa|nature/.test(labels)) return 'nature'
  if (/museo|museum|historia|cultural|monumento|galería|galeria/.test(labels)) return 'culture'
  return fallback
}
