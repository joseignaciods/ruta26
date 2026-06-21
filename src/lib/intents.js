import { categories } from '../components/CategoryIcon.jsx'

// Intenciones del selector de lugares: cada una define qué se sugiere antes de
// tipear (seedQuery contra Tripadvisor) y los valores por defecto del panorama.
// Cuatro atajos amplios (no filtros rígidos). "Comer" agrupa todas las comidas;
// la hora del día se infiere al agregar con suggestMealTime.
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
    key:'eat',
    label:'Comer',
    icon:'food',
    category:'food',
    title:'¿Dónde comer?',
    suggestTitle:'Para comer',
    seedQuery:'mejores restaurantes, cafés y bares',
    placeholder:'Busca restaurantes, cafés, bares…',
    defaultTime:null
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
    label:'Aire libre',
    icon:'nature',
    category:'nature',
    title:'¿Qué aire libre?',
    suggestTitle:'Naturaleza y aire libre',
    seedQuery:'parques, jardines y naturaleza',
    placeholder:'Busca parques, jardines, miradores…',
    defaultTime:null
  }
]

export const intentFor = key => intents.find(item => item.key === key) || intents[0]

export const intentForCategory = categoryId =>
  ({ food:'eat', culture:'culture', nature:'nature', entertainment:'top', transport:'top' })[categoryId] || 'top'

export const inferCategory = (place, fallback) => {
  if (categories.some(category => category.id === place.category)) return place.category
  const labels = [place.category, ...(place.subcategories || [])].join(' ').toLowerCase()
  if (/restaurant|comida|café|cafe|bar|food/.test(labels)) return 'food'
  if (/parque|jardín|jardin|naturaleza|playa|nature/.test(labels)) return 'nature'
  if (/museo|museum|historia|cultural|monumento|galería|galeria/.test(labels)) return 'culture'
  return fallback
}
