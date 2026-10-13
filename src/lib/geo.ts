export type Stop = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

/** A few freight hubs for the booking form. Any lat/lng works. */
export const STOP_PRESETS: Stop[] = [
  { name: "Midwest Foods DC", address: "4400 S Kildare Ave, Chicago, IL 60632", lat: 41.8125, lng: -87.7303 },
  { name: "Lone Star Grocers", address: "2501 Irving Blvd, Dallas, TX 75207", lat: 32.7922, lng: -96.8461 },
  { name: "Peach State Cold Storage", address: "1200 Atlanta Industrial Pkwy, Atlanta, GA 30331", lat: 33.7351, lng: -84.5354 },
  { name: "Inland Empire Logistics", address: "13500 Valley Blvd, Fontana, CA 92335", lat: 34.0726, lng: -117.4853 },
  { name: "Gateway Distribution", address: "5800 N Hanley Rd, St. Louis, MO 63134", lat: 38.7445, lng: -90.3346 },
  { name: "Mile High Fulfillment", address: "4800 Florence St, Denver, CO 80238", lat: 39.7838, lng: -104.8908 },
];

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A point a short walk from the stop, so a simulated check-in looks like a real dock arrival. */
export function nearby(stop: { lat: number; lng: number }) {
  const jitter = () => (Math.random() - 0.5) * 0.0025;
  return { lat: stop.lat + jitter(), lng: stop.lng + jitter() };
}

export function formatDistance(meters: number | null | undefined) {
  if (meters === null || meters === undefined) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}
