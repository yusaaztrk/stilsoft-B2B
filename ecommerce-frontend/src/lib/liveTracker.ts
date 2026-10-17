export function getVisitorId(): string {
  let id = localStorage.getItem('ecom_visitor_id')
  if (!id) {
    id = `Ziyaretçi #${Math.floor(1000 + Math.random() * 9000)}`
    localStorage.setItem('ecom_visitor_id', id)
  }
  return id
}

export function getVisitorCity(): string {
  let city = localStorage.getItem('ecom_visitor_city')
  if (!city) {
    const cities = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Trabzon', 'Konya', 'Gaziantep', 'Diyarbakır', 'Samsun', 'Eskişehir']
    city = cities[Math.floor(Math.random() * cities.length)]
    localStorage.setItem('ecom_visitor_city', city)
  }
  return city
}

export async function trackLiveEvent(eventType: string, detail: string) {
  try {
    const visitor = getVisitorId()
    const city = getVisitorCity()
    await fetch('/api/storefront/live/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ eventType, visitor, detail, city })
    })
  } catch (err) {
    console.error('Error tracking live event:', err)
  }
}
