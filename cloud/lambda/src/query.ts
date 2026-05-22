// Query Lambda — backs the dashboard's `/events` route. Returns the last
// 100 events for a thing, newest first. Kept separate from the ingest
// Lambda so each function's IAM, memory, and timeout stay minimal.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const TABLE = process.env.TELEMETRY_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const thing = event.queryStringParameters?.thing ?? 'pm-kit-device-1';
  const limit = Math.min(Number(event.queryStringParameters?.limit ?? 100), 500);

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'thing_name = :t',
    ExpressionAttributeValues: { ':t': thing },
    ScanIndexForward: false, // newest first
    Limit: limit,
  }));

  return {
    statusCode: 200,
    headers: {
      'content-type':                'application/json',
      'access-control-allow-origin': '*',
      'cache-control':               'no-store',
    },
    body: JSON.stringify({
      thing_name: thing,
      count:      result.Items?.length ?? 0,
      events:     result.Items ?? [],
    }),
  };
}
