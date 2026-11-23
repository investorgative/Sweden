export const QUOTES = [
  { q: 'Don’t focus on making money; focus on protecting what you have.', a: 'Paul Tudor Jones' },
  { q: 'The goal of a successful trader is to make the best trades. Money is secondary.', a: 'Alexander Elder' },
  { q: 'It never was my thinking that made the big money for me. It always was my sitting.', a: 'Jesse Livermore' },
  { q: 'Win or lose, everybody gets what they want out of the market.', a: 'Ed Seykota' },
  { q: 'The stock market is a device for transferring money from the impatient to the patient.', a: 'Warren Buffett' },
  { q: 'Amateurs think about how much money they can make. Professionals think about how much money they could lose.', a: 'Jack Schwager' },
  { q: 'Risk comes from not knowing what you’re doing.', a: 'Warren Buffett' },
]

export function quoteOfTheDay(d = new Date()) {
  const day = Math.floor(d.getTime() / 864e5)
  return QUOTES[day % QUOTES.length]
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 5) return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
