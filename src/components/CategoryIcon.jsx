export const categories = [
  { id:'culture', label:'Cultura', hint:'Museos e historia', color:'#8b5cf6' },
  { id:'food', label:'Comida', hint:'Sabores locales', color:'#f59e0b' },
  { id:'nature', label:'Naturaleza', hint:'Parques y aire libre', color:'#10b981' },
  { id:'entertainment', label:'Experiencias', hint:'Tours y panoramas', color:'#c44e92' },
  { id:'transport', label:'Traslado', hint:'Trenes y vuelos', color:'#64748b' }
]

export const categoryFor = id => categories.find(item => item.id === id) || categories[3]

// Fuente única de los trazos: se usan como React y como HTML plano para los pins de Leaflet.
export const categoryMarkup = {
  culture:'<path d="M3 9h18M5 9l7-5 7 5M6 9v8M10 9v8M14 9v8M18 9v8M4 20h16" />',
  food:'<path d="M7 3v8M4 3v5c0 2 1 3 3 3s3-1 3-3V3M7 11v10M16 3c-2 3-2 7 1 9v9M17 3v9" />',
  nature:'<path d="M12 21V9M12 14c-4 0-7-2-8-6 4-1 7 0 8 4M12 11c4 0 7-2 8-6-4-1-7 0-8 4" />',
  entertainment:'<path d="m12 3 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.3-4.4 2.3.8-5-3.6-3.5 5-.7Z" />',
  transport:'<path d="M6 17h12M7 17l-2 4M17 17l2 4M6 13h12M8 3h8c2 0 3 2 3 4v8c0 1-1 2-2 2H7c-1 0-2-1-2-2V7c0-2 1-4 3-4Z" /><circle cx="8" cy="14" r="1" /><circle cx="16" cy="14" r="1" />',
  hotel:'<path d="M3 19V5M3 15h18v4M7 15v-3h13v3M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />'
}

export default function CategoryIcon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html:categoryMarkup[name] || categoryMarkup.entertainment }} />
}

export const pinHtml = (categoryId, number) =>
  `<div class="poi-pin" style="--pin-color:${categoryFor(categoryId).color}"><b>${number}</b><svg viewBox="0 0 24 24">${categoryMarkup[categoryId] || categoryMarkup.entertainment}</svg></div>`

export const hotelPinHtml = () =>
  `<div class="hotel-pin"><svg viewBox="0 0 24 24">${categoryMarkup.hotel}</svg></div>`
