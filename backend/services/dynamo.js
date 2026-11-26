import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
const doc = DynamoDBDocumentClient.from(client);

const TABLES = {
  payments: "RevenueGatePayments",
  reports: "RevenueGateReports",
  quotes: "RevenueGateQuotes",
};

export async function putPayment(payment) {
  await doc.send(new PutCommand({ TableName: TABLES.payments, Item: payment }));
}

export async function getPayments() {
  const items = [];
  let cursor;
  do {
    const page = await doc.send(new ScanCommand({
      TableName: TABLES.payments,
      ConsistentRead: true,
      ExclusiveStartKey: cursor,
    }));
    items.push(...(page.Items || []));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items;
}

export async function putQuote(quote) {
  await doc.send(new PutCommand({ TableName: TABLES.quotes, Item: quote }));
}

export async function getQuote(requestId) {
  const result = await doc.send(new GetCommand({
    TableName: TABLES.quotes,
    Key: { requestId },
  }));
  return result.Item || null;
}

export async function putReport(report) {
  await doc.send(new PutCommand({ TableName: TABLES.reports, Item: report }));
}

export async function getReport(requestId) {
  const result = await doc.send(new GetCommand({
    TableName: TABLES.reports,
    Key: { requestId },
  }));
  return result.Item || null;
}
