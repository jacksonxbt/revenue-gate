// In-memory store for hackathon MVP. Replace with DynamoDB for production.
export const db = {
  payments: [],
  quotes: new Map(),
  reports: new Map(),
};
