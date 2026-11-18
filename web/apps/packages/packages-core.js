// Packages: tracking numbers, their carrier told from the number's shape, a link to each carrier's own
// tracking page, and the steps of a delivery for a progress bar. Pure.

/** [id, name, test, tracking page for a number] */
export const CARRIERS = [
  ['ups', 'UPS', (n) => /^1Z[0-9A-Z]{16}$/.test(n) || /^T\d{10}$/.test(n), (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`],
  ['usps', 'USPS', (n) => /^(94|93|92|95|82|42)\d{18,24}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n) || /^\d{22}$/.test(n), (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`],
  ['fedex', 'FedEx', (n) => /^(\d{12}|\d{15}|\d{20}|96\d{20}|\d{34})$/.test(n), (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`],
  ['dhl', 'DHL', (n) => /^(\d{10}|JJD\d{16,20}|JVGL\d{16,20}|GM\d{16,20}|LX\d{9}DE|\d{16,22}DE)$/.test(n), (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(n)}`],
  ['amazon', 'Amazon', (n) => /^TBA\d{12,13}$/.test(n), () => 'https://www.amazon.com/gp/your-account/order-history'],
  ['ontrac', 'OnTrac', (n) => /^(C\d{14}|D\d{14})$/.test(n), (n) => `https://www.ontrac.com/tracking/?number=${encodeURIComponent(n)}`],
];

/** A tracking number as carriers write it: no spaces or dashes, capitals. */
export const clean = (n) => String(n ?? '').toUpperCase().replace(/[\s-]+/g, '');

/** The carrier a number looks like ('' when it isn't clear). */
export function detectCarrier(number) {
  const n = clean(number);
  return CARRIERS.find(([, , test]) => test(n))?.[0] ?? '';
}

export const carrierName = (id) => CARRIERS.find(([c]) => c === id)?.[1] ?? 'Other';
/** The carrier's own tracking page for it (a search when the carrier isn't known). */
export function trackUrl(carrier, number) {
  const c = CARRIERS.find(([id]) => id === carrier);
  return c ? c[3](clean(number)) : `https://www.google.com/search?q=${encodeURIComponent(`track ${clean(number)}`)}`;
}

/** The steps a delivery goes through, for the bar. */
export const STEPS = [['label', 'Label created'], ['transit', 'In transit'], ['out', 'Out for delivery'], ['delivered', 'Delivered']];

/**
 * A tracking service's status (17TRACK's: NotFound, InfoReceived, InTransit, AvailableForPickup,
 * OutForDelivery, DeliveryFailure, Delivered, Exception, Expired) as { step (0..3, or -1), text, problem }.
 */
export function statusOf(status) {
  const s = String(status ?? '').replace(/[\s_]/g, '').toLowerCase();
  if (s === 'delivered') return { step: 3, text: 'Delivered', problem: false };
  if (s === 'outfordelivery') return { step: 2, text: 'Out for delivery', problem: false };
  if (s === 'availableforpickup') return { step: 2, text: 'Ready for pickup', problem: false };
  if (s === 'intransit') return { step: 1, text: 'In transit', problem: false };
  if (s === 'inforeceived') return { step: 0, text: 'Label created', problem: false };
  if (s === 'deliveryfailure') return { step: 2, text: 'Delivery attempted', problem: true };
  if (s === 'exception') return { step: 1, text: 'Problem: see details', problem: true };
  if (s === 'expired') return { step: -1, text: 'No longer tracked', problem: true };
  if (s === 'notfound') return { step: -1, text: 'Not found yet', problem: false };
  return { step: -1, text: status ? String(status) : 'No status yet', problem: false };
}
