// One function for the shared router keeps every public API URL within Hobby limits.
export { default } from '../server/vercel.js';
export const config = { api: { bodyParser: false } };
