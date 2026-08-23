// The two numbers. Shared by the landing page (client) and server routes, so
// they live apart from the Stripe client, which must never reach the browser.
export const PRICE_USD = 39; // the app, once
export const AI_MONTHLY_USD = 10; // AI, per month, optional
