const TZ = "Europe/London";

export const money = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
export const toPence = (pounds) => Math.round(parseFloat(pounds || "0") * 100);
export const toPounds = (pence) => ((pence || 0) / 100).toFixed(2);

export function clock(iso) {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })
    .replace(" ", "")
    .toLowerCase();
}

export function dayAndTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
  return `${day}, ${clock(iso)}`;
}

export function minutesFrom(iso, now = Date.now()) {
  return Math.round((now - new Date(iso).getTime()) / 60000);
}

export const STATUS_LABEL = {
  pending_payment: "Awaiting payment",
  placed: "New",
  accepted: "Accepted",
  preparing: "Cooking",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  collected: "Collected",
  served: "Served",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const TYPE_LABEL = { delivery: "Delivery", collection: "Collection", dine_in: "Dine-in" };

// UK Food Information Regulations: the 14 allergens.
export const ALLERGENS = [
  "celery", "cereals containing gluten", "crustaceans", "eggs", "fish", "lupin", "milk",
  "molluscs", "mustard", "tree nuts", "peanuts", "sesame", "soya", "sulphites",
];
