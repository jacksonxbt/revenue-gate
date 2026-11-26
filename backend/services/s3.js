import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET || "revenue-gate-reports-859043921000";
const client = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });

export async function uploadReport(requestId, report) {
  const key = `reports/${requestId}.json`;
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(report, null, 2),
    ContentType: "application/json",
  }));
  return `s3://${BUCKET}/${key}`;
}

export async function getReportFromS3(requestId) {
  try {
    const key = `reports/${requestId}.json`;
    const result = await client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));
    const body = await result.Body.transformToString();
    return JSON.parse(body);
  } catch {
    return null;
  }
}
