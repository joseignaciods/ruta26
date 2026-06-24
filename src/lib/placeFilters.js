// Listas de filtros/subtipos compartidas por el generador de itinerario y el
// picker de panoramas. Las cocinas y tipos sirven además como texto de búsqueda
// (Tripadvisor para comida, Wikipedia para atracciones).

export const CUISINES = [
  'Italiana', 'Peruana', 'Japonesa', 'Sushi', 'Mariscos', 'Parrilla', 'Comida local', 'Mexicana', 'China',
  'Hamburguesas', 'Pizza', 'Pastas', 'Mediterránea', 'Española', 'Tapas', 'Francesa', 'Tailandesa', 'India',
  'Café', 'Heladería', 'Comida rápida', 'Comida callejera', 'Vegetariana', 'Vegana', 'Saludable', 'Bar',
  'Cervecería', 'Vinoteca', 'Contemporánea', 'Fusión', 'Internacional', 'Argentina', 'Brasileña', 'Americana',
  'Coreana', 'Vietnamita', 'Árabe', 'Libanesa', 'Griega', 'Turca', 'Venezolana', 'Colombiana', 'Caribeña',
  'Panadería', 'Sándwiches', 'Sopas', 'Asiática', 'Steakhouse', 'Portuguesa', 'Alemana'
]

export const CULTURE_TYPES = [
  'Museos', 'Museos de arte', 'Sitios históricos', 'Puntos de interés y monumentos', 'Iglesias y catedrales',
  'Sitios religiosos', 'Monumentos y estatuas', 'Edificios y arquitectura', 'Castillos', 'Ruinas y sitios arqueológicos',
  'Galerías de arte', 'Barrios emblemáticos', 'Mercados', 'Parques', 'Jardines', 'Miradores y torres',
  'Teatros y ópera', 'Puentes', 'Naturaleza y vida silvestre', 'Playas', 'Paseos escénicos', 'Plazas y fuentes'
]

export const ATTRACTION_TYPES = [
  'Museos', 'Sitios históricos', 'Monumentos', 'Puntos de interés', 'Parques', 'Miradores', 'Galerías de arte',
  'Arquitectura', 'Mercados', 'Tours', 'Espectáculos', 'Casinos', 'Parques temáticos', 'Acuarios', 'Zoológicos',
  'Jardines', 'Vida nocturna', 'Compras', 'Sitios religiosos', 'Barrios emblemáticos'
]

export const NATURE_TYPES = [
  'Parques', 'Jardines', 'Playas', 'Senderos', 'Miradores', 'Naturaleza y vida silvestre', 'Lagos y ríos',
  'Montañas', 'Cascadas', 'Reservas naturales', 'Paseos escénicos', 'Bosques'
]

// Niveles de precio (cuenta de signos $) y pasos de puntuación mínima.
export const PRICE_LEVELS = [
  { id: 1, label: '$' },
  { id: 2, label: '$$' },
  { id: 3, label: '$$$' },
  { id: 4, label: '$$$$' }
]

export const RATING_STEPS = [
  { id: 0, label: 'Todas' },
  { id: 3, label: '★ 3+' },
  { id: 4, label: '★ 4+' },
  { id: 4.5, label: '★ 4.5+' }
]

// Nivel de precio (1-4) a partir del priceLevel de Tripadvisor. Toma la racha de
// "$" más larga, así "$$ - $$$" → 3 (cota alta) y "$$" → 2. 0 si no hay precio.
export const priceLevelCount = value =>
  (String(value || '').match(/\$+/g) || []).reduce((max, run) => Math.max(max, run.length), 0)
